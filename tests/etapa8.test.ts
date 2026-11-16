import { describe, expect, it } from 'vitest';
import { cashForecast, detectSubscriptions, findDuplicates, irrMonthly, median, normDesc, portfolioXray, rateFromInstallment, simulateLoan, unusualSpending } from '../src/domain/analysis';
import { emptyData } from '../src/lib/defaults';
import type { Account, AppData, Debt, Recurrence, Transaction } from '../src/lib/types';

const TODAY = '2026-11-16';
let n = 0;
const tx = (p: Partial<Transaction>): Transaction => ({ id: 't' + n++, type: 'expense', kind: 'variavel', description: 'Mercado', amountCents: 10000, categoryId: 'mercado', date: TODAY, paymentMethod: 'pix', accountId: 'a1', status: 'paid', createdAt: n, ...p });
const acc: Account = { id: 'a1', name: 'Conta', kind: 'corrente', initialCents: 500000, initialDate: '2025-01-01' };
const data = (p: Partial<AppData>): AppData => ({ ...emptyData(), accounts: [acc], ...p });
const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];

describe('auxiliares', () => {
  it('descrição comparável ignora acento, números e parcelas', () => {
    expect(normDesc('NETFLIX.COM 15/10')).toBe('netflix com');
    expect(normDesc('Ração do Bidu (3/10)')).toBe('racao do bidu');
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('gastos fora do padrão', () => {
  it('acusa categoria acima do normal e lançamento muito maior que o típico', () => {
    const t: Transaction[] = [];
    for (const m of months) {
      t.push(tx({ date: m + '-05', amountCents: 40000, categoryId: 'mercado' }));
      t.push(tx({ date: m + '-10', categoryId: 'lazer', amountCents: 8000 }));
    }
    t.push(tx({ date: '2026-11-03', amountCents: 30000 }), tx({ date: '2026-11-12', amountCents: 35000 })); // mercado: 650 contra 400
    t.push(tx({ date: '2026-11-14', categoryId: 'lazer', amountCents: 30000, description: 'Show' })); // 3,75× o típico
    const u = unusualSpending(data({ transactions: t }), TODAY);
    expect(u.categories.map((c) => c.categoryId)).toEqual(['mercado', 'lazer']); // maior excesso em reais primeiro (250 contra 220)
    expect(u.categories[0]).toMatchObject({ curCents: 65000, typicalCents: 40000, months: 6 });
    expect(u.transactions).toHaveLength(1);
    expect(u.transactions[0].tx.description).toBe('Show');
  });
  it('sem 3 meses de histórico não acusa nada', () => {
    const t = [tx({ date: '2026-10-05' }), tx({ date: '2026-11-05', amountCents: 90000 })];
    expect(unusualSpending(data({ transactions: t }), TODAY).categories).toEqual([]);
  });
});

describe('assinaturas e cobranças repetidas', () => {
  it('detecta cobrança mensal parecida e aumento de preço; ignora gasto que varia e parcelas', () => {
    const t: Transaction[] = [];
    ['2026-07', '2026-08', '2026-09', '2026-10'].forEach((m) => t.push(tx({ description: `STREAMING XYZ ${m}`, date: m + '-08', amountCents: 3990, categoryId: 'lazer' })));
    t.push(tx({ description: 'STREAMING XYZ 2026-11', date: '2026-11-08', amountCents: 4490, categoryId: 'lazer' }));
    ['2026-08', '2026-09', '2026-10', '2026-11'].forEach((m, i) => t.push(tx({ description: 'Padaria', date: m + '-02', amountCents: [1000, 9000, 2500, 15000][i] })));
    ['2026-09', '2026-10', '2026-11'].forEach((m, i) => t.push(tx({ description: `Celular (${i + 1}/10)`, date: m + '-01', amountCents: 20000, installment: { groupId: 'g', number: i + 1, total: 10 } })));
    const s = detectSubscriptions(data({ transactions: t }), TODAY);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ source: 'detectada', monthlyCents: 4490, annualCents: 53880, months: 5, increasedFromCents: 3990 });
  });
  it('inclui as assinaturas cadastradas e não repete a mesma como detectada', () => {
    const r: Recurrence = { id: 'r1', type: 'expense', kind: 'assinatura', description: 'Música', amountCents: 2190, categoryId: 'lazer', paymentMethod: 'credito', dayOfMonth: 10, startMonth: '2026-01', active: true };
    const t = ['2026-09', '2026-10', '2026-11'].map((m) => tx({ description: 'Música', date: m + '-10', amountCents: 2190 }));
    const s = detectSubscriptions(data({ recurrences: [r], transactions: t }), TODAY);
    expect(s.map((x) => x.source)).toEqual(['cadastrada']);
    expect(s[0].months).toBe(11);
  });
  it('cobrança que parou há mais de 45 dias não aparece', () => {
    const t = ['2026-05', '2026-06', '2026-07'].map((m) => tx({ description: 'Academia', date: m + '-05', amountCents: 9900 }));
    expect(detectSubscriptions(data({ transactions: t }), TODAY)).toEqual([]);
  });
});

describe('cobranças em dobro', () => {
  it('mesmo valor e descrição em até 3 dias; parcelas e meses de recorrência não contam; dá para ignorar', () => {
    const a = tx({ id: 'x1', description: 'Uber', date: '2026-11-10', amountCents: 2350 });
    const b = tx({ id: 'x2', description: 'UBER *TRIP', date: '2026-11-11', amountCents: 2350 });
    const c = tx({ id: 'x3', description: 'Uber', date: '2026-11-20', amountCents: 2350 }); // 10 dias depois
    const p1 = tx({ id: 'p1', description: 'TV (1/3)', date: '2026-11-01', amountCents: 50000, installment: { groupId: 'g', number: 1, total: 3 } });
    const p2 = tx({ id: 'p2', description: 'TV (2/3)', date: '2026-11-01', amountCents: 50000, installment: { groupId: 'g', number: 2, total: 3 } });
    const d = data({ transactions: [a, b, c, p1, p2] });
    expect(findDuplicates(d, TODAY).map((x) => x.key)).toEqual(['x1|x2']);
    expect(findDuplicates(d, TODAY, ['x1|x2'])).toEqual([]);
  });
});

describe('previsão de caixa', () => {
  it('soma pendências, recorrências futuras, dívidas e gasto do dia a dia médio', () => {
    const t: Transaction[] = [];
    for (const m of ['2026-08', '2026-09', '2026-10']) t.push(tx({ date: m + '-15', amountCents: 60000 })); // dia a dia: 600/mês
    t.push(tx({ date: '2026-11-05', amountCents: 20000 })); // já gastou 200 no mês
    t.push(tx({ description: 'Aluguel', kind: 'fixa', date: '2026-11-20', dueDate: '2026-11-20', status: 'pending', amountCents: 150000, recurrenceId: 'rent', recurrenceMonth: '2026-11' }));
    const rent: Recurrence = { id: 'rent', type: 'expense', kind: 'fixa', description: 'Aluguel', amountCents: 150000, categoryId: 'moradia', paymentMethod: 'pix', dayOfMonth: 20, startMonth: '2026-01', active: true };
    const salary: Recurrence = { id: 'sal', type: 'income', kind: 'salario', description: 'Salário', amountCents: 300000, categoryId: 'salario', paymentMethod: 'transferencia', dayOfMonth: 5, startMonth: '2026-12', active: true };
    const debt: Debt = { id: 'd1', kind: 'emprestimo', name: 'Empréstimo banco', institution: 'X', originalCents: 0, balanceCents: 100000, installmentCents: 50000, remainingInstallments: 2, monthlyRatePct: 2, dueDay: 25, createdAt: 1 };
    const d = data({ transactions: t, recurrences: [rent, salary], debts: [debt] });
    const f = cashForecast(d, TODAY, 4);
    const start = 500000 - 3 * 60000 - 20000; // saldo de hoje
    expect(f.startCents).toBe(start);
    expect(f.variableMonthlyCents).toBe(60000);
    expect(f.months.map((m) => m.ym)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(f.months[0]).toMatchObject({ incomeCents: 0, fixedCents: 150000, debtCents: 50000, variableCents: 40000 });
    expect(f.months[1]).toMatchObject({ incomeCents: 300000, fixedCents: 150000, debtCents: 50000, variableCents: 60000 });
    expect(f.months[2].debtCents).toBe(0); // só restavam 2 parcelas
    expect(f.months[0].endBalanceCents).toBe(start - 240000);
    expect(f.firstNegative).toBeNull();
    expect(f.lowest!.ym).toBe('2026-11');
  });
  it('não conta a parcela da dívida em dobro quando ela já está lançada', () => {
    const debt: Debt = { id: 'd1', kind: 'financiamento', name: 'Financiamento carro', institution: '', originalCents: 0, balanceCents: 1000000, installmentCents: 80000, remainingInstallments: 10, monthlyRatePct: 1.5, dueDay: 28, createdAt: 1 };
    const t = [tx({ description: 'Financiamento carro', kind: 'fixa', date: '2026-11-28', status: 'pending', amountCents: 80000 })];
    const f = cashForecast(data({ transactions: t, debts: [debt] }), TODAY, 2);
    expect(f.months[0]).toMatchObject({ fixedCents: 80000, debtCents: 0 });
    expect(f.months[1].debtCents).toBe(80000);
  });
  it('avisa o primeiro mês com saldo negativo', () => {
    const t = ['2026-08', '2026-09', '2026-10'].map((m) => tx({ date: m + '-15', amountCents: 100000 }));
    const f = cashForecast(data({ transactions: t }), TODAY, 6);
    expect(f.startCents).toBe(200000);
    // nov: 2.000 − 1.000 = 1.000; dez: 0; jan: −1.000
    expect(f.firstNegative).toBe('2027-01');
  });
});

describe('comparador de empréstimos', () => {
  it('Price: parcela, juros e CET com tarifa', () => {
    const r = simulateLoan({ amountCents: 1000000, months: 12, monthlyRatePct: 2, feesCents: 0, system: 'price' })!;
    expect(r.firstInstallmentCents).toBe(94560); // R$ 9.455,96 pela fórmula
    expect(r.firstInstallmentCents).toBe(r.lastInstallmentCents);
    expect(r.cetMonthlyPct).toBeCloseTo(2, 4);
    const withFee = simulateLoan({ amountCents: 1000000, months: 12, monthlyRatePct: 2, feesCents: 30000, system: 'price' })!;
    expect(withFee.cetMonthlyPct).toBeGreaterThan(2.4);
    expect(withFee.costCents).toBe(withFee.interestCents + 30000);
  });
  it('SAC: parcelas caem e o juro total é menor que na Price', () => {
    const sac = simulateLoan({ amountCents: 1200000, months: 12, monthlyRatePct: 2, feesCents: 0, system: 'sac' })!;
    const price = simulateLoan({ amountCents: 1200000, months: 12, monthlyRatePct: 2, feesCents: 0, system: 'price' })!;
    expect(sac.firstInstallmentCents).toBe(124000); // 1.000 de amortização + 240 de juros
    expect(sac.lastInstallmentCents).toBe(102000);
    expect(sac.interestCents).toBe(156000);
    expect(sac.interestCents).toBeLessThan(price.interestCents);
    expect(sac.cetMonthlyPct).toBeCloseTo(2, 4);
  });
  it('descobre a taxa a partir da parcela que o banco informa', () => {
    expect(rateFromInstallment(1000000, 94560, 12)).toBeCloseTo(2, 3);
    const r = simulateLoan({ amountCents: 1000000, months: 12, installmentCents: 94560, feesCents: 0, system: 'price' })!;
    expect(r.monthlyRatePct).toBeCloseTo(2, 3);
    expect(r.totalPaidCents).toBe(94560 * 12);
    expect(rateFromInstallment(1000000, 50000, 12)).toBeNull(); // parcela não paga nem o valor
  });
  it('recusa entradas sem sentido', () => {
    expect(simulateLoan({ amountCents: 0, months: 12, monthlyRatePct: 2, feesCents: 0, system: 'price' })).toBeNull();
    expect(simulateLoan({ amountCents: 1000, months: 12, monthlyRatePct: 2, feesCents: 1000, system: 'price' })).toBeNull();
    expect(irrMonthly(100, [10, 10])).toBeNull();
  });
});

describe('raio-X da carteira', () => {
  it('divide por classe, mede concentração e avisa renda fixa vencendo', () => {
    const d = data({
      assets: [{ id: 's1', ticker: 'ITSA4', type: 'acao', quote: { priceCents: 1000, time: TODAY, fetchedAt: TODAY, source: 'x' } }, { id: 's2', ticker: 'MXRF11', type: 'fii' }],
      operations: [{ id: 'o1', assetId: 's1', side: 'buy', quantity: 300, priceCents: 900, feesCents: 0, date: '2026-01-02', broker: '', createdAt: 1 }, { id: 'o2', assetId: 's2', side: 'buy', quantity: 100, priceCents: 1000, feesCents: 0, date: '2026-01-02', broker: '', createdAt: 2 }],
      cryptoAssets: [{ id: 'c1', coinId: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', quote: { priceCents: 40000000, time: TODAY, fetchedAt: TODAY, source: 'CoinGecko' } }],
      cryptoOps: [{ id: 'co1', assetId: 'c1', side: 'buy', quantity: 0.0025, priceCents: 40000000, feesCents: 0, date: '2026-01-02', broker: '', createdAt: 3 }],
      fixedIncomes: [{ id: 'f1', name: 'CDB', investedCents: 500000, currentCents: 500000, currentUpdatedAt: TODAY, purchaseDate: '2025-01-01', maturityDate: '2026-12-01' }],
    });
    const x = portfolioXray(d, TODAY);
    expect(x.totalCents).toBe(300000 + 100000 + 100000 + 500000);
    expect(x.classes.map((c) => [c.cls, Math.round(c.pct)])).toEqual([['renda_fixa', 50], ['acao', 30], ['fii', 10], ['cripto', 10]]);
    expect(x.top3Pct).toBeCloseTo(90, 6);
    expect(x.effectiveItems).toBeCloseTo(1 / (0.25 + 0.09 + 0.01 + 0.01), 6);
    expect(x.maturing).toEqual([{ name: 'CDB', date: '2026-12-01', cents: 500000 }]);
    expect(x.unquoted).toBe(1);
  });
});
