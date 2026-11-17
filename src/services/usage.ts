import type { Settings, YearMonth } from '../lib/types';
import { monthOf, todayISO } from '../lib/dates';

/**
 * Contador de consultas às fontes gratuitas, por mês, neste aparelho.
 *
 * A brapi gratuita permite 15.000 consultas por mês (conferido em brapi.dev/pricing em 16/11/2026).
 * O app conta as consultas que ele mesmo faz; outro aparelho com o mesmo token e a verificação de proventos
 * em segundo plano não entram na conta, então o número real pode ser um pouco maior, nunca menor.
 */
export type UsageProvider = 'brapi' | 'yahoo' | 'coingecko' | 'bcb' | 'pluggy';
export interface Usage {
  month: YearMonth;
  counts: Record<UsageProvider, number>;
}

export const BRAPI_MONTHLY_LIMIT: Record<Settings['api']['brapiPlan'], number> = { free: 15000, startup: 150000, pro: 500000 };
/** Margem guardada para o fim do mês: acima disso o app só consulta quando você pede. */
export const BRAPI_RESERVE = 0.1;

const empty = (month: YearMonth): Usage => ({ month, counts: { brapi: 0, yahoo: 0, coingecko: 0, bcb: 0, pluggy: 0 } });

let usage: Usage = empty(monthOf(todayISO()));
let persist: ((u: Usage) => void) | null = null;

/** Carrega o que estava salvo e define como salvar. Um mês novo começa do zero. */
export function initUsage(saved: Usage | undefined, save: (u: Usage) => void): void {
  const month = monthOf(todayISO());
  usage = saved && saved.month === month && saved.counts ? { month, counts: { ...empty(month).counts, ...saved.counts } } : empty(month);
  persist = save;
}

export function getUsage(): Usage {
  const month = monthOf(todayISO());
  if (usage.month !== month) usage = empty(month);
  return usage;
}

export function countRequest(p: UsageProvider, n = 1): void {
  const u = getUsage();
  usage = { month: u.month, counts: { ...u.counts, [p]: u.counts[p] + n } };
  persist?.(usage);
}

export interface BrapiQuota {
  used: number;
  limit: number;
  left: number;
  pct: number;
  /** Passou do limite do plano: o app não consulta mais a brapi até o mês virar. */
  exhausted: boolean;
  /** Entrou na reserva final: buscas automáticas param, as pedidas por você continuam. */
  low: boolean;
}
export function brapiQuota(plan: Settings['api']['brapiPlan'], u: Usage = getUsage()): BrapiQuota {
  const limit = BRAPI_MONTHLY_LIMIT[plan] ?? BRAPI_MONTHLY_LIMIT.free;
  const used = u.counts.brapi;
  return { used, limit, left: Math.max(limit - used, 0), pct: (used / limit) * 100, exhausted: used >= limit, low: used >= limit * (1 - BRAPI_RESERVE) };
}
