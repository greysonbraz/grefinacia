import { useState } from 'react';
import { useStore } from '../../state/store';
import { netWorthSeries } from '../../domain/networth';
import { monthSummary } from '../../domain/ledger';
import { passiveIncomeSeries } from '../../domain/reports';
import { addDays, formatDayMonth, lastMonths, monthShort } from '../../lib/dates';
import { formatBRL } from '../../lib/money';
import { ChartBox, cssVar, Legend, Note, Seg, seriesColors } from '../kit';

type ChartTab = 'patrimonio' | 'fluxo' | 'categorias' | 'invest' | 'economias' | 'dividendos' | 'dividas';

/** Gráficos de apoio (fim do Início): fluxo, categorias, carteira, economias, proventos e dívidas. */
export function Analyses() {
  const [tab, setTab] = useState<ChartTab>('fluxo');
  return (
    <section className="card" aria-labelledby="h-analises">
      <h2 id="h-analises" style={{ marginBottom: 10 }}>Análises</h2>
      <Seg value={tab} onChange={setTab} options={[['fluxo', 'Receitas × despesas'], ['categorias', 'Categorias'], ['patrimonio', 'Patrimônio × contas'], ['invest', 'Carteira'], ['economias', 'Economias'], ['dividendos', 'Proventos'], ['dividas', 'Dívidas']]} />
      <HomeChart tab={tab} />
    </section>
  );
}

function HomeChart({ tab }: { tab: ChartTab }) {
  const data = useStore((s) => s.data);
  const today = useStore((s) => s.today);
  const months = lastMonths(today.slice(0, 7), 6);
  const labels = months.map(monthShort);
  const pal = seriesColors();
  if (tab === 'patrimonio') {
    const s = netWorthSeries(data, 6, today);
    return (<><ChartBox kind="line" labels={labels} series={[{ label: 'Patrimônio', data: s.map((p) => p.totalCents), fill: true }, { label: 'Saldo em contas', data: s.map((p) => p.accountsCents), color: pal[2] }]} /><Legend items={[{ label: 'Patrimônio', color: pal[0] }, { label: 'Saldo em contas', color: pal[2] }]} /><Note>Meses passados usam o custo dos ativos; o mês atual usa a cotação. A partir de hoje o app guarda um registro diário com valores reais.</Note></>);
  }
  if (tab === 'fluxo' || tab === 'economias') {
    const sums = months.map((m) => monthSummary(data, m));
    if (tab === 'fluxo') return (<><ChartBox kind="bar" labels={labels} series={[{ label: 'Receitas', data: sums.map((x) => x.incomeCents), color: pal[2] }, { label: 'Despesas', data: sums.map((x) => x.expenseCents), color: pal[1] }]} /><Legend items={[{ label: 'Receitas', color: pal[2] }, { label: 'Despesas', color: pal[1] }]} /></>);
    return (<><ChartBox kind="bar" stacked labels={labels} series={[{ label: 'Guardado em reservas', data: sums.map((x) => Math.max(x.savedCents, 0)), color: pal[2] }, { label: 'Investido', data: sums.map((x) => Math.max(x.investedCents, 0)), color: pal[6] }]} /><Legend items={[{ label: 'Guardado em reservas', color: pal[2] }, { label: 'Investido', color: pal[6] }]} /><Note>{(() => { const c = sums[sums.length - 1]; const p = c.incomeCents > 0 ? ((Math.max(c.savedCents, 0) + Math.max(c.investedCents, 0)) / c.incomeCents) * 100 : 0; return `Neste mês, ${p.toFixed(1).replace('.', ',')}% da receita foi para reservas e investimentos.`; })()}</Note></>);
  }
  if (tab === 'categorias') {
    const cur = monthSummary(data, today.slice(0, 7));
    const ents = Object.entries(cur.byCategory).sort((a, b) => b[1] - a[1]);
    if (ents.length === 0) return <div className="empty">Sem despesas neste mês.</div>;
    const top = ents.slice(0, 7);
    const rest = ents.slice(7).reduce((s, e) => s + e[1], 0);
    const name = (id: string) => data.categories.find((c) => c.id === id)?.name ?? id;
    const items = [...top.map(([id, v], i) => ({ label: name(id), v, color: pal[i] })), ...(rest > 0 ? [{ label: 'Outras', v: rest, color: cssVar('--sother') }] : [])];
    return (<><ChartBox kind="doughnut" labels={items.map((i) => i.label)} series={[{ label: 'Gastos', data: items.map((i) => i.v) }]} colors={items.map((i) => i.color)} /><Legend items={items.map((i) => ({ label: i.label, color: i.color, value: formatBRL(i.v) }))} /></>);
  }
  if (tab === 'invest') {
    const s = data.snapshots.filter((x) => x.date > addDays(today, -180)).sort((a, b) => a.date.localeCompare(b.date));
    if (s.length < 2) return <div className="empty"><b>Histórico em construção</b>O app registra o valor da carteira a cada dia de uso. Volte amanhã para ver a evolução.</div>;
    return (<><ChartBox kind="line" labels={s.map((x) => formatDayMonth(x.date))} series={[{ label: 'Valor de mercado', data: s.map((x) => x.equityMarketCents + x.fixedIncomeCents), fill: true }, { label: 'Custo', data: s.map((x) => x.equityCostCents + x.fixedIncomeCents), color: pal[3], dashed: true }]} /><Legend items={[{ label: 'Valor de mercado', color: pal[0] }, { label: 'Custo', color: pal[3], dashed: true }]} /></>);
  }
  if (tab === 'dividendos') {
    const s = passiveIncomeSeries(data, 12, today);
    if (s.every((x) => x.cents === 0)) return <div className="empty">Nenhum provento pago nos últimos 12 meses.</div>;
    return <ChartBox kind="bar" labels={s.map((x) => monthShort(x.ym))} series={[{ label: 'Proventos líquidos', data: s.map((x) => x.cents), color: pal[3] }]} />;
  }
  const s = data.snapshots.filter((x) => x.debtCents !== undefined).sort((a, b) => a.date.localeCompare(b.date)).slice(-90);
  if (data.debts.length === 0) return <div className="empty">Nenhuma dívida cadastrada.</div>;
  if (s.length < 2) return <div className="empty"><b>Histórico em construção</b>O saldo devedor passa a ser registrado a cada dia de uso do app.</div>;
  return <ChartBox kind="line" labels={s.map((x) => formatDayMonth(x.date))} series={[{ label: 'Saldo devedor', data: s.map((x) => x.debtCents ?? 0), color: pal[7], fill: true }]} />;
}

