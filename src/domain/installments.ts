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

/** Lançamentos que precisam de ajuste (só muda vencimento, situação e a marca de parcela; nada é apagado). */
export function repairCardInstallments(data: AppData, today: ISODate): Transaction[] {
  const groups = new Map<string, { t: Transaction; n: number; m: number; base: string }[]>();
  for (const t of data.transactions) {
    if (t.type !== 'expense' || !t.cardId || t.source !== 'import') continue;
    const p = parcelOf(t.description);
    if (!p) continue;
    const key = `${t.cardId}|${p.base.toLowerCase()}|${t.date}|${p.m}`;
    groups.set(key, [...(groups.get(key) ?? []), { t, ...p }]);
  }
  const out: Transaction[] = [];
  for (const [key, list] of groups) {
    // só quando o banco mandou várias parcelas da mesma compra com a mesma data (senão a data já é a da parcela)
    if (new Set(list.map((x) => x.n)).size < 2) continue;
    const card = data.cards.find((c) => c.id === list[0].t.cardId);
    if (!card) continue;
    const first = cardInvoiceDue(card, list[0].t.date).dueDate;
    const groupId = 'imp:' + hash(key);
    for (const { t, n, m } of list) {
      const naive = first;
      const right = makeDate(addMonthsYM(monthOf(first), n - 1), card.dueDay);
      let next: Transaction = t;
      if (!t.installment) next = { ...next, installment: { groupId, number: n, total: m } };
      // vencimento que veio da fatura do banco é mantido; o calculado pela data da compra é corrigido
      if (n > 1 && (!t.dueDate || t.dueDate === naive)) {
        next = right < today
          ? { ...next, dueDate: right, status: 'paid', paidDate: right, accountId: card.accountId }
          : { ...next, dueDate: right, status: 'pending', paidDate: undefined, accountId: undefined };
      }
      if (next !== t) out.push(next);
    }
  }
  return out;
}
