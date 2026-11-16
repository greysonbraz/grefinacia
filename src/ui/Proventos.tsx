import { useMemo, useState } from 'react';
import { CircleCheck } from 'lucide-react';
import { cancelDividend, confirmDividend, reactivateDividend, toast, useStore } from '../state/store';
import { dividendRows, STATUS_LABEL, STATUS_TONE, type DividendRow } from '../domain/dividends';
import { passiveDashboard, totalReturn } from '../domain/passiveIncome';
import { formatBRL, formatPct, formatQty, formatRate } from '../lib/money';
import { formatDateBR, monthShort } from '../lib/dates';
import { ChartBox, cssVar, Legend, Note, Seg, seriesColors } from './kit';

export const KIND_NAME: Record<string, string> = { dividendo: 'Dividendo', jcp: 'JCP', rendimento: 'Rendimento', amortizacao: 'Amortização', outro: 'Outro', estimativa: 'Estimativa' };

// ============================ PAINEL DE RENDA PASSIVA ============================

/** Recebido (confirmado), a confirmar e previsto, sempre separados. */
export function PassivePanel() {
  const data = useStore((s) => s.data);
  const today = useStore((s) => s.today);
  const d = useMemo(() => passiveDashboard(data, today), [data, today]);
  const pal = seriesColors();
  const kindColors = d.byKind.map((_, i) => pal[i % pal.length]);
  return (
    <>
      <div className="grid2">
        <div className="tile"><div className="lbl">Recebido no mês</div><div className="val num">{formatBRL(d.monthCents)}</div></div>
        <div className="tile"><div className="lbl">Recebido no ano</div><div className="val num">{formatBRL(d.yearCents)}</div></div>
        <div className="tile"><div className="lbl">Total recebido</div><div className="val num">{formatBRL(d.totalCents)}</div></div>
        <div className="tile"><div className="lbl">Média mensal</div><div className="val num">{formatBRL(d.avgMonthlyCents)}</div><div className="foot">{d.avgMonths ? `últimos ${d.avgMonths} ${d.avgMonths === 1 ? 'mês' : 'meses'}` : 'sem recebimentos ainda'}</div></div>
        <div className="tile"><div className="lbl">Próximos 6 meses</div><div className="val num">{formatBRL(d.upcomingAnnouncedCents)}</div><div className="foot">anunciados{d.upcomingEstimatedCents > 0 ? ` + ${formatBRL(d.upcomingEstimatedCents)} estimados` : ''}</div></div>
        <div className="tile"><div className="lbl">Aguardando confirmação</div><div className={'val num ' + (d.awaitingCount ? 'warn' : '')}>{formatBRL(d.awaitingCents)}</div><div className="foot">{d.awaitingCount} {d.awaitingCount === 1 ? 'provento' : 'proventos'}; não conta como recebido</div></div>
      </div>

      <div className="card">
        <h2>Evolução da renda passiva</h2>
        <ChartBox kind="bar" stacked labels={d.months.map((m) => monthShort(m.ym))} series={[
          { label: 'Recebido', data: d.months.map((m) => m.receivedCents), color: cssVar('--s4') },
          { label: 'Anunciado', data: d.months.map((m) => m.announcedCents), color: cssVar('--gold') },
          { label: 'Estimado', data: d.months.map((m) => m.estimatedCents), color: cssVar('--sother') },
        ]} />
        <Legend items={[{ label: 'Recebido (confirmado)', color: cssVar('--s4') }, { label: 'Anunciado', color: cssVar('--gold') }, { label: 'Estimado pelo histórico', color: cssVar('--sother'), dashed: true }]} />
        <Note>12 meses para trás e 6 para a frente. Só a parte "Recebido" é dinheiro que caiu e foi confirmado (por você ou pelo extrato importado). Estimativas não são garantidas.</Note>
      </div>

      {d.byKind.length > 0 && (
        <div className="card">
          <h2>Recebido por tipo</h2>
          <ChartBox kind="doughnut" small labels={d.byKind.map((k) => KIND_NAME[k.kind])} series={[{ label: 'Recebido', data: d.byKind.map((k) => k.receivedCents) }]} colors={kindColors} />
          <Legend items={d.byKind.map((k, i) => ({ label: KIND_NAME[k.kind], color: kindColors[i], value: formatBRL(k.receivedCents) }))} />
        </div>
      )}

      {d.byAsset.length > 0 && (
        <>
          <div className="section">Por ativo</div>
          <div className="card" style={{ padding: '4px 14px' }}>
            {d.byAsset.map((a) => (
              <div className="row" key={a.assetId}>
                <div className="mid"><div className="t">{a.ticker}</div><div className="s">{a.pendingCents > 0 ? `${formatBRL(a.pendingCents)} a receber` : 'Nada a receber agora'}</div></div>
                <div className="end"><div className="num">{formatBRL(a.receivedCents)}</div><div className="s">recebidos</div></div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

// ============================ HISTÓRICO ============================

type Filter = 'todos' | 'receber' | 'pagos' | 'cancelados';

/** Histórico com quantidade elegível, valores, datas, status e origem. Nada é apagado: cancelar deixa no histórico. */
export function DividendHistory() {
  const data = useStore((s) => s.data);
  const today = useStore((s) => s.today);
  const [filter, setFilter] = useState<Filter>('todos');
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(() => dividendRows(data, today), [data, today]);
  const shown = rows.filter((r) => filter === 'todos' || (filter === 'pagos' ? r.status === 'pago' : filter === 'cancelados' ? r.status === 'cancelado' : r.status !== 'pago' && r.status !== 'cancelado'));
  return (
    <>
      <div className="section">Histórico de proventos</div>
      <Seg value={filter} onChange={setFilter} options={[['todos', 'Todos'], ['receber', 'A receber'], ['pagos', 'Pagos'], ['cancelados', 'Cancelados']]} />
      <div className="card" style={{ padding: '4px 14px' }}>
        {shown.length === 0 ? <div className="empty">Nada por aqui.</div> : shown.slice(0, 80).map((r) => (
          <HistoryRow key={r.event.id} r={r} open={open === r.event.id} onToggle={() => setOpen(open === r.event.id ? null : r.event.id)} />
        ))}
      </div>
      {shown.length > 80 && <Note>Mostrando os 80 mais recentes de {shown.length}.</Note>}
    </>
  );
}

function HistoryRow({ r, open, onToggle }: { r: DividendRow; open: boolean; onToggle: () => void }) {
  const e = r.event;
  const origin = e.source === 'manual' ? 'informado por você' : e.sourceName ?? 'fonte automática';
  const confirmed = e.confirmedBy === 'extrato' ? 'confirmado pelo extrato' : e.confirmedBy === 'manual' ? 'confirmado por você' : '';
  return (
    <div className={'divrow' + (r.status === 'cancelado' ? ' off' : '')}>
      <button className="divmain" onClick={onToggle} aria-expanded={open}>
        <div className="mid">
          <div className="t">{r.asset.ticker} · {KIND_NAME[e.kind]} <span className={'badge ' + STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</span>{r.altered && r.status !== 'cancelado' ? <span className="badge warn">alterado</span> : null}</div>
          <div className="s">{formatQty(r.quantity)} × {formatRate(e.ratePerUnit)} · data-com {e.dataCom ? formatDateBR(e.dataCom) : '—'} · pagamento {e.paymentDate ? formatDateBR(e.paymentDate) : 'não divulgado'}</div>
        </div>
        <div className="end"><div className="num">{formatBRL(r.netCents)}</div>{e.kind === 'jcp' && <div className="s">bruto {formatBRL(r.grossCents)}</div>}</div>
      </button>
      {open && (
        <div className="divdetail">
          <div className="kv"><span>Quantidade elegível</span><b className="num">{formatQty(r.quantity)}{e.quantityOverride !== undefined ? ' (informada)' : ''}</b></div>
          <div className="kv"><span>Valor por ação ou cota</span><b className="num">{formatRate(e.ratePerUnit)}</b></div>
          <div className="kv"><span>Bruto</span><b className="num">{formatBRL(r.grossCents)}</b></div>
          <div className="kv"><span>Líquido</span><b className="num">{formatBRL(r.netCents)}{e.kind === 'jcp' ? ' (IR de 15% retido)' : ''}</b></div>
          {e.approvedOn && <div className="kv"><span>Anúncio</span><b>{formatDateBR(e.approvedOn)}</b></div>}
          <div className="kv"><span>Data-com</span><b>{e.dataCom ? formatDateBR(e.dataCom) : e.exDate ? `data-ex ${formatDateBR(e.exDate)}` : '—'}</b></div>
          <div className="kv"><span>Pagamento</span><b>{e.paymentDate ? formatDateBR(e.paymentDate) : 'não divulgado'}{e.paymentDate && !e.official ? ' (não oficial)' : ''}</b></div>
          {e.receivedAt && <div className="kv"><span>Recebido em</span><b>{formatDateBR(e.receivedAt)} · {confirmed}</b></div>}
          <div className="kv"><span>Origem</span><b>{origin}</b></div>
          {e.missingSince && <Note>A fonte deixou de trazer este provento em {formatDateBR(e.missingSince.slice(0, 10))}. Pode ter sido cancelado ou corrigido: confira no site de RI da empresa ou do fundo.</Note>}
          {(e.revisions?.length ?? 0) > 0 && (
            <div className="revs">
              <div className="hint">Histórico de alterações</div>
              {e.revisions!.map((v, i) => (<div className="s" key={i}>{formatDateBR(v.at.slice(0, 10))} · {v.source}: {v.text}</div>))}
            </div>
          )}
          <div className="btnrow" style={{ marginTop: 8 }}>
            {(r.status === 'aguardando_confirmacao' || r.status === 'pagamento_previsto' || r.status === 'direito_adquirido') && <button className="btn sm" onClick={async () => { await confirmDividend(e.id); toast('Provento marcado como recebido'); }}><CircleCheck size={16} /> Recebi</button>}
            {r.status !== 'pago' && r.status !== 'cancelado' && <button className="btn sm ghost" onClick={async () => { await cancelDividend(e.id); toast('Cancelado (continua no histórico)'); }}>Cancelar</button>}
            {r.status === 'cancelado' && <button className="btn sm ghost" onClick={async () => { await reactivateDividend(e.id); toast('Provento reativado'); }}>Reativar</button>}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================ RENTABILIDADE TOTAL ============================

/** Valorização + vendas + proventos recebidos − custos; patrimônio, dinheiro recebido e proventos futuros separados. */
export function TotalReturnCard() {
  const data = useStore((s) => s.data);
  const today = useStore((s) => s.today);
  const t = useMemo(() => totalReturn(data, today), [data, today]);
  const [show, setShow] = useState(false);
  if (t.investedCents <= 0) return null;
  const tone = (c: number) => (c > 0 ? 'pos' : c < 0 ? 'neg' : '');
  return (
    <div className="card">
      <h2>Rentabilidade total</h2>
      <div className="grid3">
        <div className="tile"><div className="lbl">Patrimônio atual</div><div className="val num">{formatBRL(t.valueCents)}</div></div>
        <div className="tile"><div className="lbl">Proventos recebidos</div><div className="val num pos">{formatBRL(t.dividendsReceivedCents)}</div></div>
        <div className="tile"><div className="lbl">Proventos futuros</div><div className="val num">{formatBRL(t.dividendsUpcomingCents)}</div></div>
      </div>
      <div className="kv"><span>Total investido (compras + custos)</span><b className="num">{formatBRL(t.investedCents)}</b></div>
      <div className="kv"><span>Valorização da posição atual</span><b className={'num ' + tone(t.appreciationCents)}>{formatBRL(t.appreciationCents)}</b></div>
      <div className="kv"><span>Resultado em vendas</span><b className={'num ' + tone(t.realizedCents)}>{formatBRL(t.realizedCents)}</b></div>
      <div className="kv"><span>+ Proventos recebidos</span><b className="num">{formatBRL(t.dividendsReceivedCents)}</b></div>
      <div className="kv"><span>= Rentabilidade total</span><b className={'num ' + tone(t.totalCents)}>{formatBRL(t.totalCents)}{t.totalPct !== null ? ` (${formatPct(t.totalPct, true)})` : ''}</b></div>
      {t.dividendsAwaitingCents > 0 && <Note>{formatBRL(t.dividendsAwaitingCents)} em proventos com data de pagamento já passada ainda não foram confirmados e não entram na conta.</Note>}
      <button className="link" onClick={() => setShow(!show)}>{show ? 'Esconder por ativo' : 'Ver por ativo'}</button>
      {show && t.assets.map((a) => (
        <div className="kv" key={a.assetId}><span>{a.ticker}{a.priced ? '' : ' (sem cotação)'}</span><b className={'num ' + tone(a.totalCents)}>{formatBRL(a.totalCents)}{a.totalPct !== null ? ` · ${formatPct(a.totalPct, true)}` : ''}</b></div>
      ))}
      <Note>Proventos contam só depois de confirmados; os futuros aparecem à parte e não entram no resultado. O IR do JCP já sai do valor líquido; IR sobre lucro de vendas não é calculado. Sem cotação, o ativo entra pelo custo.</Note>
    </div>
  );
}
