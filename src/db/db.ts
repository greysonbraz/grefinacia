import { openDB, type IDBPDatabase } from 'idb';
import type { AppData, CollectionName, Settings } from '../lib/types';
import { DATA_KEYS, DEFAULT_SETTINGS, emptyData } from '../lib/defaults';
import { withoutSecrets } from '../lib/secretFields';

const DB_NAME = 'grefinacia';
/**
 * Versão da ESTRUTURA do banco (quais "gavetas" existem). Regra fixa: uma versão nova só cria o que falta,
 * nunca apaga nem recria uma gaveta existente. Assim atualizar o app nunca perde dados.
 *   1 — coleções de dados + meta
 *   2 — + "safety" (cópias de segurança automáticas guardadas no aparelho)
 */
export const DB_VERSION = 2;
const SAFETY = 'safety';
/** Quantas cópias automáticas ficam guardadas; a mais antiga sai quando entra uma nova. */
export const MAX_SAFETY_COPIES = 3;

export type SafetyReason = 'atualizacao' | 'restauracao' | 'importacao';

/** Retrato completo dos dados, guardado no próprio aparelho antes de uma operação que substitui ou transforma tudo. */
export interface SafetyCopy {
  id: string;
  createdAt: string; // data e hora ISO
  reason: SafetyReason;
  records: number; // quantos registros a cópia tem (para mostrar na tela)
  data: AppData;
  settings: Omit<Settings, 'security'>; // sem o PIN e sem segredos
}
export type SafetyCopyInfo = Omit<SafetyCopy, 'data' | 'settings'>;

let dbp: Promise<IDBPDatabase> | null = null;
/** Versão que o banco tinha antes de ser atualizado nesta abertura (null se não houve atualização). */
let upgradedFrom: number | null = null;

export function getDB(): Promise<IDBPDatabase> {
  if (!dbp) {
    dbp = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        for (const name of DATA_KEYS) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        if (!db.objectStoreNames.contains(SAFETY)) db.createObjectStore(SAFETY, { keyPath: 'id' });
        if (oldVersion >= 1) upgradedFrom = oldVersion;
      },
    });
  }
  return dbp;
}

/** Fecha a conexão (usado em testes). */
export async function closeDB(): Promise<void> {
  if (dbp) (await dbp).close();
  dbp = null;
  upgradedFrom = null;
}

/** Completa configurações salvas (ou vindas de um backup antigo) com os padrões do que ainda não existia. */
export function mergeSettings(saved: Partial<Settings> | undefined): Settings {
  const s = saved ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    security: { ...DEFAULT_SETTINGS.security, ...s.security },
    salary: { ...DEFAULT_SETTINGS.salary, ...s.salary },
    notifications: { ...DEFAULT_SETTINGS.notifications, ...s.notifications, types: { ...DEFAULT_SETTINGS.notifications.types, ...s.notifications?.types } },
    api: { ...DEFAULT_SETTINGS.api, ...s.api },
    ai: { ...DEFAULT_SETTINGS.ai, ...s.ai },
    freedom: { ...DEFAULT_SETTINGS.freedom, ...s.freedom },
    budgets: { ...s.budgets },
  };
}

export async function loadAll(): Promise<{ data: AppData; settings: Settings; hadData: boolean }> {
  const db = await getDB();
  const data = emptyData();
  let hadData = false;
  for (const name of DATA_KEYS) {
    const items = await db.getAll(name);
    if (items.length > 0) {
      (data[name] as unknown[]) = items;
      if (name !== 'categories') hadData = true;
    }
  }
  const saved = (await db.get('meta', 'settings')) as Partial<Settings> | undefined;
  if (saved) hadData = true;
  const settings = mergeSettings(saved);
  // primeira abertura depois de uma atualização da estrutura: guarda um retrato do que havia
  if (upgradedFrom !== null) {
    upgradedFrom = null;
    if (hadData) await createSafetyCopy('atualizacao', data, settings);
  }
  return { data, settings, hadData };
}

export async function putItems(name: CollectionName, items: { id: string }[]): Promise<void> {
  if (items.length === 0) return;
  const db = await getDB();
  const tx = db.transaction(name, 'readwrite');
  await Promise.all([...items.map((i) => tx.store.put(i)), tx.done]);
}

export async function deleteItems(name: CollectionName, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDB();
  const tx = db.transaction(name, 'readwrite');
  await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
}

export async function saveSettings(settings: Settings): Promise<void> {
  const db = await getDB();
  await db.put('meta', settings, 'settings');
}

/** Apaga tudo e grava o conteúdo informado (restauração de backup / recomeçar do zero). */
export async function replaceEverything(data: AppData, settings: Settings): Promise<void> {
  const db = await getDB();
  const tx = db.transaction([...DATA_KEYS, 'meta'], 'readwrite');
  for (const name of DATA_KEYS) {
    await tx.objectStore(name).clear();
    for (const item of data[name] as { id: string }[]) await tx.objectStore(name).put(item);
  }
  await tx.objectStore('meta').put(settings, 'settings');
  await tx.done;
}

// ---------- cópias de segurança automáticas ----------

/** Registros que a pessoa cadastrou (não conta categorias padrão, retratos de patrimônio nem controle de alertas). */
const countRecords = (d: AppData): number => d.accounts.length + d.cards.length + d.transactions.length + d.recurrences.length + d.goals.length + d.goalMoves.length + d.assets.length + d.operations.length + d.fixedIncomes.length + d.dividends.length + d.debts.length;

/**
 * Guarda no aparelho um retrato completo dos dados, para poder desfazer uma restauração, importação ou atualização.
 * Nunca derruba a operação principal: se não der para gravar a cópia, devolve `null`.
 */
export async function createSafetyCopy(reason: SafetyReason, data: AppData, settings: Settings): Promise<SafetyCopyInfo | null> {
  const records = countRecords(data);
  if (records === 0) return null; // nada cadastrado ainda: não há o que proteger
  try {
    const db = await getDB();
    const createdAt = new Date().toISOString();
    const { security: _security, ...rest } = withoutSecrets(settings);
    void _security;
    const copy: SafetyCopy = { id: `${createdAt}-${Math.random().toString(36).slice(2, 8)}`, createdAt, reason, records, data, settings: rest };
    const tx = db.transaction(SAFETY, 'readwrite');
    await tx.store.put(copy);
    const keys = (await tx.store.getAllKeys()) as string[];
    for (const old of keys.sort().slice(0, Math.max(keys.length - MAX_SAFETY_COPIES, 0))) await tx.store.delete(old);
    await tx.done;
    return { id: copy.id, createdAt, reason, records };
  } catch {
    return null;
  }
}

/** Lista as cópias guardadas, da mais nova para a mais antiga (sem carregar o conteúdo). */
export async function listSafetyCopies(): Promise<SafetyCopyInfo[]> {
  const db = await getDB();
  const all = (await db.getAll(SAFETY)) as SafetyCopy[];
  return all.map(({ id, createdAt, reason, records }) => ({ id, createdAt, reason, records })).sort((a, b) => b.id.localeCompare(a.id));
}

export async function getSafetyCopy(id: string): Promise<SafetyCopy | undefined> {
  const db = await getDB();
  return (await db.get(SAFETY, id)) as SafetyCopy | undefined;
}

/** Apaga todas as cópias (usado em "Apagar todos os meus dados"). */
export async function clearSafetyCopies(): Promise<void> {
  const db = await getDB();
  await db.clear(SAFETY);
}

/** Pede ao Android/navegador que não apague os dados por falta de espaço. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* ignora */
  }
  return false;
}
