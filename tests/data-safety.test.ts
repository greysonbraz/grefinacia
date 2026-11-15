import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { deleteDB, openDB } from 'idb';
import { DATA_KEYS, DEFAULT_SETTINGS, emptyData } from '../src/lib/defaults';
import type { Account, AppData, Settings, Transaction } from '../src/lib/types';
import { closeDB, createSafetyCopy, DB_VERSION, getSafetyCopy, listSafetyCopies, loadAll, MAX_SAFETY_COPIES, putItems, saveSettings } from '../src/db/db';
import { BackupError, createBackup, readBackup } from '../src/services/backup';
import { DATA_SCHEMA, ImportError, validateImported } from '../src/services/validate';
import { setSecretStoreForTests, type SecretStore } from '../src/services/secrets';
import { getState, init, restoreAll, restoreSafetyCopy, updateSettings, upsert, wipeAll } from '../src/state/store';

const TODAY = '2026-11-11';
const account = (p: Partial<Account> = {}): Account => ({ id: 'a1', name: 'Conta', kind: 'corrente', initialCents: 100000, initialDate: '2026-11-01', ...p });
const tx = (p: Partial<Transaction> = {}): Transaction => ({ id: 't1', type: 'expense', kind: 'variavel', description: 'Mercado', amountCents: 5000, categoryId: 'mercado', date: TODAY, paymentMethod: 'pix', accountId: 'a1', status: 'paid', createdAt: 1, ...p });
const sample = (): AppData => ({ ...emptyData(), accounts: [account()], transactions: [tx()] });
/** Espera o app terminar as tarefas que ele agenda depois de cada mudança (notificações, retrato do patrimônio). */
const settle = () => new Promise((r) => setTimeout(r, 600));

async function freshDatabase(): Promise<void> {
  await closeDB();
  await deleteDB('grefinacia');
}

describe('backup: arquivos antigos, adulterados e de versões futuras', () => {
  const fixture = readFileSync(process.cwd() + '/tests/fixtures/backup-v1.gfbackup', 'utf8');

  it('um backup gerado pela versão 1.0 continua abrindo, com tudo dentro', async () => {
    const r = await readBackup(fixture, 'senha-de-teste-123');
    expect(r.data.accounts[0].name).toBe('Conta de exemplo');
    expect(r.data.transactions).toHaveLength(3);
    expect(r.data.transactions[1].description).toContain('<b>não é HTML</b>'); // texto volta igual, sem ser interpretado
    expect(r.data.debts[0].balanceCents).toBe(1000000);
    expect(r.data.dividends[0].ratePerUnit).toBe(0.1);
    expect(r.data.categories.length).toBeGreaterThan(5);
    expect(r.settings.theme).toBe('light');
    expect(r.settings.api.brapiToken).toBe('TOKEN-DE-TESTE');
    expect(JSON.stringify(r.settings)).not.toContain('HASH-DO-PIN');
    for (const k of DATA_KEYS) expect(Array.isArray(r.data[k])).toBe(true);
  }, 30000);

  it('qualquer alteração no arquivo faz a abertura falhar', async () => {
    const file = JSON.parse(fixture) as { data: string };
    const i = Math.floor(file.data.length / 2);
    const swapped = file.data[i] === 'A' ? 'B' : 'A';
    const tampered = JSON.stringify({ ...file, data: file.data.slice(0, i) + swapped + file.data.slice(i + 1) });
    await expect(readBackup(tampered, 'senha-de-teste-123')).rejects.toThrow('Senha incorreta ou arquivo corrompido');
  }, 30000);

  it('recusa arquivo de versão mais nova do app em vez de restaurar pela metade', async () => {
    const file = JSON.parse(fixture) as object;
    await expect(readBackup(JSON.stringify({ ...file, v: 2 }), 'senha-de-teste-123')).rejects.toThrow('versão mais nova');
    expect(() => validateImported({ schema: DATA_SCHEMA + 1, data: emptyData(), settings: {} })).toThrow('versão mais nova');
  });

  it('recusa o que não é backup e parâmetros forjados para travar o aparelho', async () => {
    const file = JSON.parse(fixture) as object;
    await expect(readBackup('não é json', 'x')).rejects.toBeInstanceOf(BackupError);
    await expect(readBackup('null', 'x')).rejects.toThrow('Arquivo inválido');
    await expect(readBackup(JSON.stringify({ ...file, app: 'outro' }), 'x')).rejects.toThrow('Arquivo inválido');
    await expect(readBackup(JSON.stringify({ ...file, iter: 9_000_000_000 }), 'x')).rejects.toThrow('Arquivo inválido');
    await expect(readBackup(JSON.stringify({ ...file, iter: 1 }), 'x')).rejects.toThrow('Arquivo inválido');
  });

  it('backup novo leva a versão dos dados e abre de volta', async () => {
    const file = await createBackup(sample(), { ...DEFAULT_SETTINGS, onboarded: true }, 'outra-senha-123');
    const r = await readBackup(file, 'outra-senha-123');
    expect(r.data.transactions[0].description).toBe('Mercado');
    expect(r.settings.onboarded).toBe(true);
  }, 30000);
});

describe('conferência do conteúdo antes de gravar', () => {
  it('aceita os dados do próprio app e completa seções que não existiam', () => {
    const r = validateImported({ data: { accounts: [account()] }, settings: { theme: 'light' } });
    expect(r.data.accounts).toHaveLength(1);
    expect(r.data.transactions).toEqual([]);
    expect(r.data.categories.length).toBeGreaterThan(5); // sem categorias no arquivo, ficam as padrão
    expect(validateImported({ data: { ...emptyData(), categories: [] }, settings: {} }).data.categories.length).toBeGreaterThan(5);
  });

  it('recusa estrutura torta com mensagem clara', () => {
    expect(() => validateImported(null)).toThrow(ImportError);
    expect(() => validateImported({ data: [] })).toThrow('não contém os dados');
    expect(() => validateImported({ data: { accounts: 'x' } })).toThrow('seção "accounts" não é uma lista');
    expect(() => validateImported({ data: { accounts: [{ name: 'sem id' }] } })).toThrow('registro 1 da seção "accounts" não tem identificação');
    expect(() => validateImported({ data: { accounts: [null] } })).toThrow('não tem identificação');
    expect(() => validateImported({ data: { accounts: [account(), account()] } })).toThrow('identificação repetida');
    expect(() => validateImported({ schema: 'x', data: {} })).toThrow('versão dos dados desconhecida');
  });

  it('descarta chaves perigosas (__proto__), o PIN e configurações com formato errado', () => {
    const evil = JSON.parse('{"data":{"accounts":[{"id":"a1","name":"C","__proto__":{"admin":true},"constructor":{"x":1}}]},"settings":{"__proto__":{"polluted":true},"security":{"hash":"H"},"api":"texto","theme":"light"}}');
    const r = validateImported(evil);
    const acc = r.data.accounts[0] as unknown as Record<string, unknown>;
    expect(Object.keys(acc)).toEqual(['id', 'name']);
    expect((acc as { admin?: boolean }).admin).toBeUndefined();
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    const s = r.settings as unknown as Record<string, unknown>;
    expect(s.security).toBeUndefined();
    expect(s.api).toBeUndefined();
    expect(s.theme).toBe('light');
  });

  it('recusa estrutura profunda demais', () => {
    let deep: unknown = 'x';
    for (let i = 0; i < 40; i++) deep = { a: deep };
    expect(() => validateImported({ data: { accounts: [{ id: 'a1', deep }] } })).toThrow('profunda demais');
  });
});

describe('banco local: atualização de versão e cópias de segurança', () => {
  beforeEach(freshDatabase);

  it('atualizar da estrutura 1 para a atual preserva tudo e guarda uma cópia do que havia', async () => {
    // banco exatamente como a versão 1.0 do app criava
    const v1 = await openDB('grefinacia', 1, {
      upgrade(db) {
        for (const name of DATA_KEYS) db.createObjectStore(name, { keyPath: 'id' });
        db.createObjectStore('meta');
      },
    });
    await v1.put('accounts', account({ name: 'Conta antiga' }));
    await v1.put('transactions', tx({ description: 'Lançamento antigo' }));
    const oldSettings: Settings = { ...DEFAULT_SETTINGS, onboarded: true, api: { ...DEFAULT_SETTINGS.api, brapiToken: 'TOKEN-ANTIGO' }, security: { ...DEFAULT_SETTINGS.security, enabled: true, hash: 'HASH-ANTIGO', salt: 'SAL' } };
    await v1.put('meta', oldSettings, 'settings');
    v1.close();

    expect(DB_VERSION).toBeGreaterThan(1);
    const l = await loadAll();
    expect(l.data.accounts[0].name).toBe('Conta antiga');
    expect(l.data.transactions[0].description).toBe('Lançamento antigo');
    expect(l.settings.security.hash).toBe('HASH-ANTIGO'); // o PIN continua valendo
    expect(l.settings.api.brapiToken).toBe('TOKEN-ANTIGO');

    const copies = await listSafetyCopies();
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ reason: 'atualizacao', records: 2 });
    const full = await getSafetyCopy(copies[0].id);
    expect(full!.data.accounts[0].name).toBe('Conta antiga');
    // a cópia não guarda PIN nem token
    expect(JSON.stringify(full)).not.toContain('HASH-ANTIGO');
    expect(JSON.stringify(full)).not.toContain('TOKEN-ANTIGO');

    // abrir de novo não cria outra cópia nem altera os dados
    await closeDB();
    const again = await loadAll();
    expect(again.data.transactions).toHaveLength(1);
    expect(await listSafetyCopies()).toHaveLength(1);
  });

  it('instalação nova (sem dados) não gera cópia', async () => {
    await loadAll();
    expect(await listSafetyCopies()).toHaveLength(0);
    expect(await createSafetyCopy('restauracao', emptyData(), DEFAULT_SETTINGS)).toBeNull();
  });

  it(`guarda só as ${MAX_SAFETY_COPIES} cópias mais recentes, da mais nova para a mais antiga`, async () => {
    for (let i = 1; i <= MAX_SAFETY_COPIES + 2; i++) {
      await createSafetyCopy('restauracao', { ...sample(), accounts: [account({ name: 'Versão ' + i })] }, DEFAULT_SETTINGS);
      await new Promise((r) => setTimeout(r, 5)); // garante datas diferentes
    }
    const copies = await listSafetyCopies();
    expect(copies).toHaveLength(MAX_SAFETY_COPIES);
    expect((await getSafetyCopy(copies[0].id))!.data.accounts[0].name).toBe('Versão ' + (MAX_SAFETY_COPIES + 2));
    expect((await getSafetyCopy(copies[copies.length - 1].id))!.data.accounts[0].name).toBe('Versão 3');
  });
});

describe('restaurar, desfazer e apagar tudo', () => {
  function fakeStore(): SecretStore & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return { data, get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v), remove: async (k) => void data.delete(k) };
  }

  beforeEach(async () => {
    await settle();
    await freshDatabase();
    setSecretStoreForTests(fakeStore());
  });

  it('restaurar um backup guarda antes o que havia, e dá para voltar', async () => {
    await putItems('accounts', [account({ name: 'Minha conta atual' })]);
    await saveSettings({ ...DEFAULT_SETTINGS, onboarded: true });
    await init();
    expect(getState().data.accounts[0].name).toBe('Minha conta atual');

    const incoming = validateImported({ data: { accounts: [account({ id: 'b1', name: 'Conta do backup' })] }, settings: { theme: 'light' } });
    await restoreAll(incoming.data, incoming.settings);
    expect(getState().data.accounts.map((a) => a.name)).toEqual(['Conta do backup']);
    expect((await loadAllFresh()).data.accounts.map((a) => a.name)).toEqual(['Conta do backup']);

    const copies = await listSafetyCopies();
    expect(copies).toHaveLength(1);
    expect(copies[0].reason).toBe('restauracao');
    expect(await restoreSafetyCopy(copies[0].id)).toBe(true);
    expect(getState().data.accounts.map((a) => a.name)).toEqual(['Minha conta atual']);
    // desfazer também é desfazível: o estado do backup ficou guardado
    expect(await listSafetyCopies()).toHaveLength(2);
    expect(await restoreSafetyCopy('não-existe')).toBe(false);
    await settle();
  }, 20000);

  it('restaurar não troca o PIN do aparelho nem apaga o token já configurado; opções novas ganham o padrão', async () => {
    await init();
    await upsert('accounts', account());
    await updateSettings({ onboarded: true, security: { ...DEFAULT_SETTINGS.security, enabled: true, hash: 'HASH-DESTE-APARELHO', salt: 'S' }, api: { ...DEFAULT_SETTINGS.api, brapiToken: 'TOKEN-DESTE-APARELHO' } });
    // backup antigo: sem token e sem parte das opções de notificação
    const old = validateImported({ data: { accounts: [account({ id: 'b1' })] }, settings: { theme: 'light', notifications: { enabled: false } } });
    await restoreAll(old.data, old.settings);
    const s = getState().settings;
    expect(s.security.hash).toBe('HASH-DESTE-APARELHO');
    expect(s.api.brapiToken).toBe('TOKEN-DESTE-APARELHO');
    expect(s.theme).toBe('light');
    expect(s.notifications.enabled).toBe(false);
    expect(s.notifications.types.billsDue).toBe(true); // padrão preenchido
    expect(s.notifications.time).toBe('09:00');
    await settle();
  }, 20000);

  it('com o cofre ativo, o token não fica gravado no banco local', async () => {
    await init();
    await updateSettings({ api: { ...DEFAULT_SETTINGS.api, brapiToken: 'TOKEN-SECRETO' } });
    expect(getState().settings.api.brapiToken).toBe('TOKEN-SECRETO'); // em memória, para o app usar
    const raw = await rawSettings();
    expect(JSON.stringify(raw)).not.toContain('TOKEN-SECRETO');
    // reabrindo o app, o token volta do cofre
    await closeDB();
    await init();
    expect(getState().settings.api.brapiToken).toBe('TOKEN-SECRETO');
    await settle();
  }, 20000);

  it('"apagar todos os meus dados" apaga também as cópias de segurança e o cofre', async () => {
    const store = fakeStore();
    setSecretStoreForTests(store);
    await init();
    await upsert('accounts', account());
    await updateSettings({ onboarded: true, api: { ...DEFAULT_SETTINGS.api, brapiToken: 'TOKEN-SECRETO' } });
    await createSafetyCopy('restauracao', getState().data, getState().settings);
    expect(await listSafetyCopies()).toHaveLength(1);
    expect(store.data.size).toBe(1);
    await wipeAll();
    expect(await listSafetyCopies()).toHaveLength(0);
    expect(store.data.size).toBe(0);
    expect(getState().data.accounts).toHaveLength(0);
    expect((await loadAllFresh()).data.accounts).toHaveLength(0);
    await settle();
  }, 20000);
});

/** Lê o banco do zero (fecha a conexão antes), como se o app tivesse sido reaberto. */
async function loadAllFresh() {
  await closeDB();
  return loadAll();
}
/** Lê o registro de configurações exatamente como está gravado no banco. */
async function rawSettings(): Promise<unknown> {
  await closeDB();
  const db = await openDB('grefinacia');
  const v = await db.get('meta', 'settings');
  db.close();
  return v;
}
