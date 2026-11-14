/**
 * Cofre da nuvem: criptografia ponta a ponta dos dados antes de saírem do aparelho.
 *
 * - Uma "chave de dados" aleatória (AES-256-GCM) cifra cada registro.
 * - Essa chave é guardada na nuvem embrulhada por uma chave derivada da senha de sincronização
 *   (PBKDF2-SHA256). O servidor nunca vê a senha nem a chave: só texto cifrado.
 * - Cada registro é amarrado ao seu dono, coleção e id (dados associados do GCM): um registro
 *   cifrado copiado para outro lugar não abre.
 * - Trocar a senha só reembrulha a chave; os registros não precisam ser cifrados de novo.
 *
 * Se a senha for esquecida, a cópia da nuvem não pode ser aberta. Os dados do aparelho não dependem dela.
 */
const enc = new TextEncoder();
const dec = new TextDecoder();

export const VAULT_ITERATIONS = 600_000;
const MIN_ITER = 100_000;
const MAX_ITER = 5_000_000;
export const MIN_PASSPHRASE = 10;

export class VaultError extends Error {}

/** O que fica guardado na nuvem para reabrir o cofre em outro aparelho. Nada aqui é segredo sem a senha. */
export interface VaultMeta {
  v: 1;
  kdf: 'PBKDF2-SHA256';
  iter: number;
  salt: string;
  iv: string;
  wrapped: string; // chave de dados cifrada com a chave derivada da senha
}

export interface RecordRef {
  userId: string;
  collection: string;
  id: string;
}
export interface SealedRecord {
  iv: string;
  payload: string;
}

const b64 = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function wrappingKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iter: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

const importDataKey = (raw: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<CryptoKey> => crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);

async function wrap(dataKey: CryptoKey, passphrase: string, iter: number): Promise<VaultMeta> {
  if (passphrase.length < MIN_PASSPHRASE) throw new VaultError(`A senha de sincronização precisa ter pelo menos ${MIN_PASSPHRASE} caracteres.`);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const kek = await wrappingKey(passphrase, salt, iter);
  const raw = await crypto.subtle.exportKey('raw', dataKey);
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, raw);
  return { v: 1, kdf: 'PBKDF2-SHA256', iter, salt: b64(salt), iv: b64(iv), wrapped: b64(wrapped) };
}

/** Cria um cofre novo: gera a chave de dados e a embrulha com a senha. */
export async function createVault(passphrase: string, iter = VAULT_ITERATIONS): Promise<{ meta: VaultMeta; key: CryptoKey }> {
  const key = await importDataKey(crypto.getRandomValues(new Uint8Array(32)));
  return { meta: await wrap(key, passphrase, iter), key };
}

/** Abre um cofre existente com a senha. Senha errada ou dados alterados: falha. */
export async function unlockVault(meta: VaultMeta, passphrase: string): Promise<CryptoKey> {
  if (!meta || meta.v !== 1 || meta.kdf !== 'PBKDF2-SHA256' || typeof meta.salt !== 'string' || typeof meta.iv !== 'string' || typeof meta.wrapped !== 'string') throw new VaultError('Cofre da nuvem em formato desconhecido. Atualize o app.');
  if (!Number.isInteger(meta.iter) || meta.iter < MIN_ITER || meta.iter > MAX_ITER) throw new VaultError('Cofre da nuvem em formato desconhecido. Atualize o app.');
  try {
    const kek = await wrappingKey(passphrase, unb64(meta.salt), meta.iter);
    return await importDataKey(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(meta.iv) }, kek, unb64(meta.wrapped)));
  } catch {
    throw new VaultError('Senha de sincronização incorreta.');
  }
}

/** Troca a senha sem recifrar os registros. */
export async function changePassphrase(meta: VaultMeta, oldPassphrase: string, newPassphrase: string, iter = VAULT_ITERATIONS): Promise<VaultMeta> {
  return wrap(await unlockVault(meta, oldPassphrase), newPassphrase, iter);
}

const aad = (r: RecordRef): Uint8Array<ArrayBuffer> => enc.encode(JSON.stringify([r.userId, r.collection, r.id]));

export async function sealRecord(key: CryptoKey, ref: RecordRef, value: unknown): Promise<SealedRecord> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(ref) }, key, enc.encode(JSON.stringify(value)));
  return { iv: b64(iv), payload: b64(cipher) };
}

export async function openRecord<T = unknown>(key: CryptoKey, ref: RecordRef, sealed: SealedRecord): Promise<T> {
  try {
    return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(sealed.iv), additionalData: aad(ref) }, key, unb64(sealed.payload)))) as T;
  } catch {
    throw new VaultError(`Registro da nuvem ilegível (${ref.collection}/${ref.id}): foi alterado ou pertence a outro cofre.`);
  }
}
