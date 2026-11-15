import { changesSince, currentSession, deleteAllCloudData, deleteRows, getVaultMeta, listRows, putVaultMeta, signInWithGoogleIdToken, signOutCloud, upsertRows, upsertSyncRows, type CloudSession } from '../services/cloud';
import { syncOnce } from '../services/sync';
import { createSafetyCopy } from '../db/db';
import { pullBackup, pushBackup, type CloudStore } from '../services/cloudBackup';
import { googleIdToken, googleSignOut } from '../services/googleLogin';
import { secureGet, secureRemove, secureSet } from '../services/secrets';
import { createVault, exportVaultKey, importVaultKey, unlockVault } from '../services/vault';
import { applyRemote, getState, getSyncState, markAllDirty, restoreAll, saveSyncState, setLocalChangeListener, syncValue, updateSettings } from './store';

/** Ações da nuvem. O app funciona inteiro sem nada disto: login e nuvem são opcionais. */
const KEY = 'vault_key';

export interface CloudStatus {
  email: string | null; // null = não está logado
  unlocked: boolean; // a senha de sincronização já foi informada neste aparelho
}

const storeFor = (s: CloudSession): CloudStore => ({ list: () => listRows(s), upsert: (rows) => upsertRows(s, rows), remove: (refs) => deleteRows(s, refs) });

async function requireSession(): Promise<CloudSession> {
  const s = await currentSession();
  if (!s) throw new Error('Entre com o Google primeiro.');
  return s;
}
async function requireKey(): Promise<CryptoKey> {
  const raw = await secureGet(KEY);
  if (!raw) throw new Error('Informe a senha de sincronização.');
  return importVaultKey(raw);
}

export async function cloudStatus(): Promise<CloudStatus> {
  const s = await currentSession().catch(() => null);
  return { email: s ? s.email || 'conta Google' : null, unlocked: !!s && !!(await secureGet(KEY)) };
}

export async function cloudLogin(): Promise<void> {
  await signInWithGoogleIdToken(await googleIdToken());
}

/** A nuvem já tem um cofre criado para esta conta? Decide se a tela pede "criar senha" ou "informar senha". */
export async function cloudHasVault(): Promise<boolean> {
  return (await getVaultMeta(await requireSession())) !== null;
}

/** Cria o cofre (primeira vez) ou abre o existente com a senha de sincronização. */
export async function cloudUnlock(passphrase: string): Promise<void> {
  const s = await requireSession();
  const meta = await getVaultMeta(s);
  let key: CryptoKey;
  if (meta) key = await unlockVault(meta, passphrase);
  else {
    const created = await createVault(passphrase);
    await putVaultMeta(s, created.meta);
    key = created.key;
  }
  await secureSet(KEY, await exportVaultKey(key));
}

export async function cloudBackupNow(): Promise<{ sent: number; removed: number }> {
  const s = await requireSession();
  const { data, settings } = getState();
  const r = await pushBackup(storeFor(s), await requireKey(), s.userId, data, settings);
  await updateSettings({ lastBackupAt: new Date().toISOString() });
  return r;
}

/** Substitui os dados do aparelho pela cópia da nuvem (o que existe agora fica numa cópia de segurança local). */
export async function cloudRestore(): Promise<boolean> {
  const s = await requireSession();
  const r = await pullBackup(storeFor(s), await requireKey(), s.userId);
  if (!r) return false;
  await restoreAll(r.data, r.settings);
  return true;
}

export async function cloudLogout(): Promise<void> {
  await secureRemove(KEY);
  await signOutCloud();
  await googleSignOut();
}

/** Apaga a cópia da nuvem (os dados do aparelho ficam). */
export async function cloudDeleteAll(): Promise<void> {
  await deleteAllCloudData(await requireSession());
  await secureRemove(KEY);
}

// ---------- sincronização entre aparelhos ----------
const LAST_SYNC = 'gf_last_sync';
/** Espera entre sincronizações automáticas: poupa bateria e a cota gratuita da nuvem. */
export const AUTO_SYNC_MIN_MS = 2 * 60 * 1000;
const AFTER_CHANGE_MS = 20 * 1000;
let running: Promise<SyncSummary> | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

export interface SyncSummary {
  pulled: number;
  pushed: number;
  skipped: number;
}
export const lastSyncAt = (): number => Number(localStorage.getItem(LAST_SYNC) ?? 0) || 0;

/** Baixa o que mudou na nuvem, aplica, e envia o que mudou aqui. Chamadas simultâneas esperam a mesma execução. */
export function cloudSync(): Promise<SyncSummary> {
  running ??= (async () => {
    try {
      const s = await requireSession();
      const key = await requireKey();
      let started = getSyncState();
      if (started.cursor === null) {
        // primeira sincronização deste aparelho: junta o que há aqui com o que há na nuvem, guardando uma cópia antes
        await createSafetyCopy('sincronizacao', getState().data, getState().settings);
        await markAllDirty([], 0);
        started = getSyncState();
      }
      const r = await syncOnce({ changesSince: (c) => changesSince(s, c), upsert: (rows) => upsertSyncRows(s, rows) }, { get: syncValue, apply: applyRemote }, key, s.userId, started);
      await saveSyncState(r.state, started);
      try { localStorage.setItem(LAST_SYNC, String(Date.now())); } catch { /* sem armazenamento */ }
      return { pulled: r.pulled, pushed: r.pushed, skipped: r.skipped };
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Sincroniza em silêncio, se houver login e senha neste aparelho e já tiver passado o intervalo mínimo. */
export async function cloudAutoSync(force = false): Promise<void> {
  try {
    if (!force && Date.now() - lastSyncAt() < AUTO_SYNC_MIN_MS) return;
    if (!(await secureGet(KEY)) || !(await currentSession())) return;
    await cloudSync();
  } catch {
    /* sem internet ou nuvem pausada: tenta na próxima; os dados seguem no aparelho */
  }
}

/** Liga a sincronização automática: ao abrir o app, ao voltar para ele e pouco depois de cada mudança. */
export function startAutoSync(): () => void {
  setLocalChangeListener(() => {
    clearTimeout(timer);
    timer = setTimeout(() => void cloudAutoSync(true), AFTER_CHANGE_MS);
  });
  const vis = () => document.visibilityState === 'visible' && void cloudAutoSync();
  document.addEventListener('visibilitychange', vis);
  void cloudAutoSync();
  return () => {
    setLocalChangeListener(null);
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', vis);
  };
}
