import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import type { Settings } from '../lib/types';
import { isNative } from './platform';

/**
 * Segredos do usuário: token da brapi e chave de IA.
 *
 * No Android eles ficam no cofre do sistema (cifrados com uma chave do Android Keystore), fora do banco
 * do app. No navegador (desenvolvimento) não existe cofre, então continuam no banco local, como antes.
 * Se o cofre falhar por qualquer motivo, o valor também fica no banco: é melhor do que perder o token.
 */
export interface Secrets {
  brapiToken: string;
  aiApiKey: string;
}

export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const KEYS: Record<keyof Secrets, string> = { brapiToken: 'brapi_token', aiApiKey: 'ai_api_key' };

const nativeStore: SecretStore = {
  get: (k) => SecureStorage.getItem(k),
  set: (k, v) => SecureStorage.setItem(k, v),
  remove: (k) => SecureStorage.removeItem(k),
};

let override: SecretStore | null | undefined; // usado nos testes
const getStore = (): SecretStore | null => (override !== undefined ? override : isNative() ? nativeStore : null);

/** Troca o cofre (testes). `undefined` volta ao padrão da plataforma. */
export function setSecretStoreForTests(store: SecretStore | null | undefined): void {
  override = store;
  lastSaved = null;
}

export const extractSecrets = (s: Settings): Secrets => ({ brapiToken: s.api.brapiToken, aiApiKey: s.ai.apiKey });

export const withoutSecrets = (s: Settings): Settings => ({ ...s, api: { ...s.api, brapiToken: '' }, ai: { ...s.ai, apiKey: '' } });

export const withSecrets = (s: Settings, x: Partial<Secrets>): Settings => ({
  ...s,
  api: { ...s.api, brapiToken: x.brapiToken ?? s.api.brapiToken },
  ai: { ...s.ai, apiKey: x.aiApiKey ?? s.ai.apiKey },
});

let lastSaved: Secrets | null = null;

/** Grava os segredos no cofre. Devolve `false` se não há cofre ou se a gravação falhou. */
async function saveSecrets(x: Secrets): Promise<boolean> {
  const store = getStore();
  if (!store) return false;
  if (lastSaved && lastSaved.brapiToken === x.brapiToken && lastSaved.aiApiKey === x.aiApiKey) return true;
  try {
    for (const name of Object.keys(KEYS) as (keyof Secrets)[]) {
      if (x[name]) await store.set(KEYS[name], x[name]);
      else await store.remove(KEYS[name]);
    }
    lastSaved = { ...x };
    return true;
  } catch {
    lastSaved = null;
    return false;
  }
}

/**
 * Prepara as configurações para gravar no banco: manda os segredos para o cofre e devolve a versão sem eles.
 * Se o cofre não estiver disponível, devolve as configurações como estão (segredos seguem no banco).
 */
export async function settingsForDb(settings: Settings): Promise<Settings> {
  return (await saveSecrets(extractSecrets(settings))) ? withoutSecrets(settings) : settings;
}

/**
 * Devolve as configurações com os segredos em memória, lendo do cofre.
 * `migrated` indica que havia segredo no banco e ele precisa ser regravado (para sair do banco e ir para o cofre).
 */
export async function hydrateSecrets(fromDb: Settings): Promise<{ settings: Settings; migrated: boolean }> {
  const store = getStore();
  if (!store) return { settings: fromDb, migrated: false };
  const inDb = extractSecrets(fromDb);
  let vault: Partial<Secrets> = {};
  try {
    vault = { brapiToken: (await store.get(KEYS.brapiToken)) ?? '', aiApiKey: (await store.get(KEYS.aiApiKey)) ?? '' };
  } catch {
    return { settings: fromDb, migrated: false };
  }
  // o que está no banco é mais recente (instalação antiga ou cofre que falhou ao gravar); senão vale o cofre
  const merged: Secrets = { brapiToken: inDb.brapiToken || vault.brapiToken || '', aiApiKey: inDb.aiApiKey || vault.aiApiKey || '' };
  return { settings: withSecrets(fromDb, merged), migrated: Boolean(inDb.brapiToken || inDb.aiApiKey) };
}

/** Apaga os segredos do cofre (usado em "Apagar todos os meus dados"). */
export async function clearSecrets(): Promise<void> {
  lastSaved = null;
  const store = getStore();
  if (!store) return;
  try {
    for (const k of Object.values(KEYS)) await store.remove(k);
  } catch {
    /* cofre indisponível: nada a apagar */
  }
}
