import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { emptyData, DEFAULT_SETTINGS } from '../src/lib/defaults';
import type { AppData, Settings } from '../src/lib/types';
import { PAID_AI_ENABLED } from '../src/lib/flags';
import { brapiDividendsAvailable, fetchDividends } from '../src/services/quotes';
import { buildRunnerConfig, RUNNER_CONFIG_VERSION } from '../src/services/background';
import { clearSecrets, extractSecrets, hydrateSecrets, setSecretStoreForTests, settingsForDb, type SecretStore } from '../src/services/secrets';
// @ts-expect-error script em JavaScript puro, sem tipos
import { findSecrets } from '../scripts/check-secrets.mjs';

const api = (p: Partial<Settings['api']>): Settings['api'] => ({ ...DEFAULT_SETTINGS.api, ...p });
const settingsWith = (p: Partial<Settings['api']>): Settings => ({ ...DEFAULT_SETTINGS, api: api(p) });

/** Carteira com 100 ITSA4 e 50 MXRF11. */
function portfolio(): AppData {
  const d = emptyData();
  d.assets.push({ id: 's1', ticker: 'ITSA4', type: 'acao' }, { id: 'f1', ticker: 'MXRF11', type: 'fii' });
  d.operations.push(
    { id: 'o1', assetId: 's1', side: 'buy', quantity: 100, priceCents: 1000, feesCents: 0, date: '2026-01-10', broker: 'XP', createdAt: 1 },
    { id: 'o2', assetId: 'f1', side: 'buy', quantity: 50, priceCents: 1000, feesCents: 0, date: '2026-01-10', broker: 'XP', createdAt: 1 },
  );
  return d;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setSecretStoreForTests(undefined);
});

describe('custo zero', () => {
  it('a IA paga fica desligada nesta fase', () => {
    expect(PAID_AI_ENABLED).toBe(false);
  });
});

describe('cota gratuita da brapi', () => {
  it('proventos só são consultados em plano pago (ou nos fundos de demonstração)', () => {
    expect(brapiDividendsAvailable('ITSA4', api({ brapiToken: 't', brapiPlan: 'free' }))).toBe(false);
    expect(brapiDividendsAvailable('ITSA4', api({ brapiToken: '', brapiPlan: 'pro' }))).toBe(false);
    expect(brapiDividendsAvailable('ITSA4', api({ brapiToken: 't', brapiPlan: 'startup' }))).toBe(true);
    expect(brapiDividendsAvailable('mxrf11', api({ brapiToken: '', brapiPlan: 'free' }))).toBe(true);
  });

  it('no plano gratuito a busca de proventos não faz nenhuma chamada e explica o motivo', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await fetchDividends([{ id: 's1', ticker: 'ITSA4', type: 'acao' }], api({ brapiToken: 'meu-token', brapiPlan: 'free' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.events).toHaveLength(0);
    expect(r.errors[0].message).toContain('Startup ou Pro');
  });

  it('verificação em segundo plano: desligada no plano gratuito, sem entregar o token', () => {
    const d = portfolio();
    d.assets = d.assets.filter((a) => a.ticker !== 'MXRF11');
    d.operations = d.operations.filter((o) => o.assetId !== 'f1');
    const cfg = buildRunnerConfig(d, settingsWith({ dividendProvider: 'brapi', brapiToken: 'meu-token', brapiPlan: 'free' }));
    expect(cfg).toMatchObject({ v: RUNNER_CONFIG_VERSION, enabled: false, token: '', assets: [] });
  });

  it('verificação em segundo plano: no gratuito só os fundos de demonstração; no pago, tudo, com token', () => {
    const free = buildRunnerConfig(portfolio(), settingsWith({ dividendProvider: 'brapi', brapiToken: 'meu-token', brapiPlan: 'free' }));
    expect(free.enabled).toBe(true);
    expect(free.assets.map((a) => a.ticker)).toEqual(['MXRF11']);
    expect(free.token).toBe('');
    const paid = buildRunnerConfig(portfolio(), settingsWith({ dividendProvider: 'brapi', brapiToken: ' meu-token ', brapiPlan: 'pro' }));
    expect(paid.assets.map((a) => a.ticker).sort()).toEqual(['ITSA4', 'MXRF11']);
    expect(paid.token).toBe('meu-token');
    const yahoo = buildRunnerConfig(portfolio(), settingsWith({ dividendProvider: 'yahoo', brapiToken: 'meu-token', brapiPlan: 'pro' }));
    expect(yahoo).toMatchObject({ enabled: true, token: '' });
    expect(yahoo.assets).toHaveLength(2);
    const manual = buildRunnerConfig(portfolio(), settingsWith({ dividendProvider: 'manual' }));
    expect(manual).toMatchObject({ enabled: false, assets: [] });
  });

  it('respeita o botão de notificações', () => {
    const s = settingsWith({ dividendProvider: 'yahoo' });
    const off = { ...s, notifications: { ...s.notifications, types: { ...s.notifications.types, dividendAnnounced: false } } };
    expect(buildRunnerConfig(portfolio(), off).enabled).toBe(false);
  });
});

describe('runner: limites de consulta', () => {
  const code = readFileSync(process.cwd() + '/public/runners/runner.js', 'utf8');
  const body = { dividends: [{ symbol: 'MXRF11', label: 'RENDIMENTO', rate: 0.1, lastDatePrior: '2026-11-01', paymentDate: '2099-01-15' }] };

  /** Sobe o runner com um armazenamento que persiste entre as chamadas, como no aparelho. */
  function boot(fetchImpl: (url: string) => Promise<unknown>) {
    const handlers: Record<string, (resolve: () => void, reject: (e: unknown) => void, args: any) => void> = {};
    const kv: Record<string, string> = {};
    const g = {
      addEventListener: (n: string, fn: any) => (handlers[n] = fn),
      CapacitorKV: { get: async (k: string) => ({ value: kv[k] ?? '' }), set: async (k: string, v: string) => void (kv[k] = v) },
      CapacitorNotifications: { schedule: () => undefined },
      fetch: fetchImpl,
    };
    new Function(...Object.keys(g), code)(...Object.values(g));
    const run = (event: string, args: object = {}) => new Promise<void>((resolve, reject) => handlers[event](resolve, reject, args));
    return { run, kv };
  }
  const cfg = (extra: object) => JSON.stringify({ enabled: true, provider: 'brapi', token: '', assets: [{ ticker: 'MXRF11', type: 'fii', qty: 10 }], knownKeys: ['x'], ...extra });

  it('ignora configuração gravada por versão antiga do app (não consulta nada)', async () => {
    const calls: string[] = [];
    const r = boot(async (url) => (calls.push(url), { status: 200, json: async () => body }));
    await r.run('saveConfig', { config: cfg({}) }); // sem "v"
    await r.run('checkDividends');
    expect(calls).toHaveLength(0);
  });

  it('não consulta de novo antes de 3 horas, mesmo que o Android chame antes', async () => {
    const calls: string[] = [];
    const r = boot(async (url) => (calls.push(url), { status: 200, json: async () => body }));
    await r.run('saveConfig', { config: cfg({ v: 2 }) });
    await r.run('checkDividends');
    expect(calls).toHaveLength(1);
    await r.run('checkDividends');
    await r.run('checkDividends');
    expect(calls).toHaveLength(1);
    // passadas mais de 3 horas, volta a consultar
    r.kv.lastCheck = String(Date.now() - 4 * 60 * 60 * 1000);
    await r.run('checkDividends');
    expect(calls).toHaveLength(2);
  });
});

describe('cofre de segredos', () => {
  function fakeStore(opts: { failOnSet?: boolean } = {}): SecretStore & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      get: async (k) => data.get(k) ?? null,
      set: async (k, v) => {
        if (opts.failOnSet) throw new Error('cofre indisponível');
        data.set(k, v);
      },
      remove: async (k) => void data.delete(k),
    };
  }
  const withSecretsSet: Settings = { ...DEFAULT_SETTINGS, api: api({ brapiToken: 'TOKEN-BRAPI' }), ai: { ...DEFAULT_SETTINGS.ai, apiKey: 'CHAVE-IA' } };

  it('com cofre: os segredos saem do que vai para o banco e voltam na leitura', async () => {
    const store = fakeStore();
    setSecretStoreForTests(store);
    const forDb = await settingsForDb(withSecretsSet);
    expect(JSON.stringify(forDb)).not.toContain('TOKEN-BRAPI');
    expect(JSON.stringify(forDb)).not.toContain('CHAVE-IA');
    expect([...store.data.values()].sort()).toEqual(['CHAVE-IA', 'TOKEN-BRAPI']);
    const back = await hydrateSecrets(forDb);
    expect(extractSecrets(back.settings)).toEqual({ brapiToken: 'TOKEN-BRAPI', aiApiKey: 'CHAVE-IA' });
    expect(back.migrated).toBe(false);
  });

  it('instalação antiga: segredo que estava no banco é sinalizado para migrar', async () => {
    setSecretStoreForTests(fakeStore());
    const r = await hydrateSecrets(withSecretsSet);
    expect(r.migrated).toBe(true);
    expect(extractSecrets(r.settings).brapiToken).toBe('TOKEN-BRAPI');
  });

  it('se o cofre falhar ao gravar, o segredo continua no banco (não se perde)', async () => {
    setSecretStoreForTests(fakeStore({ failOnSet: true }));
    const forDb = await settingsForDb(withSecretsSet);
    expect(extractSecrets(forDb)).toEqual({ brapiToken: 'TOKEN-BRAPI', aiApiKey: 'CHAVE-IA' });
  });

  it('sem cofre (navegador): nada muda', async () => {
    setSecretStoreForTests(null);
    expect(await settingsForDb(withSecretsSet)).toBe(withSecretsSet);
    expect((await hydrateSecrets(withSecretsSet)).settings).toBe(withSecretsSet);
  });

  it('apagar o token remove do cofre; "apagar tudo" limpa o cofre', async () => {
    const store = fakeStore();
    setSecretStoreForTests(store);
    await settingsForDb(withSecretsSet);
    await settingsForDb({ ...withSecretsSet, api: api({ brapiToken: '' }) });
    expect([...store.data.values()]).toEqual(['CHAVE-IA']);
    await clearSecrets();
    expect(store.data.size).toBe(0);
  });
});

describe('varredura de segredos do repositório', () => {
  it('acusa chaves conhecidas e arquivos proibidos', () => {
    const fake = (prefix: string, n: number) => prefix + 'A1b2C3d4E5'.repeat(Math.ceil(n / 10)).slice(0, n);
    const found = findSecrets([
      { path: 'src/a.ts', content: `const k = '${fake('sk-ant-', 40)}';` },
      { path: 'src/b.ts', content: `const k = "${fake('AIza', 35)}";` },
      { path: 'src/c.ts', content: `x\n${fake('ghp_', 36)}` },
      { path: 'src/d.ts', content: `${fake('sb_secret_', 30)}` },
      { path: 'cert.txt', content: '-----BEGIN PRIVATE KEY-----' },
      { path: 'android/release.jks' },
      { path: 'android/keystore.properties', content: 'storePassword=x' },
      { path: '.env', content: 'A=1' },
      { path: 'meu-backup.gfbackup' },
    ]) as { path: string; line?: number; problem: string }[];
    expect(found.map((f) => f.path).sort()).toEqual(['.env', 'android/keystore.properties', 'android/release.jks', 'cert.txt', 'meu-backup.gfbackup', 'src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts']);
    expect(found.find((f) => f.path === 'src/c.ts')!.line).toBe(2);
  });

  it('não acusa código normal, o exemplo de .env nem o backup sintético dos testes', () => {
    expect(
      findSecrets([
        { path: 'src/ok.ts', content: "headers: { 'x-api-key': ai.apiKey.trim() }, token: api.brapiToken" },
        { path: '.env.example', content: 'TOKEN=' },
        { path: 'tests/fixtures/backup-v1.gfbackup' },
        { path: 'scripts/check-secrets.mjs', content: readFileSync(process.cwd() + '/scripts/check-secrets.mjs', 'utf8') },
      ]),
    ).toEqual([]);
  });
});
