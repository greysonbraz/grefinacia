import { beforeAll, describe, expect, it } from 'vitest';
import { dirtyKey, emptySyncState, syncOnce, type RemoteRow, type SyncLocal, type SyncRemote, type SyncState } from '../src/services/sync';
import { createVault } from '../src/services/vault';

/** Nuvem de mentira: guarda as linhas e carimba cada gravação com um horário crescente, como o servidor. */
function fakeCloud() {
  const rows = new Map<string, RemoteRow>();
  let clock = Date.parse('2026-11-15T12:00:00.000Z');
  const remote: SyncRemote = {
    changesSince: async (c) => [...rows.values()].filter((r) => !c || r.updated_at > c).sort((a, b) => a.updated_at.localeCompare(b.updated_at)),
    upsert: async (list) => void list.forEach((r) => rows.set(dirtyKey(r.collection, r.id), { ...r, updated_at: new Date((clock += 1000)).toISOString() })),
  };
  return { rows, remote, now: () => clock, advance: (ms: number) => (clock += ms) };
}

/** Um aparelho: seus dados, suas pendências e seu cursor. */
function device(cloud: ReturnType<typeof fakeCloud>, key: CryptoKey, userId = 'u1') {
  const data = new Map<string, unknown>();
  let state: SyncState = emptySyncState();
  const local: SyncLocal = {
    get: (c, id) => data.get(dirtyKey(c, id)),
    apply: async (ups, dels) => {
      ups.forEach((u) => data.set(dirtyKey(u.collection, u.id), u.value));
      dels.forEach((d) => data.delete(dirtyKey(d.collection, d.id)));
    },
  };
  return {
    data,
    put(collection: string, value: { id: string }, at = cloud.now()) { data.set(dirtyKey(collection, value.id), value); state = { ...state, dirty: { ...state.dirty, [dirtyKey(collection, value.id)]: at } }; },
    del(collection: string, id: string, at = cloud.now()) { data.delete(dirtyKey(collection, id)); state = { ...state, dirty: { ...state.dirty, [dirtyKey(collection, id)]: at } }; },
    async sync() { const r = await syncOnce(cloud.remote, local, key, userId, state); state = r.state; return r; },
    get pending() { return Object.keys(state.dirty).length; },
    get: (collection: string, id: string) => data.get(dirtyKey(collection, id)) as { id: string; v?: string } | undefined,
  };
}

let key: CryptoKey;
beforeAll(async () => { key = (await createVault('frase de teste longa', 100_000)).key; }, 30000);

describe('sincronização entre dois aparelhos', () => {
  it('o que é lançado em um aparece no outro, e a nuvem só vê texto cifrado', async () => {
    const cloud = fakeCloud();
    const a = device(cloud, key), b = device(cloud, key);
    a.put('transactions', { id: 't1', v: 'Mercado secreto' } as never);
    expect((await a.sync()).pushed).toBe(1);
    expect(a.pending).toBe(0);
    expect(JSON.stringify([...cloud.rows.values()])).not.toContain('Mercado secreto');
    expect((await b.sync()).pulled).toBe(1);
    expect(b.get('transactions', 't1')!.v).toBe('Mercado secreto');
    // nada novo: nada trafega
    const again = await b.sync();
    expect([again.pulled, again.pushed]).toEqual([0, 0]);
  });

  it('exclusão em um aparelho apaga no outro', async () => {
    const cloud = fakeCloud();
    const a = device(cloud, key), b = device(cloud, key);
    a.put('debts', { id: 'd1' });
    await a.sync(); await b.sync();
    expect(b.get('debts', 'd1')).toBeDefined();
    a.del('debts', 'd1');
    await a.sync(); await b.sync();
    expect(b.get('debts', 'd1')).toBeUndefined();
    expect(cloud.rows.get(dirtyKey('debts', 'd1'))!.deleted).toBe(true);
  });

  it('mesmo registro alterado nos dois: vale a alteração mais recente', async () => {
    const cloud = fakeCloud();
    const a = device(cloud, key), b = device(cloud, key);
    a.put('accounts', { id: 'c1', v: 'original' } as never);
    await a.sync(); await b.sync();
    // B altera depois de A: B vence
    a.put('accounts', { id: 'c1', v: 'de A' } as never);
    await a.sync();
    cloud.advance(60_000);
    b.put('accounts', { id: 'c1', v: 'de B, mais novo' } as never);
    await b.sync(); await a.sync();
    expect(a.get('accounts', 'c1')!.v).toBe('de B, mais novo');
    // B alterou antes de A enviar: A vence
    b.put('accounts', { id: 'c1', v: 'de B, antigo' } as never, cloud.now() - 3_600_000);
    a.put('accounts', { id: 'c1', v: 'de A, novo' } as never);
    await a.sync(); await b.sync();
    expect(b.get('accounts', 'c1')!.v).toBe('de A, novo');
    expect(b.pending).toBe(0);
  });

  it('primeira sincronização junta os dados dos dois aparelhos sem perder nenhum', async () => {
    const cloud = fakeCloud();
    const a = device(cloud, key), b = device(cloud, key);
    a.put('goals', { id: 'ga' }); a.put('goals', { id: 'comum', v: 'de A' } as never);
    await a.sync();
    b.put('goals', { id: 'gb' }, 0); b.put('goals', { id: 'comum', v: 'de B' } as never, 0); // "tudo pendente desde sempre"
    await b.sync(); await a.sync();
    for (const d of [a, b]) {
      expect(d.get('goals', 'ga')).toBeDefined();
      expect(d.get('goals', 'gb')).toBeDefined();
      expect(d.get('goals', 'comum')!.v).toBe('de A'); // o que já estava na nuvem prevalece sobre o que nunca sincronizou
    }
  });

  it('linha adulterada ou de outra conta é ignorada e contada, sem derrubar o resto', async () => {
    const cloud = fakeCloud();
    const a = device(cloud, key), b = device(cloud, key);
    a.put('assets', { id: 'ok' }); a.put('assets', { id: 'ruim' });
    await a.sync();
    const bad = cloud.rows.get(dirtyKey('assets', 'ruim'))!;
    cloud.rows.set(dirtyKey('assets', 'ruim'), { ...bad, payload: 'AAAA' + bad.payload.slice(4) });
    const r = await b.sync();
    expect(r.skipped).toBe(1);
    expect(b.get('assets', 'ok')).toBeDefined();
    expect(b.get('assets', 'ruim')).toBeUndefined();
    const stranger = device(cloud, key, 'u2');
    expect((await stranger.sync()).skipped).toBe(2);
  });

  it('coleções que não viajam ficam de fora', async () => {
    const cloud = fakeCloud();
    const a = device(cloud, key);
    a.put('snapshots', { id: '2026-11-15' }); a.put('firedAlerts', { id: 'x' });
    expect((await a.sync()).pushed).toBe(0);
    expect(cloud.rows.size).toBe(0);
    expect(a.pending).toBe(0);
  });
});
