import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDB } from 'idb';
import { dollarSummary, formatUSD, holdingUsd, rateChange, usdRate, USD_HISTORY_ID } from '../src/domain/dollar';
import { emptyData } from '../src/lib/defaults';
import type { AppData, UsdHolding } from '../src/lib/types';
import { netWorthAt } from '../src/domain/networth';
import { fetchUsQuotes } from '../src/services/market';
import { closeDB, DB_VERSION } from '../src/db/db';
import { DATA_SCHEMA } from '../src/services/validate';
import { setSecretStoreForTests } from '../src/services/secrets';
import { getState, init, refreshDollar, refreshUsQuotes, upsert } from '../src/state/store';

const res = (status: number, body: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
afterEach(() => vi.unstubAllGlobals());

const withRate = (d: AppData, pts: [string, number][]): AppData => ({ ...d, marketHistory: [{ id: USD_HISTORY_ID, kind: 'indice', symbol: 'USD', unit: 'brl', points: pts, source: 'Banco Central (SGS)', updatedAt: '' }] });
const conta: UsdHolding = { id: 'c', kind: 'conta', name: 'Conta Global Inter', balanceUsdCents: 25000, updatedAt: '' };
const voo: UsdHolding = { id: 'v', kind: 'etf', name: 'VOO', ticker: 'VOO', quantity: 2, avgCostUsdCents: 40000, priceUsdCents: 50000, updatedAt: '' };

describe('aba Dólar (regras)', () => {
  it('soma em dólar, converte pela PTAX e entra no patrimônio', () => {
    let d = withRate(emptyData(), [['2026-11-13', 5.6518], ['2026-11-16', 5.7324]]);
    d.usdHoldings = [conta, voo];
    d.bankInvestments = [{ id: 'b', itemId: 'i', bankName: 'Inter', name: 'Fundo global', type: 'MUTUAL_FUND', balanceCents: 10000, grossCents: 10000, currency: 'USD', counted: true, updatedAt: '' }];
    expect(usdRate(d)).toEqual({ rate: 5.7324, date: '2026-11-16' });
    expect(holdingUsd(voo)).toBe(100000);
    const s = dollarSummary(d);
    expect(s.totalUsd).toBe(25000 + 100000 + 10000);
    expect(s.gainUsd).toBe(20000);
    expect(s.totalBrl).toBe(Math.round(135000 * 5.7324));
    expect(s.byKind.map((k) => k.label)).toEqual(['ETFs (inclui UCITS)', 'Conta em dólar', 'Investimentos no banco']);
    const nw = netWorthAt(d, '2026-11-17', '2026-11-17');
    expect(nw.abroadCents).toBe(s.totalBrl);
    expect(nw.bankInvestCents).toBe(0); // em dólar não soma duas vezes
    d = { ...d, marketHistory: [] };
    expect(dollarSummary(d).totalBrl).toBeNull();
  });
  it('variação da cotação e formato', () => {
    expect(rateChange([['2026-10-17', 5], ['2026-11-16', 5.5]], 30)).toBeCloseTo(10);
    expect(rateChange([['2026-11-16', 5.5]], 30)).toBeNull();
    expect(formatUSD(123456)).toBe('$1,234.56');
  });
  it('cotação americana em dólar; recusa código inválido e ativo em outra moeda', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => res(200, { chart: { result: [{ meta: u.includes('/VALE3') ? { regularMarketPrice: 60, currency: 'BRL' } : { regularMarketPrice: 512.3, currency: 'USD', chartPreviousClose: 500, regularMarketTime: 1763400000 } }] } })));
    const r = await fetchUsQuotes(['voo', 'VALE3', '$$']);
    expect(r.quotes).toEqual([expect.objectContaining({ ticker: 'VOO', priceUsdCents: 51230 })]);
    expect(r.errors.map((e) => e.ticker)).toEqual(['VALE3', '$$']);
  });
  it('versões do banco local e do backup sobem', () => {
    expect(DB_VERSION).toBe(7);
    expect(DATA_SCHEMA).toBe(6);
  });
});

describe('no app (15)', () => {
  beforeEach(async () => {
    await closeDB();
    await deleteDB('grefinacia');
    setSecretStoreForTests(null);
  });
  it('busca a PTAX uma vez por dia e atualiza as cotações dos EUA', async () => {
    await init();
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      calls.push(u);
      if (u.includes('bcdata.sgs.1/')) return res(200, [{ data: '13/11/2026', valor: '5.6518' }, { data: '16/11/2026', valor: '5.7324' }]);
      if (u.includes('/chart/VOO')) return res(200, { chart: { result: [{ meta: { regularMarketPrice: 510, currency: 'USD' } }] } });
      return res(404, {});
    }));
    expect(await refreshDollar()).toEqual([]);
    expect(usdRate(getState().data)?.rate).toBe(5.7324);
    expect(getState().data.marketHistory.find((h) => h.id === USD_HISTORY_ID)?.unit).toBe('brl');
    await refreshDollar();
    expect(calls.filter((c) => c.includes('sgs.1/'))).toHaveLength(1);
    await upsert('usdHoldings', voo);
    expect(await refreshUsQuotes()).toEqual([]);
    expect(getState().data.usdHoldings[0].priceUsdCents).toBe(51000);
    await new Promise((r) => setTimeout(r, 600));
  });
});
