import { describe, expect, it } from 'vitest';
import { marketStrip } from '../src/domain/indicators';
import { monthAgenda } from '../src/domain/home';
import { historyId } from '../src/domain/market';
import { emptyData } from '../src/lib/defaults';
import type { AppData, MarketHistory, Transaction } from '../src/lib/types';

const h = (symbol: string, unit: MarketHistory['unit'], points: [string, number][]): MarketHistory => ({ id: historyId('indice', symbol), kind: 'indice', symbol, unit, points, source: 'x', updatedAt: '' });
let n = 0;
const t = (p: Partial<Transaction>): Transaction => ({ id: 'x' + n++, type: 'expense', kind: 'variavel', description: 'Gasto', amountCents: 1000, categoryId: 'mercado', date: '2026-11-05', paymentMethod: 'pix', accountId: 'a', status: 'paid', paidDate: p.date ?? '2026-11-05', createdAt: n, ...p });

describe('mercado hoje', () => {
  it('Ibovespa e dólar com variação; Selic vigente hoje (a série traz datas futuras); IPCA 12 meses', () => {
    const d: AppData = emptyData();
    d.marketHistory = [
      h('IBOV', 'pts', [['2026-11-16', 128000], ['2026-11-17', 129280]]),
      h('USD', 'brl', [['2026-11-16', 5.7324]]),
      h('SELIC', 'pct', [['2026-11-17', 14.25], ['2026-12-09', 13.75]]),
      h('IPCA12', 'pct', [['2026-10-01', 4.63]]),
    ];
    const s = marketStrip(d, '2026-11-18');
    expect(s.map((i) => [i.id, i.value])).toEqual([['ibov', '129.280'], ['usd', 'R$ 5,73'], ['selic', '14,25%'], ['ipca', '4,63%']]);
    expect(s[0].changePct).toBeCloseTo(1, 5);
    expect(s[1].changePct).toBeUndefined();
    expect(marketStrip(emptyData(), '2026-11-18')).toEqual([]);
  });
});

describe('calendário financeiro', () => {
  it('entradas, contas, uma fatura por vencimento e proventos, no dia certo', () => {
    const d: AppData = { ...emptyData(), cards: [{ id: 'c', name: 'Inter', closingDay: 30, dueDay: 7 }] };
    d.transactions = [
      t({ type: 'income', kind: 'salario', description: 'Salário', amountCents: 350000, date: '2026-11-20', status: 'pending', paidDate: undefined }),
      t({ description: 'Luz', kind: 'fixa', amountCents: 14000, date: '2026-11-10', dueDate: '2026-11-25', status: 'pending', paidDate: undefined }),
      t({ description: 'Mercado', amountCents: 5000, date: '2026-11-11' }), // dia a dia já pago: fica só no extrato
      t({ description: 'Loja', kind: 'cartao', cardId: 'c', accountId: undefined, amountCents: 3000, date: '2026-10-20', dueDate: '2026-11-07', status: 'paid', paidDate: '2026-11-07' }),
      t({ description: 'Posto', kind: 'cartao', cardId: 'c', accountId: undefined, amountCents: 2000, date: '2026-10-25', dueDate: '2026-11-07', status: 'paid', paidDate: '2026-11-07' }),
    ];
    const a = monthAgenda(d, '2026-11', '2026-11-18');
    expect([...a.entries()].map(([day, its]) => [day, its.map((i) => [i.kind, i.cents, i.done])])).toEqual([
      ['2026-11-07', [['fatura', 5000, true]]],
      ['2026-11-20', [['entrada', 350000, false]]],
      ['2026-11-25', [['conta', 14000, false]]],
    ]);
  });
});
