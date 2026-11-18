import { describe, expect, it } from 'vitest';
import { streamNames, toBrl } from '../src/services/liveCrypto';

describe('cripto ao vivo (Binance, dados públicos)', () => {
  it('pede o par em reais e em USDT de cada moeda, mais o USDT/BRL para converter; ignora símbolo inválido', () => {
    expect(streamNames(['BTC', 'sol', '$$', 'USDT'])).toEqual(['btcbrl@miniTicker', 'btcusdt@miniTicker', 'solbrl@miniTicker', 'solusdt@miniTicker', 'usdtbrl@miniTicker']);
    expect(streamNames([])).toEqual([]);
  });
  it('par em reais vence; sem ele, converte pelo USDT; sem nenhum dado, não inventa preço', () => {
    const last = new Map([
      ['BTCBRL', { c: 368234, o: 360000, at: 1 }],
      ['BTCUSDT', { c: 66000, o: 65000, at: 1 }],
      ['PEPEUSDT', { c: 0.00001, o: 0.00001, at: 2 }],
      ['USDTBRL', { c: 5.5, o: 5.4, at: 3 }],
    ]);
    const r = toBrl(last, ['BTC', 'PEPE', 'XYZ', 'USDT']);
    expect(r.get('BTC')).toMatchObject({ priceCents: 36823400, via: 'BRL' });
    expect(r.get('BTC')!.changePct).toBeCloseTo(2.287, 2);
    expect(r.get('PEPE')).toMatchObject({ priceCents: 0, via: 'USDT' });
    expect(r.has('XYZ')).toBe(false);
    expect(r.get('USDT')).toMatchObject({ priceCents: 550 });
  });
});
