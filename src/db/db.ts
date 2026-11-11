import { openDB, type IDBPDatabase } from 'idb';
import type { AppData, CollectionName, Settings } from '../lib/types';
import { DATA_KEYS, DEFAULT_SETTINGS, emptyData } from '../lib/defaults';

const DB_NAME = 'grefinacia';
const DB_VERSION = 1;

let dbp: Promise<IDBPDatabase> | null = null;

export function getDB(): Promise<IDBPDatabase> {
  if (!dbp) {
    dbp = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        for (const name of DATA_KEYS) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      },
    });
  }
  return dbp;
}

/** Fecha a conexão (usado em testes). */
export async function closeDB(): Promise<void> {
  if (dbp) (await dbp).close();
  dbp = null;
}

function mergeSettings(saved: Partial<Settings> | undefined): Settings {
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
  return { data, settings: mergeSettings(saved), hadData };
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

/** Pede ao Android/navegador que não apague os dados por falta de espaço. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* ignora */
  }
  return false;
}
