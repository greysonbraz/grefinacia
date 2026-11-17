import type { AppData, Cents, HistoryPoint, ISODate, UsdHolding } from '../lib/types';
import { addDays } from '../lib/dates';
import { historyId } from './market';

/**
 * Aba Dólar (Etapa 15). Cotação do dólar: PTAX de venda do Banco Central (série SGS 1, dados abertos), publicada
 * no fim de cada dia útil. Valores em dólar ficam em centavos de dólar; em reais, convertidos pela última PTAX.
 */

export const USD_HISTORY_ID = historyId('indice', 'USD');

export function usdRate(data: AppData): { rate: number; date: ISODate } | null {
  const h = data.marketHistory.find((x) => x.id === USD_HISTORY_ID);
  const last = h?.points[h.points.length - 1];
  return last && last[1] > 0 ? { rate: last[1], date: last[0] } : null;
}

/** Variação da cotação em `days` dias (%), comparando com o último ponto até aquela data. */
export function rateChange(points: HistoryPoint[], days: number): number | null {
  if (points.length < 2) return null;
  const [lastDate, last] = points[points.length - 1];
  const from = addDays(lastDate, -days);
  const base = [...points].reverse().find(([d]) => d <= from);
  return base && base[1] > 0 ? ((last - base[1]) / base[1]) * 100 : null;
}

export const isAsset = (h: UsdHolding) => h.kind === 'acao' || h.kind === 'etf' || h.kind === 'reit';

/** Valor em centavos de dólar: conta e "outro" pelo saldo; ativos pela cotação (sem cotação, pelo custo). */
export function holdingUsd(h: UsdHolding): number {
  if (!isAsset(h)) return Math.round(h.balanceUsdCents ?? 0);
  const q = h.quantity ?? 0;
  const price = h.priceUsdCents ?? h.avgCostUsdCents ?? 0;
  return Math.round(q * price);
}
export const holdingCostUsd = (h: UsdHolding): number => (isAsset(h) ? Math.round((h.quantity ?? 0) * (h.avgCostUsdCents ?? 0)) : Math.round(h.balanceUsdCents ?? 0));

export const KIND_LABEL: Record<UsdHolding['kind'], string> = { conta: 'Conta em dólar', acao: 'Ações (EUA)', etf: 'ETFs', reit: 'REITs', outro: 'Outros' };

export interface DollarSummary {
  totalUsd: number; // centavos de dólar
  totalBrl: Cents | null; // convertido pela PTAX (null sem cotação)
  costUsd: number; // aplicado nos ativos + saldo das contas
  gainUsd: number; // ganho nos ativos com cotação
  byKind: { label: string; usd: number }[];
  bankUsd: number; // investimentos em dólar vindos do banco (Etapa 14)
  rate: { rate: number; date: ISODate } | null;
}
export function dollarSummary(data: AppData): DollarSummary {
  const rate = usdRate(data);
  const hs = data.usdHoldings ?? [];
  const by = new Map<string, number>();
  let total = 0, cost = 0, gain = 0;
  for (const h of hs) {
    const v = holdingUsd(h);
    total += v;
    cost += holdingCostUsd(h);
    if (isAsset(h) && h.priceUsdCents !== undefined) gain += v - holdingCostUsd(h);
    by.set(KIND_LABEL[h.kind], (by.get(KIND_LABEL[h.kind]) ?? 0) + v);
  }
  const bankUsd = (data.bankInvestments ?? []).filter((i) => i.currency === 'USD' && i.counted).reduce((s, i) => s + i.balanceCents, 0);
  if (bankUsd) by.set('Investimentos no banco', bankUsd);
  total += bankUsd;
  cost += bankUsd;
  return {
    totalUsd: total,
    totalBrl: rate ? Math.round((total * rate.rate)) : null,
    costUsd: cost,
    gainUsd: gain,
    byKind: [...by.entries()].map(([label, usd]) => ({ label, usd })).filter((x) => x.usd > 0).sort((a, b) => b.usd - a.usd),
    bankUsd,
    rate,
  };
}

/** Em reais, para o patrimônio (0 sem cotação: o app avisa na aba Dólar). */
export const abroadBrl = (data: AppData): Cents => dollarSummary(data).totalBrl ?? 0;

export const formatUSD = (usdCents: number): string => (usdCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
