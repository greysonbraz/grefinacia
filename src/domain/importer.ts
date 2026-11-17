import type { AppData, Card, ImportBatch, ISODate, PaymentMethod, Settings, Transaction, TxKind } from '../lib/types';
import { diffDays, todayISO } from '../lib/dates';
import { cardInvoiceDue } from './ledger';
import { normDesc } from './analysis';
import type { Statement, StatementRow } from './statement';

/**
 * Da leitura do extrato até os lançamentos (Etapa 9): sugere categoria, aponta duplicados e pagamento de fatura,
 * e monta os lançamentos de quem a pessoa marcou. Funções puras; quem grava é o store.
 */

export type Target = { kind: 'conta'; accountId: string } | { kind: 'cartao'; cardId: string };

export interface PreviewRow {
  key: string; // posição na lista, estável durante a prévia
  row: StatementRow;
  type: 'income' | 'expense';
  amountCents: number; // sempre positivo
  categoryId: string;
  categorySource: 'regra' | 'historico' | 'banco' | 'palavra' | 'padrao';
  /** Situação que pede atenção: já importado, parecido com um lançamento existente, pagamento de fatura, repetido no arquivo. */
  flag?: 'importado' | 'possivel' | 'fatura' | 'repetido';
  flagNote?: string;
  include: boolean;
}

// ---------------- categorias por palavra-chave ----------------

/** Palavras comuns em extratos brasileiros. A primeira que aparecer na descrição decide. */
export const KEYWORDS: [RegExp, string, 'income' | 'expense' | 'any'][] = [
  [/\b(salario|folha|pagto salario|vencimentos|proventos salariais)\b/, 'salario', 'income'],
  [/\b(rendimento|rend pago|juros sobre|dividendo|jcp|remuneracao aplic)/, 'dividendos', 'income'],
  [/\b(uber|99app|99 pop|99pop|cabify|metro|bilhete unico|onibus|estacionamento|sem parar|conectcar|veloe|pedagio|posto|shell|ipiranga|petrobras br|combustivel|gasolina)\b/, 'transporte', 'expense'],
  [/\b(ifood|i food|rappi|ze delivery|restaurante|lanchonete|burger|mcdonald|bk |pizza|padaria|cafe|starbucks|bar )/, 'alimentacao', 'expense'],
  [/\b(supermercado|mercado|atacadao|assai|carrefour|pao de acucar|extra hiper|hortifruti|sacolao|dia supermercado)\b/, 'mercado', 'expense'],
  [/\b(netflix|spotify|disney|hbo|max com|prime video|amazon prime|youtube premium|deezer|globoplay|apple com bill|icloud|google one|paramount|crunchyroll|chatgpt|openai)\b/, 'assinaturas', 'expense'],
  [/\b(farmacia|drogaria|drogasil|raia|pague menos|pacheco|hospital|clinica|laboratorio|odonto|dentista|unimed|amil|hapvida|sulamerica saude)\b/, 'saude', 'expense'],
  [/\b(enel|cemig|copel|light|celpe|coelba|cpfl|energisa|equatorial|sabesp|copasa|cedae|embasa|sanepar|compesa|agua|energia|luz|gas natural|comgas|claro|vivo|tim|oi fibra|net servicos|internet|telefone)\b/, 'contas', 'expense'],
  [/\b(aluguel|condominio|iptu|imobiliaria)\b/, 'moradia', 'expense'],
  [/\b(escola|faculdade|universidade|curso|mensalidade escolar|udemy|alura)\b/, 'educacao', 'expense'],
  [/\b(iof|tarifa|anuidade|cesta de servicos|taxa|darf|das |gps |irpf|ipva|licenciamento|detran)\b/, 'impostos', 'expense'],
  [/\b(juros|encargos|multa|mora|rotativo)\b/, 'juros', 'expense'],
  [/\b(emprestimo|financiamento|consignado|parcela credito)\b/, 'dividas', 'expense'],
  [/\b(amazon|mercado livre|mercadolivre|shopee|magalu|magazine luiza|americanas|aliexpress|shein|casas bahia)\b/, 'compras', 'expense'],
  [/\b(renner|riachuelo|c a |cea |zara|hering|centauro|netshoes)\b/, 'vestuario', 'expense'],
  [/\b(cinema|ingresso|show|steam|playstation|xbox|nintendo|parque)\b/, 'lazer', 'expense'],
];

/** "Pagamento de fatura" no extrato da conta, ou "pagamento recebido" na fatura do cartão. */
export const INVOICE_PAYMENT = /\b(pagamento (de )?fatura|pgto fatura|pag fatura|fatura cartao|pagamento cartao|pagamento recebido|pagto cartao)\b/;

const plain = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[*_./\\-]/g, ' ').replace(/\s+/g, ' ');

export function suggestCategory(description: string, type: 'income' | 'expense', data: AppData, rules: Settings['importRules']): { categoryId: string; source: PreviewRow['categorySource'] } {
  const valid = (id: string) => data.categories.some((c) => c.id === id && c.type === type);
  const p = plain(description);
  const n = normDesc(description);
  // 1. regra que você ensinou (a mais longa ganha: "uber eats" antes de "uber")
  const rule = [...rules].sort((a, b) => b.pattern.length - a.pattern.length).find((r) => n.includes(r.pattern) && valid(r.categoryId));
  if (rule) return { categoryId: rule.categoryId, source: 'regra' };
  // 2. a categoria que você usou da última vez para a mesma descrição
  if (n) {
    const last = [...data.transactions].filter((t) => t.type === type && normDesc(t.description) === n && valid(t.categoryId)).sort((a, b) => b.createdAt - a.createdAt)[0];
    if (last) return { categoryId: last.categoryId, source: 'historico' };
  }
  // 3. palavras-chave comuns
  for (const [re, cat, t] of KEYWORDS) if ((t === 'any' || t === type) && re.test(` ${p} `) && valid(cat)) return { categoryId: cat, source: 'palavra' };
  return { categoryId: type === 'income' ? 'outros_rend' : 'outros_gasto', source: 'padrao' };
}

// ---------------- prévia ----------------

/**
 * Monta a prévia. Fica desmarcado por padrão:
 * - o que já foi importado antes (mesmo identificador do banco na mesma conta/cartão);
 * - o que parece um lançamento que você já tem (mesmo valor e tipo, até 2 dias de diferença, descrição parecida ou sem descrição em comum mas na mesma conta);
 * - pagamento de fatura no extrato da conta (os gastos vêm da fatura do cartão; importar os dois contaria em dobro) e "pagamento recebido" na fatura;
 * - linha repetida dentro do próprio arquivo.
 */
export function buildPreview(st: Statement, target: Target, data: AppData, settings: Settings, invertSigns = false): PreviewRow[] {
  const sameTarget = (t: Transaction) => (target.kind === 'conta' ? t.accountId === target.accountId && !t.cardId : t.cardId === target.cardId);
  const seenFit = new Set<string>();
  const seenRow = new Set<string>();
  return st.rows.map((row, i) => {
    const amount = invertSigns ? -row.amount : row.amount;
    const type: 'income' | 'expense' = amount >= 0 ? 'income' : 'expense';
    const amountCents = Math.abs(amount);
    const sug = suggestCategory(row.description, type, data, settings.importRules ?? []);
    const pr: PreviewRow = { key: String(i), row, type, amountCents, categoryId: sug.categoryId, categorySource: sug.source, include: true };
    const n = normDesc(row.description);
    const rowKey = `${row.date}|${amount}|${n}|${row.fitId ?? ''}`;
    if (row.fitId && data.transactions.some((t) => t.fitId === row.fitId && sameTarget(t))) {
      pr.flag = 'importado';
      pr.flagNote = 'Já importado antes';
    } else if ((row.fitId && seenFit.has(row.fitId)) || seenRow.has(rowKey)) {
      pr.flag = 'repetido';
      pr.flagNote = 'Repetido no arquivo';
    } else if (INVOICE_PAYMENT.test(plain(row.description))) {
      pr.flag = 'fatura';
      pr.flagNote = target.kind === 'conta' ? 'Pagamento de fatura: os gastos já vêm da fatura do cartão. Marque só se não for importar a fatura.' : 'Pagamento da fatura anterior, não é compra';
    } else {
      // identificador estável do banco (Open Finance) diferente do que já existe: é outra transação, mesmo parecida
      const distinct = (t: Transaction) => !!row.fitId && !!t.fitId && row.fitId.startsWith('of:') && t.fitId.startsWith('of:') && t.fitId !== row.fitId;
      const match = data.transactions.find((t) => !distinct(t) && t.type === type && t.amountCents === amountCents && Math.abs(diffDays(t.date, row.date)) <= 2 && (normDesc(t.description) === n || (n && normDesc(t.description).split(' ')[0] === n.split(' ')[0]) || sameTarget(t)));
      if (match) {
        pr.flag = 'possivel';
        pr.flagNote = `Parece com "${match.description}" de ${match.date.split('-').reverse().slice(0, 2).join('/')}`;
      }
    }
    if (row.fitId) seenFit.add(row.fitId);
    seenRow.add(rowKey);
    if (pr.flag) pr.include = false;
    return pr;
  });
}

export function previewTotals(rows: PreviewRow[]) {
  const inc = rows.filter((r) => r.include);
  const dates = inc.map((r) => r.row.date).sort();
  return {
    count: inc.length,
    incomeCents: inc.filter((r) => r.type === 'income').reduce((s, r) => s + r.amountCents, 0),
    expenseCents: inc.filter((r) => r.type === 'expense').reduce((s, r) => s + r.amountCents, 0),
    from: dates[0] ?? '',
    to: dates[dates.length - 1] ?? '',
  };
}

// ---------------- lançamentos ----------------

function guessMethod(description: string, target: Target): PaymentMethod {
  if (target.kind === 'cartao') return 'credito';
  const p = plain(description);
  if (/\bpix\b/.test(p)) return 'pix';
  if (/\b(boleto|titulo|pagto cobranca)\b/.test(p)) return 'boleto';
  if (/\b(ted|doc|transf|transferencia)\b/.test(p)) return 'transferencia';
  if (/\b(debito|compra cartao|compra deb|cartao deb)\b/.test(p)) return 'debito';
  if (/\b(saque|dinheiro)\b/.test(p)) return 'dinheiro';
  return 'outro';
}

/**
 * Cria os lançamentos marcados. Extrato de conta: tudo como pago na data, na conta escolhida.
 * Fatura de cartão: compras no cartão; a de fatura já vencida entra como paga na data de vencimento,
 * pela conta que paga o cartão (o "pagamento de fatura" do extrato da conta deve ficar de fora para não contar em dobro);
 * a de fatura em aberto entra como pendente, como uma compra feita no app.
 */
export function buildTransactions(rows: PreviewRow[], target: Target, data: AppData, importId: string, makeId: () => string, today: ISODate = todayISO()): Transaction[] {
  const card: Card | undefined = target.kind === 'cartao' ? data.cards.find((c) => c.id === target.cardId) : undefined;
  const now = Date.now();
  return rows.filter((r) => r.include).map((r, i) => {
    const income = r.type === 'income';
    const kind: TxKind = income ? (r.categoryId === 'salario' ? 'salario' : 'outro_rendimento') : target.kind === 'cartao' ? 'cartao' : r.categoryId === 'assinaturas' ? 'assinatura' : 'variavel';
    const base: Transaction = {
      id: makeId(),
      type: r.type,
      kind,
      description: r.row.description.slice(0, 120),
      amountCents: r.amountCents,
      categoryId: r.categoryId,
      date: r.row.date,
      paymentMethod: guessMethod(r.row.description, target),
      status: 'paid',
      paidDate: r.row.date,
      source: 'import',
      importId,
      fitId: r.row.fitId,
      createdAt: now + i,
    };
    if (target.kind === 'conta') return { ...base, accountId: target.accountId };
    if (!card) return base;
    const due = cardInvoiceDue(card, r.row.date).dueDate;
    if (income) return { ...base, paymentMethod: 'outro', cardId: card.id, accountId: undefined, paidDate: r.row.date }; // estorno ou crédito na fatura
    return due < today
      ? { ...base, cardId: card.id, dueDate: due, paidDate: due, accountId: card.accountId }
      : { ...base, cardId: card.id, dueDate: due, status: 'pending', paidDate: undefined, accountId: undefined };
  });
}

/** Regras novas a partir das categorias que você trocou na prévia (descrição → categoria). */
export function learnedRules(rows: PreviewRow[], original: Map<string, string>, current: Settings['importRules']): Settings['importRules'] {
  const out = [...current];
  for (const r of rows) {
    if (!r.include || original.get(r.key) === r.categoryId) continue;
    const pattern = normDesc(r.row.description);
    if (!pattern || pattern.length < 3) continue;
    const i = out.findIndex((x) => x.pattern === pattern);
    if (i >= 0) out[i] = { pattern, categoryId: r.categoryId };
    else out.push({ pattern, categoryId: r.categoryId });
  }
  return out.slice(-300);
}

export function makeBatch(id: string, fileName: string, st: Statement, target: Target, rows: PreviewRow[]): ImportBatch {
  const t = previewTotals(rows);
  return { id, createdAt: new Date().toISOString(), fileName: fileName.slice(0, 80), format: st.format, bank: st.bank, accountId: target.kind === 'conta' ? target.accountId : undefined, cardId: target.kind === 'cartao' ? target.cardId : undefined, count: t.count, incomeCents: t.incomeCents, expenseCents: t.expenseCents, from: t.from, to: t.to };
}

/** Lançamentos de antes do início do saldo da conta entram no histórico, mas não mudam o saldo. */
export function rowsBeforeAccountStart(rows: PreviewRow[], target: Target, data: AppData): number {
  if (target.kind !== 'conta') return 0;
  const acc = data.accounts.find((a) => a.id === target.accountId);
  return acc ? rows.filter((r) => r.include && r.row.date < acc.initialDate).length : 0;
}
