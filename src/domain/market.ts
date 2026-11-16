import type { HistoryPoint, ISODate, MarketHistory } from '../lib/types';
import { addDays, addMonths, daysInMonth, diffDays, monthOf, toISO } from '../lib/dates';
import { roundQty, sortedOps, type InvestOp } from './portfolio';

// ============================ HISTÓRICO GUARDADO ============================

export const historyId = (kind: MarketHistory['kind'], symbol: string): string => `${kind}:${symbol}`;

/** Limite de pontos por série (≈ 20 anos de pregões): o histórico cresce, mas não sem fim. */
export const MAX_POINTS = 5000;

/** Junta pontos novos aos guardados. Na mesma data vale o novo (um fechamento corrige a cotação do meio do dia). */
export function mergePoints(old: HistoryPoint[], add: HistoryPoint[]): HistoryPoint[] {
  const map = new Map<ISODate, number>();
  for (const [d, v] of old) map.set(d, v);
  for (const [d, v] of add) if (/^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(v)) map.set(d, v);
  const out = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return out.slice(Math.max(out.length - MAX_POINTS, 0));
}

/** Valor do último ponto até a data (inclusive), ou null se a série ainda não começou. */
export function valueAt(points: HistoryPoint[], date: ISODate): number | null {
  let lo = 0, hi = points.length - 1, ans: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid][0] <= date) {
      ans = points[mid][1];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Recorte da série entre duas datas (inclusive). */
export const pointsBetween = (points: HistoryPoint[], from: ISODate, to: ISODate): HistoryPoint[] => points.filter(([d]) => d >= from && d <= to);

// ============================ IDADE DA COTAÇÃO ============================

export interface Freshness {
  tone: 'ok' | 'warn' | 'old';
  /** "há 25 min", "há 3 h", "há 2 dias" */
  age: string;
  minutes: number;
}

/**
 * Quanto tempo tem a cotação. Até 1 hora é o atraso normal das fontes gratuitas;
 * até 4 dias cobre fim de semana e feriado; mais que isso, o preço provavelmente está velho.
 */
export function quoteFreshness(time: string, now: Date = new Date()): Freshness {
  const t = Date.parse(time);
  const minutes = Number.isFinite(t) ? Math.max(0, Math.round((now.getTime() - t) / 60000)) : Infinity;
  const tone: Freshness['tone'] = minutes <= 60 ? 'ok' : minutes < 4 * 24 * 60 ? 'warn' : 'old';
  let age: string;
  if (!Number.isFinite(minutes)) age = 'horário desconhecido';
  else if (minutes < 1) age = 'agora';
  else if (minutes < 60) age = `há ${minutes} min`;
  else if (minutes < 48 * 60) age = `há ${Math.floor(minutes / 60)} h`;
  else age = `há ${Math.floor(minutes / 1440)} dias`;
  return { tone, age, minutes };
}

// ============================ DESEMPENHO ============================

export type Period = '1m' | '3m' | '6m' | '1a' | 'tudo';
export const PERIOD_LABEL: Record<Period, string> = { '1m': '1 mês', '3m': '3 m', '6m': '6 m', '1a': '1 ano', tudo: 'Tudo' };

export function periodStart(period: Period, today: ISODate, firstOp: ISODate | undefined): ISODate {
  const months = { '1m': 1, '3m': 3, '6m': 6, '1a': 12 } as const;
  const start = period === 'tudo' ? (firstOp ?? today) : addMonths(today, -months[period]);
  return firstOp && start < firstOp ? firstOp : start;
}

export interface PerfPoint {
  date: ISODate;
  valueCents: number;
  pct: number; // rentabilidade acumulada desde o início do período (%)
}
export interface Performance {
  start: ISODate;
  end: ISODate;
  points: PerfPoint[];
  pct: number | null; // null quando não há carteira no período
  /** Ativos que ficaram sem preço em algum dia (usou o preço da última operação). */
  estimated: string[];
}

/**
 * Rentabilidade da carteira por cotas (método usado pelos fundos): compras e vendas não contam como ganho.
 * Em cada dia: retorno = (valor do dia − dinheiro que entrou no dia) ÷ valor do dia anterior.
 * Dias sem fechamento usam o último preço conhecido; antes do primeiro fechamento, o preço da operação.
 */
export function portfolioPerformance(ops: InvestOp[], prices: Record<string, HistoryPoint[]>, from: ISODate, to: ISODate): Performance {
  const sorted = sortedOps(ops.filter((o) => o.date <= to));
  // preços de operações servem de ponto de partida para ativos sem fechamento ainda
  const series: Record<string, HistoryPoint[]> = {};
  for (const o of sorted) (series[o.assetId] ??= []).push([o.date, o.priceCents]);
  for (const id of Object.keys(series)) series[id] = mergePoints(series[id], prices[id] ?? []);

  // dias de cálculo: pregões e dias com operação, dentro do período
  const days = new Set<ISODate>([from, to]);
  for (const id of Object.keys(series)) for (const [d] of pointsBetween(series[id], from, to)) days.add(d);
  for (const o of sorted) if (o.date >= from) days.add(o.date);
  const dates = [...days].sort();

  const qty = new Map<string, number>();
  let i = 0;
  const estimated = new Set<string>();
  const applyUntil = (d: ISODate, flows: { v: number }) => {
    while (i < sorted.length && sorted[i].date <= d) {
      const o = sorted[i++];
      const q = qty.get(o.assetId) ?? 0;
      const n = o.side === 'buy' ? o.quantity : Math.min(o.quantity, q);
      qty.set(o.assetId, roundQty(q + (o.side === 'buy' ? n : -n)));
      const gross = n * o.priceCents;
      flows.v += o.side === 'buy' ? gross + o.feesCents : -(gross - o.feesCents);
    }
  };
  const valueOn = (d: ISODate) => {
    let v = 0;
    for (const [id, q] of qty) {
      if (q <= 0) continue;
      const own = prices[id] ? valueAt(prices[id], d) : null;
      if (own === null) estimated.add(id);
      v += q * (own ?? valueAt(series[id], d) ?? 0);
    }
    return v;
  };

  // posição na véspera do período
  applyUntil(addDays(from, -1), { v: 0 });
  let prev = valueOn(addDays(from, -1));
  let index = 1;
  let had = prev > 0;
  const points: PerfPoint[] = [];
  for (const d of dates) {
    const flows = { v: 0 };
    applyUntil(d, flows);
    const value = valueOn(d);
    if (prev > 0) index *= (value - flows.v) / prev;
    if (value > 0) had = true;
    prev = value;
    points.push({ date: d, valueCents: Math.round(value), pct: (index - 1) * 100 });
  }
  return { start: from, end: to, points, pct: had ? (index - 1) * 100 : null, estimated: [...estimated] };
}

// ============================ CDI E IPCA ============================

/**
 * CDI acumulado do fim de `from` até `to` (inclusive), em %. A série do Banco Central traz a taxa de cada dia útil
 * (% ao dia); dias sem dado ainda publicado ficam de fora. `until` é a data do último dado usado.
 */
export function cdiAccumulated(cdi: HistoryPoint[], from: ISODate, to: ISODate): { pct: number; until: ISODate | null } {
  let f = 1;
  let until: ISODate | null = null;
  for (const [d, v] of cdi) {
    if (d <= from || d > to) continue;
    f *= 1 + v / 100;
    until = d;
  }
  return { pct: (f - 1) * 100, until };
}

/**
 * IPCA acumulado entre duas datas, em %. A série é mensal (% no mês, data = dia 1). Meses pela metade entram
 * proporcionalmente aos dias. Meses ainda não divulgados ficam de fora: `until` diz até que mês há dado.
 */
export function ipcaAccumulated(ipca: HistoryPoint[], from: ISODate, to: ISODate): { pct: number; until: string | null } {
  let f = 1;
  let until: string | null = null;
  for (const [d, v] of ipca) {
    const ym = monthOf(d);
    const first = ym + '-01';
    const last = addDays(addMonths(first, 1), -1);
    // dias do mês dentro de (from, to]
    const a = from >= first ? addDays(from, 1) : first;
    const b = to <= last ? to : last;
    if (a > b) continue;
    const share = (diffDays(b, a) + 1) / daysInMonth(ym);
    f *= Math.pow(1 + v / 100, share);
    until = ym;
  }
  return { pct: (f - 1) * 100, until };
}

/** Curva acumulada de um índice em cada data pedida (para desenhar junto da carteira). */
export function benchmarkCurve(kind: 'cdi' | 'ipca', series: HistoryPoint[], from: ISODate, dates: ISODate[]): (number | null)[] {
  const lastData = series.length ? series[series.length - 1][0] : null;
  return dates.map((d) => {
    if (!lastData) return null;
    if (kind === 'cdi') return d > lastData && diffDays(d, lastData) > 7 ? null : cdiAccumulated(series, from, d).pct;
    const r = ipcaAccumulated(series, from, d);
    return r.until && monthOf(d) <= r.until ? r.pct : null;
  });
}

/** Converte "dd/mm/aaaa" (formato do Banco Central) para "aaaa-mm-dd". */
export function bcbDate(s: string): ISODate | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
/** "aaaa-mm-dd" para "dd/mm/aaaa". */
export const toBcbDate = (d: ISODate): string => d.split('-').reverse().join('/');

/** Reduz uma lista longa a no máximo `max` itens, mantendo o primeiro e o último (gráficos leves no celular). */
export function sample<T>(list: T[], max: number): T[] {
  if (list.length <= max) return list;
  const out: T[] = [];
  const step = (list.length - 1) / (max - 1);
  for (let k = 0; k < max; k++) out.push(list[Math.round(k * step)]);
  return out;
}

/** Data local (aaaa-mm-dd) de um horário ISO ou de segundos/milissegundos Unix. */
export function localDate(t: string | number): ISODate {
  const d = typeof t === 'number' ? new Date(t < 1e12 ? t * 1000 : t) : new Date(t);
  return toISO(d);
}
