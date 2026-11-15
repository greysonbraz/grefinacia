import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { mergeNews, NEWS_SOURCES, parseFeed, plainText, safeUrl, type NewsSource } from '../src/domain/news';
import { loadNews, NEWS_MIN_INTERVAL_MS } from '../src/services/news';
import { NEWS_HOSTS } from '../src/lib/csp';

const src: NewsSource = { id: 'teste', name: 'Fonte Teste', topic: 'economia', url: 'https://exemplo.com.br/feed' };
const rss = (items: string) => `<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>x</title>${items}</channel></rss>`;
const item = (title: string, link: string, desc = '', date = 'Sat, 14 Nov 2026 12:00:00 -0300') => `<item><title>${title}</title><link>${link}</link><description><![CDATA[${desc}]]></description><pubDate>${date}</pubDate></item>`;

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('leitura de feeds', () => {
  it('RSS: título, link, data e resumo sem HTML', () => {
    const r = parseFeed(rss(item('Selic sobe', 'https://exemplo.com.br/a', '<p><img src="x.png">O <b>Copom</b> decidiu&nbsp;hoje.</p>')), src);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ title: 'Selic sobe', url: 'https://exemplo.com.br/a', summary: 'O Copom decidiu hoje.', source: 'Fonte Teste', topic: 'economia' });
    expect(r[0].date).toBe('2026-11-14T15:00:00.000Z');
  });

  it('Atom (formato do Banco Central)', () => {
    const atom = `﻿<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>BC</title><link rel="alternate" href="https://www.bcb.gov.br/" /><entry><id>1</id><title type="text">Nova regra</title><updated>2026-11-10T10:54:49-03:00</updated><link rel="alternate" href="https://www.bcb.gov.br/detalhenoticia/1/noticia" /><content type="html">&lt;div&gt;O CMN aprovou.&lt;/div&gt;</content></entry></feed>`;
    const r = parseFeed(atom, { ...src, id: 'bcb' });
    expect(r[0]).toMatchObject({ title: 'Nova regra', url: 'https://www.bcb.gov.br/detalhenoticia/1/noticia', summary: 'O CMN aprovou.' });
  });

  it('conteúdo malicioso vira texto ou é descartado; nada é executado', () => {
    const evil = rss(
      item('<![CDATA[<script>window.__x=1</script>Título <img src=x onerror=alert(1)>]]>', 'https://exemplo.com.br/b', '<script>alert(1)</script><iframe src="https://mal.example"></iframe>Texto') +
        item('Link perigoso', 'javascript:alert(1)') +
        item('Sem criptografia', 'http://exemplo.com.br/c') +
        item('', 'https://exemplo.com.br/d'),
    );
    const r = parseFeed(evil, src);
    expect(r).toHaveLength(1);
    expect(r[0].title).toBe('Título');
    expect(r[0].summary).toBe('Texto');
    expect((window as unknown as { __x?: number }).__x).toBeUndefined();
    expect(JSON.stringify(r)).not.toMatch(/<|script|onerror|javascript:/);
  });

  it('só aceita links https', () => {
    expect(safeUrl('https://a.com/x')).toBe('https://a.com/x');
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'http://a.com', 'file:///etc/passwd', '', null, 'não é link']) expect(safeUrl(bad)).toBeNull();
  });

  it('resumo longo é cortado; XML inválido devolve lista vazia', () => {
    const long = 'palavra '.repeat(100);
    expect(parseFeed(rss(item('T', 'https://exemplo.com.br/e', long)), src)[0].summary.length).toBeLessThanOrEqual(221);
    expect(parseFeed('isto não é xml <<<', src)).toEqual([]);
    expect(plainText('')).toBe('');
  });

  it('junta fontes sem repetir e com as mais recentes primeiro', () => {
    const a = parseFeed(rss(item('Antiga', 'https://exemplo.com.br/1', '', 'Fri, 13 Nov 2026 10:00:00 GMT') + item('Nova', 'https://exemplo.com.br/2?utm=a', '', 'Sat, 14 Nov 2026 10:00:00 GMT')), src);
    const b = parseFeed(rss(item('Nova repetida', 'https://exemplo.com.br/2?utm=b')), { ...src, id: 'outra' });
    expect(mergeNews([a, b]).map((n) => n.title)).toEqual(['Nova', 'Antiga']);
  });
});

describe('fontes', () => {
  it('todas em https, sem repetição, e liberadas na política de conteúdo', () => {
    expect(new Set(NEWS_SOURCES.map((s) => s.id)).size).toBe(NEWS_SOURCES.length);
    for (const s of NEWS_SOURCES) {
      expect(s.url.startsWith('https://')).toBe(true);
      expect(NEWS_HOSTS).toContain(new URL(s.url).origin);
    }
    for (const t of ['economia', 'bolsa', 'cripto', 'juros', 'educacao']) expect(NEWS_SOURCES.some((s) => s.topic === t)).toBe(true);
  });
});

describe('busca com limite de consultas', () => {
  const ok = (body: string) => ({ ok: true, status: 200, text: async () => body });

  it('não consulta de novo antes de 15 minutos e respeita fontes desligadas', async () => {
    const fetchMock = vi.fn(async () => ok(rss(item('Notícia', 'https://exemplo.com.br/n'))));
    vi.stubGlobal('fetch', fetchMock);
    const t0 = 1_800_000_000_000;
    const first = await loadNews('cripto', [], t0);
    expect(first.fromCache).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2); // duas fontes de cripto
    const again = await loadNews('cripto', [], t0 + 60_000);
    expect(again.fromCache).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await loadNews('cripto', ['livecoins'], t0 + NEWS_MIN_INTERVAL_MS + 1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('fonte que falha é informada; sem internet mostra o que estava guardado', async () => {
    let online = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (!online || url.includes('livecoins')) throw new Error('rede');
      return ok(rss(item('Bitcoin', 'https://exemplo.com.br/btc')));
    }));
    const t0 = 1_800_000_000_000;
    const r = await loadNews('cripto', [], t0);
    expect(r.items.map((i) => i.title)).toEqual(['Bitcoin']);
    expect(r.failed).toEqual(['Livecoins']);
    online = false;
    const off = await loadNews('cripto', [], t0 + NEWS_MIN_INTERVAL_MS + 1);
    expect(off.fromCache).toBe(true);
    expect(off.items).toHaveLength(1);
  });
});
