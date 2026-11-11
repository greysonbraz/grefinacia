import type { ISODate, YearMonth } from './types';

const p2 = (n: number) => String(n).padStart(2, '0');

export function toISO(d: Date): ISODate {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}
export function parseISO(s: ISODate): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0); // meio-dia evita problemas de horário de verão
}
export function todayISO(now: Date = new Date()): ISODate {
  return toISO(now);
}
export function monthOf(d: ISODate): YearMonth {
  return d.slice(0, 7);
}
export function ymParts(ym: YearMonth): [number, number] {
  const [y, m] = ym.split('-').map(Number);
  return [y, m];
}
export function daysInMonth(ym: YearMonth): number {
  const [y, m] = ymParts(ym);
  return new Date(y, m, 0).getDate();
}
export function makeDate(ym: YearMonth, day: number): ISODate {
  return `${ym}-${p2(Math.min(Math.max(day, 1), daysInMonth(ym)))}`;
}
export function addMonthsYM(ym: YearMonth, n: number): YearMonth {
  const [y, m] = ymParts(ym);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${p2((t % 12) + 1)}`;
}
/** Soma meses preservando o dia (ajusta p/ o último dia do mês quando necessário). */
export function addMonths(d: ISODate, n: number): ISODate {
  return makeDate(addMonthsYM(monthOf(d), n), Number(d.slice(8, 10)));
}
export function addDays(d: ISODate, n: number): ISODate {
  const x = parseISO(d);
  x.setDate(x.getDate() + n);
  return toISO(x);
}
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((parseISO(a).getTime() - parseISO(b).getTime()) / 86400000);
}
export function monthRange(from: YearMonth, to: YearMonth): YearMonth[] {
  const out: YearMonth[] = [];
  for (let m = from; m <= to; m = addMonthsYM(m, 1)) out.push(m);
  return out;
}
export function lastMonths(ym: YearMonth, count: number): YearMonth[] {
  return monthRange(addMonthsYM(ym, -(count - 1)), ym);
}
export function endOfMonth(ym: YearMonth): ISODate {
  return makeDate(ym, 31);
}

/** 11/11/2026 */
export function formatDateBR(d: ISODate): string {
  const [y, m, dd] = d.slice(0, 10).split('-');
  return `${dd}/${m}/${y}`;
}
export function formatDayMonth(d: ISODate): string {
  const [, m, dd] = d.slice(0, 10).split('-');
  return `${dd}/${m}`;
}
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export function monthLong(ym: YearMonth): string {
  const [y, m] = ymParts(ym);
  return `${MONTHS[m - 1]} de ${y}`;
}
export function monthName(ym: YearMonth): string {
  return MONTHS[ymParts(ym)[1] - 1];
}
export function monthShort(ym: YearMonth): string {
  return MONTHS_SHORT[ymParts(ym)[1] - 1];
}
export function monthShortYear(ym: YearMonth): string {
  const [y, m] = ymParts(ym);
  return `${MONTHS_SHORT[m - 1]}/${String(y).slice(2)}`;
}
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export function weekdayShort(d: ISODate): string {
  return WEEKDAYS[parseISO(d).getDay()];
}
export function weekdayOfFirst(ym: YearMonth): number {
  return parseISO(`${ym}-01`).getDay();
}
/** "hoje", "amanhã", "em 3 dias", "há 2 dias" */
export function relativeDays(d: ISODate, today: ISODate): string {
  const n = diffDays(d, today);
  if (n === 0) return 'hoje';
  if (n === 1) return 'amanhã';
  if (n === -1) return 'ontem';
  return n > 0 ? `em ${n} dias` : `há ${-n} dias`;
}
export function nowISOTime(): string {
  return new Date().toISOString();
}

export const capFirst = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
