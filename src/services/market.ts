import type { HistoryPoint, ISODate, Settings } from '../lib/types';
import { addDays, addMonths, todayISO } from '../lib/dates';
import { bcbDate, localDate, toBcbDate } from '../domain/market';
import { authHeader, BRAPI_FREE_TICKERS, explain, getJson, takeBrapiRequest, type FetchError } from './quotes';
import { countRequest } from './usage';

type Api = Settings['api'];
const toCents = (n: number) => Math.round(n * 100 + 1e-9);

// ============================ BOLSA: HISTÓRICO DE PREÇOS ============================

/**
 * Quanto histórico cada plano da brapi entrega (brapi.dev/pricing, conferido em 16/11/2026):
 * gratuito até 3 meses, Startup até 1 ano, Pro mais de 10 anos. O Yahoo (não oficial) entrega 1 ano aqui.
 */
export const BRAPI_HISTORY_RANGE: Record<Api['brapiPlan'], string> = { free: '3mo', startup: '1y', pro: '5y' };

/** brapi: results[0].historicalDataPrice[] com date (segundos Unix) e close (reais). */
export function parseBrapiHistory(json: any): HistoryPoint[] {
  const list = json?.results?.[0]?.historicalDataPrice;
  if (!Array.isArray(list)) return [];
  const out: HistoryPoint[] = [];
  for (const p of list) if (typeof p?.date === 'number' && typeof p?.close === 'number' && p.close > 0) out.push([localDate(p.date), toCents(p.close)]);
  return out;
}

/** Yahoo: chart.result[0].timestamp[] e indicators.quote[0].close[] (pode ter buracos). */
export function parseYahooHistory(json: any): HistoryPoint[] {
  const r = json?.chart?.result?.[0];
  const ts: unknown[] = r?.timestamp ?? [];
  const close: unknown[] = r?.indicators?.quote?.[0]?.close ?? [];
  const out: HistoryPoint[] = [];
  ts.forEach((t, i) => {
    const c = close[i];
    if (typeof t === 'number' && typeof c === 'number' && c > 0) out.push([localDate(t), toCents(c)]);
  });
  return out;
}

export async function fetchB3History(ticker: string, api: Api): Promise<{ points: HistoryPoint[]; source: string } | FetchError> {
  const t = ticker.toUpperCase();
  try {
    if (api.quoteProvider === 'yahoo') {
      countRequest('yahoo');
      const { status, json } = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${t}.SA?range=1y&interval=1d`);
      const points = parseYahooHistory(json);
      if (!points.length) return { ticker: t, message: `Yahoo Finance: histórico não encontrado (HTTP ${status}).` };
      return { points, source: 'Yahoo Finance (não oficial)' };
    }
    if (api.quoteProvider !== 'brapi') return { ticker: t, message: 'Cotação automática desligada: sem histórico de preços.' };
    if (!api.brapiToken.trim() && !BRAPI_FREE_TICKERS.includes(t)) return { ticker: t, message: 'brapi: sem token não há histórico deste ativo. Crie um token gratuito em brapi.dev.' };
    const blocked = takeBrapiRequest(api);
    if (blocked) return { ticker: t, message: blocked };
    const { status, json } = await getJson(`https://brapi.dev/api/quote/${t}?range=${BRAPI_HISTORY_RANGE[api.brapiPlan] ?? '3mo'}&interval=1d`, authHeader(api));
    const points = parseBrapiHistory(json);
    if (status !== 200 || !points.length) return { ticker: t, message: status === 200 ? 'brapi: histórico vazio.' : `brapi: histórico indisponível (HTTP ${status}).` };
    return { points, source: 'brapi.dev' };
  } catch (e) {
    return { ticker: t, message: explain(e) };
  }
}

// ============================ CRIPTO (CoinGecko, API pública sem chave) ============================

const CG = 'https://api.coingecko.com/api/v3';
/** A API pública (sem chave) da CoinGecko entrega no máximo 365 dias de histórico. */
export const CG_HISTORY_DAYS = 365;

/** Moedas mais comuns, para escolher sem precisar buscar. O id é o da CoinGecko (conferidos em 16/11/2026). */
export const POPULAR_COINS: { coinId: string; symbol: string; name: string }[] = [
  { coinId: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
  { coinId: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
  { coinId: 'solana', symbol: 'SOL', name: 'Solana' },
  { coinId: 'ripple', symbol: 'XRP', name: 'XRP' },
  { coinId: 'binancecoin', symbol: 'BNB', name: 'BNB' },
  { coinId: 'tether', symbol: 'USDT', name: 'Tether (dólar digital)' },
  { coinId: 'usd-coin', symbol: 'USDC', name: 'USD Coin (dólar digital)' },
  { coinId: 'cardano', symbol: 'ADA', name: 'Cardano' },
  { coinId: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin' },
  { coinId: 'tron', symbol: 'TRX', name: 'TRON' },
  { coinId: 'chainlink', symbol: 'LINK', name: 'Chainlink' },
  { coinId: 'polkadot', symbol: 'DOT', name: 'Polkadot' },
  { coinId: 'litecoin', symbol: 'LTC', name: 'Litecoin' },
  { coinId: 'avalanche-2', symbol: 'AVAX', name: 'Avalanche' },
  { coinId: 'stellar', symbol: 'XLM', name: 'Stellar' },
  { coinId: 'shiba-inu', symbol: 'SHIB', name: 'Shiba Inu' },
];

const cgMessage = (status: number): string => (status === 429 ? 'CoinGecko: muitas consultas seguidas. Espere um minuto e tente de novo.' : `CoinGecko: erro ${status}.`);

export interface CryptoQuote {
  coinId: string;
  priceCents: number;
  changePct?: number;
  time: string;
}

/** { bitcoin: { brl: 375473, brl_24h_change: 2.1, last_updated_at: 1794850221 } } */
export function parseCgPrices(json: any): CryptoQuote[] {
  if (!json || typeof json !== 'object') return [];
  const out: CryptoQuote[] = [];
  for (const [coinId, v] of Object.entries<any>(json)) {
    if (typeof v?.brl !== 'number' || v.brl <= 0) continue;
    out.push({ coinId, priceCents: toCents(v.brl), changePct: typeof v.brl_24h_change === 'number' ? v.brl_24h_change : undefined, time: typeof v.last_updated_at === 'number' ? new Date(v.last_updated_at * 1000).toISOString() : new Date().toISOString() });
  }
  return out;
}

export async function fetchCryptoQuotes(coinIds: string[]): Promise<{ quotes: CryptoQuote[]; errors: FetchError[] }> {
  const ids = [...new Set(coinIds)];
  if (!ids.length) return { quotes: [], errors: [] };
  try {
    countRequest('coingecko');
    const { status, json } = await getJson(`${CG}/simple/price?ids=${ids.map(encodeURIComponent).join(',')}&vs_currencies=brl&include_24hr_change=true&include_last_updated_at=true`);
    if (status !== 200) return { quotes: [], errors: ids.map((ticker) => ({ ticker, message: cgMessage(status) })) };
    const quotes = parseCgPrices(json);
    const errors = ids.filter((id) => !quotes.some((q) => q.coinId === id)).map((ticker) => ({ ticker, message: 'CoinGecko: moeda sem preço em reais.' }));
    return { quotes, errors };
  } catch (e) {
    return { quotes: [], errors: ids.map((ticker) => ({ ticker, message: 'CoinGecko: ' + explain(e) })) };
  }
}

/** { prices: [[ms, preço], ...] }. Pode trazer 2 pontos no mesmo dia (o último é o preço atual): fica o último. */
export function parseCgHistory(json: any): HistoryPoint[] {
  const list = json?.prices;
  if (!Array.isArray(list)) return [];
  const map = new Map<ISODate, number>();
  for (const p of list) if (Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number' && p[1] > 0) map.set(localDate(p[0]), toCents(p[1]));
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export async function fetchCryptoHistory(coinId: string): Promise<{ points: HistoryPoint[]; source: string } | FetchError> {
  try {
    countRequest('coingecko');
    const { status, json } = await getJson(`${CG}/coins/${encodeURIComponent(coinId)}/market_chart?vs_currency=brl&days=${CG_HISTORY_DAYS}&interval=daily`);
    const points = parseCgHistory(json);
    if (status !== 200 || !points.length) return { ticker: coinId, message: status === 200 ? 'CoinGecko: histórico vazio.' : cgMessage(status) };
    return { points, source: 'CoinGecko' };
  } catch (e) {
    return { ticker: coinId, message: 'CoinGecko: ' + explain(e) };
  }
}

export interface CoinHit {
  coinId: string;
  symbol: string;
  name: string;
  rank?: number;
}
export function parseCgSearch(json: any): CoinHit[] {
  const list = json?.coins;
  if (!Array.isArray(list)) return [];
  // as maiores moedas primeiro (a busca da CoinGecko mistura tokens pequenos com o nome parecido)
  return list
    .filter((c: any) => typeof c?.id === 'string' && typeof c?.symbol === 'string')
    .map((c: any) => ({ coinId: c.id, symbol: String(c.symbol).toUpperCase(), name: String(c.name ?? c.id), rank: typeof c.market_cap_rank === 'number' ? c.market_cap_rank : undefined }))
    .sort((a: CoinHit, b: CoinHit) => (a.rank ?? Infinity) - (b.rank ?? Infinity))
    .slice(0, 12);
}

export async function searchCoins(query: string): Promise<CoinHit[] | FetchError> {
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    countRequest('coingecko');
    const { status, json } = await getJson(`${CG}/search?query=${encodeURIComponent(q)}`);
    if (status !== 200) return { ticker: q, message: cgMessage(status) };
    return parseCgSearch(json);
  } catch (e) {
    return { ticker: q, message: 'CoinGecko: ' + explain(e) };
  }
}

// ============================ ÍNDICES (Banco Central, SGS) ============================

/** Séries do Sistema Gerenciador de Séries Temporais do Banco Central (dados abertos, sem chave). */
export const BCB_SERIES = {
  CDI: { code: 12, label: 'CDI', note: '% ao dia, dias úteis' },
  IPCA: { code: 433, label: 'IPCA', note: '% no mês' },
  USD: { code: 1, label: 'Dólar (PTAX venda)', note: 'reais por dólar, dias úteis' },
  SELIC: { code: 432, label: 'Selic (meta)', note: '% ao ano' },
  IPCA12: { code: 13522, label: 'IPCA em 12 meses', note: '% acumulado' },
  CDIA: { code: 4389, label: 'CDI', note: '% ao ano' },
} as const;
export type IndexName = keyof typeof BCB_SERIES;

/** [{ data: "12/11/2026", valor: "0.050788" }] */
export function parseBcb(json: any): HistoryPoint[] {
  if (!Array.isArray(json)) return [];
  const out: HistoryPoint[] = [];
  for (const r of json) {
    const d = typeof r?.data === 'string' ? bcbDate(r.data) : null;
    const v = Number(String(r?.valor ?? '').replace(',', '.'));
    if (d && Number.isFinite(v)) out.push([d, v]);
  }
  return out;
}

/**
 * Busca uma série do Banco Central entre duas datas. Séries diárias aceitam no máximo 10 anos por consulta,
 * então o período é dividido em pedaços de até 5 anos.
 */
export async function fetchBcbSeries(name: IndexName, from: ISODate, to: ISODate = todayISO()): Promise<{ points: HistoryPoint[]; source: string } | FetchError> {
  const { code } = BCB_SERIES[name];
  const points: HistoryPoint[] = [];
  try {
    for (let a = from; a <= to; a = addDays(addMonths(a, 60), 1)) {
      const bEnd = addMonths(a, 60);
      const b = bEnd < to ? bEnd : to;
      countRequest('bcb');
      const { status, json } = await getJson(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados?formato=json&dataInicial=${toBcbDate(a)}&dataFinal=${toBcbDate(b)}`);
      // sem dados no intervalo (ex.: IPCA do mês corrente) o Banco Central responde 404
      if (status === 404) continue;
      if (status !== 200) return { ticker: name, message: `Banco Central: erro ${status} ao buscar o ${name}.` };
      points.push(...parseBcb(json));
    }
    return { points, source: 'Banco Central (SGS)' };
  } catch (e) {
    return { ticker: name, message: 'Banco Central: ' + explain(e) };
  }
}

// ============================ AÇÕES E ETFs DOS EUA (Yahoo Finance, não oficial) ============================

export interface UsQuote { ticker: string; priceUsdCents: number; time: string; changePct?: number; name?: string }
/** Cotação de ativos americanos (em dólar). Mesma fonte não oficial usada para a B3 no modo Yahoo. */
export async function fetchUsQuotes(tickers: string[]): Promise<{ quotes: UsQuote[]; errors: FetchError[] }> {
  const quotes: UsQuote[] = [];
  const errors: FetchError[] = [];
  for (const raw of [...new Set(tickers.map((t) => t.trim().toUpperCase()))]) {
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(raw)) {
      errors.push({ ticker: raw, message: 'Código inválido.' });
      continue;
    }
    try {
      countRequest('yahoo');
      const { status, json } = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(raw)}?range=1d&interval=1d`);
      const meta = json?.chart?.result?.[0]?.meta;
      if (!meta || typeof meta.regularMarketPrice !== 'number') throw new Error(status === 404 ? 'ativo não encontrado' : `resposta sem preço (HTTP ${status})`);
      if (meta.currency && meta.currency !== 'USD') throw new Error(`cotado em ${meta.currency}, não em dólar`);
      const prev = meta.chartPreviousClose ?? meta.previousClose;
      quotes.push({ ticker: raw, priceUsdCents: Math.round(meta.regularMarketPrice * 100), time: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : new Date().toISOString(), changePct: prev ? ((meta.regularMarketPrice - prev) / prev) * 100 : undefined, name: meta.shortName });
    } catch (e) {
      errors.push({ ticker: raw, message: 'Yahoo Finance: ' + explain(e) });
    }
  }
  return { quotes, errors };
}

/** Ibovespa (pontos), pelo mesmo Yahoo Finance não oficial usado nas cotações. */
export async function fetchIbovespa(): Promise<{ points: HistoryPoint[]; source: string } | FetchError> {
  try {
    countRequest('yahoo');
    const { status, json } = await getJson('https://query1.finance.yahoo.com/v8/finance/chart/%5EBVSP?range=1mo&interval=1d');
    const r = json?.chart?.result?.[0];
    const ts: number[] = r?.timestamp ?? [];
    const close: (number | null)[] = r?.indicators?.quote?.[0]?.close ?? [];
    const points: HistoryPoint[] = ts.flatMap((t, i) => (typeof close[i] === 'number' ? [[localDate(t * 1000), Math.round(close[i] as number)] as HistoryPoint] : []));
    if (!points.length) return { ticker: 'IBOV', message: `Yahoo Finance: sem dados do Ibovespa (HTTP ${status}).` };
    return { points, source: 'Yahoo Finance (não oficial)' };
  } catch (e) {
    return { ticker: 'IBOV', message: 'Yahoo Finance: ' + explain(e) };
  }
}
