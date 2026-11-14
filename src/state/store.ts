import { useSyncExternalStore } from 'react';
import type { AppData, CollectionName, DividendEvent, Operation, Settings, Transaction, ISODate, Goal } from '../lib/types';
import { DEFAULT_SETTINGS, emptyData } from '../lib/defaults';
import { todayISO, monthOf, nowISOTime, makeDate } from '../lib/dates';
import { uid } from '../lib/ids';
import * as db from '../db/db';
import { materializeRecurrences, cardInvoiceDue } from '../domain/ledger';
import { makeSnapshot } from '../domain/networth';
import { evaluateAlerts, planNotifications, salaryReceivedAlert, type ImmediateAlert } from '../domain/notifications';
import { dividendRows, mergeEvents } from '../domain/dividends';
import { operationsAreValid, quantityAt } from '../domain/portfolio';
import { goalProgress } from '../domain/goals';
import { fetchDividends, fetchQuotes, type FetchError } from '../services/quotes';
import { ensureChannels, fireNow, syncScheduled } from '../services/notify';
import { syncRunnerConfig } from '../services/background';
import { setPrivacyScreen } from '../services/security';
import { clearSecrets, extractSecrets, hydrateSecrets, settingsForDb } from '../services/secrets';
import { formatBRL } from '../lib/money';

export interface State {
  ready: boolean;
  data: AppData;
  settings: Settings;
  today: ISODate;
  locked: boolean;
  toast: { id: number; text: string; tone: 'ok' | 'err' } | null;
}

let state: State = { ready: false, data: emptyData(), settings: DEFAULT_SETTINGS, today: todayISO(), locked: false, toast: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
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

// ---------- persistência genérica ----------
export async function upsert<K extends CollectionName>(name: K, items: AppData[K][number] | AppData[K][number][]): Promise<void> {
  const list = (Array.isArray(items) ? items : [items]) as { id: string }[];
  if (list.length === 0) return;
  const ids = new Set(list.map((i) => i.id));
  const merged = [...(state.data[name] as { id: string }[]).filter((x) => !ids.has(x.id)), ...list];
  set({ data: { ...state.data, [name]: merged } });
  await db.putItems(name, list);
  scheduleAfterChange();
}
export async function remove(name: CollectionName, ids: string | string[]): Promise<void> {
  const list = Array.isArray(ids) ? ids : [ids];
  const s = new Set(list);
  set({ data: { ...state.data, [name]: (state.data[name] as { id: string }[]).filter((x) => !s.has(x.id)) } });
  await db.deleteItems(name, list);
  scheduleAfterChange();
}
export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const settings = { ...state.settings, ...patch };
  set({ settings });
  if (patch.theme) applyTheme(settings.theme);
  if (patch.security) void setPrivacyScreen(settings.security.enabled && settings.security.hideInRecents);
  await db.saveSettings(await settingsForDb(settings));
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
  applyTheme(settings.theme);
  set({ data, settings, today: todayISO(), locked: settings.security.enabled, ready: true });
  void db.requestPersistentStorage();
  void setPrivacyScreen(settings.security.enabled && settings.security.hideInRecents);
  await ensureChannels().catch(() => undefined);
  await rollDay();
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
  await updateSettings({ api: { ...state.settings.api, lastQuoteRefresh: fetchedAt } });
  return { updated: updated.length, errors };
}

export async function refreshDividends(): Promise<{ added: number; errors: FetchError[] }> {
  const { events, errors } = await fetchDividends(state.data.assets, state.settings.api);
  const firstTime = !state.settings.api.lastDividendRefresh;
  const res = mergeEvents(state.data.dividends, events);
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
  return { added: res.added.length, errors };
}

/** Confirma que o provento caiu na conta: registra como receita. */
export async function confirmDividend(eventId: string, accountId?: string): Promise<void> {
  const row = dividendRows(state.data, state.today).find((r) => r.event.id === eventId);
  if (!row || row.event.receivedAt) return;
  const date = row.event.paymentDate && row.event.paymentDate <= state.today ? row.event.paymentDate : state.today;
  const tx: Transaction = { id: uid('t_'), type: 'income', kind: 'outro_rendimento', description: `${row.event.kind === 'jcp' ? 'JCP' : row.event.kind === 'rendimento' ? 'Rendimento' : 'Dividendo'} ${row.asset.ticker}`, amountCents: row.netCents, categoryId: 'dividendos', date, paymentMethod: 'transferencia', accountId: accountId ?? defaultAccountId(), status: 'paid', paidDate: date, source: 'dividend', refId: eventId, createdAt: Date.now() };
  await upsert('transactions', tx);
  await upsert('dividends', { ...row.event, receivedAt: date, receivedTxId: tx.id });
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
    security: state.settings.security,
    onboarded: true,
  };
  const d = { ...emptyData(), ...data };
  await db.replaceEverything(d, await settingsForDb(full));
  set({ data: d, settings: full });
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
  await db.replaceEverything(d, DEFAULT_SETTINGS);
  set({ data: d, settings: DEFAULT_SETTINGS, locked: false });
  applyTheme('dark');
}
