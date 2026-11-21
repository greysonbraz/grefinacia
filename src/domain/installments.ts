import { addMonthsYM, makeDate, monthOf } from '../lib/dates';
import { cardInvoiceDue } from './ledger';
import type { AppData, ISODate, Transaction } from '../lib/types';

/**
 * Compras parceladas no cartão vindas do banco. O banco manda cada parcela como um lançamento separado, todos com
 * a data da compra e a marca "(n/m)" na descrição. Sem a fatura informada pelo banco, o app punha todas as parcelas
 * na mesma fatura. Aqui cada parcela vai para a sua: a parcela n vence n−1 meses depois da primeira.
 */
const PARCEL = /\s*\((\d{1,2})\/(\d{1,2})\)\s*$/;
export function parcelOf(desc: string): { n: number; m: number; base: string } | null {
  const x = desc.match(PARCEL);
  if (!x) return null;
  const n = Number(x[1]), m = Number(x[2]);
  return n >= 1 && m >= 2 && n <= m ? { n, m, base: desc.replace(PARCEL, '').trim() } : null;
}

const hash = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h.toString(36); };

/**
 * Cartão da compra: o do lançamento; se ele não existir mais (cartão recriado), o da importação que trouxe o
 * lançamento; senão, o único cartão cadastrado.
 */
function cardFor(data: AppData, t: Transaction) {
  const byId = t.cardId ? data.cards.find((c) => c.id === t.cardId) : undefined;
  if (byId) return byId;
  const batch = t.importId ? data.imports.find((b) => b.id === t.importId) : undefined;
  const byBatch = batch?.cardId ? data.cards.find((c) => c.id === batch.cardId) : undefined;
  if (byBatch) return byBatch;
  return t.cardId && data.cards.length === 1 ? data.cards[0] : undefined;
}

/** Importado de uma fatura de cartão, mas sem cartão e sem conta (o cartão não existia na hora da importação). */
const isOrphan = (data: AppData, t: Transaction) => t.source === 'import' && !t.cardId && !t.accountId && !!t.importId && !!data.imports.find((b) => b.id === t.importId)?.cardId;

const withDue = (t: Transaction, due: ISODate, today: ISODate, payAccountId?: string): Transaction =>
  t.type === 'income'
    ? { ...t, dueDate: due }
    : due < today
      ? { ...t, dueDate: due, status: 'paid', paidDate: due, accountId: payAccountId }
      : { ...t, dueDate: due, status: 'pending', paidDate: undefined, accountId: undefined };

/**
 * Lançamentos que precisam de ajuste (só muda cartão, vencimento, situação e a marca de parcela; nada é apagado):
 * - compras de fatura importadas sem cartão voltam para o cartão, cada uma na fatura certa;
 * - parcelas da mesma compra com a mesma data vão cada uma para a sua fatura.
 */
export function repairCardInstallments(data: AppData, today: ISODate): Transaction[] {
  const changed = new Map<string, Transaction>();
  const cur = (t: Transaction) => changed.get(t.id) ?? t;
  // 1) compras de fatura que ficaram sem cartão
  for (const t of data.transactions) {
    if (!isOrphan(data, t)) continue;
    const card = cardFor(data, t);
    if (!card) continue;
    changed.set(t.id, withDue({ ...t, cardId: card.id, paymentMethod: t.type === 'income' ? 'outro' : 'credito' }, cardInvoiceDue(card, t.date).dueDate, today, card.accountId));
  }
  // 2) parcelas
  const groups = new Map<string, { t: Transaction; n: number; m: number }[]>();
  for (const t0 of data.transactions) {
    const t = cur(t0);
    if (t.type !== 'expense' || t.source !== 'import' || !t.cardId) continue;
    const p = parcelOf(t.description);
    if (!p) continue;
    const key = `${t.cardId}|${p.base.toLowerCase()}|${t.date}|${p.m}`;
    groups.set(key, [...(groups.get(key) ?? []), { t, n: p.n, m: p.m }]);
  }
  for (const [key, list] of groups) {
    // só quando o banco mandou várias parcelas da mesma compra com a mesma data (senão a data já é a da parcela)
    if (new Set(list.map((x) => x.n)).size < 2) continue;
    const card = cardFor(data, list[0].t);
    if (!card) continue;
    // vencimentos já diferentes entre si vieram da fatura do banco: ficam como estão
    const allSame = new Set(list.map((x) => x.t.dueDate ?? '')).size === 1;
    const first = cardInvoiceDue(card, list[0].t.date).dueDate;
    const groupId = 'imp:' + hash(key);
    for (const { t, n, m } of list) {
      let next: Transaction = t;
      if (!t.installment) next = { ...next, installment: { groupId, number: n, total: m } };
      if (t.cardId !== card.id) next = { ...next, cardId: card.id };
      if (allSame) {
        const right = makeDate(addMonthsYM(monthOf(first), n - 1), card.dueDay);
        if (next.dueDate !== right) next = withDue(next, right, today, card.accountId);
      }
      if (next !== t) changed.set(t.id, next);
    }
  }
  const orig = new Map(data.transactions.map((t) => [t.id, t]));
  return [...changed.values()].filter((t) => JSON.stringify(t) !== JSON.stringify(orig.get(t.id)));
}

export interface InstallmentPlan { groupId: string; name: string; perCents: number; total: number; paid: number; left: number; leftCents: number; nextDue?: ISODate; lastDue?: ISODate }
/** Parcelamentos em andamento (compras parceladas no cartão ou lançadas como parceladas): quanto falta e até quando. */
export function installmentPlans(data: AppData, today: ISODate): InstallmentPlan[] {
  const by = new Map<string, Transaction[]>();
  for (const t of data.transactions) if (t.type === 'expense' && t.installment && t.installment.total > 1) by.set(t.installment.groupId, [...(by.get(t.installment.groupId) ?? []), t]);
  const out: InstallmentPlan[] = [];
  for (const [groupId, list] of by) {
    const due = (t: Transaction) => t.dueDate ?? t.date;
    const sorted = [...list].sort((a, b) => a.installment!.number - b.installment!.number);
    const total = sorted[0].installment!.total;
    const future = sorted.filter((t) => due(t) >= today);
    if (!future.length) continue;
    out.push({
      groupId,
      name: parcelOf(sorted[0].description)?.base ?? sorted[0].description.replace(/\s*\(\d+\/\d+\)\s*$/, ''),
      perCents: future[0].amountCents,
      total,
      paid: total - future.length,
      left: future.length,
      leftCents: future.reduce((s, t) => s + t.amountCents, 0),
      nextDue: due(future[0]),
      lastDue: due(future[future.length - 1]),
    });
  }
  return out.sort((a, b) => b.leftCents - a.leftCents);
}
