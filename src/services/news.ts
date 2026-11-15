import { mergeNews, NEWS_SOURCES, parseFeed, type NewsItem, type NewsSource, type NewsTopic } from '../domain/news';

/**
 * Busca das notícias. Sem cadastro e sem custo: o app lê os feeds públicos de cada site.
 * Para não sobrecarregar as fontes, cada assunto é consultado no máximo uma vez a cada 15 minutos;
 * o resultado fica guardado no aparelho para abrir rápido e funcionar sem internet.
 */
const CACHE_KEY = 'gf_news_v1';
export const NEWS_MIN_INTERVAL_MS = 15 * 60 * 1000;
const TIMEOUT_MS = 12000;

interface Cache {
  [topic: string]: { at: number; items: NewsItem[]; failed: string[] };
}
export interface NewsResult {
  items: NewsItem[];
  at: number; // quando foi buscado
  failed: string[]; // nomes das fontes que não responderam
  fromCache: boolean;
}

function readCache(): Cache {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as Cache;
  } catch {
    return {};
  }
}
function writeCache(c: Cache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {
    /* sem espaço: segue sem guardar */
  }
}

async function fetchSource(s: NewsSource): Promise<NewsItem[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(s.url, { headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' }, signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const items = parseFeed(await res.text(), s);
    if (items.length === 0) throw new Error('feed vazio');
    return items;
  } finally {
    clearTimeout(timer);
  }
}

export function enabledSources(topic: NewsTopic, disabled: string[]): NewsSource[] {
  return NEWS_SOURCES.filter((s) => s.topic === topic && !disabled.includes(s.id));
}

/** Notícias de um assunto. Usa o que está guardado se for recente; `force` ignora a espera só depois do intervalo mínimo. */
export async function loadNews(topic: NewsTopic, disabled: string[], now = Date.now()): Promise<NewsResult> {
  const cache = readCache();
  const hit = cache[topic];
  const sources = enabledSources(topic, disabled);
  const allowed = new Set(sources.map((s) => s.id));
  const cached = hit ? hit.items.filter((i) => allowed.has(i.sourceId)) : [];
  if (hit && now - hit.at < NEWS_MIN_INTERVAL_MS) return { items: cached, at: hit.at, failed: hit.failed, fromCache: true };
  if (sources.length === 0) return { items: [], at: now, failed: [], fromCache: false };

  const results = await Promise.allSettled(sources.map(fetchSource));
  const failed = sources.filter((_, i) => results[i].status === 'rejected').map((s) => s.name);
  const fresh = mergeNews(results.map((r) => (r.status === 'fulfilled' ? r.value : [])));
  // nenhuma fonte respondeu (sem internet): mostra o que já estava guardado
  if (fresh.length === 0 && cached.length > 0) return { items: cached, at: hit!.at, failed, fromCache: true };
  cache[topic] = { at: now, items: fresh.slice(0, 60), failed };
  writeCache(cache);
  return { items: cache[topic].items, at: now, failed, fromCache: false };
}
