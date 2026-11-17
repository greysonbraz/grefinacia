import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDB } from 'idb';
import { autoSelect, balanceGap, consentWarning, newAccountFor, newCardFor, syncFrom, targetFor, toStatement } from '../src/domain/bankSync';
import { buildPreview } from '../src/domain/importer';
import { forgetPluggyKey, listTransactions, pluggyApiKey, type PluggyAccount, type PluggyTransaction } from '../src/services/pluggy';
import { DEFAULT_SETTINGS, emptyData } from '../src/lib/defaults';
import type { AppData } from '../src/lib/types';
import { closeDB } from '../src/db/db';
import { setSecretStoreForTests } from '../src/services/secrets';
import { AUTO_BANK_HOURS, autoSyncBank, getState, init, linkBankAccount, syncBank, updateSettings, upsert } from '../src/state/store';
import { accountBalance } from '../src/domain/ledger';

const TODAY = '2026-11-17';
const res = (status: number, body: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
afterEach(() => { vi.unstubAllGlobals(); forgetPluggyKey(); });

// Formatos conferidos na documentação da Pluggy (docs.pluggy.ai, 17/11/2026)
const CHECKING: PluggyAccount = { id: 'acc-1', itemId: 'item-1', type: 'BANK', subtype: 'CHECKING_ACCOUNT', name: 'Conta Corrente', number: '12345-6', balance: 1234.56, currencyCode: 'BRL' };
const CARD: PluggyAccount = { id: 'acc-2', itemId: 'item-1', type: 'CREDIT', subtype: 'CREDIT_CARD', name: 'Mastercard Black', number: '9876', balance: 300, currencyCode: 'BRL', creditData: { creditLimit: 5000, availableCreditLimit: 4700, balanceCloseDate: '2026-11-03', balanceDueDate: '2026-11-10' } };
const tx = (p: Partial<PluggyTransaction>): PluggyTransaction => ({ id: 'p' + Math.random(), description: 'Compra', amount: -10, date: '2026-11-10T00:00:00.000Z', type: 'DEBIT', status: 'POSTED', currencyCode: 'BRL', providerId: null, ...p });

describe('conversão das transações da Pluggy', () => {
  it('conta: sai pelo tipo DEBIT, entra pelo CREDIT; pendentes (agendados) ficam de fora; id estável do banco', () => {
    const st = toStatement(CHECKING, [
      tx({ description: 'PIX ENVIADO PADARIA', amount: -12.5, type: 'DEBIT', providerId: 'BANK-1' }),
      tx({ description: 'SALARIO EMPRESA', amount: 3500, type: 'CREDIT' }),
      tx({ description: 'BOLETO AGENDADO', amount: -200, type: 'DEBIT', status: 'PENDING', date: '2026-11-25T00:00:00.000Z' }),
    ]);
    expect(st.kind).toBe('conta');
    expect(st.rows.map((r) => [r.description, r.amount])).toEqual([['PIX ENVIADO PADARIA', -1250], ['SALARIO EMPRESA', 350000]]);
    expect(st.rows[0].fitId).toBe('of:BANK-1');
    expect(st.rows[1].fitId).toMatch(/^pg:/);
    expect(st.skipped.pending).toBe(1);
  });
  it('cartão: positivo é compra, negativo é estorno; pagamento da fatura fica de fora; parcela ganha (n/N)', () => {
    const st = toStatement(CARD, [
      tx({ description: 'MERCADO LIVRE', amount: 150, type: 'DEBIT', status: 'PENDING', creditCardMetadata: { installmentNumber: 2, totalInstallments: 6 } }),
      tx({ description: 'ESTORNO LOJA X', amount: -40, type: 'CREDIT' }),
      tx({ description: 'PAGAMENTO RECEBIDO', amount: -900, type: 'CREDIT' }),
    ]);
    expect(st.kind).toBe('cartao');
    expect(st.rows.map((r) => [r.description, r.amount])).toEqual([['MERCADO LIVRE (2/6)', -15000], ['ESTORNO LOJA X', 4000]]);
    expect(st.skipped.payments).toBe(1);
  });
  it('moeda estrangeira só entra com o valor em reais', () => {
    const st = toStatement(CARD, [tx({ amount: 20, currencyCode: 'USD' }), tx({ description: 'NETFLIX US', amount: 9.99, currencyCode: 'USD', amountInAccountCurrency: 55.3 })]);
    expect(st.rows.map((r) => r.amount)).toEqual([-5530]);
    expect(st.skipped.foreign).toBe(1);
  });
});

describe('regras da sincronização', () => {
  it('entra sozinho só o que a prévia marcaria; fatura no extrato da conta só sem cartão sincronizado', () => {
    const rows = [{ flag: undefined }, { flag: 'possivel' }, { flag: 'importado' }, { flag: 'fatura' }].map((r, i) => ({ key: String(i), row: { date: TODAY, amount: -1, description: 'x' }, type: 'expense' as const, amountCents: 1, categoryId: 'x', categorySource: 'padrao' as const, include: false, ...r })) as Parameters<typeof autoSelect>[0];
    expect(autoSelect(rows, true).map((r) => r.include)).toEqual([true, false, false, false]);
    expect(autoSelect(rows, false).map((r) => r.include)).toEqual([true, false, false, true]);
  });
  it('janela: primeira vez pelo histórico escolhido (máx. 12 meses); depois 10 dias antes da última', () => {
    expect(syncFrom(undefined, 90, TODAY)).toBe('2026-08-19');
    expect(syncFrom(undefined, 5000, TODAY)).toBe('2025-11-17');
    expect(syncFrom('2026-11-15T10:00:00.000Z', 90, TODAY)).toBe('2026-11-05');
  });
  it('conta nova começa no dia seguinte ao saldo do banco; cartão herda fechamento, vencimento e limite', () => {
    const a = newAccountFor(CHECKING, 'Inter', '2026-11-16', 'ac1');
    expect(a).toMatchObject({ name: 'Inter · Conta Corrente', kind: 'corrente', initialCents: 123456, initialDate: '2026-11-17' });
    const c = newCardFor(CARD, 'Inter', 'cd1', 'ac1');
    expect(c).toMatchObject({ name: 'Inter · Mastercard Black final 9876', closingDay: 3, dueDay: 10, limitCents: 500000, accountId: 'ac1' });
    expect(targetFor({ kind: 'ignorar' })).toBeNull();
    expect(targetFor({ kind: 'cartao', id: 'cd1' })).toEqual({ kind: 'cartao', cardId: 'cd1' });
  });
  it('avisa a autorização do Meu Pluggy (1 ano) perto de vencer', () => {
    expect(consentWarning('2027-11-01T00:00:00Z', TODAY)).toBeNull();
    expect(consentWarning('2026-12-01T00:00:00Z', TODAY)).toEqual({ days: 14, expired: false });
    expect(consentWarning('2026-11-01T00:00:00Z', TODAY)!.expired).toBe(true);
    expect(balanceGap(1234.56, 123456)).toBe(0);
  });
  it('duas compras iguais com ids estáveis diferentes do banco não são tratadas como duplicadas', () => {
    const d: AppData = { ...emptyData(), accounts: [{ id: 'a1', name: 'C', kind: 'corrente', initialCents: 0, initialDate: '2026-01-01' }], transactions: [{ id: 't1', type: 'expense', kind: 'variavel', description: 'CAFE', amountCents: 800, categoryId: 'alimentacao', date: '2026-11-10', paymentMethod: 'debito', accountId: 'a1', status: 'paid', createdAt: 1, fitId: 'of:A' }] };
    const st = toStatement(CHECKING, [tx({ description: 'CAFE', amount: -8, providerId: 'B', date: '2026-11-11T00:00:00.000Z' })]);
    expect(buildPreview(st, { kind: 'conta', accountId: 'a1' }, d, DEFAULT_SETTINGS)[0].flag).toBeUndefined();
    const noId = toStatement(CHECKING, [tx({ description: 'CAFE', amount: -8, date: '2026-11-11T00:00:00.000Z' })]);
    expect(buildPreview(noId, { kind: 'conta', accountId: 'a1' }, d, DEFAULT_SETTINGS)[0].flag).toBe('possivel'); // sem id estável, confere
  });
});

describe('cliente da Pluggy', () => {
  it('entra uma vez e reaproveita a API key; mensagens claras de erro', async () => {
    const f = vi.fn(async () => res(200, { apiKey: 'K' }));
    vi.stubGlobal('fetch', f);
    expect(await pluggyApiKey('id', 'sec', 0)).toBe('K');
    expect(await pluggyApiKey('id', 'sec', 60_000)).toBe('K');
    expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((f.mock.calls[0] as unknown[])[1] && ((f.mock.calls[0] as unknown[])[1] as RequestInit).body))).toEqual({ clientId: 'id', clientSecret: 'sec' });
    forgetPluggyKey();
    vi.stubGlobal('fetch', vi.fn(async () => res(401, { message: 'invalid' })));
    await expect(pluggyApiKey('id', 'errado')).rejects.toThrow(/Client ID e o Client Secret/);
    await expect(pluggyApiKey('', '')).rejects.toThrow(/Informe o Client ID/);
  });
  it('segue o cursor das transações até acabar', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      urls.push(u);
      return u.includes('after=') ? res(200, { results: [tx({ id: 'b' })], next: null }) : res(200, { results: [tx({ id: 'a' })], next: '?accountId=acc-1&after=XYZ' });
    }));
    const all = await listTransactions('K', 'acc-1', '2026-08-01');
    expect(all.map((t) => t.id)).toEqual(['a', 'b']);
    expect(urls).toEqual(['https://api.pluggy.ai/v2/transactions?accountId=acc-1&dateFrom=2026-08-01', 'https://api.pluggy.ai/v2/transactions?accountId=acc-1&after=XYZ']);
  });
});

describe('no app: vincular, sincronizar sem duplicar e confirmar proventos', () => {
  beforeEach(async () => {
    await closeDB();
    await deleteDB('grefinacia');
    setSecretStoreForTests(null);
  });

  it('cria a conta com o saldo do banco, importa uma vez, não duplica na segunda e respeita o intervalo automático', async () => {
    await init();
    await upsert('assets', { id: 's1', ticker: 'ITSA4', type: 'acao' });
    await upsert('operations', { id: 'o1', assetId: 's1', side: 'buy', quantity: 100, priceCents: 1000, feesCents: 0, date: '2026-01-05', broker: 'XP', createdAt: 1 });
    await upsert('dividends', { id: 'dv', assetId: 's1', kind: 'dividendo', ratePerUnit: 0.5, dataCom: '2026-10-20', paymentDate: '2026-11-10', source: 'api', sourceName: 'Yahoo Finance (não oficial)', official: false, key: 'k' });
    await updateSettings({ bank: { ...DEFAULT_SETTINGS.bank, clientId: 'id', clientSecret: 'sec', items: [{ itemId: 'item-1', label: 'Inter' }] } });
    const txs = [
      tx({ id: 'x1', providerId: 'P1', description: 'PIX ENVIADO MERCADO', amount: -120, type: 'DEBIT', date: '2026-11-12T00:00:00.000Z' }),
      tx({ id: 'x2', providerId: 'P2', description: 'DIVIDENDOS ITSA4', amount: 50, type: 'CREDIT', date: '2026-11-10T00:00:00.000Z' }),
    ];
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      calls.push(u.replace('https://api.pluggy.ai', ''));
      if (u.endsWith('/auth')) return res(200, { apiKey: 'K' });
      if (u.includes('/items/')) return res(200, { id: 'item-1', status: 'UPDATED', lastUpdatedAt: '2026-11-16T09:00:00.000Z', consentExpiresAt: '2027-11-16T00:00:00.000Z', connector: { name: 'Banco Inter' } });
      if (u.includes('/accounts')) return res(200, { results: [CHECKING] });
      if (u.includes('/v2/transactions')) return res(200, { results: txs, next: null });
      return res(404, {});
    }));
    expect(await syncBank()).toMatchObject({ imported: 0, accounts: 0 }); // nada vinculado ainda: só lista as contas
    expect(getState().bank.accounts.map((a) => a.bankName)).toEqual(['Inter']);
    await linkBankAccount('acc-1', 'novo');
    const acc = getState().data.accounts.at(-1)!;
    expect(acc).toMatchObject({ name: 'Inter · Conta Corrente', initialCents: 123456, initialDate: '2026-11-17' });

    const r1 = await syncBank();
    expect(r1).toMatchObject({ imported: 2, accounts: 1, errors: [] });
    expect(calls.some((c) => c.startsWith('/v2/transactions?accountId=acc-1&dateFrom='))).toBe(true);
    const imported = getState().data.transactions.filter((t) => t.source === 'import');
    expect(imported.map((t) => [t.description, t.type, t.amountCents, t.accountId, t.fitId])).toEqual([
      ['PIX ENVIADO MERCADO', 'expense', 12000, acc.id, 'of:P1'],
      ['DIVIDENDOS ITSA4', 'income', 5000, acc.id, 'of:P2'],
    ]);
    // histórico antes do início da conta não mexe no saldo: o app mostra o saldo do banco
    expect(accountBalance(acc, getState().data)).toBe(123456);
    expect(getState().data.imports[0].fileName).toBe('Meu Pluggy · Inter · Conta Corrente');

    // o crédito confirma o provento sozinho (Etapa 11a)
    const { afterChange } = await import('../src/state/store');
    await afterChange();
    expect(getState().data.dividends[0]).toMatchObject({ receivedAt: '2026-11-10', confirmedBy: 'extrato' });

    // segunda sincronização: nada novo
    const r2 = await syncBank();
    expect(r2.imported).toBe(0);
    expect(getState().data.transactions.filter((t) => t.source === 'import')).toHaveLength(2);

    // automática: não repete antes de 12 h
    expect(await autoSyncBank(Date.now() + 3_600_000)).toBe(false);
    expect(await autoSyncBank(Date.now() + (AUTO_BANK_HOURS + 1) * 3_600_000)).toBe(true);
    await new Promise((r) => setTimeout(r, 600));
  });

  it('banco com erro não impede os outros; credencial errada vira mensagem', async () => {
    await init();
    await updateSettings({ bank: { ...DEFAULT_SETTINGS.bank, clientId: 'id', clientSecret: 'x', items: [{ itemId: 'item-1', label: 'Inter' }] } });
    vi.stubGlobal('fetch', vi.fn(async () => res(401, {})));
    const r = await syncBank();
    expect(r.errors[0]).toMatch(/Client ID e o Client Secret/);
    expect(getState().bank.error).toMatch(/Client ID/);
    await new Promise((r2) => setTimeout(r2, 600));
  });
});
