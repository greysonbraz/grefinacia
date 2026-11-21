import { describe, expect, it } from 'vitest';
import { balanceOutlook, futureValue, healthScore, monthlyNeeded } from '../src/domain/home';
import { emptyData } from '../src/lib/defaults';
import type { AppData, Transaction } from '../src/lib/types';

let n = 0;
const t = (p: Partial<Transaction>): Transaction => ({ id: 'u' + n++, type: 'expense', kind: 'variavel', description: 'Gasto', amountCents: 1000, categoryId: 'mercado', date: '2026-10-05', paymentMethod: 'pix', accountId: 'a', status: 'paid', paidDate: p.date ?? '2026-10-05', createdAt: n, ...p });
const base = (): AppData => {
  const d = emptyData();
  d.accounts = [{ id: 'a', name: 'Conta', kind: 'corrente', initialCents: 0, initialDate: '2026-01-01' }];
  return d;
};

describe('nota de saúde financeira', () => {
  it('sem mês fechado com renda e gasto não há nota', () => {
    expect(healthScore(base(), '2026-11-18')).toBeNull();
  });
  it('sobra 20% da renda, 6 meses de reserva e sem dívidas = 100', () => {
    const d = base();
    d.accounts[0].initialCents = 6 * 400000 + 0;
    d.transactions = [
      t({ type: 'income', kind: 'fixa', categoryId: 'salario', amountCents: 500000, date: '2026-10-05' }),
      t({ amountCents: 400000, date: '2026-10-10' }),
    ];
    const s = healthScore(d, '2026-11-18')!;
    expect(s.score).toBe(100);
    expect(s.label).toBe('Excelente');
    expect(s.parts.map((p) => p.points)).toEqual([40, 35, 25]);
  });
  it('gastando tudo e sem reserva a nota cai', () => {
    const d = base();
    d.accounts[0].initialCents = 0;
    d.transactions = [
      t({ type: 'income', kind: 'fixa', categoryId: 'salario', amountCents: 300000, date: '2026-10-05' }),
      t({ amountCents: 300000, date: '2026-10-10' }),
    ];
    const s = healthScore(d, '2026-11-18')!;
    expect(s.parts[0].points).toBe(0);
    expect(s.parts[1].points).toBe(0);
    expect(s.score).toBe(25);
    expect(s.label).toBe('Crítica');
  });
});

describe('previsão de saldo', () => {
  it('fim dos 3 próximos meses', () => {
    const o = balanceOutlook(base(), '2026-11-18');
    expect(o.map((x) => x.ym)).toEqual(['2026-12', '2027-01', '2027-02']);
  });
});

describe('meu futuro', () => {
  it('sem juros é soma simples; com juros cresce', () => {
    expect(futureValue(100000, 10000, 0, 12)).toBe(220000);
    expect(futureValue(0, 100000, 12, 12)).toBeGreaterThan(1200000);
  });
  it('aporte necessário bate com o valor futuro', () => {
    const m = monthlyNeeded(5000000, 100000000, 10, 120);
    expect(Math.abs(futureValue(5000000, m, 10, 120) - 100000000)).toBeLessThan(200);
    expect(monthlyNeeded(100000000, 100000000, 10, 12)).toBe(0);
    expect(monthlyNeeded(0, 120000, 0, 12)).toBe(10000);
  });
});
