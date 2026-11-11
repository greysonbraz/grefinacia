import type { AppData, Cents, ISODate, Settings, YearMonth } from '../lib/types';
import { addMonthsYM, endOfMonth, lastMonths, monthOf } from '../lib/dates';
import { monthSummary } from './ledger';
import { netWorthAt } from './networth';
import { dividendRows } from './dividends';
import { debtTotals } from './debts';

export interface Closing {
  ym: YearMonth;
  receivedCents: Cents;
  spentCents: Cents;
  savedCents: Cents; // receitas − despesas
  reservedCents: Cents; // depósitos líquidos em reservas
  investedCents: Cents;
  interestPaidCents: Cents; // despesas na categoria "Juros e encargos"
  debtPaymentsCents: Cents; // despesas na categoria "Dívidas e empréstimos"
  debtRemainingCents: Cents; // saldo devedor atual cadastrado
  netWorthStartCents: Cents;
  netWorthEndCents: Cents;
  netWorthChangeCents: Cents;
  dividendsCents: Cents;
  resultCents: Cents;
}

/** Fechamento financeiro do mês. Organização pessoal — não substitui contador habilitado. */
export function monthlyClosing(data: AppData, ym: YearMonth, today: ISODate): Closing {
  const s = monthSummary(data, ym);
  const end = ym === monthOf(today) ? today : endOfMonth(ym);
  const start = endOfMonth(addMonthsYM(ym, -1));
  const nwEnd = netWorthAt(data, end, today).totalCents;
  const nwStart = netWorthAt(data, start, today).totalCents;
  const debt = debtTotals(data.debts).balanceCents;
  const dividends = dividendRows(data, today).filter((r) => r.event.paymentDate && monthOf(r.event.paymentDate) === ym && r.event.paymentDate <= today).reduce((t, r) => t + r.netCents, 0);
  return {
    ym,
    receivedCents: s.incomeCents,
    spentCents: s.expenseCents,
    savedCents: s.netCents,
    reservedCents: s.savedCents,
    investedCents: s.investedCents,
    interestPaidCents: s.byCategory['juros'] ?? 0,
    debtPaymentsCents: s.byCategory['dividas'] ?? 0,
    debtRemainingCents: debt,
    netWorthStartCents: nwStart,
    netWorthEndCents: nwEnd,
    netWorthChangeCents: nwEnd - nwStart,
    dividendsCents: dividends,
    resultCents: s.netCents,
  };
}

export interface Freedom {
  netWorthCents: Cents;
  passiveMonthlyCents: Cents; // média mensal de proventos líquidos dos últimos 12 meses
  expensesMonthlyCents: Cents; // média das despesas dos últimos 3 meses fechados (ou do mês atual)
  coveragePct: number;
  requiredCents: Cents | null; // patrimônio que renderia as despesas à taxa assumida
  progressPct: number | null;
}

export function financialFreedom(data: AppData, settings: Settings, today: ISODate): Freedom {
  const ym = monthOf(today);
  const from = addMonthsYM(ym, -12);
  const passive12 = dividendRows(data, today).filter((r) => r.event.paymentDate && r.event.paymentDate <= today && monthOf(r.event.paymentDate) > from).reduce((t, r) => t + r.netCents, 0);
  const prev = lastMonths(addMonthsYM(ym, -1), 3).map((m) => monthSummary(data, m).expenseCents).filter((v) => v > 0);
  const expenses = prev.length > 0 ? Math.round(prev.reduce((a, b) => a + b, 0) / prev.length) : monthSummary(data, ym).expenseCents;
  const passive = Math.round(passive12 / 12);
  const nw = netWorthAt(data, today, today).totalCents - debtTotals(data.debts).balanceCents;
  const y = settings.freedom.yieldPct;
  const required = y > 0 && expenses > 0 ? Math.round((expenses * 12) / (y / 100)) : null;
  return { netWorthCents: nw, passiveMonthlyCents: passive, expensesMonthlyCents: expenses, coveragePct: expenses > 0 ? (passive / expenses) * 100 : 0, requiredCents: required, progressPct: required ? Math.max((nw / required) * 100, 0) : null };
}

/** Proventos líquidos pagos por mês (renda passiva). */
export function passiveIncomeSeries(data: AppData, months: number, today: ISODate): { ym: YearMonth; cents: Cents }[] {
  const rows = dividendRows(data, today).filter((r) => r.event.paymentDate && r.event.paymentDate <= today);
  return lastMonths(monthOf(today), months).map((ym) => ({ ym, cents: rows.filter((r) => monthOf(r.event.paymentDate!) === ym).reduce((t, r) => t + r.netCents, 0) }));
}
