import type { AppData, BankInvestment, Cents, ISODate } from '../lib/types';
import type { PluggyInvestment } from '../services/pluggy';
import { computePositions } from './portfolio';

/**
 * Investimentos lidos do banco pela conexão (Etapa 14). Cada sincronização traz uma foto das posições:
 * valor líquido (depois de IR e IOF), bruto, aplicado, quantidade e vencimento. Não viram operações de compra:
 * o banco não informa o histórico pelo Open Finance de forma completa, e inventar compras distorceria a rentabilidade.
 */

const cents = (v: number | null | undefined): Cents | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) : undefined);
const day = (v: string | null | undefined): ISODate | undefined => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : undefined);
const tickerOf = (code?: string | null) => (code && /^[A-Z]{4}\d{1,2}[A-Z]?$/i.test(code.trim()) ? code.trim().toUpperCase() : undefined);

export const TYPE_LABEL: Record<string, string> = {
  FIXED_INCOME: 'Renda fixa',
  EQUITY: 'Bolsa',
  ETF: 'Bolsa',
  MUTUAL_FUND: 'Fundos',
  SECURITY: 'Previdência',
  COE: 'COE',
  OTHER: 'Outros',
};
export const SUBTYPE_LABEL: Record<string, string> = {
  CDB: 'CDB', LCI: 'LCI', LCA: 'LCA', LC: 'LC', CRI: 'CRI', CRA: 'CRA', LIG: 'LIG', LF: 'LF', TREASURY: 'Tesouro Direto', DEBENTURES: 'Debêntures',
  STOCK: 'Ação', BDR: 'BDR', REAL_ESTATE_FUND: 'Fundo imobiliário', DERIVATIVES: 'Derivativo', OPTION: 'Opção', ETF: 'ETF',
  RETIREMENT: 'Previdência', PGBL: 'PGBL', VGBL: 'VGBL', STRUCTURED_NOTE: 'COE',
  INVESTMENT_FUND: 'Fundo', STOCK_FUND: 'Fundo de ações', MULTIMARKET_FUND: 'Multimercado', EXCHANGE_FUND: 'Fundo cambial', FIXED_INCOME_FUND: 'Fundo de renda fixa', FIP_FUND: 'FIP', OFFSHORE_FUND: 'Fundo no exterior', ETF_FUND: 'Fundo de ETF',
};

/** Ações/FII/ETF que você já cadastrou à mão (com quantidade): o mesmo ticker vindo do banco não conta em dobro. */
export function manualTickers(data: AppData): Set<string> {
  const pos = computePositions(data.assets, data.operations, undefined, false);
  return new Set(pos.filter((p) => p.quantity > 0).map((p) => p.asset.ticker.toUpperCase()));
}

/**
 * Converte e junta com o que já estava salvo. Mantém a escolha que você fez ("contar" ou não). Posições zeradas ou
 * resgatadas por completo saem. Moeda estrangeira só entra quando vier em reais (o app ainda não converte aqui).
 */
export function mergeInvestments(prev: BankInvestment[], incoming: PluggyInvestment[], itemId: string, bankName: string, data: AppData, nowIso: string): { list: BankInvestment[]; skippedForeign: number } {
  const manual = manualTickers(data);
  const kept = new Map(prev.filter((p) => p.itemId === itemId).map((p) => [p.id, p]));
  let skippedForeign = 0;
  const list: BankInvestment[] = [];
  for (const i of incoming) {
    if (i.status === 'TOTAL_WITHDRAWAL') continue;
    const currency = i.currencyCode && i.currencyCode !== 'BRL' ? i.currencyCode : undefined;
    // dólar vai para a aba Dólar; outras moedas ficam de fora (o app só converte dólar)
    if (currency && currency !== 'USD') { skippedForeign++; continue; }
    const balance = cents(i.balance);
    if (balance === undefined || balance <= 0) continue;
    const old = kept.get(i.id);
    const ticker = tickerOf(i.code);
    const dup = !!ticker && manual.has(ticker);
    const counted = old?.countedReason === 'voce' ? old.counted : !dup;
    list.push({
      id: i.id,
      itemId,
      bankName,
      name: (i.name || SUBTYPE_LABEL[i.subtype ?? ''] || 'Investimento').slice(0, 80),
      code: ticker ?? i.code ?? undefined,
      isin: i.isin ?? undefined,
      type: i.type || 'OTHER',
      subtype: i.subtype ?? undefined,
      balanceCents: balance,
      grossCents: cents(i.amount) ?? balance,
      originalCents: cents(i.amountOriginal),
      quantity: typeof i.quantity === 'number' ? i.quantity : undefined,
      unitCents: cents(i.value),
      dueDate: day(i.dueDate),
      issuer: i.issuer ?? undefined,
      rate: i.rate ?? undefined,
      rateType: i.rateType ?? undefined,
      fixedAnnualRate: i.fixedAnnualRate ?? undefined,
      date: day(i.date),
      status: i.status ?? undefined,
      currency,
      counted,
      countedReason: old?.countedReason === 'voce' ? 'voce' : dup ? 'manual-duplicado' : 'auto',
      updatedAt: nowIso,
    });
  }
  return { list, skippedForeign };
}

/** Total que entra no patrimônio (só os marcados para contar). */
export const bankInvestTotal = (list: BankInvestment[] = []): Cents => list.filter((i) => i.counted && !i.currency).reduce((s, i) => s + i.balanceCents, 0);

/** "110% do CDI", "IPCA + 6%", "12,5% ao ano". */
export function rateLabel(i: Pick<BankInvestment, 'rate' | 'rateType' | 'fixedAnnualRate'>): string | null {
  const n = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  if (i.rateType && i.rate) {
    const base = i.rateType === 'IPCA' || i.rateType === 'IGPM' ? i.rateType : `${n(i.rate)}% do ${i.rateType}`;
    return i.fixedAnnualRate ? `${base} + ${n(i.fixedAnnualRate)}%` : i.rateType === 'IPCA' || i.rateType === 'IGPM' ? `${n(i.rate)}% do ${i.rateType}` : base;
  }
  return i.fixedAnnualRate ? `${n(i.fixedAnnualRate)}% ao ano` : null;
}

/** Agrupa por tipo para o painel. */
export function groupByType(list: BankInvestment[]): { label: string; cents: Cents; items: BankInvestment[] }[] {
  const g = new Map<string, BankInvestment[]>();
  for (const i of list) {
    if (i.currency) continue; // em dólar: aba Dólar
    const k = TYPE_LABEL[i.type] ?? 'Outros';
    g.set(k, [...(g.get(k) ?? []), i]);
  }
  return [...g.entries()].map(([label, items]) => ({ label, items: items.sort((a, b) => b.balanceCents - a.balanceCents), cents: items.filter((x) => x.counted).reduce((s, x) => s + x.balanceCents, 0) })).sort((a, b) => b.cents - a.cents);
}

const BOLSA_SUB = new Set(['STOCK', 'BDR', 'REAL_ESTATE_FUND', 'ETF', 'OPTION', 'DERIVATIVES']);
const FIXA_SUB = new Set(['CDB', 'LCI', 'LCA', 'LC', 'CRI', 'CRA', 'LIG', 'LF', 'TREASURY', 'DEBENTURES']);
/** Em qual aba de Investimentos o item do banco também aparece (Bolsa, Renda fixa ou nenhuma das duas). */
export function bankTab(i: BankInvestment): 'bolsa' | 'fixa' | null {
  if (BOLSA_SUB.has(i.subtype ?? '') || i.type === 'EQUITY' || i.type === 'ETF') return 'bolsa';
  if (FIXA_SUB.has(i.subtype ?? '') || i.type === 'FIXED_INCOME') return 'fixa';
  return null;
}
