import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDB } from 'idb';
import { neutralKind, toStatement } from '../src/domain/bankSync';
import { buildPreview, buildTransactions } from '../src/domain/importer';
import { cardBills } from '../src/domain/bills';
import { forgetPluggyKey, type PluggyAccount, type PluggyTransaction } from '../src/services/pluggy';
import { DEFAULT_SETTINGS, emptyData } from '../src/lib/defaults';
import type { AppData } from '../src/lib/types';
import { closeDB } from '../src/db/db';
import { setSecretStoreForTests } from '../src/services/secrets';
import { applyCambio, getState, init, linkBankAccount, syncBank, updateSettings, upsert } from '../src/state/store';

const res = (status: number, body: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
afterEach(() => { vi.unstubAllGlobals(); forgetPluggyKey(); });
const CARD: PluggyAccount = { id: 'acc-c', itemId: 'item-1', type: 'CREDIT', subtype: 'CREDIT_CARD', name: 'PLATINUM', number: '1568', balance: 1894.43, currencyCode: 'BRL', creditData: { creditLimit: 6940, availableCreditLimit: 493.21, balanceCloseDate: '2026-11-30', balanceDueDate: '2026-12-07' } };
const tx = (p: Partial<PluggyTransaction>): PluggyTransaction => ({ id: 'p' + Math.random(), description: 'Compra', amount: 10, date: '2026-11-10T00:00:00.000Z', type: 'DEBIT', status: 'POSTED', currencyCode: 'BRL', providerId: null, ...p });

describe('faturas pelo banco (18)', () => {
  it('a compra vai para a fatura que o banco informou; sem fatura, pelo dia de fechamento', () => {
    const data: AppData = { ...emptyData(), cards: [{ id: 'c', name: 'Inter', closingDay: 30, dueDay: 7, accountId: 'a' }] };
    const st = toStatement(CARD, [
      tx({ id: 'x1', description: 'LOJA (2/5)', amount: 100, date: '2026-12-01T00:00:00.000Z', status: 'PENDING', creditCardMetadata: { installmentNumber: 2, totalInstallments: 5, billId: 'b-dez' } }),
      tx({ id: 'x2', description: 'MERCADO', amount: 50, date: '2026-11-15T00:00:00.000Z', status: 'PENDING' }),
    ], { 'b-dez': '2026-12-07' });
    expect(st.rows.map((r) => r.dueDate)).toEqual(['2026-12-07', undefined]);
    const rows = buildPreview(st, { kind: 'cartao', cardId: 'c' }, data, DEFAULT_SETTINGS);
    const built = buildTransactions(rows, { kind: 'cartao', cardId: 'c' }, data, 'imp', () => 't' + Math.random(), '2026-11-17');
    expect(built.map((t) => [t.description, t.dueDate, t.status])).toEqual([['LOJA (2/5)', '2026-12-07', 'pending'], ['MERCADO', '2026-12-07', 'pending']]);
  });
  it('faturas mês a mês: paga, aberta, futura; total do banco para conferir', () => {
    const data: AppData = emptyData();
    const base = { type: 'expense' as const, kind: 'cartao' as const, categoryId: 'compras', paymentMethod: 'credito' as const, cardId: 'c', createdAt: 1 };
    data.transactions = [
      { ...base, id: '1', description: 'A', amountCents: 10000, date: '2026-10-20', dueDate: '2026-11-07', status: 'paid', paidDate: '2026-11-07' },
      { ...base, id: '2', description: 'B', amountCents: 20000, date: '2026-11-10', dueDate: '2026-12-07', status: 'pending' },
      { ...base, id: '3', type: 'income', kind: 'outro_rendimento', description: 'Estorno', amountCents: 5000, date: '2026-11-12', dueDate: '2026-12-07', status: 'paid', paidDate: '2026-11-12' },
      { ...base, id: '4', description: 'C (3/5)', amountCents: 7000, date: '2027-01-01', dueDate: '2027-01-07', status: 'pending' },
    ];
    const b = cardBills(data, 'c', '2026-11-17', [{ dueDate: '2026-12-07', totalCents: 15000 }, { dueDate: '2027-02-07', totalCents: 3000 }]);
    expect(b.map((x) => [x.dueDate, x.status, x.totalCents, x.bankTotalCents])).toEqual([
      ['2026-11-07', 'paga', 10000, undefined],
      ['2026-12-07', 'aberta', 15000, 15000],
      ['2027-01-07', 'futura', 7000, undefined],
      ['2027-02-07', 'futura', 0, 3000],
    ]);
  });
  it('compra de dólar não é gasto', () => {
    expect(neutralKind('Transfer - Foreign exchange', 'X')).toBe('cambio');
    expect(neutralKind(undefined, 'CÂMBIO GLOBAL ACCOUNT')).toBe('cambio');
    expect(neutralKind(undefined, 'Compra de dólar')).toBe('cambio');
  });
});

describe('no app (18)', () => {
  beforeEach(async () => {
    await closeDB();
    await deleteDB('grefinacia');
    setSecretStoreForTests(null);
  });
  it('busca faturas, acerta compra que mudou de fatura e soma câmbio na conta em dólar', async () => {
    await init();
    await upsert('accounts', { id: 'a', name: 'Conta', kind: 'corrente', initialCents: 0, initialDate: '2026-01-01' });
    await updateSettings({ bank: { ...DEFAULT_SETTINGS.bank, clientId: 'id', clientSecret: 'sec', items: [{ itemId: 'item-1', label: 'Inter' }] } });
    let billOf = 'b-dez';
    const CHECK: PluggyAccount = { id: 'acc-1', itemId: 'item-1', type: 'BANK', subtype: 'CHECKING_ACCOUNT', name: 'Conta', balance: 100, currencyCode: 'BRL' };
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      if (u.endsWith('/auth')) return res(200, { apiKey: 'K' });
      if (u.includes('/items/')) return res(200, { id: 'item-1', status: 'UPDATED', connector: { name: 'Banco Inter' } });
      if (u.includes('/accounts')) return res(200, { results: [CHECK, CARD] });
      if (u.includes('/bills')) return res(200, { page: 1, totalPages: 1, results: [{ id: 'b-dez', dueDate: '2026-12-07T00:00:00', totalAmount: 100 }, { id: 'b-jan', dueDate: '2027-01-07T00:00:00', totalAmount: 0 }] });
      if (u.includes('/investments')) return res(200, { results: [] });
      if (u.includes('accountId=acc-c')) return res(200, { results: [tx({ id: 'k1', providerId: 'K1', description: 'LOJA', amount: 100, status: 'PENDING', date: '2026-11-15T00:00:00.000Z', creditCardMetadata: { billId: billOf } })], next: null });
      if (u.includes('accountId=acc-1')) return res(200, { results: [tx({ id: 'c1', providerId: 'C1', description: 'CAMBIO CONTA GLOBAL', amount: 573.24, type: 'DEBIT', date: '2026-11-16T00:00:00.000Z' })], next: null });
      return res(404, {});
    }));
    await syncBank();
    await linkBankAccount('acc-1', 'conta:a');
    await linkBankAccount('acc-c', 'novo');
    await syncBank();
    const card = getState().data.transactions.find((t) => t.fitId === 'of:K1')!;
    expect(card.dueDate).toBe('2026-12-07');
    expect(getState().bank.bills?.['acc-c']?.map((b) => b.totalCents)).toEqual([10000, 0]);
    // o banco passou a compra para a fatura de janeiro
    billOf = 'b-jan';
    await syncBank();
    expect(getState().data.transactions.find((t) => t.fitId === 'of:K1')!.dueDate).toBe('2027-01-07');
    // câmbio virou transferência (não gasto) e pode ser somado na conta em dólar
    const tr = getState().data.transfers.find((t) => t.kind === 'cambio')!;
    expect(tr).toMatchObject({ fromAccountId: 'a', amountCents: 57324 });
    expect(getState().data.transactions.some((t) => t.description.includes('CAMBIO'))).toBe(false);
    await upsert('usdHoldings', { id: 'g', kind: 'conta', name: 'Conta Global', balanceUsdCents: 547, updatedAt: '' });
    await applyCambio(tr.id, 'g', 10000);
    expect(getState().data.usdHoldings[0].balanceUsdCents).toBe(10547);
    expect(getState().data.transfers.find((t) => t.id === tr.id)!.usdApplied).toBe(true);
    await new Promise((r) => setTimeout(r, 600));
  });
});
