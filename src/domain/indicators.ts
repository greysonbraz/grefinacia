import type { AppData, HistoryPoint, ISODate } from '../lib/types';
import { historyId } from './market';

/** Faixa "Mercado hoje" do Início: só valores que vieram da fonte; sem dado, o item não aparece. */
export interface MarketItem { id: string; label: string; value: string; changePct?: number; note: string }

const pts = (data: AppData, sym: string): HistoryPoint[] => data.marketHistory.find((h) => h.id === historyId('indice', sym))?.points ?? [];
const lastUpTo = (p: HistoryPoint[], today: ISODate) => [...p].reverse().find(([d]) => d <= today);
const pct = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

export function marketStrip(data: AppData, today: ISODate): MarketItem[] {
  const out: MarketItem[] = [];
  const ib = pts(data, 'IBOV');
  if (ib.length) {
    const [, v] = ib[ib.length - 1];
    const prev = ib.length > 1 ? ib[ib.length - 2][1] : null;
    out.push({ id: 'ibov', label: 'Ibovespa', value: v.toLocaleString('pt-BR'), changePct: prev ? ((v - prev) / prev) * 100 : undefined, note: 'pontos, fechamento' });
  }
  const usd = pts(data, 'USD');
  if (usd.length) {
    const [, v] = usd[usd.length - 1];
    const prev = usd.length > 1 ? usd[usd.length - 2][1] : null;
    out.push({ id: 'usd', label: 'Dólar', value: `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, changePct: prev ? ((v - prev) / prev) * 100 : undefined, note: 'PTAX' });
  }
  // a meta da Selic vale até a próxima reunião: a série traz datas futuras; vale a de hoje
  const selic = lastUpTo(pts(data, 'SELIC'), today);
  if (selic) out.push({ id: 'selic', label: 'Selic', value: pct(selic[1]), note: 'ao ano' });
  const cdi = lastUpTo(pts(data, 'CDIA'), today);
  if (cdi) out.push({ id: 'cdi', label: 'CDI', value: pct(cdi[1]), note: 'ao ano' });
  const ipca = lastUpTo(pts(data, 'IPCA12'), today);
  if (ipca) out.push({ id: 'ipca', label: 'IPCA', value: pct(ipca[1]), note: '12 meses' });
  return out;
}
