import { openRecord, sealRecord, type SealedRecord } from './vault';

/**
 * Sincronização entre aparelhos, registro a registro.
 *
 * - Cada aparelho guarda quais registros mudou desde a última sincronização ("pendentes") e até onde já leu a nuvem ("cursor").
 * - Sincronizar = baixar o que mudou na nuvem depois do cursor, aplicar, e enviar os pendentes.
 * - Mesmo registro alterado nos dois lados: vale a alteração mais recente.
 * - Exclusão viaja como um registro marcado "apagado", para os outros aparelhos também apagarem.
 * Tudo que sobe é cifrado no aparelho (vault.ts).
 */
export interface RemoteRow extends SealedRecord {
  collection: string;
  id: string;
  deleted: boolean;
  updated_at: string; // data do servidor
}
export interface SyncRemote {
  changesSince(cursor: string | null): Promise<RemoteRow[]>;
  upsert(rows: Omit<RemoteRow, 'updated_at'>[]): Promise<void>;
}
export interface SyncLocal {
  /** Valor atual do registro no aparelho, ou undefined se não existe. */
  get(collection: string, id: string): unknown | undefined;
  /** Grava no aparelho o que veio da nuvem, sem marcar como pendente. */
  apply(upserts: { collection: string; id: string; value: unknown }[], deletes: { collection: string; id: string }[]): Promise<void>;
}
export interface SyncState {
  cursor: string | null;
  dirty: Record<string, number>; // "coleção\nid" -> quando mudou neste aparelho (ms)
}
export const emptySyncState = (): SyncState => ({ cursor: null, dirty: {} });
export const dirtyKey = (collection: string, id: string): string => collection + '\n' + id;
const splitKey = (k: string): { collection: string; id: string } => ({ collection: k.slice(0, k.indexOf('\n')), id: k.slice(k.indexOf('\n') + 1) });

/**
 * Coleções que viajam. Retratos de patrimônio, controle de alertas e histórico de preços são recriados
 * por cada aparelho (o histórico se busca de novo nas fontes e iria pesar na cota gratuita da nuvem).
 */
export const SYNCED = new Set(['accounts', 'cards', 'categories', 'transactions', 'recurrences', 'goals', 'goalMoves', 'assets', 'operations', 'fixedIncomes', 'dividends', 'debts', 'transfers', 'cryptoAssets', 'cryptoOps', 'meta']);

export interface SyncResult {
  state: SyncState;
  pulled: number;
  pushed: number;
  skipped: number; // registros da nuvem que não puderam ser lidos
}

export async function syncOnce(remote: SyncRemote, local: SyncLocal, key: CryptoKey, userId: string, state: SyncState): Promise<SyncResult> {
  const dirty = { ...state.dirty };
  let cursor = state.cursor;
  let skipped = 0;

  // 1. baixar e aplicar
  const rows = await remote.changesSince(cursor);
  const upserts: { collection: string; id: string; value: unknown }[] = [];
  const deletes: { collection: string; id: string }[] = [];
  for (const r of rows) {
    if (!cursor || r.updated_at > cursor) cursor = r.updated_at;
    if (!SYNCED.has(r.collection)) continue;
    const k = dirtyKey(r.collection, r.id);
    const localChange = dirty[k];
    // alterado nos dois lados: fica o mais recente
    // (no empate fica o do aparelho: costuma ser o eco do próprio envio anterior)
    if (localChange !== undefined && localChange >= Date.parse(r.updated_at)) continue;
    delete dirty[k];
    if (r.deleted) {
      if (local.get(r.collection, r.id) !== undefined) deletes.push({ collection: r.collection, id: r.id });
      continue;
    }
    try {
      const value = await openRecord<{ id?: unknown }>(key, { userId, collection: r.collection, id: r.id }, r);
      if (typeof value !== 'object' || value === null || (r.collection !== 'meta' && value.id !== r.id)) throw new Error('registro inconsistente');
      upserts.push({ collection: r.collection, id: r.id, value });
    } catch {
      skipped++;
    }
  }
  if (upserts.length || deletes.length) await local.apply(upserts, deletes);

  // 2. enviar os pendentes
  const out: Omit<RemoteRow, 'updated_at'>[] = [];
  const sentKeys: string[] = [];
  for (const k of Object.keys(dirty)) {
    const { collection, id } = splitKey(k);
    if (!SYNCED.has(collection)) {
      delete dirty[k];
      continue;
    }
    const value = local.get(collection, id);
    const sealed = await sealRecord(key, { userId, collection, id }, value === undefined ? { apagado: true } : value);
    out.push({ collection, id, deleted: value === undefined, ...sealed });
    sentKeys.push(k);
  }
  if (out.length) await remote.upsert(out);
  // só deixa de ser pendente o que não mudou de novo durante o envio
  for (const k of sentKeys) if (dirty[k] === state.dirty[k] || state.dirty[k] === undefined) delete dirty[k];

  return { state: { cursor, dirty }, pulled: upserts.length + deletes.length, pushed: out.length, skipped };
}
