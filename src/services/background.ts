import { BackgroundRunner } from '@capacitor/background-runner';
import type { AppData, Settings } from '../lib/types';
import { computePositions } from '../domain/portfolio';
import { isNative } from './platform';
import { brapiDividendsAvailable } from './quotes';

export const RUNNER_LABEL = 'br.com.grefinacia.proventos';

/** Muda quando o formato ou as regras da configuração mudam; o runner ignora versões diferentes da dele. */
export const RUNNER_CONFIG_VERSION = 2;

export interface RunnerConfig {
  v: number;
  enabled: boolean;
  provider: Settings['api']['dividendProvider'];
  token: string;
  assets: { ticker: string; type: string; qty: number }[];
  knownKeys: string[];
}

/**
 * Monta o que o "runner" (script que o Android executa periodicamente com o app fechado) precisa saber.
 * Só entram ativos que a fonte escolhida consegue responder: no plano gratuito da brapi não há proventos,
 * então a verificação fica desligada em vez de gastar a cota mensal. O token só é entregue quando é necessário.
 */
export function buildRunnerConfig(data: AppData, settings: Settings): RunnerConfig {
  const { api, notifications } = settings;
  const provider = api.dividendProvider;
  const held = computePositions(data.assets, data.operations).filter((p) => p.quantity > 0);
  const watch = provider === 'manual' ? [] : held.filter((p) => provider === 'yahoo' || brapiDividendsAvailable(p.asset.ticker, api));
  const needsToken = provider === 'brapi' && api.brapiPlan !== 'free';
  return {
    v: RUNNER_CONFIG_VERSION,
    enabled: notifications.enabled && notifications.types.dividendAnnounced && watch.length > 0,
    provider,
    token: needsToken ? api.brapiToken.trim() : '',
    assets: watch.map((p) => ({ ticker: p.asset.ticker, type: p.asset.type, qty: p.quantity })),
    knownKeys: data.dividends.map((d) => d.key),
  };
}

/** Entrega a configuração ao runner, para ele avisar de novos anúncios sem repetir notificações. */
export async function syncRunnerConfig(data: AppData, settings: Settings): Promise<void> {
  if (!isNative()) return;
  try {
    await BackgroundRunner.dispatchEvent({ label: RUNNER_LABEL, event: 'saveConfig', details: { config: JSON.stringify(buildRunnerConfig(data, settings)) } });
  } catch {
    /* o Android pode negar a execução em segundo plano; o app continua funcionando normalmente */
  }
}
