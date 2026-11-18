import type { AppData, Cents, ISODate } from '../lib/types';
import { addMonthsYM, monthOf } from '../lib/dates';
import { computePositions, portfolioFromData } from './portfolio';
import { bankInvestTotal } from './bankInvest';
import { dollarSummary, holdingUsd } from './dollar';
import { forecastMonth } from './dividends';
import { passiveIncomeSeries } from './reports';

/**
 * Visão geral dos investimentos (redesign, etapa 6): junta Bolsa, renda fixa, investimentos dos bancos, exterior e
 * cripto, só com os valores que o app já calcula (nenhuma regra nova; sem cotação, vale o custo, como no resto do app).
 */
export interface ClassSlice { id: 'acoes' | 'fiis' | 'etfs' | 'fixa' | 'bancos' | 'exterior' | 'cripto'; label: string; cents: Cents }
export interface TopPosition { label: string; detail: string; cents: Cents; pct: number }
export interface InvestOverview {
  totalCents: Cents;
  classes: ClassSlice[];
  assetsCount: number;
  pnlCents: Cents | null; // Bolsa e renda fixa com cotação/valor informado
  pnlPct: number | null;
  bankGainCents: Cents | null; // investimentos do banco com valor aplicado informado
  dividends12Cents: Cents;
  dividendsNext: { ym: string; cents: Cents; estimated: boolean };
  top: TopPosition[];
  unquoted: number;
}

export function investOverview(data: AppData, today: ISODate): InvestOverview {
  const { positions, totals } = portfolioFromData(data);
  const held = positions.filter((p) => p.quantity > 0);
  const byType = (t: string) => held.filter((p) => p.asset.type === t).reduce((s, p) => s + p.valueCents, 0);
  const fixed = data.fixedIncomes.reduce((s, f) => s + f.currentCents, 0);
  const banks = bankInvestTotal(data.bankInvestments);
  const usd = dollarSummary(data);
  const crypto = computePositions(data.cryptoAssets ?? [], data.cryptoOps ?? []).reduce((s, p) => s + p.valueCents, 0);
  const classes: ClassSlice[] = ([
    { id: 'acoes', label: 'Ações', cents: byType('acao') },
    { id: 'fiis', label: 'Fundos imobiliários', cents: byType('fii') },
    { id: 'etfs', label: 'ETFs', cents: byType('etf') },
    { id: 'fixa', label: 'Renda fixa', cents: fixed },
    { id: 'bancos', label: 'Nos bancos', cents: banks },
    { id: 'exterior', label: 'Exterior', cents: usd.totalBrl ?? 0 },
    { id: 'cripto', label: 'Cripto', cents: crypto },
  ] as ClassSlice[]).filter((c) => c.cents > 0);
  const total = classes.reduce((s, c) => s + c.cents, 0);
  const pct = (v: number) => (total ? (v / total) * 100 : 0);
  const bankWithOrig = (data.bankInvestments ?? []).filter((i) => i.counted && !i.currency && i.originalCents);
  const rate = usd.rate?.rate;
  const top: TopPosition[] = [
    ...held.map((p) => ({ label: p.asset.ticker, detail: `${p.quantity.toLocaleString('pt-BR')} cotas`, cents: p.valueCents })),
    ...data.fixedIncomes.map((f) => ({ label: f.name, detail: 'renda fixa', cents: f.currentCents })),
    ...(data.bankInvestments ?? []).filter((i) => i.counted && !i.currency).map((i) => ({ label: i.name, detail: i.bankName, cents: i.balanceCents })),
    ...(rate ? (data.usdHoldings ?? []).map((h) => ({ label: h.name, detail: 'exterior', cents: Math.round(holdingUsd(h) * rate) })) : []),
  ].filter((x) => x.cents > 0).sort((a, b) => b.cents - a.cents).slice(0, 5).map((x) => ({ ...x, pct: pct(x.cents) }));
  const next = forecastMonth(data, addMonthsYM(monthOf(today), 1), today);
  return {
    totalCents: total,
    classes,
    assetsCount: held.length + data.fixedIncomes.length + (data.bankInvestments ?? []).filter((i) => i.counted).length + (data.usdHoldings ?? []).length + (data.cryptoAssets ?? []).length,
    pnlCents: totals.pnlPct === null ? null : totals.pnlCents,
    pnlPct: totals.pnlPct,
    bankGainCents: bankWithOrig.length ? bankWithOrig.reduce((s, i) => s + i.balanceCents - (i.originalCents ?? 0), 0) : null,
    dividends12Cents: passiveIncomeSeries(data, 12, today).reduce((s, x) => s + x.cents, 0),
    dividendsNext: { ym: next.ym, cents: next.totalCents, estimated: next.estimatedCents > 0 },
    top,
    unquoted: totals.unquoted,
  };
}
