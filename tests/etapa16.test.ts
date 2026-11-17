import { describe, expect, it } from 'vitest';
import { NEWS_SOURCES, parseFeed, TOPIC_LABEL } from '../src/domain/news';
import { ALLOWED_HOSTS } from '../src/lib/csp';

describe('notícias dos EUA (16)', () => {
  it('assunto próprio com fontes em português e em inglês, todas liberadas na CSP', () => {
    expect(TOPIC_LABEL.eua).toBe('EUA e Wall Street');
    const eua = NEWS_SOURCES.filter((s) => s.topic === 'eua');
    expect(eua.length).toBeGreaterThanOrEqual(5);
    expect(eua.filter((s) => s.name.includes('em inglês'))).toHaveLength(2);
    for (const s of eua) expect(ALLOWED_HOSTS).toContain(new URL(s.url).origin);
  });
  it('lê o formato do feed da CNBC (RSS 2.0 com guid e CDATA)', () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Market Insider</title><item><title><![CDATA[Stocks making the biggest moves midday]]></title><link>https://www.cnbc.com/2026/11/17/stocks.html</link><description><![CDATA[Check out the companies making headlines.]]></description><pubDate>Mon, 17 Nov 2026 17:01:12 GMT</pubDate><guid isPermaLink="false">108230000</guid></item></channel></rss>`;
    const src = NEWS_SOURCES.find((s) => s.id === 'cnbc-markets')!;
    expect(parseFeed(xml, src)).toEqual([expect.objectContaining({ title: 'Stocks making the biggest moves midday', url: 'https://www.cnbc.com/2026/11/17/stocks.html', topic: 'eua', date: '2026-11-17T17:01:12.000Z' })]);
  });
});
