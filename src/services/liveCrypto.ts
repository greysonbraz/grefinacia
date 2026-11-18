import { useEffect, useRef, useState } from 'react';

/**
 * Cotação de cripto ao vivo (gratuita, sem chave): canal público de dados de mercado da Binance
 * (data-stream.binance.vision, só leitura). Cada moeda é pedida em par com o real (ex.: BTCBRL); quando não existe
 * par em reais, vale o par em USDT convertido pelo USDTBRL, também ao vivo. Fica ligado só enquanto a tela está aberta.
 * Sem conexão ou sem a moeda, a tela segue com a última cotação salva (CoinGecko) — nada é inventado.
 */
export interface LivePrice { priceCents: number; changePct: number; via: 'BRL' | 'USDT'; at: number }
export type LiveStatus = 'off' | 'connecting' | 'live' | 'error';
const WS = 'wss://data-stream.binance.vision/stream?streams=';

/** Nomes dos canais (minúsculos) para os símbolos: par em reais, par em USDT e o USDT/BRL para converter. */
export function streamNames(symbols: string[]): string[] {
  const out = new Set<string>();
  for (const s of symbols) {
    const sym = s.trim().toLowerCase();
    if (!/^[a-z0-9]{2,10}$/.test(sym)) continue;
    if (sym === 'usdt') { out.add('usdtbrl@miniTicker'); continue; }
    out.add(`${sym}brl@miniTicker`);
    out.add(`${sym}usdt@miniTicker`);
  }
  if (out.size) out.add('usdtbrl@miniTicker');
  return [...out];
}

/** Junta os últimos preços recebidos em reais por símbolo (par direto em reais vence; senão USDT × USDT/BRL). */
export function toBrl(last: Map<string, { c: number; o: number; at: number }>, symbols: string[]): Map<string, LivePrice> {
  const out = new Map<string, LivePrice>();
  const usdt = last.get('USDTBRL');
  for (const s of symbols) {
    const sym = s.toUpperCase();
    if (sym === 'USDT' && usdt) { out.set(sym, { priceCents: Math.round(usdt.c * 100), changePct: usdt.o ? ((usdt.c - usdt.o) / usdt.o) * 100 : 0, via: 'BRL', at: usdt.at }); continue; }
    const brl = last.get(`${sym}BRL`);
    if (brl && brl.c > 0) { out.set(sym, { priceCents: Math.round(brl.c * 100), changePct: brl.o ? ((brl.c - brl.o) / brl.o) * 100 : 0, via: 'BRL', at: brl.at }); continue; }
    const u = last.get(`${sym}USDT`);
    if (u && u.c > 0 && usdt && usdt.c > 0) out.set(sym, { priceCents: Math.round(u.c * usdt.c * 100), changePct: u.o ? ((u.c - u.o) / u.o) * 100 : 0, via: 'USDT', at: Math.min(u.at, usdt.at) });
  }
  return out;
}

/** Abre o canal ao vivo para os símbolos enquanto o componente estiver montado. Atualiza a tela no máximo 1×/s. */
export function useLiveCrypto(symbols: string[], enabled = true): { prices: Map<string, LivePrice>; status: LiveStatus } {
  const [prices, setPrices] = useState<Map<string, LivePrice>>(new Map());
  const [status, setStatus] = useState<LiveStatus>('off');
  const key = [...new Set(symbols.map((s) => s.toUpperCase()))].sort().join(',');
  const last = useRef(new Map<string, { c: number; o: number; at: number }>());
  useEffect(() => {
    const syms = key ? key.split(',') : [];
    const names = streamNames(syms);
    if (!enabled || !names.length || typeof WebSocket === 'undefined') { setStatus('off'); return; }
    let ws: WebSocket | null = null;
    let closed = false;
    let paused = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let flush: ReturnType<typeof setInterval> | undefined;
    const connect = () => {
      setStatus('connecting');
      ws = new WebSocket(WS + names.join('/'));
      ws.onopen = () => { retry = 0; setStatus('live'); };
      ws.onmessage = (ev) => {
        try {
          const d = JSON.parse(String(ev.data))?.data;
          if (d && typeof d.s === 'string') last.current.set(d.s, { c: Number(d.c), o: Number(d.o), at: Number(d.E) || Date.now() });
        } catch { /* mensagem inválida: ignora */ }
      };
      ws.onerror = () => setStatus('error');
      ws.onclose = () => {
        if (closed || paused) return;
        setStatus('error');
        // reconecta com espera crescente (2 s, 4 s, ... até 60 s)
        timer = setTimeout(connect, Math.min(60000, 2000 * 2 ** retry++));
      };
    };
    connect();
    flush = setInterval(() => { if (last.current.size) setPrices(toBrl(last.current, syms)); }, 1000);
    // app em segundo plano: fecha o canal (bateria); ao voltar, reconecta
    const onVis = () => {
      if (document.visibilityState === 'hidden') { paused = true; ws?.close(); setStatus('off'); }
      else if (paused) { paused = false; connect(); }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      closed = true;
      clearTimeout(timer);
      clearInterval(flush);
      document.removeEventListener('visibilitychange', onVis);
      ws?.close();
    };
  }, [key, enabled]);
  return { prices, status };
}
