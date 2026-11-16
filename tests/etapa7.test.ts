import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDB, openDB } from 'idb';
import { benchmarkCurve, cdiAccumulated, ipcaAccumulated, mergePoints, periodStart, portfolioPerformance, quoteFreshness, sample, valueAt } from '../src/domain/market';
import { computePositions, operationsAreValid, portfolioTotals, type InvestOp } from '../src/domain/portfolio';
import { accountBalance, monthSummary } from '../src/domain/ledger';
import { netWorthAt } from '../src/domain/networth';
import { DATA_KEYS, DEFAULT_SETTINGS, emptyData } from '../src/lib/defaults';
import type { Account, AppData, CryptoAsset, CryptoOperation, Settings } from '../src/lib/types';
import { closeDB, DB_VERSION, listSafetyCopies, loadAll } from '../src/db/db';
import { fetchB3History, fetchBcbSeries, fetchCryptoQuotes, parseBcb, parseBrapiHistory, parseCgHistory, parseCgPrices, parseCgSearch, parseYahooHistory } from '../src/services/market';
import { fetchQuotes } from '../src/services/quotes';
import { brapiQuota, countRequest, getUsage, initUsage } from '../src/services/usage';
import { SYNCED } from '../src/services/sync';
import { DATA_SCHEMA, validateImported } from '../src/services/validate';
import { ALLOWED_HOSTS } from '../src/lib/csp';
import { getSyncState, getState, init, refreshHistory, saveCryptoOperation, upsert } from '../src/state/store';
import { setSecretStoreForTests } from '../src/services/secrets';

const TODAY = '2026-11-16';
const op = (p: Partial<InvestOp>): InvestOp => ({ assetId: 'x', side: 'buy', quantity: 10, priceCents: 1000, feesCents: 0, date: '2026-01-02', createdAt: 1, ...p });
const btc: CryptoAsset = { id: 'c1', coinId: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' };
const cop = (p: Partial<CryptoOperation>): CryptoOperation => ({ id: 'co' + Math.random(), assetId: 'c1', side: 'buy', quantity: 0.1, priceCents: 30000000, feesCents: 0, date: '2026-10-01', broker: 'Exchange', createdAt: 1, ...p });
const api = (p: Partial<Settings['api']> = {}): Settings['api'] => ({ ...DEFAULT_SETTINGS.api, ...p });
const res = (status: number, body: unknown) => ({ status, ok: status === 200, json: async () => body });

// Trechos de respostas reais, recebidas das fontes em 16/11/2026
const BRAPI_HIST = { results: [{ symbol: 'PETR4', historicalDataPrice: [{ date: 1787022000, open: 42.8, close: 42.6 }, { date: 1787108400, close: 43.11 }, { date: 1787194800, close: null }] }] };
const YAHOO_HIST = { chart: { result: [{ timestamp: [1787022000, 1787108400, 1787194800], indicators: { quote: [{ close: [42.6, null, 43.5] }] } }] } };
const CG_PRICES = { bitcoin: { brl: 375473, brl_24h_change: 2.175108738466301, last_updated_at: 1794850221 }, ethereum: { brl: 10577.17, brl_24h_change: 2.81, last_updated_at: 1794850221 } };
const CG_HIST = { prices: [[1763337600000, 501976.4206153434], [1794841200000, 370061.58287349774], [1794850170000, 368273.92024757445]] };
const CG_SEARCH = { coins: [{ id: 'aave-polygon-dai', name: 'Aave Polygon DAI', symbol: 'amdai' }, { id: 'solana-name-service', name: 'Solana Name Service', symbol: 'SNS', market_cap_rank: 2340 }, { id: 'solana', name: 'Solana', api_symbol: 'solana', symbol: 'SOL', market_cap_rank: 7 }] };
const BCB_CDI = [{ data: '11/11/2026', valor: '0.050788' }, { data: '12/11/2026', valor: '0.050788' }];

afterEach(() => vi.unstubAllGlobals());

describe('histórico guardado no aparelho', () => {
  it('junta pontos novos aos antigos, sem repetir data, e o fechamento corrige a cotação do dia', () => {
    const old: [string, number][] = [['2026-11-10', 100], ['2026-11-12', 120]];
    const merged = mergePoints(old, [['2026-11-11', 110], ['2026-11-12', 125], ['data ruim', 1]]);
    expect(merged).toEqual([['2026-11-10', 100], ['2026-11-11', 110], ['2026-11-12', 125]]);
  });
  it('valor numa data usa o último ponto conhecido (fim de semana e feriado)', () => {
    const pts: [string, number][] = [['2026-11-13', 100], ['2026-11-16', 105]];
    expect(valueAt(pts, '2026-11-12')).toBeNull();
    expect(valueAt(pts, '2026-11-15')).toBe(100);
    expect(valueAt(pts, '2026-11-16')).toBe(105);
  });
  it('reduz séries longas para o gráfico mantendo o primeiro e o último ponto', () => {
    const s = sample(Array.from({ length: 500 }, (_, i) => i), 60);
    expect(s).toHaveLength(60);
    expect(s[0]).toBe(0);
    expect(s[59]).toBe(499);
  });
});

describe('selo de atraso da cotação', () => {
  const now = new Date('2026-11-16T15:00:00Z');
  it('até 1 hora é o atraso normal; até 4 dias, atenção; depois, desatualizada', () => {
    expect(quoteFreshness('2026-11-16T14:40:00Z', now)).toMatchObject({ tone: 'ok', age: 'há 20 min' });
    expect(quoteFreshness('2026-11-16T10:00:00Z', now)).toMatchObject({ tone: 'warn', age: 'há 5 h' });
    expect(quoteFreshness('2026-11-14T00:18:33Z', now)).toMatchObject({ tone: 'warn', age: 'há 2 dias' }); // fim de semana
    expect(quoteFreshness('2026-11-01T12:00:00Z', now).tone).toBe('old');
    expect(quoteFreshness('não é data', now).age).toBe('horário desconhecido');
  });
});

describe('desempenho da carteira (por cotas)', () => {
  const prices = { x: [['2026-01-02', 1000], ['2026-01-05', 1100], ['2026-01-06', 1210]] as [string, number][] };

  it('compra no meio do caminho não conta como ganho', () => {
    const ops = [op({ date: '2026-01-02' }), op({ date: '2026-01-05', priceCents: 1100 })];
    const p = portfolioPerformance(ops, prices, '2026-01-02', '2026-01-06');
    expect(p.pct).toBeCloseTo(21, 6); // 1000 → 1100 → 1210 = +21%, com qualquer quantidade
    expect(p.points[p.points.length - 1].valueCents).toBe(20 * 1210);
  });

  it('venda também não conta como perda nem ganho', () => {
    const ops = [op({ quantity: 20 }), op({ side: 'sell', date: '2026-01-05', quantity: 10, priceCents: 1100 })];
    expect(portfolioPerformance(ops, prices, '2026-01-02', '2026-01-06').pct).toBeCloseTo(21, 6);
  });

  it('sem fechamento, usa o preço da operação e avisa', () => {
    const p = portfolioPerformance([op({ assetId: 'y', date: '2026-01-02' })], {}, '2026-01-02', '2026-01-06');
    expect(p.pct).toBeCloseTo(0, 6);
    expect(p.estimated).toEqual(['y']);
  });

  it('sem carteira no período, não inventa número', () => {
    expect(portfolioPerformance([], {}, '2026-01-02', '2026-01-06').pct).toBeNull();
  });

  it('o período nunca começa antes da primeira compra', () => {
    expect(periodStart('1a', TODAY, '2026-09-01')).toBe('2026-09-01');
    expect(periodStart('3m', TODAY, '2020-01-01')).toBe('2026-08-16');
    expect(periodStart('tudo', TODAY, '2020-01-01')).toBe('2020-01-01');
  });
});

describe('CDI e IPCA', () => {
  it('CDI: compõe a taxa diária dos dias depois do início até o fim', () => {
    const cdi = parseBcb(BCB_CDI);
    expect(cdi).toEqual([['2026-11-11', 0.050788], ['2026-11-12', 0.050788]]);
    const r = cdiAccumulated(cdi, '2026-11-10', TODAY);
    expect(r.pct).toBeCloseTo((Math.pow(1.00050788, 2) - 1) * 100, 10);
    expect(r.until).toBe('2026-11-12');
    expect(cdiAccumulated(cdi, '2026-11-11', TODAY).pct).toBeCloseTo(0.050788, 10); // o dia de início não conta
  });

  it('IPCA: mês inteiro conta inteiro; mês pela metade conta proporcional; mês sem divulgação fica de fora', () => {
    const ipca: [string, number][] = [['2026-09-01', 0.82], ['2026-10-01', 0.14]];
    expect(ipcaAccumulated(ipca, '2026-08-31', '2026-09-30').pct).toBeCloseTo(0.82, 10);
    const half = ipcaAccumulated(ipca, '2026-09-15', '2026-09-30'); // 15 de 30 dias
    expect(half.pct).toBeCloseTo((Math.pow(1.0082, 0.5) - 1) * 100, 10);
    const all = ipcaAccumulated(ipca, '2026-08-31', TODAY);
    expect(all.pct).toBeCloseTo((1.0082 * 1.0014 - 1) * 100, 10);
    expect(all.until).toBe('2026-10');
  });

  it('a curva do índice some onde ainda não há dado publicado', () => {
    const ipca: [string, number][] = [['2026-10-01', 0.14]];
    expect(benchmarkCurve('ipca', ipca, '2026-09-30', ['2026-10-31', '2026-11-10'])).toEqual([expect.closeTo(0.14, 8), null]);
    expect(benchmarkCurve('cdi', [], '2026-09-30', ['2026-10-31'])).toEqual([null]);
  });
});

describe('leitura das respostas das fontes', () => {
  it('brapi e Yahoo: fechamentos diários, ignorando buracos', () => {
    expect(parseBrapiHistory(BRAPI_HIST).map(([, v]) => v)).toEqual([4260, 4311]);
    expect(parseYahooHistory(YAHOO_HIST).map(([, v]) => v)).toEqual([4260, 4350]);
    expect(parseBrapiHistory({ error: true })).toEqual([]);
    expect(parseYahooHistory(null)).toEqual([]);
  });
  it('CoinGecko: preço em reais, variação de 24 h, histórico com um ponto por dia e busca', () => {
    const q = parseCgPrices(CG_PRICES);
    expect(q[0]).toMatchObject({ coinId: 'bitcoin', priceCents: 37547300 });
    expect(q[1].priceCents).toBe(1057717);
    const h = parseCgHistory(CG_HIST);
    expect(h).toHaveLength(2); // os dois últimos pontos são do mesmo dia: fica o mais recente
    expect(h[1][1]).toBe(36827392);
    const hits = parseCgSearch(CG_SEARCH);
    expect(hits[0]).toEqual({ coinId: 'solana', symbol: 'SOL', name: 'Solana', rank: 7 }); // a maior primeiro
    expect(hits.map((h) => h.symbol)).toEqual(['SOL', 'SNS', 'AMDAI']);
  });
});

describe('cripto na carteira', () => {
  it('aceita frações sem sobrar poeira de ponto flutuante', () => {
    const ops = [cop({ quantity: 0.1 }), cop({ quantity: 0.2 }), cop({ side: 'sell', quantity: 0.3, date: '2026-10-02' })];
    expect(operationsAreValid(ops).ok).toBe(true);
    const [p] = computePositions([btc], ops);
    expect(p.quantity).toBe(0);
    expect(p.costCents).toBe(0);
    expect(p.realizedCents).toBe(0);
  });
  it('preço médio, lucro e valor com cotação', () => {
    const ops = [cop({ quantity: 0.01, priceCents: 30000000 }), cop({ quantity: 0.01, priceCents: 40000000, feesCents: 500 })];
    const [p] = computePositions([{ ...btc, quote: { priceCents: 37547300, time: TODAY, fetchedAt: TODAY, source: 'CoinGecko' } }], ops);
    expect(p.quantity).toBe(0.02);
    expect(p.costCents).toBe(700500);
    expect(p.valueCents).toBe(750946);
    expect(portfolioTotals([p], []).pnlCents).toBe(50446);
  });
  it('não deixa vender mais do que tem', () => {
    expect(operationsAreValid([cop({ quantity: 0.1 }), cop({ side: 'sell', quantity: 0.10000001, date: '2026-10-03' })]).ok).toBe(false);
  });
  it('entra no saldo da conta, nos aportes do mês e no patrimônio', () => {
    const acc: Account = { id: 'a1', name: 'Conta', kind: 'corrente', initialCents: 1000000, initialDate: '2026-01-01' };
    const d: AppData = { ...emptyData(), accounts: [acc], cryptoAssets: [{ ...btc, quote: { priceCents: 40000000, time: TODAY, fetchedAt: TODAY, source: 'CoinGecko' } }], cryptoOps: [cop({ quantity: 0.01, priceCents: 30000000, feesCents: 100, accountId: 'a1' })] };
    expect(accountBalance(acc, d)).toBe(1000000 - 300000 - 100);
    expect(monthSummary(d, '2026-10').investedCents).toBe(300100);
    const nw = netWorthAt(d, TODAY, TODAY);
    expect(nw.cryptoCents).toBe(400000);
    expect(nw.totalCents).toBe(699900 + 400000);
    expect(netWorthAt(d, '2026-10-31', TODAY).cryptoCents).toBe(300100); // no passado vale o custo
  });
});

describe('cota da brapi', () => {
  beforeEach(() => initUsage(undefined, () => undefined));

  it('conta as consultas e para no limite do plano gratuito (15.000 por mês)', async () => {
    const fetchMock = vi.fn(async () => res(200, { results: [{ symbol: 'PETR4', regularMarketPrice: 45.3 }] }));
    vi.stubGlobal('fetch', fetchMock);
    await fetchQuotes(['PETR4'], api());
    expect(getUsage().counts.brapi).toBe(1);
    countRequest('brapi', 14999 - 1);
    expect(brapiQuota('free').low).toBe(true);
    await fetchQuotes(['PETR4'], api());
    expect(brapiQuota('free').exhausted).toBe(true);
    const r = await fetchQuotes(['PETR4'], api());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r.errors[0].message).toMatch(/consultas do mês acabaram/);
    expect(brapiQuota('startup').exhausted).toBe(false);
  });
  it('mês novo começa do zero', () => {
    initUsage({ month: '2020-01', counts: { brapi: 15000, yahoo: 0, coingecko: 0, bcb: 0 } }, () => undefined);
    expect(getUsage().counts.brapi).toBe(0);
  });
  it('histórico sem token só para os ativos de teste, sem gastar consulta', async () => {
    const fetchMock = vi.fn(async () => res(200, BRAPI_HIST));
    vi.stubGlobal('fetch', fetchMock);
    const r = await fetchB3History('BBAS3', api());
    expect('message' in r && r.message).toMatch(/sem token/);
    expect(fetchMock).not.toHaveBeenCalled();
    const ok = await fetchB3History('PETR4', api());
    expect('points' in ok && ok.points).toHaveLength(2);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('range=3mo');
    expect(getUsage().counts.brapi).toBe(1);
  });
});

describe('fontes gratuitas sem chave', () => {
  it('Banco Central: divide períodos longos (limite de 10 anos) e aceita intervalo sem dado', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      urls.push(u);
      return u.includes('dataInicial=01/01/2020') ? res(404, { erro: {} }) : res(200, BCB_CDI);
    }));
    const r = await fetchBcbSeries('CDI', '2014-01-01', TODAY);
    expect('points' in r).toBe(true);
    expect(urls).toHaveLength(3); // quase 13 anos em pedaços de até 5
    expect(urls.every((u) => u.startsWith('https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial='))).toBe(true);
    const r2 = await fetchBcbSeries('IPCA', '2020-01-01', '2020-01-31');
    expect('points' in r2 && r2.points).toEqual([]);
  });
  it('CoinGecko: uma consulta para todas as moedas; limite por minuto vira mensagem clara', async () => {
    const fetchMock = vi.fn(async () => res(200, CG_PRICES));
    vi.stubGlobal('fetch', fetchMock);
    const r = await fetchCryptoQuotes(['bitcoin', 'ethereum', 'bitcoin']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.quotes).toHaveLength(2);
    vi.stubGlobal('fetch', vi.fn(async () => res(429, {})));
    expect((await fetchCryptoQuotes(['bitcoin'])).errors[0].message).toMatch(/Espere um minuto/);
  });
  it('os dois sites novos estão liberados de propósito na política de segurança', () => {
    expect(ALLOWED_HOSTS).toContain('https://api.coingecko.com');
    expect(ALLOWED_HOSTS).toContain('https://api.bcb.gov.br');
  });
});

describe('dados: banco, backup e sincronização', () => {
  it('cripto viaja entre aparelhos; o histórico de preços não (cada aparelho busca o seu)', () => {
    expect(SYNCED.has('cryptoAssets')).toBe(true);
    expect(SYNCED.has('cryptoOps')).toBe(true);
    expect(SYNCED.has('marketHistory')).toBe(false);
    expect(DATA_KEYS).toEqual(expect.arrayContaining(['cryptoAssets', 'cryptoOps', 'marketHistory']));
  });
  it('backup novo leva a cripto; backup antigo continua abrindo, com a cripto vazia', () => {
    expect(DATA_SCHEMA).toBe(3);
    const now = validateImported({ schema: 3, data: { cryptoAssets: [btc], cryptoOps: [cop({ id: 'o1' })] } });
    expect(now.data.cryptoAssets).toEqual([btc]);
    const old = validateImported({ schema: 2, data: { accounts: [] } });
    expect(old.data.cryptoOps).toEqual([]);
    expect(old.data.marketHistory).toEqual([]);
  });

  describe('com o banco do aparelho', () => {
    beforeEach(async () => {
      await closeDB();
      await deleteDB('grefinacia');
      setSecretStoreForTests(null);
    });

    it('atualizar da estrutura 3 para a 4 preserva tudo e cria as gavetas novas', async () => {
      const v3 = await openDB('grefinacia', 3, {
        upgrade(db) {
          for (const name of DATA_KEYS.filter((k) => !['cryptoAssets', 'cryptoOps', 'marketHistory'].includes(k))) db.createObjectStore(name, { keyPath: 'id' });
          db.createObjectStore('meta');
          db.createObjectStore('safety', { keyPath: 'id' });
        },
      });
      await v3.put('accounts', { id: 'a1', name: 'Conta antiga', kind: 'corrente', initialCents: 0, initialDate: '2026-01-01' });
      await v3.put('transfers', { id: 'tr1', fromAccountId: 'a1', toAccountId: 'a2', amountCents: 1, date: TODAY, createdAt: 1 });
      v3.close();
      expect(DB_VERSION).toBe(4);
      const l = await loadAll();
      expect(l.data.accounts[0].name).toBe('Conta antiga');
      expect(l.data.transfers).toHaveLength(1);
      expect(l.data.cryptoAssets).toEqual([]);
      expect((await listSafetyCopies())[0]).toMatchObject({ reason: 'atualizacao', records: 2 });
    });

    it('ao atualizar o app, relê a nuvem do início uma vez (cripto feita em outro aparelho não fica para trás)', async () => {
      const db = await openDB('grefinacia', 3, {
        upgrade(d) {
          for (const name of DATA_KEYS.filter((k) => !['cryptoAssets', 'cryptoOps', 'marketHistory'].includes(k))) d.createObjectStore(name, { keyPath: 'id' });
          d.createObjectStore('meta');
          d.createObjectStore('safety', { keyPath: 'id' });
        },
      });
      await db.put('meta', { cursor: '2026-11-15T10:00:00Z', dirty: { 'accounts\na1': 5 } }, 'sync');
      db.close();
      await init();
      expect(getSyncState()).toEqual({ cursor: null, dirty: { 'accounts\na1': 5 } });
      // na próxima abertura não zera de novo
      const { saveSyncState } = await import('../src/state/store');
      await saveSyncState({ cursor: '2026-11-16T10:00:00Z', dirty: {} }, getSyncState());
      await closeDB();
      await init();
      expect(getSyncState().cursor).toBe('2026-11-16T10:00:00Z');
      await new Promise((r2) => setTimeout(r2, 600));
    });

    it('histórico buscado fica no aparelho sem marcar sincronização; cripto marca', async () => {
      await init();
      await upsert('cryptoAssets', btc);
      expect(await saveCryptoOperation(cop({ id: 'o1' }))).toBeNull();
      vi.stubGlobal('fetch', vi.fn(async (u: string) => (u.includes('coingecko') ? res(200, CG_HIST) : res(200, [{ data: '01/11/2025', valor: '0.4' }, ...BCB_CDI]))));
      const r = await refreshHistory('cripto');
      expect(r.errors).toEqual([]);
      const ids = getState().data.marketHistory.map((h) => h.id).sort();
      expect(ids).toEqual(['cripto:bitcoin', 'indice:CDI', 'indice:IPCA']);
      const dirty = Object.keys(getSyncState().dirty);
      expect(dirty.some((k) => k.startsWith('cryptoOps'))).toBe(true);
      expect(dirty.some((k) => k.startsWith('marketHistory'))).toBe(false);
      // no mesmo dia não busca de novo
      const again = vi.fn(async () => res(200, CG_HIST));
      vi.stubGlobal('fetch', again);
      await refreshHistory('cripto');
      expect(again).not.toHaveBeenCalled();
      await new Promise((r2) => setTimeout(r2, 600));
    });
  });
});
