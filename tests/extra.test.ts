import { describe, expect, it } from 'vitest';
import { emptyData, DEFAULT_SETTINGS } from '../src/lib/defaults';
import type { Debt } from '../src/lib/types';
import { pricePayment, presentValue, simulatePayoff, simulateExtra, simulateAnticipation, simulateRefinance, simulateStrategy, annualFromMonthly } from '../src/domain/debts';
import { estimateFixed, irRate, simulateGrowth } from '../src/domain/fixedincome';
import { monthlyClosing, financialFreedom } from '../src/domain/reports';
import { computeOverview } from '../src/domain/overview';
import { answerLocally, buildAiContext } from '../src/domain/chat';
import { createBackup, readBackup } from '../src/services/backup';
import { createCredential, verifyCredential } from '../src/services/security';
import { loadAll, putItems, deleteItems, saveSettings, replaceEverything, closeDB } from '../src/db/db';

const TODAY = '2026-11-11';
const debt = (p: Partial<Debt>): Debt => ({ id: 'd', kind: 'emprestimo', name: 'Empréstimo', institution: 'Banco', originalCents: 1200000, balanceCents: 1000000, installmentCents: 50000, remainingInstallments: 24, monthlyRatePct: 2, dueDay: 10, createdAt: 1, ...p });

describe('dívidas', () => {
  it('Tabela Price e valor presente são inversos', () => {
    const p = pricePayment(1000000, 2, 24);
    expect(p).toBe(52871);
    expect(Math.abs(presentValue(p, 2, 24) - 1000000)).toBeLessThan(10);
    expect(pricePayment(120000, 0, 12)).toBe(10000);
    expect(annualFromMonthly(2)).toBeCloseTo(26.82, 1);
  });
  it('quitação: extra reduz prazo e juros; parcela menor que os juros nunca quita', () => {
    const base = simulatePayoff(1000000, 2, 52871);
    expect(base.months).toBe(24);
    const s = simulateExtra(debt({ installmentCents: 52871 }), 30000);
    expect(s.withExtra.months).toBeLessThan(24);
    expect(s.monthsSaved).toBeGreaterThan(0);
    expect(s.interestSavedCents).toBeGreaterThan(0);
    expect(simulatePayoff(1000000, 2, 15000).months).toBe(Infinity);
  });
  it('antecipar parcelas dá desconto dos juros', () => {
    const a = simulateAnticipation(debt({ installmentCents: 52871 }), 3);
    expect(a.nominalCents).toBe(52871 * 3);
    expect(a.payNowCents).toBe(Math.round(52871 / 1.02 ** 22 + 52871 / 1.02 ** 23 + 52871 / 1.02 ** 24));
    expect(a.savedCents).toBeGreaterThan(0);
  });
  it('portabilidade: taxa menor economiza; tarifa alta pode anular', () => {
    const d = debt({ installmentCents: 52871 });
    expect(simulateRefinance(d, 1.2, 24, 0).savedCents).toBeGreaterThan(0);
    expect(simulateRefinance(d, 1.95, 24, 100000).savedCents).toBeLessThan(0);
  });
  it('avalanche paga menos juros que bola de neve', () => {
    const ds = [debt({ id: 'a', name: 'Cartão', balanceCents: 500000, monthlyRatePct: 10, installmentCents: 60000 }), debt({ id: 'b', name: 'Consignado', balanceCents: 200000, monthlyRatePct: 1.5, installmentCents: 20000 })];
    const av = simulateStrategy(ds, 20000, 'avalanche');
    const sn = simulateStrategy(ds, 20000, 'snowball');
    expect(av.interestCents).toBeLessThanOrEqual(sn.interestCents);
    expect(sn.order[0]).toBe('Consignado');
  });
});

describe('renda fixa', () => {
  it('IR regressivo e isenção de LCI/LCA', () => {
    expect(irRate('cdb', 100)).toBe(0.225);
    expect(irRate('cdb', 800)).toBe(0.15);
    expect(irRate('lci', 100)).toBe(0);
  });
  it('estima valor pela taxa informada e não inventa sem taxa', () => {
    const f = { id: 'f', name: 'CDB', investedCents: 1000000, currentCents: 1000000, currentUpdatedAt: TODAY, purchaseDate: '2025-11-11', kind: 'cdb' as const, annualRatePct: 10 };
    const e = estimateFixed(f, TODAY);
    expect(e.grossCents).toBe(1100000);
    expect(e.taxCents).toBe(17500);
    expect(e.netCents).toBe(1082500);
    expect(estimateFixed({ ...f, annualRatePct: undefined }, TODAY).grossCents).toBeNull();
    const g = simulateGrowth(0, 10000, 0, 12);
    expect(g[11].valueCents).toBe(120000);
  });
});

describe('fechamento, liberdade financeira e chat', () => {
  function data() {
    const d = emptyData();
    d.accounts.push({ id: 'a1', name: 'Conta', kind: 'corrente', initialCents: 200000, initialDate: '2026-11-01' });
    const t = (p: object) => ({ id: Math.random().toString(), type: 'expense', kind: 'variavel', description: 'x', amountCents: 1000, categoryId: 'mercado', date: TODAY, paymentMethod: 'pix', accountId: 'a1', status: 'paid', createdAt: 1, ...p }) as never;
    d.transactions.push(t({ type: 'income', kind: 'salario', categoryId: 'salario', amountCents: 350000 }), t({ kind: 'fixa', categoryId: 'moradia', amountCents: 150000 }), t({ categoryId: 'juros', amountCents: 5000 }), t({ amountCents: 40000 }));
    d.debts.push(debt({}));
    return d;
  }
  const s = { ...DEFAULT_SETTINGS, salary: { ...DEFAULT_SETTINGS.salary, amountCents: 350000, payDay: 5 } };
  it('fechamento mensal soma receitas, despesas, juros e variação patrimonial', () => {
    const c = monthlyClosing(data(), '2026-11', TODAY);
    expect(c.receivedCents).toBe(350000);
    expect(c.spentCents).toBe(195000);
    expect(c.savedCents).toBe(155000);
    expect(c.interestPaidCents).toBe(5000);
    expect(c.debtRemainingCents).toBe(1000000);
    expect(c.netWorthEndCents).toBe(200000 + 155000);
  });
  it('liberdade financeira calcula patrimônio necessário pela taxa assumida', () => {
    const f = financialFreedom(data(), s, TODAY);
    expect(f.expensesMonthlyCents).toBe(195000);
    expect(f.requiredCents).toBe(Math.round((195000 * 12) / 0.06));
    expect(f.coveragePct).toBe(0);
  });
  it('chat local responde com cálculos reais', () => {
    const d = data();
    const o = computeOverview(d, s, TODAY);
    const a = answerLocally('Quanto posso gastar até o próximo salário?', o, d, s);
    expect(a.text).toContain('05/12/2026');
    expect(a.calc!.length).toBeGreaterThan(3);
    expect(answerLocally('Quanto consegui economizar este mês?', o, d, s).text).toContain('1.550,00');
    expect(answerLocally('Qual dívida devo quitar primeiro?', o, d, s).text).toContain('Empréstimo');
    expect(answerLocally('Posso comprar uma moto de R$ 15.000 sem comprometer minhas finanças?', o, d, s).calc![0]).toContain('15.000,00');
    expect(answerLocally('Posso comprar uma moto?', o, d, s).text).toContain('valor da compra');
    expect(answerLocally('Quais despesas posso reduzir?', o, d, s).calc!.length).toBeGreaterThan(0);
    const ctx = JSON.parse(buildAiContext(o, d, s));
    expect(ctx.mesAtual.receitas).toBe(3500);
    expect(JSON.stringify(ctx)).not.toContain('"x"');
  });
});

describe('segurança, backup e banco', () => {
  it('senha: hash com sal, verificação correta e incorreta', async () => {
    const c = await createCredential('123456');
    const sec = { ...DEFAULT_SETTINGS.security, ...c };
    expect(c.hash).not.toContain('123456');
    expect(await verifyCredential(sec, '123456')).toBe(true);
    expect(await verifyCredential(sec, '123457')).toBe(false);
  }, 20000);
  it('backup criptografado: abre com a senha certa, falha com a errada e não leva o PIN', async () => {
    const d = emptyData();
    d.accounts.push({ id: 'a', name: 'Conta secreta', kind: 'corrente', initialCents: 123, initialDate: TODAY });
    const file = await createBackup(d, { ...DEFAULT_SETTINGS, security: { ...DEFAULT_SETTINGS.security, hash: 'HASH' } }, 'senha-forte');
    expect(file).not.toContain('Conta secreta');
    const r = await readBackup(file, 'senha-forte');
    expect(r.data.accounts[0].name).toBe('Conta secreta');
    expect(JSON.stringify(r.settings)).not.toContain('HASH');
    await expect(readBackup(file, 'errada')).rejects.toThrow('Senha incorreta');
    await expect(readBackup('{"x":1}', 'a')).rejects.toThrow('Arquivo inválido');
  }, 30000);
  it('banco persiste, remove e restaura', async () => {
    await putItems('accounts', [{ id: 'a', name: 'C', kind: 'corrente', initialCents: 1, initialDate: TODAY } as { id: string }]);
    await saveSettings({ ...DEFAULT_SETTINGS, onboarded: true });
    await closeDB();
    let l = await loadAll();
    expect(l.data.accounts).toHaveLength(1);
    expect(l.settings.onboarded).toBe(true);
    expect(l.settings.ai.mode).toBe('local');
    await deleteItems('accounts', ['a']);
    l = await loadAll();
    expect(l.data.accounts).toHaveLength(0);
    const d = emptyData();
    d.debts.push(debt({}));
    await replaceEverything(d, DEFAULT_SETTINGS);
    l = await loadAll();
    expect(l.data.debts).toHaveLength(1);
    expect(l.settings.onboarded).toBe(false);
  });
});
