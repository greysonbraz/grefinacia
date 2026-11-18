import { addDays, diffDays } from '../lib/dates';
import type { AppData, Cents, Challenge, ISODate } from '../lib/types';

export interface ChallengeProgress {
  status: 'andamento' | 'concluido' | 'falhou' | 'agendado';
  /** 0 a 100: dias cumpridos (sem-gasto), quanto do limite já foi usado (limite) ou quanto já guardou (guardar). */
  pct: number;
  end: ISODate;
  daysLeft: number;
  /** Gasto na categoria (sem-gasto, limite) ou quanto guardou (guardar), dentro do período até hoje. */
  cents: Cents;
}

export const challengeEnd = (c: Challenge): ISODate => addDays(c.start, c.days - 1);

/** Progresso calculado só com lançamentos reais (pagos ou não) dentro do período do desafio. */
export function challengeProgress(c: Challenge, data: AppData, today: ISODate): ChallengeProgress {
  const end = challengeEnd(c);
  const upTo = today < end ? today : end;
  const daysLeft = Math.max(diffDays(end, today), 0);
  if (today < c.start) return { status: 'agendado', pct: 0, end, daysLeft: c.days, cents: 0 };
  const inRange = (d: ISODate) => d >= c.start && d <= upTo;
  const over = today > end;
  if (c.kind === 'guardar') {
    const saved = data.goalMoves.filter((m) => inRange(m.date)).reduce((s, m) => s + m.amountCents, 0);
    const target = c.targetCents ?? 0;
    const pct = target > 0 ? Math.min((Math.max(saved, 0) / target) * 100, 100) : 0;
    return { status: target > 0 && saved >= target ? 'concluido' : over ? 'falhou' : 'andamento', pct, end, daysLeft, cents: saved };
  }
  const match = (catId: string, kind: string) => (c.categoryId === '*' || !c.categoryId ? kind === 'variavel' || kind === 'cartao' : catId === c.categoryId);
  const spent = data.transactions.filter((t) => t.type === 'expense' && inRange(t.date) && match(t.categoryId, t.kind)).reduce((s, t) => s + t.amountCents, 0);
  if (c.kind === 'sem-gasto') {
    const done = Math.min(diffDays(upTo, c.start) + 1, c.days);
    return { status: spent > 0 ? 'falhou' : over ? 'concluido' : 'andamento', pct: (done / c.days) * 100, end, daysLeft, cents: spent };
  }
  const limit = c.limitCents ?? 0;
  return { status: spent > limit ? 'falhou' : over ? 'concluido' : 'andamento', pct: limit > 0 ? Math.min((spent / limit) * 100, 100) : 100, end, daysLeft, cents: spent };
}

/** Sugestões prontas para começar com um toque. */
export const CHALLENGE_TEMPLATES: { title: string; make: () => Omit<Challenge, 'id' | 'start' | 'createdAt'> }[] = [
  { title: '7 dias sem comer fora', make: () => ({ kind: 'sem-gasto', categoryId: 'alimentacao', days: 7 }) },
  { title: 'Semana sem gastos variáveis', make: () => ({ kind: 'sem-gasto', categoryId: '*', days: 7 }) },
  { title: 'Lazer até R$ 200 em 30 dias', make: () => ({ kind: 'limite', categoryId: 'lazer', limitCents: 20000, days: 30 }) },
  { title: 'Guardar R$ 500 em 30 dias', make: () => ({ kind: 'guardar', targetCents: 50000, days: 30 }) },
];
