import { describe, expect, it } from 'vitest';
import { periodRange, txContext } from '../src/domain/period';
import { emptyData } from '../src/lib/defaults';
import type { Transaction } from '../src/lib/types';

let n = 0;
const t = (p: Partial<Transaction>): Transaction => ({ id: 'p' + n++, type: 'expense', kind: 'variavel', description: 'Mercado Bom', amountCents: 1000, categoryId: 'mercado', date: '2026-11-05', paymentMethod: 'pix', accountId: 'a', status: 'paid', createdAt: n, ...p });

describe('filtro por período', () => {
  it('7, 30 e 90 dias contam o dia de hoje', () => {
    expect(periodRange('7', '2026-11-18')).toEqual({ from: '2026-11-12', to: '2026-11-18' });
    expect(periodRange('30', '2026-11-18')).toEqual({ from: '2026-10-20', to: '2026-11-18' });
    expect(periodRange('90', '2026-11-18')!.from).toBe('2026-08-21');
  });
  it('datas escolhidas: invertidas são corrigidas; incompletas não filtram', () => {
    expect(periodRange('custom', '2026-11-18', '2026-11-10', '2026-11-01')).toEqual({ from: '2026-11-01', to: '2026-11-10' });
    expect(periodRange('custom', '2026-11-18', '2026-11-10', '')).toBeNull();
    expect(periodRange('', '2026-11-18')).toBeNull();
  });
});

describe('detalhe da movimentação', () => {
  it('vezes anteriores com a mesma descrição e total da categoria no mês', () => {
    const d = emptyData();
    const a = t({ date: '2026-11-05', amountCents: 5000 });
    d.transactions = [a, t({ description: 'mercado bom ', date: '2026-10-02', amountCents: 4000 }), t({ description: 'Outro', date: '2026-11-07', amountCents: 2000 }), t({ type: 'income', description: 'Mercado Bom', categoryId: 'salario' })];
    const c = txContext(d, a);
    expect(c.similar.map((x) => x.amountCents)).toEqual([4000]);
    expect(c.categoryMonthCents).toBe(7000);
    expect(c.categoryMonthCount).toBe(2);
  });
});
