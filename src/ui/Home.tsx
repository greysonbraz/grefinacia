import { useMemo, useState } from 'react';
import { goInsight } from './Assistant';
import { Settings as Gear, Newspaper, TriangleAlert, CircleCheck, Info, Banknote, Coins, ChevronRight } from 'lucide-react';
import { confirmDividend, markPaid, toast, useStore } from '../state/store';
import { computeOverview } from '../domain/overview';
import { generateInsights } from '../domain/insights';
import { netWorthSeries } from '../domain/networth';
import { accountBalance, costDate, monthSummary } from '../domain/ledger';
import { passiveIncomeSeries } from '../domain/reports';
import { cardThisMonthToNext, cumulativeSpending, monthPace, nextMonthForecast, topCategories } from '../domain/home';
import { addDays, addMonthsYM, capFirst, monthName, lastMonths, monthLong, monthShort, parseISO, formatDayMonth } from '../lib/dates';
import { formatBRL, pctChange } from '../lib/money';
import type { AppData, ISODate } from '../lib/types';
import type { Nav } from './App';
import { News } from './News';
import { DollarHome } from './Dollar';
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
  for (const t of data.transactions) { const d = costDate(t); if (d >= from && d <= to) t.type === 'income' ? (income += t.amountCents) : (expense += t.amountCents); }
  return { income, expense };
}

type ChartTab = 'patrimonio' | 'fluxo' | 'categorias' | 'invest' | 'economias' | 'dividendos' | 'dividas';

export function Home({ nav }: { nav: Nav }) {
  const data = useStore((s) => s.data);
  const settings = useStore((s) => s.settings);
  const today = useStore((s) => s.today);
  const [period, setPeriod] = useState<Period>('mes');
  const [news, setNews] = useState(false);
  const [chart, setChart] = useState<ChartTab>('patrimonio');
  const [cur, setCur] = useState<'brl' | 'usd'>('brl');
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
    { label: 'Cripto', cents: nw.cryptoCents, color: cssVar('--s8') },
    { label: 'Nos bancos', cents: nw.bankInvestCents, color: cssVar('--s5') },
    { label: 'Dólar', cents: nw.abroadCents, color: cssVar('--s6') },
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
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="iconbtn" onClick={() => setNews(true)} aria-label="Notícias"><Newspaper size={19} /></button>
          <button className="iconbtn" onClick={nav.openSettings} aria-label="Ajustes"><Gear size={19} /></button>
        </div>
      </div>

      <Seg value={cur} onChange={setCur} options={[['brl', 'R$ Reais'], ['usd', 'US$ Dólar']]} />
      {cur === 'usd' ? (
        <>
          <DollarHome />
          {news && <News onClose={() => setNews(false)} />}
        </>
      ) : (<>
      <SpendingCard onOpen={() => nav.go('transactions')} />
      <NextMonthCard onOpen={() => nav.go('planning', 'salario')} />

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

      <div className="section">Patrimônio</div>
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

      <div className="section">Resumo</div>
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
        <button className="tile" style={{ textAlign: 'left' }} onClick={() => nav.go('invest')}><div className="lbl">Total investido</div><div className="val num">{formatBRL(o.totals.investedCents)}</div><div className="foot">vale {formatBRL(o.totals.valueCents)}{nw.bankInvestCents > 0 ? ` · + ${formatBRL(nw.bankInvestCents)} nos bancos` : ''}</div></button>
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
        <h2>Gráficos</h2>
        <Seg value={chart} onChange={setChart} options={[['patrimonio', 'Patrimônio'], ['fluxo', 'Receitas × despesas'], ['categorias', 'Categorias'], ['invest', 'Investimentos'], ['economias', 'Economias'], ['dividendos', 'Dividendos'], ['dividas', 'Dívidas']]} />
        <HomeChart tab={chart} />
      </div>

      <div className="section">Grefinacia AI</div>
      {insights.slice(0, 3).map((i) => (
        <button key={i.id} className={'alert ' + i.tone} onClick={() => goInsight(nav, i.target)}>
          {i.tone === 'bad' || i.tone === 'warn' ? <TriangleAlert size={20} /> : i.tone === 'good' ? <CircleCheck size={20} /> : <Info size={20} />}
          <div><div className="t">{i.title}</div><div className="s">{i.text}</div></div>
        </button>
      ))}
      <button className="btn ghost" onClick={() => nav.go('ai')}>Conversar com a Grefinacia AI <ChevronRight size={18} /></button>
      {news && <News onClose={() => setNews(false)} />}
      </>)}
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

/** Topo da tela: quanto já gastou no mês, dia a dia, comparado ao mês passado, e onde. */
function SpendingCard({ onOpen }: { onOpen: () => void }) {
  const data = useStore((s) => s.data);
  const today = useStore((s) => s.today);
  const ym = today.slice(0, 7);
  const prev = addMonthsYM(ym, -1);
  const mode = useStore((s) => s.settings.cardMonth);
  const pace = useMemo(() => monthPace(data, today), [data, today, mode]);
  const toNext = useMemo(() => (mode === 'fatura' ? cardThisMonthToNext(data, today) : 0), [data, today, mode]);
  const cur = useMemo(() => cumulativeSpending(data, ym, pace.day), [data, ym, pace.day, mode]);
  const last = useMemo(() => cumulativeSpending(data, prev), [data, prev, mode]);
  const cats = useMemo(() => topCategories(data, ym, 5), [data, ym, mode]);
  const pal = seriesColors();
  const name = (id: string) => data.categories.find((c) => c.id === id)?.name ?? id;
  const diff = pace.spentCents - pace.lastMonthSameDayCents;
  const labels = Array.from({ length: pace.days }, (_, i) => String(i + 1));
  return (
    <div className="card">
      <div className="lbl" style={{ color: 'var(--muted)', fontSize: 13 }}>Gastos de {monthName(ym)} até hoje{mode === 'fatura' ? ' (cartão pela fatura)' : ''}</div>
      <div className="big num" style={{ fontSize: 32, fontWeight: 650, letterSpacing: '-0.02em', margin: '2px 0' }}>{formatBRL(pace.spentCents)}</div>
      <div className="hint">
        {pace.lastMonthSameDayCents > 0
          ? <>Até o dia {pace.day} do mês passado: {formatBRL(pace.lastMonthSameDayCents)} · <b className={diff > 0 ? 'neg' : 'pos'}>{diff > 0 ? `${formatBRL(diff)} a mais` : diff < 0 ? `${formatBRL(-diff)} a menos` : 'igual'}</b></>
          : `Dia ${pace.day} de ${pace.days}.`}
      </div>
      {pace.spentCents > 0 || pace.lastMonthTotalCents > 0 ? (
        <>
          <ChartBox kind="line" small labels={labels} series={[{ label: capFirst(monthShort(ym)), data: cur, fill: true, color: pal[1] }, { label: capFirst(monthShort(prev)), data: last, color: pal[3], dashed: true }]} />
          <Legend items={[{ label: `${capFirst(monthShort(ym))} (até hoje)`, color: pal[1] }, { label: capFirst(monthShort(prev)), color: pal[3], dashed: true }]} />
        </>
      ) : <div className="empty">Nenhum gasto lançado neste mês ainda.</div>}
      {toNext > 0 && (
        <div className="kv" style={{ borderTop: '1px solid var(--line)', paddingTop: 10, marginTop: 6 }}>
          <span>No cartão neste mês<br /><span className="hint">vai para a próxima fatura: conta no mês do vencimento</span></span>
          <b className="num">{formatBRL(toNext)}</b>
        </div>
      )}
      <div className="kv" style={{ borderTop: '1px solid var(--line)', paddingTop: 10, marginTop: 6 }}>
        <span>Previsão para o mês inteiro<br /><span className="hint">já gasto + contas a vencer + o dia a dia que costuma vir</span></span>
        <b className="num">{formatBRL(pace.projectedCents)}</b>
      </div>
      {cats.items.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {cats.items.map((c, i) => (
            <div key={c.categoryId} style={{ margin: '9px 0' }}>
              <div className="kv" style={{ padding: 0, border: 0 }}><span>{name(c.categoryId)}</span><b className="num">{formatBRL(c.cents)} <span className="hint">{c.pct.toFixed(0)}%</span></b></div>
              <div className="bar" style={{ marginTop: 4 }}><i style={{ width: `${Math.max(c.pct, 2)}%`, background: pal[i % pal.length] }} /></div>
            </div>
          ))}
          {cats.otherCents > 0 && <div className="kv"><span className="hint">Outras categorias</span><b className="num">{formatBRL(cats.otherCents)}</b></div>}
        </div>
      )}
      <button className="btn ghost sm" style={{ marginTop: 6 }} onClick={onOpen}>Ver lançamentos <ChevronRight size={16} /></button>
    </div>
  );
}

/** Previsão automática do mês que vem, a partir do que está lançado, das recorrências e da média do dia a dia. */
function NextMonthCard({ onOpen }: { onOpen: () => void }) {
  const data = useStore((s) => s.data);
  const today = useStore((s) => s.today);
  const mode = useStore((s) => s.settings.cardMonth);
  const f = useMemo(() => nextMonthForecast(data, today), [data, today, mode]);
  const out = f.billsCents + f.debtCents + f.dailyCents;
  return (
    <button className="card" style={{ textAlign: 'left', width: '100%' }} onClick={onOpen}>
      <h2 style={{ marginTop: 0 }}>Previsão de {monthLong(f.ym)}</h2>
      <div className="kv"><span>Entradas previstas</span><b className="num pos">{formatBRL(f.incomeCents)}</b></div>
      <div className="kv"><span>Contas e faturas já lançadas<br /><span className="hint">inclui o que você comprou no cartão até agora</span></span><b className="num">{formatBRL(f.billsCents)}</b></div>
      {f.debtCents > 0 && <div className="kv"><span>Parcelas de dívidas</span><b className="num">{formatBRL(f.debtCents)}</b></div>}
      <div className="kv"><span>Gasto do dia a dia (média)</span><b className="num">{formatBRL(f.dailyCents)}</b></div>
      <div className="kv" style={{ borderTop: '1px solid var(--line)' }}><span><b>{f.netCents >= 0 ? 'Deve sobrar' : 'Deve faltar'}</b></span><b className={'num ' + (f.netCents >= 0 ? 'pos' : 'neg')}>{formatBRL(Math.abs(f.netCents))}</b></div>
      <div className="hint">Saídas previstas {formatBRL(out)}. Saldo previsto nas contas no fim de {monthLong(f.ym)}: {formatBRL(f.endBalanceCents)}.{f.basisMonths < 3 ? ` A média do dia a dia usa ${f.basisMonths} ${f.basisMonths === 1 ? 'mês' : 'meses'} fechados; fica mais certa com o tempo.` : ''}{f.incomeCents === 0 ? ' Cadastre seu salário como recorrente para entrar aqui.' : ''}</div>
    </button>
  );
}

export { Money };
