import type { AppData, Cents, ISODate, Transaction, YearMonth } from '../lib/types';
import { addDays, addMonthsYM, diffDays, makeDate, monthOf, monthRange } from '../lib/dates';
import { COMMITMENT_KINDS } from '../lib/categories';
import { effectiveDue, totalBalance } from './ledger';
import { computePositions } from './portfolio';

/**
 * Motor de análises locais (Etapa 8a). Tudo é calculado no aparelho, por regras explicáveis:
 * cada resultado traz os números que o justificam. Nada aqui recomenda produto financeiro.
 */

// ============================ AUXILIARES ============================

/** Descrição comparável: sem acento, sem números (datas, "3/10", códigos), sem pontuação, primeiras 4 palavras. */
export function normDesc(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(\d+\/\d+\)/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 4)
    .join(' ');
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const isExpense = (t: Transaction) => t.type === 'expense';
/** Gasto do dia a dia: não é conta fixa, assinatura, parcela nem ocorrência de recorrência. */
export const isVariable = (t: Transaction) => isExpense(t) && !COMMITMENT_KINDS.includes(t.kind) && !t.recurrenceId && !t.installment;

// ============================ GASTOS FORA DO PADRÃO ============================

export interface UnusualCategory {
  categoryId: string;
  curCents: Cents; // gasto no mês atual até hoje
  typicalCents: Cents; // mediana dos meses anteriores
  pct: number; // quanto acima do normal (%)
  months: number; // meses usados na comparação
}
export interface UnusualTx {
  tx: Transaction;
  typicalCents: Cents; // valor típico de um lançamento dessa categoria
  times: number; // quantas vezes o típico
}
export interface Unusual {
  categories: UnusualCategory[];
  transactions: UnusualTx[];
}

/**
 * Categoria fora do padrão: no mês atual já passou 30% (e pelo menos R$ 50) da mediana dos 6 meses anteriores,
 * com pelo menos 3 meses de histórico. Lançamento fora do padrão: 3 vezes o valor típico da categoria
 * (pelo menos 5 lançamentos para comparar) e no mínimo R$ 100, nos últimos 45 dias.
 */
export function unusualSpending(data: AppData, today: ISODate): Unusual {
  const ym = monthOf(today);
  const prevMonths = monthRange(addMonthsYM(ym, -6), addMonthsYM(ym, -1));
  const firstData = data.transactions.reduce<ISODate | null>((m, t) => (!m || t.date < m ? t.date : m), null);
  const usable = prevMonths.filter((m) => firstData && makeDate(m, 1) >= makeDate(monthOf(firstData), 1));
  const byCatMonth = new Map<string, Map<YearMonth, number>>();
  for (const t of data.transactions) {
    if (!isExpense(t)) continue;
    const m = monthOf(t.date);
    if (m !== ym && !usable.includes(m)) continue;
    const c = byCatMonth.get(t.categoryId) ?? new Map<YearMonth, number>();
    c.set(m, (c.get(m) ?? 0) + t.amountCents);
    byCatMonth.set(t.categoryId, c);
  }
  const categories: UnusualCategory[] = [];
  if (usable.length >= 3) {
    for (const [categoryId, months] of byCatMonth) {
      const cur = months.get(ym) ?? 0;
      const typical = median(usable.map((m) => months.get(m) ?? 0));
      if (typical <= 0 || cur < typical * 1.3 || cur - typical < 5000) continue;
      categories.push({ categoryId, curCents: cur, typicalCents: Math.round(typical), pct: ((cur - typical) / typical) * 100, months: usable.length });
    }
  }
  categories.sort((a, b) => b.curCents - b.typicalCents - (a.curCents - a.typicalCents));

  const transactions: UnusualTx[] = [];
  const since = addDays(today, -45);
  const yearAgo = addDays(today, -365);
  for (const t of data.transactions) {
    if (!isExpense(t) || t.installment || t.recurrenceId || t.date < since || t.date > today || t.amountCents < 10000) continue;
    const peers = data.transactions.filter((x) => x.id !== t.id && isExpense(x) && x.categoryId === t.categoryId && !x.installment && x.date >= yearAgo && x.date < t.date).map((x) => x.amountCents);
    if (peers.length < 5) continue;
    const typical = median(peers);
    if (typical > 0 && t.amountCents >= typical * 3) transactions.push({ tx: t, typicalCents: Math.round(typical), times: t.amountCents / typical });
  }
  transactions.sort((a, b) => b.times - a.times);
  return { categories, transactions: transactions.slice(0, 5) };
}

// ============================ ASSINATURAS E COBRANÇAS REPETIDAS ============================

export interface Subscription {
  key: string;
  name: string;
  monthlyCents: Cents;
  annualCents: Cents;
  months: number; // em quantos meses apareceu (ou há quanto tempo está cadastrada)
  lastDate: ISODate;
  /** Valor anterior quando o último ficou mais de 5% mais caro. */
  increasedFromCents?: Cents;
  source: 'cadastrada' | 'detectada';
}

/**
 * Junta as assinaturas cadastradas (recorrências ativas do tipo assinatura) com cobranças que se repetem
 * todo mês nos lançamentos: mesma descrição, valor parecido (±15%) e pelo menos 3 meses seguidos nos últimos 13.
 * Parcelas ficam de fora (têm fim). Uma cobrança que não aparece há mais de 45 dias é considerada encerrada.
 */
export function detectSubscriptions(data: AppData, today: ISODate): Subscription[] {
  const out: Subscription[] = [];
  const covered = new Set<string>();
  const ym = monthOf(today);
  for (const r of data.recurrences) {
    if (!r.active || r.type !== 'expense' || r.kind !== 'assinatura' || (r.endMonth && r.endMonth < ym)) continue;
    const occ = data.transactions.filter((t) => t.recurrenceId === r.id && t.date <= today).sort((a, b) => a.date.localeCompare(b.date));
    const last = occ[occ.length - 1];
    const prev = occ[occ.length - 2];
    covered.add(normDesc(r.description));
    out.push({ key: 'r:' + r.id, name: r.description, monthlyCents: r.amountCents, annualCents: r.amountCents * 12, months: monthRange(r.startMonth, ym).length, lastDate: last?.date ?? makeDate(r.startMonth, r.dayOfMonth), increasedFromCents: last && prev && last.amountCents > prev.amountCents * 1.05 ? prev.amountCents : undefined, source: 'cadastrada' });
  }
  const since = addDays(today, -400);
  const groups = new Map<string, Transaction[]>();
  for (const t of data.transactions) {
    if (!isExpense(t) || t.installment || t.recurrenceId || t.date < since || t.date > today) continue;
    const k = normDesc(t.description);
    if (!k || covered.has(k)) continue;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  for (const [k, list] of groups) {
    const byMonth = new Map<YearMonth, Transaction>();
    for (const t of list.sort((a, b) => a.date.localeCompare(b.date))) byMonth.set(monthOf(t.date), t); // um por mês: o último
    const months = [...byMonth.keys()].sort();
    if (months.length < 3) continue;
    // meses seguidos no fim da série (permite um mês de falha)
    let run = 1;
    for (let i = months.length - 1; i > 0; i--) {
      const gap = monthRange(months[i - 1], months[i]).length - 1;
      if (gap > 2) break;
      run++;
    }
    if (run < 3) continue;
    const recent = months.slice(-run).map((m) => byMonth.get(m)!);
    const med = median(recent.map((t) => t.amountCents));
    if (recent.filter((t) => Math.abs(t.amountCents - med) <= med * 0.15).length < Math.ceil(recent.length * 0.7)) continue;
    const last = recent[recent.length - 1];
    if (diffDays(today, last.date) > 45) continue;
    const prev = recent[recent.length - 2];
    out.push({ key: 'd:' + k, name: last.description, monthlyCents: last.amountCents, annualCents: last.amountCents * 12, months: run, lastDate: last.date, increasedFromCents: last.amountCents > prev.amountCents * 1.05 ? prev.amountCents : undefined, source: 'detectada' });
  }
  return out.sort((a, b) => b.monthlyCents - a.monthlyCents);
}

// ============================ COBRANÇAS EM DOBRO ============================

export interface DuplicatePair {
  key: string; // "idA|idB" em ordem, para poder ignorar
  a: Transaction;
  b: Transaction;
}

/**
 * Possíveis cobranças em dobro nos últimos 60 dias: mesmo valor, até 3 dias de diferença e mesma descrição
 * (ou, sem descrição parecida, mesma categoria, mesma forma de pagamento e mesmo cartão/conta).
 * Parcelas diferentes da mesma compra e meses diferentes da mesma recorrência não contam.
 */
export function findDuplicates(data: AppData, today: ISODate, ignored: string[] = []): DuplicatePair[] {
  const since = addDays(today, -60);
  const list = data.transactions.filter((t) => isExpense(t) && t.date >= since && t.date <= addDays(today, 31)).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  const skip = new Set(ignored);
  const out: DuplicatePair[] = [];
  const used = new Set<string>();
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (used.has(a.id)) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (diffDays(b.date, a.date) > 3) break;
      if (used.has(b.id) || a.amountCents !== b.amountCents) continue;
      if (a.installment && b.installment && a.installment.groupId === b.installment.groupId) continue;
      if (a.recurrenceId && a.recurrenceId === b.recurrenceId && a.recurrenceMonth !== b.recurrenceMonth) continue;
      const da = normDesc(a.description), db = normDesc(b.description);
      // extratos variam o fim da descrição ("UBER *TRIP"): basta a mesma primeira palavra, se ela não for curta
      const first = (s: string) => s.split(' ')[0] ?? '';
      const sameDesc = !!da && (da === db || (first(da).length >= 4 && first(da) === first(db)));
      const samePlace = a.categoryId === b.categoryId && a.paymentMethod === b.paymentMethod && (a.cardId ?? a.accountId ?? '') === (b.cardId ?? b.accountId ?? '') && (!da || !db);
      if (!sameDesc && !samePlace) continue;
      const key = [a.id, b.id].sort().join('|');
      if (skip.has(key)) continue;
      out.push({ key, a, b });
      used.add(a.id).add(b.id);
      break;
    }
  }
  return out;
}

// ============================ PREVISÃO DE CAIXA ============================

export interface ForecastMonth {
  ym: YearMonth;
  incomeCents: Cents; // receitas já lançadas ou recorrentes
  fixedCents: Cents; // contas lançadas, recorrentes e parcelas
  debtCents: Cents; // parcelas das dívidas cadastradas que não aparecem como lançamento
  variableCents: Cents; // estimativa dos gastos do dia a dia
  netCents: Cents;
  endBalanceCents: Cents;
}
export interface CashForecast {
  startCents: Cents; // saldo atual das contas
  variableMonthlyCents: Cents; // média dos gastos do dia a dia nos 3 últimos meses fechados
  variableBasisMonths: number;
  months: ForecastMonth[];
  firstNegative: YearMonth | null;
  lowest: ForecastMonth | null;
}

/**
 * Saldo das contas mês a mês, de hoje até `count` meses à frente:
 *   saldo de hoje + o que falta receber − o que falta pagar (lançado ou recorrente) − parcelas de dívidas − gasto do dia a dia estimado.
 * O gasto do dia a dia é a média dos 3 últimos meses fechados; no mês atual, só o que falta para chegar a essa média.
 * Parcelas de dívidas só entram se não houver um lançamento com o nome da dívida no mesmo mês (para não contar em dobro).
 */
export function cashForecast(data: AppData, today: ISODate, count: number): CashForecast {
  const ym = monthOf(today);
  const months = monthRange(ym, addMonthsYM(ym, count - 1));
  const start = totalBalance(data);

  const closed = [1, 2, 3].map((i) => addMonthsYM(ym, -i));
  const firstData = data.transactions.reduce<ISODate | null>((m, t) => (!m || t.date < m ? t.date : m), null);
  const basis = closed.filter((m) => firstData && monthOf(firstData) <= m);
  const variableBy = (m: YearMonth) => data.transactions.filter((t) => isVariable(t) && monthOf(t.date) === m).reduce((s, t) => s + t.amountCents, 0);
  const variableMonthly = basis.length ? Math.round(basis.reduce((s, m) => s + variableBy(m), 0) / basis.length) : 0;

  const pendingIn = (t: Transaction) => monthOf(t.type === 'expense' ? effectiveDue(t) : t.date);
  const existingRec = new Set(data.transactions.filter((t) => t.recurrenceId).map((t) => `${t.recurrenceId}|${t.recurrenceMonth}`));

  let bal = start;
  const out: ForecastMonth[] = [];
  months.forEach((m, idx) => {
    let income = 0, fixed = 0, debt = 0;
    const descs: string[] = [];
    for (const t of data.transactions) {
      if (t.status !== 'pending') continue;
      const tm = pendingIn(t);
      // no mês atual entram também as contas atrasadas
      if (tm !== m && !(idx === 0 && tm < m)) continue;
      if (t.type === 'income') income += t.amountCents;
      else {
        fixed += t.amountCents;
        descs.push(normDesc(t.description));
      }
    }
    for (const r of data.recurrences) {
      if (!r.active || r.startMonth > m || (r.endMonth && r.endMonth < m) || r.skipMonths?.includes(m) || existingRec.has(`${r.id}|${m}`)) continue;
      if (r.type === 'income') income += r.amountCents;
      else {
        fixed += r.amountCents;
        descs.push(normDesc(r.description));
      }
    }
    for (const d of data.debts) {
      if (d.installmentCents <= 0 || d.remainingInstallments <= 0) continue;
      // a próxima parcela vence no dia de vencimento deste mês ou do próximo
      const firstDue = makeDate(ym, d.dueDay) >= today ? ym : addMonthsYM(ym, 1);
      const k = monthRange(firstDue, m).length - 1;
      if (m < firstDue || k >= d.remainingInstallments) continue;
      const name = normDesc(d.name);
      if (name && descs.some((x) => x && (x.includes(name) || name.includes(x)))) continue;
      debt += d.installmentCents;
    }
    const variable = idx === 0 ? Math.max(variableMonthly - variableBy(m), 0) : variableMonthly;
    const net = income - fixed - debt - variable;
    bal += net;
    out.push({ ym: m, incomeCents: income, fixedCents: fixed, debtCents: debt, variableCents: variable, netCents: net, endBalanceCents: bal });
  });
  const firstNegative = out.find((x) => x.endBalanceCents < 0)?.ym ?? null;
  const lowest = out.reduce<ForecastMonth | null>((m, x) => (!m || x.endBalanceCents < m.endBalanceCents ? x : m), null);
  return { startCents: start, variableMonthlyCents: variableMonthly, variableBasisMonths: basis.length, months: out, firstNegative, lowest };
}

// ============================ COMPARADOR DE EMPRÉSTIMOS ============================

export interface LoanInput {
  amountCents: Cents; // valor pedido
  months: number;
  monthlyRatePct?: number; // juros nominais ao mês
  installmentCents?: Cents; // ou a parcela informada pelo banco (Price)
  feesCents: Cents; // tarifas, IOF e seguros cobrados à parte ou descontados do valor
  system: 'price' | 'sac';
}
export interface LoanResult {
  monthlyRatePct: number;
  firstInstallmentCents: Cents;
  lastInstallmentCents: Cents;
  totalPaidCents: Cents; // parcelas + tarifas
  interestCents: Cents; // só juros
  costCents: Cents; // tudo o que paga além do valor pedido
  cetMonthlyPct: number;
  cetAnnualPct: number;
  schedule: Cents[]; // parcelas mês a mês
}

/** Taxa mensal (%) que faz uma parcela Price fixa pagar o valor em n meses. Busca binária. */
export function rateFromInstallment(amountCents: Cents, installmentCents: Cents, n: number): number | null {
  if (amountCents <= 0 || installmentCents <= 0 || n <= 0 || installmentCents * n < amountCents) return null;
  if (installmentCents * n === amountCents) return 0;
  const pv = (i: number) => (installmentCents * (1 - Math.pow(1 + i, -n))) / i;
  let lo = 1e-9, hi = 1;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    if (pv(mid) > amountCents) lo = mid;
    else hi = mid;
  }
  return ((lo + hi) / 2) * 100;
}

/** Taxa interna de retorno mensal (%) de quem recebe `received` hoje e paga `payments` nos meses 1..n. */
export function irrMonthly(received: number, payments: number[]): number | null {
  const total = payments.reduce((s, p) => s + p, 0);
  if (received <= 0 || total < received) return null;
  const pv = (i: number) => payments.reduce((s, p, k) => s + p / Math.pow(1 + i, k + 1), 0);
  let lo = 0, hi = 1;
  if (pv(lo) <= received) return 0;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    if (pv(mid) > received) lo = mid;
    else hi = mid;
  }
  return ((lo + hi) / 2) * 100;
}

export const annualFromMonthlyPct = (pct: number) => (Math.pow(1 + pct / 100, 12) - 1) * 100;

/**
 * Simula um empréstimo pela Tabela Price (parcelas iguais) ou SAC (amortização constante, parcelas decrescentes).
 * O CET considera que as tarifas reduzem o dinheiro que chega à sua mão: é a taxa que iguala o valor líquido recebido
 * às parcelas. É uma estimativa: o CET oficial do contrato é o que vale.
 */
export function simulateLoan(input: LoanInput): LoanResult | null {
  const { amountCents: P, months: n, feesCents, system } = input;
  if (P <= 0 || n <= 0 || n > 600 || feesCents < 0 || feesCents >= P) return null;
  const rate = input.monthlyRatePct ?? (input.installmentCents ? rateFromInstallment(P, input.installmentCents, n) : null);
  if (rate === null || rate === undefined || rate < 0 || rate > 50) return null;
  const i = rate / 100;
  const schedule: number[] = [];
  if (system === 'price') {
    const pmt = input.installmentCents && input.monthlyRatePct === undefined ? input.installmentCents : i === 0 ? P / n : (P * i) / (1 - Math.pow(1 + i, -n));
    for (let k = 0; k < n; k++) schedule.push(pmt);
  } else {
    const amort = P / n;
    for (let k = 0; k < n; k++) schedule.push(amort + (P - amort * k) * i);
  }
  const rounded = schedule.map((x) => Math.round(x));
  const paid = rounded.reduce((s, x) => s + x, 0);
  const cet = irrMonthly(P - feesCents, schedule) ?? rate;
  return {
    monthlyRatePct: rate,
    firstInstallmentCents: rounded[0],
    lastInstallmentCents: rounded[n - 1],
    totalPaidCents: paid + feesCents,
    interestCents: paid - P,
    costCents: paid + feesCents - P,
    cetMonthlyPct: cet,
    cetAnnualPct: annualFromMonthlyPct(cet),
    schedule: rounded,
  };
}

// ============================ RAIO-X DA CARTEIRA ============================

export type AssetClass = 'acao' | 'fii' | 'etf' | 'renda_fixa' | 'cripto';
export const CLASS_LABEL: Record<AssetClass, string> = { acao: 'Ações', fii: 'Fundos imobiliários', etf: 'ETFs', renda_fixa: 'Renda fixa', cripto: 'Cripto' };

export interface PortfolioXray {
  totalCents: Cents;
  classes: { cls: AssetClass; cents: Cents; pct: number }[];
  items: { name: string; cls: AssetClass; cents: Cents; pct: number }[];
  /** Número efetivo de itens (1 ÷ soma dos pesos ao quadrado): 1 = tudo num só; quanto maior, mais espalhado. */
  effectiveItems: number;
  top3Pct: number;
  maturing: { name: string; date: ISODate; cents: Cents }[]; // renda fixa vencendo em até 30 dias
  unquoted: number;
}

export function portfolioXray(data: AppData, today: ISODate): PortfolioXray {
  const items: PortfolioXray['items'] = [];
  let unquoted = 0;
  for (const p of computePositions(data.assets, data.operations)) {
    if (p.quantity <= 0) continue;
    if (p.priceCents === null) unquoted++;
    items.push({ name: p.asset.ticker, cls: p.asset.type, cents: p.valueCents, pct: 0 });
  }
  for (const p of computePositions(data.cryptoAssets, data.cryptoOps)) {
    if (p.quantity <= 0) continue;
    if (p.priceCents === null) unquoted++;
    items.push({ name: p.asset.symbol, cls: 'cripto', cents: p.valueCents, pct: 0 });
  }
  for (const f of data.fixedIncomes) if (!f.maturityDate || f.maturityDate >= today) items.push({ name: f.name, cls: 'renda_fixa', cents: f.currentCents, pct: 0 });
  const total = items.reduce((s, x) => s + Math.max(x.cents, 0), 0);
  for (const x of items) x.pct = total > 0 ? (Math.max(x.cents, 0) / total) * 100 : 0;
  items.sort((a, b) => b.cents - a.cents);
  const byClass = new Map<AssetClass, number>();
  for (const x of items) byClass.set(x.cls, (byClass.get(x.cls) ?? 0) + Math.max(x.cents, 0));
  const classes = [...byClass.entries()].map(([cls, cents]) => ({ cls, cents, pct: total > 0 ? (cents / total) * 100 : 0 })).sort((a, b) => b.cents - a.cents);
  const hhi = items.reduce((s, x) => s + (x.pct / 100) ** 2, 0);
  const maturing = data.fixedIncomes.filter((f) => f.maturityDate && f.maturityDate >= today && diffDays(f.maturityDate, today) <= 30).map((f) => ({ name: f.name, date: f.maturityDate!, cents: f.currentCents }));
  return { totalCents: total, classes, items, effectiveItems: hhi > 0 ? 1 / hhi : 0, top3Pct: items.slice(0, 3).reduce((s, x) => s + x.pct, 0), maturing, unquoted };
}
