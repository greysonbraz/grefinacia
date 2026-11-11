import type { Cents, Goal, GoalMove, ISODate } from '../lib/types';
import { addDays, addMonths, diffDays } from '../lib/dates';

export interface GoalProgress {
  goal: Goal;
  accumulatedCents: Cents;
  pct: number;
  remainingCents: Cents;
  monthlyCents: Cents; // aporte mensal usado na previsão
  basis: 'plano' | 'historico' | 'nenhum';
  etaMonths?: number;
  etaDate?: ISODate;
  requiredMonthlyCents?: Cents; // para cumprir o prazo
  status: 'concluida' | 'no_prazo' | 'atrasada' | 'sem_previsao';
}

export function goalProgress(goal: Goal, allMoves: GoalMove[], today: ISODate): GoalProgress {
  const moves = allMoves.filter((m) => m.goalId === goal.id);
  const accumulated = moves.reduce((s, m) => s + m.amountCents, 0);
  const pct = goal.targetCents > 0 ? (accumulated / goal.targetCents) * 100 : 0;
  const remaining = Math.max(goal.targetCents - accumulated, 0);
  // ritmo: aporte planejado; senão média líquida dos últimos 90 dias (excluindo o saldo inicial, sem conta)
  const since = addDays(today, -90);
  const recent = moves.filter((m) => m.date > since && m.date <= today).reduce((s, m) => s + m.amountCents, 0);
  const histMonthly = Math.round(recent / 3);
  let monthly = 0;
  let basis: GoalProgress['basis'] = 'nenhum';
  if (goal.monthlyPlanCents && goal.monthlyPlanCents > 0) {
    monthly = goal.monthlyPlanCents;
    basis = 'plano';
  } else if (histMonthly > 0) {
    monthly = histMonthly;
    basis = 'historico';
  }
  let status: GoalProgress['status'] = 'sem_previsao';
  let etaMonths: number | undefined;
  let etaDate: ISODate | undefined;
  if (remaining === 0 && goal.targetCents > 0) status = 'concluida';
  else if (monthly > 0) {
    etaMonths = Math.ceil(remaining / monthly);
    etaDate = addMonths(today, etaMonths);
    status = goal.deadline && etaDate > goal.deadline ? 'atrasada' : 'no_prazo';
  }
  let required: Cents | undefined;
  if (goal.deadline && remaining > 0) {
    const monthsLeft = Math.max(Math.ceil(diffDays(goal.deadline, today) / 30.4375), 1);
    required = Math.ceil(remaining / monthsLeft);
  }
  return { goal, accumulatedCents: accumulated, pct, remainingCents: remaining, monthlyCents: monthly, basis, etaMonths, etaDate, requiredMonthlyCents: required, status };
}
