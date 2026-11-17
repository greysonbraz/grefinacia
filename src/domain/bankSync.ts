import type { Account, Card, ISODate, Settings } from '../lib/types';
import { addDays, diffDays, toISO } from '../lib/dates';
import type { Statement, StatementRow } from './statement';
import type { PreviewRow, Target } from './importer';
import type { PluggyAccount, PluggyTransaction } from '../services/pluggy';

/**
 * Conexão bancária pelo Meu Pluggy (Etapa 12): regras puras. Os lançamentos entram pelo mesmo caminho da
 * importação de extrato (Etapa 9): prévia, duplicados, categorias, regras aprendidas e "Desfazer".
 */

export type Link = Settings['bank']['links'][string];
const toCents = (v: number) => Math.round(Math.abs(v) * 100 + 1e-9);

/** Pagamento da fatura dentro do próprio cartão (não é compra nem estorno). */
const CARD_PAYMENT = /\b(pagamento|pagto|pgto|pag\.?) (recebido|efetuado|de fatura|fatura|da fatura|cartao|cartão)|\bpagamento\b/i;

/**
 * Converte as transações de uma conta da Pluggy em linhas de extrato (centavos; positivo = entrou dinheiro).
 * - Conta: usa o tipo (DEBIT saiu, CREDIT entrou). Pendentes (agendados, bloqueados) ficam de fora até virarem efetivados.
 * - Cartão: valor positivo é compra; negativo é crédito. Pagamento da fatura fica de fora (não é gasto nem receita).
 *   Compras da fatura aberta e parcelas futuras entram (a pagar).
 * - Identificador: `providerId` do banco quando existe (estável no Open Finance); senão o id da Pluggy, que no
 *   cartão pode mudar no fechamento da fatura (aí a conferência por data, valor e descrição evita duplicar).
 * - Moeda estrangeira só entra se a Pluggy informar o valor em reais.
 */
export function toStatement(acc: PluggyAccount, txs: PluggyTransaction[]): Statement & { skipped: { pending: number; payments: number; foreign: number } } {
  const card = acc.type === 'CREDIT';
  const rows: StatementRow[] = [];
  const skipped = { pending: 0, payments: 0, foreign: 0 };
  for (const t of txs) {
    const date = typeof t.date === 'string' ? t.date.slice(0, 10) : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    let value = t.amount;
    if (t.currencyCode && t.currencyCode !== 'BRL') {
      if (typeof t.amountInAccountCurrency !== 'number') {
        skipped.foreign++;
        continue;
      }
      value = t.amountInAccountCurrency;
    }
    if (!Number.isFinite(value) || value === 0) continue;
    let amount: number;
    if (card) {
      if (value < 0 && CARD_PAYMENT.test(t.description ?? '')) {
        skipped.payments++;
        continue;
      }
      amount = value > 0 ? -toCents(value) : toCents(value);
    } else {
      if (t.status === 'PENDING') {
        skipped.pending++;
        continue;
      }
      amount = t.type === 'DEBIT' ? -toCents(value) : toCents(value);
    }
    const inst = t.creditCardMetadata;
    const parcel = inst && (inst.totalInstallments ?? 0) > 1 && inst.installmentNumber ? ` (${inst.installmentNumber}/${inst.totalInstallments})` : '';
    const description = (t.description ?? '').replace(/\s+/g, ' ').trim() + (parcel && !(t.description ?? '').includes(`${inst!.installmentNumber}/`) ? parcel : '');
    rows.push({ date, amount, description: description || (amount > 0 ? 'Crédito' : 'Débito'), fitId: t.providerId ? `of:${t.providerId}` : `pg:${t.id}` });
  }
  return { format: 'csv', kind: card ? 'cartao' : 'conta', bank: 'Meu Pluggy', rows, warnings: [], skipped };
}

/**
 * O que entra sem revisão na sincronização automática: o que a prévia já marcaria. Ficam de fora o já importado,
 * o repetido e o parecido com um lançamento que você já tem. O pagamento de fatura no extrato da conta entra só
 * se nenhum cartão estiver sendo sincronizado (senão as compras do cartão já contam esse gasto).
 */
export function autoSelect(rows: PreviewRow[], cardsSynced: boolean): PreviewRow[] {
  return rows.map((r) => ({ ...r, include: !r.flag || (r.flag === 'fatura' && !cardsSynced) }));
}

/** A partir de quando buscar: na primeira vez, o histórico escolhido; depois, 10 dias antes da última busca (lançamentos atrasados). */
export function syncFrom(lastSync: string | undefined, historyDays: number, today: ISODate): ISODate {
  if (lastSync) return addDays(lastSync.slice(0, 10), -10);
  return addDays(today, -Math.min(Math.max(historyDays, 7), 365));
}

/**
 * Conta nova a partir da conta do banco. O saldo informado pela Pluggy vale no fim do dia da última atualização;
 * por isso a conta começa no dia seguinte: o histórico importado entra nos relatórios sem mudar o saldo de hoje.
 */
export function newAccountFor(acc: PluggyAccount, bankName: string, balanceDay: ISODate, id: string): Account {
  return {
    id,
    name: `${bankName} · ${acc.marketingName || acc.name}`.slice(0, 60),
    kind: acc.subtype === 'SAVINGS_ACCOUNT' ? 'poupanca' : 'corrente',
    initialCents: Math.round(acc.balance * 100),
    initialDate: addDays(balanceDay, 1),
  };
}

export function newCardFor(acc: PluggyAccount, bankName: string, id: string, payAccountId?: string): Card {
  const day = (d?: string | null, fallback = 1) => (d && /^\d{4}-\d{2}-(\d{2})/.test(d) ? Number(d.slice(8, 10)) : fallback);
  const limit = acc.creditData?.creditLimit;
  return {
    id,
    name: `${bankName} · ${acc.marketingName || acc.name}${acc.number ? ` final ${String(acc.number).slice(-4)}` : ''}`.slice(0, 60),
    closingDay: day(acc.creditData?.balanceCloseDate, 1),
    dueDay: day(acc.creditData?.balanceDueDate, 10),
    limitCents: typeof limit === 'number' && limit > 0 ? Math.round(limit * 100) : undefined,
    accountId: payAccountId,
  };
}

export function targetFor(link: Link | undefined): Target | null {
  if (!link || link.kind === 'ignorar' || !link.id) return null;
  return link.kind === 'cartao' ? { kind: 'cartao', cardId: link.id } : { kind: 'conta', accountId: link.id };
}

/** Aviso quando a autorização do Meu Pluggy para a aplicação estiver perto de vencer (ela vale 1 ano). */
export function consentWarning(consentExpiresAt: string | undefined, today: ISODate): { days: number; expired: boolean } | null {
  if (!consentExpiresAt) return null;
  const days = diffDays(consentExpiresAt.slice(0, 10), today);
  if (days > 30) return null;
  return { days, expired: days < 0 };
}

/** Diferença entre o saldo do banco e o calculado pelo app, em centavos (positivo: o banco tem mais). */
export const balanceGap = (bankBalance: number, appCents: number): number => Math.round(bankBalance * 100) - appCents;

export const localDay = (iso?: string): ISODate => (iso ? toISO(new Date(iso)) : toISO(new Date()));
