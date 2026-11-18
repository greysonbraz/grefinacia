import { useMemo, useState } from 'react';
import { goInsight } from './Assistant';
import { Settings as Gear, Newspaper, TriangleAlert, CircleCheck, Info, Banknote, Coins, ChevronRight, Eye, EyeOff, Sparkles } from 'lucide-react';
import { confirmDividend, markPaid, toast, updateSettings, useStore } from '../state/store';
import { computeOverview } from '../domain/overview';
import { generateInsights } from '../domain/insights';
import { formatDayMonth, parseISO } from '../lib/dates';
import { formatBRL } from '../lib/money';
import type { Nav } from './App';
import { News } from './News';
import { DollarHome } from './Dollar';
import { Money, Seg } from './kit';
import { Health, Hero, InvestSummary, MonthPulse, Shortcuts, Upcoming } from './home/Blocks';
import { NextMonthCard, SpendingCard } from './home/Month';
import { Analyses } from './home/Analyses';

const greeting = (h: number) => (h < 5 ? 'Boa noite' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite');

/**
 * Início (Purple Edition). Ordem pela importância: patrimônio → o mês → gastos → próximos dias → previsão →
 * investimentos → saúde financeira → atalhos → análises → Grefinacia AI. Cada número aparece uma vez só.
 */
export function Home({ nav }: { nav: Nav }) {
  const data = useStore((s) => s.data);
  const settings = useStore((s) => s.settings);
  const today = useStore((s) => s.today);
  const [news, setNews] = useState(false);
  const [cur, setCur] = useState<'brl' | 'usd'>('brl');
  const o = useMemo(() => computeOverview(data, settings, today), [data, settings, today]);
  const insights = useMemo(() => generateInsights(o, data, settings), [o, data, settings]);
  const hide = settings.hideValues;
  const date = parseISO(today).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="screen">
      <header className="head home-head">
        <div>
          <h1>{greeting(new Date().getHours())}{settings.userName ? `, ${settings.userName}` : ''}</h1>
          <div className="sub">{date}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="iconbtn" aria-pressed={hide} onClick={() => void updateSettings({ hideValues: !hide })} aria-label={hide ? 'Mostrar valores' : 'Ocultar valores'}>{hide ? <EyeOff size={19} /> : <Eye size={19} />}</button>
          <button className="iconbtn" onClick={() => setNews(true)} aria-label="Notícias"><Newspaper size={19} /></button>
          <button className="iconbtn" onClick={nav.openSettings} aria-label="Ajustes"><Gear size={19} /></button>
        </div>
      </header>

      <Seg value={cur} onChange={setCur} options={[['brl', 'R$ Reais'], ['usd', 'US$ Dólar']]} />
      {cur === 'usd' ? <DollarHome /> : (
        <>
          <Hero o={o} />

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

          <MonthPulse o={o} nav={nav} />
          <SpendingCard onOpen={() => nav.go('transactions')} />
          <Upcoming nav={nav} />
          <NextMonthCard onOpen={() => nav.go('planning', 'salario')} />
          <InvestSummary o={o} nav={nav} />
          <Health />
          <Shortcuts nav={nav} hasCards={data.cards.length > 0} />
          <Analyses />

          <div className="ghead"><h2 className="ai-title"><Sparkles size={18} /> Grefinacia AI</h2></div>
          {insights.slice(0, 3).map((i) => (
            <button key={i.id} className={'alert ' + i.tone} onClick={() => goInsight(nav, i.target)}>
              {i.tone === 'bad' || i.tone === 'warn' ? <TriangleAlert size={20} /> : i.tone === 'good' ? <CircleCheck size={20} /> : <Info size={20} />}
              <div><div className="t">{i.title}</div><div className="s">{i.text}</div></div>
            </button>
          ))}
          <button className="btn ghost" onClick={() => nav.go('ai')}>Conversar com a Grefinacia AI <ChevronRight size={18} /></button>
        </>
      )}
      {news && <News onClose={() => setNews(false)} />}
    </div>
  );
}

export { Money };
