import { describe, expect, it } from 'vitest';
import { cumulativeSpending, monthPace, nextMonthForecast, topCategories } from '../src/domain/home';
import { emptyData } from '../src/lib/defaults';
import type { AppData, Transaction } from '../src/lib/types';

let n = 0;
const t = (p: Partial<Transaction>): Transaction => ({ id: 'x' + n++, type: 'expense', kind: 'variavel', description: 'Gasto', amountCents: 1000, categoryId: 'mercado', date: '2026-11-01', paymentMethod: 'pix', accountId: 'a', status: 'paid', paidDate: p.date ?? '2026-11-01', createdAt: n, ...p });
const base = (): AppData => ({ ...emptyData(), accounts: [{ id: 'a', name: 'Conta', kind: 'corrente', initialCents: 500000, initialDate: '2026-01-01' }] });

describe('tela inicial: gasto do mês e previsão', () => {
  it('gasto acumulado dia a dia, só despesas do mês, pela data da compra', () => {
    const d = base();
    d.transactions = [t({ date: '2026-11-01', amountCents: 1000 }), t({ date: '2026-11-03', amountCents: 500 }), t({ date: '2026-11-03', type: 'income', amountCents: 9999 }), t({ date: '2026-10-31', amountCents: 7777 })];
    expect(cumulativeSpending(d, '2026-11', 4)).toEqual([1000, 1000, 1500, 1500]);
    expect(cumulativeSpending(d, '2026-11')).toHaveLength(30);
  });
  it('maiores categorias com porcentagem; o resto somado', () => {
    const d = base();
    d.transactions = [t({ categoryId: 'mercado', amountCents: 6000 }), t({ categoryId: 'transporte', amountCents: 3000 }), t({ categoryId: 'lazer', amountCents: 1000 })];
    const r = topCategories(d, '2026-11', 2);
    expect(r.items.map((i) => [i.categoryId, Math.round(i.pct)])).toEqual([['mercado', 60], ['transporte', 30]]);
    expect(r.otherCents).toBe(1000);
    expect(r.totalCents).toBe(10000);
  });
  it('ritmo: compara com o mesmo dia do mês passado e projeta o mês com contas a vencer e recorrências', () => {
    const d = base();
    d.transactions = [
      t({ date: '2026-10-05', amountCents: 2000 }), t({ date: '2026-10-25', amountCents: 8000 }),
      t({ date: '2026-11-05', amountCents: 3000 }),
      t({ date: '2026-11-25', amountCents: 4000, kind: 'fixa', status: 'pending', paidDate: undefined, dueDate: '2026-11-25' }),
    ];
    d.recurrences = [{ id: 'r', type: 'expense', kind: 'fixa', description: 'Internet', amountCents: 1500, categoryId: 'contas', dayOfMonth: 20, startMonth: '2026-01', active: true, paymentMethod: 'pix', accountId: 'a' } as never];
    const p = monthPace(d, '2026-11-17');
    expect(p).toMatchObject({ spentCents: 3000, lastMonthSameDayCents: 2000, lastMonthTotalCents: 10000, day: 17, days: 30 });
    // 3000 já gasto + 4000 a vencer + 1500 recorrente + dia a dia (média de outubro 10000 − 3000 já gastos no dia a dia)
    expect(p.projectedCents).toBe(3000 + 4000 + 1500 + 7000);
  });
  it('mês que vem: entradas, contas, dia a dia e saldo previsto', () => {
    const d = base();
    d.transactions = [
      t({ date: '2026-10-10', amountCents: 6000 }),
      t({ date: '2026-12-05', type: 'income', kind: 'salario', categoryId: 'salario', amountCents: 300000, status: 'pending', paidDate: undefined }),
      t({ date: '2026-11-20', amountCents: 20000, kind: 'cartao', status: 'pending', paidDate: undefined, dueDate: '2026-12-10', cardId: 'c', accountId: undefined }),
    ];
    const f = nextMonthForecast(d, '2026-11-17');
    expect(f.ym).toBe('2026-12');
    expect(f).toMatchObject({ incomeCents: 300000, billsCents: 20000 });
    expect(f.netCents).toBe(300000 - 20000 - f.dailyCents - f.debtCents);
  });
});
