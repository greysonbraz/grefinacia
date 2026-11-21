import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDB } from 'idb';
import { neutralKind, pixOnCreditPairs } from '../src/domain/bankSync';
import type { PreviewRow } from '../src/domain/importer';
import { KIND_LABEL, holdingUsd } from '../src/domain/dollar';
import { forgetPluggyKey, type PluggyAccount, type PluggyTransaction } from '../src/services/pluggy';
import { DEFAULT_SETTINGS } from '../src/lib/defaults';
import { closeDB } from '../src/db/db';
import { setSecretStoreForTests } from '../src/services/secrets';
import { getState, init, linkBankAccount, syncBank, updateSettings, upsert } from '../src/state/store';

const res = (status: number, body: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
afterEach(() => { vi.unstubAllGlobals(); forgetPluggyKey(); });
const row = (key: string, type: 'income' | 'expense', description: string, cents: number, date = '2026-09-22'): PreviewRow => ({ key, type, amountCents: cents, categoryId: 'x', categorySource: 'padrao', include: true, row: { date, amount: type === 'income' ? cents : -cents, description } });

describe('regras do extrato (19)', () => {
  it('formatos de extrato de conta: câmbio, investimento e pontos', () => {
    expect(neutralKind(undefined, 'Depósito Global Account')).toBe('cambio');
    expect(neutralKind(undefined, 'IOF Global Account')).toBe('cambio');
    expect(neutralKind(undefined, 'Cred Pontos Conta Global Resgate Pontos')).toBeNull();
    expect(neutralKind(undefined, 'Cdb Porq Obj Banco X S A')).toBe('investimento');
    expect(neutralKind(undefined, 'Resgate Cdb Porquinho Banco X')).toBe('investimento');
    expect(neutralKind(undefined, 'Cred Pontos Meu Porquinho Resgate Pontos')).toBeNull();
    expect(neutralKind(undefined, 'Crédito Resgate Fundo Fundo X Conservador Firf Lp')).toBe('investimento');
    expect(neutralKind(undefined, 'Débito B3 Nota Bov 06/11/2026')).toBe('investimento');
    expect(neutralKind(undefined, 'Crédito Evento B3 Prov Rendimento SNEL11')).toBeNull();
    expect(neutralKind(undefined, 'Pix enviado Copel')).toBeNull();
  });
  it('Pix no crédito: crédito liberado + Pix do mesmo valor no mesmo dia saem da conta', () => {
    const rows = [row('a', 'income', 'Crédito liberado Pix No Crédito', 10143), row('b', 'expense', 'Pix enviado Provedor', 10143), row('c', 'expense', 'Pix enviado Outro', 10143, '2026-09-23'), row('d', 'income', 'Pix recebido', 5000)];
    expect([...pixOnCreditPairs(rows)].sort()).toEqual(['a', 'b']);
  });
  it('dólar: bonds e fundos no exterior pelo saldo informado', () => {
    expect(KIND_LABEL.bond).toMatch(/Bonds/);
    expect(holdingUsd({ id: 'b', kind: 'bond', name: 'Treasury', balanceUsdCents: 10000, updatedAt: '' })).toBe(10000);
  });
});

describe('no app (19)', () => {
  beforeEach(async () => {
    await closeDB();
    await deleteDB('grefinacia');
    setSecretStoreForTests(null);
  });
  it('dias do cartão vêm da fatura do banco e refazem o vencimento das compras sem fatura', async () => {
    await init();
    await upsert('accounts', { id: 'a', name: 'Conta', kind: 'corrente', initialCents: 0, initialDate: '2026-01-01' });
    await updateSettings({ bank: { ...DEFAULT_SETTINGS.bank, clientId: 'id', clientSecret: 'sec', items: [{ itemId: 'item-1', label: 'Inter' }] } });
    // cadastro do cartão no banco com fechamento errado (dia 23)
    const CARD: PluggyAccount = { id: 'acc-c', itemId: 'item-1', type: 'CREDIT', subtype: 'CREDIT_CARD', name: 'PLATINUM', balance: 0, currencyCode: 'BRL', creditData: { creditLimit: 1000, balanceCloseDate: '2026-11-23', balanceDueDate: '2026-12-07' } };
    const t: PluggyTransaction = { id: 'k', providerId: 'K', description: 'LOJA', amount: 100, date: '2026-11-25T00:00:00.000Z', type: 'DEBIT', status: 'PENDING', currencyCode: 'BRL' };
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      if (u.endsWith('/auth')) return res(200, { apiKey: 'K' });
      if (u.includes('/items/')) return res(200, { id: 'item-1', status: 'UPDATED' });
      if (u.includes('/accounts')) return res(200, { results: [CARD] });
      if (u.includes('/bills')) return res(200, { results: [{ id: 'b-nov', dueDate: '2026-11-07T00:00:00', billClosingDate: '2026-10-30T00:00:00', totalAmount: 1 }] });
      if (u.includes('/investments')) return res(200, { results: [] });
      if (u.includes('/v2/transactions')) return res(200, { results: [t], next: null });
      return res(404, {});
    }));
    await syncBank();
    await linkBankAccount('acc-c', 'novo');
    expect(getState().data.cards[0]).toMatchObject({ closingDay: 23, dueDay: 7 });
    await syncBank();
    expect(getState().data.cards[0]).toMatchObject({ closingDay: 30, dueDay: 7 });
    // comprada dia 25/11: com fechamento no dia 30, vai para a fatura de 07/12 (não 07/01)
    expect(getState().data.transactions.find((x) => x.fitId === 'of:K')!.dueDate).toBe('2026-12-07');
    await new Promise((r) => setTimeout(r, 600));
  });
});
