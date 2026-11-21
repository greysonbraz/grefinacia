import { describe, expect, it } from 'vitest';
import { healthIndicators, upcomingItems } from '../src/domain/home';
import { emptyData } from '../src/lib/defaults';
import type { AppData, Transaction } from '../src/lib/types';
import { closeTop, openLayers } from '../src/ui/back';
import { readFileSync } from 'node:fs';

let n = 0;
const t = (p: Partial<Transaction>): Transaction => ({ id: 'x' + n++, type: 'expense', kind: 'variavel', description: 'Gasto', amountCents: 1000, categoryId: 'mercado', date: '2026-10-05', paymentMethod: 'pix', accountId: 'a', status: 'paid', paidDate: p.date ?? '2026-10-05', createdAt: n, ...p });
const base = (): AppData => ({ ...emptyData(), accounts: [{ id: 'a', name: 'Conta', kind: 'corrente', initialCents: 1200000, initialDate: '2026-01-01' }] });

describe('Início Purple Edition', () => {
  it('próximos dias: contas avulsas, uma linha por fatura do cartão e proventos previstos', () => {
    const d = base();
    d.cards = [{ id: 'c', name: 'Inter', closingDay: 30, dueDay: 7 }];
    d.transactions = [
      t({ description: 'Luz', date: '2026-11-20', dueDate: '2026-11-25', status: 'pending', paidDate: undefined, kind: 'fixa', amountCents: 14000 }),
      t({ description: 'Loja', date: '2026-11-10', dueDate: '2026-12-01', status: 'pending', paidDate: undefined, kind: 'cartao', cardId: 'c', accountId: undefined, amountCents: 5000 }),
      t({ description: 'Mercado', date: '2026-11-12', dueDate: '2026-12-01', status: 'pending', paidDate: undefined, kind: 'cartao', cardId: 'c', accountId: undefined, amountCents: 7000 }),
      t({ description: 'Longe', date: '2026-12-20', dueDate: '2026-12-25', status: 'pending', paidDate: undefined, kind: 'fixa' }),
    ];
    d.assets = [{ id: 's', ticker: 'MXRF11', type: 'fii' }];
    d.operations = [{ id: 'o', assetId: 's', side: 'buy', quantity: 100, priceCents: 1000, feesCents: 0, date: '2026-01-02', createdAt: 1 } as never];
    d.dividends = [{ id: 'dv', assetId: 's', kind: 'rendimento', ratePerUnit: 0.1, dataCom: '2026-11-10', paymentDate: '2026-11-28', source: 'api', sourceName: 'x', official: false, key: 'k' } as never];
    const items = upcomingItems(d, '2026-11-18', 15);
    expect(items.map((i) => [i.kind, i.title, i.date, i.cents])).toEqual([
      ['conta', 'Luz', '2026-11-25', 14000],
      ['provento', 'MXRF11 · rendimento', '2026-11-28', 1000],
      ['fatura', 'Fatura Inter', '2026-12-01', 12000],
    ]);
  });
  it('saúde financeira: sobra da renda, reserva em meses e peso das parcelas', () => {
    const d = base();
    d.transactions = [];
    for (const m of ['08', '09', '10']) {
      d.transactions.push(t({ type: 'income', kind: 'salario', categoryId: 'salario', amountCents: 500000, date: `2026-${m}-05` }));
      d.transactions.push(t({ amountCents: 300000, date: `2026-${m}-10` }));
    }
    d.debts = [{ id: 'dd', name: 'Moto', kind: 'financiamento', balanceCents: 900000, installmentCents: 50000, remainingInstallments: 18, dueDay: 10 } as never];
    const h = healthIndicators(d, '2026-11-18');
    expect(h.map((i) => [i.id, i.value, i.tone])).toEqual([
      ['poupanca', '40%', 'good'],
      // saldo 12.000 + 3×(5.000−3.000) = 18.000; gasto médio 3.000 → 6 meses
      ['reserva', '6 meses', 'good'],
      ['dividas', '10%', 'good'],
    ]);
    expect(healthIndicators(base(), '2026-11-18').every((i) => i.tone === 'none')).toBe(true);
  });
  it('voltar do Android: sem janela aberta não faz nada', () => {
    expect(openLayers()).toBe(0);
    expect(closeTop()).toBe(false);
  });
  it('paleta: o botão principal usa texto escuro sobre o roxo claro (contraste ≥ 4,5:1)', () => {
    const css = readFileSync('src/styles.css', 'utf8');
    expect(css).toMatch(/--accent: #a78bfa; --accent-ink: #0b0914;/);
    expect(css).not.toMatch(/--gold/);
  });
});
