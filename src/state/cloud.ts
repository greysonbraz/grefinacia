import { currentSession, deleteAllCloudData, deleteRows, getVaultMeta, listRows, putVaultMeta, signInWithGoogleIdToken, signOutCloud, upsertRows, type CloudSession } from '../services/cloud';
import { pullBackup, pushBackup, type CloudStore } from '../services/cloudBackup';
import { googleIdToken, googleSignOut } from '../services/googleLogin';
import { secureGet, secureRemove, secureSet } from '../services/secrets';
import { createVault, exportVaultKey, importVaultKey, unlockVault } from '../services/vault';
import { getState, restoreAll, updateSettings } from './store';

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
