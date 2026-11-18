import { describe, expect, it } from 'vitest';
import { investOverview } from '../src/domain/investOverview';
import { emptyData } from '../src/lib/defaults';
import type { AppData } from '../src/lib/types';
import { USD_HISTORY_ID } from '../src/domain/dollar';

describe('Investimentos → visão geral (redesign, etapa 6)', () => {
  it('junta Bolsa, renda fixa, bancos, exterior e cripto com as maiores posições', () => {
    const d: AppData = emptyData();
    d.assets = [{ id: 'a', ticker: 'MXRF11', type: 'fii', quote: { priceCents: 1100, time: '2026-11-18T12:00:00Z', source: 'x' } as never }, { id: 'b', ticker: 'ITSA4', type: 'acao' }];
    d.operations = [
      { id: 'o1', assetId: 'a', side: 'buy', quantity: 100, priceCents: 1000, feesCents: 0, date: '2026-01-02', createdAt: 1 } as never,
      { id: 'o2', assetId: 'b', side: 'buy', quantity: 10, priceCents: 1000, feesCents: 0, date: '2026-01-02', createdAt: 2 } as never,
    ];
    d.fixedIncomes = [{ id: 'f', name: 'CDB X', investedCents: 50000, currentCents: 52000, currentUpdatedAt: '2026-11-01', purchaseDate: '2026-01-01' }];
    d.bankInvestments = [{ id: 'bi', itemId: 'i', bankName: 'Inter', name: 'CDB Porquinho', type: 'FIXED_INCOME', balanceCents: 10000, grossCents: 10100, originalCents: 9500, counted: true, updatedAt: '' }];
    d.usdHoldings = [{ id: 'u', kind: 'conta', name: 'Conta Global', balanceUsdCents: 1000, updatedAt: '' }];
    d.marketHistory = [{ id: USD_HISTORY_ID, kind: 'indice', symbol: 'USD', unit: 'brl', points: [['2026-11-17', 5.5]], source: 'x', updatedAt: '' }];
    const v = investOverview(d, '2026-11-18');
    expect(v.classes.map((c) => [c.id, c.cents])).toEqual([['acoes', 10000], ['fiis', 110000], ['fixa', 52000], ['bancos', 10000], ['exterior', 5500]]);
    expect(v.totalCents).toBe(187500);
    expect(v.bankGainCents).toBe(500);
    expect(v.top[0]).toMatchObject({ label: 'MXRF11', cents: 110000 });
    expect(Math.round(v.top[0].pct)).toBe(59);
    expect(v.unquoted).toBe(1);
  });
  it('sem nada investido, total zero', () => {
    expect(investOverview(emptyData(), '2026-11-18')).toMatchObject({ totalCents: 0, classes: [], top: [] });
  });
});
