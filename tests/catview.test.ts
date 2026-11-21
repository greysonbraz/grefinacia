import { describe, expect, it } from 'vitest';
import { brandMark, categoryTxs, cleanMerchant, groupOf, monthSubscriptions, recategorize } from '../src/domain/catview';
import { bankTab } from '../src/domain/bankInvest';
import { emptyData } from '../src/lib/defaults';
import type { BankInvestment, Transaction } from '../src/lib/types';

let n = 0;
const t = (p: Partial<Transaction>): Transaction => ({ id: 'k' + n++, type: 'expense', kind: 'variavel', description: 'X', amountCents: 1000, categoryId: 'outros_gasto', date: '2026-11-05', paymentMethod: 'pix', accountId: 'a', status: 'paid', createdAt: n, ...p });

describe('categoria por dentro', () => {
  it('lista só as despesas da categoria no período, mais recentes primeiro', () => {
    const d = emptyData();
    d.transactions = [t({ date: '2026-11-02' }), t({ date: '2026-11-20' }), t({ categoryId: 'mercado' }), t({ date: '2026-10-30' }), t({ type: 'income', categoryId: 'outros_gasto' })];
    expect(categoryTxs(d, ['outros_gasto'], ['2026-11']).map((x) => x.date)).toEqual(['2026-11-20', '2026-11-02']);
    expect(categoryTxs(d, ['outros_gasto', 'mercado'], ['2026-10', '2026-11'])).toHaveLength(4);
  });
  it('troca a categoria em lote e aprende a regra', () => {
    const a = t({ description: 'Pix enviado - Copeldis 123', categoryId: 'outros_gasto' });
    const b = t({ description: 'Pix enviado - Copeldis 456', categoryId: 'outros_gasto' });
    const r = recategorize([a, b], 'contas', [{ pattern: 'pix enviado copeldis', categoryId: 'outros_gasto' }], true);
    expect(r.txs.map((x) => x.categoryId)).toEqual(['contas', 'contas']);
    expect(r.rules).toEqual([{ pattern: 'pix enviado copeldis', categoryId: 'contas' }]);
    expect(recategorize([a], 'contas', [], false).rules).toEqual([]);
  });
  it('grupos', () => {
    expect(groupOf('contas')).toBe('moradia');
    expect(groupOf('assinaturas')).toBe('digital');
    expect(groupOf('minha_categoria')).toBe('outros');
  });
});

describe('assinaturas com marca própria', () => {
  it('limpa o nome e reconhece serviços conhecidos', () => {
    expect(cleanMerchant('Pix enviado - Netflix.com 1234')).toBe('Netflix.com');
    expect(brandMark('NETFLIX.COM')).toMatchObject({ letter: 'N', known: true });
    expect(brandMark('Google One')).toMatchObject({ letter: 'G', color: '#4285f4' });
    const x = brandMark('Padaria do Zé');
    expect(x).toMatchObject({ letter: 'P', known: false });
    expect(brandMark('Padaria do Zé').color).toBe(x.color);
  });
  it('assinaturas do mês: lançadas e a pagar, sem repetir', () => {
    const d = emptyData();
    d.transactions = [
      t({ description: 'Netflix', categoryId: 'assinaturas', amountCents: 2090, date: '2026-11-21' }),
      t({ description: 'Google One', categoryId: 'assinaturas', amountCents: 1499, date: '2026-11-22', status: 'pending', dueDate: '2026-11-22' }),
      t({ description: 'Netflix', categoryId: 'assinaturas', amountCents: 2090, date: '2026-10-21' }),
    ];
    const s = monthSubscriptions(d, '2026-11-21');
    expect(s.items.map((i) => [i.name, i.paid])).toEqual([['Netflix', true], ['Google One', false]]);
    expect(s.totalCents).toBe(3589);
  });
});

describe('investimentos do banco na aba certa', () => {
  const b = (p: Partial<BankInvestment>): BankInvestment => ({ id: 'i', itemId: 'x', bankName: 'Inter', name: 'X', type: 'OTHER', balanceCents: 1, grossCents: 1, counted: true, countedReason: 'auto', updatedAt: '', ...p } as BankInvestment);
  it('ações/FII vão para Bolsa; CDB para Renda fixa; fundos ficam só no banco', () => {
    expect(bankTab(b({ type: 'EQUITY', subtype: 'STOCK' }))).toBe('bolsa');
    expect(bankTab(b({ type: 'MUTUAL_FUND', subtype: 'REAL_ESTATE_FUND' }))).toBe('bolsa');
    expect(bankTab(b({ type: 'FIXED_INCOME', subtype: 'CDB' }))).toBe('fixa');
    expect(bankTab(b({ type: 'MUTUAL_FUND', subtype: 'MULTIMARKET_FUND' }))).toBeNull();
  });
});
