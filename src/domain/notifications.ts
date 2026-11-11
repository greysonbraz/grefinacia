import type { AppData, Cents, ISODate, Settings } from '../lib/types';
import { addDays, addMonthsYM, diffDays, formatDayMonth, makeDate, monthOf, parseISO } from '../lib/dates';
import { formatBRL, formatPct } from '../lib/money';
import { effectiveDue, isCredit, overdueBills } from './ledger';
import { dividendRows } from './dividends';
import { computeOverview } from './overview';
import { goalProgress } from './goals';
import { spendableView } from './salary';

export type Channel = 'contas' | 'salario' | 'dividendos' | 'alertas' | 'metas';

export interface PlannedNotification {
  id: number; // inteiro de 32 bits exigido pelo Android
  key: string;
  at: Date;
  title: string;
  body: string;
  channel: Channel;
}

export interface ImmediateAlert {
  key: string; // chave de deduplicação
  title: string;
  body: string;
  channel: Channel;
}

/** Hash estável → inteiro positivo de 31 bits. */
export function hashId(key: string): number {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) | 0;
  return (Math.abs(h) % 2147483646) + 1;
}

export function atTime(date: ISODate, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = parseISO(date);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

const HORIZON_DAYS = 45;

/** Notificações futuras a agendar no Android (recalculadas sempre que os dados mudam). */
export function planNotifications(data: AppData, settings: Settings, now: Date, today: ISODate): PlannedNotification[] {
  const prefs = settings.notifications;
  if (!prefs.enabled) return [];
  const out: PlannedNotification[] = [];
  const horizon = addDays(today, HORIZON_DAYS);
  const add = (key: string, date: ISODate, title: string, body: string, channel: Channel) => {
    const at = atTime(date, prefs.time);
    if (at.getTime() <= now.getTime() + 30_000) return;
    out.push({ id: hashId(key), key, at, title, body, channel });
  };

  // 1) Salário
  if (prefs.types.salary && settings.salary.amountCents > 0) {
    for (const ym of [monthOf(today), addMonthsYM(monthOf(today), 1)]) {
      const pay = makeDate(ym, settings.salary.payDay);
      const received = data.transactions.some((t) => t.source === 'salary' && t.recurrenceMonth === ym && t.status === 'paid');
      if (received || pay > horizon) continue;
      const pv = spendableView(data, settings, ym, pay).plan;
      const body = pv.risk === 'deficit'
        ? `Hoje é dia de salário, mas as despesas fixas (${formatBRL(pv.fixedCents)}) passam da receita prevista. Abra o app para ajustar o plano.`
        : `Hoje é dia de salário. Confirme o recebimento no app: pelo seu plano, guardar ${formatBRL(pv.saveCents)}, investir ${formatBRL(pv.investCents)} e sobram ${formatBRL(pv.freeCents)} para o mês.`;
      add(`salary:${ym}`, pay, 'Dia de salário', body, 'salario');
    }
  }

  // 2) Contas a vencer (agrupa por data). Faturas de cartão entram como uma conta só.
  if (prefs.types.billsDue) {
    const groups = new Map<ISODate, { label: string; cents: Cents }[]>();
    const invoice = new Map<string, { label: string; cents: Cents; due: ISODate }>();
    for (const t of data.transactions) {
      if (t.type !== 'expense' || t.status !== 'pending') continue;
      const due = effectiveDue(t);
      if (due < today || due > horizon) continue;
      if (isCredit(t)) {
        const card = data.cards.find((c) => c.id === t.cardId);
        const k = `${t.cardId}|${due}`;
        const inv = invoice.get(k) ?? { label: `Fatura ${card?.name ?? 'do cartão'}`, cents: 0, due };
        inv.cents += t.amountCents;
        invoice.set(k, inv);
      } else {
        const g = groups.get(due) ?? [];
        g.push({ label: t.description, cents: t.amountCents });
        groups.set(due, g);
      }
    }
    for (const inv of invoice.values()) {
      const g = groups.get(inv.due) ?? [];
      g.push({ label: inv.label, cents: inv.cents });
      groups.set(inv.due, g);
    }
    for (const [due, list] of groups) {
      const total = list.reduce((s, x) => s + x.cents, 0);
      const names = list.slice(0, 3).map((x) => x.label).join(', ') + (list.length > 3 ? ` e mais ${list.length - 3}` : '');
      const before = addDays(due, -prefs.billsDaysBefore);
      if (prefs.billsDaysBefore > 0) add(`bill-before:${due}`, before, 'Conta perto do vencimento', `${names} — ${formatBRL(total)} vence em ${formatDayMonth(due)}.`, 'contas');
      add(`bill-due:${due}`, due, 'Conta vence hoje', `${names} — ${formatBRL(total)}.`, 'contas');
    }
  }

  // 3) Contas atrasadas: lembrete nos próximos 3 dias
  if (prefs.types.overdue) {
    const late = overdueBills(data, today);
    if (late.length > 0) {
      const total = late.reduce((s, t) => s + t.amountCents, 0);
      for (let i = 0; i < 3; i++) {
        const d = addDays(today, i);
        add(`overdue:${d}`, d, 'Contas atrasadas', `${late.length} ${late.length === 1 ? 'conta atrasada' : 'contas atrasadas'} somando ${formatBRL(total)}. Regularize para evitar juros.`, 'alertas');
      }
    }
  }

  // 4) Dividendos: lembrete antes e no dia do pagamento (somente pagamentos oficiais)
  for (const r of dividendRows(data, today)) {
    const pd = r.event.paymentDate;
    if (!pd || !r.event.official || r.status === 'recebido' || pd > horizon) continue;
    const label = r.event.kind === 'rendimento' ? 'rendimento' : r.event.kind === 'jcp' ? 'JCP' : 'dividendo';
    if (prefs.types.dividendSoon && prefs.dividendDaysBefore > 0) {
      add(`div-soon:${r.event.id}`, addDays(pd, -prefs.dividendDaysBefore), 'Provento a caminho', `${r.asset.ticker}: ${label} de ${formatBRL(r.netCents)} previsto para ${formatDayMonth(pd)}.`, 'dividendos');
    }
    if (prefs.types.dividendReceived) {
      add(`div-pay:${r.event.id}`, pd, 'Provento previsto para hoje', `${r.asset.ticker}: ${label} de ${formatBRL(r.netCents)}. Confirme o recebimento no app para registrar na sua conta.`, 'dividendos');
    }
  }

  // 5) Lembrete de backup
  if (prefs.types.backup && (data.transactions.length > 0 || data.operations.length > 0)) {
    const last = settings.lastBackupAt ? settings.lastBackupAt.slice(0, 10) : undefined;
    if (!last || diffDays(today, last) >= 30) add(`backup:${monthOf(today)}`, addDays(today, 1), 'Hora de fazer backup', 'Seus dados ficam só neste aparelho. Gere um backup criptografado em Ajustes → Backup.', 'alertas');
  }

  return out.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, 100);
}

/** Alertas que dependem do estado atual (orçamento, saldo, metas). Disparados na hora, uma vez por chave. */
export function evaluateAlerts(data: AppData, settings: Settings, today: ISODate): ImmediateAlert[] {
  const prefs = settings.notifications;
  if (!prefs.enabled) return [];
  const o = computeOverview(data, settings, today);
  const out: ImmediateAlert[] = [];
  const catName = (id: string) => data.categories.find((c) => c.id === id)?.name ?? id;

  if (prefs.types.overBudget) {
    for (const b of o.budgets) {
      if (b.pct >= 100) out.push({ key: `budget:${b.categoryId}:${o.ym}`, title: `Orçamento de ${catName(b.categoryId)} estourado`, body: `Você gastou ${formatBRL(b.spentCents)} de um limite de ${formatBRL(b.limitCents)} (${formatPct(b.pct)}).`, channel: 'alertas' });
    }
    // despesas totais vs. o que o plano permite gastar (ou soma dos orçamentos)
    const budgetTotal = Object.values(settings.budgets).reduce((s, v) => s + v, 0);
    const planned = budgetTotal > 0 ? budgetTotal : o.spend.plan.incomeCents > 0 && o.spend.plan.risk !== 'deficit' ? o.spend.plan.incomeCents - o.spend.plan.saveCents - o.spend.plan.investCents : 0;
    if (planned > 0 && o.cur.expenseCents > planned) {
      const pct = (o.cur.expenseCents / planned - 1) * 100;
      if (pct >= 10) out.push({ key: `plan:${o.ym}:${Math.floor(pct / 10)}`, title: 'Alerta financeiro', body: `Suas despesas estão ${Math.round(pct)}% acima do planejado. Atenção para não comprometer seus investimentos.`, channel: 'alertas' });
    }
  }
  if (prefs.types.lowBalance) {
    if (o.projectedEndBalanceCents < 0) out.push({ key: `lowbal:${o.ym}`, title: 'Saldo insuficiente no mês', body: `Pelas contas a pagar, o saldo previsto no fim do mês é ${formatBRL(o.projectedEndBalanceCents)}. Revise os gastos.`, channel: 'alertas' });
    else {
      const next7 = data.transactions.filter((t) => t.type === 'expense' && t.status === 'pending' && effectiveDue(t) >= today && effectiveDue(t) <= addDays(today, 7)).reduce((s, t) => s + t.amountCents, 0);
      if (next7 > o.balanceCents && o.balanceCents >= 0) out.push({ key: `low7:${today}`, title: 'Saldo insuficiente para as próximas contas', body: `Vencem ${formatBRL(next7)} nos próximos 7 dias e o saldo em contas é ${formatBRL(o.balanceCents)}.`, channel: 'alertas' });
    }
  }
  if (prefs.types.goalReached) {
    for (const g of data.goals) {
      const p = goalProgress(g, data.goalMoves, today);
      if (p.status === 'concluida') out.push({ key: `goal:${g.id}`, title: 'Meta de economia alcançada!', body: `Você atingiu ${formatBRL(g.targetCents)} em "${g.name}". Parabéns!`, channel: 'metas' });
    }
  }
  return out;
}

/** Mensagem disparada quando o usuário confirma o recebimento do salário. */
export function salaryReceivedAlert(data: AppData, settings: Settings, ym: string, today: ISODate): ImmediateAlert | null {
  if (!settings.notifications.enabled || !settings.notifications.types.salary) return null;
  const pv = spendableView(data, settings, ym, today).plan;
  const body = pv.risk === 'deficit'
    ? `Seu salário foi recebido, mas as despesas fixas (${formatBRL(pv.fixedCents)}) passam da receita. Faltam ${formatBRL(pv.deficitCents)} — revise o plano.`
    : `Seu salário foi recebido! Após considerar suas despesas, você pode guardar ${formatBRL(pv.saveCents)}, investir ${formatBRL(pv.investCents)} e ainda terá ${formatBRL(pv.freeCents)} disponíveis.`;
  return { key: `salary-received:${ym}`, title: 'Salário recebido', body, channel: 'salario' };
}
