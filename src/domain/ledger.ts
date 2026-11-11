import type { AppData, Account, Card, Cents, ISODate, Transaction, YearMonth, Recurrence } from '../lib/types';
import { addMonths, addMonthsYM, makeDate, monthOf, monthRange } from '../lib/dates';
import { uid } from '../lib/ids';

export const isCredit = (t: Transaction): boolean => t.paymentMethod === 'credito' && !!t.cardId;
export const settleDate = (t: Transaction): ISODate => t.paidDate ?? t.date;
export const effectiveDue = (t: Transaction): ISODate => t.dueDate ?? t.date;

/** Fatura e vencimento de uma compra no crédito. Compras até o dia de fechamento entram na fatura do mês. */
export function cardInvoiceDue(card: Card, purchase: ISODate): { invoiceMonth: YearMonth; dueDate: ISODate } {
  const pm = monthOf(purchase);
  const day = Number(purchase.slice(8, 10));
  const invoiceMonth = day <= card.closingDay ? pm : addMonthsYM(pm, 1);
  const dueMonth = card.dueDay > card.closingDay ? invoiceMonth : addMonthsYM(invoiceMonth, 1);
  return { invoiceMonth, dueDate: makeDate(dueMonth, card.dueDay) };
}

/** Saldo de uma conta (movimentos pagos/recebidos a partir da data do saldo inicial). */
export function accountBalance(account: Account, data: AppData, asOf?: ISODate): Cents {
  const inRange = (d: ISODate) => d >= account.initialDate && (!asOf || d <= asOf);
  let b = account.initialCents;
  for (const t of data.transactions) {
    if (t.accountId !== account.id || t.status !== 'paid') continue;
    if (!inRange(settleDate(t))) continue;
    b += t.type === 'income' ? t.amountCents : -t.amountCents;
  }
  for (const m of data.goalMoves) {
    if (m.accountId === account.id && inRange(m.date)) b -= m.amountCents;
  }
  for (const o of data.operations) {
    if (o.accountId !== account.id || !inRange(o.date)) continue;
    const gross = Math.round(o.quantity * o.priceCents);
    b += o.side === 'buy' ? -(gross + o.feesCents) : gross - o.feesCents;
  }
  for (const f of data.fixedIncomes) {
    if (f.accountId === account.id && inRange(f.purchaseDate)) b -= f.investedCents;
  }
  return b;
}

export function totalBalance(data: AppData, asOf?: ISODate): Cents {
  let t = 0;
  for (const a of data.accounts) if (!a.archived) t += accountBalance(a, data, asOf);
  return t;
}

export interface MonthSummary {
  ym: YearMonth;
  incomeCents: Cents;
  expenseCents: Cents;
  incomePaidCents: Cents;
  expensePendingCents: Cents;
  netCents: Cents;
  byCategory: Record<string, Cents>;
  byKind: Record<string, Cents>;
  investedCents: Cents; // aportes em ações/FIIs/renda fixa no mês
  savedCents: Cents; // depósitos líquidos em reservas no mês
}

export function monthSummary(data: AppData, ym: YearMonth): MonthSummary {
  const s: MonthSummary = { ym, incomeCents: 0, expenseCents: 0, incomePaidCents: 0, expensePendingCents: 0, netCents: 0, byCategory: {}, byKind: {}, investedCents: 0, savedCents: 0 };
  for (const t of data.transactions) {
    if (monthOf(t.date) !== ym) continue;
    if (t.type === 'income') {
      s.incomeCents += t.amountCents;
      if (t.status === 'paid') s.incomePaidCents += t.amountCents;
    } else {
      s.expenseCents += t.amountCents;
      if (t.status === 'pending') s.expensePendingCents += t.amountCents;
      s.byCategory[t.categoryId] = (s.byCategory[t.categoryId] ?? 0) + t.amountCents;
      s.byKind[t.kind] = (s.byKind[t.kind] ?? 0) + t.amountCents;
    }
  }
  for (const o of data.operations) {
    if (monthOf(o.date) !== ym) continue;
    const gross = Math.round(o.quantity * o.priceCents);
    s.investedCents += o.side === 'buy' ? gross + o.feesCents : -(gross - o.feesCents);
  }
  for (const f of data.fixedIncomes) if (monthOf(f.purchaseDate) === ym) s.investedCents += f.investedCents;
  for (const m of data.goalMoves) if (monthOf(m.date) === ym) s.savedCents += m.amountCents;
  s.netCents = s.incomeCents - s.expenseCents;
  return s;
}

/** Despesas até o dia `uptoDay` do mês (comparação justa entre mês atual e anterior). */
export function expensesUpToDay(data: AppData, ym: YearMonth, uptoDay: number): Cents {
  let t = 0;
  for (const x of data.transactions) {
    if (x.type === 'expense' && monthOf(x.date) === ym && Number(x.date.slice(8, 10)) <= uptoDay) t += x.amountCents;
  }
  return t;
}

export function overdueBills(data: AppData, today: ISODate): Transaction[] {
  return data.transactions.filter((t) => t.type === 'expense' && t.status === 'pending' && effectiveDue(t) < today).sort((a, b) => effectiveDue(a).localeCompare(effectiveDue(b)));
}

export function upcomingBills(data: AppData, today: ISODate, toDate: ISODate): Transaction[] {
  return data.transactions
    .filter((t) => t.type === 'expense' && t.status === 'pending' && effectiveDue(t) >= today && effectiveDue(t) <= toDate)
    .sort((a, b) => effectiveDue(a).localeCompare(effectiveDue(b)));
}

export interface Invoice {
  cardId: string;
  dueDate: ISODate;
  totalCents: Cents;
  txIds: string[];
}

/** Faturas em aberto (compras no crédito pendentes agrupadas por cartão e vencimento). */
export function openInvoices(data: AppData): Invoice[] {
  const map = new Map<string, Invoice>();
  for (const t of data.transactions) {
    if (!isCredit(t) || t.status !== 'pending') continue;
    const due = effectiveDue(t);
    const k = `${t.cardId}|${due}`;
    const inv = map.get(k) ?? { cardId: t.cardId!, dueDate: due, totalCents: 0, txIds: [] };
    inv.totalCents += t.amountCents;
    inv.txIds.push(t.id);
    map.set(k, inv);
  }
  return [...map.values()].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** Gera as ocorrências mensais (assinaturas, despesas fixas, salário) que ainda não existem, até o mês seguinte. */
export function materializeRecurrences(data: AppData, today: ISODate): Transaction[] {
  const horizon = addMonthsYM(monthOf(today), 1);
  const existing = new Set(data.transactions.filter((t) => t.recurrenceId).map((t) => `${t.recurrenceId}|${t.recurrenceMonth}`));
  const out: Transaction[] = [];
  for (const r of data.recurrences) {
    if (!r.active) continue;
    const end = r.endMonth && r.endMonth < horizon ? r.endMonth : horizon;
    if (r.startMonth > end) continue;
    for (const ym of monthRange(r.startMonth, end)) {
      if (existing.has(`${r.id}|${ym}`) || r.skipMonths?.includes(ym)) continue;
      out.push(transactionFromRecurrence(r, ym, data.cards));
    }
  }
  return out;
}

export function transactionFromRecurrence(r: Recurrence, ym: YearMonth, cards: Card[]): Transaction {
  const date = makeDate(ym, r.dayOfMonth);
  const card = r.cardId ? cards.find((c) => c.id === r.cardId) : undefined;
  const credit = r.paymentMethod === 'credito' && card;
  return {
    id: uid('t_'),
    type: r.type,
    kind: r.kind,
    description: r.description,
    amountCents: r.amountCents,
    categoryId: r.categoryId,
    date,
    dueDate: r.type === 'expense' ? (credit ? cardInvoiceDue(card!, date).dueDate : date) : undefined,
    paymentMethod: r.paymentMethod,
    accountId: credit ? undefined : r.accountId,
    cardId: credit ? r.cardId : undefined,
    status: 'pending',
    recurrenceId: r.id,
    recurrenceMonth: ym,
    source: r.source,
    createdAt: Date.now(),
  };
}

/** Cria as parcelas de uma compra parcelada. Cada parcela vence um mês depois da anterior. */
export function buildInstallments(base: Omit<Transaction, 'id' | 'date' | 'installment' | 'createdAt' | 'dueDate' | 'status'>, installmentCents: Cents, total: number, firstDate: ISODate, card?: Card): Transaction[] {
  const groupId = uid('g_');
  const out: Transaction[] = [];
  for (let i = 0; i < total; i++) {
    const date = addMonths(firstDate, i);
    const credit = base.paymentMethod === 'credito' && card;
    out.push({
      ...base,
      id: uid('t_'),
      amountCents: installmentCents,
      date,
      dueDate: credit ? cardInvoiceDue(card!, date).dueDate : date,
      status: 'pending',
      cardId: credit ? card!.id : undefined,
      accountId: credit ? undefined : base.accountId,
      installment: { groupId, number: i + 1, total },
      description: `${base.description} (${i + 1}/${total})`,
      createdAt: Date.now() + i,
    });
  }
  return out;
}

/** Saldo projetado até o fim do mês: saldo atual + receitas pendentes − despesas pendentes com vencimento no mês. */
export function projectedMonthEndBalance(data: AppData, today: ISODate): Cents {
  const ym = monthOf(today);
  let b = totalBalance(data);
  for (const t of data.transactions) {
    if (t.status !== 'pending') continue;
    const d = t.type === 'expense' ? effectiveDue(t) : t.date;
    if (monthOf(d) !== ym) continue;
    b += t.type === 'income' ? t.amountCents : -t.amountCents;
  }
  // contas vencidas de meses anteriores também precisam ser pagas
  for (const t of data.transactions) {
    if (t.type === 'expense' && t.status === 'pending' && effectiveDue(t) < makeDate(ym, 1)) b -= t.amountCents;
  }
  return b;
}
