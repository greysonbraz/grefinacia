import type { AppData, Settings } from '../lib/types';
import type { Overview } from './overview';
import { buildAiContext } from './chat';
import { cashForecast, detectSubscriptions, unusualSpending } from './analysis';

/**
 * Pergunta para o Gemini Nano do aparelho (Etapa 8b). O modelo é pequeno: a janela é de cerca de 4.000 tokens
 * (pergunta + dados + resposta). Por isso vão só totais, já calculados pelo app, e o contexto é cortado por partes
 * até caber. As instruções pedem para usar apenas esses números e dizer quando faltar dado.
 */

export const NANO_SYSTEM =
  'Você é a Grefinacia AI, assistente de finanças pessoais, em português do Brasil. ' +
  'Responda em no máximo 5 frases curtas, usando SOMENTE os números do JSON de dados. ' +
  'Valores estão em reais: escreva sempre no formato R$ 1.234,56. Não invente valores, datas ou nomes. Se a resposta depender de um dado que não está no JSON, diga qual dado falta. ' +
  'Não recomende comprar ou vender investimentos específicos nem fazer dívida. ' +
  'Não dê conselho jurídico, médico ou de investimento profissional.';

/** Estimativa conservadora de tokens para português (cerca de 3 caracteres por token). */
export const approxTokens = (s: string): number => Math.ceil(s.length / 3);

export const NANO_MAX_OUTPUT = 400;
const DEFAULT_LIMIT = 4000;
const SAFETY = 200;

const r = (c: number) => Math.round(c) / 100;

/** Dados do app em forma compacta, com os extras do motor local (previsão, assinaturas, fora do padrão). */
export function nanoContext(o: Overview, data: AppData, settings: Settings): Record<string, unknown> {
  const base = JSON.parse(buildAiContext(o, data, settings)) as Record<string, unknown>;
  const f = cashForecast(data, o.today, 3);
  const subs = detectSubscriptions(data, o.today);
  const unusual = unusualSpending(data, o.today);
  const name = (id: string) => data.categories.find((c) => c.id === id)?.name ?? id;
  return {
    ...base,
    previsaoSaldo: f.months.map((m) => ({ mes: m.ym, entra: r(m.incomeCents), sai: r(m.fixedCents + m.debtCents + m.variableCents), saldoFinal: r(m.endBalanceCents) })),
    assinaturasPorMes: r(subs.reduce((t, s) => t + s.monthlyCents, 0)),
    assinaturas: subs.slice(0, 8).map((s) => ({ nome: s.name.slice(0, 40), valor: r(s.monthlyCents) })),
    foraDoPadrao: unusual.categories.map((c) => ({ categoria: name(c.categoryId), esteMes: r(c.curCents), normal: r(c.typicalCents) })),
  };
}

/** Partes que podem sair, da menos para a mais importante, quando os dados não cabem. */
const DROP_ORDER = ['assinaturas', 'rendaFixa', 'metas', 'carteira', 'dividas', 'foraDoPadrao', 'previsaoSaldo', 'mesAnterior', 'proventosProximoMes'];

export interface NanoRequest {
  system: string;
  prompt: string;
  dropped: string[]; // partes dos dados que ficaram de fora por falta de espaço
  tokens: number;
}

/**
 * Monta a pergunta. Se o modelo não aceitar instruções separadas, o nativo junta tudo antes da pergunta;
 * a conta do espaço já considera as duas partes.
 */
export function buildNanoRequest(question: string, ctx: Record<string, unknown>, tokenLimit = 0): NanoRequest {
  const q = question.trim().slice(0, 500);
  const limit = tokenLimit > 0 ? Math.min(tokenLimit, 8000) : DEFAULT_LIMIT;
  const budget = limit - NANO_MAX_OUTPUT - SAFETY - approxTokens(NANO_SYSTEM) - approxTokens(q) - 40;
  const data: Record<string, unknown> = { ...ctx };
  const dropped: string[] = [];
  const text = () => JSON.stringify(data);
  for (const k of DROP_ORDER) {
    if (approxTokens(text()) <= budget) break;
    if (k in data) {
      delete data[k];
      dropped.push(k);
    }
  }
  // último recurso: corta listas longas restantes
  for (const [k, v] of Object.entries(data)) if (approxTokens(text()) > budget && Array.isArray(v) && v.length > 3) data[k] = v.slice(0, 3);
  const prompt = `Dados (JSON):\n${text()}\n\nPergunta: ${q}`;
  return { system: NANO_SYSTEM, prompt, dropped, tokens: approxTokens(NANO_SYSTEM) + approxTokens(prompt) };
}

/** Limpa a resposta do modelo: tira marcações de markdown que a conversa não mostra e limita o tamanho. */
export function cleanNanoAnswer(text: string): string {
  return formatNanoMoney(text)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 1500);
}

/** O modelo às vezes escreve "5448.14" ou "R$ 3.77": vira "R$ 5.448,14" e "R$ 3,77" (só números com 2 casas, não porcentagens). */
export function formatNanoMoney(text: string): string {
  return text.replace(/(R\$\s*)?(?<![\d.,/])(\d{1,9})\.(\d{2})(?![\d%]|\.\d)/g, (_m, _rs, i: string, d: string) => {
    const n = Number(i) + Number(d) / 100;
    return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  });
}
