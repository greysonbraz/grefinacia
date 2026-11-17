import { afterEach, describe, expect, it } from 'vitest';
import { costMonth, monthSummary, setCardMonthMode } from '../src/domain/ledger';
import { cardThisMonthToNext, cumulativeSpending, monthPace, nextMonthForecast } from '../src/domain/home';
import { emptyData } from '../src/lib/defaults';
import type { AppData, Transaction } from '../src/lib/types';
import { KIND_LABEL } from '../src/domain/dollar';

let n = 0;
const t = (p: Partial<Transaction>): Transaction => ({ id: 'x' + n++, type: 'expense', kind: 'variavel', description: 'Gasto', amountCents: 1000, categoryId: 'mercado', date: '2026-11-05', paymentMethod: 'pix', accountId: 'a', status: 'paid', paidDate: p.date ?? '2026-11-05', createdAt: n, ...p });
const card = (date: string, due: string, cents: number, pending: boolean): Transaction => t({ date, dueDate: due, amountCents: cents, kind: 'cartao', cardId: 'c', paymentMethod: 'credito', accountId: pending ? undefined : 'a', status: pending ? 'pending' : 'paid', paidDate: pending ? undefined : due });
const base = (): AppData => ({ ...emptyData(), accounts: [{ id: 'a', name: 'Conta', kind: 'corrente', initialCents: 500000, initialDate: '2026-01-01' }] });
afterEach(() => setCardMonthMode('fatura'));

describe('cartão no mês da fatura (17)', () => {
  it('padrão: a compra conta no mês do vencimento; a escolha "compra" volta ao jeito antigo', () => {
    const d = base();
    d.transactions = [
      t({ date: '2026-11-03', amountCents: 5000 }), // Pix em novembro
      card('2026-10-20', '2026-11-10', 30000, false), // fatura paga em novembro
      card('2026-11-12', '2026-12-10', 20000, true), // compra de novembro, fatura de dezembro
    ];
    expect(monthSummary(d, '2026-11').expenseCents).toBe(35000);
    expect(monthSummary(d, '2026-10').expenseCents).toBe(0);
    expect(monthSummary(d, '2026-12').expenseCents).toBe(20000);
    expect(cumulativeSpending(d, '2026-11', 17).at(-1)).toBe(35000);
    expect(cardThisMonthToNext(d, '2026-11-17')).toBe(20000);
    setCardMonthMode('compra');
    expect(costMonth(d.transactions[1])).toBe('2026-10');
    expect(monthSummary(d, '2026-11').expenseCents).toBe(25000);
  });
  it('previsão do mês que vem: a fatura já lançada entra uma vez só (sem somar de novo na média do dia a dia)', () => {
    const d = base();
    d.transactions = [
      card('2026-09-15', '2026-10-10', 40000, false), // outubro: dia a dia pela fatura
      card('2026-10-15', '2026-11-10', 40000, false), // novembro
      card('2026-11-12', '2026-12-10', 30000, true), // já comprado, fatura de dezembro
    ];
    const f = nextMonthForecast(d, '2026-11-17');
    expect(f.billsCents).toBe(30000);
    // média do dia a dia (outubro, o único mês fechado com dados) = 40000; 30000 já estão na fatura
    expect(f.dailyCents).toBe(10000);
    expect(f.netCents).toBe(-40000);
    expect(monthPace(d, '2026-11-17').spentCents).toBe(40000);
  });
  it('renda fixa em dólar tem tipo próprio', () => {
    expect(KIND_LABEL.deposito).toMatch(/Renda fixa em dólar/);
  });
});
