import { BackgroundRunner } from '@capacitor/background-runner';
import type { AppData, Settings } from '../lib/types';
import { computePositions } from '../domain/portfolio';
import { isNative } from './platform';

export const RUNNER_LABEL = 'br.com.grefinacia.proventos';

/**
 * Entrega ao "runner" (script que o Android executa periodicamente com o app fechado) a lista de ativos,
 * o token e os proventos já conhecidos, para ele avisar de novos anúncios sem repetir notificações.
 */
export async function syncRunnerConfig(data: AppData, settings: Settings): Promise<void> {
  if (!isNative()) return;
  const held = computePositions(data.assets, data.operations).filter((p) => p.quantity > 0);
  const config = {
    enabled: settings.notifications.enabled && settings.notifications.types.dividendAnnounced && settings.api.dividendProvider !== 'manual' && held.length > 0,
    provider: settings.api.dividendProvider,
    token: settings.api.brapiToken,
    assets: held.map((p) => ({ ticker: p.asset.ticker, type: p.asset.type, qty: p.quantity })),
    knownKeys: data.dividends.map((d) => d.key),
  };
  try {
    await BackgroundRunner.dispatchEvent({ label: RUNNER_LABEL, event: 'saveConfig', details: { config: JSON.stringify(config) } });
  } catch {
    /* o Android pode negar a execução em segundo plano; o app continua funcionando normalmente */
  }
}
