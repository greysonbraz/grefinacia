import type { Settings } from '../lib/types';
import { AI_SYSTEM_PROMPT } from '../domain/chat';

/**
 * Chamada opcional a um serviço de IA (API da Anthropic) com a chave do próprio usuário.
 * Só é usada com consentimento explícito; envia apenas o resumo agregado montado em buildAiContext.
 */
export async function askAi(question: string, context: string, ai: Settings['ai'], history: { role: 'user' | 'assistant'; content: string }[]): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': ai.apiKey.trim(), 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: ai.model, max_tokens: 900, system: `${AI_SYSTEM_PROMPT}\n\nDados do usuário (JSON, valores em reais):\n${context}`, messages: [...history.slice(-8), { role: 'user', content: question }] }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(res.status === 401 ? 'Chave de API inválida.' : json?.error?.message ?? `Erro ${res.status} no serviço de IA.`);
  const text = Array.isArray(json?.content) ? json.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n') : '';
  if (!text) throw new Error('O serviço de IA não retornou resposta.');
  return text;
}
