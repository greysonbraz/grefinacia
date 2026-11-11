import type { Asset, AppData, Cents, FixedIncome, ISODate, Operation } from '../lib/types';
import { roundHalfAway } from '../lib/money';

export function sortedOps(ops: Operation[]): Operation[] {
  return [...ops].sort((a, b) => a.date.localeCompare(b.date) || (a.side === b.side ? 0 : a.side === 'buy' ? -1 : 1) || a.createdAt - b.createdAt);
}

export interface Position {
  asset: Asset;
  quantity: number;
  costCents: Cents; // custo da posição atual (inclui custos de corretagem)
  avgPriceCents: number; // preço médio (fração de centavo é mantida)
  realizedCents: Cents; // lucro/prejuízo já realizado nas vendas
  priceCents: Cents | null; // cotação (ou preço manual) usado na avaliação
  priceSource: 'quote' | 'manual' | 'none';
  valueCents: Cents; // valor de mercado; sem cotação, usa o custo
  pnlCents: Cents | null; // null quando não há cotação
  pnlPct: number | null;
  firstBuy?: ISODate;
  brokers: string[];
}

/** Posição de cada ativo considerando as operações até `asOf` (inclusive). */
export function computePositions(assets: Asset[], operations: Operation[], asOf?: ISODate, useQuotes = true): Position[] {
  const ops = sortedOps(operations.filter((o) => !asOf || o.date <= asOf));
  const out: Position[] = [];
  for (const asset of assets) {
    let qty = 0;
    let cost = 0;
    let realized = 0;
    let firstBuy: ISODate | undefined;
    const brokers = new Set<string>();
    for (const o of ops) {
      if (o.assetId !== asset.id) continue;
      if (o.broker) brokers.add(o.broker);
      if (o.side === 'buy') {
        qty += o.quantity;
        cost += o.quantity * o.priceCents + o.feesCents;
        firstBuy = firstBuy ?? o.date;
      } else {
        const sellQty = Math.min(o.quantity, qty);
        const avg = qty > 0 ? cost / qty : 0;
        realized += sellQty * o.priceCents - o.feesCents - avg * sellQty;
        cost -= avg * sellQty;
        qty -= sellQty;
        if (qty === 0) cost = 0;
      }
    }
    const costCents = roundHalfAway(cost);
    let priceCents: Cents | null = null;
    let priceSource: Position['priceSource'] = 'none';
    if (useQuotes && asset.quote) {
      priceCents = asset.quote.priceCents;
      priceSource = 'quote';
    } else if (useQuotes && asset.manualPriceCents) {
      priceCents = asset.manualPriceCents;
      priceSource = 'manual';
    }
    const value = priceCents !== null ? roundHalfAway(qty * priceCents) : costCents;
    const pnl = priceCents !== null && qty > 0 ? value - costCents : null;
    out.push({
      asset,
      quantity: qty,
      costCents,
      avgPriceCents: qty > 0 ? cost / qty : 0,
      realizedCents: roundHalfAway(realized),
      priceCents,
      priceSource,
      valueCents: value,
      pnlCents: pnl,
      pnlPct: pnl !== null && costCents > 0 ? (pnl / costCents) * 100 : null,
      firstBuy,
      brokers: [...brokers],
    });
  }
  return out;
}

export function quantityAt(operations: Operation[], assetId: string, date: ISODate): number {
  let q = 0;
  for (const o of sortedOps(operations)) {
    if (o.assetId !== assetId || o.date > date) continue;
    q += o.side === 'buy' ? o.quantity : -o.quantity;
  }
  return Math.max(q, 0);
}

/** Verifica se a lista de operações nunca deixa a posição negativa (não dá para vender o que não tem). */
export function operationsAreValid(operations: Operation[]): { ok: boolean; assetId?: string; date?: ISODate } {
  const qty = new Map<string, number>();
  for (const o of sortedOps(operations)) {
    const q = (qty.get(o.assetId) ?? 0) + (o.side === 'buy' ? o.quantity : -o.quantity);
    if (q < 0) return { ok: false, assetId: o.assetId, date: o.date };
    qty.set(o.assetId, q);
  }
  return { ok: true };
}

export interface PortfolioTotals {
  investedCents: Cents; // custo (ações/FIIs) + aplicado (renda fixa)
  valueCents: Cents; // valor atual da carteira
  equityValueCents: Cents;
  fixedValueCents: Cents;
  pnlCents: Cents; // somente itens com cotação / valor atual informado
  pnlPct: number | null;
  realizedCents: Cents;
  unquoted: number; // quantidade de ativos sem cotação
}

export function portfolioTotals(positions: Position[], fixed: FixedIncome[]): PortfolioTotals {
  let invested = 0, value = 0, equityValue = 0, pnl = 0, pnlBase = 0, realized = 0, unquoted = 0;
  for (const p of positions) {
    realized += p.realizedCents;
    if (p.quantity <= 0) continue;
    invested += p.costCents;
    equityValue += p.valueCents;
    if (p.pnlCents !== null) {
      pnl += p.pnlCents;
      pnlBase += p.costCents;
    } else unquoted++;
  }
  let fixedValue = 0;
  for (const f of fixed) {
    invested += f.investedCents;
    fixedValue += f.currentCents;
    pnl += f.currentCents - f.investedCents;
    pnlBase += f.investedCents;
  }
  value = equityValue + fixedValue;
  return { investedCents: invested, valueCents: value, equityValueCents: equityValue, fixedValueCents: fixedValue, pnlCents: pnl, pnlPct: pnlBase > 0 ? (pnl / pnlBase) * 100 : null, realizedCents: realized, unquoted };
}

export function portfolioFromData(data: AppData) {
  const positions = computePositions(data.assets, data.operations);
  return { positions, totals: portfolioTotals(positions, data.fixedIncomes) };
}
