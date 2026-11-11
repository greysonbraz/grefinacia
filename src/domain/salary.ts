import type { AppData, Cents, ISODate, Settings, YearMonth } from '../lib/types';
import { daysInMonth, monthOf } from '../lib/dates';
import { mulCents } from '../lib/money';
import { COMMITMENT_KINDS } from '../lib/categories';

export interface SalaryPlan {
  incomeCents: Cents;
  fixedCents: Cents;
  availableCents: Cents; // receita − despesas fixas
  saveCents: Cents;
  investCents: Cents;
  freeCents: Cents; // sobra para gastar no mês
  savePct: number;
  investPct: number;
  freePct: number;
  deficitCents: Cents; // > 0 quando as despesas fixas passam da receita
  risk: 'ok' | 'apertado' | 'deficit' | 'sem_receita';
}

export function normalizePcts(savePct: number, investPct: number): { savePct: number; investPct: number; freePct: number } {
  const s = Math.min(Math.max(savePct, 0), 100);
  const i = Math.min(Math.max(investPct, 0), 100 - s);
  return { savePct: s, investPct: i, freePct: Math.round((100 - s - i) * 100) / 100 };
}

/** Divide a receita: separa as despesas fixas e distribui o que sobra entre guardar, investir e gastar. */
export function computeSalaryPlan(incomeCents: Cents, fixedCents: Cents, savePct: number, investPct: number): SalaryPlan {
  const p = normalizePcts(savePct, investPct);
  const available = incomeCents - fixedCents;
  if (incomeCents <= 0 && fixedCents <= 0) {
    return { incomeCents, fixedCents, availableCents: 0, saveCents: 0, investCents: 0, freeCents: 0, ...p, deficitCents: 0, risk: 'sem_receita' };
  }
  if (available <= 0) {
    return { incomeCents, fixedCents, availableCents: available, saveCents: 0, investCents: 0, freeCents: 0, ...p, deficitCents: -available, risk: 'deficit' };
  }
  const save = mulCents(available, p.savePct / 100);
  const invest = mulCents(available, p.investPct / 100);
  const free = available - save - invest;
  const risk = free < incomeCents * 0.1 ? 'apertado' : 'ok';
  return { incomeCents, fixedCents, availableCents: available, saveCents: save, investCents: invest, freeCents: free, ...p, deficitCents: 0, risk };
}

export interface SpendableView {
  ym: YearMonth;
  plan: SalaryPlan;
  incomeSource: 'recebido' | 'previsto' | 'lancado' | 'nenhum';
  variableSpentCents: Cents;
  remainingCents: Cents; // quanto ainda posso gastar
  perDayCents: Cents;
  daysLeft: number;
  fixedItems: { description: string; amountCents: Cents; status: 'paid' | 'pending' }[];
}

const SALARY_KINDS = ['salario', 'hora_extra', 'adicional'];

export function spendableView(data: AppData, settings: Settings, ym: YearMonth, today: ISODate): SpendableView {
  const inMonth = data.transactions.filter((t) => monthOf(t.date) === ym);
  const paidSalary = inMonth.filter((t) => t.type === 'income' && SALARY_KINDS.includes(t.kind) && t.status === 'paid').reduce((s, t) => s + t.amountCents, 0);
  const allIncome = inMonth.filter((t) => t.type === 'income').reduce((s, t) => s + t.amountCents, 0);
  let income = 0;
  let incomeSource: SpendableView['incomeSource'] = 'nenhum';
  if (paidSalary > 0) {
    income = paidSalary;
    incomeSource = 'recebido';
  } else if (settings.salary.amountCents > 0) {
    income = settings.salary.amountCents;
    incomeSource = 'previsto';
  } else if (allIncome > 0) {
    income = allIncome;
    incomeSource = 'lancado';
  }
  const fixedTx = inMonth.filter((t) => t.type === 'expense' && COMMITMENT_KINDS.includes(t.kind));
  const fixed = fixedTx.reduce((s, t) => s + t.amountCents, 0);
  const plan = computeSalaryPlan(income, fixed, settings.salary.savePct, settings.salary.investPct);
  const variableSpent = inMonth.filter((t) => t.type === 'expense' && !COMMITMENT_KINDS.includes(t.kind)).reduce((s, t) => s + t.amountCents, 0);
  const remaining = plan.freeCents - variableSpent;
  const isCurrent = monthOf(today) === ym;
  const daysLeft = isCurrent ? daysInMonth(ym) - Number(today.slice(8, 10)) + 1 : 0;
  const perDay = remaining > 0 && daysLeft > 0 ? Math.floor(remaining / daysLeft) : 0;
  return { ym, plan, incomeSource, variableSpentCents: variableSpent, remainingCents: remaining, perDayCents: perDay, daysLeft, fixedItems: fixedTx.map((t) => ({ description: t.description, amountCents: t.amountCents, status: t.status })) };
}
