import { describe, expect, it } from 'vitest';
import { parcelOf, repairCardInstallments } from '../src/domain/installments';
import { emptyData } from '../src/lib/defaults';
import type { AppData, Transaction } from '../src/lib/types';

let n = 0;
const card = { id: 'c', name: 'Inter', closingDay: 30, dueDay: 7, limitCents: 0, accountId: 'a' } as never;
const t = (p: Partial<Transaction>): Transaction => ({ id: 'p' + n++, type: 'expense', kind: 'cartao', description: 'EBN TIKTOK SH SAO P', amountCents: 12014, categoryId: 'compras', date: '2026-11-07', paymentMethod: 'credito', cardId: 'c', status: 'pending', source: 'import', createdAt: n, ...p });
const base = (): AppData => { const d = emptyData(); d.cards = [card]; return d; };

describe('parcelas do cartão vindas do banco', () => {
  it('importadas sem cartão (cartão não existia): voltam para o cartão, cada parcela na sua fatura', () => {
    const d = base();
    d.imports = [{ id: 'imp1', cardId: 'c' } as never];
    const mk = (i: number) => t({ description: `EBN TIKTOK SH SAO PAULO BRA (${i}/10)`, cardId: undefined, accountId: undefined, importId: 'imp1', dueDate: undefined, status: 'paid', paidDate: '2026-11-07' });
    d.transactions = [...Array.from({ length: 10 }, (_, i) => mk(i + 1)), t({ description: 'Mercado', cardId: undefined, accountId: undefined, importId: 'imp1', dueDate: undefined, status: 'paid', date: '2026-11-10' })];
    const fix = repairCardInstallments(d, '2026-11-21');
    expect(fix).toHaveLength(11);
    expect(fix.every((x) => x.cardId === 'c' && x.paymentMethod === 'credito')).toBe(true);
    const parc = fix.filter((x) => x.installment).sort((a, b) => a.installment!.number - b.installment!.number);
    expect(parc.map((x) => x.dueDate).slice(0, 2)).toEqual(['2026-12-07', '2027-01-07']);
    expect(fix.find((x) => x.description === 'Mercado')).toMatchObject({ dueDate: '2026-12-07', status: 'pending' });
    d.transactions = d.transactions.map((x) => fix.find((f) => f.id === x.id) ?? x);
    expect(repairCardInstallments(d, '2026-11-21')).toEqual([]);
  });
  it('cartão recriado (id antigo) e vencimento igual à data da compra: acha o cartão e corrige', () => {
    const d = base();
    d.imports = [{ id: 'imp1', cardId: 'c' } as never];
    d.transactions = Array.from({ length: 10 }, (_, i) => t({ description: `EBN TIKTOK SH SAO PAULO BRA (${i + 1}/10)`, cardId: 'velho', importId: 'imp1', dueDate: '2026-11-07', status: 'paid', paidDate: '2026-11-07' }));
    const fix = repairCardInstallments(d, '2026-11-21').sort((a, b) => a.installment!.number - b.installment!.number);
    expect(fix).toHaveLength(10);
    expect(fix.every((x) => x.cardId === 'c')).toBe(true);
    expect(fix.map((x) => x.dueDate).slice(0, 3)).toEqual(['2026-12-07', '2027-01-07', '2027-02-07']);
    expect(fix.every((x) => x.status === 'pending')).toBe(true);
  });
  it('lê "(n/m)" da descrição', () => {
    expect(parcelOf('EBN TIKTOK SH SAO P (2/10)')).toEqual({ n: 2, m: 10, base: 'EBN TIKTOK SH SAO P' });
    expect(parcelOf('Mercado')).toBeNull();
    expect(parcelOf('X (0/3)')).toBeNull();
  });
  it('10 parcelas com a mesma data: cada uma vai para a sua fatura', () => {
    const d = base();
    const first = '2026-12-07';
    d.transactions = Array.from({ length: 10 }, (_, i) => t({ description: `EBN TIKTOK SH SAO P (${i + 1}/10)`, dueDate: first }));
    const fix = repairCardInstallments(d, '2026-11-21');
    expect(fix).toHaveLength(10);
    const due = fix.sort((a, b) => a.installment!.number - b.installment!.number).map((x) => x.dueDate);
    expect(due).toEqual(['2026-12-07', '2027-01-07', '2027-02-07', '2027-03-07', '2027-04-07', '2027-05-07', '2027-06-07', '2027-07-07', '2027-08-07', '2027-09-07']);
    expect(new Set(fix.map((x) => x.installment!.groupId)).size).toBe(1);
    expect(fix.every((x) => x.status === 'pending')).toBe(true);
    // depois do ajuste, nada mais a mudar (idempotente)
    d.transactions = fix;
    expect(repairCardInstallments(d, '2026-11-21')).toEqual([]);
  });
  it('vencimento vindo da fatura do banco é mantido; parcela sozinha (data já é a da parcela) não muda', () => {
    const d = base();
    d.transactions = [t({ description: 'Loja (1/3)', dueDate: '2026-12-07' }), t({ description: 'Loja (2/3)', dueDate: '2027-01-07' })];
    expect(repairCardInstallments(d, '2026-11-21').map((x) => x.dueDate)).toEqual(['2026-12-07', '2027-01-07']);
    const e = base();
    e.transactions = [t({ description: 'Amazon (5/9)', date: '2026-11-14', dueDate: '2026-12-07' })];
    expect(repairCardInstallments(e, '2026-11-21')).toEqual([]);
  });
  it('lançado à mão não é tocado', () => {
    const d = base();
    d.transactions = [t({ description: 'X (1/2)', source: 'manual' }), t({ description: 'X (2/2)', source: 'manual' })];
    expect(repairCardInstallments(d, '2026-11-21')).toEqual([]);
  });
});

describe('parcelamentos em andamento', () => {
  it('quanto falta e até quando', async () => {
    const { installmentPlans } = await import('../src/domain/installments');
    const d = base();
    d.transactions = Array.from({ length: 10 }, (_, i) => t({ description: `TIKTOK (${i + 1}/10)`, amountCents: 12014, installment: { groupId: 'g', number: i + 1, total: 10 }, dueDate: `2026-${String(i + 9).padStart(2, '0')}-07`.replace('2026-13', '2027-01').replace('2026-14', '2027-02').replace('2026-15', '2027-03').replace('2026-16', '2027-04').replace('2026-17', '2027-05').replace('2026-18', '2027-06') }));
    const [p] = installmentPlans(d, '2026-11-21');
    expect(p).toMatchObject({ name: 'TIKTOK', total: 10, paid: 3, left: 7, perCents: 12014, nextDue: '2026-12-07', lastDue: '2027-06-07' });
  });
});
