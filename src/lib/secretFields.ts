import type { Settings } from './types';

/**
 * Segredos do usuário que vivem dentro das configurações em memória: token da brapi, chave de IA e as credenciais
 * da Pluggy (Client ID e Client Secret). Nunca vão para o banco local, a nuvem, o backup nem as cópias de segurança.
 */
export interface Secrets {
  brapiToken: string;
  aiApiKey: string;
  pluggyClientId: string;
  pluggyClientSecret: string;
}
type WithSecrets = Pick<Settings, 'api' | 'ai'> & Partial<Pick<Settings, 'bank'>>;

export const extractSecrets = (s: WithSecrets): Secrets => ({ brapiToken: s.api.brapiToken, aiApiKey: s.ai.apiKey, pluggyClientId: s.bank?.clientId ?? '', pluggyClientSecret: s.bank?.clientSecret ?? '' });

/** Cópia das configurações sem os segredos (é o que pode ir para o banco local e para as cópias de segurança). */
export const withoutSecrets = <T extends WithSecrets>(s: T): T => ({ ...s, api: { ...s.api, brapiToken: '' }, ai: { ...s.ai, apiKey: '' }, ...(s.bank ? { bank: { ...s.bank, clientId: '', clientSecret: '' } } : {}) });

export const withSecrets = <T extends WithSecrets>(s: T, x: Partial<Secrets>): T => ({
  ...s,
  api: { ...s.api, brapiToken: x.brapiToken ?? s.api.brapiToken },
  ai: { ...s.ai, apiKey: x.aiApiKey ?? s.ai.apiKey },
  ...(s.bank ? { bank: { ...s.bank, clientId: x.pluggyClientId ?? s.bank.clientId, clientSecret: x.pluggyClientSecret ?? s.bank.clientSecret } } : {}),
});
