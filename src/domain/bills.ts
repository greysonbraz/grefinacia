import type { AppData, Cents, ISODate, Transaction } from '../lib/types';
import { diffDays } from '../lib/dates';

/**
 * Faturas do cartão montadas pelos lançamentos (Etapa 18): cada compra pertence à fatura do seu vencimento
 * (o banco informa a fatura de cada compra pelo Open Finance; sem isso, o app calcula pelo dia de fechamento).
 */
export interface CardBill {
  dueDate: ISODate;
  status: 'paga' | 'aberta' | 'futura';
  totalCents: Cents; // compras − estornos
  items: Transaction[];
  bankTotalCents?: Cents; // total informado pelo banco, quando houver
}

export function cardBills(data: AppData, cardId: string, today: ISODate, bank: { dueDate: ISODate; totalCents: Cents }[] = []): CardBill[] {
  const by = new Map<ISODate, Transaction[]>();
  for (const t of data.transactions) {
    if (t.cardId !== cardId || !t.dueDate) continue;
    by.set(t.dueDate, [...(by.get(t.dueDate) ?? []), t]);
  }
  // faturas do banco sem nenhum lançamento no app também aparecem (para conferir)
  for (const b of bank) if (![...by.keys()].some((d) => Math.abs(diffDays(d, b.dueDate)) <= 3)) by.set(b.dueDate, []);
  const dues = [...by.keys()].sort();
  const open = dues.find((d) => d >= today);
  return dues.map((d) => {
    const items = (by.get(d) ?? []).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    const total = items.reduce((s, t) => s + (t.type === 'expense' ? t.amountCents : -t.amountCents), 0);
    const bankBill = bank.find((b) => Math.abs(diffDays(d, b.dueDate)) <= 3);
    return { dueDate: d, status: d < today ? 'paga' : d === open ? 'aberta' : 'futura', totalCents: total, items, bankTotalCents: bankBill?.totalCents };
  });
}
