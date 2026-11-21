import { describe, expect, it } from 'vitest';
import { depositOutlook, matchHolding, parseTimeDeposits, readDocument } from '../src/domain/docread';
import type { UsdHolding } from '../src/lib/types';

const TODAY = '2026-11-18';

describe('print do Time Deposit (Inter)', () => {
  it('detalhe "Notas" em duas colunas (rótulos e valores separados)', () => {
    const text = ['Notas', 'TD Meu Porquinho 90 dias', 'US$ 10,95', 'Características', 'Rentabilidade', 'Detalhes', 'Valor aplicado', 'Valor bruto', 'Aplicação', 'Vencimento', '3.8% a.a.', 'US$ 10,90', 'US$ 10,95', '05/10/2026', '03/01/2027'].join('\n');
    expect(parseTimeDeposits(text, TODAY)).toEqual([{ name: 'TD Meu Porquinho 90 dias', balanceUsdCents: 1095, appliedUsdCents: 1090, ratePct: 3.8, startDate: '2026-10-05', maturityDate: '2027-01-03' }]);
  });
  it('lista: valor e vencimento; o leitor às vezes troca $ por S', () => {
    const text = ['Time Deposit', 'Total investido', 'USS 10,95', '03/01/2027', 'TD Meu Porquinho 90 dias', 'USS 10,95', 'Investir'].join('\n');
    expect(parseTimeDeposits(text, TODAY)).toEqual([{ name: 'TD Meu Porquinho 90 dias', balanceUsdCents: 1095, maturityDate: '2027-01-03' }]);
  });
  it('lista com dois', () => {
    const text = ['Total investido', 'US$ 1.510,95', '03/01/2027', 'TD Meu Porquinho 90 dias', 'US$ 10,95', 'Investir', '10/06/2027', 'TD 1 ano', 'US$ 1.500,00'].join('\n');
    const r = parseTimeDeposits(text, TODAY);
    expect(r.map((x) => [x.name, x.balanceUsdCents, x.maturityDate])).toEqual([['TD Meu Porquinho 90 dias', 1095, '2027-01-03'], ['TD 1 ano', 150000, '2027-06-10']]);
  });
  it('outro texto não vira investimento', () => {
    expect(parseTimeDeposits('SUPERMERCADO BOM\nTOTAL R$ 52,30', TODAY)).toEqual([]);
    expect(readDocument('SUPERMERCADO BOM\nCNPJ 12.345.678/0001-90\nVALOR TOTAL R$ 52,30\n10/11/2026', TODAY).kind).toBe('receipt');
    expect(readDocument('foto de um gato', TODAY).kind).toBe('unknown');
  });
});

describe('renda fixa em dólar', () => {
  const h: UsdHolding = { id: 'u', kind: 'deposito', name: 'TD Meu Porquinho 90 dias', balanceUsdCents: 1095, appliedUsdCents: 1090, ratePct: 3.8, startDate: '2026-10-05', maturityDate: '2027-01-03', updatedAt: '' };
  it('dias que faltam, quanto já rendeu e estimativa no vencimento', () => {
    const o = depositOutlook(h, TODAY)!;
    expect(o.daysLeft).toBe(46);
    expect(o.totalDays).toBe(90);
    expect(o.gainSoFarUsdCents).toBe(5);
    expect(o.atMaturityUsdCents).toBe(1100);
    expect(depositOutlook({ ...h, maturityDate: undefined }, TODAY)).toBeNull();
  });
  it('encontra o item já cadastrado pelo nome', () => {
    const list: UsdHolding[] = [{ id: 'a', kind: 'conta', name: 'Conta Global', updatedAt: '' }, { id: 'b', kind: 'deposito', name: 'Meu Porquinho', updatedAt: '' }];
    expect(matchHolding(list, 'TD Meu Porquinho 90 dias')?.id).toBe('b');
    expect(matchHolding(list, 'TD 1 ano')).toBeUndefined();
  });
});

describe('print da carteira', () => {
  it('B3: código, quantidade, preço médio e valor', async () => {
    const { parseHoldings } = await import('../src/domain/docread');
    const text = ['Minha carteira', 'BBAS3', 'Banco do Brasil', '4 ações', 'Preço médio R$ 22,50', 'R$ 84,72', 'SNEL11', '12 cotas', 'PM R$ 9,80', 'R$ 117,81'].join('\n');
    expect(parseHoldings(text)).toEqual([
      { market: 'b3', ticker: 'BBAS3', quantity: 4, avgPriceCents: 2250, valueCents: 8472 },
      { market: 'b3', ticker: 'SNEL11', quantity: 12, avgPriceCents: 980, valueCents: 11781 },
    ]);
  });
  it('EUA: código com valor em US$', async () => {
    const { parseHoldings } = await import('../src/domain/docread');
    const text = ['Investimentos no exterior', 'VOO', 'Vanguard S&P 500 ETF', 'Qtd 0,5', 'Preço médio US$ 480.00', 'US$ 265.30', 'AAPL', 'Apple Inc', '2 shares', 'US$ 450.10'].join('\n');
    expect(parseHoldings(text)).toEqual([
      { market: 'us', ticker: 'VOO', quantity: 0.5, avgPriceCents: 48000, valueCents: 26530 },
      { market: 'us', ticker: 'AAPL', quantity: 2, avgPriceCents: undefined, valueCents: 45010 },
    ]);
  });
  it('texto comum não vira carteira', async () => {
    const { parseHoldings, readDocument } = await import('../src/domain/docread');
    expect(parseHoldings('SUPERMERCADO BOM\nTOTAL R$ 52,30')).toEqual([]);
    expect(readDocument('Conta Global US$ 5,47\nTD Meu Porquinho 90 dias\nUS$ 10,95', '2026-11-21').kind).toBe('td');
  });
});
