import type { ISODate } from '../lib/types';

/**
 * Leitura de cupom fiscal / nota (NFC-e) a partir do texto reconhecido pela câmera (ML Kit, no aparelho).
 * Só sugere: o valor, a data e a loja aparecem no formulário para você conferir antes de salvar.
 */
export interface ReceiptGuess { merchant: string | null; totalCents: number | null; date: ISODate | null; cnpj: string | null }

const MONEY = /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/g;
const toCents = (s: string) => Math.round(Number(s.replace(/\./g, '').replace(',', '.')) * 100);
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/** Total: a linha de "VALOR TOTAL / VALOR A PAGAR / TOTAL R$ / VALOR PAGO" (ou a seguinte); sem ela, o maior valor com R$. */
function findTotal(lines: string[]): number | null {
  const KEY = /(VALOR\s+(TOTAL|A\s+PAGAR|PAGO)|TOTAL\s+(R\$|A\s+PAGAR|GERAL)|^TOTAL\b)/;
  const NOT = /(DESCONTO|TROCO|TRIBUTOS|IMPOSTOS|LEI\s+12\.?741|QTD|ITENS|SUBTOTAL)/;
  const found: number[] = [];
  lines.forEach((l, i) => {
    const n = norm(l);
    if (!KEY.test(n) || NOT.test(n)) return;
    const here = [...l.matchAll(MONEY)].map((m) => toCents(m[1]));
    const next = here.length ? here : [...(lines[i + 1] ?? '').matchAll(MONEY)].map((m) => toCents(m[1]));
    if (next.length) found.push(next[next.length - 1]);
  });
  if (found.length) return Math.max(...found);
  const withSymbol = lines.flatMap((l) => [...l.matchAll(/R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/g)].map((m) => toCents(m[1])));
  return withSymbol.length ? Math.max(...withSymbol) : null;
}

function findDate(lines: string[], today: ISODate): ISODate | null {
  for (const l of lines) {
    for (const m of l.matchAll(/\b(\d{2})\/(\d{2})\/(\d{2,4})\b/g)) {
      const [, d, mo, y] = m;
      const year = y.length === 2 ? 2000 + Number(y) : Number(y);
      const iso = `${year}-${mo}-${d}`;
      const dt = new Date(`${iso}T12:00:00`);
      const tooOld = year < Number(today.slice(0, 4)) - 1;
      if (Number.isNaN(dt.getTime()) || dt.getDate() !== Number(d) || iso > today || tooOld) continue;
      return iso;
    }
  }
  return null;
}

/** Loja: a primeira linha "de nome" do topo (pula CNPJ, endereço, títulos do documento). */
function findMerchant(lines: string[]): string | null {
  const SKIP = /(CNPJ|CPF|IE\b|I\.E|INSCRI|RUA|AV\.|AVENIDA|CEP|FONE|TEL|DOCUMENTO AUXILIAR|NFC-?E|NOTA FISCAL|CUPOM|EXTRATO|SAT\b|CONSUMIDOR|DANFE|^\W*$)/;
  for (const l of lines.slice(0, 8)) {
    const n = norm(l).trim();
    if (n.length < 3 || SKIP.test(n) || !/[A-Z]{3}/.test(n) || /\d{5,}/.test(n)) continue;
    return l.trim().replace(/\s+/g, ' ').slice(0, 60);
  }
  return null;
}

export function parseReceipt(text: string, today: ISODate): ReceiptGuess {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const cnpj = text.match(/\b(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})\b/)?.[1] ?? null;
  return { merchant: findMerchant(lines), totalCents: findTotal(lines), date: findDate(lines, today), cnpj };
}
