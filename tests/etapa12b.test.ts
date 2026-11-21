import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDB } from 'idb';
import { applyBankCategories, categoryFromBank, neutralKind, toStatement } from '../src/domain/bankSync';
import { buildPreview } from '../src/domain/importer';
import { forgetPluggyKey, type PluggyAccount, type PluggyTransaction } from '../src/services/pluggy';
import { DEFAULT_SETTINGS, emptyData } from '../src/lib/defaults';
import { closeDB } from '../src/db/db';
import { setSecretStoreForTests } from '../src/services/secrets';
import { getState, init, linkBankAccount, reimportBank, startAccountAtBankBalance, syncBank, undoImport, updateSettings, upsert } from '../src/state/store';
import { accountBalance } from '../src/domain/ledger';

const res = (status: number, body: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
afterEach(() => { vi.unstubAllGlobals(); forgetPluggyKey(); });
const CHECKING: PluggyAccount = { id: 'acc-1', itemId: 'item-1', type: 'BANK', subtype: 'CHECKING_ACCOUNT', name: 'Conta Corrente', number: '12345-6', balance: 1000, currencyCode: 'BRL' };
const tx = (p: Partial<PluggyTransaction>): PluggyTransaction => ({ id: 'p' + Math.random(), description: 'Compra', amount: -10, date: '2026-11-10T00:00:00.000Z', type: 'DEBIT', status: 'POSTED', currencyCode: 'BRL', providerId: null, category: null, ...p });

describe('categorias e movimentações neutras (12b)', () => {
  it('categoria da Pluggy vira a do app, respeitando receita × despesa', () => {
    expect(categoryFromBank('Food delivery', 'expense')).toBe('alimentacao');
    expect(categoryFromBank('Groceries', 'expense')).toBe('mercado');
    expect(categoryFromBank('Gas stations', 'expense')).toBe('transporte');
    expect(categoryFromBank('Salary', 'income')).toBe('salario');
    expect(categoryFromBank('Salary', 'expense')).toBeNull();
    expect(categoryFromBank('Transfer - PIX', 'expense')).toBeNull();
    expect(categoryFromBank(undefined, 'expense')).toBeNull();
  });
  it('entre contas suas e investimento não são gasto; Pix para outra pessoa é', () => {
    expect(neutralKind('Same person transfer - PIX', 'PIX ENVIADO')).toBe('propria');
    expect(neutralKind('Fixed income', 'APLICACAO')).toBe('investimento');
    expect(neutralKind(undefined, 'APLICACAO CDB LIQUIDEZ DIARIA')).toBe('investimento');
    expect(neutralKind(undefined, 'Resgate automático')).toBe('investimento');
    expect(neutralKind('Proceeds interests and dividends', 'RENDIMENTO')).toBeNull();
    expect(neutralKind('Transfer - PIX', 'PIX ENVIADO JOAO')).toBeNull();
  });
  it('a prévia usa a categoria do banco, mas sua regra vence', () => {
    const st = toStatement(CHECKING, [tx({ description: 'IFD*RESTAURANTE X', category: 'Food delivery' }), tx({ description: 'LOJA QUALQUER', category: 'Clothing' })]);
    const data = emptyData();
    const rows = applyBankCategories(buildPreview(st, { kind: 'conta', accountId: 'a' }, data, { ...DEFAULT_SETTINGS, importRules: [{ pattern: 'loja qualquer', categoryId: 'presentes' }] }));
    expect(rows.map((r) => [r.categoryId, r.categorySource])).toEqual([['alimentacao', 'banco'], ['presentes', 'regra']]);
  });
});

describe('no app (12b)', () => {
  beforeEach(async () => {
    await closeDB();
    await deleteDB('grefinacia');
    setSecretStoreForTests(null);
  });

  it('transferência e investimento mexem só no saldo; saldo do banco; refazer e desfazer', async () => {
    await init();
    await upsert('accounts', { id: 'old', name: 'Conta principal', kind: 'corrente', initialCents: 0, initialDate: '2020-01-01' });
    await updateSettings({ bank: { ...DEFAULT_SETTINGS.bank, clientId: 'id', clientSecret: 'sec', items: [{ itemId: 'item-1', label: 'Inter' }] } });
    const txs = [
      tx({ id: 'a', providerId: 'A', description: 'IFOOD', amount: -50, category: 'Food delivery', date: '2026-11-05T00:00:00.000Z' }),
      tx({ id: 'b', providerId: 'B', description: 'PIX ENVIADO GREYSON', amount: -500, category: 'Same person transfer - PIX', date: '2026-11-06T00:00:00.000Z' }),
      tx({ id: 'c', providerId: 'C', description: 'APLICACAO CDB', amount: -300, category: 'Fixed income', date: '2026-11-07T00:00:00.000Z' }),
      tx({ id: 'd', providerId: 'D', description: 'SALARIO EMPRESA', amount: 2000, type: 'CREDIT', category: 'Salary', date: '2026-11-08T00:00:00.000Z' }),
    ];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      if (u.endsWith('/auth')) return res(200, { apiKey: 'K' });
      if (u.includes('/items/')) return res(200, { id: 'item-1', status: 'UPDATED', lastUpdatedAt: '2026-11-16T09:00:00.000Z', connector: { name: 'Banco Inter' } });
      if (u.includes('/accounts')) return res(200, { results: [CHECKING] });
      if (u.includes('/v2/transactions')) return res(200, { results: txs, next: null });
      return res(404, {});
    }));
    await syncBank();
    await linkBankAccount('acc-1', 'conta:old');
    const r = await syncBank();
    expect(r.imported).toBe(4);
    const d = getState().data;
    const imp = d.transactions.filter((t) => t.source === 'import');
    expect(imp.map((t) => [t.description, t.categoryId])).toEqual([['IFOOD', 'alimentacao'], ['SALARIO EMPRESA', 'salario']]);
    expect(d.transfers.map((t) => [t.kind, t.fromAccountId, t.toAccountId, t.amountCents])).toEqual([['propria', 'old', '', 50000], ['investimento', 'old', '', 30000]]);
    expect(getState().bank.report![0]).toMatchObject({ imported: 2, moved: 2 });
    // conta antiga: o histórico mexeu no saldo (2000 - 50 - 500 - 300)
    expect(accountBalance(d.accounts.find((a) => a.id === 'old')!, d)).toBe(115000);

    // de novo: nada repetido, nem transferência
    expect((await syncBank()).imported).toBe(0);
    expect(getState().data.transfers).toHaveLength(2);

    // começar com o saldo do banco: R$ 1.000 a partir de 17/11; nada apagado
    await startAccountAtBankBalance('old');
    const acc = getState().data.accounts.find((a) => a.id === 'old')!;
    expect(acc).toMatchObject({ initialCents: 100000, initialDate: '2026-11-17' });
    expect(accountBalance(acc, getState().data)).toBe(100000);
    expect(getState().data.transactions.filter((t) => t.source === 'import')).toHaveLength(2);

    // lançamento manual fica no refazer
    await upsert('transactions', { id: 'man', type: 'expense', kind: 'variavel', description: 'Feira', amountCents: 1000, categoryId: 'mercado', date: '2026-11-09', paymentMethod: 'dinheiro', accountId: 'old', status: 'paid', paidDate: '2026-11-09', source: 'manual', createdAt: 1 });
    const again = await reimportBank();
    expect(again.imported).toBe(4);
    expect(getState().data.transactions.filter((t) => t.source === 'import')).toHaveLength(2);
    expect(getState().data.transfers).toHaveLength(2);
    expect(getState().data.transactions.some((t) => t.id === 'man')).toBe(true);

    // desfazer um lote apaga também as transferências dele
    const batch = getState().data.imports.find((b) => !b.undoneAt)!;
    await undoImport(batch.id);
    expect(getState().data.transfers).toHaveLength(0);
    expect(getState().data.transactions.filter((t) => t.source === 'import')).toHaveLength(0);
    await new Promise((r2) => setTimeout(r2, 600));
  });
});
