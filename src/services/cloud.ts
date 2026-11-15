import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../lib/cloudConfig';
import { secureGet, secureRemove, secureSet } from './secrets';
import type { SealedRecord, VaultMeta } from './vault';
import type { RemoteRow } from './sync';

/**
 * Cliente mínimo do Supabase (login e tabelas do cofre), direto pela API REST.
 * Só trafega texto cifrado: quem cifra e decifra é o aparelho (vault.ts).
 */
export class CloudError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message);
  }
}

export interface CloudSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // ms
  userId: string;
  email: string;
}
export interface CloudRow extends SealedRecord {
  collection: string;
  id: string;
}

const SESSION_KEY = 'cloud_session';
const PAGE = 1000;
const BATCH = 200;

async function call(path: string, init: RequestInit & { token?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  let res: Response;
  try {
    res = await fetch(SUPABASE_URL + path, { ...init, headers });
  } catch {
    throw new CloudError('Sem conexão com a nuvem. Seus dados continuam salvos no aparelho.');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string; msg?: string; error_description?: string } | null;
    const detail = body?.message ?? body?.msg ?? body?.error_description ?? '';
    if (res.status === 401 || res.status === 403) throw new CloudError('A nuvem recusou o acesso. Entre de novo com o Google.' + (detail ? ` (${detail})` : ''), res.status);
    if (res.status >= 500) throw new CloudError('A nuvem está indisponível agora (o projeto pode estar pausado por falta de uso). Tente mais tarde.', res.status);
    throw new CloudError(`A nuvem respondeu com erro ${res.status}.` + (detail ? ` ${detail}` : ''), res.status);
  }
  return res;
}

function toSession(j: any): CloudSession {
  if (!j?.access_token || !j?.refresh_token || !j?.user?.id) throw new CloudError('Resposta de login inesperada da nuvem.');
  return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000, userId: j.user.id, email: j.user.email ?? '' };
}

/** Troca o token de identidade do Google por uma sessão do Supabase. */
export async function signInWithGoogleIdToken(idToken: string): Promise<CloudSession> {
  const res = await call('/auth/v1/token?grant_type=id_token', { method: 'POST', body: JSON.stringify({ provider: 'google', id_token: idToken }) });
  const s = toSession(await res.json());
  await secureSet(SESSION_KEY, JSON.stringify(s));
  return s;
}

/** Sessão guardada, renovada se estiver perto de vencer. `null` = não está logado. */
export async function currentSession(): Promise<CloudSession | null> {
  const raw = await secureGet(SESSION_KEY);
  if (!raw) return null;
  let s: CloudSession;
  try {
    s = JSON.parse(raw) as CloudSession;
  } catch {
    return null;
  }
  if (s.expiresAt - Date.now() > 60_000) return s;
  try {
    const res = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: s.refreshToken }) });
    const fresh = toSession(await res.json());
    await secureSet(SESSION_KEY, JSON.stringify(fresh));
    return fresh;
  } catch (e) {
    // login vencido de vez: sai; sem internet: mantém a sessão para tentar depois
    if (e instanceof CloudError && e.status >= 400 && e.status < 500) {
      await secureRemove(SESSION_KEY);
      return null;
    }
    throw e;
  }
}

export async function signOutCloud(): Promise<void> {
  const raw = await secureGet(SESSION_KEY);
  await secureRemove(SESSION_KEY);
  if (!raw) return;
  try {
    await call('/auth/v1/logout', { method: 'POST', token: (JSON.parse(raw) as CloudSession).accessToken });
  } catch {
    /* já saiu localmente */
  }
}

export async function getVaultMeta(s: CloudSession): Promise<VaultMeta | null> {
  const res = await call('/rest/v1/vault_meta?select=meta', { token: s.accessToken });
  const rows = (await res.json()) as { meta: VaultMeta }[];
  return rows[0]?.meta ?? null;
}

export async function putVaultMeta(s: CloudSession, meta: VaultMeta): Promise<void> {
  await call('/rest/v1/vault_meta?on_conflict=user_id', { method: 'POST', token: s.accessToken, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ user_id: s.userId, meta }) });
}

export async function listRows(s: CloudSession): Promise<CloudRow[]> {
  const all: CloudRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const res = await call(`/rest/v1/vault_records?select=collection,id,iv,payload&deleted=eq.false&order=collection,id&limit=${PAGE}&offset=${offset}`, { token: s.accessToken });
    const page = (await res.json()) as CloudRow[];
    all.push(...page);
    if (page.length < PAGE) return all;
  }
}

export async function upsertRows(s: CloudSession, rows: CloudRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    const body = rows.slice(i, i + BATCH).map((r) => ({ user_id: s.userId, collection: r.collection, id: r.id, iv: r.iv, payload: r.payload, deleted: false }));
    await call('/rest/v1/vault_records?on_conflict=user_id,collection,id', { method: 'POST', token: s.accessToken, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(body) });
  }
}

export async function deleteRows(s: CloudSession, refs: { collection: string; id: string }[]): Promise<void> {
  const byCollection = new Map<string, string[]>();
  for (const r of refs) byCollection.set(r.collection, [...(byCollection.get(r.collection) ?? []), r.id]);
  for (const [collection, ids] of byCollection) {
    for (let i = 0; i < ids.length; i += 50) {
      const list = ids.slice(i, i + 50).map((id) => '"' + id.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(',');
      await call(`/rest/v1/vault_records?collection=eq.${encodeURIComponent(collection)}&id=in.(${encodeURIComponent(list)})`, { method: 'DELETE', token: s.accessToken, headers: { Prefer: 'return=minimal' } });
    }
  }
}

export async function deleteAllCloudData(s: CloudSession): Promise<void> {
  await call(`/rest/v1/vault_records?user_id=eq.${s.userId}`, { method: 'DELETE', token: s.accessToken, headers: { Prefer: 'return=minimal' } });
  await call(`/rest/v1/vault_meta?user_id=eq.${s.userId}`, { method: 'DELETE', token: s.accessToken, headers: { Prefer: 'return=minimal' } });
}

/** Linhas alteradas depois do cursor (inclui as marcadas como apagadas), da mais antiga para a mais nova. */
export async function changesSince(s: CloudSession, cursor: string | null): Promise<RemoteRow[]> {
  const all: RemoteRow[] = [];
  const filter = cursor ? `&updated_at=gt.${encodeURIComponent(cursor)}` : '';
  for (let offset = 0; ; offset += PAGE) {
    const res = await call(`/rest/v1/vault_records?select=collection,id,iv,payload,deleted,updated_at${filter}&order=updated_at,collection,id&limit=${PAGE}&offset=${offset}`, { token: s.accessToken });
    const page = (await res.json()) as RemoteRow[];
    all.push(...page);
    if (page.length < PAGE) return all;
  }
}

export async function upsertSyncRows(s: CloudSession, rows: Omit<RemoteRow, 'updated_at'>[]): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    const body = rows.slice(i, i + BATCH).map((r) => ({ user_id: s.userId, collection: r.collection, id: r.id, iv: r.iv, payload: r.payload, deleted: r.deleted }));
    await call('/rest/v1/vault_records?on_conflict=user_id,collection,id', { method: 'POST', token: s.accessToken, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(body) });
  }
}
