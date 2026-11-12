import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { makeEventKey } from '../src/domain/dividends';
import { parseBrapiDividends, parseYahooDividends, dataComFromEx } from '../src/services/quotes';

const code = readFileSync(process.cwd() + '/public/runners/runner.js', 'utf8');

function runRunner(cfg: object, fetchImpl: (url: string, init?: any) => Promise<any>) {
  const handlers: Record<string, (resolve: () => void, reject: (e: unknown) => void, args: any) => void> = {};
  const kv: Record<string, string> = {};
  const scheduled: any[] = [];
  const g = {
    addEventListener: (n: string, fn: any) => (handlers[n] = fn),
    CapacitorKV: { get: async (k: string) => (k in kv ? { value: kv[k] } : { value: '' }), set: async (k: string, v: string) => void (kv[k] = v) },
    CapacitorNotifications: { schedule: (n: any[]) => scheduled.push(...n) },
    fetch: fetchImpl,
  };
  new Function(...Object.keys(g), code)(...Object.values(g));
  return new Promise<{ scheduled: any[]; kv: Record<string, string> }>((resolveAll, rejectAll) => {
    handlers.saveConfig(() => {
      handlers.checkDividends(() => resolveAll({ scheduled, kv }), rejectAll, {});
    }, rejectAll, { config: JSON.stringify(cfg) });
  });
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const future = new Date(Date.now() + 10 * 86400000);

describe('análise das respostas das APIs', () => {
  const fii = { id: 'f', ticker: 'MXRF11', type: 'fii' as const };
  const acao = { id: 's', ticker: 'ITSA4', type: 'acao' as const };
  it('brapi FII (exemplo da documentação)', () => {
    const ev = parseBrapiDividends({ dividends: [{ symbol: 'MXRF11', approvedOn: null, label: 'RENDIMENTO', lastDatePrior: '2025-12-01 00:00:00+00', exDate: '2025-12-01 00:00:00+00', paymentDate: '2025-12-12 00:00:00+00', rate: 0.08941643, relatedTo: null }] }, fii);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: 'rendimento', dataCom: '2025-12-01', paymentDate: '2025-12-12', ratePerUnit: 0.08941643, official: true });
    expect(ev[0].key).toBe(makeEventKey('MXRF11', 'rendimento', '2025-12-01', 0.08941643));
  });
  it('brapi ações: JCP e dividendo, data só como prazo não é oficial', () => {
    const ev = parseBrapiDividends({ results: [{ symbol: 'ITSA4', data: { cashDividends: [{ label: 'JCP', rate: 0.05, lastDatePrior: '2026-06-01T00:00:00.000Z', paymentDate: '2026-07-10T00:00:00.000Z', paymentDateIsDeadline: false }, { label: 'DIVIDENDO', rate: 0.1, lastDatePrior: '2026-06-01', paymentDate: '2026-08-01', paymentDateIsDeadline: true }, { label: 'JCP', rate: 0, paymentDate: null }] } }] }, acao);
    expect(ev.map((e) => [e.kind, e.official])).toEqual([['jcp', true], ['dividendo', false]]);
  });
  it('Yahoo: data-com é o dia útil anterior à data ex e não há data de pagamento', () => {
    expect(dataComFromEx('2026-11-09')).toBe('2026-11-06'); // segunda → sexta
    const ts = Math.floor(new Date('2026-03-02T12:00:00Z').getTime() / 1000);
    const ev = parseYahooDividends({ chart: { result: [{ events: { dividends: { [ts]: { amount: 0.1, date: ts } } } }] } }, fii);
    expect(ev[0]).toMatchObject({ kind: 'rendimento', official: false, exDate: '2026-03-02', dataCom: '2026-02-27' });
    expect(ev[0].paymentDate).toBeUndefined();
  });
});

describe('runner em segundo plano', () => {
  it('notifica só proventos novos e recentes e não repete', async () => {
    const known = makeEventKey('ITSA4', 'dividendo', '2026-01-01', 0.1);
    const newKey = { label: 'DIVIDENDO', rate: 0.25, lastDatePrior: '2026-11-01', paymentDate: iso(future) };
    const old = { label: 'DIVIDENDO', rate: 0.1, lastDatePrior: '2026-01-01', paymentDate: '2026-02-01' };
    const body = { results: [{ symbol: 'ITSA4', data: { cashDividends: [old, newKey] } }] };
    const cfg = { v: 2, enabled: true, provider: 'brapi', token: 't', assets: [{ ticker: 'ITSA4', type: 'acao', qty: 100 }], knownKeys: [known] };
    const calls: string[] = [];
    const r = await runRunner(cfg, async (url) => (calls.push(url), { status: 200, json: async () => body }));
    expect(calls[0]).toContain('/api/v2/stocks/dividends?symbols=ITSA4');
    expect(r.scheduled).toHaveLength(1);
    expect(r.scheduled[0].title).toBe('ITSA4 anunciou dividendo');
    expect(r.scheduled[0].body).toContain('R$ 25,00');
    // segunda execução com o estado salvo: nada novo
    const saved = JSON.parse(r.kv.config);
    expect(saved.knownKeys).toContain(makeEventKey('ITSA4', 'dividendo', '2026-11-01', 0.25));
    const r2 = await runRunner(saved, async () => ({ status: 200, json: async () => body }));
    expect(r2.scheduled).toHaveLength(0);
  });
  it('na primeira execução (sem chaves conhecidas) apenas registra, sem notificar', async () => {
    const body = { dividends: [{ symbol: 'MXRF11', label: 'RENDIMENTO', rate: 0.1, lastDatePrior: '2026-11-01', paymentDate: iso(future) }] };
    const r = await runRunner({ v: 2, enabled: true, provider: 'brapi', token: '', assets: [{ ticker: 'MXRF11', type: 'fii', qty: 10 }], knownKeys: [] }, async () => ({ status: 200, json: async () => body }));
    expect(r.scheduled).toHaveLength(0);
    expect(JSON.parse(r.kv.config).knownKeys).toHaveLength(1);
  });
  it('desligado ou com falha de rede não gera notificação nem erro', async () => {
    const off = await runRunner({ enabled: false, assets: [], knownKeys: ['x'] }, async () => { throw new Error('x'); });
    expect(off.scheduled).toHaveLength(0);
    const fail = await runRunner({ v: 2, enabled: true, provider: 'brapi', token: 't', assets: [{ ticker: 'ITSA4', type: 'acao', qty: 1 }], knownKeys: ['x'] }, async () => { throw new Error('rede'); });
    expect(fail.scheduled).toHaveLength(0);
  });
});
