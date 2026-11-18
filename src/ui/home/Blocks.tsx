import { useEffect, useMemo, useState } from 'react';
import { marketStrip } from '../../domain/indicators';
import { ArrowDownLeft, ArrowUpRight, CalendarClock, ChevronRight, Coins, CreditCard, FileUp, Plus, Receipt, Sparkles } from 'lucide-react';
import { refreshMarketStrip, useStore } from '../../state/store';
import { isNative } from '../../services/platform';
import type { Overview } from '../../domain/overview';
import { netWorthSeries } from '../../domain/networth';
import { healthIndicators, upcomingItems } from '../../domain/home';
import { passiveIncomeSeries } from '../../domain/reports';
import { accountBalance } from '../../domain/ledger';
import { capFirst, formatDayMonth, monthShort, relativeDays } from '../../lib/dates';
import { formatBRL, formatPct, pctChange } from '../../lib/money';
import type { Nav } from '../App';
import { ChartBox, CountMoney, cssVar, Delta, Legend, Seg } from '../kit';

/** Patrimônio: o número principal da tela, a evolução e do que ele é feito. */
export function Hero({ o }: { o: Overview }) {
  const data = useStore((s) => s.data);
  const today = useStore((s) => s.today);
  const [period, setPeriod] = useState<'6' | '12'>('6');
  const series = useMemo(() => netWorthSeries(data, Number(period), today), [data, today, period]);
  const nw = o.netWorth;
  const comp = [
    { label: 'Contas', cents: Math.max(nw.accountsCents, 0), color: cssVar('--s1') },
    { label: 'Reservas', cents: Math.max(nw.goalsCents, 0), color: cssVar('--s3') },
    { label: 'Renda fixa', cents: nw.fixedIncomeCents, color: cssVar('--s4') },
    { label: 'Bolsa', cents: nw.equityMarketCents, color: cssVar('--s6') },
    { label: 'Nos bancos', cents: nw.bankInvestCents, color: cssVar('--s5') },
    { label: 'Dólar', cents: nw.abroadCents, color: cssVar('--s2') },
    { label: 'Cripto', cents: nw.cryptoCents, color: cssVar('--s7') },
  ].filter((c) => c.cents > 0);
  const total = comp.reduce((s, c) => s + c.cents, 0);
  return (
    <section className="hero-card" aria-labelledby="h-patrimonio">
      <h2 id="h-patrimonio" className="hero-title">Patrimônio total</h2>
      <CountMoney cents={nw.totalCents} className="hero-big" />
      <div className="hero-meta">
        {o.netWorthPrevCents ? <Delta pct={pctChange(nw.totalCents, o.netWorthPrevCents)} suffix="desde o fim do mês passado" /> : null}
        {o.debtCents > 0 && <span className="mut">Descontando as dívidas (<span className="num">{formatBRL(o.debtCents)}</span>): <span className="num">{formatBRL(nw.totalCents - o.debtCents)}</span></span>}
      </div>
      {series.length > 1 && (
        <div className="hero-chart">
          <ChartBox kind="line" minimal labels={series.map((p) => capFirst(monthShort(p.ym)))} series={[{ label: 'Patrimônio', data: series.map((p) => p.totalCents), fill: true, color: cssVar('--accent-strong') }]} />
          <div className="seg compact"><Seg value={period} onChange={setPeriod} options={[['6', '6 meses'], ['12', '12 meses']]} /></div>
        </div>
      )}
      {total > 0 && (
        <>
          <div className="comp" aria-hidden>{comp.map((c) => (<i key={c.label} style={{ width: (c.cents / total) * 100 + '%', background: c.color }} />))}</div>
          <Legend items={comp.map((c) => ({ label: c.label, color: c.color, value: formatBRL(c.cents) }))} />
        </>
      )}
    </section>
  );
}

/** O mês em uma olhada: dinheiro disponível, quanto ainda dá para gastar e entradas × saídas comparadas ao mês passado. */
export function MonthPulse({ o, nav }: { o: Overview; nav: Nav }) {
  const data = useStore((s) => s.data);
  const accounts = data.accounts.filter((a) => !a.archived);
  const [open, setOpen] = useState(false);
  const free = o.spend.remainingCents;
  const prevName = monthShort(o.prevYm);
  return (
    <section aria-labelledby="h-mes">
      <div className="ghead"><h2 id="h-mes">Seu mês</h2></div>
      <div className="pulse">
        <button className="pulse-cell" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="pl">Saldo disponível</span>
          <CountMoney cents={o.balanceCents} className="pv" />
          <span className="ps">{accounts.length} {accounts.length === 1 ? 'conta' : 'contas'}{accounts.length > 1 ? (open ? ' · fechar' : ' · ver contas') : ''}</span>
        </button>
        <button className="pulse-cell" onClick={() => nav.go('planning', 'salario')}>
          <span className="pl">Livre para gastar</span>
          <span className={'num pv ' + (free < 0 ? 'neg' : '')}>{formatBRL(free)}</span>
          <span className="ps">{o.spend.plan.risk === 'sem_receita' ? 'cadastre seu salário' : o.spend.perDayCents > 0 ? `${formatBRL(o.spend.perDayCents)} por dia até o fim do mês` : 'neste mês'}</span>
        </button>
      </div>
      {open && accounts.length > 1 && (
        <div className="group">{accounts.map((a) => (<div className="kv" key={a.id}><span>{a.name}</span><b className="num">{formatBRL(accountBalance(a, data))}</b></div>))}</div>
      )}
      <div className="group flow">
        <div className="flow-row">
          <span className="flow-ic in" aria-hidden><ArrowDownLeft size={16} /></span>
          <span className="flow-l">Receitas</span>
          <span className="num">{formatBRL(o.cur.incomeCents)}</span>
          {o.prev.incomeCents ? <Delta pct={pctChange(o.cur.incomeCents, o.prev.incomeCents)} suffix={`vs. ${prevName}`} /> : null}
        </div>
        <div className="flow-row">
          <span className="flow-ic out" aria-hidden><ArrowUpRight size={16} /></span>
          <span className="flow-l">Despesas</span>
          <span className="num">{formatBRL(o.cur.expenseCents)}</span>
          {o.prev.expenseCents ? <Delta pct={pctChange(o.cur.expenseCents, o.prev.expenseCents)} goodWhenUp={false} suffix={`vs. ${prevName}`} /> : null}
        </div>
        <div className="flow-row total">
          <span className="flow-ic" aria-hidden />
          <span className="flow-l">Resultado do mês</span>
          <span className={'num ' + (o.cur.netCents < 0 ? 'neg' : 'pos')}>{formatBRL(o.cur.netCents)}</span>
          <span />
        </div>
      </div>
    </section>
  );
}

/** Próximos 15 dias: contas, faturas e proventos, em ordem de data. */
export function Upcoming({ nav }: { nav: Nav }) {
  const data = useStore((s) => s.data);
  const today = useStore((s) => s.today);
  const items = useMemo(() => upcomingItems(data, today, 15), [data, today]);
  if (!items.length) return null;
  const Icon = { conta: Receipt, fatura: CreditCard, provento: Coins };
  return (
    <section aria-labelledby="h-proximos">
      <div className="ghead"><h2 id="h-proximos">Próximos 15 dias</h2><button className="link" onClick={() => nav.go('transactions')}>Ver tudo</button></div>
      <div className="group">
        {items.slice(0, 6).map((it) => {
          const I = Icon[it.kind];
          return (
            <button key={it.id} className="row" onClick={() => nav.go(it.kind === 'provento' ? 'invest' : 'transactions', it.kind === 'fatura' ? 'faturas' : it.kind === 'provento' ? 'dividendos' : undefined)}>
              <div className={'ic ' + (it.kind === 'provento' ? 'in' : '')}><I size={18} /></div>
              <div className="mid"><div className="t">{it.title}</div><div className="s">{formatDayMonth(it.date)} · {relativeDays(it.date, today)}</div></div>
              <div className="end"><div className={'num ' + (it.kind === 'provento' ? 'pos' : '')}>{it.kind === 'provento' ? '+' : '−'}{formatBRL(it.cents)}</div></div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** Investimentos em uma linha de leitura: quanto vale, quanto rendeu e quanto pagou de proventos. */
export function InvestSummary({ o, nav }: { o: Overview; nav: Nav }) {
  const data = useStore((s) => s.data);
  const today = useStore((s) => s.today);
  const nw = o.netWorth;
  const value = o.totals.valueCents + nw.bankInvestCents + nw.abroadCents + nw.cryptoCents;
  const prov12 = useMemo(() => passiveIncomeSeries(data, 12, today).reduce((s, x) => s + x.cents, 0), [data, today]);
  const next = o.nextForecast;
  if (value <= 0 && prov12 <= 0) return null;
  return (
    <section aria-labelledby="h-invest">
      <div className="ghead"><h2 id="h-invest">Investimentos</h2><button className="link" onClick={() => nav.go('invest')}>Abrir</button></div>
      <div className="group">
        <div className="kv"><span>Valor hoje</span><b className="num">{formatBRL(value)}</b></div>
        {o.totals.pnlPct !== null && <div className="kv"><span>Rentabilidade da Bolsa e renda fixa</span><b className={'num ' + (o.totals.pnlCents >= 0 ? 'pos' : 'neg')}>{formatBRL(o.totals.pnlCents)} · {formatPct(o.totals.pnlPct, true)}</b></div>}
        <div className="kv"><span>Proventos recebidos (12 meses)</span><b className="num">{formatBRL(prov12)}</b></div>
        {next.totalCents > 0 && <div className="kv"><span>Proventos previstos em {monthShort(next.ym)}</span><b className="num pos">{formatBRL(next.totalCents)}{next.estimatedCents > 0 ? ' (parte estimada)' : ''}</b></div>}
      </div>
    </section>
  );
}

/** Saúde financeira: três sinais com referência, cada um com a explicação ao lado. */
export function Health() {
  const data = useStore((s) => s.data);
  const today = useStore((s) => s.today);
  const ind = useMemo(() => healthIndicators(data, today), [data, today]);
  return (
    <section aria-labelledby="h-saude">
      <div className="ghead"><h2 id="h-saude">Saúde financeira</h2></div>
      <div className="group">
        {ind.map((i) => (
          <div className="health" key={i.id}>
            <span className={'hdot ' + i.tone} aria-hidden />
            <div className="mid"><div className="t">{i.label}</div><div className="s">{i.hint}</div></div>
            <b className="num">{i.value}</b>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Atalhos de uso diário (cada um leva a uma ação real). */
export function Shortcuts({ nav, hasCards }: { nav: Nav; hasCards: boolean }) {
  const list: [string, typeof Plus, () => void][] = [
    ['Nova movimentação', Plus, () => nav.go('transactions', 'nova')],
    ...(hasCards ? [['Faturas do cartão', CreditCard, () => nav.go('transactions', 'faturas')] as [string, typeof Plus, () => void]] : []),
    ['Importar extrato', FileUp, () => nav.go('transactions', 'importar')],
    ['Calendário financeiro', CalendarClock, () => nav.go('transactions', 'calendario')],
    ['Agenda de proventos', Coins, () => nav.go('invest', 'dividendos')],
    ['Perguntar à AI', Sparkles, () => nav.go('ai')],
  ];
  return (
    <nav className="shortcuts" aria-label="Atalhos">
      {list.map(([label, I, go]) => (<button key={label} onClick={go}><span className="sc-ic"><I size={20} /></span><span>{label}</span></button>))}
    </nav>
  );
}

export { ChevronRight };

/** Mercado hoje: Ibovespa, dólar, Selic, CDI e IPCA (Banco Central e Yahoo), atualizados no máximo 1×/dia. */
export function MarketStrip() {
  const data = useStore((s) => s.data);
  const today = useStore((s) => s.today);
  const items = useMemo(() => marketStrip(data, today), [data, today]);
  // no navegador os sites recusam a leitura (CORS); no app Android a busca é nativa
  useEffect(() => { if (isNative()) void refreshMarketStrip().catch(() => undefined); }, []);
  if (!items.length) return null;
  return (
    <section className="mstrip" aria-label="Mercado hoje">
      {items.map((i) => (
        <div className="mitem" key={i.id}>
          <span className="ml">{i.label}</span>
          <b className="mv">{i.value}</b>
          <span className={'mc ' + (i.changePct === undefined ? '' : i.changePct >= 0 ? 'pos' : 'neg')}>{i.changePct === undefined ? i.note : `${i.changePct >= 0 ? '+' : ''}${i.changePct.toFixed(2).replace('.', ',')}%`}</span>
        </div>
      ))}
    </section>
  );
}
