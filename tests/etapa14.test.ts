import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDB } from 'idb';
import { bankInvestTotal, groupByType, mergeInvestments, rateLabel } from '../src/domain/bankInvest';
import { forgetPluggyKey, listInvestments, type PluggyInvestment } from '../src/services/pluggy';
import { DEFAULT_SETTINGS, emptyData } from '../src/lib/defaults';
import { closeDB, DB_VERSION } from '../src/db/db';
import { DATA_SCHEMA, validateImported } from '../src/services/validate';
import { setSecretStoreForTests } from '../src/services/secrets';
import { disconnectBank, getState, init, setBankInvestmentCounted, syncBank, updateSettings, upsert } from '../src/state/store';
import { netWorthAt } from '../src/domain/networth';

const res = (status: number, body: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
afterEach(() => { vi.unstubAllGlobals(); forgetPluggyKey(); });
// formato conferido em docs.pluggy.ai (Investment), 17/11/2026
const CDB: PluggyInvestment = { id: 'i-cdb', name: 'CDB Inter Liquidez Diária', type: 'FIXED_INCOME', subtype: 'CDB', balance: 1050.5, amount: 1060, amountOriginal: 1000, currencyCode: 'BRL', rate: 100, rateType: 'CDI', dueDate: '2028-01-10T00:00:00.000Z', issuer: 'Banco Inter', status: 'ACTIVE' };
const ITSA: PluggyInvestment = { id: 'i-itsa', name: 'ITAUSA PN', code: 'ITSA4', type: 'EQUITY', subtype: 'STOCK', balance: 500, amount: 500, quantity: 50, value: 10, currencyCode: 'BRL', status: 'ACTIVE' };
const GONE: PluggyInvestment = { id: 'i-gone', name: 'LCI', type: 'FIXED_INCOME', subtype: 'LCI', balance: 0, status: 'TOTAL_WITHDRAWAL' };
const USD: PluggyInvestment = { id: 'i-usd', name: 'Conta global', type: 'OTHER', balance: 100, currencyCode: 'USD' };

describe('investimentos pelo banco (regras)', () => {
  it('converte, tira resgatado e moeda estrangeira; ação já cadastrada à mão não conta em dobro', () => {
    const data = emptyData();
    data.assets = [{ id: 'a', ticker: 'ITSA4', type: 'acao' }];
    data.operations = [{ id: 'o', assetId: 'a', side: 'buy', quantity: 10, priceCents: 1000, feesCents: 0, date: '2026-01-02', createdAt: 1 } as never];
    const { list, skippedForeign } = mergeInvestments([], [CDB, ITSA, GONE, USD], 'item', 'Inter', data, '2026-11-17T12:00:00Z');
    expect(skippedForeign).toBe(0);
    expect(list.map((i) => [i.id, i.balanceCents, i.counted, i.countedReason, i.currency])).toEqual([['i-cdb', 105050, true, 'auto', undefined], ['i-itsa', 50000, false, 'manual-duplicado', undefined], ['i-usd', 10000, true, 'auto', 'USD']]);
    expect(list[0]).toMatchObject({ grossCents: 106000, originalCents: 100000, dueDate: '2028-01-10', bankName: 'Inter' });
    expect(bankInvestTotal(list)).toBe(105050);
    expect(mergeInvestments([], [{ ...USD, currencyCode: 'EUR' }], 'item', 'Inter', data, 'x').skippedForeign).toBe(1);
    expect(groupByType(list).map((g) => [g.label, g.cents])).toEqual([['Renda fixa', 105050], ['Bolsa', 0]]);
  });
  it('sua escolha de contar ou não vale nas próximas sincronizações', () => {
    const first = mergeInvestments([], [CDB], 'item', 'Inter', emptyData(), 'x').list;
    const mine = [{ ...first[0], counted: false, countedReason: 'voce' as const }];
    expect(mergeInvestments(mine, [{ ...CDB, balance: 1100 }], 'item', 'Inter', emptyData(), 'y').list[0]).toMatchObject({ counted: false, balanceCents: 110000 });
  });
  it('taxa em português', () => {
    expect(rateLabel({ rate: 110, rateType: 'CDI' })).toBe('110% do CDI');
    expect(rateLabel({ rate: 100, rateType: 'IPCA', fixedAnnualRate: 6 })).toBe('IPCA + 6%');
    expect(rateLabel({ fixedAnnualRate: 12.5 })).toBe('12,5% ao ano');
    expect(rateLabel({})).toBeNull();
  });
  it('lista em páginas', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      calls.push(u);
      return res(200, u.includes('page=1') ? { page: 1, totalPages: 2, results: [CDB] } : { page: 2, totalPages: 2, results: [ITSA] });
    }));
    expect((await listInvestments('K', 'item')).map((i) => i.id)).toEqual(['i-cdb', 'i-itsa']);
    expect(calls[0]).toContain('/investments?itemId=item&pageSize=500&page=1');
  });
  it('nova coleção sobe as versões do banco local e do backup; backup antigo abre vazio', () => {
    expect(DB_VERSION).toBeGreaterThanOrEqual(6);
    expect(DATA_SCHEMA).toBeGreaterThanOrEqual(5);
    expect(validateImported({ schema: 4, data: { ...emptyData(), bankInvestments: undefined }, settings: {} }).data.bankInvestments).toEqual([]);
  });
});

describe('no app (14)', () => {
  beforeEach(async () => {
    await closeDB();
    await deleteDB('grefinacia');
    setSecretStoreForTests(null);
  });
  it('sincroniza, entra no patrimônio, some o que foi resgatado e sai ao desconectar', async () => {
    await init();
    await updateSettings({ bank: { ...DEFAULT_SETTINGS.bank, clientId: 'id', clientSecret: 'sec', items: [{ itemId: 'item-1', label: 'Inter' }] } });
    let invs: PluggyInvestment[] = [CDB, ITSA];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      if (u.endsWith('/auth')) return res(200, { apiKey: 'K' });
      if (u.includes('/items/')) return res(200, { id: 'item-1', status: 'UPDATED', connector: { name: 'Banco Inter' } });
      if (u.includes('/accounts')) return res(200, { results: [] });
      if (u.includes('/investments')) return res(200, { page: 1, totalPages: 1, results: invs });
      return res(404, {});
    }));
    await syncBank();
    expect(getState().data.bankInvestments.map((i) => i.id).sort()).toEqual(['i-cdb', 'i-itsa']);
    expect(getState().bank.investReport).toEqual([{ bank: 'Inter', count: 2, foreign: 0 }]);
    const today = getState().today;
    expect(netWorthAt(getState().data, today, today).bankInvestCents).toBe(155050);
    await setBankInvestmentCounted('i-itsa', false);
    expect(netWorthAt(getState().data, today, today).bankInvestCents).toBe(105050);
    invs = [CDB];
    await syncBank();
    expect(getState().data.bankInvestments.map((i) => i.id)).toEqual(['i-cdb']);
    await upsert('accounts', { id: 'z', name: 'x', kind: 'corrente', initialCents: 0, initialDate: '2026-01-01' });
    await disconnectBank();
    expect(getState().data.bankInvestments).toEqual([]);
    await new Promise((r) => setTimeout(r, 600));
  });
});
