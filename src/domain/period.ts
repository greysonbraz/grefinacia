import { addDays, monthOf } from '../lib/dates';
import type { AppData, ISODate, Transaction } from '../lib/types';

export type Period = '' | '7' | '30' | '90' | 'custom';

/** Intervalo de datas do filtro de período (inclusive). '' = sem período (vale o mês escolhido). */
export function periodRange(p: Period, today: ISODate, from?: ISODate, to?: ISODate): { from: ISODate; to: ISODate } | null {
  if (!p) return null;
  if (p === 'custom') {
    if (!from || !to) return null;
    return from <= to ? { from, to } : { from: to, to: from };
  }
  return { from: addDays(today, -(Number(p) - 1)), to: today };
}

export const PERIOD_LABEL: Record<Exclude<Period, ''>, string> = { '7': 'Últimos 7 dias', '30': 'Últimos 30 dias', '90': 'Últimos 90 dias', custom: 'Período escolhido' };

/** Para a tela de detalhe: lançamentos parecidos (mesma descrição, sem diferenciar maiúsculas) e o total da categoria no mês. */
export function txContext(data: AppData, t: Transaction): { similar: Transaction[]; categoryMonthCents: number; categoryMonthCount: number } {
  const key = t.description.trim().toLowerCase();
  const similar = data.transactions
    .filter((x) => x.id !== t.id && x.type === t.type && x.description.trim().toLowerCase() === key)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6);
  const ym = monthOf(t.date);
  const same = data.transactions.filter((x) => x.type === t.type && x.categoryId === t.categoryId && monthOf(x.date) === ym);
  return { similar, categoryMonthCents: same.reduce((s, x) => s + x.amountCents, 0), categoryMonthCount: same.length };
}
