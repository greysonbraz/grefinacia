import type { AppData, Asset, Cents, DividendEvent, ISODate, YearMonth } from '../lib/types';
import { addMonthsYM, makeDate, monthOf } from '../lib/dates';
import { roundHalfAway } from '../lib/money';
import { computePositions, quantityAt } from './portfolio';

/** Imposto de renda retido na fonte sobre JCP (15%). Dividendos de ações e rendimentos de FIIs são isentos para pessoa física. */
export const JCP_TAX = 0.15;

export type DividendStatus = 'recebido' | 'a_confirmar' | 'agendado' | 'sem_data';

export interface DividendRow {
  event: DividendEvent;
  asset: Asset;
  quantity: number;
  grossCents: Cents;
  netCents: Cents;
  status: DividendStatus;
}

export const netFactor = (e: DividendEvent): number => (e.kind === 'jcp' ? 1 - JCP_TAX : 1);

/** Identidade de um provento (a data de pagamento fica de fora: ela pode ser divulgada depois). */
export function makeEventKey(ticker: string, kind: string, dataCom: string | undefined, rate: number): string {
  return [ticker.toUpperCase(), kind, dataCom ?? '', rate.toFixed(8)].join('|');
}

/** Valor que o usuário tem direito: valor por cota × quantidade que possuía no fim da data-com. Eventos sem direito são ignorados. */
export function dividendRows(data: AppData, today: ISODate): DividendRow[] {
  const rows: DividendRow[] = [];
  for (const e of data.dividends) {
    const asset = data.assets.find((a) => a.id === e.assetId);
    if (!asset) continue;
    const ref = e.dataCom ?? e.paymentDate ?? today;
    const quantity = e.quantityOverride ?? quantityAt(data.operations, e.assetId, ref);
    if (quantity <= 0) continue;
    const grossCents = roundHalfAway(e.ratePerUnit * quantity * 100);
    const netCents = e.kind === 'jcp' ? roundHalfAway(grossCents * (1 - JCP_TAX)) : grossCents;
    let status: DividendStatus;
    if (e.receivedAt) status = 'recebido';
    else if (!e.paymentDate) status = 'sem_data';
    else status = e.paymentDate <= today ? 'a_confirmar' : 'agendado';
    rows.push({ event: e, asset, quantity, grossCents, netCents, status });
  }
  return rows.sort((a, b) => (b.event.paymentDate ?? b.event.dataCom ?? '').localeCompare(a.event.paymentDate ?? a.event.dataCom ?? ''));
}

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
  const evs = data.dividends.filter((e) => e.assetId === asset.id && (e.paymentDate ?? e.exDate) && e.kind !== 'amortizacao');
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
  receivedCents: Cents; // pago até hoje (líquido)
  lastPayment?: DividendRow;
  nextPayment?: DividendRow;
  count: number;
}

export function assetDividendSummaries(data: AppData, today: ISODate): Map<string, AssetDividendSummary> {
  const map = new Map<string, AssetDividendSummary>();
  for (const r of dividendRows(data, today)) {
    const s = map.get(r.asset.id) ?? { assetId: r.asset.id, receivedCents: 0, count: 0 };
    const pd = r.event.paymentDate;
    if (pd && pd <= today) {
      s.receivedCents += r.netCents;
      s.count++;
      if (!s.lastPayment || pd > s.lastPayment.event.paymentDate!) s.lastPayment = r;
    } else if (pd && (!s.nextPayment || pd < s.nextPayment.event.paymentDate!)) {
      s.nextPayment = r;
    }
    map.set(r.asset.id, s);
  }
  return map;
}

export interface MergeResult {
  toUpsert: DividendEvent[]; // novos + atualizados
  added: DividendEvent[]; // proventos que não existiam
  dateAnnounced: DividendEvent[]; // já existiam sem data de pagamento e agora têm
}

/** Junta os proventos baixados da API aos já salvos, sem duplicar e preservando o que o usuário já confirmou. */
export function mergeEvents(existing: DividendEvent[], incoming: DividendEvent[]): MergeResult {
  const byKey = new Map(existing.map((e) => [e.key, e]));
  const res: MergeResult = { toUpsert: [], added: [], dateAnnounced: [] };
  for (const inc of incoming) {
    const cur = byKey.get(inc.key);
    if (!cur) {
      res.toUpsert.push(inc);
      res.added.push(inc);
      byKey.set(inc.key, inc);
      continue;
    }
    if (cur.source === 'manual') continue; // o que o usuário digitou prevalece
    const changed = cur.paymentDate !== inc.paymentDate || cur.official !== inc.official || cur.exDate !== inc.exDate || cur.approvedOn !== inc.approvedOn;
    if (!changed) continue;
    const merged = { ...cur, paymentDate: inc.paymentDate, official: inc.official, exDate: inc.exDate, approvedOn: inc.approvedOn };
    if (!cur.paymentDate && inc.paymentDate) res.dateAnnounced.push(merged);
    res.toUpsert.push(merged);
  }
  return res;
}
