import { useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { useStore } from '../../state/store';
import { cardThisMonthToNext, cumulativeSpending, monthPace, nextMonthForecast, topCategories } from '../../domain/home';
import { addMonthsYM, capFirst, monthLong, monthName, monthShort } from '../../lib/dates';
import { formatBRL } from '../../lib/money';
import { ChartBox, Legend, seriesColors } from '../kit';

/** Topo da tela: quanto já gastou no mês, dia a dia, comparado ao mês passado, e onde. */
export function SpendingCard({ onOpen }: { onOpen: () => void }) {
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
export function NextMonthCard({ onOpen }: { onOpen: () => void }) {
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

