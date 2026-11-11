import type { AppData, Cents, ISODate, Settings, Transaction, YearMonth } from '../lib/types';
import { addDays, addMonthsYM, endOfMonth, monthOf } from '../lib/dates';
import { monthSummary, overdueBills, projectedMonthEndBalance, totalBalance, upcomingBills, type MonthSummary } from './ledger';
import { portfolioFromData, type Position, type PortfolioTotals } from './portfolio';
import { netWorthAt, type NetWorth } from './networth';
import { spendableView, type SpendableView } from './salary';
import { dividendRows, forecastMonth, type DividendRow, type Forecast } from './dividends';

export interface BudgetStatus {
  categoryId: string;
  limitCents: Cents;
  spentCents: Cents;
  pct: number;
}

export function budgetStatuses(budgets: Record<string, Cents>, cur: MonthSummary): BudgetStatus[] {
  return Object.entries(budgets)
    .filter(([, limit]) => limit > 0)
    .map(([categoryId, limitCents]) => {
      const spentCents = cur.byCategory[categoryId] ?? 0;
      return { categoryId, limitCents, spentCents, pct: (spentCents / limitCents) * 100 };
    })
    .sort((a, b) => b.pct - a.pct);
}

export interface Overview {
  today: ISODate;
  ym: YearMonth;
  prevYm: YearMonth;
  balanceCents: Cents;
  cur: MonthSummary;
  prev: MonthSummary;
  spend: SpendableView;
  positions: Position[];
  totals: PortfolioTotals;
  netWorth: NetWorth;
  netWorthPrevCents: Cents | null;
  overdue: Transaction[];
  dueSoon: Transaction[];
  projectedEndBalanceCents: Cents;
  nextForecast: Forecast;
  toConfirmDividends: DividendRow[];
  salaryPending?: Transaction;
  budgets: BudgetStatus[];
  debtCents: Cents;
  goalsCents: Cents;
}

export function computeOverview(data: AppData, settings: Settings, today: ISODate): Overview {
  const ym = monthOf(today);
  const prevYm = addMonthsYM(ym, -1);
  const cur = monthSummary(data, ym);
  const prev = monthSummary(data, prevYm);
  const { positions, totals } = portfolioFromData(data);
  const netWorth = netWorthAt(data, today, today);
  const prevEnd = endOfMonth(prevYm);
  const hasHistory = data.accounts.some((a) => a.initialDate <= prevEnd) || data.operations.some((o) => o.date <= prevEnd);
  const netWorthPrevCents = hasHistory ? netWorthAt(data, prevEnd, today).totalCents : null;
  const salaryPending = data.transactions.find((t) => t.source === 'salary' && t.status === 'pending' && t.date <= today);
  return {
    today,
    ym,
    prevYm,
    balanceCents: totalBalance(data),
    cur,
    prev,
    spend: spendableView(data, settings, ym, today),
    positions,
    totals,
    netWorth,
    netWorthPrevCents,
    overdue: overdueBills(data, today),
    dueSoon: upcomingBills(data, today, addDays(today, 3)),
    projectedEndBalanceCents: projectedMonthEndBalance(data, today),
    nextForecast: forecastMonth(data, addMonthsYM(ym, 1), today),
    toConfirmDividends: dividendRows(data, today).filter((r) => r.status === 'a_confirmar'),
    salaryPending,
    budgets: budgetStatuses(settings.budgets, cur),
    debtCents: data.debts.reduce((t, d) => t + d.balanceCents, 0),
    goalsCents: netWorth.goalsCents,
  };
}
