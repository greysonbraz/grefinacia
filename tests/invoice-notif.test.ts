import { describe, expect, it } from 'vitest';
import { planNotifications } from '../src/domain/notifications';
import { DEFAULT_SETTINGS, emptyData } from '../src/lib/defaults';
import type { AppData, Transaction } from '../src/lib/types';

const tx = (p: Partial<Transaction>): Transaction => ({ id: 'x' + Math.random(), type: 'expense', kind: 'cartao', description: 'Loja', amountCents: 10000, categoryId: 'compras', date: '2026-11-10', dueDate: '2026-12-07', paymentMethod: 'credito', cardId: 'c', status: 'pending', createdAt: 1, ...p });

describe('lembretes da fatura do cartão', () => {
  it('vencimento com o nome do cartão e o valor; fechamento no dia anterior com o total até agora', () => {
    const d: AppData = { ...emptyData(), cards: [{ id: 'c', name: 'Inter', closingDay: 30, dueDay: 7 }] };
    d.transactions = [tx({}), tx({ amountCents: 5000, date: '2026-11-15' })];
    const s = { ...DEFAULT_SETTINGS, notifications: { ...DEFAULT_SETTINGS.notifications, enabled: true } };
    const plan = planNotifications(d, s, new Date('2026-11-18T08:00:00'), '2026-11-18');
    const inv = plan.filter((p) => p.key.startsWith('invoice')).sort((a, b) => a.at.getTime() - b.at.getTime());
    expect(inv.map((p) => [p.key.split(':')[0], p.title])).toEqual([
      ['invoice-close', 'Fatura Inter fecha amanhã'],
      ['invoice-before', 'Fatura Inter vence em 3 dias'],
      ['invoice-due', 'Fatura Inter vence hoje'],
    ]);
    // fecha dia 30/11 (lembrete em 29/11): total até agora e compras a partir de 01/12 vão para a próxima
    expect(inv[0].at.getDate()).toBe(29);
    expect(inv[0].body).toMatch(/R\$\s150,00/);
    expect(inv[0].body).toContain('01/12');
    // desligado: a fatura volta para o lembrete geral de contas
    const off = { ...s, notifications: { ...s.notifications, types: { ...s.notifications.types, cardInvoice: false } } };
    expect(planNotifications(d, off, new Date('2026-11-18T08:00:00'), '2026-11-18').some((p) => p.key.startsWith('invoice'))).toBe(false);
  });
});
