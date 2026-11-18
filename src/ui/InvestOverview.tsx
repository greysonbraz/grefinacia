import { useMemo, useState } from 'react';
import { investOverview } from '../domain/investOverview';
import { useStore } from '../state/store';
import { addDays, formatDayMonth, monthShort } from '../lib/dates';
import { formatBRL, formatPct } from '../lib/money';
import { ChartBox, CountMoney, cssVar, Empty, Legend, Note, Seg } from './kit';

const CLASS_COLOR: Record<string, string> = { acoes: '--s1', fiis: '--s3', etfs: '--s6', fixa: '--s4', bancos: '--s5', exterior: '--s2', cripto: '--s7' };

/** Investimentos → Visão geral: quanto vale tudo, onde está, quanto rende e quanto paga de proventos. */
export function InvestOverview({ go }: { go: (sub: string) => void }) {
  const data = useStore((s) => s.data);
  const today = useStore((s) => s.today);
  const v = useMemo(() => investOverview(data, today), [data, today]);
  const [range, setRange] = useState<'90' | '365'>('90');
  const snaps = useMemo(() => data.snapshots.filter((x) => x.date > addDays(today, -Number(range))).sort((a, b) => a.date.localeCompare(b.date)), [data.snapshots, today, range]);
  if (v.totalCents <= 0) return <Empty title="Nenhum investimento ainda" text="Cadastre uma compra na Bolsa, uma aplicação de renda fixa ou conecte seu banco em Ajustes → Conexão bancária." action="Ir para a Bolsa" onAction={() => go('bolsa')} />;
  const colors = v.classes.map((c) => cssVar(CLASS_COLOR[c.id]));
  return (
    <>
      <section className="hero-card" aria-labelledby="h-inv-total">
        <h2 id="h-inv-total" className="hero-title">Seus investimentos hoje</h2>
        <CountMoney cents={v.totalCents} className="hero-big" />
        <div className="hero-meta">
          <span className="mut">{v.assetsCount} {v.assetsCount === 1 ? 'investimento' : 'investimentos'}</span>
          {v.pnlCents !== null && <span className={v.pnlCents >= 0 ? 'pos' : 'neg'}>Bolsa e renda fixa: <span className="num">{formatBRL(v.pnlCents)}</span> ({formatPct(v.pnlPct!, true)})</span>}
        </div>
        <div className="alloc">
          <div className="alloc-chart"><ChartBox kind="doughnut" small labels={v.classes.map((c) => c.label)} series={[{ label: 'Valor', data: v.classes.map((c) => c.cents) }]} colors={colors} /></div>
          <div className="alloc-list">
            {v.classes.map((c, i) => (
              <button key={c.id} className="alloc-row" onClick={() => go(c.id === 'fixa' ? 'fixa' : c.id === 'bancos' ? 'bancos' : c.id === 'exterior' ? 'dolar' : c.id === 'cripto' ? 'cripto' : 'bolsa')}>
                <i style={{ background: colors[i] }} aria-hidden /><span>{c.label}<br /><span className="num mut">{formatBRL(c.cents)}</span></span><b className="num">{((c.cents / v.totalCents) * 100).toFixed(0)}%</b>
              </button>
            ))}
          </div>
        </div>
      </section>
      {v.unquoted > 0 && <Note>{v.unquoted} {v.unquoted === 1 ? 'ativo está' : 'ativos estão'} sem cotação: vale o preço médio até atualizar na aba Bolsa.</Note>}

      <div className="ghead"><h2>Proventos</h2><button className="link" onClick={() => go('dividendos')}>Agenda</button></div>
      <div className="pulse">
        <div className="pulse-cell"><span className="pl">Recebidos (12 meses)</span><span className="num pv">{formatBRL(v.dividends12Cents)}</span><span className="ps">só os confirmados</span></div>
        <div className="pulse-cell"><span className="pl">Previstos em {monthShort(v.dividendsNext.ym)}</span><span className={"num pv " + (v.dividendsNext.cents > 0 ? "pos" : "")}>{formatBRL(v.dividendsNext.cents)}</span><span className="ps">{v.dividendsNext.estimated ? 'parte estimada pelo histórico' : 'anunciados'}</span></div>
      </div>

      {v.bankGainCents !== null && (
        <div className="group"><div className="kv"><span>Rendeu nos bancos (sobre o aplicado)</span><b className={'num ' + (v.bankGainCents >= 0 ? 'pos' : 'neg')}>{formatBRL(v.bankGainCents)}</b></div></div>
      )}

      <div className="ghead"><h2>Maiores posições</h2></div>
      <div className="group">
        {v.top.map((p) => (
          <div className="row" key={p.label + p.detail}>
            <div className="mid"><div className="t">{p.label}</div><div className="s">{p.detail}</div><div className="bar" style={{ marginTop: 6 }}><i style={{ width: `${Math.max(p.pct, 2)}%`, background: cssVar('--accent-strong') }} /></div></div>
            <div className="end"><div className="num">{formatBRL(p.cents)}</div><div className="s">{p.pct.toFixed(0)}% do total</div></div>
          </div>
        ))}
      </div>

      <div className="ghead"><h2>Evolução</h2></div>
      <div className="card">
        {snaps.length < 2 ? <div className="empty"><b>Histórico em construção</b>O app guarda o valor da carteira a cada dia de uso. A evolução aparece a partir de amanhã.</div> : (
          <>
            <ChartBox kind="line" small labels={snaps.map((x) => formatDayMonth(x.date))} series={[{ label: 'Carteira', data: snaps.map((x) => x.equityMarketCents + x.fixedIncomeCents + (x.cryptoCents ?? 0)), fill: true, color: cssVar('--accent-strong') }, { label: 'Custo', data: snaps.map((x) => x.equityCostCents + x.fixedIncomeCents), color: cssVar('--s4'), dashed: true }]} />
            <Legend items={[{ label: 'Bolsa, renda fixa e cripto', color: cssVar('--accent-strong') }, { label: 'Custo', color: cssVar('--s4'), dashed: true }]} />
            <div className="seg compact"><Seg value={range} onChange={setRange} options={[['90', '3 meses'], ['365', '12 meses']]} /></div>
          </>
        )}
      </div>
    </>
  );
}
