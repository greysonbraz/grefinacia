import type { AppData, Cents, DividendKind, ISODate, Transaction, YearMonth } from '../lib/types';
import { addDays, addMonthsYM, diffDays, monthOf, monthRange } from '../lib/dates';
import { dividendRows, forecastMonth, isPending, isReceived, type DividendRow } from './dividends';
import { computePositions, sortedOps } from './portfolio';

/**
 * Renda passiva (Etapa 11): o que foi RECEBIDO (confirmado), o que está a receber e o que é só estimativa,
 * sempre separados. Nada previsto entra como dinheiro recebido.
 */

// ============================ PAINEL ============================

export interface PassiveMonth {
  ym: YearMonth;
  receivedCents: Cents; // confirmado
  announcedCents: Cents; // anunciado, a receber
  estimatedCents: Cents; // projeção pelo histórico (meses futuros)
}

export interface PassiveDashboard {
  monthCents: Cents; // recebido no mês atual
  yearCents: Cents; // recebido no ano
  totalCents: Cents; // recebido desde sempre
  avgMonthlyCents: Cents; // média dos últimos 12 meses (ou desde o primeiro recebimento, se for mais recente)
  avgMonths: number;
  awaitingCents: Cents; // data de pagamento passou e ainda não foi confirmado
  awaitingCount: number;
  upcomingAnnouncedCents: Cents; // anunciado para os próximos meses
  upcomingEstimatedCents: Cents;
  months: PassiveMonth[]; // 12 meses para trás + `ahead` para frente
  byAsset: { assetId: string; ticker: string; receivedCents: Cents; pendingCents: Cents }[];
  byKind: { kind: DividendKind; receivedCents: Cents }[];
}

export function passiveDashboard(data: AppData, today: ISODate, ahead = 6): PassiveDashboard {
  const rows = dividendRows(data, today);
  const ym = monthOf(today);
  const received = rows.filter(isReceived);
  const recMonth = (r: DividendRow) => monthOf(r.event.receivedAt!);
  const sum = (xs: DividendRow[]) => xs.reduce((t, r) => t + r.netCents, 0);

  const first = received.reduce<YearMonth | null>((m, r) => (!m || recMonth(r) < m ? recMonth(r) : m), null);
  const past = monthRange(addMonthsYM(ym, -11), ym);
  const avgMonths = first ? Math.min(12, past.filter((m) => m >= first).length) : 0;
  const last12 = sum(received.filter((r) => recMonth(r) >= past[0]));

  const months: PassiveMonth[] = [];
  for (const m of past) months.push({ ym: m, receivedCents: sum(received.filter((r) => recMonth(r) === m)), announcedCents: m === ym ? sum(rows.filter((r) => isPending(r) && r.event.paymentDate && monthOf(r.event.paymentDate) === m && r.event.paymentDate >= today)) : 0, estimatedCents: 0 });
  let upA = 0, upE = 0;
  for (let i = 1; i <= ahead; i++) {
    const m = addMonthsYM(ym, i);
    const f = forecastMonth(data, m, today);
    months.push({ ym: m, receivedCents: 0, announcedCents: f.officialCents, estimatedCents: f.estimatedCents });
    upA += f.officialCents;
    upE += f.estimatedCents;
  }

  const awaiting = rows.filter((r) => r.status === 'aguardando_confirmacao');
  const byAssetMap = new Map<string, { assetId: string; ticker: string; receivedCents: Cents; pendingCents: Cents }>();
  for (const r of rows) {
    const a = byAssetMap.get(r.asset.id) ?? { assetId: r.asset.id, ticker: r.asset.ticker, receivedCents: 0, pendingCents: 0 };
    if (isReceived(r)) a.receivedCents += r.netCents;
    else if (isPending(r)) a.pendingCents += r.netCents;
    byAssetMap.set(r.asset.id, a);
  }
  const byKindMap = new Map<DividendKind, Cents>();
  for (const r of received) byKindMap.set(r.event.kind, (byKindMap.get(r.event.kind) ?? 0) + r.netCents);

  return {
    monthCents: sum(received.filter((r) => recMonth(r) === ym)),
    yearCents: sum(received.filter((r) => r.event.receivedAt!.slice(0, 4) === today.slice(0, 4))),
    totalCents: sum(received),
    avgMonthlyCents: avgMonths ? Math.round(last12 / avgMonths) : 0,
    avgMonths,
    awaitingCents: sum(awaiting),
    awaitingCount: awaiting.length,
    upcomingAnnouncedCents: upA,
    upcomingEstimatedCents: upE,
    months,
    byAsset: [...byAssetMap.values()].filter((a) => a.receivedCents || a.pendingCents).sort((a, b) => b.receivedCents + b.pendingCents - (a.receivedCents + a.pendingCents)),
    byKind: [...byKindMap.entries()].map(([kind, receivedCents]) => ({ kind, receivedCents })).sort((a, b) => b.receivedCents - a.receivedCents),
  };
}

// ============================ CONFIRMAÇÃO PELO EXTRATO ============================

const plain = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9/ ]/g, ' ').replace(/\s+/g, ' ');
/** Palavras que bancos e corretoras usam no crédito de proventos. */
export const PROVENTO_WORDS = /\b(dividendo|dividendos|div|jcp|jscp|juros s ?\/? ?cap|juros sobre capital|juros sobre o capital|rendimento|rendimentos|rend|provento|proventos)\b/;

export interface ReceiptMatch {
  eventId: string;
  txId: string;
  how: 'codigo' | 'palavra';
}

/**
 * Procura, nas receitas lançadas ou importadas, o crédito de cada provento a receber:
 * - mesmo código do ativo na descrição (ex.: "ITSA4") e valor igual ao líquido ou ao bruto (tolerância de 1% ou 2 centavos); ou
 * - palavra de provento + o prefixo do código (ex.: "JCP ITSA") e valor igual com tolerância menor (0,5%);
 * - data entre 3 dias antes e 10 dias depois do pagamento (sem data de pagamento: até 120 dias depois da data-com).
 * Cada crédito confirma um provento só. Créditos já ligados a outro provento ficam de fora.
 */
export function matchReceipts(data: AppData, today: ISODate): ReceiptMatch[] {
  const used = new Set(data.dividends.map((d) => d.receivedTxId).filter(Boolean) as string[]);
  const income = data.transactions.filter((t) => t.type === 'income' && !used.has(t.id) && t.date <= today && t.source !== 'dividend');
  const candidates = dividendRows(data, today).filter((r) => r.status === 'aguardando_confirmacao' || r.status === 'pagamento_previsto' || r.status === 'direito_adquirido');
  const scored: { eventId: string; txId: string; how: ReceiptMatch['how']; diff: number }[] = [];
  for (const r of candidates) {
    const e = r.event;
    const from = e.paymentDate ? addDays(e.paymentDate, -3) : e.dataCom ? addDays(e.dataCom, 1) : null;
    const to = e.paymentDate ? addDays(e.paymentDate, 10) : e.dataCom ? addDays(e.dataCom, 120) : null;
    if (!from || !to) continue;
    const ticker = r.asset.ticker.toLowerCase();
    const root = ticker.replace(/\d+[a-z]?$/, '');
    for (const t of income) {
      if (t.date < from || t.date > to) continue;
      const d = plain(t.description);
      const words = ` ${d} `;
      const hasTicker = new RegExp(`\\b${ticker}\\b`).test(d);
      const hasRoot = root.length >= 4 && new RegExp(`\\b${root}`).test(d) && PROVENTO_WORDS.test(words);
      if (!hasTicker && !hasRoot) continue;
      const diff = Math.min(Math.abs(t.amountCents - r.netCents), Math.abs(t.amountCents - r.grossCents));
      const tol = hasTicker ? Math.max(2, r.netCents * 0.01) : Math.max(2, r.netCents * 0.005);
      if (diff > tol) continue;
      scored.push({ eventId: e.id, txId: t.id, how: hasTicker ? 'codigo' : 'palavra', diff: diff + (hasTicker ? 0 : 0.5) + Math.abs(diffDays(t.date, e.paymentDate ?? t.date)) / 1000 });
    }
  }
  scored.sort((a, b) => a.diff - b.diff);
  const out: ReceiptMatch[] = [];
  const evDone = new Set<string>(), txDone = new Set<string>();
  for (const s of scored) {
    if (evDone.has(s.eventId) || txDone.has(s.txId)) continue;
    out.push({ eventId: s.eventId, txId: s.txId, how: s.how });
    evDone.add(s.eventId);
    txDone.add(s.txId);
  }
  return out;
}

/** Crédito já lançado que corresponde a um provento (para "Recebi" ligar em vez de criar outro lançamento). */
export function findReceiptFor(data: AppData, eventId: string, today: ISODate): Transaction | undefined {
  const m = matchReceipts(data, today).find((x) => x.eventId === eventId);
  return m ? data.transactions.find((t) => t.id === m.txId) : undefined;
}

// ============================ RENTABILIDADE TOTAL ============================

export interface AssetReturn {
  assetId: string;
  ticker: string;
  investedCents: Cents; // tudo o que você pôs (compras + custos)
  soldCents: Cents; // o que entrou com vendas (já sem custos)
  valueCents: Cents; // valor de mercado hoje (sem cotação: custo)
  priced: boolean;
  appreciationCents: Cents; // valorização da posição atual (valor − custo)
  realizedCents: Cents; // lucro ou prejuízo já realizado em vendas
  dividendsCents: Cents; // proventos RECEBIDOS (confirmados, líquidos)
  totalCents: Cents; // valorização + realizado + proventos
  totalPct: number | null; // sobre o total investido
}

export interface TotalReturn {
  assets: AssetReturn[];
  investedCents: Cents;
  valueCents: Cents; // patrimônio atual em bolsa
  appreciationCents: Cents;
  realizedCents: Cents;
  dividendsReceivedCents: Cents; // dinheiro que já caiu
  dividendsAwaitingCents: Cents; // data passou, sem confirmação (não conta)
  dividendsUpcomingCents: Cents; // anunciados a receber (não conta)
  totalCents: Cents;
  totalPct: number | null;
}

/**
 * Rentabilidade total da bolsa: valorização + vendas + proventos recebidos − custos. Impostos conhecidos: o IR do JCP
 * já sai do valor líquido; IR sobre lucro de vendas não é calculado aqui. Proventos a receber aparecem à parte.
 */
export function totalReturn(data: AppData, today: ISODate): TotalReturn {
  const positions = computePositions(data.assets, data.operations);
  const rows = dividendRows(data, today);
  const assets: AssetReturn[] = [];
  for (const p of positions) {
    let invested = 0, sold = 0;
    for (const o of sortedOps(data.operations)) {
      if (o.assetId !== p.asset.id) continue;
      if (o.side === 'buy') invested += o.quantity * o.priceCents + o.feesCents;
      else sold += o.quantity * o.priceCents - o.feesCents;
    }
    if (invested <= 0) continue;
    const dividends = rows.filter((r) => r.asset.id === p.asset.id && isReceived(r)).reduce((t, r) => t + r.netCents, 0);
    const appreciation = p.quantity > 0 ? p.valueCents - p.costCents : 0;
    const total = appreciation + p.realizedCents + dividends;
    assets.push({ assetId: p.asset.id, ticker: p.asset.ticker, investedCents: Math.round(invested), soldCents: Math.round(sold), valueCents: p.quantity > 0 ? p.valueCents : 0, priced: p.priceCents !== null || p.quantity === 0, appreciationCents: appreciation, realizedCents: p.realizedCents, dividendsCents: dividends, totalCents: total, totalPct: (total / invested) * 100 });
  }
  const s = (k: keyof AssetReturn) => assets.reduce((t, a) => t + (a[k] as number), 0);
  const invested = s('investedCents');
  const total = s('totalCents');
  return {
    assets: assets.sort((a, b) => b.totalCents - a.totalCents),
    investedCents: invested,
    valueCents: s('valueCents'),
    appreciationCents: s('appreciationCents'),
    realizedCents: s('realizedCents'),
    dividendsReceivedCents: s('dividendsCents'),
    dividendsAwaitingCents: rows.filter((r) => r.status === 'aguardando_confirmacao').reduce((t, r) => t + r.netCents, 0),
    dividendsUpcomingCents: rows.filter((r) => isPending(r) && r.status !== 'aguardando_confirmacao').reduce((t, r) => t + r.netCents, 0),
    totalCents: total,
    totalPct: invested > 0 ? (total / invested) * 100 : null,
  };
}
