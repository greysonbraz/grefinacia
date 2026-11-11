import { useMemo, useState } from 'react';
import { Settings as Gear, TriangleAlert, CircleCheck, Info, Banknote, Coins, ChevronRight } from 'lucide-react';
import { confirmDividend, markPaid, toast, useStore } from '../state/store';
import { computeOverview } from '../domain/overview';
import { generateInsights } from '../domain/insights';
import { netWorthSeries } from '../domain/networth';
import { accountBalance, monthSummary } from '../domain/ledger';
import { passiveIncomeSeries } from '../domain/reports';
import { addDays, capFirst, lastMonths, monthLong, monthShort, parseISO, formatDayMonth } from '../lib/dates';
import { formatBRL, pctChange } from '../lib/money';
import type { AppData, ISODate } from '../lib/types';
import type { Nav } from './App';
import { ChartBox, cssVar, Delta, Legend, Money, Note, Seg, seriesColors } from './kit';

type Period = 'dia' | 'semana' | 'mes' | 'ano';
function periodRange(p: Period, today: ISODate): [ISODate, ISODate] {
  if (p === 'dia') return [today, today];
  if (p === 'semana') return [addDays(today, -((parseISO(today).getDay() + 6) % 7)), today];
  if (p === 'mes') return [today.slice(0, 7) + '-01', today.slice(0, 7) + '-31'];
  return [today.slice(0, 4) + '-01-01', today.slice(0, 4) + '-12-31'];
}
function periodTotals(data: AppData, from: ISODate, to: ISODate) {
  let income = 0, expense = 0;
  for (const t of data.transactions) if (t.date >= from && t.date <= to) t.type === 'income' ? (income += t.amountCents) : (expense += t.amountCents);
  return { income, expense };
}

type ChartTab = 'patrimonio' | 'fluxo' | 'categorias' | 'invest' | 'economias' | 'dividendos' | 'dividas';

export function Home({ nav }: { nav: Nav }) {
  const data = useStore((s) => s.data);
  const settings = useStore((s) => s.settings);
  const today = useStore((s) => s.today);
  const [period, setPeriod] = useState<Period>('mes');
  const [chart, setChart] = useState<ChartTab>('patrimonio');
  const o = useMemo(() => computeOverview(data, settings, today), [data, settings, today]);
  const insights = useMemo(() => generateInsights(o, data, settings), [o, data, settings]);
  const [from, to] = periodRange(period, today);
  const pt = periodTotals(data, from, to);
  const nw = o.netWorth;
  const comp = [
    { label: 'Contas', cents: Math.max(nw.accountsCents, 0), color: cssVar('--s1') },
    { label: 'Reservas', cents: Math.max(nw.goalsCents, 0), color: cssVar('--s3') },
    { label: 'Renda fixa', cents: nw.fixedIncomeCents, color: cssVar('--s4') },
    { label: 'Bolsa', cents: nw.equityMarketCents, color: cssVar('--s7') },
  ].filter((c) => c.cents > 0);
  const compTotal = comp.reduce((s, c) => s + c.cents, 0);
  const planInvestLeft = Math.min(Math.max(o.spend.plan.investCents - Math.max(o.cur.investedCents, 0), 0), Math.max(o.projectedEndBalanceCents, 0));
  const accounts = data.accounts.filter((a) => !a.archived);

  return (
    <div className="screen">
      <div className="head">
        <div>
          <div className="sub">{settings.userName ? `Olá, ${settings.userName}` : 'Olá'}</div>
          <h1>{capFirst(monthLong(o.ym))}</h1>
        </div>
        <button className="iconbtn" onClick={nav.openSettings} aria-label="Ajustes"><Gear size={19} /></button>
      </div>

      {o.salaryPending && (
        <button className="alert good" onClick={async () => { await markPaid(o.salaryPending!); toast('Salário registrado como recebido'); }}>
          <Banknote size={20} />
          <div><div className="t">Seu salário já caiu?</div><div className="s">{formatBRL(o.salaryPending.amountCents)} previsto para {formatDayMonth(o.salaryPending.date)}. Toque para confirmar o recebimento.</div></div>
        </button>
      )}
      {o.toConfirmDividends.length > 0 && (
        <button className="alert info" onClick={async () => { for (const r of o.toConfirmDividends) await confirmDividend(r.event.id); toast('Proventos registrados na conta'); }}>
          <Coins size={20} />
          <div><div className="t">{o.toConfirmDividends.length} {o.toConfirmDividends.length === 1 ? 'provento com pagamento vencido' : 'proventos com pagamento vencido'}</div><div className="s">{formatBRL(o.toConfirmDividends.reduce((s, r) => s + r.netCents, 0))} no total. Toque para confirmar que recebeu.</div></div>
        </button>
      )}
      {o.overdue.length > 0 && (
        <button className="alert bad" onClick={() => nav.go('transactions')}>
          <TriangleAlert size={20} />
          <div><div className="t">{o.overdue.length} {o.overdue.length === 1 ? 'conta atrasada' : 'contas atrasadas'}</div><div className="s">{formatBRL(o.overdue.reduce((s, t) => s + t.amountCents, 0))} em aberto.</div></div>
        </button>
      )}
      {o.projectedEndBalanceCents < 0 && (
        <div className="alert bad"><TriangleAlert size={20} /><div><div className="t">Risco de faltar dinheiro</div><div className="s">Saldo previsto no fim do mês: {formatBRL(o.projectedEndBalanceCents)}.</div></div></div>
      )}

      <div className="card hero">
        <div className="lbl">Patrimônio total</div>
        <div className="big num">{formatBRL(nw.totalCents)}</div>
        <Delta pct={o.netWorthPrevCents ? pctChange(nw.totalCents, o.netWorthPrevCents) : null} suffix="vs. fim do mês passado" />
        {compTotal > 0 && (
          <>
            <div className="comp" aria-hidden>{comp.map((c) => (<i key={c.label} style={{ width: (c.cents / compTotal) * 100 + '%', background: c.color }} />))}</div>
            <Legend items={comp.map((c) => ({ label: c.label, color: c.color, value: formatBRL(c.cents) }))} />
          </>
        )}
        {o.debtCents > 0 && <div className="kv" style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 10 }}><span>Dívidas: {formatBRL(o.debtCents)}</span><b className="num">Líquido {formatBRL(nw.totalCents - o.debtCents)}</b></div>}
      </div>

      <Seg value={period} onChange={setPeriod} options={[['dia', 'Hoje'], ['semana', 'Semana'], ['mes', 'Mês'], ['ano', 'Ano']]} />
      <div className="grid2">
        <div className="tile"><div className="lbl">Receitas</div><div className="val num">{formatBRL(pt.income)}</div>{period === 'mes' && <div className="foot"><Delta pct={pctChange(o.cur.incomeCents, o.prev.incomeCents)} /></div>}</div>
        <div className="tile"><div className="lbl">Despesas</div><div className="val num">{formatBRL(pt.expense)}</div>{period === 'mes' && <div className="foot"><Delta pct={pctChange(o.cur.expenseCents, o.prev.expenseCents)} goodWhenUp={false} /></div>}</div>
        <div className="tile"><div className="lbl">Economizado no período</div><div className={'val num ' + (pt.income - pt.expense < 0 ? 'neg' : '')}>{formatBRL(pt.income - pt.expense)}</div>{period === 'mes' && <div className="foot"><Delta pct={pctChange(o.cur.netCents, o.prev.netCents)} /></div>}</div>
        <div className="tile"><div className="lbl">Saldo em contas</div><div className="val num">{formatBRL(o.balanceCents)}</div><div className="foot">{accounts.length} {accounts.length === 1 ? 'conta' : 'contas'}</div></div>
      </div>

      <div className="grid2">
        <button className="tile" style={{ textAlign: 'left' }} onClick={() => nav.go('planning', 'salario')}><div className="lbl">Livre para gastar</div><div className={'val num ' + (o.spend.remainingCents < 0 ? 'neg' : '')}>{formatBRL(o.spend.remainingCents)}</div><div className="foot">{o.spend.plan.risk === 'sem_receita' ? 'cadastre seu salário' : o.spend.perDayCents > 0 ? `${formatBRL(o.spend.perDayCents)}/dia por ${o.spend.daysLeft} dias` : 'neste mês'}</div></button>
        <button className="tile" style={{ textAlign: 'left' }} onClick={() => nav.go('planning', 'salario')}><div className="lbl">Disponível para investir</div><div className="val num">{formatBRL(planInvestLeft)}</div><div className="foot">sem apertar as contas</div></button>
        <button className="tile" style={{ textAlign: 'left' }} onClick={() => nav.go('invest')}><div className="lbl">Total investido</div><div className="val num">{formatBRL(o.totals.investedCents)}</div><div className="foot">vale {formatBRL(o.totals.valueCents)}</div></button>
        <button className="tile" style={{ textAlign: 'left' }} onClick={() => nav.go('planning', 'reservas')}><div className="lbl">Valor reservado</div><div className="val num">{formatBRL(o.goalsCents)}</div><div className="foot">{data.goals.length} {data.goals.length === 1 ? 'objetivo' : 'objetivos'}</div></button>
        <button className="tile" style={{ textAlign: 'left', gridColumn: '1 / -1' }} onClick={() => nav.go('planning', 'dividas')}><div className="lbl">Total de dívidas</div><div className="val num">{formatBRL(o.debtCents)}</div><div className="foot">{data.debts.length === 0 ? 'nenhuma dívida cadastrada' : `${data.debts.length} em aberto`}</div></button>
      </div>

      {accounts.length > 1 && (
        <div className="card">
          <h2>Contas</h2>
          {accounts.map((a) => (<div className="kv" key={a.id}><span>{a.name}</span><b className="num">{formatBRL(accountBalance(a, data))}</b></div>))}
        </div>
      )}

      <div className="card">
        <Seg value={chart} onChange={setChart} options={[['patrimonio', 'Patrimônio'], ['fluxo', 'Receitas × despesas'], ['categorias', 'Categorias'], ['invest', 'Investimentos'], ['economias', 'Economias'], ['dividendos', 'Dividendos'], ['dividas', 'Dívidas']]} />
        <HomeChart tab={chart} />
      </div>

      <div className="section">Grefinacia AI</div>
      {insights.slice(0, 3).map((i) => (
        <button key={i.id} className={'alert ' + i.tone} onClick={() => i.target && nav.go(i.target === 'dividends' ? 'invest' : (i.target as never), i.target === 'dividends' ? 'dividendos' : undefined)}>
          {i.tone === 'bad' || i.tone === 'warn' ? <TriangleAlert size={20} /> : i.tone === 'good' ? <CircleCheck size={20} /> : <Info size={20} />}
          <div><div className="t">{i.title}</div><div className="s">{i.text}</div></div>
        </button>
      ))}
      <button className="btn ghost" onClick={() => nav.go('ai')}>Conversar com a Grefinacia AI <ChevronRight size={18} /></button>
    </div>
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

export { Money };
