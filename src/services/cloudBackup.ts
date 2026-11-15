import type { AppData, Settings } from '../lib/types';
import { DATA_KEYS } from '../lib/defaults';
import { withoutSecrets } from '../lib/secretFields';
import type { CloudRow } from './cloud';
import { openRecord, sealRecord, type RecordRef } from './vault';
import { DATA_SCHEMA, validateImported } from './validate';

/** O que a cópia na nuvem precisa do servidor. Permite testar sem rede. */
export interface CloudStore {
  list(): Promise<CloudRow[]>;
  upsert(rows: CloudRow[]): Promise<void>;
  remove(refs: { collection: string; id: string }[]): Promise<void>;
}

const SETTINGS: Pick<RecordRef, 'collection' | 'id'> = { collection: 'meta', id: 'settings' };
/** Coleções que podem ser recriadas pelo app e não precisam viajar. */
const SKIP = new Set(['firedAlerts']);

/**
 * Envia uma cópia completa dos dados, cifrada registro a registro, e remove da nuvem o que foi apagado no aparelho.
 * O PIN e os segredos (token, chaves) não sobem.
 */
export async function pushBackup(store: CloudStore, key: CryptoKey, userId: string, data: AppData, settings: Settings): Promise<{ sent: number; removed: number }> {
  const rows: CloudRow[] = [];
  for (const collection of DATA_KEYS) {
    if (SKIP.has(collection)) continue;
    for (const item of data[collection] as { id: string }[]) rows.push({ collection, id: item.id, ...(await sealRecord(key, { userId, collection, id: item.id }, item)) });
  }
  const { security: _security, ...rest } = withoutSecrets(settings);
  void _security;
  rows.push({ ...SETTINGS, ...(await sealRecord(key, { userId, ...SETTINGS }, { schema: DATA_SCHEMA, settings: rest })) });

  const keep = new Set(rows.map((r) => r.collection + '\n' + r.id));
  const stale = (await store.list()).filter((r) => !keep.has(r.collection + '\n' + r.id)).map(({ collection, id }) => ({ collection, id }));
  await store.upsert(rows);
  await store.remove(stale);
  return { sent: rows.length, removed: stale.length };
}

/** Baixa e decifra a cópia da nuvem. `null` = não há cópia. Passa pela mesma conferência de um backup em arquivo. */
export async function pullBackup(store: CloudStore, key: CryptoKey, userId: string): Promise<{ data: AppData; settings: Omit<Settings, 'security'> } | null> {
  const rows = await store.list();
  if (rows.length === 0) return null;
  const data: Record<string, unknown[]> = {};
  let meta: { schema?: number; settings?: unknown } = {};
  for (const r of rows) {
    const value = await openRecord(key, { userId, collection: r.collection, id: r.id }, r);
    if (r.collection === SETTINGS.collection) meta = value as typeof meta;
    else (data[r.collection] ??= []).push(value);
  }
  return validateImported({ schema: meta.schema, data, settings: meta.settings ?? {} });
}
