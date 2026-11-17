import { useSyncExternalStore } from 'react';
import type { AppData, CollectionName, CryptoOperation, ImportBatch, DividendEvent, HistoryPoint, MarketHistory, Operation, Settings, Transaction, Transfer, ISODate, Goal } from '../lib/types';
import { DATA_KEYS, DEFAULT_SETTINGS, emptyData } from '../lib/defaults';
import { todayISO, monthOf, nowISOTime, makeDate } from '../lib/dates';
import { uid } from '../lib/ids';
import * as db from '../db/db';
import { materializeRecurrences, cardInvoiceDue, setCardMonthMode } from '../domain/ledger';
import { makeSnapshot } from '../domain/networth';
import { evaluateAlerts, planNotifications, salaryReceivedAlert, type ImmediateAlert } from '../domain/notifications';
import { cancelEvent, dividendRows, mergeEvents, reactivateEvent } from '../domain/dividends';
import { findReceiptFor, matchReceipts } from '../domain/passiveIncome';
import { computePositions, operationsAreValid, quantityAt } from '../domain/portfolio';
import { goalProgress } from '../domain/goals';
import { fetchDividends, fetchQuotes, resolveDividendProvider, type FetchError } from '../services/quotes';
import { isNative } from '../services/platform';
import { forgetPluggyKey, getItem, listAccounts, listInvestments, listTransactions, pluggyApiKey, type PluggyAccount } from '../services/pluggy';
import { mergeInvestments } from '../domain/bankInvest';
import { applyBankCategories, autoSelect, localDay, neutralKind, newAccountFor, newCardFor, syncFrom, targetFor, toStatement } from '../domain/bankSync';
import { buildPreview, buildTransactions, makeBatch } from '../domain/importer';
import { ensureChannels, fireNow, syncScheduled } from '../services/notify';
import { syncRunnerConfig } from '../services/background';
import { setPrivacyScreen } from '../services/security';
import { clearSecrets, extractSecrets, hydrateSecrets, settingsForDb } from '../services/secrets';
import { formatBRL } from '../lib/money';
import { historyId, localDate, mergePoints } from '../domain/market';
import { fetchB3History, fetchBcbSeries, fetchCryptoHistory, fetchCryptoQuotes, fetchUsQuotes, type IndexName } from '../services/market';
import { brapiQuota, initUsage, type Usage } from '../services/usage';
import { addDays, addMonths } from '../lib/dates';

export interface State {
  ready: boolean;
  data: AppData;
  settings: Settings;
  today: ISODate;
  locked: boolean;
  toast: { id: number; text: string; tone: 'ok' | 'err' } | null;
  /** Saúde da fonte de proventos neste aparelho (não sincroniza). */
  divHealth: DivHealth;
  /** Conexão bancária neste aparelho (não sincroniza): contas vistas na Pluggy, situação e última busca. */
  bank: BankState;
}

export interface BankState {
  lastAttempt?: string;
  lastOkAt?: string;
  error?: string;
  items: Record<string, { name: string; status: string; consentExpiresAt?: string; lastUpdatedAt?: string; error?: string }>;
  accounts: (PluggyAccount & { bankName: string })[];
  lastSyncByAccount: Record<string, string>;
  /** Resumo da última sincronização, por conta (para mostrar o que veio e por que algo ficou de fora). */
  report?: SyncReport[];
  /** Investimentos: quantos vieram de cada banco na última sincronização, ou o erro. */
  investReport?: { bank: string; count: number; foreign: number; error?: string }[];
}
const BANK_META = 'bankState';
/** Sincronização bancária automática: no máximo a cada 12 h (o Meu Pluggy atualiza a cada 24 h). */
export const AUTO_BANK_HOURS = 12;

export interface DivHealth {
  lastAttempt?: string; // última busca (automática ou pelo botão)
  lastOkAt?: string; // última busca em que a fonte respondeu
  downSince?: string; // desde quando a fonte não responde (nenhum ativo veio)
  lastError?: string;
}
const DIV_HEALTH_META = 'divHealth';
/** Busca automática de proventos: no máximo a cada 20 h, só no app Android (no navegador os sites recusam). */
export const AUTO_DIVIDEND_HOURS = 20;

let state: State = { ready: false, data: emptyData(), settings: DEFAULT_SETTINGS, today: todayISO(), locked: false, toast: null, divHealth: {}, bank: { items: {}, accounts: [], lastSyncByAccount: {} } };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  if (patch.settings) setCardMonthMode(patch.settings.cardMonth);
  listeners.forEach((l) => l());
};
export const getState = () => state;
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => sel(state));
}

export function toast(text: string, tone: 'ok' | 'err' = 'ok') {
  const id = Date.now();
  set({ toast: { id, text, tone } });
  setTimeout(() => state.toast?.id === id && set({ toast: null }), 3200);
}

export function applyTheme(theme: Settings['theme']) {
  const t = theme === 'system' ? (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme;
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', t === 'dark' ? '#0b0f17' : '#f3f5f9');
}

// ---------- pendências de sincronização ----------
import { dirtyKey, emptySyncState, SYNCED, type SyncState } from '../services/sync';
import { secureRemove } from '../services/secrets';
import { withoutSecrets } from '../lib/secretFields';

const SYNC_META = 'sync';
/** Sobe quando entra coleção nova em SYNCED. 2: cripto (Etapa 7). 3: importações de extratos (Etapa 9). */
export const SYNC_COLLECTIONS_VERSION = 3;
const SYNC_COLLECTIONS_META = 'syncCollections';
let sync: SyncState = emptySyncState();
let onLocalChange: (() => void) | null = null;
/** A nuvem se inscreve aqui para sincronizar pouco depois de cada mudança. */
export const setLocalChangeListener = (fn: (() => void) | null) => void (onLocalChange = fn);
export const getSyncState = (): SyncState => sync;
/** Guarda o resultado de uma sincronização sem perder o que mudou no aparelho enquanto ela rodava. */
export async function saveSyncState(next: SyncState, startedWith: SyncState): Promise<void> {
  const dirty = { ...next.dirty };
  for (const [k, t] of Object.entries(sync.dirty)) if (startedWith.dirty[k] !== t) dirty[k] = t;
  sync = { cursor: next.cursor, dirty };
  await db.setMeta(SYNC_META, sync);
}
async function markDirty(collection: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const now = Date.now();
  const dirty = { ...sync.dirty };
  for (const id of ids) dirty[dirtyKey(collection, id)] = now;
  sync = { ...sync, dirty };
  await db.setMeta(SYNC_META, sync);
  onLocalChange?.();
}
/** Marca tudo o que existe no aparelho como pendente (primeira sincronização ou depois de restaurar um backup). */
export async function markAllDirty(alsoRemoved: { collection: string; id: string }[] = [], at = Date.now()): Promise<void> {
  const dirty = { ...sync.dirty };
  for (const name of DATA_KEYS) if (SYNCED.has(name)) for (const item of state.data[name] as { id: string }[]) dirty[dirtyKey(name, item.id)] ??= at;
  dirty[dirtyKey('meta', 'settings')] ??= at;
  for (const r of alsoRemoved) dirty[dirtyKey(r.collection, r.id)] = Date.now();
  sync = { ...sync, dirty };
  await db.setMeta(SYNC_META, sync);
}
/** Valor de um registro como ele viaja para a nuvem. */
export function syncValue(collection: string, id: string): unknown | undefined {
  if (collection === 'meta') {
    if (id !== 'settings') return undefined;
    const { security: _s, ...rest } = withoutSecrets(state.settings);
    void _s;
    return rest;
  }
  return (state.data[collection as CollectionName] as { id: string }[] | undefined)?.find((x) => x.id === id);
}
/** Grava o que veio da nuvem, sem marcar como pendente. */
export async function applyRemote(upserts: { collection: string; id: string; value: unknown }[], deletes: { collection: string; id: string }[]): Promise<void> {
  const data = { ...state.data };
  for (const name of DATA_KEYS) {
    const ups = upserts.filter((u) => u.collection === name).map((u) => u.value as { id: string });
    const dels = new Set(deletes.filter((d) => d.collection === name).map((d) => d.id));
    if (ups.length === 0 && dels.size === 0) continue;
    const ids = new Set(ups.map((u) => u.id));
    (data[name] as { id: string }[]) = [...(state.data[name] as { id: string }[]).filter((x) => !ids.has(x.id) && !dels.has(x.id)), ...ups];
    await db.putItems(name, ups);
    await db.deleteItems(name, [...dels]);
  }
  let settings = state.settings;
  const remoteSettings = upserts.find((u) => u.collection === 'meta' && u.id === 'settings')?.value as Partial<Settings> | undefined;
  if (remoteSettings) {
    const merged = db.mergeSettings(remoteSettings);
    // o PIN e os segredos são de cada aparelho
    settings = { ...merged, security: state.settings.security, onboarded: true, api: { ...merged.api, brapiToken: state.settings.api.brapiToken }, ai: { ...merged.ai, apiKey: state.settings.ai.apiKey }, bank: { ...merged.bank, clientId: state.settings.bank.clientId, clientSecret: state.settings.bank.clientSecret } };
    await db.saveSettings(await settingsForDb(settings));
    applyTheme(settings.theme);
  }
  set({ data, settings });
  scheduleAfterChange();
}

// ---------- persistência genérica ----------
export async function upsert<K extends CollectionName>(name: K, items: AppData[K][number] | AppData[K][number][]): Promise<void> {
  const list = (Array.isArray(items) ? items : [items]) as { id: string }[];
  if (list.length === 0) return;
  const ids = new Set(list.map((i) => i.id));
  const merged = [...(state.data[name] as { id: string }[]).filter((x) => !ids.has(x.id)), ...list];
  set({ data: { ...state.data, [name]: merged } });
  await db.putItems(name, list);
  await markDirty(name, list.map((i) => i.id));
  scheduleAfterChange();
}
export async function remove(name: CollectionName, ids: string | string[]): Promise<void> {
  const list = Array.isArray(ids) ? ids : [ids];
  const s = new Set(list);
  set({ data: { ...state.data, [name]: (state.data[name] as { id: string }[]).filter((x) => !s.has(x.id)) } });
  await db.deleteItems(name, list);
  await markDirty(name, list);
  scheduleAfterChange();
}
export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const settings = { ...state.settings, ...patch };
  set({ settings });
  if (patch.theme) applyTheme(settings.theme);
  if (patch.security) void setPrivacyScreen(settings.security.enabled && settings.security.hideInRecents);
  await db.saveSettings(await settingsForDb(settings));
  await markDirty('meta', ['settings']);
  scheduleAfterChange();
}

// ---------- efeitos depois de qualquer mudança ----------
let timer: ReturnType<typeof setTimeout> | undefined;
function scheduleAfterChange() {
  clearTimeout(timer);
  timer = setTimeout(() => void afterChange(), 400);
}
async function fireOnce(a: ImmediateAlert) {
  if (state.data.firedAlerts.some((f) => f.id === a.key)) return;
  const rec = { id: a.key, at: Date.now() };
  set({ data: { ...state.data, firedAlerts: [...state.data.firedAlerts, rec] } });
  await db.putItems('firedAlerts', [rec]);
  await fireNow(a);
}
export async function afterChange(): Promise<void> {
  try {
    const { data, settings, today } = state;
    await syncScheduled(planNotifications(data, settings, new Date(), today));
    for (const a of evaluateAlerts(data, settings, today)) await fireOnce(a);
    await reconcileDividends();
    // metas que deixaram de estar concluídas podem avisar de novo no futuro
    const snap = makeSnapshot(state.data, today);
    set({ data: { ...state.data, snapshots: [...state.data.snapshots.filter((s) => s.id !== snap.id), snap] } });
    await db.putItems('snapshots', [snap]);
    await syncRunnerConfig(state.data, settings);
  } catch (e) {
    console.warn('afterChange', e);
  }
}

// ---------- inicialização ----------
export async function init(): Promise<void> {
  const loaded = await db.loadAll();
  const data = loaded.data;
  // segredos (token, chave) vivem no cofre do Android; os que ainda estiverem no banco são movidos agora
  const { settings, migrated } = await hydrateSecrets(loaded.settings);
  if (migrated) await db.saveSettings(await settingsForDb(settings));
  sync = (await db.getMeta<SyncState>(SYNC_META)) ?? emptySyncState();
  // coleções novas na sincronização: um aparelho na versão antiga pulava esses registros e já avançou a leitura;
  // relê a nuvem desde o início uma vez (nada se perde: o que mudou aqui continua pendente e vale o mais recente)
  if (((await db.getMeta<number>(SYNC_COLLECTIONS_META)) ?? 1) < SYNC_COLLECTIONS_VERSION) {
    if (sync.cursor !== null) {
      sync = { ...sync, cursor: null };
      await db.setMeta(SYNC_META, sync);
    }
    await db.setMeta(SYNC_COLLECTIONS_META, SYNC_COLLECTIONS_VERSION);
  }
  initUsage(await db.getMeta<Usage>('usage'), (u) => void db.setMeta('usage', u).catch(() => undefined));
  applyTheme(settings.theme);
  set({ data, settings, today: todayISO(), locked: settings.security.enabled, ready: true });
  void db.requestPersistentStorage();
  void setPrivacyScreen(settings.security.enabled && settings.security.hideInRecents);
  await ensureChannels().catch(() => undefined);
  set({ divHealth: (await db.getMeta<DivHealth>(DIV_HEALTH_META)) ?? {}, bank: { items: {}, accounts: [], lastSyncByAccount: {}, ...((await db.getMeta<BankState>(BANK_META)) ?? {}) } });
  // uma vez: quem estava na brapi gratuita (que não traz proventos) passa para a fonte automática
  if (!(await db.getMeta<boolean>('divAutoV1'))) {
    const api = state.settings.api;
    if (api.dividendProvider === 'brapi' && (api.brapiPlan === 'free' || !api.brapiToken.trim())) await updateSettings({ api: { ...api, dividendProvider: 'auto' } });
    await db.setMeta('divAutoV1', true);
  }
  await rollDay();
  if (isNative()) void autoRefreshDividends().then(() => autoSyncBank()).then(() => ((state.data.usdHoldings ?? []).length || (state.data.bankInvestments ?? []).some((i) => i.currency === 'USD') ? refreshDollar() : undefined)).catch(() => undefined);
}

/**
 * Atualiza os proventos sozinho ao abrir o app, no máximo a cada 20 h, sem aviso na tela.
 * Se a fonte estiver fora, guarda desde quando e tenta de novo depois; os proventos já salvos continuam.
 */
export async function autoRefreshDividends(now = Date.now()): Promise<boolean> {
  const api = state.settings.api;
  if (api.dividendProvider === 'manual' || !state.data.assets.length) return false;
  const last = state.divHealth.lastAttempt ? Date.parse(state.divHealth.lastAttempt) : 0;
  if (now - last < AUTO_DIVIDEND_HOURS * 3_600_000) return false;
  try {
    await refreshDividends();
  } catch {
    /* a busca já registra a falha */
  }
  return true;
}
/** Roda ao abrir o app e quando o dia muda: gera recorrências do mês e recalcula alertas. */
export async function rollDay(): Promise<void> {
  const today = todayISO();
  if (today !== state.today) set({ today });
  const made = materializeRecurrences(state.data, today);
  if (made.length > 0) await upsert('transactions', made);
  else scheduleAfterChange();
}
export const lock = () => state.settings.security.enabled && set({ locked: true });
export const unlock = () => set({ locked: false });

// ---------- movimentações ----------
export function defaultAccountId(): string | undefined {
  return state.data.accounts.find((a) => !a.archived)?.id;
}
export async function saveTransaction(t: Transaction): Promise<void> {
  const card = t.cardId ? state.data.cards.find((c) => c.id === t.cardId) : undefined;
  if (t.paymentMethod === 'credito' && card && t.status === 'pending') t = { ...t, dueDate: cardInvoiceDue(card, t.date).dueDate, accountId: undefined };
  await upsert('transactions', t);
}
export async function deleteTransaction(t: Transaction, scope: 'one' | 'group' = 'one'): Promise<void> {
  if (scope === 'group' && t.installment) {
    const ids = state.data.transactions.filter((x) => x.installment?.groupId === t.installment!.groupId && x.installment.number >= t.installment!.number).map((x) => x.id);
    return remove('transactions', ids);
  }
  if (t.recurrenceId && t.recurrenceMonth) {
    const r = state.data.recurrences.find((x) => x.id === t.recurrenceId);
    if (r) await upsert('recurrences', { ...r, skipMonths: [...(r.skipMonths ?? []), t.recurrenceMonth] });
  }
  if (t.source === 'dividend' && t.refId) {
    const ev = state.data.dividends.find((d) => d.id === t.refId);
    if (ev) await upsert('dividends', { ...ev, receivedAt: undefined, receivedTxId: undefined });
  }
  await remove('transactions', t.id);
}
export async function markPaid(t: Transaction, accountId?: string, date?: ISODate, amountCents?: number): Promise<void> {
  const paid: Transaction = { ...t, status: 'paid', paidDate: date ?? state.today, accountId: accountId ?? t.accountId ?? defaultAccountId(), amountCents: amountCents ?? t.amountCents };
  await upsert('transactions', paid);
  if (t.source === 'salary') {
    const a = salaryReceivedAlert(state.data, state.settings, monthOf(t.date), state.today);
    if (a) await fireOnce(a);
  }
}
export async function payInvoice(txIds: string[], accountId: string): Promise<void> {
  const list = state.data.transactions.filter((t) => txIds.includes(t.id)).map((t) => ({ ...t, status: 'paid' as const, paidDate: state.today, accountId }));
  await upsert('transactions', list);
}
export async function deleteRecurrence(id: string): Promise<void> {
  const pend = state.data.transactions.filter((t) => t.recurrenceId === id && t.status === 'pending').map((t) => t.id);
  await remove('transactions', pend);
  await remove('recurrences', id);
}
export async function saveSalary(amountCents: number, payDay: number, savePct: number, investPct: number, accountId?: string): Promise<void> {
  await updateSettings({ salary: { amountCents, payDay, savePct, investPct, accountId } });
  const existing = state.data.recurrences.find((r) => r.source === 'salary');
  if (amountCents <= 0) {
    if (existing) await deleteRecurrence(existing.id);
    return;
  }
  const rec = { id: existing?.id ?? 'salary', type: 'income' as const, kind: 'salario' as const, description: 'Salário', amountCents, categoryId: 'salario', paymentMethod: 'transferencia' as const, accountId: accountId ?? defaultAccountId(), dayOfMonth: payDay, startMonth: existing?.startMonth ?? monthOf(state.today), active: true, skipMonths: existing?.skipMonths, source: 'salary' as const };
  await upsert('recurrences', rec);
  // atualiza as ocorrências ainda pendentes
  const pend = state.data.transactions.filter((t) => t.recurrenceId === rec.id && t.status === 'pending').map((t) => ({ ...t, amountCents, date: makeDate(t.recurrenceMonth!, payDay), accountId: rec.accountId }));
  if (pend.length) await upsert('transactions', pend);
  await rollDay();
}

// ---------- investimentos ----------
export async function saveOperation(op: Operation): Promise<string | null> {
  const all = [...state.data.operations.filter((o) => o.id !== op.id), op];
  const v = operationsAreValid(all);
  if (!v.ok) return 'Venda maior que a quantidade em carteira nessa data.';
  await upsert('operations', op);
  return null;
}
export async function deleteOperation(id: string): Promise<string | null> {
  const v = operationsAreValid(state.data.operations.filter((o) => o.id !== id));
  if (!v.ok) return 'Não dá para excluir: há uma venda posterior que depende desta compra.';
  await remove('operations', id);
  return null;
}
export async function deleteAsset(id: string): Promise<void> {
  await remove('operations', state.data.operations.filter((o) => o.assetId === id).map((o) => o.id));
  await remove('dividends', state.data.dividends.filter((d) => d.assetId === id).map((d) => d.id));
  await remove('assets', id);
}

export async function refreshQuotes(): Promise<{ updated: number; errors: FetchError[] }> {
  const assets = state.data.assets;
  if (assets.length === 0) return { updated: 0, errors: [] };
  const { quotes, errors } = await fetchQuotes(assets.map((a) => a.ticker), state.settings.api);
  const fetchedAt = nowISOTime();
  const source = state.settings.api.quoteProvider === 'yahoo' ? 'Yahoo Finance (não oficial)' : 'brapi.dev';
  const updated = assets.filter((a) => quotes.some((q) => q.ticker === a.ticker)).map((a) => {
    const q = quotes.find((x) => x.ticker === a.ticker)!;
    return { ...a, name: a.name ?? q.name, quote: { priceCents: q.priceCents, time: q.time, fetchedAt, source, changePct: q.changePct } };
  });
  if (updated.length) await upsert('assets', updated);
  await addQuotePoints('b3', quotes.map((q) => ({ symbol: q.ticker, priceCents: q.priceCents, time: q.time })), source);
  await updateSettings({ api: { ...state.settings.api, lastQuoteRefresh: fetchedAt } });
  return { updated: updated.length, errors };
}

// ---------- histórico de preços e índices (fica só neste aparelho) ----------

/** Grava séries de histórico sem marcar sincronização: cada aparelho monta o seu a partir das fontes. */
async function saveHistoryLocal(records: MarketHistory[]): Promise<void> {
  if (!records.length) return;
  const ids = new Set(records.map((r) => r.id));
  set({ data: { ...state.data, marketHistory: [...state.data.marketHistory.filter((h) => !ids.has(h.id)), ...records] } });
  await db.putItems('marketHistory', records);
}
const findHistory = (id: string) => state.data.marketHistory.find((h) => h.id === id);

function mergedHistory(kind: MarketHistory['kind'], symbol: string, points: HistoryPoint[], source: string, fetched: boolean): MarketHistory {
  const id = historyId(kind, symbol);
  const old = findHistory(id);
  return { id, kind, symbol, unit: kind === 'indice' ? (symbol === 'USD' ? 'brl' : 'pct') : 'cents', points: mergePoints(old?.points ?? [], points), source, updatedAt: fetched ? nowISOTime() : (old?.updatedAt ?? '') };
}

/** Cada cotação buscada vira um ponto do dia no histórico (sem gastar consulta a mais). */
async function addQuotePoints(kind: 'b3' | 'cripto', items: { symbol: string; priceCents: number; time: string }[], source: string): Promise<void> {
  await saveHistoryLocal(items.map((q) => mergedHistory(kind, q.symbol, [[localDate(q.time), q.priceCents]], findHistory(historyId(kind, q.symbol))?.source ?? source, false)));
}

const fetchedToday = (id: string) => (findHistory(id)?.updatedAt ?? '').slice(0, 10) === state.today;

/** Primeira data que o comparativo pode precisar: a operação mais antiga (no máximo 10 anos atrás). */
function indexStart(): ISODate {
  const first = [...state.data.operations, ...state.data.cryptoOps].reduce<ISODate>((m, o) => (o.date < m ? o.date : m), addMonths(state.today, -12));
  const limit = addMonths(state.today, -120);
  return first < limit ? limit : first;
}

/** CDI e IPCA do Banco Central: busca só o que falta (com uma folga para revisões recentes). */
export async function refreshIndices(force = false): Promise<FetchError[]> {
  const errors: FetchError[] = [];
  const out: MarketHistory[] = [];
  const start = indexStart();
  for (const name of ['CDI', 'IPCA'] as IndexName[]) {
    const id = historyId('indice', name);
    const old = findHistory(id);
    if (!force && fetchedToday(id) && old && old.points[0]?.[0] <= addDays(start, 31)) continue;
    const covered = old && old.points.length && old.points[0][0] <= addDays(start, 31);
    const from = covered ? addMonths(old.points[old.points.length - 1][0], -2) : start;
    const r = await fetchBcbSeries(name, from, state.today);
    if ('message' in r) errors.push(r);
    else out.push(mergedHistory('indice', name, r.points, r.source, true));
  }
  await saveHistoryLocal(out);
  return errors;
}

/** Cotação do dólar (PTAX do Banco Central): no máximo uma busca por dia; na primeira vez, 1 ano de histórico. */
export async function refreshDollar(force = false): Promise<FetchError[]> {
  const id = historyId('indice', 'USD');
  const old = findHistory(id);
  if (!force && fetchedToday(id) && old?.points.length) return [];
  const from = old?.points.length ? addDays(old.points[old.points.length - 1][0], -10) : addMonths(state.today, -12);
  const r = await fetchBcbSeries('USD', from, state.today);
  if ('message' in r) return [r];
  await saveHistoryLocal([mergedHistory('indice', 'USD', r.points, r.source, true)]);
  return [];
}

/** Cotações dos ativos americanos cadastrados na aba Dólar (respeita "cotação manual" nos Ajustes). */
export async function refreshUsQuotes(): Promise<FetchError[]> {
  if (state.settings.api.quoteProvider === 'manual') return [];
  const assets = (state.data.usdHoldings ?? []).filter((h) => h.ticker && h.kind !== 'conta' && h.kind !== 'outro');
  if (!assets.length) return [];
  const { quotes, errors } = await fetchUsQuotes(assets.map((h) => h.ticker!));
  const now = new Date().toISOString();
  const upd = assets.flatMap((h) => {
    const q = quotes.find((x) => x.ticker === h.ticker!.toUpperCase());
    return q ? [{ ...h, priceUsdCents: q.priceUsdCents, priceTime: q.time, changePct: q.changePct, name: h.name || q.name || h.ticker!, updatedAt: now }] : [];
  });
  if (upd.length) await upsert('usdHoldings', upd);
  return errors;
}

/** Histórico de preços dos ativos em carteira (bolsa ou cripto) e dos índices. Uma consulta por ativo, no máximo uma vez por dia. */
export async function refreshHistory(scope: 'b3' | 'cripto', force = false): Promise<{ updated: number; errors: FetchError[] }> {
  const errors: FetchError[] = [];
  const out: MarketHistory[] = [];
  if (scope === 'b3') {
    const held = computePositions(state.data.assets, state.data.operations).filter((p) => p.quantity > 0);
    // na reserva final da cota da brapi, o histórico só é buscado quando você pede
    const api = state.settings.api;
    const save = !force && api.quoteProvider === 'brapi' && brapiQuota(api.brapiPlan).low;
    for (const p of save ? [] : held) {
      if (!force && fetchedToday(historyId('b3', p.asset.ticker))) continue;
      const r = await fetchB3History(p.asset.ticker, state.settings.api);
      if ('message' in r) errors.push(r);
      else out.push(mergedHistory('b3', p.asset.ticker, r.points, r.source, true));
    }
  } else {
    const held = computePositions(state.data.cryptoAssets, state.data.cryptoOps).filter((p) => p.quantity > 0);
    for (const p of held) {
      if (!force && fetchedToday(historyId('cripto', p.asset.coinId))) continue;
      const r = await fetchCryptoHistory(p.asset.coinId);
      if ('message' in r) errors.push({ ...r, ticker: p.asset.symbol });
      else out.push(mergedHistory('cripto', p.asset.coinId, r.points, r.source, true));
    }
  }
  await saveHistoryLocal(out);
  errors.push(...(await refreshIndices(force)));
  return { updated: out.length, errors };
}

// ---------- cripto ----------
export async function refreshCryptoQuotes(): Promise<{ updated: number; errors: FetchError[] }> {
  const assets = state.data.cryptoAssets;
  if (!assets.length) return { updated: 0, errors: [] };
  const { quotes, errors } = await fetchCryptoQuotes(assets.map((a) => a.coinId));
  const fetchedAt = nowISOTime();
  const updated = assets.flatMap((a) => {
    const q = quotes.find((x) => x.coinId === a.coinId);
    return q ? [{ ...a, quote: { priceCents: q.priceCents, time: q.time, fetchedAt, source: 'CoinGecko', changePct: q.changePct } }] : [];
  });
  if (updated.length) await upsert('cryptoAssets', updated);
  await addQuotePoints('cripto', quotes.map((q) => ({ symbol: q.coinId, priceCents: q.priceCents, time: q.time })), 'CoinGecko');
  return { updated: updated.length, errors: errors.map((e) => ({ ...e, ticker: assets.find((a) => a.coinId === e.ticker)?.symbol ?? e.ticker })) };
}

export async function saveCryptoOperation(op: CryptoOperation): Promise<string | null> {
  const all = [...state.data.cryptoOps.filter((o) => o.id !== op.id), op];
  if (!operationsAreValid(all).ok) return 'Venda maior que a quantidade em carteira nessa data.';
  await upsert('cryptoOps', op);
  return null;
}
export async function deleteCryptoOperation(id: string): Promise<string | null> {
  if (!operationsAreValid(state.data.cryptoOps.filter((o) => o.id !== id)).ok) return 'Não dá para excluir: há uma venda posterior que depende desta compra.';
  await remove('cryptoOps', id);
  return null;
}
export async function deleteCryptoAsset(id: string): Promise<void> {
  await remove('cryptoOps', state.data.cryptoOps.filter((o) => o.assetId === id).map((o) => o.id));
  await remove('cryptoAssets', id);
}

export async function refreshDividends(): Promise<{ added: number; errors: FetchError[] }> {
  const attempt = new Date().toISOString();
  let fetched: { events: DividendEvent[]; errors: FetchError[] };
  try {
    fetched = await fetchDividends(state.data.assets, state.settings.api);
  } catch (e) {
    fetched = { events: [], errors: state.data.assets.map((a) => ({ ticker: a.ticker, message: e instanceof Error ? e.message : 'falha na busca' })) };
  }
  const { events, errors } = fetched;
  // fonte fora do ar = nenhum ativo respondeu; os proventos já salvos não são tocados
  const allFailed = state.data.assets.length > 0 && errors.length >= state.data.assets.length && events.length === 0 && resolveDividendProvider(state.settings.api) !== 'manual';
  const health: DivHealth = allFailed ? { ...state.divHealth, lastAttempt: attempt, downSince: state.divHealth.downSince ?? attempt, lastError: errors[0]?.message } : { lastAttempt: attempt, lastOkAt: attempt };
  set({ divHealth: health });
  await db.setMeta(DIV_HEALTH_META, health).catch(() => undefined);
  if (allFailed) return { added: 0, errors };
  const firstTime = !state.settings.api.lastDividendRefresh;
  const failed = new Set(errors.map((e) => e.ticker));
  const covered = state.data.assets.filter((a) => !failed.has(a.ticker)).map((a) => a.id);
  const sourceName = events[0]?.sourceName ?? (resolveDividendProvider(state.settings.api) === 'yahoo' ? 'Yahoo Finance (não oficial)' : 'brapi.dev');
  const res = mergeEvents(state.data.dividends, events, { coveredAssetIds: covered, sourceName, today: state.today });
  if (res.toUpsert.length) await upsert('dividends', res.toUpsert);
  await updateSettings({ api: { ...state.settings.api, lastDividendRefresh: nowISOTime() } });
  const prefs = state.settings.notifications;
  if (!firstTime && prefs.enabled && prefs.types.dividendAnnounced) {
    const today = state.today;
    const notify = async (e: DividendEvent, title: (t: string) => string) => {
      const asset = state.data.assets.find((a) => a.id === e.assetId);
      if (!asset) return;
      const qty = quantityAt(state.data.operations, e.assetId, e.dataCom ?? today);
      const recent = e.paymentDate ? e.paymentDate >= today : !!e.dataCom && e.dataCom >= today;
      if (qty <= 0 || !recent) return;
      const total = Math.round(e.ratePerUnit * qty * 100 * (e.kind === 'jcp' ? 0.85 : 1));
      await fireOnce({ key: `div-new:${e.key}:${e.paymentDate ?? ''}`, title: title(asset.ticker), body: `${formatBRL(total)} para você${e.paymentDate ? `, pagamento em ${e.paymentDate.split('-').reverse().slice(0, 2).join('/')}` : ' (data de pagamento ainda não divulgada)'}.`, channel: 'dividendos' });
    };
    for (const e of res.added) await notify(e, (t) => `${t} anunciou ${e.kind === 'rendimento' ? 'rendimentos' : e.kind === 'jcp' ? 'JCP' : 'dividendos'}`);
    for (const e of res.dateAnnounced) await notify(e, (t) => `${t}: data de pagamento divulgada`);
  }
  if (!firstTime && prefs.enabled && prefs.types.dividendChanged) {
    const tk = (id: string) => state.data.assets.find((a) => a.id === id)?.ticker ?? '';
    for (const c of res.changed) await fireOnce({ key: `div-chg:${c.event.id}:${c.text}`, title: `${tk(c.event.assetId)}: provento alterado`, body: `A fonte corrigiu: ${c.text}.`, channel: 'dividendos' });
    for (const e of res.missing) await fireOnce({ key: `div-miss:${e.id}`, title: `${tk(e.assetId)}: provento sumiu da fonte`, body: 'Pode ter sido cancelado ou corrigido. Confira na aba Dividendos.', channel: 'dividendos' });
  }
  return { added: res.added.length, errors };
}

/**
 * Confirmação pelo extrato: liga cada provento a receber ao crédito correspondente já lançado ou importado.
 * Também desfaz a confirmação quando o crédito ligado deixa de existir (ex.: importação desfeita). Nada é apagado.
 */
export async function reconcileDividends(): Promise<number> {
  const now = new Date().toISOString();
  const txIds = new Set(state.data.transactions.map((t) => t.id));
  const orphans = state.data.dividends.filter((d) => d.receivedAt && d.receivedTxId && !txIds.has(d.receivedTxId));
  if (orphans.length) {
    await upsert('dividends', orphans.map((d) => ({ ...d, receivedAt: undefined, receivedTxId: undefined, confirmedBy: undefined, revisions: [...(d.revisions ?? []), { at: now, source: 'app', text: 'confirmação desfeita: o lançamento do recebimento foi apagado' }] })));
  }
  const matches = matchReceipts(state.data, state.today);
  if (!matches.length) return 0;
  const evs = matches.map((m) => {
    const ev = state.data.dividends.find((d) => d.id === m.eventId)!;
    const tx = state.data.transactions.find((t) => t.id === m.txId)!;
    return { ...ev, receivedAt: tx.date, receivedTxId: tx.id, confirmedBy: 'extrato' as const, revisions: [...(ev.revisions ?? []), { at: now, source: 'extrato', text: `pago: confirmado pelo lançamento "${tx.description}" de ${tx.date.split('-').reverse().join('/')}` }] };
  });
  await upsert('dividends', evs);
  // crédito importado sem categoria: passa a contar como provento
  const retag = matches.map((m) => state.data.transactions.find((t) => t.id === m.txId)!).filter((t) => t.categoryId === 'outros_rend').map((t) => ({ ...t, categoryId: 'dividendos' }));
  if (retag.length) await upsert('transactions', retag);
  const prefs = state.settings.notifications;
  if (prefs.enabled && prefs.types.dividendChanged) {
    for (const e of evs) {
      const asset = state.data.assets.find((a) => a.id === e.assetId);
      await fireOnce({ key: `div-ok:${e.id}`, title: `Provento confirmado: ${asset?.ticker ?? ''}`, body: 'O crédito apareceu no seu extrato. Já conta como recebido.', channel: 'dividendos' });
    }
  }
  return evs.length;
}

export async function cancelDividend(id: string): Promise<void> {
  const e = state.data.dividends.find((d) => d.id === id);
  if (e && !e.cancelledAt && !e.receivedAt) await upsert('dividends', cancelEvent(e, 'usuario'));
}
export async function reactivateDividend(id: string): Promise<void> {
  const e = state.data.dividends.find((d) => d.id === id);
  if (e?.cancelledAt) await upsert('dividends', reactivateEvent(e));
}

/** Confirma que o provento caiu na conta. Se o crédito já está lançado (ex.: veio no extrato), liga a ele; senão, registra a receita. */
export async function confirmDividend(eventId: string, accountId?: string): Promise<void> {
  const row = dividendRows(state.data, state.today).find((r) => r.event.id === eventId);
  if (!row || row.event.receivedAt || row.event.cancelledAt) return;
  const existing = findReceiptFor(state.data, eventId, state.today);
  if (existing) {
    await upsert('dividends', { ...row.event, receivedAt: existing.date, receivedTxId: existing.id, confirmedBy: 'extrato', revisions: [...(row.event.revisions ?? []), { at: new Date().toISOString(), source: 'você', text: `pago: ligado ao lançamento "${existing.description}" que já existia` }] });
    return;
  }
  const date = row.event.paymentDate && row.event.paymentDate <= state.today ? row.event.paymentDate : state.today;
  const tx: Transaction = { id: uid('t_'), type: 'income', kind: 'outro_rendimento', description: `${row.event.kind === 'jcp' ? 'JCP' : row.event.kind === 'rendimento' ? 'Rendimento' : 'Dividendo'} ${row.asset.ticker}`, amountCents: row.netCents, categoryId: 'dividendos', date, paymentMethod: 'transferencia', accountId: accountId ?? defaultAccountId(), status: 'paid', paidDate: date, source: 'dividend', refId: eventId, createdAt: Date.now() };
  await upsert('transactions', tx);
  await upsert('dividends', { ...row.event, receivedAt: date, receivedTxId: tx.id, confirmedBy: 'manual' });
}

// ---------- importação de extratos ----------
/**
 * Grava uma importação: guarda antes uma cópia de segurança de tudo, depois os lançamentos e o registro da importação
 * (para poder desfazer), e as regras de categoria que você ensinou na prévia.
 */
export async function applyImport(batch: ImportBatch, txs: Transaction[], rules: Settings['importRules'], opts: { safetyCopy?: boolean } = {}): Promise<void> {
  // a sincronização bancária diária não gira as cópias de segurança: só acrescenta e cada lote tem "Desfazer"
  if (opts.safetyCopy !== false) await db.createSafetyCopy('importacao', state.data, state.settings);
  await upsert('transactions', txs);
  await upsert('imports', batch);
  if (JSON.stringify(rules) !== JSON.stringify(state.settings.importRules)) await updateSettings({ importRules: rules });
}
/** Desfaz uma importação: apaga os lançamentos que ela criou (com cópia de segurança antes) e marca como desfeita. */
export async function undoImport(id: string): Promise<number> {
  const batch = state.data.imports.find((b) => b.id === id);
  if (!batch || batch.undoneAt) return 0;
  await db.createSafetyCopy('importacao', state.data, state.settings);
  const ids = state.data.transactions.filter((t) => t.importId === id).map((t) => t.id);
  await remove('transactions', ids);
  const moves = (state.data.transfers ?? []).filter((t) => t.importId === id).map((t) => t.id);
  if (moves.length) await remove('transfers', moves);
  await upsert('imports', { ...batch, undoneAt: new Date().toISOString() });
  return ids.length;
}

// ---------- conexão bancária (Meu Pluggy) ----------
export interface SyncReport { account: string; from: string; received: number; imported: number; moved?: number; already: number; similar: number; invoice: number; pending: number; payments: number; foreign: number; error?: string }
async function saveBank(patch: Partial<BankState>): Promise<void> {
  const bank = { ...state.bank, ...patch };
  set({ bank });
  await db.setMeta(BANK_META, bank).catch(() => undefined);
}
export const bankConfigured = (): boolean => !!(state.settings.bank.clientId && state.settings.bank.clientSecret && state.settings.bank.items.length);

/** Busca na Pluggy as contas de cada banco (sem importar nada) para você vincular. */
export async function loadBankAccounts(): Promise<{ errors: string[] }> {
  const b = state.settings.bank;
  const errors: string[] = [];
  const key = await pluggyApiKey(b.clientId, b.clientSecret);
  const items: BankState['items'] = {};
  const accounts: BankState['accounts'] = [];
  for (const it of b.items) {
    try {
      const item = await getItem(key, it.itemId);
      const bankName = it.label || item.connector?.name || 'Banco';
      items[it.itemId] = { name: bankName, status: item.status, consentExpiresAt: item.consentExpiresAt, lastUpdatedAt: item.lastUpdatedAt, error: item.error?.message ?? undefined };
      for (const a of await listAccounts(key, it.itemId)) accounts.push({ ...a, bankName });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      items[it.itemId] = { name: it.label || 'Banco', status: 'ERRO', error: msg };
      errors.push(`${it.label || it.itemId}: ${msg}`);
    }
  }
  await saveBank({ items, accounts });
  return { errors };
}

/** Vincula uma conta do banco: "novo" cria conta (ou cartão) no app; ou liga a uma existente; ou ignora. */
export async function linkBankAccount(pluggyAccountId: string, choice: string): Promise<void> {
  const acc = state.bank.accounts.find((a) => a.id === pluggyAccountId);
  if (!acc) return;
  let link: Settings['bank']['links'][string];
  if (choice === 'ignorar') link = { kind: 'ignorar' };
  else if (choice.startsWith('conta:')) link = { kind: 'conta', id: choice.slice(6) };
  else if (choice.startsWith('cartao:')) link = { kind: 'cartao', id: choice.slice(7) };
  else if (acc.type === 'CREDIT') {
    // o cartão é pago pela conta do mesmo banco, se ela já estiver vinculada
    const sameBank = state.bank.accounts.find((a) => a.itemId === acc.itemId && a.type !== 'CREDIT' && state.settings.bank.links[a.id]?.kind === 'conta');
    const card = newCardFor(acc, acc.bankName, uid('cd_'), (sameBank && state.settings.bank.links[sameBank.id]?.id) || defaultAccountId());
    await upsert('cards', card);
    link = { kind: 'cartao', id: card.id };
  } else {
    const account = newAccountFor(acc, acc.bankName, localDay(state.bank.items[acc.itemId]?.lastUpdatedAt), uid('ac_'));
    await upsert('accounts', account);
    link = { kind: 'conta', id: account.id };
  }
  await updateSettings({ bank: { ...state.settings.bank, links: { ...state.settings.bank.links, [pluggyAccountId]: link } } });
}

/**
 * Sincroniza: para cada conta vinculada, busca as transações novas e importa pelo mesmo caminho da importação de
 * extrato (sem duplicar, com categorias e "Desfazer"). O que a prévia marcaria para conferir fica de fora.
 * Um banco com erro não impede os outros.
 */
export async function syncBank(): Promise<{ imported: number; accounts: number; errors: string[] }> {
  const attempt = new Date().toISOString();
  const errors: string[] = [];
  let imported = 0, accountsDone = 0;
  try {
    const loaded = await loadBankAccounts();
    errors.push(...loaded.errors);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await saveBank({ lastAttempt: attempt, error: msg });
    return { imported: 0, accounts: 0, errors: [msg] };
  }
  const b = state.settings.bank;
  const key = await pluggyApiKey(b.clientId, b.clientSecret);
  const cardsSynced = state.bank.accounts.some((a) => b.links[a.id]?.kind === 'cartao');
  const lastByAcc = { ...state.bank.lastSyncByAccount };
  const report: SyncReport[] = [];
  for (const acc of state.bank.accounts) {
    const target = targetFor(b.links[acc.id]);
    if (!target) continue;
    const name = `${acc.bankName} · ${acc.marketingName || acc.name}`;
    const from = syncFrom(lastByAcc[acc.id], b.historyDays, state.today);
    try {
      const txs = await listTransactions(key, acc.id, from);
      const st = toStatement(acc, txs);
      const preview = autoSelect(applyBankCategories(buildPreview(st, target, state.data, state.settings)), cardsSynced);
      const count = (f: string) => preview.filter((r) => r.flag === f && !r.include).length;
      const id = uid('imp_');
      // entre contas suas e aplicação/resgate de investimento: viram transferência (mexem no saldo, não em receitas/despesas)
      const moves: Transfer[] = [];
      const rows = preview.map((r) => {
        const kind = target.kind === 'conta' && r.include ? neutralKind(r.row.bankCategory, r.row.description) : null;
        if (!kind || target.kind !== 'conta') return r;
        if (!(r.row.fitId && (state.data.transfers ?? []).some((t) => t.fitId === r.row.fitId))) {
          const out = r.type === 'expense';
          moves.push({ id: uid('tr_'), fromAccountId: out ? target.accountId : '', toAccountId: out ? '' : target.accountId, amountCents: r.amountCents, date: r.row.date, note: r.row.description.slice(0, 80), kind, importId: id, fitId: r.row.fitId, createdAt: Date.now() + moves.length });
        }
        return { ...r, include: false };
      });
      const built = buildTransactions(rows, target, state.data, id, () => uid('t_'), state.today);
      if (built.length || moves.length) {
        if (moves.length) await upsert('transfers', moves);
        await applyImport(makeBatch(id, `Meu Pluggy · ${acc.bankName} · ${acc.marketingName || acc.name}`, st, target, rows), built, state.settings.importRules ?? [], { safetyCopy: false });
        imported += built.length + moves.length;
      }
      report.push({ account: name, from, received: txs.length, imported: built.length, moved: moves.length, already: count('importado') + count('repetido'), similar: count('possivel'), invoice: count('fatura'), ...st.skipped });
      // Banco ainda sem transações (o Meu Pluggy pode estar coletando): não avança a data, para o histórico vir depois.
      if (txs.length || lastByAcc[acc.id]) lastByAcc[acc.id] = attempt;
      accountsDone++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      report.push({ account: name, from, received: 0, imported: 0, already: 0, similar: 0, invoice: 0, pending: 0, payments: 0, foreign: 0, error: msg });
      errors.push(`${name}: ${msg}`);
    }
  }
  // investimentos de cada banco (foto das posições; um banco com erro não apaga o que já estava salvo)
  const investReport: NonNullable<BankState['investReport']> = [];
  for (const it of b.items) {
    const bankName = it.label || state.bank.items[it.itemId]?.name || 'Banco';
    try {
      const got = await listInvestments(key, it.itemId);
      const prev = (state.data.bankInvestments ?? []).filter((x) => x.itemId === it.itemId);
      const { list, skippedForeign } = mergeInvestments(prev, got, it.itemId, bankName, state.data, attempt);
      const gone = prev.filter((p) => !list.some((x) => x.id === p.id)).map((p) => p.id);
      if (gone.length) await remove('bankInvestments', gone);
      if (list.length) await upsert('bankInvestments', list);
      investReport.push({ bank: bankName, count: list.length, foreign: skippedForeign });
    } catch (e) {
      investReport.push({ bank: bankName, count: 0, foreign: 0, error: e instanceof Error ? e.message : String(e) });
    }
  }
  await saveBank({ investReport, report, lastAttempt: attempt, lastSyncByAccount: lastByAcc, ...(errors.length && !accountsDone ? { error: errors[0] } : { lastOkAt: attempt, error: undefined }) });
  return { imported, accounts: accountsDone, errors };
}

/** Conta (ou não) um investimento do banco no patrimônio. A escolha fica guardada nas próximas sincronizações. */
export async function setBankInvestmentCounted(id: string, counted: boolean): Promise<void> {
  const inv = (state.data.bankInvestments ?? []).find((x) => x.id === id);
  if (inv) await upsert('bankInvestments', { ...inv, counted, countedReason: 'voce' });
}

/**
 * A conta do app passa a começar com o saldo do banco (soma das contas do banco ligadas a ela), no dia seguinte à
 * última atualização da Pluggy. Nada é apagado: o histórico continua nos relatórios, só deixa de mexer no saldo de hoje.
 */
export async function startAccountAtBankBalance(appAccountId: string): Promise<void> {
  const acc = state.data.accounts.find((a) => a.id === appAccountId);
  if (!acc) return;
  const linked = state.bank.accounts.filter((a) => { const l = state.settings.bank.links[a.id]; return l?.kind === 'conta' && l.id === appAccountId; });
  if (!linked.length) return;
  const cents = linked.reduce((s, a) => s + Math.round(a.balance * 100), 0);
  const days = linked.map((a) => localDay(state.bank.items[a.itemId]?.lastUpdatedAt)).sort();
  const balanceDay = days[days.length - 1];
  await db.createSafetyCopy('importacao', state.data, state.settings);
  await upsert('accounts', { ...acc, initialCents: cents, initialDate: addDays(balanceDay, 1) });
}

/**
 * Refaz o que veio pela conexão com as regras novas: desfaz as importações do Meu Pluggy (com cópia de segurança
 * antes) e busca de novo o histórico escolhido. Lançamentos que você criou à mão não são tocados.
 */
export async function reimportBank(): Promise<{ imported: number; accounts: number; errors: string[] }> {
  await db.createSafetyCopy('importacao', state.data, state.settings);
  for (const b of state.data.imports.filter((x) => !x.undoneAt && x.fileName.startsWith('Meu Pluggy'))) {
    const ids = state.data.transactions.filter((t) => t.importId === b.id).map((t) => t.id);
    if (ids.length) await remove('transactions', ids);
    const moves = (state.data.transfers ?? []).filter((t) => t.importId === b.id).map((t) => t.id);
    if (moves.length) await remove('transfers', moves);
    await upsert('imports', { ...b, undoneAt: new Date().toISOString() });
  }
  await saveBank({ lastSyncByAccount: {} });
  return syncBank();
}

/** Sincroniza sozinho ao abrir o app (Android), no máximo a cada 12 h, se houver conta vinculada. */
export async function autoSyncBank(now = Date.now()): Promise<boolean> {
  if (!bankConfigured() || !Object.values(state.settings.bank.links).some((l) => l.kind !== 'ignorar')) return false;
  const last = state.bank.lastAttempt ? Date.parse(state.bank.lastAttempt) : 0;
  if (now - last < AUTO_BANK_HOURS * 3_600_000) return false;
  try {
    await syncBank();
  } catch {
    /* registrado em bank.error */
  }
  return true;
}

/** Remove a conexão deste aparelho: apaga as credenciais do cofre e os vínculos. Os lançamentos já importados ficam. */
export async function disconnectBank(): Promise<void> {
  forgetPluggyKey();
  // investimentos do banco são só uma foto da conexão: saem junto (nada que você lançou é tocado)
  const invIds = (state.data.bankInvestments ?? []).map((x) => x.id);
  if (invIds.length) await remove('bankInvestments', invIds);
  await updateSettings({ bank: { ...DEFAULT_SETTINGS.bank } });
  await saveBank({ items: {}, accounts: [], lastSyncByAccount: {}, report: undefined, error: undefined, lastAttempt: undefined, lastOkAt: undefined });
}

// ---------- metas ----------
export async function moveGoal(goal: Goal, amountCents: number, date: ISODate, accountId?: string, note?: string): Promise<string | null> {
  const acc = goalProgress(goal, state.data.goalMoves, state.today).accumulatedCents;
  if (acc + amountCents < 0) return 'Retirada maior que o valor guardado.';
  await upsert('goalMoves', { id: uid('gm_'), goalId: goal.id, amountCents, date, accountId, note, createdAt: Date.now() });
  return null;
}
export async function deleteGoal(id: string): Promise<void> {
  await remove('goalMoves', state.data.goalMoves.filter((m) => m.goalId === id).map((m) => m.id));
  await remove('goals', id);
}

// ---------- backup / reset ----------
/**
 * Substitui todos os dados do aparelho pelos informados (restauração de backup ou de uma cópia de segurança).
 * Antes de substituir, guarda uma cópia do que existe agora, para a operação poder ser desfeita.
 */
export async function restoreAll(data: AppData, settings: Omit<Settings, 'security'>, reason: db.SafetyReason = 'restauracao'): Promise<void> {
  await db.createSafetyCopy(reason, state.data, state.settings);
  // configurações do arquivo completadas com os padrões (backups antigos não têm as opções novas);
  // o PIN é o deste aparelho, e um token/chave já configurado aqui não é apagado por um arquivo que não o traz
  const merged = db.mergeSettings(settings as Partial<Settings>);
  const current = extractSecrets(state.settings);
  const full: Settings = {
    ...merged,
    api: { ...merged.api, brapiToken: merged.api.brapiToken || current.brapiToken },
    ai: { ...merged.ai, apiKey: merged.ai.apiKey || current.aiApiKey },
    bank: { ...merged.bank, clientId: merged.bank.clientId || current.pluggyClientId, clientSecret: merged.bank.clientSecret || current.pluggyClientSecret },
    security: state.settings.security,
    onboarded: true,
  };
  const d = { ...emptyData(), ...data };
  // para a sincronização: o que sumiu com a restauração precisa ser apagado também nos outros aparelhos
  const removed = DATA_KEYS.flatMap((name) => {
    const kept = new Set((d[name] as { id: string }[]).map((x) => x.id));
    return (state.data[name] as { id: string }[]).filter((x) => !kept.has(x.id)).map((x) => ({ collection: name as string, id: x.id }));
  });
  await db.replaceEverything(d, await settingsForDb(full));
  set({ data: d, settings: full });
  await markAllDirty(removed);
  applyTheme(full.theme);
  await rollDay();
}

/** Volta os dados para uma das cópias de segurança automáticas. O estado atual também é guardado antes. */
export async function restoreSafetyCopy(id: string): Promise<boolean> {
  const copy = await db.getSafetyCopy(id);
  if (!copy) return false;
  await restoreAll(copy.data, copy.settings);
  return true;
}

export async function wipeAll(): Promise<void> {
  const d = emptyData();
  await clearSecrets();
  await db.clearSafetyCopies();
  // sai da nuvem neste aparelho (a cópia da nuvem não é apagada) e zera o controle de sincronização
  await secureRemove('cloud_session');
  await secureRemove('vault_key');
  sync = emptySyncState();
  await db.replaceEverything(d, DEFAULT_SETTINGS);
  await db.setMeta(SYNC_META, sync);
  forgetPluggyKey();
  await db.setMeta(BANK_META, { items: {}, accounts: [], lastSyncByAccount: {} });
  set({ data: d, settings: DEFAULT_SETTINGS, locked: false, bank: { items: {}, accounts: [], lastSyncByAccount: {} } });
  applyTheme('dark');
}
