import type { AppData, Cents, ISODate, YearMonth } from '../lib/types';
import { addDays as addDaysISO, addMonthsYM, daysInMonth, monthOf } from '../lib/dates';
import { cashForecast } from './analysis';
import { costDate, costMonth, effectiveDue, monthSummary, totalBalance } from './ledger';
import { dividendRows } from './dividends';

/**
 * Tela inicial (Etapa 13): o gasto do mês dia a dia, comparado ao mês passado, e a previsão do mês que vem.
 * Gasto = despesas pela data da compra/lançamento (compras no cartão contam no dia da compra, não no da fatura).
 */

/** Gasto acumulado em cada dia do mês (índice 0 = dia 1). Até `uptoDay` quando informado. */
export function cumulativeSpending(data: AppData, ym: YearMonth, uptoDay?: number): Cents[] {
  const n = Math.min(uptoDay ?? daysInMonth(ym), daysInMonth(ym));
  const perDay = new Array<number>(n).fill(0);
  for (const t of data.transactions) {
    if (t.type !== 'expense' || costMonth(t) !== ym) continue;
    const d = Number(costDate(t).slice(8, 10));
    if (d >= 1 && d <= n) perDay[d - 1] += t.amountCents;
  }
  let acc = 0;
  return perDay.map((v) => (acc += v));
}

export interface CategorySlice { categoryId: string; cents: Cents; pct: number }
/** Maiores categorias de gasto do mês (as demais somadas em "outras"). */
export function topCategories(data: AppData, ym: YearMonth, max = 5): { items: CategorySlice[]; otherCents: Cents; totalCents: Cents } {
  const by: Record<string, number> = {};
  for (const t of data.transactions) if (t.type === 'expense' && costMonth(t) === ym) by[t.categoryId] = (by[t.categoryId] ?? 0) + t.amountCents;
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
  const futureThisMonth = data.transactions.filter((t) => t.type === 'expense' && costMonth(t) === ym && Number(costDate(t).slice(8, 10)) > day).reduce((s, t) => s + t.amountCents, 0);
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

/** Compras no cartão feitas neste mês que vão para faturas dos próximos meses (no modo "mês da fatura"). */
export function cardThisMonthToNext(data: AppData, today: ISODate): Cents {
  const ym = monthOf(today);
  return data.transactions.filter((t) => t.type === 'expense' && t.cardId && monthOf(t.date) === ym && costMonth(t) > ym).reduce((s, t) => s + t.amountCents, 0);
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

// ---------- Purple Edition: blocos do Início (só leitura; nenhuma regra financeira nova) ----------

export interface UpcomingItem { id: string; kind: 'conta' | 'fatura' | 'provento'; title: string; date: ISODate; cents: Cents; cardId?: string }

/**
 * Próximos dias: contas a pagar (lançadas ou do cartão, juntas por fatura) e proventos com pagamento previsto.
 * Compras no cartão aparecem como uma linha por fatura, não uma por compra.
 */
export function upcomingItems(data: AppData, today: ISODate, days = 15): UpcomingItem[] {
  const until = addDaysISO(today, days);
  const out: UpcomingItem[] = [];
  const invoices = new Map<string, UpcomingItem>();
  for (const t of data.transactions) {
    if (t.type !== 'expense' || t.status !== 'pending') continue;
    const due = effectiveDue(t);
    if (due < today || due > until) continue;
    if (t.cardId) {
      const k = `${t.cardId}|${due}`;
      const card = data.cards.find((c) => c.id === t.cardId);
      const inv = invoices.get(k) ?? { id: 'inv:' + k, kind: 'fatura' as const, title: `Fatura ${card?.name ?? 'do cartão'}`, date: due, cents: 0, cardId: t.cardId };
      inv.cents += t.amountCents;
      invoices.set(k, inv);
    } else out.push({ id: t.id, kind: 'conta', title: t.description, date: due, cents: t.amountCents });
  }
  out.push(...invoices.values());
  for (const r of dividendRows(data, today)) {
    const pay = r.event.paymentDate;
    if (!pay || pay < today || pay > until) continue;
    if (!['anunciado', 'direito_adquirido', 'pagamento_previsto'].includes(r.status)) continue;
    out.push({ id: 'div:' + r.event.id, kind: 'provento', title: `${r.asset.ticker} · ${r.event.kind === 'jcp' ? 'JCP' : r.event.kind === 'rendimento' ? 'rendimento' : 'dividendo'}`, date: pay, cents: r.netCents });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || b.cents - a.cents);
}

export type Tone = 'good' | 'warn' | 'bad' | 'none';
export interface HealthIndicator { id: 'poupanca' | 'reserva' | 'dividas'; label: string; value: string; tone: Tone; hint: string }

/**
 * Indicadores de saúde financeira com base nos 3 últimos meses fechados (referências usuais de educação financeira):
 * - quanto da renda sobra (meta comum: 20% ou mais);
 * - quantos meses de gastos o dinheiro em contas e reservas cobre (meta comum: 6 meses);
 * - quanto da renda vai para parcelas de dívidas (alerta acima de 30%).
 */
export function healthIndicators(data: AppData, today: ISODate): HealthIndicator[] {
  const ym = monthOf(today);
  const months = [1, 2, 3].map((i) => addMonthsYM(ym, -i));
  const sums = months.map((m) => monthSummary(data, m)).filter((s) => s.incomeCents > 0 || s.expenseCents > 0);
  const n = sums.length;
  const income = n ? sums.reduce((s, x) => s + x.incomeCents, 0) / n : 0;
  const expense = n ? sums.reduce((s, x) => s + x.expenseCents, 0) / n : 0;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const out: HealthIndicator[] = [];
  if (income > 0) {
    const rate = (income - expense) / income;
    out.push({ id: 'poupanca', label: 'Quanto da renda sobra', value: pct(rate), tone: rate >= 0.2 ? 'good' : rate >= 0.05 ? 'warn' : 'bad', hint: `média de ${n} ${n === 1 ? 'mês' : 'meses'}; referência: 20% ou mais` });
  } else out.push({ id: 'poupanca', label: 'Quanto da renda sobra', value: '—', tone: 'none', hint: 'aparece depois de um mês fechado com receitas' });
  const reserve = totalBalance(data) + data.goalMoves.reduce((s, m) => s + m.amountCents, 0);
  if (expense > 0) {
    const m = reserve / expense;
    out.push({ id: 'reserva', label: 'Reserva cobre', value: m >= 0 ? `${m.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${m >= 1 && m < 2 ? 'mês' : 'meses'}` : '0 meses', tone: m >= 6 ? 'good' : m >= 3 ? 'warn' : 'bad', hint: 'de gastos, com o dinheiro em contas e reservas; referência: 6 meses' });
  } else out.push({ id: 'reserva', label: 'Reserva cobre', value: '—', tone: 'none', hint: 'aparece depois de um mês fechado com gastos' });
  const installments = data.debts.filter((d) => d.remainingInstallments > 0).reduce((s, d) => s + d.installmentCents, 0);
  if (income > 0) {
    const load = installments / income;
    out.push({ id: 'dividas', label: 'Parcelas de dívidas', value: pct(load), tone: load <= 0.15 ? 'good' : load <= 0.3 ? 'warn' : 'bad', hint: 'da renda do mês; alerta acima de 30%' });
  }
  return out;
}

export interface AgendaItem { id: string; kind: 'entrada' | 'conta' | 'fatura' | 'provento'; title: string; date: ISODate; cents: Cents; done: boolean }

/**
 * Calendário financeiro do mês: entradas (pela data), contas (pelo vencimento), faturas do cartão (uma por vencimento)
 * e proventos (pela data de pagamento). `done` = já pago/recebido.
 */
export function monthAgenda(data: AppData, ym: YearMonth, today: ISODate): Map<ISODate, AgendaItem[]> {
  const items: AgendaItem[] = [];
  const invoices = new Map<string, AgendaItem>();
  for (const t of data.transactions) {
    if (t.type === 'income') {
      if (monthOf(t.date) === ym) items.push({ id: t.id, kind: 'entrada', title: t.description, date: t.date, cents: t.amountCents, done: t.status === 'paid' });
      continue;
    }
    const due = t.cardId ? t.dueDate ?? t.date : t.status === 'pending' ? effectiveDue(t) : t.paidDate ?? t.date;
    if (monthOf(due) !== ym) continue;
    if (t.cardId) {
      const k = `${t.cardId}|${due}`;
      const card = data.cards.find((c) => c.id === t.cardId);
      const inv = invoices.get(k) ?? { id: 'inv:' + k, kind: 'fatura' as const, title: `Fatura ${card?.name ?? 'do cartão'}`, date: due, cents: 0, done: true };
      inv.cents += t.amountCents;
      inv.done = inv.done && t.status === 'paid';
      invoices.set(k, inv);
    } else if (t.status === 'pending' || ['fixa', 'assinatura', 'parcelada'].includes(t.kind)) {
      // gastos do dia a dia já pagos ficam no extrato; aqui entram contas (pendentes ou de compromisso)
      items.push({ id: t.id, kind: 'conta', title: t.description, date: due, cents: t.amountCents, done: t.status === 'paid' });
    }
  }
  items.push(...invoices.values());
  for (const r of dividendRows(data, today)) {
    const pay = r.event.receivedAt ?? r.event.paymentDate;
    if (!pay || monthOf(pay) !== ym || r.status === 'cancelado') continue;
    items.push({ id: 'div:' + r.event.id, kind: 'provento', title: r.asset.ticker, date: pay, cents: r.netCents, done: r.status === 'pago' });
  }
  const out = new Map<ISODate, AgendaItem[]>();
  for (const it of items.sort((a, b) => a.date.localeCompare(b.date))) out.set(it.date, [...(out.get(it.date) ?? []), it]);
  return out;
}
