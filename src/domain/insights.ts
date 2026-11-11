import type { AppData, Settings } from '../lib/types';
import { addMonthsYM, daysInMonth } from '../lib/dates';
import { formatBRL, formatPct, pctChange, roundHalfAway } from '../lib/money';
import { expensesUpToDay, monthSummary } from './ledger';
import { goalProgress } from './goals';
import type { Overview } from './overview';

export interface Insight {
  id: string;
  tone: 'bad' | 'warn' | 'good' | 'info';
  title: string;
  text: string;
  target?: 'home' | 'transactions' | 'invest' | 'dividends' | 'planning';
}

const ORDER = { bad: 0, warn: 1, good: 2, info: 3 } as const;

/** Assistente financeiro: análises por regras, calculadas localmente com os seus dados. Não é recomendação de investimento. */
export function generateInsights(o: Overview, data: AppData, settings: Settings): Insight[] {
  const out: Insight[] = [];
  const catName = (id: string) => data.categories.find((c) => c.id === id)?.name ?? id;
  const day = Number(o.today.slice(8, 10));
  const partial = day < daysInMonth(o.ym);

  // 1. despesas x receita
  if (o.cur.expenseCents > o.cur.incomeCents && o.cur.expenseCents > 0) {
    if (o.cur.incomeCents > 0) {
      out.push({ id: 'deficit', tone: 'bad', title: 'Suas despesas estão maiores que sua receita', text: `Neste mês: ${formatBRL(o.cur.expenseCents)} em despesas contra ${formatBRL(o.cur.incomeCents)} de receita (falta ${formatBRL(o.cur.expenseCents - o.cur.incomeCents)}).`, target: 'transactions' });
    } else {
      out.push({ id: 'noincome', tone: 'warn', title: 'Há despesas, mas nenhuma receita lançada neste mês', text: 'Cadastre seu salário ou outras receitas para o app calcular quanto você pode guardar e investir.', target: 'planning' });
    }
  }

  // 2. ritmo de gastos vs. mesmo período do mês anterior
  const prevSame = expensesUpToDay(data, o.prevYm, Math.min(day, daysInMonth(o.prevYm)));
  const curSame = expensesUpToDay(data, o.ym, day);
  if (prevSame > 0) {
    const ch = pctChange(curSame, prevSame);
    if (ch !== null && ch >= 10) out.push({ id: 'spend-up', tone: 'warn', title: `Você gastou ${formatPct(Math.round(ch))} a mais neste mês`, text: `Até o dia ${day}: ${formatBRL(curSame)}, contra ${formatBRL(prevSame)} no mesmo período do mês passado.`, target: 'transactions' });
    else if (ch !== null && ch <= -10) out.push({ id: 'spend-down', tone: 'good', title: `Você gastou ${formatPct(Math.round(-ch))} a menos neste mês`, text: `Até o dia ${day}: ${formatBRL(curSame)}, contra ${formatBRL(prevSame)} no mesmo período do mês passado.`, target: 'transactions' });
  }

  // 3. economia
  if (o.cur.incomeCents > 0 && o.cur.netCents > 0) {
    out.push({ id: 'saved', tone: 'good', title: `Você conseguiu economizar ${formatBRL(o.cur.netCents)}`, text: `Receitas menos despesas${partial ? ' até agora' : ''}: ${formatPct((o.cur.netCents / o.cur.incomeCents) * 100)} da sua receita do mês.`, target: 'home' });
  }

  // 4. patrimônio
  if (o.netWorthPrevCents !== null && o.netWorthPrevCents > 0) {
    const ch = pctChange(o.netWorth.totalCents, o.netWorthPrevCents);
    if (ch !== null && Math.abs(ch) >= 0.1) {
      out.push({ id: 'networth', tone: ch > 0 ? 'good' : 'warn', title: `Seu patrimônio ${ch > 0 ? 'cresceu' : 'caiu'} ${formatPct(Math.abs(ch))}`, text: `Em relação ao fim do mês passado (${formatBRL(o.netWorthPrevCents)} → ${formatBRL(o.netWorth.totalCents)}). Meses anteriores consideram o custo dos ativos, não a cotação da época.`, target: 'home' });
    }
  }

  // 5. dividendos do próximo mês
  const f = o.nextForecast;
  if (f.totalCents > 0) {
    out.push({ id: 'div-forecast', tone: 'info', title: `Sua carteira possui previsão de ${formatBRL(f.totalCents)} em dividendos no próximo mês`, text: f.estimatedCents > 0 ? `${formatBRL(f.officialCents)} anunciados e ${formatBRL(f.estimatedCents)} estimados pelo histórico — a parte estimada não é garantida.` : 'Todos os valores já foram anunciados.', target: 'dividends' });
  }

  // 6. quanto investir sem apertar as contas
  const investedSoFar = Math.max(o.cur.investedCents, 0);
  const planInvest = Math.max(o.spend.plan.investCents - investedSoFar, 0);
  const safe = Math.min(planInvest, Math.max(o.projectedEndBalanceCents, 0));
  if (safe > 0 && o.spend.plan.risk !== 'deficit' && o.overdue.length === 0) {
    out.push({ id: 'can-invest', tone: 'good', title: `Você pode investir ${formatBRL(safe)} sem comprometer suas contas`, text: `Pelo seu plano, ${formatBRL(o.spend.plan.investCents)} do mês são para investir (${formatBRL(investedSoFar)} já aportados). O saldo previsto no fim do mês, depois das contas, é ${formatBRL(o.projectedEndBalanceCents)}.`, target: 'planning' });
  }

  // 7. contas atrasadas / a vencer
  if (o.overdue.length > 0) {
    const total = o.overdue.reduce((s, t) => s + t.amountCents, 0);
    out.push({ id: 'overdue', tone: 'bad', title: `${o.overdue.length} ${o.overdue.length === 1 ? 'conta atrasada' : 'contas atrasadas'} (${formatBRL(total)})`, text: 'Pague ou reagende para evitar juros e multa.', target: 'transactions' });
  }
  if (o.dueSoon.length > 0) {
    const total = o.dueSoon.reduce((s, t) => s + t.amountCents, 0);
    out.push({ id: 'due-soon', tone: 'warn', title: `${o.dueSoon.length} ${o.dueSoon.length === 1 ? 'conta vence' : 'contas vencem'} nos próximos 3 dias`, text: `Total de ${formatBRL(total)}.`, target: 'transactions' });
  }
  if (o.projectedEndBalanceCents < 0) {
    out.push({ id: 'low-balance', tone: 'bad', title: 'Risco de faltar dinheiro neste mês', text: `Somando o que ainda falta pagar e receber, o saldo previsto no fim do mês é ${formatBRL(o.projectedEndBalanceCents)}.`, target: 'planning' });
  }

  // 8. plano salarial
  if (o.spend.plan.risk === 'deficit') {
    out.push({ id: 'plan-deficit', tone: 'bad', title: 'As despesas fixas passam da sua receita', text: `Faltam ${formatBRL(o.spend.plan.deficitCents)} para cobrir os compromissos fixos do mês. Não há valor sugerido para guardar ou investir.`, target: 'planning' });
  }

  // 9. orçamentos
  for (const b of o.budgets) {
    if (b.pct >= 100) out.push({ id: 'budget-' + b.categoryId, tone: 'bad', title: `Orçamento de ${catName(b.categoryId)} estourado`, text: `${formatBRL(b.spentCents)} gastos de ${formatBRL(b.limitCents)} (${formatPct(b.pct)}).`, target: 'planning' });
    else if (b.pct >= 80) out.push({ id: 'budget-' + b.categoryId, tone: 'warn', title: `Orçamento de ${catName(b.categoryId)} em ${Math.round(b.pct)}%`, text: `Restam ${formatBRL(b.limitCents - b.spentCents)} até o fim do mês.`, target: 'planning' });
  }

  // 10. metas e reserva de emergência
  for (const g of data.goals) {
    const p = goalProgress(g, data.goalMoves, o.today);
    if (p.status === 'concluida') out.push({ id: 'goal-done-' + g.id, tone: 'good', title: `Meta "${g.name}" alcançada`, text: `Você guardou ${formatBRL(p.accumulatedCents)}.`, target: 'planning' });
    else if (p.status === 'atrasada') out.push({ id: 'goal-late-' + g.id, tone: 'warn', title: `Meta "${g.name}" não fecha no prazo`, text: `No ritmo atual a previsão é ${p.etaDate!.split('-').reverse().join('/')}. Para cumprir o prazo seriam ${formatBRL(p.requiredMonthlyCents ?? 0)} por mês.`, target: 'planning' });
    if (/emerg/i.test(g.name) && p.accumulatedCents > 0) {
      let spend = 0;
      for (let i = 1; i <= 3; i++) spend += monthSummary(data, addMonthsYM(o.ym, -i)).expenseCents;
      const avg = spend / 3;
      if (avg > 0) {
        const months = p.accumulatedCents / avg;
        out.push({ id: 'emergency-' + g.id, tone: months < 3 ? 'warn' : 'info', title: `Sua reserva de emergência cobre ${months.toFixed(1).replace('.', ',')} meses de despesas`, text: 'Muitos planejadores sugerem entre 3 e 6 meses de despesas, conforme a estabilidade da sua renda.', target: 'planning' });
      }
    }
  }

  // 11. carteira
  const held = o.positions.filter((p) => p.quantity > 0);
  const eq = o.totals.equityValueCents + o.totals.fixedValueCents;
  if (held.length >= 2 && eq > 0) {
    const top = [...held].sort((a, b) => b.valueCents - a.valueCents)[0];
    const share = (top.valueCents / eq) * 100;
    if (share >= 40) out.push({ id: 'concentration', tone: 'info', title: `${top.asset.ticker} representa ${Math.round(share)}% da sua carteira`, text: 'Concentração alta em um único ativo aumenta o risco. Avalie se está de acordo com o seu perfil.', target: 'invest' });
  }
  if (o.totals.unquoted > 0) out.push({ id: 'unquoted', tone: 'info', title: `${o.totals.unquoted} ${o.totals.unquoted === 1 ? 'ativo sem cotação' : 'ativos sem cotação'}`, text: 'Atualize as cotações (aba Investimentos) ou informe o preço manualmente. Enquanto isso, o app usa o preço médio.', target: 'invest' });

  // 12. maior gasto e dicas de organização
  if (o.cur.expenseCents > 0) {
    const [cid, val] = Object.entries(o.cur.byCategory).sort((a, b) => b[1] - a[1])[0];
    out.push({ id: 'top-cat', tone: 'info', title: `Maior gasto do mês: ${catName(cid)}`, text: `${formatBRL(val)}, ${formatPct((val / o.cur.expenseCents) * 100)} das despesas.`, target: 'transactions' });
  }
  if (settings.salary.amountCents <= 0) out.push({ id: 'no-salary', tone: 'info', title: 'Cadastre seu salário', text: 'Com o valor e a data de pagamento, o app separa suas despesas fixas e sugere quanto guardar e investir.', target: 'planning' });
  if (o.cur.incomeCents > 0 && o.cur.netCents >= 0 && o.cur.savedCents + Math.max(o.cur.investedCents, 0) === 0 && o.cur.netCents > roundHalfAway(o.cur.incomeCents * 0.1)) {
    out.push({ id: 'idle-money', tone: 'info', title: 'Sobrou dinheiro que ainda não foi guardado nem investido', text: 'Considere separar parte do saldo em uma reserva ou em um aporte. O app não faz nenhum investimento automaticamente.', target: 'planning' });
  }

  return out.sort((a, b) => ORDER[a.tone] - ORDER[b.tone]);
}
