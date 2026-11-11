import type { Cents, FixedIncome, ISODate } from '../lib/types';
import { diffDays } from '../lib/dates';

export const FI_LABEL: Record<string, string> = { tesouro: 'Tesouro Direto', cdb: 'CDB', lci: 'LCI', lca: 'LCA', poupanca: 'Poupança', outro: 'Outro' };
const EXEMPT = ['lci', 'lca', 'poupanca'];

/** Alíquota de IR regressivo sobre o rendimento (LCI, LCA e poupança são isentas para pessoa física). */
export function irRate(kind: string | undefined, days: number): number {
  if (kind && EXEMPT.includes(kind)) return 0;
  if (days <= 180) return 0.225;
  if (days <= 360) return 0.2;
  if (days <= 720) return 0.175;
  return 0.15;
}

export interface FixedEstimate {
  days: number;
  grossCents: Cents | null; // estimativa pela taxa informada; null sem taxa
  taxCents: Cents;
  netCents: Cents | null;
  irPct: number;
  atMaturityNetCents: Cents | null;
}

/** Estimativa de valor atualizado: juros compostos pela taxa anual informada (base 365 dias). É projeção, não valor oficial. */
export function estimateFixed(f: FixedIncome, today: ISODate): FixedEstimate {
  const days = Math.max(diffDays(today, f.purchaseDate), 0);
  const irPct = irRate(f.kind, days);
  if (!f.annualRatePct) return { days, grossCents: null, taxCents: 0, netCents: null, irPct, atMaturityNetCents: null };
  const grow = (d: number) => Math.round(f.investedCents * Math.pow(1 + f.annualRatePct! / 100, d / 365));
  const gross = grow(days);
  const tax = Math.round((gross - f.investedCents) * irPct);
  let atMat: Cents | null = null;
  if (f.maturityDate) {
    const dm = Math.max(diffDays(f.maturityDate, f.purchaseDate), 0);
    const gm = grow(dm);
    atMat = gm - Math.round((gm - f.investedCents) * irRate(f.kind, dm));
  }
  return { days, grossCents: gross, taxCents: tax, netCents: gross - tax, irPct, atMaturityNetCents: atMat };
}

/** Simulação de aportes mensais com juros compostos (valores brutos, sem promessa de rentabilidade). */
export function simulateGrowth(initialCents: Cents, monthlyCents: Cents, annualRatePct: number, months: number): { month: number; valueCents: Cents; investedCents: Cents }[] {
  const i = Math.pow(1 + annualRatePct / 100, 1 / 12) - 1;
  const out: { month: number; valueCents: Cents; investedCents: Cents }[] = [];
  let v = initialCents;
  for (let m = 1; m <= months; m++) {
    v = v * (1 + i) + monthlyCents;
    out.push({ month: m, valueCents: Math.round(v), investedCents: initialCents + monthlyCents * m });
  }
  return out;
}
