import { parseBoleto, type BoletoInfo } from './boleto';
import { parseReceipt, type ReceiptGuess } from './receipt';
import { diffDays } from '../lib/dates';
import type { ISODate, UsdHolding } from '../lib/types';

/**
 * Lê o texto de uma foto ou print (vindo do leitor de texto do aparelho) e descobre o que é:
 * investimento em dólar (Time Deposit / Meu Porquinho do Inter), boleto ou cupom fiscal.
 * Só sugere: a pessoa confirma antes de salvar. Nada é inventado: o que não foi lido fica vazio.
 */

export interface TdGuess {
  name: string;
  balanceUsdCents: number; // valor bruto de hoje
  appliedUsdCents?: number;
  ratePct?: number; // % ao ano
  startDate?: ISODate;
  maturityDate?: ISODate;
}

export type DocGuess =
  | { kind: 'td'; items: TdGuess[] }
  | { kind: 'carteira'; items: HoldingGuess[] }
  | { kind: 'boleto'; boleto: BoletoInfo }
  | { kind: 'receipt'; receipt: ReceiptGuess }
  | { kind: 'unknown' };

// "US$ 10,95", "US$10,95", o leitor às vezes troca o $ por S ou 5 ("USS 10,95")
const USD = /U\s?S\s?[$S5]\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d+\.\d{2}(?!\d))/gi;
const DATE = /\b(\d{2})\/(\d{2})\/(\d{4})\b/g;
const usdCents = (s: string) => (/,\d{2}$/.test(s) ? Math.round(Number(s.replace(/\./g, '').replace(',', '.')) * 100) : Math.round(Number(s) * 100));
const isoOf = (d: string, m: string, y: string): ISODate | null => {
  const iso = `${y}-${m}-${d}`;
  const t = new Date(iso + 'T12:00:00');
  return Number.isNaN(t.getTime()) || t.getUTCDate() !== Number(d) ? null : iso;
};
const amounts = (s: string) => [...s.matchAll(USD)].map((m) => usdCents(m[1]));
const dates = (s: string) => [...s.matchAll(DATE)].map((m) => isoOf(m[1], m[2], m[3])).filter((x): x is ISODate => !!x);

/** Investimentos de renda fixa em dólar do Inter (lista ou detalhe "Notas"). */
export function parseTimeDeposits(text: string, today: ISODate): TdGuess[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const isName = (l: string) => /^(TD\b|Time Deposit\s+\S|Meu Porquinho)/i.test(l) && !/^time deposit$/i.test(l) && !/U\s?S\s?[$S5]\s*\d/i.test(l);
  const nameIdx = lines.map((l, i) => (isName(l) ? i : -1)).filter((i) => i >= 0);
  const rate = text.match(/(\d{1,2}[.,]\d{1,2})\s*%\s*a\.?\s?a/i);
  const ratePct = rate ? Number(rate[1].replace(',', '.')) : undefined;
  const looksTd = nameIdx.length > 0 || /time deposit|valor aplicado|porquinho/i.test(text);
  if (!looksTd) return [];

  if (nameIdx.length <= 1) {
    const all = amounts(text);
    if (!all.length) return [];
    const ds = [...new Set(dates(text))].sort();
    const hasApplied = /valor\s+aplicado/i.test(text);
    const g: TdGuess = { name: nameIdx.length ? lines[nameIdx[0]] : 'Time Deposit', balanceUsdCents: Math.max(...all), ratePct };
    if (hasApplied && new Set(all).size > 1) g.appliedUsdCents = Math.min(...all);
    if (ds.length >= 2) { g.startDate = ds[0]; g.maturityDate = ds[ds.length - 1]; }
    else if (ds.length === 1) { if (ds[0] > today) g.maturityDate = ds[0]; else g.startDate = ds[0]; }
    return [g];
  }
  // lista com vários: cada nome pega o primeiro valor depois dele e a data logo acima (o selo de vencimento)
  return nameIdx.map((idx, k): TdGuess | null => {
    const stop = nameIdx[k + 1] ?? lines.length;
    const after = lines.slice(idx + 1, stop).join('\n');
    const before = lines.slice(Math.max(idx - 2, k ? nameIdx[k - 1] + 1 : 0), idx).join('\n');
    const v = amounts(after)[0];
    const d = dates(before)[0] ?? dates(after)[0];
    return v === undefined ? null : { name: lines[idx], balanceUsdCents: v, maturityDate: d && d > today ? d : undefined };
  }).filter((x): x is TdGuess => !!x);
}

/** Linha digitável dentro de um texto (47 ou 48 dígitos, com ou sem pontos e espaços). */
export function findBoleto(text: string, today: ISODate): BoletoInfo | null {
  const cands = text.match(/[\d][\d .\-]{42,70}\d/g) ?? [];
  for (const c of cands) {
    const digits = c.replace(/\D/g, '');
    if (digits.length !== 47 && digits.length !== 48) continue;
    const r = parseBoleto(digits, today);
    if (r.ok) return r.boleto;
  }
  return null;
}

export function readDocument(text: string, today: ISODate): DocGuess {
  const td = parseTimeDeposits(text, today);
  if (td.length) return { kind: 'td', items: td };
  const h = parseHoldings(text);
  if (h.length) return { kind: 'carteira', items: h };
  const b = findBoleto(text, today);
  if (b) return { kind: 'boleto', boleto: b };
  const r = parseReceipt(text, today);
  if (r.totalCents) return { kind: 'receipt', receipt: r };
  return { kind: 'unknown' };
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
/** Item em dólar já cadastrado que corresponde ao lido (mesmo nome, ou um contém o outro). */
export function matchHolding(holdings: UsdHolding[], name: string): UsdHolding | undefined {
  const n = norm(name);
  return holdings.find((h) => (h.kind === 'deposito' || h.kind === 'outro' || h.kind === 'conta') && norm(h.name) === n)
    ?? holdings.find((h) => h.kind === 'deposito' && (norm(h.name).includes(n) || n.includes(norm(h.name))));
}

/** Renda fixa em dólar: quanto falta para vencer e quanto deve valer no vencimento (estimativa pela taxa, juros compostos). */
export function depositOutlook(h: UsdHolding, today: ISODate): { daysLeft: number; totalDays?: number; pct?: number; atMaturityUsdCents?: number; gainSoFarUsdCents?: number } | null {
  if (h.kind !== 'deposito' || !h.maturityDate) return null;
  const daysLeft = Math.max(diffDays(h.maturityDate, today), 0);
  const totalDays = h.startDate ? Math.max(diffDays(h.maturityDate, h.startDate), 1) : undefined;
  const pct = totalDays ? Math.min(((totalDays - daysLeft) / totalDays) * 100, 100) : undefined;
  const bal = h.balanceUsdCents ?? 0;
  const atMaturityUsdCents = h.ratePct && bal ? Math.round(bal * Math.pow(1 + h.ratePct / 100, daysLeft / 365)) : undefined;
  const gainSoFarUsdCents = h.appliedUsdCents !== undefined && bal ? bal - h.appliedUsdCents : undefined;
  return { daysLeft, totalDays, pct, atMaturityUsdCents, gainSoFarUsdCents };
}

// ---------- Carteira (print da corretora/banco): ações, FIIs e ETFs da B3 e ações/ETFs dos EUA ----------
export interface HoldingGuess {
  market: 'b3' | 'us';
  ticker: string;
  quantity?: number;
  avgPriceCents?: number; // preço médio (R$ na B3; centavos de dólar nos EUA)
  valueCents?: number; // valor total mostrado
}
const B3 = /\b([A-Z]{4}(?:3|4|5|6|7|8|11|12|13|31|32|33|34|35))\b/;
const US = /\b([A-Z]{1,5})\b/;
const NOT_TICKER = new Set(['US', 'USD', 'BRL', 'BRA', 'TD', 'CDB', 'LCI', 'LCA', 'ETF', 'ETFS', 'REIT', 'REITS', 'IOF', 'IR', 'PM', 'R', 'S', 'SA', 'S/A', 'INC', 'LTD', 'CORP', 'TOTAL', 'VALOR', 'HOJE', 'DE', 'DO', 'DA', 'E', 'A', 'O', 'EM', 'NYSE', 'NASDAQ', 'B3', 'BDR', 'FII', 'FIIS', 'QTD', 'PRECO', 'PREÇO', 'MEDIO', 'MÉDIO', 'INTER', 'GLOBAL', 'APP', 'OK', 'VER', 'MAIS']);
const num = (s: string) => Number(/,\d{1,2}$/.test(s) || /\.\d{3}/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(',', '.'));
const BRL = /R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/;
const USDV = /U\s?S\s?[$S5]\s*(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})/;
const QTY = /(?:(?:qtd|quant(?:idade)?|cotas?|a[çc][õo]es|shares|unidades)\.?\s*:?\s*(\d+(?:[.,]\d+)?))|(?:(\d+(?:[.,]\d+)?)\s*(?:cotas?|a[çc][õo]es|shares|unidades|un\b))/i;
const AVG = /(?:pre[çc]o\s*m[ée]dio|\bPM\b|avg\.?\s*price|custo\s*m[ée]dio)\s*:?\s*(?:R\$|U\s?S\s?\$)?\s*(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})/i;
const moneyCents = (s: string) => { const v = s.replace(/[.,](\d{2})$/, '|$1').replace(/[.,]/g, '').replace('|', '.'); return Math.round(Number(v) * 100); };

/** Ativos lidos de um print de carteira. Cada ativo pega quantidade, preço médio e valor nas linhas logo abaixo dele. */
export function parseHoldings(text: string): HoldingGuess[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const isUsText = /U\s?S\s?\$|NYSE|NASDAQ|exterior|global/i.test(text);
  const out: HoldingGuess[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const b3 = lines[i].match(B3)?.[1];
    let us: string | undefined;
    if (!b3 && isUsText) {
      const m = lines[i].match(US)?.[1];
      // código americano: a linha é só o código (ou código + nome curto) e há valor em US$ por perto
      if (m && !NOT_TICKER.has(m) && /^[A-Z]{1,5}(\s|$)/.test(lines[i]) && lines.slice(i, i + 4).some((l) => USDV.test(l))) us = m;
    }
    const ticker = b3 ?? us;
    if (!ticker || seen.has(ticker)) continue;
    // o bloco do ativo vai até o próximo código (ou 5 linhas)
    let end = Math.min(i + 6, lines.length);
    for (let k = i + 1; k < end; k++) if (B3.test(lines[k]) || (isUsText && /^[A-Z]{1,5}$/.test(lines[k]) && !NOT_TICKER.has(lines[k]))) { end = k; break; }
    const blockLines = lines.slice(i, end);
    const block = blockLines.join('\n').replace(ticker, '');
    const q = block.match(QTY);
    const qty = q ? num(q[1] ?? q[2]) : undefined;
    const avg = block.match(AVG)?.[1];
    // valor total: um valor em linha que não é a do preço médio
    const valueLine = blockLines.find((l) => !AVG.test(l) && (b3 ? BRL : USDV).test(l));
    const val = valueLine ? (b3 ? valueLine.match(BRL) : valueLine.match(USDV))?.[1] : undefined;
    if (qty === undefined && !val) continue;
    seen.add(ticker);
    out.push({ market: b3 ? 'b3' : 'us', ticker, quantity: qty && qty > 0 ? qty : undefined, avgPriceCents: avg ? moneyCents(avg) : undefined, valueCents: val ? moneyCents(val) : undefined });
  }
  return out;
}
