import { App } from '@capacitor/app';
import { BiometricAuth, BiometryError, BiometryErrorType } from '@aparajita/capacitor-biometric-auth';
import { PrivacyScreen } from '@capacitor-community/privacy-screen';
import type { Settings } from '../lib/types';
import { isNative } from './platform';

const ITERATIONS = 210_000;
const enc = new TextEncoder();

const b64 = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pbkdf2Bits(secret: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

/** Gera o hash (PBKDF2-SHA256 com sal aleatório) de uma senha/PIN. Nunca guardamos a senha em si. */
export async function createCredential(secret: string): Promise<{ salt: string; hash: string; iterations: number }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: b64(salt), hash: b64(await pbkdf2Bits(secret, salt, ITERATIONS)), iterations: ITERATIONS };
}

export async function verifyCredential(security: Settings['security'], secret: string): Promise<boolean> {
  if (!security.salt || !security.hash) return false;
  const got = new Uint8Array(await pbkdf2Bits(secret, unb64(security.salt), security.iterations ?? ITERATIONS));
  const want = unb64(security.hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

// ---- limitação de tentativas (contra adivinhação de PIN) ----
const FAIL_KEY = 'mf_fail';
interface Fail {
  count: number;
  until: number;
}
function readFail(): Fail {
  try {
    return JSON.parse(localStorage.getItem(FAIL_KEY) ?? '') as Fail;
  } catch {
    return { count: 0, until: 0 };
  }
}
export function lockoutRemainingMs(now = Date.now()): number {
  return Math.max(readFail().until - now, 0);
}
export function registerFailure(now = Date.now()): number {
  const f = readFail();
  const count = f.count + 1;
  // 5 erros liberam; a partir do 5º, espera de 30 s dobrando a cada novo erro (máx. 15 min)
  const wait = count >= 5 ? Math.min(30_000 * 2 ** (count - 5), 900_000) : 0;
  try {
    localStorage.setItem(FAIL_KEY, JSON.stringify({ count, until: now + wait }));
  } catch {
    /* ignora */
  }
  return wait;
}
export function clearFailures(): void {
  try {
    localStorage.removeItem(FAIL_KEY);
  } catch {
    /* ignora */
  }
}

// ---- biometria ----
export async function biometricAvailable(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    return (await BiometricAuth.checkBiometry()).isAvailable;
  } catch {
    return false;
  }
}

export async function biometricUnlock(): Promise<'ok' | 'cancelled' | 'failed'> {
  try {
    await BiometricAuth.authenticate({ reason: 'Desbloquear o Grefinacia', cancelTitle: 'Usar senha', allowDeviceCredential: false, androidTitle: 'Grefinacia', androidSubtitle: 'Confirme sua identidade' });
    return 'ok';
  } catch (e) {
    if (e instanceof BiometryError && [BiometryErrorType.userCancel, BiometryErrorType.appCancel, BiometryErrorType.systemCancel, BiometryErrorType.userFallback].includes(e.code)) return 'cancelled';
    return 'failed';
  }
}

/** Impede capturas de tela e esconde o conteúdo na lista de apps recentes (FLAG_SECURE). */
export async function setPrivacyScreen(on: boolean): Promise<void> {
  if (!isNative()) return;
  try {
    if (on) await PrivacyScreen.enable();
    else await PrivacyScreen.disable();
  } catch {
    /* plugin indisponível */
  }
}

/** Chama `onLock` quando o app volta do segundo plano depois do tempo configurado. */
export function watchAutoLock(getSeconds: () => number, onLock: () => void): () => void {
  let hiddenAt: number | null = null;
  const away = () => {
    if (hiddenAt === null) hiddenAt = Date.now();
  };
  const back = () => {
    if (hiddenAt !== null && (Date.now() - hiddenAt) / 1000 >= getSeconds()) onLock();
    hiddenAt = null;
  };
  const vis = () => (document.visibilityState === 'hidden' ? away() : back());
  document.addEventListener('visibilitychange', vis);
  let handle: { remove: () => Promise<void> } | undefined;
  if (isNative()) {
    void App.addListener('appStateChange', (s) => (s.isActive ? back() : away())).then((h) => (handle = h));
  }
  return () => {
    document.removeEventListener('visibilitychange', vis);
    void handle?.remove();
  };
}
