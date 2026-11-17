import type { AppData, Cents, ISODate, YearMonth } from '../lib/types';
import { addMonthsYM, daysInMonth, monthOf } from '../lib/dates';
import { cashForecast } from './analysis';

/**
 * Tela inicial (Etapa 13): o gasto do mês dia a dia, comparado ao mês passado, e a previsão do mês que vem.
 * Gasto = despesas pela data da compra/lançamento (compras no cartão contam no dia da compra, não no da fatura).
 */

/** Gasto acumulado em cada dia do mês (índice 0 = dia 1). Até `uptoDay` quando informado. */
export function cumulativeSpending(data: AppData, ym: YearMonth, uptoDay?: number): Cents[] {
  const n = Math.min(uptoDay ?? daysInMonth(ym), daysInMonth(ym));
  const perDay = new Array<number>(n).fill(0);
  for (const t of data.transactions) {
    if (t.type !== 'expense' || monthOf(t.date) !== ym) continue;
    const d = Number(t.date.slice(8, 10));
    if (d >= 1 && d <= n) perDay[d - 1] += t.amountCents;
  }
  let acc = 0;
  return perDay.map((v) => (acc += v));
}

export interface CategorySlice { categoryId: string; cents: Cents; pct: number }
/** Maiores categorias de gasto do mês (as demais somadas em "outras"). */
export function topCategories(data: AppData, ym: YearMonth, max = 5): { items: CategorySlice[]; otherCents: Cents; totalCents: Cents } {
  const by: Record<string, number> = {};
  for (const t of data.transactions) if (t.type === 'expense' && monthOf(t.date) === ym) by[t.categoryId] = (by[t.categoryId] ?? 0) + t.amountCents;
  const ents = Object.entries(by).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const total = ents.reduce((s, [, v]) => s + v, 0);
  const pct = (v: number) => (total ? (v / total) * 100 : 0);
  return {
    items: ents.slice(0, max).map(([categoryId, cents]) => ({ categoryId, cents, pct: pct(cents) })),
    otherCents: ents.slice(max).reduce((s, [, v]) => s + v, 0),
    totalCents: total,
  };
}

export interface MonthPace {
  spentCents: Cents; // até hoje
  lastMonthSameDayCents: Cents; // mês passado até o mesmo dia
  lastMonthTotalCents: Cents;
  /** Estimativa do mês inteiro: o já gasto + contas a vencer no mês + o que falta do gasto do dia a dia (média de 3 meses). */
  projectedCents: Cents;
  day: number;
  days: number;
}
export function monthPace(data: AppData, today: ISODate): MonthPace {
  const ym = monthOf(today);
  const prev = addMonthsYM(ym, -1);
  const day = Number(today.slice(8, 10));
  const cur = cumulativeSpending(data, ym, day);
  const last = cumulativeSpending(data, prev);
  const spent = cur[cur.length - 1] ?? 0;
  const f = cashForecast(data, today, 1).months[0];
  // ainda vem neste mês: lançamentos com data depois de hoje e recorrências que ainda não viraram lançamento
  const futureThisMonth = data.transactions.filter((t) => t.type === 'expense' && monthOf(t.date) === ym && Number(t.date.slice(8, 10)) > day).reduce((s, t) => s + t.amountCents, 0);
  const made = new Set(data.transactions.filter((t) => t.recurrenceId).map((t) => `${t.recurrenceId}|${t.recurrenceMonth}`));
  const recurring = data.recurrences
    .filter((r) => r.type === 'expense' && r.active && r.startMonth <= ym && (!r.endMonth || r.endMonth >= ym) && !r.skipMonths?.includes(ym) && !made.has(`${r.id}|${ym}`))
    .reduce((s, r) => s + r.amountCents, 0);
  const projected = spent + futureThisMonth + recurring + (f?.variableCents ?? 0);
  return {
    spentCents: spent,
    lastMonthSameDayCents: last[Math.min(day, last.length) - 1] ?? 0,
    lastMonthTotalCents: last[last.length - 1] ?? 0,
    projectedCents: Math.max(projected, spent),
    day,
    days: daysInMonth(ym),
  };
}

export interface NextMonth {
  ym: YearMonth;
  incomeCents: Cents; // salário e receitas lançadas/recorrentes
  billsCents: Cents; // contas lançadas ou recorrentes (inclui faturas e parcelas já lançadas)
  debtCents: Cents; // parcelas de dívidas
  dailyCents: Cents; // gasto do dia a dia estimado (média dos 3 últimos meses fechados)
  netCents: Cents;
  endBalanceCents: Cents; // saldo previsto nas contas no fim do mês que vem
  basisMonths: number; // quantos meses fechados entraram na média
}
export function nextMonthForecast(data: AppData, today: ISODate): NextMonth {
  const f = cashForecast(data, today, 2);
  const m = f.months[1];
  return { ym: m.ym, incomeCents: m.incomeCents, billsCents: m.fixedCents, debtCents: m.debtCents, dailyCents: m.variableCents, netCents: m.netCents, endBalanceCents: m.endBalanceCents, basisMonths: f.variableBasisMonths };
}
