import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, emptyData } from '../src/lib/defaults';
import type { AppData, Settings } from '../src/lib/types';
import type { CloudRow } from '../src/services/cloud';
import { pullBackup, pushBackup, type CloudStore } from '../src/services/cloudBackup';
import { createVault } from '../src/services/vault';

const ITER = 100_000;
function memoryStore(): CloudStore & { rows: Map<string, CloudRow> } {
  const rows = new Map<string, CloudRow>();
  const k = (r: { collection: string; id: string }) => r.collection + '\n' + r.id;
  return { rows, list: async () => [...rows.values()], upsert: async (list) => void list.forEach((r) => rows.set(k(r), r)), remove: async (refs) => void refs.forEach((r) => rows.delete(k(r))) };
}
const sample = (): AppData => ({
  ...emptyData(),
  accounts: [{ id: 'a1', name: 'Conta Secreta', kind: 'corrente', initialCents: 123456, initialDate: '2026-11-01' }],
  transactions: [{ id: 't1', type: 'expense', kind: 'variavel', description: 'Mercado do bairro', amountCents: 5000, categoryId: 'mercado', date: '2026-11-11', paymentMethod: 'pix', accountId: 'a1', status: 'paid', createdAt: 1 }],
  firedAlerts: [{ id: 'x', at: 1 }],
});
const settings: Settings = { ...DEFAULT_SETTINGS, onboarded: true, theme: 'light', api: { ...DEFAULT_SETTINGS.api, brapiToken: 'TOKEN-SECRETO' }, security: { ...DEFAULT_SETTINGS.security, hash: 'HASH-DO-PIN' } };

describe('cópia na nuvem', () => {
  it('o servidor só recebe texto cifrado; PIN e token não sobem', async () => {
    const store = memoryStore();
    const { key } = await createVault('frase de teste longa', ITER);
    const r = await pushBackup(store, key, 'u1', sample(), settings);
    expect(r.sent).toBeGreaterThan(2);
    const sent = JSON.stringify([...store.rows.values()]);
    for (const secret of ['Conta Secreta', 'Mercado do bairro', '123456', 'TOKEN-SECRETO', 'HASH-DO-PIN']) expect(sent).not.toContain(secret);
    expect([...store.rows.values()].some((x) => x.collection === 'firedAlerts')).toBe(false);
  }, 30000);

  it('outro aparelho traz tudo de volta com a mesma chave', async () => {
    const store = memoryStore();
    const { key } = await createVault('frase de teste longa', ITER);
    await pushBackup(store, key, 'u1', sample(), settings);
    const back = (await pullBackup(store, key, 'u1'))!;
    expect(back.data.accounts[0].name).toBe('Conta Secreta');
    expect(back.data.transactions[0].amountCents).toBe(5000);
    expect(back.data.categories.length).toBeGreaterThan(5);
    expect(back.settings.theme).toBe('light');
    expect(back.settings.api.brapiToken).toBe('');
    expect(JSON.stringify(back.settings)).not.toContain('HASH-DO-PIN');
  }, 30000);

  it('o que foi apagado no aparelho sai da nuvem no próximo envio', async () => {
    const store = memoryStore();
    const { key } = await createVault('frase de teste longa', ITER);
    await pushBackup(store, key, 'u1', sample(), settings);
    const r = await pushBackup(store, key, 'u1', { ...sample(), transactions: [] }, settings);
    expect(r.removed).toBe(1);
    expect((await pullBackup(store, key, 'u1'))!.data.transactions).toEqual([]);
  }, 30000);

  it('nuvem vazia devolve nulo; chave errada ou outro dono não abre', async () => {
    const store = memoryStore();
    const { key } = await createVault('frase de teste longa', ITER);
    expect(await pullBackup(store, key, 'u1')).toBeNull();
    await pushBackup(store, key, 'u1', sample(), settings);
    await expect(pullBackup(store, (await createVault('outra frase bem longa', ITER)).key, 'u1')).rejects.toThrow('ilegível');
    await expect(pullBackup(store, key, 'u2')).rejects.toThrow('ilegível');
  }, 30000);
});
