import { describe, expect, it } from 'vitest';
import { challengeProgress } from '../src/domain/challenges';
import { planNotifications } from '../src/domain/notifications';
import { mergeSettings } from '../src/db/db';
import { DEFAULT_SETTINGS, emptyData } from '../src/lib/defaults';
import type { Challenge, Transaction } from '../src/lib/types';

let n = 0;
const t = (p: Partial<Transaction>): Transaction => ({ id: 'c' + n++, type: 'expense', kind: 'variavel', description: 'X', amountCents: 3000, categoryId: 'alimentacao', date: '2026-11-10', paymentMethod: 'pix', accountId: 'a', status: 'paid', createdAt: n, ...p });
const ch = (p: Partial<Challenge>): Challenge => ({ id: 'ch', kind: 'sem-gasto', categoryId: 'alimentacao', start: '2026-11-10', days: 7, createdAt: 1, ...p });

describe('desafios', () => {
  it('sem gastar: falha com um gasto na categoria; conclui ao passar o prazo limpo', () => {
    const d = emptyData();
    expect(challengeProgress(ch({}), d, '2026-11-12')).toMatchObject({ status: 'andamento', daysLeft: 4 });
    expect(challengeProgress(ch({}), d, '2026-11-12').pct).toBeCloseTo((3 / 7) * 100, 5);
    expect(challengeProgress(ch({}), d, '2026-11-17').status).toBe('concluido');
    d.transactions = [t({ date: '2026-11-11' }), t({ categoryId: 'mercado', date: '2026-11-11' })];
    expect(challengeProgress(ch({}), d, '2026-11-12')).toMatchObject({ status: 'falhou', cents: 3000 });
    // gasto antes do início não conta
    d.transactions = [t({ date: '2026-11-09' })];
    expect(challengeProgress(ch({}), d, '2026-11-12').status).toBe('andamento');
  });
  it('"*" = qualquer gasto variável (conta fixa não derruba)', () => {
    const d = emptyData();
    d.transactions = [t({ kind: 'fixa', categoryId: 'moradia' })];
    expect(challengeProgress(ch({ categoryId: '*' }), d, '2026-11-12').status).toBe('andamento');
    d.transactions.push(t({ categoryId: 'lazer' }));
    expect(challengeProgress(ch({ categoryId: '*' }), d, '2026-11-12').status).toBe('falhou');
  });
  it('limite e guardar', () => {
    const d = emptyData();
    d.transactions = [t({ categoryId: 'lazer', amountCents: 15000 })];
    const lim = ch({ kind: 'limite', categoryId: 'lazer', limitCents: 20000, days: 30 });
    expect(challengeProgress(lim, d, '2026-11-12')).toMatchObject({ status: 'andamento', pct: 75 });
    d.transactions.push(t({ categoryId: 'lazer', amountCents: 6000 }));
    expect(challengeProgress(lim, d, '2026-11-12').status).toBe('falhou');
    const g = ch({ kind: 'guardar', targetCents: 50000, days: 30 });
    d.goalMoves = [{ id: 'm', goalId: 'g', amountCents: 50000, date: '2026-11-11' } as never];
    expect(challengeProgress(g, d, '2026-11-12').status).toBe('concluido');
    expect(challengeProgress(g, emptyData(), '2026-12-20').status).toBe('falhou');
  });
  it('configurações: desafios inválidos são descartados', () => {
    const s = mergeSettings({ challenges: [ch({}), { id: 1 } as never, ch({ kind: 'x' as never })] });
    expect(s.challenges).toHaveLength(1);
    expect(mergeSettings({}).challenges).toEqual([]);
  });
});

describe('relatório do mês (notificação)', () => {
  it('dia 1 traz os números do mês que fechou; o próximo dia 1 só avisa', () => {
    const d = emptyData();
    d.transactions = [t({ type: 'income', kind: 'salario', categoryId: 'salario', amountCents: 500000, date: '2026-10-05' }), t({ amountCents: 120000, date: '2026-10-08' })];
    const s = { ...DEFAULT_SETTINGS, notifications: { ...DEFAULT_SETTINGS.notifications, enabled: true, time: '09:00' } };
    const out = planNotifications(d, s, new Date('2026-11-01T08:00:00'), '2026-11-01');
    const now = out.find((x) => x.key === 'report:2026-10')!;
    expect(now.title).toBe('Seu mês de outubro');
    expect(now.body).toMatch(/Entrou R\$\s5\.000,00, saiu R\$\s1\.200,00 e sobrou R\$\s3\.800,00/);
    const later = planNotifications(d, s, new Date('2026-11-20T10:00:00'), '2026-11-20').find((x) => x.key === 'report:2026-11')!;
    expect(later.title).toBe('Novembro fechou');
    expect(later.body).not.toMatch(/R\$/);
    const off = { ...s, notifications: { ...s.notifications, types: { ...s.notifications.types, monthlyReport: false } } };
    expect(planNotifications(d, off, new Date('2026-11-01T08:00:00'), '2026-11-01').some((x) => x.key.startsWith('report:'))).toBe(false);
  });
});
