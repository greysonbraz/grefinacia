/** Leitura de feeds de notícias (RSS 2.0 e Atom). Regras puras: recebem o texto do feed e devolvem itens limpos. */
export type NewsTopic = 'economia' | 'bolsa' | 'cripto' | 'juros' | 'educacao';

export interface NewsSource {
  id: string;
  name: string;
  topic: NewsTopic;
  url: string;
}
export interface NewsItem {
  id: string;
  sourceId: string;
  source: string;
  topic: NewsTopic;
  title: string;
  summary: string;
  url: string;
  date: string; // ISO; '' quando o feed não informa
}

export const TOPIC_LABEL: Record<NewsTopic, string> = { economia: 'Economia', bolsa: 'Bolsa e FIIs', cripto: 'Cripto', juros: 'Juros e inflação', educacao: 'Educação' };

/** Fontes gratuitas por RSS, conferidas em 15/11/2026. Só título, resumo e link: a matéria abre no site de origem. */
export const NEWS_SOURCES: NewsSource[] = [
  { id: 'agenciabrasil', name: 'Agência Brasil', topic: 'economia', url: 'https://agenciabrasil.ebc.com.br/rss/economia/feed.xml' },
  { id: 'g1', name: 'G1 Economia', topic: 'economia', url: 'https://g1.globo.com/rss/g1/economia/' },
  { id: 'infomoney', name: 'InfoMoney', topic: 'bolsa', url: 'https://www.infomoney.com.br/feed/' },
  { id: 'moneytimes', name: 'Money Times', topic: 'bolsa', url: 'https://www.moneytimes.com.br/feed/' },
  { id: 'suno', name: 'Suno Notícias', topic: 'bolsa', url: 'https://www.suno.com.br/noticias/feed/' },
  { id: 'investnews', name: 'InvestNews', topic: 'bolsa', url: 'https://investnews.com.br/feed/' },
  { id: 'seudinheiro', name: 'Seu Dinheiro', topic: 'bolsa', url: 'https://www.seudinheiro.com/feed/' },
  { id: 'portaldobitcoin', name: 'Portal do Bitcoin', topic: 'cripto', url: 'https://portaldobitcoin.uol.com.br/feed/' },
  { id: 'livecoins', name: 'Livecoins', topic: 'cripto', url: 'https://livecoins.com.br/feed/' },
  { id: 'bcb', name: 'Banco Central', topic: 'juros', url: 'https://www.bcb.gov.br/api/feed/sitebcb/sitefeeds/noticias' },
  { id: 'infomoney-guias', name: 'InfoMoney Guias', topic: 'educacao', url: 'https://www.infomoney.com.br/guias/feed/' },
  { id: 'suno-artigos', name: 'Suno Artigos', topic: 'educacao', url: 'https://www.suno.com.br/artigos/feed/' },
];

const MAX_SUMMARY = 220;
const MAX_ITEMS_PER_FEED = 25;

/** Tira as marcações de um trecho HTML e devolve só o texto. O documento criado é inerte: nada é executado nem carregado. */
export function plainText(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,img,iframe,figure').forEach((n) => n.remove());
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

const shorten = (s: string): string => (s.length <= MAX_SUMMARY ? s : s.slice(0, MAX_SUMMARY).replace(/\s+\S*$/, '') + '…');

/** Só aceita links https: nada de javascript:, data: ou http sem criptografia. */
export function safeUrl(raw: string | null | undefined): string | null {
  try {
    const u = new URL((raw ?? '').trim());
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

const child = (el: Element, name: string): Element | undefined => [...el.children].find((c) => c.localName === name);
const text = (el: Element, name: string): string => (child(el, name)?.textContent ?? '').trim();

export function parseFeed(xml: string, source: NewsSource): NewsItem[] {
  const doc = new DOMParser().parseFromString(xml.replace(/^﻿/, ''), 'text/xml');
  if (doc.querySelector('parsererror')) return [];
  const nodes = [...doc.getElementsByTagName('item'), ...doc.getElementsByTagName('entry')].slice(0, MAX_ITEMS_PER_FEED);
  const out: NewsItem[] = [];
  for (const n of nodes) {
    const title = plainText(text(n, 'title'));
    const linkEl = [...n.children].filter((c) => c.localName === 'link');
    const href = linkEl.find((l) => l.getAttribute('rel') !== 'self' && l.getAttribute('href'))?.getAttribute('href') ?? linkEl[0]?.textContent;
    const url = safeUrl(href);
    if (!title || !url) continue;
    const rawDate = text(n, 'pubDate') || text(n, 'updated') || text(n, 'published') || text(n, 'date');
    const t = rawDate ? Date.parse(rawDate) : NaN;
    const summary = shorten(plainText(text(n, 'description') || text(n, 'summary') || text(n, 'content')));
    out.push({ id: source.id + '|' + url, sourceId: source.id, source: source.name, topic: source.topic, title, summary: summary === title ? '' : summary, url, date: Number.isNaN(t) ? '' : new Date(t).toISOString() });
  }
  return out;
}

/** Junta os itens de várias fontes: sem repetidos, mais recentes primeiro. */
export function mergeNews(lists: NewsItem[][]): NewsItem[] {
  const seen = new Set<string>();
  const all: NewsItem[] = [];
  for (const it of lists.flat()) {
    const key = it.url.split('?')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(it);
  }
  return all.sort((a, b) => b.date.localeCompare(a.date));
}
