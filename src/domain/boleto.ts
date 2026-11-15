import type { Cents, ISODate } from '../lib/types';
import { addDays, diffDays } from '../lib/dates';

/**
 * Leitura da linha digitável de boletos. Tudo calculado no aparelho, sem consultar banco nenhum.
 *
 * - 47 dígitos: boleto bancário (valor e vencimento vêm na linha).
 * - 48 dígitos: conta de consumo/arrecadação (água, luz, impostos): só o valor vem na linha.
 * O app apenas lê e lembra do vencimento; nunca paga nada.
 */
export interface BoletoInfo {
  kind: 'bancario' | 'arrecadacao';
  line: string; // só os dígitos
  amountCents: Cents | null; // null = boleto sem valor definido
  dueDate: ISODate | null;
  bankCode: string | null;
}
export type BoletoResult = { ok: true; boleto: BoletoInfo } | { ok: false; error: string };

const BASE = '1997-10-07';
/** Em 22/02/2025 o contador de vencimento (4 dígitos) chegou a 9999 e voltou para 1000. */
const NEW_BASE = '2025-02-22';

function mod10(digits: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = digits.length - 1; i >= 0; i--) {
    const p = Number(digits[i]) * weight;
    sum += p > 9 ? p - 9 : p;
    weight = weight === 2 ? 1 : 2;
  }
  return (10 - (sum % 10)) % 10;
}
function mod11Arrecadacao(digits: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += Number(digits[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const r = sum % 11;
  return r === 0 || r === 1 ? 0 : 11 - r;
}
function mod11Bancario(digits: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += Number(digits[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const r = 11 - (sum % 11);
  return r === 0 || r === 10 || r === 11 ? 1 : r;
}

/** Converte o fator de vencimento em data. Depois da virada de 2025 o mesmo número vale para duas datas: fica a mais próxima de hoje. */
export function dueDateFromFactor(factor: number, today: ISODate): ISODate | null {
  if (!Number.isInteger(factor) || factor <= 0) return null;
  const oldCycle = addDays(BASE, factor);
  if (factor < 1000) return oldCycle;
  const newCycle = addDays(NEW_BASE, factor - 1000);
  return Math.abs(diffDays(newCycle, today)) <= Math.abs(diffDays(oldCycle, today)) ? newCycle : oldCycle;
}

export function parseBoleto(input: string, today: ISODate): BoletoResult {
  const line = (input ?? '').replace(/\D/g, '');
  if (line.length === 0) return { ok: false, error: 'Informe a linha digitável.' };
  if (line.length === 47) {
    const f1 = line.slice(0, 10), f2 = line.slice(10, 21), f3 = line.slice(21, 32);
    for (const f of [f1, f2, f3]) if (mod10(f.slice(0, -1)) !== Number(f.slice(-1))) return { ok: false, error: 'Linha digitável inválida: confira os números.' };
    const factor = line.slice(33, 37), value = line.slice(37, 47);
    // código de barras = banco+moeda, dígito geral, fator, valor, campo livre
    const barcodeNoDv = line.slice(0, 4) + factor + value + f1.slice(4, 9) + f2.slice(0, 10) + f3.slice(0, 10);
    if (mod11Bancario(barcodeNoDv) !== Number(line[32])) return { ok: false, error: 'Linha digitável inválida: confira os números.' };
    const cents = Number(value);
    return { ok: true, boleto: { kind: 'bancario', line, amountCents: cents > 0 ? cents : null, dueDate: dueDateFromFactor(Number(factor), today), bankCode: line.slice(0, 3) } };
  }
  if (line.length === 48) {
    if (line[0] !== '8') return { ok: false, error: 'Linha digitável inválida: confira os números.' };
    const blocks = [0, 12, 24, 36].map((i) => line.slice(i, i + 12));
    const useMod10 = line[2] === '6' || line[2] === '7';
    for (const b of blocks) {
      const dv = useMod10 ? mod10(b.slice(0, 11)) : mod11Arrecadacao(b.slice(0, 11));
      if (dv !== Number(b[11])) return { ok: false, error: 'Linha digitável inválida: confira os números.' };
    }
    const barcode = blocks.map((b) => b.slice(0, 11)).join('');
    const cents = Number(barcode.slice(4, 15));
    return { ok: true, boleto: { kind: 'arrecadacao', line, amountCents: cents > 0 ? cents : null, dueDate: null, bankCode: null } };
  }
  return { ok: false, error: `A linha digitável tem 47 ou 48 números; foram informados ${line.length}.` };
}

/** Mostra a linha em grupos, como no boleto impresso. */
export function formatBoletoLine(line: string): string {
  const d = line.replace(/\D/g, '');
  if (d.length === 47) return `${d.slice(0, 5)}.${d.slice(5, 10)} ${d.slice(10, 15)}.${d.slice(15, 21)} ${d.slice(21, 26)}.${d.slice(26, 32)} ${d[32]} ${d.slice(33)}`;
  if (d.length === 48) return [0, 12, 24, 36].map((i) => `${d.slice(i, i + 11)}-${d[i + 11]}`).join(' ');
  return d;
}
