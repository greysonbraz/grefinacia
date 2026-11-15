import type { Settings } from './types';

/** Segredos do usuário que vivem dentro das configurações em memória: token da brapi e chave de IA. */
export interface Secrets {
  brapiToken: string;
  aiApiKey: string;
}

export const extractSecrets = (s: Pick<Settings, 'api' | 'ai'>): Secrets => ({ brapiToken: s.api.brapiToken, aiApiKey: s.ai.apiKey });

/** Cópia das configurações sem os segredos (é o que pode ir para o banco local e para as cópias de segurança). */
export const withoutSecrets = <T extends Pick<Settings, 'api' | 'ai'>>(s: T): T => ({ ...s, api: { ...s.api, brapiToken: '' }, ai: { ...s.ai, apiKey: '' } });

export const withSecrets = <T extends Pick<Settings, 'api' | 'ai'>>(s: T, x: Partial<Secrets>): T => ({
  ...s,
  api: { ...s.api, brapiToken: x.brapiToken ?? s.api.brapiToken },
  ai: { ...s.ai, apiKey: x.aiApiKey ?? s.ai.apiKey },
});
