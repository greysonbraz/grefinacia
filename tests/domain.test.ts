import { describe, expect, it } from 'vitest';
import { parseMoney, formatBRL, mulCents, parseDecimal, pctChange } from '../src/lib/money';
import { addMonths, addMonthsYM, diffDays, makeDate, monthRange } from '../src/lib/dates';
import { emptyData, DEFAULT_SETTINGS } from '../src/lib/defaults';
import type { AppData, Asset, Operation, Transaction, DividendEvent } from '../src/lib/types';
import { accountBalance, buildInstallments, cardInvoiceDue, materializeRecurrences, monthSummary, projectedMonthEndBalance } from '../src/domain/ledger';
import { computePositions, operationsAreValid, portfolioTotals, quantityAt } from '../src/domain/portfolio';
import { dividendRows, forecastMonth, makeEventKey } from '../src/domain/dividends';
import { computeSalaryPlan, spendableView } from '../src/domain/salary';
import { goalProgress } from '../src/domain/goals';
import { netWorthAt } from '../src/domain/networth';
import { computeOverview } from '../src/domain/overview';
import { generateInsights } from '../src/domain/insights';
import { evaluateAlerts, planNotifications, hashId, salaryReceivedAlert } from '../src/domain/notifications';

const TODAY = '2026-11-11';

function tx(p: Partial<Transaction>): Transaction {
  return { id: Math.random().toString(36).slice(2), type: 'expense', kind: 'variavel', description: 'x', amountCents: 1000, categoryId: 'mercado', date: TODAY, paymentMethod: 'pix', accountId: 'a1', status: 'paid', createdAt: 1, ...p };
}
function base(): AppData {
  const d = emptyData();
  d.accounts.push({ id: 'a1', name: 'Conta', kind: 'corrente', initialCents: 100000, initialDate: '2026-11-01' });
  return d;
}

describe('dinheiro', () => {
  it('interpreta valores no padrão brasileiro sem erro de ponto flutuante', () => {
    expect(parseMoney('1.234,56')).toBe(123456);
    expect(parseMoney('R$ 1.234,5')).toBe(123450);
    expect(parseMoney('1234.56')).toBe(123456);
    expect(parseMoney('0,1')).toBe(10);
    expect(parseMoney('19,99')).toBe(1999);
    expect(parseMoney('1.234')).toBe(123400);
    expect(parseMoney('12')).toBe(1200);
    expect(parseMoney('0,005')).toBe(1);
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('1,2,3')).toBeNull();
  });
  it('formata em reais', () => {
    expect(formatBRL(123456).replace(/\s/g, ' ')).toBe('R$ 1.234,56');
    expect(formatBRL(-5000).replace(/\s/g, ' ')).toContain('50,00');
  });
  it('arredonda meios centavos para longe de zero', () => {
    expect(mulCents(1005, 0.5)).toBe(503);
    expect(mulCents(10, 0.15)).toBe(2);
    expect(mulCents(333, 0.3)).toBe(100);
  });
  it('converte decimais pt-BR', () => {
    expect(parseDecimal('0,0912')).toBeCloseTo(0.0912, 6);
    expect(parseDecimal('1.000')).toBe(1000);
    expect(parseDecimal('x')).toBeNull();
  });
  it('variação percentual', () => {
    expect(pctChange(115, 100)).toBeCloseTo(15);
    expect(pctChange(5, 0)).toBeNull();
  });
});

describe('datas', () => {
  it('soma meses ajustando fim de mês', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonthsYM('2026-11', 2)).toBe('2027-01');
    expect(addMonthsYM('2026-01', -1)).toBe('2025-12');
    expect(makeDate('2026-02', 31)).toBe('2026-02-28');
    expect(diffDays('2026-11-11', '2026-11-01')).toBe(10);
    expect(monthRange('2026-10', '2027-01')).toEqual(['2026-10', '2026-11', '2026-12', '2027-01']);
  });
});

describe('contas e cartões', () => {
  it('calcula saldo só com movimentos pagos desde a data inicial', () => {
    const d = base();
    d.transactions.push(
      tx({ type: 'income', amountCents: 500000, kind: 'salario' }),
      tx({ amountCents: 20000 }),
      tx({ amountCents: 99999, status: 'pending' }), // pendente: não conta
      tx({ amountCents: 77777, date: '2026-10-15' }), // anterior ao saldo inicial: não conta
    );
    expect(accountBalance(d.accounts[0], d)).toBe(100000 + 500000 - 20000);
  });
  it('compra no crédito só mexe no saldo quando a fatura é paga', () => {
    const d = base();
    d.cards.push({ id: 'c1', name: 'Roxo', closingDay: 10, dueDay: 17 });
    d.transactions.push(tx({ paymentMethod: 'credito', cardId: 'c1', accountId: undefined, status: 'pending', amountCents: 30000 }));
    expect(accountBalance(d.accounts[0], d)).toBe(100000);
    d.transactions[0].status = 'paid';
    d.transactions[0].accountId = 'a1';
    expect(accountBalance(d.accounts[0], d)).toBe(70000);
  });
  it('define fatura e vencimento pelo dia de fechamento', () => {
    const card = { id: 'c', name: 'x', closingDay: 10, dueDay: 17 };
    expect(cardInvoiceDue(card, '2026-11-10')).toEqual({ invoiceMonth: '2026-11', dueDate: '2026-11-17' });
    expect(cardInvoiceDue(card, '2026-11-11')).toEqual({ invoiceMonth: '2026-12', dueDate: '2026-12-17' });
    const c2 = { id: 'c', name: 'x', closingDay: 25, dueDay: 5 };
    expect(cardInvoiceDue(c2, '2026-11-20')).toEqual({ invoiceMonth: '2026-11', dueDate: '2026-12-05' });
    expect(cardInvoiceDue(c2, '2026-12-28')).toEqual({ invoiceMonth: '2027-01', dueDate: '2027-02-05' });
  });
  it('gera parcelas mensais', () => {
    const list = buildInstallments({ type: 'expense', kind: 'parcelada', description: 'Notebook', amountCents: 0, categoryId: 'compras', paymentMethod: 'boleto', accountId: 'a1' }, 25000, 3, '2026-11-30');
    expect(list.map((t) => t.date)).toEqual(['2026-11-30', '2026-12-30', '2027-01-30']);
    expect(list.map((t) => t.description)).toEqual(['Notebook (1/3)', 'Notebook (2/3)', 'Notebook (3/3)']);
    expect(new Set(list.map((t) => t.installment!.groupId)).size).toBe(1);
  });
  it('materializa recorrências uma única vez e respeita meses pulados', () => {
    const d = base();
    d.recurrences.push({ id: 'r1', type: 'expense', kind: 'assinatura', description: 'Streaming', amountCents: 3990, categoryId: 'assinaturas', paymentMethod: 'pix', accountId: 'a1', dayOfMonth: 15, startMonth: '2026-10', active: true, skipMonths: ['2026-10'] });
    const made = materializeRecurrences(d, TODAY);
    expect(made.map((t) => t.recurrenceMonth)).toEqual(['2026-11', '2026-12']);
    d.transactions.push(...made);
    expect(materializeRecurrences(d, TODAY)).toHaveLength(0);
  });
  it('resume o mês e projeta saldo', () => {
    const d = base();
    d.transactions.push(tx({ type: 'income', amountCents: 300000, kind: 'salario', categoryId: 'salario' }), tx({ amountCents: 50000, categoryId: 'moradia', kind: 'fixa' }), tx({ amountCents: 20000, status: 'pending', dueDate: '2026-11-20' }));
    const s = monthSummary(d, '2026-11');
    expect(s.incomeCents).toBe(300000);
    expect(s.expenseCents).toBe(70000);
    expect(s.byCategory.moradia).toBe(50000);
    expect(projectedMonthEndBalanceX(d)).toBe(100000 + 300000 - 50000 - 20000);
  });
});
function projectedMonthEndBalanceX(d: AppData) {
  return projectedMonthEndBalance(d, TODAY);
}

describe('carteira (preço médio)', () => {
  const asset: Asset = { id: 's1', ticker: 'ITSA4', type: 'acao' };
  const op = (p: Partial<Operation>): Operation => ({ id: Math.random().toString(), assetId: 's1', side: 'buy', quantity: 100, priceCents: 1000, feesCents: 0, date: '2026-01-10', broker: 'XP', createdAt: 1, ...p });
  it('calcula preço médio ponderado e mantém o médio nas vendas', () => {
    const ops = [op({}), op({ quantity: 100, priceCents: 1200, date: '2026-02-10' }), op({ side: 'sell', quantity: 50, priceCents: 1500, date: '2026-03-10' })];
    const [p] = computePositions([asset], ops);
    expect(p.quantity).toBe(150);
    expect(p.avgPriceCents).toBeCloseTo(1100);
    expect(p.costCents).toBe(165000);
    expect(p.realizedCents).toBe(50 * 1500 - 50 * 1100);
  });
  it('sem cotação usa o custo e não inventa lucro', () => {
    const [p] = computePositions([asset], [op({})]);
    expect(p.priceSource).toBe('none');
    expect(p.pnlCents).toBeNull();
    expect(p.valueCents).toBe(100000);
  });
  it('com cotação calcula lucro, % e participação', () => {
    const a2: Asset = { ...asset, quote: { priceCents: 1250, time: 'x', fetchedAt: 'x', source: 'brapi' } };
    const pos = computePositions([a2], [op({ feesCents: 500 })]);
    expect(pos[0].valueCents).toBe(125000);
    expect(pos[0].pnlCents).toBe(125000 - 100500);
    expect(pos[0].pnlPct).toBeCloseTo(((125000 - 100500) / 100500) * 100, 6);
    const t = portfolioTotals(pos, [{ id: 'f', name: 'CDB', investedCents: 100000, currentCents: 104000, currentUpdatedAt: TODAY, purchaseDate: TODAY }]);
    expect(t.investedCents).toBe(100500 + 100000);
    expect(t.valueCents).toBe(125000 + 104000);
    expect(t.pnlCents).toBe(24500 + 4000);
  });
  it('quantidade na data-com e validação de vendas', () => {
    const ops = [op({}), op({ side: 'sell', quantity: 40, date: '2026-02-01' })];
    expect(quantityAt(ops, 's1', '2026-01-31')).toBe(100);
    expect(quantityAt(ops, 's1', '2026-02-01')).toBe(60);
    expect(quantityAt(ops, 's1', '2026-01-09')).toBe(0);
    expect(operationsAreValid(ops).ok).toBe(true);
    expect(operationsAreValid([...ops, op({ side: 'sell', quantity: 61, date: '2026-03-01' })]).ok).toBe(false);
  });
});

describe('dividendos', () => {
  function withHoldings(): AppData {
    const d = base();
    d.assets.push({ id: 'f1', ticker: 'MXRF11', type: 'fii' }, { id: 's1', ticker: 'ITSA4', type: 'acao' });
    d.operations.push(
      { id: 'o1', assetId: 'f1', side: 'buy', quantity: 1000, priceCents: 1000, feesCents: 0, date: '2026-01-05', broker: 'XP', createdAt: 1 },
      { id: 'o2', assetId: 's1', side: 'buy', quantity: 200, priceCents: 1000, feesCents: 0, date: '2026-01-05', broker: 'XP', createdAt: 2 },
    );
    return d;
  }
  const ev = (p: Partial<DividendEvent>): DividendEvent => ({ id: Math.random().toString(), assetId: 'f1', kind: 'rendimento', ratePerUnit: 0.1, source: 'manual', official: true, key: Math.random().toString(), ...p });
  it('usa a quantidade da data-com (quem comprou depois não recebe)', () => {
    const d = withHoldings();
    d.dividends.push(ev({ dataCom: '2026-02-27', paymentDate: '2026-03-13' }), ev({ dataCom: '2025-12-30', paymentDate: '2026-01-13' }));
    const rows = dividendRows(d, TODAY);
    expect(rows).toHaveLength(1);
    expect(rows[0].grossCents).toBe(10000);
  });
  it('JCP tem 15% de IR; rendimento de FII não', () => {
    const d = withHoldings();
    d.dividends.push(ev({ assetId: 's1', kind: 'jcp', ratePerUnit: 0.5, dataCom: '2026-06-01', paymentDate: '2026-08-01' }));
    const [r] = dividendRows(d, TODAY);
    expect(r.grossCents).toBe(10000);
    expect(r.netCents).toBe(8500);
  });
  it('status: agendado, a confirmar e recebido', () => {
    const d = withHoldings();
    d.dividends.push(ev({ dataCom: '2026-11-01', paymentDate: '2026-12-15' }), ev({ dataCom: '2026-10-01', paymentDate: '2026-11-05' }), ev({ dataCom: '2026-09-01', paymentDate: '2026-10-10', receivedAt: '2026-10-10' }));
    const st = dividendRows(d, TODAY).map((r) => r.status).sort();
    expect(st).toEqual(['a_confirmar', 'agendado', 'recebido']);
  });
  it('previsão: separa oficial de estimado e não estima sem histórico', () => {
    const d = withHoldings();
    // FII com histórico mensal; ação sem histórico algum
    for (const [m, rate] of [['2026-06', 0.09], ['2026-07', 0.1], ['2026-08', 0.11], ['2026-09', 0.1], ['2026-10', 0.1], ['2026-11', 0.1]] as const) {
      d.dividends.push(ev({ dataCom: `${m}-01`, paymentDate: `${m}-14`, ratePerUnit: rate }));
    }
    const f = forecastMonth(d, '2026-12', TODAY);
    expect(f.officialCents).toBe(0);
    expect(f.estimatedCents).toBe(Math.round(((0.1 + 0.1 + 0.1) / 3) * 1000 * 100));
    expect(f.items[0].official).toBe(false);
    expect(f.withoutHistory).toEqual(['ITSA4']);
    // com anúncio oficial, o FII deixa de ser estimado
    d.dividends.push(ev({ dataCom: '2026-11-28', paymentDate: '2026-12-15', ratePerUnit: 0.08 }));
    const f2 = forecastMonth(d, '2026-12', TODAY);
    expect(f2.officialCents).toBe(8000);
    expect(f2.estimatedCents).toBe(0);
  });
  it('ação sem padrão mensal usa o mesmo mês do ano anterior', () => {
    const d = withHoldings();
    d.dividends.push(ev({ assetId: 's1', kind: 'dividendo', ratePerUnit: 0.25, dataCom: '2025-12-01', paymentDate: '2025-12-20' }));
    const f = forecastMonth(d, '2026-12', TODAY);
    const it = f.items.find((i) => i.ticker === 'ITSA4')!;
    expect(it.official).toBe(false);
    expect(it.cents).toBe(5000);
    expect(makeEventKey('itsa4', 'jcp', '2026-01-01', 0.1)).toBe('ITSA4|jcp|2026-01-01|0.10000000');
  });
});

describe('plano salarial', () => {
  it('divide o que sobra depois das despesas fixas', () => {
    const p = computeSalaryPlan(500000, 300000, 30, 25);
    expect(p.availableCents).toBe(200000);
    expect(p.saveCents).toBe(60000);
    expect(p.investCents).toBe(50000);
    expect(p.freeCents).toBe(90000);
    expect(p.saveCents + p.investCents + p.freeCents).toBe(p.availableCents);
    expect(p.risk).toBe('ok');
  });
  it('alerta déficit quando as fixas passam da receita', () => {
    const p = computeSalaryPlan(300000, 350000, 20, 20);
    expect(p.risk).toBe('deficit');
    expect(p.deficitCents).toBe(50000);
    expect(p.saveCents + p.investCents + p.freeCents).toBe(0);
  });
  it('limita percentuais a 100% no total', () => {
    const p = computeSalaryPlan(100000, 0, 80, 60);
    expect(p.savePct + p.investPct + p.freePct).toBe(100);
  });
  it('quanto ainda posso gastar considera gastos variáveis do mês', () => {
    const d = base();
    const s = { ...DEFAULT_SETTINGS, salary: { ...DEFAULT_SETTINGS.salary, amountCents: 500000, savePct: 20, investPct: 20 } };
    d.transactions.push(tx({ kind: 'fixa', amountCents: 200000, status: 'pending' }), tx({ kind: 'variavel', amountCents: 30000 }));
    const v = spendableView(d, s, '2026-11', TODAY);
    expect(v.incomeSource).toBe('previsto');
    expect(v.plan.freeCents).toBe(180000);
    expect(v.remainingCents).toBe(150000);
    expect(v.daysLeft).toBe(20);
    expect(v.perDayCents).toBe(7500);
  });
});

describe('metas', () => {
  it('calcula percentual e previsão pelo aporte planejado', () => {
    const g = { id: 'g', name: 'Viagem', icon: 'Plane', targetCents: 1000000, monthlyPlanCents: 100000, createdAt: 1 };
    const moves = [{ id: 'm', goalId: 'g', amountCents: 400000, date: '2026-10-01', createdAt: 1 }];
    const p = goalProgress(g, moves, TODAY);
    expect(p.pct).toBe(40);
    expect(p.remainingCents).toBe(600000);
    expect(p.etaMonths).toBe(6);
    expect(p.etaDate).toBe('2027-05-11');
    expect(goalProgress({ ...g, deadline: '2027-01-01' }, moves, TODAY).status).toBe('atrasada');
    expect(goalProgress(g, [...moves, { id: 'm2', goalId: 'g', amountCents: 600000, date: TODAY, createdAt: 2 }], TODAY).status).toBe('concluida');
  });
  it('sem aporte planejado usa o histórico de 90 dias', () => {
    const g = { id: 'g', name: 'Carro', icon: 'Car', targetCents: 3000000, createdAt: 1 };
    const moves = [{ id: 'm', goalId: 'g', amountCents: 300000, date: '2026-10-01', createdAt: 1 }];
    const p = goalProgress(g, moves, TODAY);
    expect(p.basis).toBe('historico');
    expect(p.monthlyCents).toBe(100000);
  });
});

describe('patrimônio, assistente e notificações', () => {
  function rich(): AppData {
    const d = base();
    d.assets.push({ id: 's1', ticker: 'BBAS3', type: 'acao', quote: { priceCents: 2500, time: TODAY, fetchedAt: TODAY, source: 'brapi' } });
    d.operations.push({ id: 'o', assetId: 's1', side: 'buy', quantity: 100, priceCents: 2000, feesCents: 0, date: '2026-10-05', broker: 'XP', createdAt: 1, accountId: 'a1' });
    d.goals.push({ id: 'g', name: 'Reserva de emergência', icon: 'Shield', targetCents: 1000000, createdAt: 1 });
    d.goalMoves.push({ id: 'gm', goalId: 'g', amountCents: 50000, date: TODAY, accountId: 'a1', createdAt: 1 });
    return d;
  }
  it('patrimônio = contas + reservas + investimentos (sem contar duas vezes)', () => {
    const d = rich();
    const nw = netWorthAt(d, TODAY, TODAY);
    expect(nw.accountsCents).toBe(100000 - 50000); // op de out/2026 é anterior ao saldo inicial (não debita)
    expect(nw.goalsCents).toBe(50000);
    expect(nw.equityMarketCents).toBe(250000);
    expect(nw.totalCents).toBe(50000 + 50000 + 250000);
  });
  it('assistente gera alerta de déficit e de contas atrasadas', () => {
    const d = rich();
    d.transactions.push(tx({ type: 'income', amountCents: 100000, kind: 'salario', categoryId: 'salario' }), tx({ amountCents: 400000, kind: 'fixa' }), tx({ status: 'pending', dueDate: '2026-11-05', date: '2026-11-05', amountCents: 9000 }));
    const o = computeOverview(d, DEFAULT_SETTINGS, TODAY);
    const ids = generateInsights(o, d, DEFAULT_SETTINGS).map((i) => i.id);
    expect(ids).toContain('deficit');
    expect(ids).toContain('overdue');
    expect(ids).toContain('low-balance');
    expect(ids).not.toContain('can-invest');
  });
  it('agenda notificações de contas, salário e proventos com ids estáveis', () => {
    const d = rich();
    const s = { ...DEFAULT_SETTINGS, salary: { ...DEFAULT_SETTINGS.salary, amountCents: 500000, payDay: 20 } };
    d.transactions.push(tx({ status: 'pending', description: 'Internet', amountCents: 9900, date: '2026-11-15', dueDate: '2026-11-15' }));
    d.dividends.push({ id: 'dv', assetId: 's1', kind: 'dividendo', ratePerUnit: 0.5, dataCom: '2026-11-05', paymentDate: '2026-11-18', source: 'manual', official: true, key: 'k' });
    const now = new Date(2026, 10, 11, 4, 26);
    const plan = planNotifications(d, s, now, TODAY);
    const keys = plan.map((p) => p.key);
    expect(keys).toContain('bill-before:2026-11-15');
    expect(keys).toContain('bill-due:2026-11-15');
    expect(keys).toContain('salary:2026-11');
    expect(keys).toContain('div-soon:dv');
    expect(keys).toContain('div-pay:dv');
    expect(plan.every((p) => p.at.getTime() > now.getTime())).toBe(true);
    expect(plan.find((p) => p.key === 'bill-due:2026-11-15')!.body).toContain('Internet');
    const again = planNotifications(d, s, now, TODAY);
    expect(again.map((p) => p.id)).toEqual(plan.map((p) => p.id));
    expect(hashId('abc')).toBeGreaterThan(0);
    expect(planNotifications(d, { ...s, notifications: { ...s.notifications, enabled: false } }, now, TODAY)).toHaveLength(0);
  });
  it('alertas imediatos: orçamento estourado, meta alcançada e mensagem de salário', () => {
    const d = rich();
    d.goalMoves.push({ id: 'gm2', goalId: 'g', amountCents: 950000, date: TODAY, createdAt: 2 });
    const s = { ...DEFAULT_SETTINGS, salary: { ...DEFAULT_SETTINGS.salary, amountCents: 500000, savePct: 30, investPct: 25 }, budgets: { mercado: 10000 } };
    d.transactions.push(tx({ categoryId: 'mercado', amountCents: 15000 }));
    const al = evaluateAlerts(d, s, TODAY).map((a) => a.key);
    expect(al).toContain('budget:mercado:2026-11');
    expect(al).toContain('goal:g');
    const sal = salaryReceivedAlert(d, s, '2026-11', TODAY)!;
    expect(sal.body).toContain('Seu salário foi recebido!');
    expect(sal.body).toContain('guardar');
  });
});
