import { PAID_AI_ENABLED } from './flags.ts';
import { SUPABASE_URL } from './cloudConfig.ts';

/** Sites dos feeds de notícias (ver src/domain/news.ts). Um teste garante que as duas listas batem. */
export const NEWS_HOSTS: string[] = [
  'https://agenciabrasil.ebc.com.br',
  'https://g1.globo.com',
  'https://www.infomoney.com.br',
  'https://www.moneytimes.com.br',
  'https://www.suno.com.br',
  'https://investnews.com.br',
  'https://www.seudinheiro.com',
  'https://portaldobitcoin.uol.com.br',
  'https://livecoins.com.br',
  'https://www.bcb.gov.br',
];

/** Endereços com que o app pode falar. Qualquer fonte nova precisa entrar aqui de propósito. */
export const ALLOWED_HOSTS: string[] = [
  'https://brapi.dev', // cotações
  'https://query1.finance.yahoo.com', // cotações e proventos (não oficial)
  SUPABASE_URL, // nuvem: login e cópia cifrada dos dados
  ...NEWS_HOSTS, // notícias (feeds públicos)
  ...(PAID_AI_ENABLED ? ['https://api.anthropic.com'] : []),
];

/**
 * Content-Security-Policy do app compilado.
 *
 * - scripts: só os arquivos do próprio app (nada embutido na página, nada de fora, sem eval);
 * - estilos: os do app e os atributos `style` que o React escreve;
 * - conexões: só as fontes de dados acima;
 * - nada de plugins, frames ou formulários para fora.
 *
 * No Android a ponte nativa do Capacitor é injetada pelo sistema (addDocumentStartJavaScript) e não depende
 * desta política; as chamadas de rede passam pela camada nativa, então aqui a regra que mais protege é a de scripts.
 */
export function buildCsp(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${ALLOWED_HOSTS.join(' ')}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}
