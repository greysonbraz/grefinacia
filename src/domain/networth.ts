import type { AppData, Cents, ISODate, YearMonth } from '../lib/types';
import { endOfMonth, lastMonths, monthOf } from '../lib/dates';
import { accountBalance } from './ledger';
import { computePositions } from './portfolio';
import { bankInvestTotal } from './bankInvest';
import { abroadBrl } from './dollar';

export interface NetWorth {
  accountsCents: Cents;
  goalsCents: Cents;
  fixedIncomeCents: Cents;
  equityMarketCents: Cents;
  equityCostCents: Cents;
  cryptoCents: Cents;
  /** Investimentos lidos do banco pela conexão (valor de hoje; datas passadas usam os registros diários). */
  bankInvestCents: Cents;
  /** Dólar (contas, ações dos EUA e investimentos em dólar do banco), convertido pela PTAX. */
  abroadCents: Cents;
  totalCents: Cents;
  marketBased: boolean;
}

/**
 * Patrimônio em uma data. Para hoje usa as cotações atuais; para datas passadas usa o CUSTO dos ativos
 * (não há cotações históricas) e o valor aplicado da renda fixa.
 */
export function netWorthAt(data: AppData, asOf: ISODate, today: ISODate): NetWorth {
  const current = asOf >= today;
  const accountsCents = data.accounts.filter((a) => !a.archived).reduce((s, a) => s + accountBalance(a, data, current ? undefined : asOf), 0);
  const goalsCents = data.goalMoves.filter((m) => m.date <= asOf).reduce((s, m) => s + m.amountCents, 0);
  const fixedIncomeCents = data.fixedIncomes.filter((f) => f.purchaseDate <= asOf).reduce((s, f) => s + (current ? f.currentCents : f.investedCents), 0);
  const pos = computePositions(data.assets, data.operations, current ? undefined : asOf, current);
  const equityCostCents = pos.reduce((s, p) => s + p.costCents, 0);
  const equityMarketCents = pos.reduce((s, p) => s + p.valueCents, 0);
  const cryptoCents = computePositions(data.cryptoAssets ?? [], data.cryptoOps ?? [], current ? undefined : asOf, current).reduce((s, p) => s + p.valueCents, 0);
  // posição do banco é uma foto de hoje: só entra no patrimônio atual (o passado vem dos registros diários)
  const bankInvestCents = current ? bankInvestTotal(data.bankInvestments) : 0;
  const abroadCents = current ? abroadBrl(data) : 0;
  return { accountsCents, goalsCents, fixedIncomeCents, equityMarketCents, equityCostCents, cryptoCents, bankInvestCents, abroadCents, totalCents: accountsCents + goalsCents + fixedIncomeCents + equityMarketCents + cryptoCents + bankInvestCents + abroadCents, marketBased: current };
}

export interface NetWorthPoint {
  ym: YearMonth;
  totalCents: Cents;
  accountsCents: Cents;
  source: 'registro' | 'calculado';
}

/** Série mensal do patrimônio. Usa os registros diários salvos pelo app (com cotação real) quando existem. */
export function netWorthSeries(data: AppData, months: number, today: ISODate): NetWorthPoint[] {
  return lastMonths(monthOf(today), months).map((ym) => {
    const isCurrent = ym === monthOf(today);
    const end = isCurrent ? today : endOfMonth(ym);
    const snap = [...data.snapshots].filter((s) => monthOf(s.date) === ym && s.date <= end).sort((a, b) => b.date.localeCompare(a.date))[0];
    if (snap && !isCurrent) return { ym, totalCents: snap.totalCents, accountsCents: snap.accountsCents, source: 'registro' as const };
    const nw = netWorthAt(data, end, today);
    return { ym, totalCents: nw.totalCents, accountsCents: nw.accountsCents, source: 'calculado' as const };
  });
}

export function makeSnapshot(data: AppData, today: ISODate) {
  const nw = netWorthAt(data, today, today);
  return { id: today, date: today, accountsCents: nw.accountsCents, goalsCents: nw.goalsCents, fixedIncomeCents: nw.fixedIncomeCents, equityMarketCents: nw.equityMarketCents, equityCostCents: nw.equityCostCents, totalCents: nw.totalCents, debtCents: data.debts.reduce((t, d) => t + d.balanceCents, 0), cryptoCents: nw.cryptoCents };
}
