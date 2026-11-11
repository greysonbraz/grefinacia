import type { Cents } from './types';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brlNoSymbol = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 8 });
const pctFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Arredonda para o inteiro mais próximo, meios-valores afastando do zero (evita erros de ponto flutuante). */
export function roundHalfAway(x: number): number {
  const r = Math.round(Math.abs(x) + 1e-9);
  return x < 0 ? -r : r;
}

/** Multiplica centavos por um fator e devolve centavos inteiros. */
export function mulCents(cents: Cents, factor: number): Cents {
  return roundHalfAway(cents * factor);
}

/** R$ 1.234,56 */
export function formatBRL(cents: Cents): string {
  return brl.format(cents / 100);
}
export function formatNumberBRL(cents: Cents): string {
  return brlNoSymbol.format(cents / 100);
}
/** Valor por cota/ação com até 4 casas quando necessário (ex.: R$ 0,0912). */
export function formatRate(rate: number): string {
  const s = num.format(Math.round(rate * 1e8) / 1e8);
  return 'R$ ' + (s.includes(',') ? s : s + ',00');
}
export function formatQty(q: number): string {
  return num.format(q);
}
export function formatPct(p: number, withSign = false): string {
  const s = pctFmt.format(p) + '%';
  return withSign && p > 0 ? '+' + s : s;
}
/** Valor compacto para eixos de gráfico: R$ 1,2 mil */
export function formatCompact(cents: Cents): string {
  const v = cents / 100;
  const a = Math.abs(v);
  if (a >= 1e6) return `R$ ${(v / 1e6).toFixed(1).replace('.', ',')} mi`;
  if (a >= 1e3) return `R$ ${(v / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace('.', ',')} mil`;
  return `R$ ${Math.round(v)}`;
}

/**
 * Converte o que o usuário digitou ("1.234,56", "1234,5", "1234.56", "R$ 12") em centavos.
 * Faz o cálculo por texto (sem ponto flutuante). Retorna null se inválido.
 */
export function parseMoney(input: string): Cents | null {
  let s = input.replace(/R\$/gi, '').replace(/\s/g, '');
  if (!s) return null;
  let neg = false;
  if (s.startsWith('-')) {
    neg = true;
    s = s.slice(1);
  }
  if (!/^[0-9.,]+$/.test(s)) return null;
  let intPart: string;
  let frac = '';
  if (s.includes(',')) {
    const i = s.lastIndexOf(',');
    intPart = s.slice(0, i).replace(/\./g, '');
    frac = s.slice(i + 1);
    if (frac.includes('.')) return null;
  } else if (s.includes('.')) {
    const parts = s.split('.');
    const last = parts[parts.length - 1];
    if (parts.length === 2 && last.length !== 3) {
      intPart = parts[0];
      frac = last;
    } else if (parts.length > 2 && last.length !== 3) {
      return null;
    } else {
      intPart = parts.join(''); // "1.234" ou "1.234.567" = milhares (padrão pt-BR)
    }
  } else {
    intPart = s;
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac)) return null;
  if (intPart === '' && frac === '') return null;
  const f3 = (frac + '000').slice(0, 3);
  let cents = Number(intPart || '0') * 100 + Number(f3.slice(0, 2));
  if (Number(f3[2]) >= 5) cents += 1;
  return neg ? -cents : cents;
}

/** Número decimal (quantidade ou valor por cota) digitado no padrão brasileiro. */
export function parseDecimal(input: string): number | null {
  const s = input.replace(/\s/g, '');
  if (!s) return null;
  let norm: string;
  if (s.includes(',')) norm = s.replace(/\./g, '').replace(',', '.');
  else if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(s)) norm = s.replace(/\./g, ''); // "1.000" = mil (padrão pt-BR)
  else norm = s;
  if (!/^-?\d*\.?\d+$/.test(norm) && !/^-?\d+\.?$/.test(norm)) return null;
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

export function centsToInput(cents: Cents): string {
  const sign = cents < 0 ? '-' : '';
  const a = Math.abs(cents);
  return `${sign}${Math.floor(a / 100)},${String(a % 100).padStart(2, '0')}`;
}

export function sum(xs: number[]): number {
  let t = 0;
  for (const x of xs) t += x;
  return t;
}

/** Variação percentual entre dois valores; null quando a base é zero. */
export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
