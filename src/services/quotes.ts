import type { Asset, DividendEvent, DividendKind, ISODate, Settings } from '../lib/types';
import { addDays, parseISO, toISO, todayISO, addMonths } from '../lib/dates';
import { makeEventKey } from '../domain/dividends';
import { uid } from '../lib/ids';

type Api = Settings['api'];

export interface QuoteResult {
  ticker: string;
  priceCents: number;
  time: string;
  changePct?: number;
  name?: string;
}
export interface FetchError {
  ticker: string;
  message: string;
}

export const BRAPI_FREE_TICKERS = ['PETR4', 'MGLU3', 'VALE3', 'ITUB4'];
/** Fundos de demonstração: a brapi responde proventos deles mesmo sem token. */
export const BRAPI_FREE_DIVIDEND_TICKERS = ['MXRF11', 'HGLG11'];

/**
 * A brapi só entrega proventos nos planos pagos (Startup ou Pro). No plano gratuito a consulta
 * é recusada e ainda gasta a cota mensal, então nem chamamos.
 */
export function brapiDividendsAvailable(ticker: string, api: Pick<Api, 'brapiToken' | 'brapiPlan'>): boolean {
  if (BRAPI_FREE_DIVIDEND_TICKERS.includes(ticker.toUpperCase())) return true;
  return api.brapiToken.trim().length > 0 && api.brapiPlan !== 'free';
}
const BATCH: Record<Api['brapiPlan'], number> = { free: 1, startup: 10, pro: 20 };

async function getJson(url: string, headers: Record<string, string> = {}): Promise<{ status: number; json: any }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: ctrl.signal });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      /* corpo vazio */
    }
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

function httpMessage(status: number, json: any, provider: string): string {
  if (status === 401) return `${provider}: token ausente ou inválido. Informe seu token em Ajustes → Cotações.`;
  if (status === 402 || status === 429) return `${provider}: limite de requisições do plano atingido. Tente mais tarde.`;
  if (status === 403) return `${provider}: seu plano não inclui este recurso.`;
  if (status === 404) return `${provider}: ativo não encontrado.`;
  if (json?.message) return `${provider}: ${String(json.message)}`;
  return `${provider}: erro ${status}.`;
}

const authHeader = (api: Api): Record<string, string> => (api.brapiToken ? { Authorization: `Bearer ${api.brapiToken.trim()}` } : {});
const toCents = (n: number) => Math.round(n * 100 + 1e-9);

// ============================ COTAÇÕES ============================

export async function fetchQuotes(tickers: string[], api: Api): Promise<{ quotes: QuoteResult[]; errors: FetchError[] }> {
  const quotes: QuoteResult[] = [];
  const errors: FetchError[] = [];
  const list = [...new Set(tickers.map((t) => t.toUpperCase()))];
  if (api.quoteProvider === 'manual') return { quotes, errors: list.map((ticker) => ({ ticker, message: 'Cotação automática desligada. Informe os preços manualmente.' })) };

  if (api.quoteProvider === 'yahoo') {
    for (const t of list) {
      try {
        const { status, json } = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${t}.SA?range=1d&interval=1d`);
        const meta = json?.chart?.result?.[0]?.meta;
        if (!meta || typeof meta.regularMarketPrice !== 'number') throw new Error(status === 404 ? 'ativo não encontrado' : `resposta sem preço (HTTP ${status})`);
        const prev = meta.chartPreviousClose ?? meta.previousClose;
        quotes.push({ ticker: t, priceCents: toCents(meta.regularMarketPrice), time: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : new Date().toISOString(), changePct: prev ? ((meta.regularMarketPrice - prev) / prev) * 100 : undefined, name: meta.shortName });
      } catch (e) {
        errors.push({ ticker: t, message: 'Yahoo Finance: ' + explain(e) });
      }
    }
    return { quotes, errors };
  }

  // brapi
  const hasToken = api.brapiToken.trim().length > 0;
  const allowed = hasToken ? list : list.filter((t) => BRAPI_FREE_TICKERS.includes(t));
  for (const t of list) if (!allowed.includes(t)) errors.push({ ticker: t, message: 'brapi: sem token só é possível consultar PETR4, MGLU3, VALE3 e ITUB4. Crie um token gratuito em brapi.dev e informe em Ajustes.' });
  const size = hasToken ? BATCH[api.brapiPlan] : 1;
  for (let i = 0; i < allowed.length; i += size) {
    const chunk = allowed.slice(i, i + size);
    try {
      const { status, json } = await getJson(`https://brapi.dev/api/quote/${chunk.join(',')}`, authHeader(api));
      if (status !== 200 || !Array.isArray(json?.results)) {
        for (const t of chunk) errors.push({ ticker: t, message: httpMessage(status, json, 'brapi') });
        continue;
      }
      for (const r of json.results) {
        if (typeof r.regularMarketPrice !== 'number') continue;
        quotes.push({ ticker: String(r.symbol).toUpperCase(), priceCents: toCents(r.regularMarketPrice), time: r.regularMarketTime ?? new Date().toISOString(), changePct: typeof r.regularMarketChangePercent === 'number' ? r.regularMarketChangePercent : undefined, name: r.shortName ?? r.longName });
      }
      for (const t of chunk) if (!json.results.some((r: any) => String(r.symbol).toUpperCase() === t)) errors.push({ ticker: t, message: 'brapi: ativo não retornado.' });
    } catch (e) {
      for (const t of chunk) errors.push({ ticker: t, message: 'brapi: ' + explain(e) });
    }
  }
  return { quotes, errors };
}

function explain(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/abort/i.test(msg)) return 'tempo esgotado.';
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return 'sem conexão ou bloqueado pelo navegador (no app Android funciona).';
  return msg;
}

// ============================ PROVENTOS ============================

function labelToKind(label: string | undefined, assetType: Asset['type']): DividendKind {
  const l = (label ?? '').toUpperCase();
  if (l.includes('JCP') || l.includes('JUROS')) return 'jcp';
  if (l.includes('AMORT') || l.includes('RESTITUI')) return 'amortizacao';
  if (l.includes('RENDIMENTO')) return 'rendimento';
  if (l.includes('DIVIDENDO')) return assetType === 'fii' ? 'rendimento' : 'dividendo';
  return assetType === 'fii' ? 'rendimento' : 'outro';
}
const dateOnly = (v: unknown): ISODate | undefined => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : undefined);

/** Converte a resposta da brapi (ações: results[].data.cashDividends | dividendsData; FIIs: dividends[]) em eventos. */
export function parseBrapiDividends(json: any, asset: Asset): DividendEvent[] {
  const raw: any[] = [];
  const r0 = json?.results?.[0];
  if (Array.isArray(r0?.data?.cashDividends)) raw.push(...r0.data.cashDividends);
  if (Array.isArray(r0?.dividendsData?.cashDividends)) raw.push(...r0.dividendsData.cashDividends);
  if (Array.isArray(json?.dividends)) raw.push(...json.dividends.filter((d: any) => !d.symbol || String(d.symbol).toUpperCase() === asset.ticker));
  const out: DividendEvent[] = [];
  for (const d of raw) {
    const rate = Number(d.rate ?? d.value);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    const kind = labelToKind(d.label ?? d.type, asset.type);
    const dataCom = dateOnly(d.lastDatePrior);
    const paymentDate = dateOnly(d.paymentDate);
    out.push({
      id: uid('d_'),
      assetId: asset.id,
      kind,
      ratePerUnit: rate,
      dataCom,
      exDate: dateOnly(d.exDate),
      paymentDate,
      approvedOn: dateOnly(d.approvedOn),
      source: 'api',
      sourceName: 'brapi.dev',
      official: !!paymentDate && d.paymentDateIsDeadline !== true,
      key: makeEventKey(asset.ticker, kind, dataCom, rate),
    });
  }
  return out;
}

/** Última data útil (seg–sex) antes da data ex = data-com aproximada (feriados não são considerados). */
export function dataComFromEx(exDate: ISODate): ISODate {
  let d = addDays(exDate, -1);
  while ([0, 6].includes(parseISO(d).getDay())) d = addDays(d, -1);
  return d;
}

export function parseYahooDividends(json: any, asset: Asset): DividendEvent[] {
  const evs = json?.chart?.result?.[0]?.events?.dividends;
  if (!evs || typeof evs !== 'object') return [];
  const out: DividendEvent[] = [];
  for (const e of Object.values<any>(evs)) {
    const rate = Number(e.amount);
    if (!Number.isFinite(rate) || rate <= 0 || !e.date) continue;
    const exDate = toISO(new Date(e.date * 1000));
    const kind: DividendKind = asset.type === 'fii' ? 'rendimento' : 'dividendo';
    const dataCom = dataComFromEx(exDate);
    out.push({ id: uid('d_'), assetId: asset.id, kind, ratePerUnit: rate, dataCom, exDate, source: 'api', sourceName: 'Yahoo Finance (não oficial)', official: false, key: makeEventKey(asset.ticker, kind, dataCom, rate) });
  }
  return out;
}

export async function fetchDividends(assets: Asset[], api: Api): Promise<{ events: DividendEvent[]; errors: FetchError[] }> {
  const events: DividendEvent[] = [];
  const errors: FetchError[] = [];
  if (api.dividendProvider === 'manual') return { events, errors: assets.map((a) => ({ ticker: a.ticker, message: 'Busca automática de proventos desligada. Cadastre manualmente.' })) };
  const start = addMonths(todayISO(), -24);
  for (const a of assets) {
    try {
      if (api.dividendProvider === 'yahoo') {
        const { status, json } = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${a.ticker}.SA?range=2y&interval=1d&events=div`);
        if (!json?.chart?.result) throw new Error(`resposta inválida (HTTP ${status})`);
        events.push(...parseYahooDividends(json, a));
      } else {
        if (!brapiDividendsAvailable(a.ticker, api)) {
          errors.push({ ticker: a.ticker, message: 'brapi: proventos exigem token e plano Startup ou Pro (se for o seu caso, selecione o plano em Ajustes). No plano gratuito, cadastre manualmente ou use o Yahoo Finance.' });
          continue;
        }
        const url = a.type === 'fii' ? `https://brapi.dev/api/v2/fii/dividends?symbols=${a.ticker}&startDate=${start}` : `https://brapi.dev/api/v2/stocks/dividends?symbols=${a.ticker}&startDate=${start}`;
        const { status, json } = await getJson(url, authHeader(api));
        if (status !== 200) {
          errors.push({ ticker: a.ticker, message: status === 403 ? 'brapi: seu plano não inclui proventos (exige Startup ou Pro). Cadastre manualmente ou use o Yahoo Finance como fonte.' : httpMessage(status, json, 'brapi') });
          continue;
        }
        events.push(...parseBrapiDividends(json, a));
      }
    } catch (e) {
      errors.push({ ticker: a.ticker, message: explain(e) });
    }
  }
  return { events, errors };
}
