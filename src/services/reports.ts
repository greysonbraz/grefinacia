import { jsPDF } from 'jspdf';
import type { AppData, ISODate, YearMonth } from '../lib/types';
import { monthlyClosing } from '../domain/reports';
import { monthSummary } from '../domain/ledger';
import { debtTotals } from '../domain/debts';
import { formatBRL } from '../lib/money';
import { formatDateBR, lastMonths, monthLong, monthOf } from '../lib/dates';
import { saveAndShare } from './backup';

const money = (c: number) => formatBRL(c).replace(/ /g, ' ');

/** Relatório de fechamento em PDF (mensal, ou anual quando `year` é informado). */
export async function exportClosingPdf(data: AppData, ym: YearMonth, today: ISODate, annual = false): Promise<void> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const months = annual ? lastMonths(ym, 12) : [ym];
  let y = 56;
  const line = (label: string, value: string, bold = false) => {
    if (y > 780) { doc.addPage(); y = 56; }
    doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(10.5);
    doc.text(label, 48, y);
    doc.text(value, 547, y, { align: 'right' });
    doc.setDrawColor(225).line(48, y + 5, 547, y + 5);
    y += 20;
  };
  const title = (t: string) => { if (y > 740) { doc.addPage(); y = 56; } y += 10; doc.setFont('helvetica', 'bold').setFontSize(12.5).text(t, 48, y); y += 20; };
  doc.setFont('helvetica', 'bold').setFontSize(19).text('Grefinacia', 48, y);
  doc.setFont('helvetica', 'normal').setFontSize(11).text(annual ? `Relatório anual: ${monthLong(months[0])} a ${monthLong(ym)}` : `Fechamento de ${monthLong(ym)}`, 48, (y += 20));
  doc.setFontSize(9).setTextColor(110).text(`Gerado em ${formatDateBR(today)}. Organização financeira pessoal; não substitui contador habilitado.`, 48, (y += 14));
  doc.setTextColor(0);
  y += 18;
  const cs = months.map((m) => monthlyClosing(data, m, today));
  const sum = (f: (c: (typeof cs)[number]) => number) => cs.reduce((s, c) => s + f(c), 0);
  title('Resultado do período');
  line('Total recebido', money(sum((c) => c.receivedCents)));
  line('Total gasto', money(sum((c) => c.spentCents)));
  line('Total economizado (receitas − despesas)', money(sum((c) => c.savedCents)), true);
  line('Guardado em reservas', money(sum((c) => c.reservedCents)));
  line('Total investido (aportes líquidos)', money(sum((c) => c.investedCents)));
  line('Proventos recebidos', money(sum((c) => c.dividendsCents)));
  line('Juros e encargos pagos', money(sum((c) => c.interestPaidCents)));
  line('Pagamentos de dívidas', money(sum((c) => c.debtPaymentsCents)));
  line('Dívidas restantes (saldo devedor atual)', money(cs[cs.length - 1].debtRemainingCents));
  title('Patrimônio');
  line('No início do período', money(cs[0].netWorthStartCents));
  line('No fim do período', money(cs[cs.length - 1].netWorthEndCents));
  line('Variação patrimonial', money(cs[cs.length - 1].netWorthEndCents - cs[0].netWorthStartCents), true);
  title('Despesas por categoria');
  const cat: Record<string, number> = {};
  for (const m of months) for (const [k, v] of Object.entries(monthSummary(data, m).byCategory)) cat[k] = (cat[k] ?? 0) + v;
  const ents = Object.entries(cat).sort((a, b) => b[1] - a[1]);
  if (ents.length === 0) line('Sem despesas no período', '');
  for (const [k, v] of ents) line(data.categories.find((c) => c.id === k)?.name ?? k, money(v));
  if (annual) { title('Fluxo de caixa mês a mês'); for (const c of cs) line(monthLong(c.ym), `${money(c.receivedCents)}  −  ${money(c.spentCents)}  =  ${money(c.savedCents)}`); }
  if (data.debts.length > 0) { title('Dívidas'); for (const d of debtTotals(data.debts).priority) line(`${d.name} (${d.institution || 's/ instituição'}), ${String(d.monthlyRatePct).replace('.', ',')}% a.m., ${d.remainingInstallments} parcelas`, money(d.balanceCents)); }
  if (!annual) {
    title('Lançamentos do mês');
    for (const t of data.transactions.filter((x) => monthOf(x.date) === ym).sort((a, b) => a.date.localeCompare(b.date))) line(`${formatDateBR(t.date)}  ${t.description.slice(0, 52)}${t.status === 'pending' ? ' (pendente)' : ''}`, (t.type === 'income' ? '+ ' : '− ') + money(t.amountCents));
  }
  doc.setFontSize(8.5).setTextColor(110).text('Patrimônio de meses passados usa o custo de aquisição dos ativos; o mês atual usa as cotações disponíveis.', 48, Math.min(y + 12, 815));
  const b64 = doc.output('datauristring').split(',')[1];
  await saveAndShare(`grefinacia-${annual ? 'anual' : 'fechamento'}-${ym}.pdf`, b64, 'application/pdf', true);
}
