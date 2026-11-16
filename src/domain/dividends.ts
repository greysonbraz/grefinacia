import type { AppData, Asset, Cents, DividendEvent, ISODate, YearMonth } from '../lib/types';
import { addMonthsYM, makeDate, monthOf } from '../lib/dates';
import { roundHalfAway } from '../lib/money';
import { computePositions, quantityAt } from './portfolio';

/** Imposto de renda retido na fonte sobre JCP (15%). Dividendos de ações e rendimentos de FIIs são isentos para pessoa física. */
export const JCP_TAX = 0.15;

/**
 * Situação de um provento para você. "Pago" só com confirmação (sua ou do extrato importado): a data de pagamento
 * passar NÃO basta. Cancelado continua no histórico, fora dos totais.
 */
export type DividendStatus = 'anunciado' | 'aguardando_data_com' | 'direito_adquirido' | 'pagamento_previsto' | 'aguardando_confirmacao' | 'pago' | 'cancelado';

export const STATUS_LABEL: Record<DividendStatus, string> = {
  anunciado: 'Anunciado',
  aguardando_data_com: 'Aguardando data-com',
  direito_adquirido: 'Direito adquirido',
  pagamento_previsto: 'Pagamento previsto',
  aguardando_confirmacao: 'Aguardando confirmação',
  pago: 'Pago',
  cancelado: 'Cancelado',
};
export const STATUS_TONE: Record<DividendStatus, '' | 'good' | 'warn' | 'bad' | 'est'> = {
  anunciado: 'est',
  aguardando_data_com: '',
  direito_adquirido: '',
  pagamento_previsto: '',
  aguardando_confirmacao: 'warn',
  pago: 'good',
  cancelado: 'bad',
};

export interface DividendRow {
  event: DividendEvent;
  asset: Asset;
  quantity: number; // quantidade elegível: a que você tinha no fim da data-com (ou hoje, se a data-com ainda não chegou)
  grossCents: Cents;
  netCents: Cents;
  status: DividendStatus;
  /** A fonte corrigiu o evento ou deixou de trazê-lo. */
  altered: boolean;
}

export const netFactor = (e: DividendEvent): number => (e.kind === 'jcp' ? 1 - JCP_TAX : 1);

/** Identidade de um provento (a data de pagamento fica de fora: ela pode ser divulgada depois). */
export function makeEventKey(ticker: string, kind: string, dataCom: string | undefined, rate: number): string {
  return [ticker.toUpperCase(), kind, dataCom ?? '', rate.toFixed(8)].join('|');
}

export function eventStatus(e: DividendEvent, today: ISODate): DividendStatus {
  if (e.cancelledAt) return 'cancelado';
  if (e.receivedAt) return 'pago';
  if (e.dataCom && today <= e.dataCom) return 'aguardando_data_com';
  if (e.paymentDate) return e.paymentDate <= today ? 'aguardando_confirmacao' : 'pagamento_previsto';
  if (e.dataCom) return 'direito_adquirido';
  return 'anunciado';
}

/** Valor que o usuário tem direito: valor por cota × quantidade que possuía no fim da data-com. Eventos sem direito são ignorados. */
export function dividendRows(data: AppData, today: ISODate): DividendRow[] {
  const rows: DividendRow[] = [];
  for (const e of data.dividends) {
    const asset = data.assets.find((a) => a.id === e.assetId);
    if (!asset) continue;
    // depois da data-com vale a posição daquele dia; antes dela, a de hoje (pode mudar até lá)
    const ref = e.dataCom ? (e.dataCom < today ? e.dataCom : today) : (e.paymentDate && e.paymentDate < today ? e.paymentDate : today);
    const quantity = e.quantityOverride ?? quantityAt(data.operations, e.assetId, ref);
    if (quantity <= 0) continue;
    const grossCents = roundHalfAway(e.ratePerUnit * quantity * 100);
    const netCents = e.kind === 'jcp' ? roundHalfAway(grossCents * (1 - JCP_TAX)) : grossCents;
    rows.push({ event: e, asset, quantity, grossCents, netCents, status: eventStatus(e, today), altered: !!e.missingSince || (e.revisions?.length ?? 0) > 0 });
  }
  const when = (r: DividendRow) => r.event.receivedAt ?? r.event.paymentDate ?? r.event.dataCom ?? r.event.exDate ?? '';
  return rows.sort((a, b) => when(b).localeCompare(when(a)));
}

/** Só o que foi confirmado conta como dinheiro recebido. */
export const isReceived = (r: DividendRow): boolean => r.status === 'pago' && !!r.event.receivedAt;
/** A receber: anunciado e com direito, ainda não pago nem cancelado. */
export const isPending = (r: DividendRow): boolean => r.status !== 'pago' && r.status !== 'cancelado';

export interface ForecastItem {
  assetId: string;
  ticker: string;
  date: ISODate;
  cents: Cents;
  official: boolean;
  kind: string;
  quantity: number;
  note?: string;
}

export interface Forecast {
  ym: YearMonth;
  officialCents: Cents;
  estimatedCents: Cents;
  totalCents: Cents;
  items: ForecastItem[];
  withoutHistory: string[]; // tickers sem anúncio nem histórico para estimar
}

/**
 * Previsão de proventos de um mês.
 *  - "oficial": pagamentos já anunciados (ou informados por você) com data nesse mês;
 *  - "estimado": ativos sem anúncio, projetados pelo histórico — NÃO é valor garantido.
 * Método da estimativa: FIIs e ativos que pagaram em ≥4 dos últimos 6 meses → média dos últimos 3 pagamentos por cota;
 * demais → o que foi pago no mesmo mês do ano anterior. Sem histórico, não estima.
 */
export function forecastMonth(data: AppData, ym: YearMonth, today: ISODate): Forecast {
  const rows = dividendRows(data, today);
  const items: ForecastItem[] = [];
  const hasRowThisMonth = new Set<string>();
  for (const r of rows) {
    if (r.status === 'cancelado') continue;
    if (!r.event.paymentDate || monthOf(r.event.paymentDate) !== ym) continue;
    hasRowThisMonth.add(r.asset.id);
    items.push({ assetId: r.asset.id, ticker: r.asset.ticker, date: r.event.paymentDate, cents: r.netCents, official: r.event.official, kind: r.event.kind, quantity: r.quantity });
  }
  const withoutHistory: string[] = [];
  if (ym > monthOf(today)) {
    const positions = computePositions(data.assets, data.operations).filter((p) => p.quantity > 0);
    for (const p of positions) {
      if (hasRowThisMonth.has(p.asset.id)) continue;
      const est = estimateForAsset(data, p.asset, p.quantity, ym);
      if (!est) withoutHistory.push(p.asset.ticker);
      else items.push({ assetId: p.asset.id, ticker: p.asset.ticker, date: est.date, cents: est.cents, official: false, kind: 'estimativa', quantity: p.quantity, note: est.note });
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date));
  const officialCents = items.filter((i) => i.official).reduce((s, i) => s + i.cents, 0);
  const estimatedCents = items.filter((i) => !i.official).reduce((s, i) => s + i.cents, 0);
  return { ym, officialCents, estimatedCents, totalCents: officialCents + estimatedCents, items, withoutHistory };
}

function estimateForAsset(data: AppData, asset: Asset, qty: number, ym: YearMonth): { cents: Cents; date: ISODate; note: string } | null {
  const evs = data.dividends.filter((e) => e.assetId === asset.id && !e.cancelledAt && (e.paymentDate ?? e.exDate) && e.kind !== 'amortizacao');
  // valor líquido por cota somado por mês de pagamento
  const perMonth = new Map<YearMonth, { perUnit: number; lastDay: number }>();
  for (const e of evs) {
    const ref = (e.paymentDate ?? e.exDate)!;
    const m = monthOf(ref);
    if (m >= ym || m < addMonthsYM(ym, -12)) continue;
    const cur = perMonth.get(m) ?? { perUnit: 0, lastDay: 1 };
    cur.perUnit += e.ratePerUnit * netFactor(e);
    cur.lastDay = Math.max(cur.lastDay, Number(ref.slice(8, 10)));
    perMonth.set(m, cur);
  }
  if (perMonth.size === 0) return null;
  const last6 = [...perMonth.keys()].filter((m) => m >= addMonthsYM(ym, -6)).sort();
  if (asset.type === 'fii' || last6.length >= 4) {
    if (last6.length < 2) return null;
    const take = last6.slice(-3);
    const avg = take.reduce((s, m) => s + perMonth.get(m)!.perUnit, 0) / take.length;
    const day = perMonth.get(take[take.length - 1])!.lastDay;
    return { cents: roundHalfAway(avg * qty * 100), date: makeDate(ym, day), note: `média dos últimos ${take.length} pagamentos` };
  }
  const same = perMonth.get(addMonthsYM(ym, -12));
  if (same) return { cents: roundHalfAway(same.perUnit * qty * 100), date: makeDate(ym, same.lastDay), note: 'mesmo mês do ano anterior' };
  return null;
}

export interface AssetDividendSummary {
  assetId: string;
  receivedCents: Cents; // confirmado (líquido)
  pendingCents: Cents; // a receber, ainda sem confirmação (líquido)
  lastPayment?: DividendRow;
  nextPayment?: DividendRow;
  count: number;
}

export function assetDividendSummaries(data: AppData, today: ISODate): Map<string, AssetDividendSummary> {
  const map = new Map<string, AssetDividendSummary>();
  for (const r of dividendRows(data, today)) {
    const s = map.get(r.asset.id) ?? { assetId: r.asset.id, receivedCents: 0, pendingCents: 0, count: 0 };
    if (isReceived(r)) {
      s.receivedCents += r.netCents;
      s.count++;
      if (!s.lastPayment || r.event.receivedAt! > s.lastPayment.event.receivedAt!) s.lastPayment = r;
    } else if (isPending(r)) {
      s.pendingCents += r.netCents;
      const pd = r.event.paymentDate;
      if (pd && pd >= today && (!s.nextPayment || pd < s.nextPayment.event.paymentDate!)) s.nextPayment = r;
    }
    map.set(r.asset.id, s);
  }
  return map;
}

export interface MergeResult {
  toUpsert: DividendEvent[]; // novos + atualizados
  added: DividendEvent[]; // proventos que não existiam
  dateAnnounced: DividendEvent[]; // já existiam sem data de pagamento e agora têm
  changed: { event: DividendEvent; text: string }[]; // a fonte corrigiu valor ou data
  missing: DividendEvent[]; // a fonte deixou de trazer (pode ter sido cancelado ou corrigido)
}

const fmtR = (v: number) => 'R$ ' + v.toFixed(8).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
const fmtD = (d?: string) => (d ? d.split('-').reverse().join('/') : '—');

/**
 * Junta os proventos baixados da fonte aos já salvos, sem duplicar e sem apagar nada.
 * - O que você digitou prevalece; o que você já confirmou não tem o valor mudado (só ganha uma anotação).
 * - Valor por cota corrigido para a mesma data-com: atualiza e guarda a correção no histórico.
 * - Data de pagamento mudou: atualiza e guarda a correção.
 * - Sumiu da fonte (ativos consultados com sucesso, último ano): marca "não encontrado na fonte" e pede conferência. Não cancela sozinho.
 */
export function mergeEvents(existing: DividendEvent[], incoming: DividendEvent[], opts: { coveredAssetIds?: string[]; sourceName?: string; now?: string; today?: ISODate } = {}): MergeResult {
  const now = opts.now ?? new Date().toISOString();
  const src = opts.sourceName ?? incoming[0]?.sourceName ?? 'fonte';
  const byKey = new Map(existing.map((e) => [e.key, e]));
  const res: MergeResult = { toUpsert: [], added: [], dateAnnounced: [], changed: [], missing: [] };
  const seen = new Set<string>();
  const put = (e: DividendEvent) => {
    const i = res.toUpsert.findIndex((x) => x.id === e.id);
    if (i >= 0) res.toUpsert[i] = e;
    else res.toUpsert.push(e);
    byKey.set(e.key, e);
  };
  const revise = (e: DividendEvent, text: string): DividendEvent => ({ ...e, revisions: [...(e.revisions ?? []), { at: now, source: src, text }] });

  for (const inc of incoming) {
    let cur = byKey.get(inc.key);
    if (!cur && inc.dataCom) {
      // mesmo ativo, tipo e data-com, valor diferente: é correção, não provento novo
      cur = [...byKey.values()].find((e) => e.assetId === inc.assetId && e.kind === inc.kind && e.dataCom === inc.dataCom && e.source !== 'manual' && !e.cancelledAt && Math.abs(e.ratePerUnit - inc.ratePerUnit) > 1e-9);
      if (cur) {
        seen.add(cur.id);
        const text = `valor por cota ${fmtR(cur.ratePerUnit)} → ${fmtR(inc.ratePerUnit)}`;
        if (cur.receivedAt) {
          // já confirmado: o registro financeiro não muda; só anota o que a fonte diz agora
          if (!(cur.revisions ?? []).some((r) => r.text.includes(fmtR(inc.ratePerUnit)))) put(revise(cur, `fonte informa ${text} (já confirmado, mantido)`));
          continue;
        }
        const upd = revise({ ...cur, ratePerUnit: inc.ratePerUnit, key: inc.key, paymentDate: inc.paymentDate ?? cur.paymentDate, official: inc.official, missingSince: undefined }, text);
        byKey.delete(cur.key);
        put(upd);
        res.changed.push({ event: upd, text });
        continue;
      }
    }
    if (!cur) {
      put(inc);
      res.added.push(inc);
      seen.add(inc.id);
      continue;
    }
    seen.add(cur.id);
    if (cur.source === 'manual') continue; // o que o usuário digitou prevalece
    let next: DividendEvent = cur;
    if (cur.missingSince) next = revise({ ...next, missingSince: undefined }, 'voltou a aparecer na fonte');
    const payChanged = cur.paymentDate !== inc.paymentDate && !!inc.paymentDate;
    const otherChanged = cur.official !== inc.official || cur.exDate !== inc.exDate || cur.approvedOn !== inc.approvedOn;
    if (!payChanged && !otherChanged && next === cur) continue;
    next = { ...next, paymentDate: inc.paymentDate ?? cur.paymentDate, official: inc.official, exDate: inc.exDate ?? cur.exDate, approvedOn: inc.approvedOn ?? cur.approvedOn };
    if (payChanged && cur.paymentDate) {
      const text = `data de pagamento ${fmtD(cur.paymentDate)} → ${fmtD(inc.paymentDate)}`;
      next = revise(next, text);
      res.changed.push({ event: next, text });
    }
    if (!cur.paymentDate && inc.paymentDate) res.dateAnnounced.push(next);
    put(next);
  }

  if (opts.coveredAssetIds?.length) {
    const covered = new Set(opts.coveredAssetIds);
    const today = opts.today ?? now.slice(0, 10);
    const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
    for (const e of existing) {
      if (seen.has(e.id) || !covered.has(e.assetId) || e.source === 'manual' || e.cancelledAt || e.receivedAt || e.missingSince) continue;
      if (opts.sourceName && e.sourceName !== opts.sourceName) continue;
      const ref = e.dataCom ?? e.exDate ?? e.paymentDate;
      if (!ref || ref < yearAgo) continue;
      const upd = revise({ ...e, missingSince: now }, `não aparece mais em ${src}: confira se foi cancelado ou corrigido`);
      put(upd);
      res.missing.push(upd);
    }
  }
  return res;
}

/** Cancela (pela fonte ou por você). Nada é apagado: o evento continua no histórico, fora dos totais. */
export function cancelEvent(e: DividendEvent, reason: string, now = new Date().toISOString()): DividendEvent {
  return { ...e, cancelledAt: now, cancelReason: reason, missingSince: undefined, revisions: [...(e.revisions ?? []), { at: now, source: reason === 'usuario' ? 'você' : reason, text: 'cancelado' }] };
}
export function reactivateEvent(e: DividendEvent, now = new Date().toISOString()): DividendEvent {
  return { ...e, cancelledAt: undefined, cancelReason: undefined, revisions: [...(e.revisions ?? []), { at: now, source: 'você', text: 'reativado' }] };
}
