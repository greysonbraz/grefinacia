import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDB } from 'idb';
import { fetchDividends, resolveDividendProvider } from '../src/services/quotes';
import { buildRunnerConfig } from '../src/services/background';
import { DEFAULT_SETTINGS } from '../src/lib/defaults';
import type { Settings } from '../src/lib/types';
import { closeDB, saveSettings, setMeta } from '../src/db/db';
import { setSecretStoreForTests } from '../src/services/secrets';
import { AUTO_DIVIDEND_HOURS, autoRefreshDividends, getState, init, refreshDividends, upsert } from '../src/state/store';

const api = (p: Partial<Settings['api']> = {}): Settings['api'] => ({ ...DEFAULT_SETTINGS.api, ...p });
const YAHOO_DIV = { chart: { result: [{ events: { dividends: { '1': { amount: 0.1, date: 1793000000 } } } }] } };
const res = (status: number, body: unknown) => ({ status, ok: status === 200, json: async () => body });
afterEach(() => vi.unstubAllGlobals());

describe('fonte automática de proventos', () => {
  it('é a padrão; plano grátis da brapi (sem proventos) vai para o Yahoo; plano pago usa a brapi', () => {
    expect(DEFAULT_SETTINGS.api.dividendProvider).toBe('auto');
    expect(resolveDividendProvider(api())).toBe('yahoo');
    expect(resolveDividendProvider(api({ brapiToken: 't', brapiPlan: 'free' }))).toBe('yahoo');
    expect(resolveDividendProvider(api({ brapiToken: 't', brapiPlan: 'startup' }))).toBe('brapi');
    expect(resolveDividendProvider(api({ brapiToken: '', brapiPlan: 'pro' }))).toBe('yahoo');
    expect(resolveDividendProvider(api({ dividendProvider: 'manual' }))).toBe('manual');
  });
  it('no plano grátis busca de fato no Yahoo (antes não buscava nada)', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(u); return res(200, YAHOO_DIV); }));
    const r = await fetchDividends([{ id: 'f1', ticker: 'MXRF11', type: 'fii' }], api());
    expect(urls[0]).toContain('query1.finance.yahoo.com');
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ kind: 'rendimento', ratePerUnit: 0.1, sourceName: 'Yahoo Finance (não oficial)', official: false });
  });
  it('a verificação com o app fechado recebe a fonte já resolvida', () => {
    const s = { ...DEFAULT_SETTINGS, notifications: { ...DEFAULT_SETTINGS.notifications, enabled: true } };
    const d = { ...getState().data, assets: [{ id: 'f1', ticker: 'MXRF11', type: 'fii' as const }], operations: [{ id: 'o1', assetId: 'f1', side: 'buy' as const, quantity: 10, priceCents: 1000, feesCents: 0, date: '2026-01-02', broker: '', createdAt: 1 }] };
    expect(buildRunnerConfig(d, s)).toMatchObject({ provider: 'yahoo', enabled: true, token: '' });
  });
});

describe('atualização sozinha e fonte fora do ar', () => {
  beforeEach(async () => {
    await closeDB();
    await deleteDB('grefinacia');
    setSecretStoreForTests(null);
  });

  it('quem estava na brapi grátis passa para a automática (uma vez); escolha de plano pago é mantida', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, onboarded: true, api: { ...DEFAULT_SETTINGS.api, dividendProvider: 'brapi', brapiPlan: 'free' } });
    await init();
    expect(getState().settings.api.dividendProvider).toBe('auto');
    await closeDB();
    await deleteDB('grefinacia');
    await saveSettings({ ...DEFAULT_SETTINGS, onboarded: true, api: { ...DEFAULT_SETTINGS.api, dividendProvider: 'brapi', brapiPlan: 'pro', brapiToken: 't' } });
    await setMeta('divAutoV1', false);
    await init();
    expect(getState().settings.api.dividendProvider).toBe('brapi');
    await new Promise((r) => setTimeout(r, 600));
  });

  it('fonte fora do ar: guarda desde quando, não mexe nos proventos salvos; voltou: limpa', async () => {
    await init();
    await upsert('assets', { id: 'f1', ticker: 'MXRF11', type: 'fii' });
    await upsert('dividends', { id: 'old', assetId: 'f1', kind: 'rendimento', ratePerUnit: 0.1, dataCom: '2026-10-01', source: 'api', sourceName: 'Yahoo Finance (não oficial)', official: false, key: 'k' });
    vi.stubGlobal('fetch', vi.fn(async () => res(503, null)));
    const r = await refreshDividends();
    expect(r.errors).toHaveLength(1);
    expect(getState().divHealth.downSince).toBeTruthy();
    expect(getState().data.dividends.map((d) => d.id)).toEqual(['old']);
    expect(getState().data.dividends[0].missingSince).toBeUndefined(); // falha da fonte não vira "sumiu"
    vi.stubGlobal('fetch', vi.fn(async () => res(200, YAHOO_DIV)));
    await refreshDividends();
    expect(getState().divHealth.downSince).toBeUndefined();
    expect(getState().divHealth.lastOkAt).toBeTruthy();
    await new Promise((r2) => setTimeout(r2, 600));
  });

  it('busca sozinha no máximo a cada 20 h; sem ativos ou com busca manual, não busca', async () => {
    await init();
    const f = vi.fn(async () => res(200, YAHOO_DIV));
    vi.stubGlobal('fetch', f);
    expect(await autoRefreshDividends()).toBe(false); // sem ativos
    await upsert('assets', { id: 'f1', ticker: 'MXRF11', type: 'fii' });
    const t0 = Date.now();
    expect(await autoRefreshDividends(t0)).toBe(true);
    expect(await autoRefreshDividends(t0 + 3_600_000)).toBe(false);
    expect(await autoRefreshDividends(t0 + (AUTO_DIVIDEND_HOURS + 1) * 3_600_000)).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
    await new Promise((r) => setTimeout(r, 600));
  });
});
