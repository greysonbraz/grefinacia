import { beforeEach, describe, expect, it } from 'vitest';
import { deleteDB } from 'idb';
import { cancelEvent, dividendRows, eventStatus, isReceived, makeEventKey, mergeEvents, reactivateEvent } from '../src/domain/dividends';
import { matchReceipts, passiveDashboard, totalReturn } from '../src/domain/passiveIncome';
import { financialFreedom, monthlyClosing, passiveIncomeSeries } from '../src/domain/reports';
import { planNotifications } from '../src/domain/notifications';
import { DEFAULT_SETTINGS, emptyData } from '../src/lib/defaults';
import type { AppData, DividendEvent, Transaction } from '../src/lib/types';
import { closeDB } from '../src/db/db';
import { setSecretStoreForTests } from '../src/services/secrets';
import { afterChange, cancelDividend, confirmDividend, getState, init, reactivateDividend, upsert } from '../src/state/store';

const TODAY = '2026-11-16';
let n = 0;
const ev = (p: Partial<DividendEvent>): DividendEvent => {
  const e = { id: 'd' + n++, assetId: 's1', kind: 'dividendo' as const, ratePerUnit: 0.5, source: 'api' as const, sourceName: 'Yahoo Finance (não oficial)', official: true, key: '', ...p };
  return { ...e, key: p.key ?? makeEventKey(e.assetId === 'f1' ? 'MXRF11' : 'ITSA4', e.kind, e.dataCom, e.ratePerUnit) };
};
const tx = (p: Partial<Transaction>): Transaction => ({ id: 't' + n++, type: 'income', kind: 'outro_rendimento', description: 'Crédito', amountCents: 1000, categoryId: 'outros_rend', date: TODAY, paymentMethod: 'transferencia', accountId: 'a1', status: 'paid', createdAt: n, source: 'import', ...p });
function base(): AppData {
  const d = emptyData();
  d.accounts.push({ id: 'a1', name: 'Conta', kind: 'corrente', initialCents: 0, initialDate: '2026-01-01' });
  d.assets.push({ id: 's1', ticker: 'ITSA4', type: 'acao', quote: { priceCents: 1200, time: TODAY, fetchedAt: TODAY, source: 'brapi' } }, { id: 'f1', ticker: 'MXRF11', type: 'fii' });
  d.operations.push(
    { id: 'o1', assetId: 's1', side: 'buy', quantity: 100, priceCents: 1000, feesCents: 500, date: '2026-01-05', broker: 'XP', createdAt: 1 },
    { id: 'o2', assetId: 'f1', side: 'buy', quantity: 200, priceCents: 1000, feesCents: 0, date: '2026-01-05', broker: 'XP', createdAt: 2 },
  );
  return d;
}

describe('status do provento', () => {
  it('segue o ciclo: anunciado → aguardando data-com → direito adquirido → pagamento previsto → aguardando confirmação → pago; cancelado', () => {
    expect(eventStatus(ev({}), TODAY)).toBe('anunciado');
    expect(eventStatus(ev({ dataCom: '2026-11-20' }), TODAY)).toBe('aguardando_data_com');
    expect(eventStatus(ev({ dataCom: TODAY }), TODAY)).toBe('aguardando_data_com'); // ainda dá para comprar hoje
    expect(eventStatus(ev({ dataCom: '2026-11-10' }), TODAY)).toBe('direito_adquirido');
    expect(eventStatus(ev({ dataCom: '2026-11-10', paymentDate: '2026-11-30' }), TODAY)).toBe('pagamento_previsto');
    expect(eventStatus(ev({ dataCom: '2026-10-10', paymentDate: '2026-11-10' }), TODAY)).toBe('aguardando_confirmacao');
    expect(eventStatus(ev({ dataCom: '2026-10-10', paymentDate: '2026-11-10', receivedAt: '2026-11-10' }), TODAY)).toBe('pago');
    expect(eventStatus(ev({ receivedAt: '2026-11-10', cancelledAt: 'x' }), TODAY)).toBe('cancelado');
  });

  it('a data de pagamento passar NÃO conta como recebido em lugar nenhum', () => {
    const d = base();
    d.dividends.push(ev({ dataCom: '2026-10-01', paymentDate: '2026-11-05' }));
    expect(dividendRows(d, TODAY)[0].status).toBe('aguardando_confirmacao');
    expect(passiveIncomeSeries(d, 12, TODAY).reduce((t, m) => t + m.cents, 0)).toBe(0);
    expect(monthlyClosing(d, '2026-11', TODAY).dividendsCents).toBe(0);
    expect(financialFreedom(d, DEFAULT_SETTINGS, TODAY).passiveMonthlyCents).toBe(0);
    const p = passiveDashboard(d, TODAY);
    expect([p.monthCents, p.yearCents, p.totalCents]).toEqual([0, 0, 0]);
    expect(p.awaitingCents).toBe(5000);
    expect(totalReturn(d, TODAY).dividendsReceivedCents).toBe(0);
  });
});

describe('quantidade elegível', () => {
  it('conta compras e vendas até a data-com (inclusive); a partir do dia seguinte, não', () => {
    const d = base();
    d.operations.push(
      { id: 'o3', assetId: 's1', side: 'buy', quantity: 50, priceCents: 1000, feesCents: 0, date: '2026-10-10', broker: 'XP', createdAt: 3 },
      { id: 'o4', assetId: 's1', side: 'sell', quantity: 30, priceCents: 1100, feesCents: 0, date: '2026-10-11', broker: 'XP', createdAt: 4 },
    );
    d.dividends.push(ev({ dataCom: '2026-10-10', paymentDate: '2026-10-30' }), ev({ dataCom: '2026-10-11', paymentDate: '2026-10-31', ratePerUnit: 0.1 }));
    const [b, a] = dividendRows(d, TODAY);
    expect(a.quantity).toBe(150); // comprou no dia da data-com: tem direito
    expect(b.quantity).toBe(120); // vendeu 30 na data-com seguinte: perde o direito sobre elas
  });
  it('antes da data-com usa o que você tem hoje', () => {
    const d = base();
    d.dividends.push(ev({ dataCom: '2026-12-01' }));
    expect(dividendRows(d, TODAY)[0].quantity).toBe(100);
  });
});

describe('fonte: duplicidade, correções e sumiço', () => {
  it('mesmo evento não duplica; valor corrigido vira correção com histórico, não provento novo', () => {
    const old = ev({ dataCom: '2026-10-01', paymentDate: '2026-11-30', ratePerUnit: 0.5 });
    const same = { ...old, id: 'outro' };
    expect(mergeEvents([old], [same]).toUpsert).toEqual([]);
    const fixed = ev({ dataCom: '2026-10-01', paymentDate: '2026-11-30', ratePerUnit: 0.55 });
    const r = mergeEvents([old], [fixed], { now: '2026-11-16T10:00:00Z' });
    expect(r.added).toEqual([]);
    expect(r.changed).toHaveLength(1);
    expect(r.toUpsert[0]).toMatchObject({ id: old.id, ratePerUnit: 0.55, key: fixed.key });
    expect(r.toUpsert[0].revisions![0]).toEqual({ at: '2026-11-16T10:00:00Z', source: 'Yahoo Finance (não oficial)', text: 'valor por cota R$ 0,5 → R$ 0,55' });
  });
  it('provento já confirmado não muda de valor: só ganha anotação', () => {
    const old = ev({ dataCom: '2026-10-01', paymentDate: '2026-10-30', ratePerUnit: 0.5, receivedAt: '2026-10-30' });
    const r = mergeEvents([old], [ev({ dataCom: '2026-10-01', paymentDate: '2026-10-30', ratePerUnit: 0.6 })]);
    expect(r.toUpsert[0].ratePerUnit).toBe(0.5);
    expect(r.toUpsert[0].revisions![0].text).toMatch(/já confirmado, mantido/);
    expect(r.changed).toEqual([]);
  });
  it('data de pagamento mudou: atualiza e registra', () => {
    const old = ev({ dataCom: '2026-10-01', paymentDate: '2026-11-20' });
    const r = mergeEvents([old], [{ ...old, paymentDate: '2026-11-27' }]);
    expect(r.changed[0].text).toBe('data de pagamento 20/11/2026 → 27/11/2026');
  });
  it('sumiu da fonte: marca para conferir, não cancela nem apaga; voltou: desmarca', () => {
    const gone = ev({ dataCom: '2026-10-01', paymentDate: '2026-12-01' });
    const r = mergeEvents([gone], [], { coveredAssetIds: ['s1'], sourceName: 'Yahoo Finance (não oficial)', today: TODAY });
    expect(r.missing).toHaveLength(1);
    expect(r.missing[0].missingSince).toBeTruthy();
    expect(r.missing[0].cancelledAt).toBeUndefined();
    expect(mergeEvents([gone], [], { coveredAssetIds: [], today: TODAY }).missing).toEqual([]); // fonte falhou para o ativo: não acusa
    const back = mergeEvents([r.missing[0]], [gone]);
    expect(back.toUpsert[0].missingSince).toBeUndefined();
  });
  it('o que você cadastrou prevalece sobre a fonte', () => {
    const mine = ev({ source: 'manual', dataCom: '2026-10-01', paymentDate: '2026-11-20' });
    expect(mergeEvents([mine], [{ ...mine, id: 'x', source: 'api', paymentDate: '2026-11-25' }]).toUpsert).toEqual([]);
  });
  it('cancelar e reativar guardam histórico; cancelado sai dos totais e da previsão', () => {
    const d = base();
    const e = ev({ dataCom: '2026-11-10', paymentDate: '2026-12-10' });
    d.dividends.push(cancelEvent(e, 'usuario', '2026-11-16T00:00:00Z'));
    const [row] = dividendRows(d, TODAY);
    expect(row.status).toBe('cancelado');
    expect(passiveDashboard(d, TODAY).upcomingAnnouncedCents).toBe(0);
    const back = reactivateEvent(d.dividends[0], '2026-11-16T01:00:00Z');
    expect(back.revisions!.map((r) => r.text)).toEqual(['cancelado', 'reativado']);
  });
});

describe('confirmação pelo extrato importado', () => {
  it('reconhece pelo código do ativo e valor (líquido do JCP ou bruto)', () => {
    const d = base();
    const jcp = ev({ kind: 'jcp', dataCom: '2026-10-01', paymentDate: '2026-11-10', ratePerUnit: 0.2 }); // 100 × 0,20 = 20,00 bruto; 17,00 líquido
    d.dividends.push(jcp);
    d.transactions.push(tx({ description: 'JUROS S/CAPITAL ITSA4', amountCents: 1700, date: '2026-11-10' }), tx({ description: 'PIX RECEBIDO', amountCents: 1700, date: '2026-11-10' }));
    const m = matchReceipts(d, TODAY);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ eventId: jcp.id, how: 'codigo' });
  });
  it('aceita palavra de provento + prefixo do código, com tolerância menor', () => {
    const d = base();
    d.dividends.push(ev({ assetId: 'f1', kind: 'rendimento', dataCom: '2026-10-31', paymentDate: '2026-11-14', ratePerUnit: 0.1, key: 'x' }));
    d.transactions.push(tx({ description: 'RENDIMENTO MXRF', amountCents: 2000, date: '2026-11-14' }));
    expect(matchReceipts(d, TODAY)).toHaveLength(1);
    d.transactions[0] = { ...d.transactions[0], amountCents: 2050 }; // 2,5% de diferença
    expect(matchReceipts(d, TODAY)).toHaveLength(0);
  });
  it('fora da janela de datas, ou crédito já usado por outro provento, não confirma', () => {
    const d = base();
    const e1 = ev({ dataCom: '2026-10-01', paymentDate: '2026-11-01' });
    d.dividends.push(e1);
    d.transactions.push(tx({ description: 'DIVIDENDOS ITSA4', amountCents: 5000, date: '2026-11-15' })); // 14 dias depois
    expect(matchReceipts(d, TODAY)).toEqual([]);
    d.transactions[0] = { ...d.transactions[0], date: '2026-11-03' };
    d.dividends.push(ev({ dataCom: '2026-09-01', paymentDate: '2026-10-01', receivedAt: '2026-10-01', receivedTxId: d.transactions[0].id }));
    expect(matchReceipts(d, TODAY)).toEqual([]);
  });
});

describe('painel e rentabilidade total', () => {
  it('recebido no mês/ano/total, média, a receber e por tipo, sem misturar previsto', () => {
    const d = base();
    d.dividends.push(
      ev({ dataCom: '2026-03-01', paymentDate: '2026-03-20', receivedAt: '2026-03-20' }), // 50,00
      ev({ kind: 'jcp', dataCom: '2026-10-01', paymentDate: '2026-11-05', ratePerUnit: 0.2, receivedAt: '2026-11-05' }), // 17,00 líquido
      ev({ dataCom: '2026-11-10', paymentDate: '2026-12-15', ratePerUnit: 0.3 }), // 30,00 a receber
    );
    const p = passiveDashboard(d, TODAY);
    expect(p.monthCents).toBe(1700);
    expect(p.yearCents).toBe(6700);
    expect(p.totalCents).toBe(6700);
    expect(p.avgMonths).toBe(9); // de março a novembro
    expect(p.avgMonthlyCents).toBe(Math.round(6700 / 9));
    expect(p.upcomingAnnouncedCents).toBe(3000);
    expect(p.byKind).toEqual([{ kind: 'dividendo', receivedCents: 5000 }, { kind: 'jcp', receivedCents: 1700 }]);
    expect(p.months.find((m) => m.ym === '2026-12')).toMatchObject({ receivedCents: 0, announcedCents: 3000 });
  });
  it('rentabilidade: valorização + vendas + proventos recebidos − custos; futuros à parte', () => {
    const d = base();
    d.operations.push({ id: 'o5', assetId: 's1', side: 'sell', quantity: 50, priceCents: 1100, feesCents: 250, date: '2026-06-01', broker: 'XP', createdAt: 5 });
    d.dividends.push(ev({ dataCom: '2026-03-01', paymentDate: '2026-03-20', receivedAt: '2026-03-20' }), ev({ dataCom: '2026-11-10', paymentDate: '2026-12-15', ratePerUnit: 0.3 }));
    const t = totalReturn(d, TODAY);
    const itsa = t.assets.find((a) => a.ticker === 'ITSA4')!;
    // comprou 100 × 10,00 + 5,00 = 1.005,00; vendeu 50 × 11,00 − 2,50 = 547,50; resta 50 a 12,00 = 600,00 (custo 502,50)
    expect(itsa.investedCents).toBe(100500);
    expect(itsa.soldCents).toBe(54750);
    expect(itsa.valueCents).toBe(60000);
    expect(itsa.appreciationCents).toBe(9750);
    expect(itsa.realizedCents).toBe(4500);
    expect(itsa.dividendsCents).toBe(5000); // 100 cotas na data-com de março
    expect(itsa.totalCents).toBe(9750 + 4500 + 5000);
    expect(itsa.totalCents).toBe(60000 + 54750 + 5000 - 100500); // mesma conta pelo dinheiro
    expect(t.dividendsUpcomingCents).toBe(1500); // 50 cotas × 0,30, fora do resultado
  });
});

describe('avisos', () => {
  it('data-com chegando e pagamento: só para quem tem direito; nada para pago ou cancelado', () => {
    const d = base();
    d.dividends.push(ev({ dataCom: '2026-11-20', paymentDate: '2026-12-05' }), ev({ dataCom: '2026-10-01', paymentDate: '2026-11-25', cancelledAt: 'x' }));
    const s = { ...DEFAULT_SETTINGS, notifications: { ...DEFAULT_SETTINGS.notifications, enabled: true } };
    const ids = planNotifications(d, s, new Date('2026-11-16T08:00:00'), TODAY).map((x) => x.key ?? x.id ?? x.title);
    expect(JSON.stringify(ids)).toMatch(/div-com:/);
    expect(JSON.stringify(ids)).not.toMatch(new RegExp(d.dividends[1].id + '"'));
  });
});

describe('no app: confirmação automática e "Recebi" sem duplicar', () => {
  beforeEach(async () => {
    await closeDB();
    await deleteDB('grefinacia');
    setSecretStoreForTests(null);
  });
  it('extrato importado confirma sozinho; "Recebi" liga ao crédito existente; apagar o crédito desfaz', async () => {
    await init();
    const d = base();
    await upsert('accounts', d.accounts);
    await upsert('assets', d.assets);
    await upsert('operations', d.operations);
    const auto = ev({ dataCom: '2026-10-01', paymentDate: '2026-11-10' });
    const manual = ev({ kind: 'jcp', dataCom: '2026-10-02', paymentDate: '2026-11-12', ratePerUnit: 0.2 });
    await upsert('dividends', [auto, manual]);
    const credit = tx({ id: 'c1', description: 'DIVIDENDOS ITSA4', amountCents: 5000, date: '2026-11-11' });
    await upsert('transactions', credit);
    await afterChange();
    const a = getState().data.dividends.find((x) => x.id === auto.id)!;
    expect(a).toMatchObject({ receivedAt: '2026-11-11', receivedTxId: 'c1', confirmedBy: 'extrato' });
    expect(getState().data.transactions.find((t) => t.id === 'c1')!.categoryId).toBe('dividendos');
    expect(isReceived(dividendRows(getState().data, getState().today).find((r) => r.event.id === auto.id)!)).toBe(true);

    // crédito com descrição genérica: o automático não reconhece; "Recebi" liga ao crédito em vez de criar outro
    await upsert('transactions', tx({ id: 'c2', description: 'JCP ITSA', amountCents: 1700, date: '2026-11-12' }));
    const before = getState().data.transactions.length;
    await confirmDividend(manual.id);
    expect(getState().data.transactions.length).toBe(before);
    expect(getState().data.dividends.find((x) => x.id === manual.id)!.receivedTxId).toBe('c2');

    // importação desfeita (crédito apagado): a confirmação volta a "aguardando", com anotação
    const { remove } = await import('../src/state/store');
    await remove('transactions', 'c1');
    await afterChange();
    const back = getState().data.dividends.find((x) => x.id === auto.id)!;
    expect(back.receivedAt).toBeUndefined();
    expect(back.revisions!.at(-1)!.text).toMatch(/confirmação desfeita/);

    // cancelar não apaga; reativar volta
    await cancelDividend(auto.id);
    expect(getState().data.dividends.find((x) => x.id === auto.id)!.cancelledAt).toBeTruthy();
    await reactivateDividend(auto.id);
    expect(getState().data.dividends.find((x) => x.id === auto.id)!.cancelledAt).toBeUndefined();
    expect(getState().data.dividends).toHaveLength(2);
    await new Promise((r) => setTimeout(r, 600));
  });
});
