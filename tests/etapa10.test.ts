import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearFailures, createCredential, lockoutRemainingMs, registerFailure, verifyCredential } from '../src/services/security';
import { changesSince, CloudError, currentSession, deleteAllCloudData, deleteRows, getVaultMeta, listRows, signInWithGoogleIdToken, signOutCloud, upsertRows, type CloudSession } from '../src/services/cloud';
import { secureGet, secureSet, setSecretStoreForTests } from '../src/services/secrets';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../src/lib/cloudConfig';
import { answerLocally, SUGGESTED_QUESTIONS } from '../src/domain/chat';
import { computeOverview } from '../src/domain/overview';
import { DEFAULT_SETTINGS, emptyData } from '../src/lib/defaults';
import { DEFAULT_CATEGORIES } from '../src/lib/categories';
import { SYNCED } from '../src/services/sync';
import type { AppData, Settings } from '../src/lib/types';

afterEach(() => vi.unstubAllGlobals());

// ============================ PIN ============================

describe('PIN: hash e verificação', () => {
  it('guarda só o hash com sal; o PIN certo abre, o errado não', async () => {
    const c = await createCredential('2468');
    expect(c.hash).not.toContain('2468');
    expect(c.iterations).toBeGreaterThanOrEqual(210_000);
    const sec: Settings['security'] = { ...DEFAULT_SETTINGS.security, enabled: true, ...c };
    expect(await verifyCredential(sec, '2468')).toBe(true);
    expect(await verifyCredential(sec, '2469')).toBe(false);
    expect(await verifyCredential(sec, '')).toBe(false);
  });
  it('o mesmo PIN gera hashes diferentes (sal aleatório)', async () => {
    const [a, b] = await Promise.all([createCredential('1234'), createCredential('1234')]);
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });
  it('sem PIN cadastrado nada abre', async () => {
    expect(await verifyCredential(DEFAULT_SETTINGS.security, '1234')).toBe(false);
  });
});

describe('PIN: limite de tentativas', () => {
  beforeEach(() => clearFailures());
  it('4 erros liberam; do 5º em diante espera 30 s, dobrando até 15 min', () => {
    const t = 1_000_000;
    for (let i = 0; i < 4; i++) expect(registerFailure(t)).toBe(0);
    expect(registerFailure(t)).toBe(30_000);
    expect(lockoutRemainingMs(t + 10_000)).toBe(20_000);
    expect(registerFailure(t)).toBe(60_000);
    for (let i = 0; i < 10; i++) registerFailure(t);
    expect(registerFailure(t)).toBe(900_000);
    clearFailures();
    expect(lockoutRemainingMs(t)).toBe(0);
  });
  it('registro corrompido não zera a espera', () => {
    localStorage.setItem('mf_fail', JSON.stringify({ count: 'x', until: 0 }));
    expect(registerFailure(0)).toBeGreaterThanOrEqual(30_000);
    localStorage.setItem('mf_fail', 'lixo');
    expect(registerFailure(0)).toBe(0); // texto inválido volta ao começo, como antes de existir registro
  });
});

// ============================ NUVEM ============================

const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const session: CloudSession = { accessToken: 'tok', refreshToken: 'ref', expiresAt: Date.now() + 3_600_000, userId: 'u-1', email: 'x@y' };

describe('nuvem: cliente do Supabase', () => {
  beforeEach(() => setSecretStoreForTests(null));

  it('toda chamada leva só a chave pública e o token da sessão; vai para o endereço do projeto', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return res(200, [{ meta: { v: 1 } }]); }));
    expect(await getVaultMeta(session)).toEqual({ v: 1 });
    const h = calls[0].init.headers as Record<string, string>;
    expect(calls[0].url.startsWith(SUPABASE_URL + '/rest/v1/')).toBe(true);
    expect(h.apikey).toBe(SUPABASE_PUBLISHABLE_KEY);
    expect(h.Authorization).toBe('Bearer tok');
    expect(JSON.stringify(calls)).not.toMatch(/sb_secret|service_role/);
  });

  it('erros viram mensagens claras; sem internet não perde nada', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(401, { message: 'JWT expired' })));
    await expect(getVaultMeta(session)).rejects.toThrow(/Entre de novo com o Google/);
    vi.stubGlobal('fetch', vi.fn(async () => res(503, {})));
    await expect(getVaultMeta(session)).rejects.toThrow(/pausado por falta de uso/);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(getVaultMeta(session)).rejects.toThrow(/continuam salvos no aparelho/);
  });

  it('login guarda a sessão no cofre; sessão perto de vencer é renovada; vencida de vez sai', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { access_token: 'a1', refresh_token: 'r1', expires_in: 30, user: { id: 'u-1', email: 'x@y' } })));
    const s = await signInWithGoogleIdToken('id-token');
    expect(JSON.parse((await secureGet('cloud_session'))!).accessToken).toBe('a1');
    // vence em 30 s (< 60 s): renova
    const refresh = vi.fn(async (url: string) => (url.includes('refresh_token') ? res(200, { access_token: 'a2', refresh_token: 'r2', expires_in: 3600, user: { id: 'u-1' } }) : res(500, {})));
    vi.stubGlobal('fetch', refresh);
    expect((await currentSession())!.accessToken).toBe('a2');
    // renovação recusada: sai da conta
    await secureSet('cloud_session', JSON.stringify({ ...s, expiresAt: 0 }));
    vi.stubGlobal('fetch', vi.fn(async () => res(400, { error_description: 'invalid refresh' })));
    expect(await currentSession()).toBeNull();
    expect(await secureGet('cloud_session')).toBeNull();
  });

  it('sem internet na renovação, mantém a sessão para tentar depois', async () => {
    await secureSet('cloud_session', JSON.stringify({ ...session, expiresAt: 0 }));
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    await expect(currentSession()).rejects.toBeInstanceOf(CloudError);
    expect(await secureGet('cloud_session')).not.toBeNull();
  });

  it('sair apaga a sessão do aparelho mesmo sem internet', async () => {
    await secureSet('cloud_session', JSON.stringify(session));
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    await signOutCloud();
    expect(await secureGet('cloud_session')).toBeNull();
  });

  it('lista em páginas de 1000 e envia em lotes de 200', async () => {
    const urls: string[] = [];
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      urls.push(url);
      if (init.method === 'POST') { n += JSON.parse(String(init.body)).length; return res(201, null); }
      return res(200, Array.from({ length: urls.length === 1 ? 1000 : 3 }, (_, i) => ({ collection: 'accounts', id: String(i), iv: 'x', payload: 'y' })));
    }));
    expect(await listRows(session)).toHaveLength(1003);
    expect(urls[1]).toContain('offset=1000');
    await upsertRows(session, Array.from({ length: 450 }, (_, i) => ({ collection: 'accounts', id: String(i), iv: 'x', payload: 'y' })));
    expect(n).toBe(450);
    expect(urls.filter((u) => u.includes('on_conflict')).length).toBe(3);
  });

  it('exclusão e cursor vão codificados na URL (aspas, vírgulas e parênteses no id não quebram o filtro)', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { urls.push(url); return res(200, []); }));
    await deleteRows(session, [{ collection: 'transactions', id: 'a"b,c)' }]);
    expect(urls[0]).toContain('collection=eq.transactions');
    expect(urls[0]).not.toContain('a"b,c)');
    expect(decodeURIComponent(urls[0])).toContain('"a\\"b,c)"');
    await changesSince(session, '2026-11-16T10:00:00+00:00');
    expect(urls[1]).toContain('updated_at=gt.2026-11-16T10%3A00%3A00%2B00%3A00');
    await deleteAllCloudData({ ...session, userId: 'u&x=1' });
    expect(urls[2]).toContain('user_id=eq.u%26x%3D1');
  });
});

describe('nuvem: nomes de coleção aceitos pelo banco', () => {
  it('todas as coleções sincronizadas passam na regra do SQL (só letras, até 40)', () => {
    for (const c of SYNCED) expect(c).toMatch(/^[a-zA-Z]{1,40}$/);
  });
});

// ============================ CHAT ============================

describe('chat local: todas as perguntas sugeridas têm resposta própria', () => {
  const TODAY = '2026-11-16';
  const data: AppData = {
    ...emptyData(),
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    accounts: [{ id: 'a1', name: 'Conta', kind: 'corrente', initialCents: 300000, initialDate: '2026-01-01' }],
    goals: [{ id: 'g1', name: 'Reserva de emergência', icon: 'Shield', targetCents: 1000000, createdAt: 1 }],
    debts: [{ id: 'd1', kind: 'emprestimo', name: 'Empréstimo', institution: 'Banco', originalCents: 500000, balanceCents: 400000, installmentCents: 30000, remainingInstallments: 15, monthlyRatePct: 3, dueDay: 10, createdAt: 1 }],
    transactions: [{ id: 't1', type: 'expense', kind: 'variavel', description: 'Mercado', amountCents: 20000, categoryId: 'mercado', date: '2026-11-05', paymentMethod: 'pix', accountId: 'a1', status: 'paid', createdAt: 1 }],
  };
  const settings: Settings = { ...DEFAULT_SETTINGS, salary: { ...DEFAULT_SETTINGS.salary, amountCents: 400000, payDay: 5 } };
  const o = computeOverview(data, settings, TODAY);
  for (const q of SUGGESTED_QUESTIONS) {
    it(q, () => {
      const a = answerLocally(q, o, data, settings);
      expect(a.fallback).toBeUndefined();
      expect(a.text.length).toBeGreaterThan(20);
    });
  }
  it('perguntas novas: comparar empréstimo, cobrança em dobro, carteira, compra', () => {
    expect(answerLocally('Como comparar propostas de empréstimo?', o, data, settings).text).toMatch(/Comparar empréstimos/);
    expect(answerLocally('Fui cobrado em dobro?', o, data, settings).text).toMatch(/cobranças repetidas/);
    expect(answerLocally('Como está a diversificação?', o, data, settings).text).toMatch(/investimentos cadastrados/);
    expect(answerLocally('Posso comprar uma moto de R$ 15.000?', o, data, settings).calc?.[0]).toMatch(/^Valor da compra: R\$\s15\.000,00$/);
    expect(answerLocally('Qual meu patrimônio?', o, data, settings).text).toMatch(/patrimônio é/);
  });
});
