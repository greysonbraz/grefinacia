import type { Cents, Debt } from '../lib/types';

export interface Payoff {
  months: number; // Infinity quando a parcela não cobre os juros
  totalPaidCents: Cents;
  interestCents: Cents;
}

/** Simula a quitação mês a mês: juros sobre o saldo, depois abate parcela + extra. */
export function simulatePayoff(balanceCents: Cents, monthlyRatePct: number, paymentCents: Cents, extraCents = 0): Payoff {
  const i = monthlyRatePct / 100;
  let b = balanceCents;
  let paid = 0;
  let interest = 0;
  let months = 0;
  const pay = paymentCents + extraCents;
  if (b <= 0) return { months: 0, totalPaidCents: 0, interestCents: 0 };
  if (pay <= b * i) return { months: Infinity, totalPaidCents: Infinity, interestCents: Infinity };
  while (b > 100 && months < 1200) { // resíduo de centavos do arredondamento da parcela é ignorado
    const j = b * i;
    interest += j;
    b += j;
    const p = Math.min(pay, b);
    b -= p;
    paid += p;
    months++;
  }
  return { months, totalPaidCents: Math.round(paid), interestCents: Math.round(interest) };
}

/** Parcela de um financiamento pela Tabela Price. */
export function pricePayment(principalCents: Cents, monthlyRatePct: number, n: number): Cents {
  const i = monthlyRatePct / 100;
  if (n <= 0) return 0;
  if (i === 0) return Math.round(principalCents / n);
  return Math.round((principalCents * i) / (1 - Math.pow(1 + i, -n)));
}

/** Saldo devedor estimado a partir das parcelas restantes (valor presente). */
export function presentValue(installmentCents: Cents, monthlyRatePct: number, n: number): Cents {
  const i = monthlyRatePct / 100;
  if (i === 0) return installmentCents * n;
  return Math.round((installmentCents * (1 - Math.pow(1 + i, -n))) / i);
}

export interface ExtraSim {
  base: Payoff;
  withExtra: Payoff;
  monthsSaved: number;
  interestSavedCents: Cents;
}
export function simulateExtra(d: Debt, extraCents: Cents): ExtraSim {
  const base = simulatePayoff(d.balanceCents, d.monthlyRatePct, d.installmentCents);
  const withExtra = simulatePayoff(d.balanceCents, d.monthlyRatePct, d.installmentCents, extraCents);
  return { base, withExtra, monthsSaved: base.months - withExtra.months, interestSavedCents: base.interestCents === Infinity ? Infinity : base.interestCents - withExtra.interestCents };
}

/** Antecipar as últimas N parcelas: cada uma é descontada pelos juros do período antecipado. */
export function simulateAnticipation(d: Debt, lastN: number): { payNowCents: Cents; nominalCents: Cents; savedCents: Cents } {
  const i = d.monthlyRatePct / 100;
  const n = Math.min(Math.max(lastN, 0), d.remainingInstallments);
  let payNow = 0;
  for (let k = d.remainingInstallments - n + 1; k <= d.remainingInstallments; k++) payNow += d.installmentCents / Math.pow(1 + i, k);
  const nominal = d.installmentCents * n;
  return { payNowCents: Math.round(payNow), nominalCents: nominal, savedCents: nominal - Math.round(payNow) };
}

export interface RefinanceSim {
  currentTotalCents: Cents;
  newPaymentCents: Cents;
  newTotalCents: Cents; // inclui tarifas
  savedCents: Cents; // positivo = vale a pena no custo total
  paymentDiffCents: Cents; // nova parcela − parcela atual
}
/** Portabilidade/renegociação: troca o saldo devedor por novo contrato (taxa, prazo e tarifas). */
export function simulateRefinance(d: Debt, newRatePct: number, newMonths: number, feesCents: Cents): RefinanceSim {
  const currentTotal = d.installmentCents * d.remainingInstallments;
  const newPayment = pricePayment(d.balanceCents + feesCents, newRatePct, newMonths);
  const newTotal = newPayment * newMonths;
  return { currentTotalCents: currentTotal, newPaymentCents: newPayment, newTotalCents: newTotal, savedCents: currentTotal - newTotal, paymentDiffCents: newPayment - d.installmentCents };
}

export interface StrategyResult {
  months: number;
  interestCents: Cents;
  order: string[]; // nomes na ordem de quitação
}
/** Compara estratégias: "avalanche" (maior juro primeiro) e "bola de neve" (menor saldo primeiro), com um extra mensal. */
export function simulateStrategy(debts: Debt[], extraCents: Cents, strategy: 'avalanche' | 'snowball'): StrategyResult {
  const st = debts.filter((d) => d.balanceCents > 0).map((d) => ({ name: d.name, b: d.balanceCents as number, i: d.monthlyRatePct / 100, p: d.installmentCents }));
  let months = 0;
  let interest = 0;
  const order: string[] = [];
  while (st.some((d) => d.b > 0.5) && months < 1200) {
    months++;
    let pool = extraCents;
    for (const d of st) {
      if (d.b <= 0.5) {
        pool += d.p; // parcela de dívida quitada vira reforço
        continue;
      }
      const j = d.b * d.i;
      interest += j;
      d.b += j;
      const p = Math.min(d.p, d.b);
      d.b -= p;
      pool += d.p - p;
    }
    const open = st.filter((d) => d.b > 0.5).sort((a, b) => (strategy === 'avalanche' ? b.i - a.i : a.b - b.b));
    for (const d of open) {
      const p = Math.min(pool, d.b);
      d.b -= p;
      pool -= p;
      if (pool <= 0) break;
    }
    for (const d of st) if (d.b <= 0.5 && !order.includes(d.name)) order.push(d.name);
  }
  return { months: months >= 1200 ? Infinity : months, interestCents: Math.round(interest), order };
}

export function debtTotals(debts: Debt[]) {
  const balanceCents = debts.reduce((s, d) => s + d.balanceCents, 0);
  const monthlyCents = debts.filter((d) => d.remainingInstallments > 0).reduce((s, d) => s + d.installmentCents, 0);
  const monthlyInterestCents = Math.round(debts.reduce((s, d) => s + (d.balanceCents * d.monthlyRatePct) / 100, 0));
  const priority = [...debts].filter((d) => d.balanceCents > 0).sort((a, b) => b.monthlyRatePct - a.monthlyRatePct);
  return { balanceCents, monthlyCents, monthlyInterestCents, priority };
}

/** Taxa anual equivalente a uma taxa mensal. */
export const annualFromMonthly = (pct: number) => (Math.pow(1 + pct / 100, 12) - 1) * 100;
