import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { isNative } from './platform';
import { buildNanoRequest, cleanNanoAnswer, NANO_MAX_OUTPUT } from '../domain/nanoPrompt';

/**
 * Gemini Nano no próprio aparelho (plugin nativo `GeminiNano`, em android/app/src/main/java/.../GeminiNanoPlugin.java).
 * Só funciona no app Android, em celulares com o serviço AICore e o modelo (ex.: Galaxy S25/S26, Pixel 9/10).
 */
interface GeminiNanoPlugin {
  status(): Promise<{ status: string; tokenLimit?: number; systemPrompt?: boolean }>;
  download(): Promise<{ done: boolean }>;
  generate(o: { system: string; prompt: string; systemPrompt: boolean; maxOutputTokens: number }): Promise<{ text: string }>;
  addListener(event: 'downloadProgress', fn: (e: { bytes: number }) => void): Promise<PluginListenerHandle>;
}
const Nano = registerPlugin<GeminiNanoPlugin>('GeminiNano');

export type NanoState = 'disponivel' | 'baixar' | 'baixando' | 'indisponivel' | 'so_android';
export interface NanoStatus {
  state: NanoState;
  tokenLimit: number;
  systemPrompt: boolean;
  message?: string;
}

export const NANO_STATE_LABEL: Record<NanoState, string> = {
  disponivel: 'Pronto para usar',
  baixar: 'Precisa baixar o modelo (alguns minutos; use o Wi-Fi)',
  baixando: 'Baixando o modelo…',
  indisponivel: 'Este celular não tem o Gemini Nano disponível',
  so_android: 'Só funciona no app Android',
};

let cached: NanoStatus | null = null;

export async function nanoStatus(refresh = false): Promise<NanoStatus> {
  if (!isNative()) return { state: 'so_android', tokenLimit: 0, systemPrompt: false };
  if (cached && !refresh) return cached;
  try {
    const s = await Nano.status();
    const state = (['disponivel', 'baixar', 'baixando', 'indisponivel'].includes(s.status) ? s.status : 'indisponivel') as NanoState;
    cached = { state, tokenLimit: s.tokenLimit ?? 0, systemPrompt: !!s.systemPrompt };
  } catch (e) {
    cached = { state: 'indisponivel', tokenLimit: 0, systemPrompt: false, message: e instanceof Error ? e.message : String(e) };
  }
  return cached;
}

/** Pede ao Android para baixar o modelo. `onProgress` recebe os bytes já baixados. */
export async function nanoDownload(onProgress?: (bytes: number) => void): Promise<NanoStatus> {
  const h = onProgress ? await Nano.addListener('downloadProgress', (e) => onProgress(e.bytes)) : null;
  try {
    await Nano.download();
  } finally {
    await h?.remove();
  }
  return nanoStatus(true);
}

/** Pergunta ao Gemini Nano com os dados do app (já resumidos). Lança erro se o modelo não estiver pronto. */
export async function askNano(question: string, ctx: Record<string, unknown>): Promise<{ text: string; dropped: string[] }> {
  const st = await nanoStatus();
  if (st.state !== 'disponivel') throw new Error(NANO_STATE_LABEL[st.state]);
  const req = buildNanoRequest(question, ctx, st.tokenLimit);
  const res = await Nano.generate({ system: req.system, prompt: req.prompt, systemPrompt: st.systemPrompt, maxOutputTokens: NANO_MAX_OUTPUT });
  return { text: cleanNanoAnswer(res.text), dropped: req.dropped };
}
