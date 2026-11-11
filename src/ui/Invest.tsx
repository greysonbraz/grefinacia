import { useMemo, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { confirmDividend, defaultAccountId, deleteAsset, deleteOperation, refreshDividends, refreshQuotes, remove, saveOperation, toast, upsert, useStore } from '../state/store';
import type { Asset, AssetType, DividendKind, FixedIncome, ISODate } from '../lib/types';
import { computePositions, portfolioTotals, quantityAt, type Position } from '../domain/portfolio';
import { assetDividendSummaries, dividendRows, forecastMonth, makeEventKey } from '../domain/dividends';
import { estimateFixed, FI_LABEL, simulateGrowth } from '../domain/fixedincome';
import { passiveIncomeSeries } from '../domain/reports';
import { centsToInput, formatBRL, formatPct, formatQty, formatRate, parseDecimal, parseMoney } from '../lib/money';
import { addMonthsYM, daysInMonth, formatDateBR, formatDayMonth, monthLong, monthOf, monthShort, weekdayOfFirst } from '../lib/dates';
import { uid } from '../lib/ids';
import { ChartBox, cssVar, Empty, Field, Full, Legend, MoneyInput, MonthNav, Note, Seg, seriesColors, Sheet, SwitchRow } from './kit';

const TYPE_LABEL: Record<AssetType, string> = { acao: 'Ação', fii: 'FII', etf: 'ETF' };
type Sub = 'bolsa' | 'fixa' | 'dividendos';

export function Invest({ initial }: { initial?: string }) {
  const [sub, setSub] = useState<Sub>((initial as Sub) ?? 'bolsa');
  return (
    <div className="screen">
      <div className="head"><h1>Investimentos</h1></div>
      <Seg value={sub} onChange={setSub} options={[['bolsa', 'Bolsa (B3)'], ['fixa', 'Renda fixa'], ['dividendos', 'Dividendos']]} />
      {sub === 'bolsa' && <Bolsa />}
      {sub === 'fixa' && <Fixa />}
      {sub === 'dividendos' && <Dividendos />}
    </div>
  );
}

function Bolsa() {
  const data = useStore((s) => s.data);
  const api = useStore((s) => s.settings.api);
  const [busy, setBusy] = useState(false);
  const [add, setAdd] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const positions = useMemo(() => computePositions(data.assets, data.operations), [data.assets, data.operations]);
  const totals = portfolioTotals(positions, []);
  const held = positions.filter((p) => p.quantity > 0).sort((a, b) => b.valueCents - a.valueCents);
  const pal = seriesColors();
  const refresh = async () => {
    setBusy(true);
    try {
      const r = await refreshQuotes();
      setErrors([...new Set(r.errors.map((e) => `${e.ticker}: ${e.message}`))]);
      toast(r.updated > 0 ? `${r.updated} ${r.updated === 1 ? 'cotação atualizada' : 'cotações atualizadas'}` : 'Nenhuma cotação atualizada', r.updated > 0 ? 'ok' : 'err');
    } finally { setBusy(false); }
  };
  const top = held.slice(0, 7);
  const rest = held.slice(7).reduce((s, p) => s + p.valueCents, 0);
  const slices = [...top.map((p, i) => ({ label: p.asset.ticker, v: p.valueCents, color: pal[i] })), ...(rest > 0 ? [{ label: 'Outros', v: rest, color: cssVar('--sother') }] : [])];
  const dp = detail ? positions.find((p) => p.asset.id === detail) : null;
  return (
    <>
      <div className="card hero">
        <div className="cardhead">
          <div><div className="lbl">Valor da carteira</div><div className="big num" style={{ fontSize: 30 }}>{formatBRL(totals.equityValueCents)}</div></div>
          <button className="iconbtn" onClick={refresh} disabled={busy || data.assets.length === 0} aria-label="Atualizar cotações"><RefreshCw size={18} style={busy ? { animation: 'spin 1s linear infinite' } : undefined} /></button>
        </div>
        <div className="kv"><span>Total investido</span><b className="num">{formatBRL(totals.investedCents)}</b></div>
        <div className="kv"><span>Lucro ou prejuízo</span><b className={'num ' + (totals.pnlCents > 0 ? 'pos' : totals.pnlCents < 0 ? 'neg' : '')}>{totals.pnlPct === null ? '—' : `${formatBRL(totals.pnlCents)} (${formatPct(totals.pnlPct, true)})`}</b></div>
        {totals.realizedCents !== 0 && <div className="kv"><span>Resultado já realizado em vendas</span><b className="num">{formatBRL(totals.realizedCents)}</b></div>}
        <Note>{api.quoteProvider === 'manual' ? 'Cotação automática desligada: os preços são os que você informar.' : api.lastQuoteRefresh ? `Cotações de ${api.quoteProvider === 'brapi' ? 'brapi.dev' : 'Yahoo Finance (não oficial)'}, buscadas em ${new Date(api.lastQuoteRefresh).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}. Podem ter atraso de 15 minutos ou mais; não são tempo real.` : 'Toque em atualizar para buscar as cotações. Sem cotação, o app usa o preço médio e não calcula lucro.'}</Note>
        {errors.map((e) => (<div className="note neg" key={e}>{e}</div>))}
      </div>
      {held.length === 0 ? <div className="card"><Empty title="Carteira vazia" text="Cadastre suas ações, FIIs e ETFs com quantidade, preço e data da compra." action="Adicionar ativo" onAction={() => setAdd(true)} /></div> : (
        <>
          <div className="card" style={{ padding: '4px 14px' }}>
            {held.map((p) => (
              <button className="row" key={p.asset.id} onClick={() => setDetail(p.asset.id)}>
                <div className="ic" style={{ fontSize: 11, fontWeight: 650, color: 'var(--text)' }}>{p.asset.ticker.slice(0, 4)}</div>
                <div className="mid"><div className="t">{p.asset.ticker} <span className="badge">{TYPE_LABEL[p.asset.type]}</span></div><div className="s">{formatQty(p.quantity)} × PM {formatBRL(Math.round(p.avgPriceCents))} · {((p.valueCents / totals.equityValueCents) * 100).toFixed(1).replace('.', ',')}% da carteira</div></div>
                <div className="end"><div className="num">{formatBRL(p.valueCents)}</div>{p.pnlPct === null ? <span className="badge warn">sem cotação</span> : <div className={'s num ' + (p.pnlCents! >= 0 ? 'pos' : 'neg')}>{formatPct(p.pnlPct, true)}</div>}</div>
              </button>
            ))}
          </div>
          <div className="card">
            <h2>Participação na carteira</h2>
            <ChartBox kind="doughnut" small labels={slices.map((s) => s.label)} series={[{ label: 'Carteira', data: slices.map((s) => s.v) }]} colors={slices.map((s) => s.color)} />
            <Legend items={slices.map((s) => ({ label: s.label, color: s.color, value: ((s.v / totals.equityValueCents) * 100).toFixed(1).replace('.', ',') + '%' }))} />
          </div>
        </>
      )}
      <button className="fab" onClick={() => setAdd(true)} aria-label="Adicionar ativo ou operação"><Plus size={26} /></button>
      {add && <OpForm onClose={() => setAdd(false)} />}
      {dp && <AssetDetail p={dp} onClose={() => setDetail(null)} />}
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
    </>
  );
}

function OpForm({ onClose, asset }: { onClose: () => void; asset?: Asset }) {
  const data = useStore((s) => s.data);
  const today = useStore((s) => s.today);
  const [ticker, setTicker] = useState(asset?.ticker ?? '');
  const [type, setType] = useState<AssetType>(asset?.type ?? 'acao');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [fees, setFees] = useState('');
  const [date, setDate] = useState(today);
  const [broker, setBroker] = useState(data.operations[data.operations.length - 1]?.broker ?? '');
  const [debit, setDebit] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    const t = ticker.trim().toUpperCase();
    const q = parseDecimal(qty);
    const p = parseMoney(price);
    if (!/^[A-Z]{4}\d{1,2}[A-Z]?$/.test(t)) return setErr('Código inválido. Use o formato da B3, como BBAS3 ou MXRF11.');
    if (!q || q <= 0 || !Number.isInteger(q)) return setErr('Informe a quantidade (número inteiro).');
    if (!p || p <= 0) return setErr('Informe o preço por unidade.');
    if (date > today) return setErr('A data não pode ser no futuro.');
    let a = asset ?? data.assets.find((x) => x.ticker === t);
    if (!a) { a = { id: uid('as_'), ticker: t, type }; await upsert('assets', a); }
    const e = await saveOperation({ id: uid('op_'), assetId: a.id, side, quantity: q, priceCents: p, feesCents: parseMoney(fees) ?? 0, date, broker: broker.trim(), accountId: debit ? defaultAccountId() : undefined, createdAt: Date.now() });
    if (e) return setErr(e);
    toast(side === 'buy' ? 'Compra registrada' : 'Venda registrada');
    onClose();
  };
  return (
    <Sheet title={asset ? `Nova operação em ${asset.ticker}` : 'Adicionar ativo'} onClose={onClose}>
      <Seg value={side} onChange={setSide} options={[['buy', 'Compra'], ['sell', 'Venda']]} />
      {!asset && (
        <div className="two">
          <Field label="Código (ticker)"><input name="ticker" value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder="ITSA4" autoCapitalize="characters" /></Field>
          <Field label="Tipo"><select value={type} onChange={(e) => setType(e.target.value as AssetType)}><option value="acao">Ação</option><option value="fii">Fundo imobiliário</option><option value="etf">ETF</option></select></Field>
        </div>
      )}
      <div className="two">
        <Field label="Quantidade"><input name="quantidade" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <Field label={side === 'buy' ? 'Preço de compra (R$)' : 'Preço de venda (R$)'} hint="Para posição antiga, use o preço médio"><MoneyInput name="preco" value={price} onChange={setPrice} /></Field>
      </div>
      <div className="two">
        <Field label="Data"><input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Custos (R$, opcional)"><MoneyInput value={fees} onChange={setFees} /></Field>
      </div>
      <Field label="Corretora"><input name="corretora" value={broker} onChange={(e) => setBroker(e.target.value)} placeholder="Ex.: XP, Rico, Nubank" /></Field>
      <SwitchRow title={side === 'buy' ? 'Debitar da conta principal' : 'Creditar na conta principal'} sub="Desligue para posições que você já tinha" on={debit} onChange={setDebit} />
      {err && <div className="neg" role="alert" style={{ margin: '8px 0' }}>{err}</div>}
      <div className="btnrow"><button className="btn" onClick={save}>Salvar</button></div>
    </Sheet>
  );
}

function AssetDetail({ p, onClose }: { p: Position; onClose: () => void }) {
  const data = useStore((s) => s.data);
  const [op, setOp] = useState(false);
  const [manual, setManual] = useState(p.asset.manualPriceCents ? centsToInput(p.asset.manualPriceCents) : '');
  const ops = data.operations.filter((o) => o.assetId === p.asset.id).sort((a, b) => b.date.localeCompare(a.date));
  return (
    <Full title={p.asset.ticker} onBack={onClose} action={<button className="btn sm" onClick={() => setOp(true)}>Operação</button>}>
      <div className="card">
        {p.asset.name && <div className="hint" style={{ marginBottom: 8 }}>{p.asset.name}</div>}
        <div className="kv"><span>Quantidade</span><b className="num">{formatQty(p.quantity)}</b></div>
        <div className="kv"><span>Preço médio</span><b className="num">{formatBRL(Math.round(p.avgPriceCents))}</b></div>
        <div className="kv"><span>Cotação atual</span><b className="num">{p.priceCents === null ? 'sem cotação' : formatBRL(p.priceCents)}{p.priceSource === 'manual' ? ' (manual)' : ''}</b></div>
        <div className="kv"><span>Valor de mercado</span><b className="num">{p.priceCents === null ? '—' : formatBRL(p.valueCents)}</b></div>
        <div className="kv"><span>Total investido</span><b className="num">{formatBRL(p.costCents)}</b></div>
        <div className="kv"><span>Lucro ou prejuízo</span><b className={'num ' + ((p.pnlCents ?? 0) >= 0 ? 'pos' : 'neg')}>{p.pnlCents === null ? '—' : `${formatBRL(p.pnlCents)} (${formatPct(p.pnlPct!, true)})`}</b></div>
        {p.realizedCents !== 0 && <div className="kv"><span>Realizado em vendas</span><b className="num">{formatBRL(p.realizedCents)}</b></div>}
        {p.asset.quote && <Note>Cotação de {p.asset.quote.source}, referente a {new Date(p.asset.quote.time).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}. Pode estar atrasada.</Note>}
      </div>
      <div className="card">
        <h2>Preço manual</h2>
        <div className="hint" style={{ marginBottom: 10 }}>Usado somente quando não houver cotação automática.</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <label className="field" style={{ flex: 1, margin: 0 }}><MoneyInput value={manual} onChange={setManual} /></label>
          <button className="btn sm" style={{ minHeight: 48 }} onClick={async () => { await upsert('assets', { ...p.asset, manualPriceCents: parseMoney(manual) ?? undefined }); toast('Preço manual salvo'); }}>Salvar</button>
        </div>
      </div>
      <div className="section">Histórico de compras e vendas</div>
      <div className="card" style={{ padding: '4px 14px' }}>
        {ops.map((o) => (
          <div className="row" key={o.id}>
            <div className="mid"><div className="t">{o.side === 'buy' ? 'Compra' : 'Venda'} de {formatQty(o.quantity)} a {formatBRL(o.priceCents)}</div><div className="s">{formatDateBR(o.date)}{o.broker ? ' · ' + o.broker : ''}{o.feesCents ? ' · custos ' + formatBRL(o.feesCents) : ''}</div></div>
            <div className="end"><div className="num">{formatBRL(Math.round(o.quantity * o.priceCents))}</div><button className="link" onClick={async () => { const e = await deleteOperation(o.id); toast(e ?? 'Operação excluída', e ? 'err' : 'ok'); }}>Excluir</button></div>
          </div>
        ))}
      </div>
      <button className="btn danger" onClick={async () => { await deleteAsset(p.asset.id); toast('Ativo removido'); onClose(); }}>Remover ativo e todo o histórico</button>
      {op && <OpForm asset={p.asset} onClose={() => setOp(false)} />}
    </Full>
  );
}

// ------------------------- RENDA FIXA -------------------------
function Fixa() {
  const data = useStore((s) => s.data);
  const today = useStore((s) => s.today);
  const [edit, setEdit] = useState<FixedIncome | 'new' | null>(null);
  const [sim, setSim] = useState({ ini: '1000', mes: '200', taxa: '10', anos: '5' });
  const invested = data.fixedIncomes.reduce((s, f) => s + f.investedCents, 0);
  const current = data.fixedIncomes.reduce((s, f) => s + f.currentCents, 0);
  const g = simulateGrowth(parseMoney(sim.ini) ?? 0, parseMoney(sim.mes) ?? 0, parseDecimal(sim.taxa) ?? 0, Math.min(Math.max(Math.round((parseDecimal(sim.anos) ?? 0) * 12), 1), 600));
  const last = g[g.length - 1];
  const pal = seriesColors();
  return (
    <>
      <div className="grid2">
        <div className="tile"><div className="lbl">Aplicado</div><div className="val num">{formatBRL(invested)}</div></div>
        <div className="tile"><div className="lbl">Valor atual informado</div><div className="val num">{formatBRL(current)}</div></div>
      </div>
      {data.fixedIncomes.length === 0 ? <div className="card"><Empty title="Nenhum título" text="Cadastre Tesouro Direto, CDB, LCI, LCA, poupança e outros." action="Adicionar renda fixa" onAction={() => setEdit('new')} /></div> : data.fixedIncomes.map((f) => {
        const e = estimateFixed(f, today);
        return (
          <button className="card" key={f.id} style={{ width: '100%', textAlign: 'left' }} onClick={() => setEdit(f)}>
            <div className="cardhead"><div><h2>{f.name}</h2><div className="hint">{FI_LABEL[f.kind ?? 'outro']}{f.rate ? ' · ' + f.rate : ''}{f.liquidity ? ' · liquidez ' + f.liquidity : ''}</div></div><span className="badge">{f.maturityDate ? 'vence ' + formatDateBR(f.maturityDate) : 'sem vencimento'}</span></div>
            <div className="kv"><span>Aplicado em {formatDateBR(f.purchaseDate)}</span><b className="num">{formatBRL(f.investedCents)}</b></div>
            <div className="kv"><span>Valor atual (informado em {formatDayMonth(f.currentUpdatedAt)})</span><b className="num">{formatBRL(f.currentCents)}</b></div>
            {e.grossCents !== null && (<>
              <div className="kv"><span>Estimativa bruta ({formatPct(f.annualRatePct!)} a.a.)</span><b className="num">{formatBRL(e.grossCents)}</b></div>
              <div className="kv"><span>IR estimado ({formatPct(e.irPct * 100)})</span><b className="num">{e.taxCents ? '− ' + formatBRL(e.taxCents) : 'isento'}</b></div>
              <div className="kv"><span>Estimativa líquida hoje</span><b className="num">{formatBRL(e.netCents!)}</b></div>
              {e.atMaturityNetCents !== null && <div className="kv"><span>Estimativa líquida no vencimento</span><b className="num">{formatBRL(e.atMaturityNetCents)}</b></div>}
            </>)}
          </button>
        );
      })}
      {data.fixedIncomes.length > 0 && <Note>As estimativas usam juros compostos pela taxa anual que você informou e a tabela regressiva de IR. São projeções: o valor oficial é o do extrato da corretora ou do banco.</Note>}
      <div className="section">Simulador de aportes</div>
      <div className="card">
        <div className="two">
          <Field label="Valor inicial (R$)"><MoneyInput value={sim.ini} onChange={(v) => setSim({ ...sim, ini: v })} /></Field>
          <Field label="Aporte mensal (R$)"><MoneyInput value={sim.mes} onChange={(v) => setSim({ ...sim, mes: v })} /></Field>
          <Field label="Taxa anual (%)"><input inputMode="decimal" value={sim.taxa} onChange={(e) => setSim({ ...sim, taxa: e.target.value })} /></Field>
          <Field label="Prazo (anos)"><input inputMode="decimal" value={sim.anos} onChange={(e) => setSim({ ...sim, anos: e.target.value })} /></Field>
        </div>
        {last && (<>
          <ChartBox kind="line" small labels={g.map((x) => (x.month % 12 === 0 ? `${x.month / 12}a` : ''))} series={[{ label: 'Valor projetado', data: g.map((x) => x.valueCents), fill: true }, { label: 'Total aportado', data: g.map((x) => x.investedCents), color: pal[3], dashed: true }]} />
          <div className="kv" style={{ marginTop: 10 }}><span>Total aportado</span><b className="num">{formatBRL(last.investedCents)}</b></div>
          <div className="kv"><span>Valor projetado (bruto)</span><b className="num">{formatBRL(last.valueCents)}</b></div>
          <Note>Simulação com a taxa que você digitou, mantida constante. Não é promessa de rentabilidade.</Note>
        </>)}
      </div>
      <button className="fab" onClick={() => setEdit('new')} aria-label="Adicionar renda fixa"><Plus size={26} /></button>
      {edit && <FixaForm f={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function FixaForm({ f, onClose }: { f: FixedIncome | null; onClose: () => void }) {
  const today = useStore((s) => s.today);
  const [v, setV] = useState({ name: f?.name ?? '', kind: f?.kind ?? 'cdb', invested: f ? centsToInput(f.investedCents) : '', current: f ? centsToInput(f.currentCents) : '', date: f?.purchaseDate ?? today, maturity: f?.maturityDate ?? '', rate: f?.rate ?? '', annual: f?.annualRatePct ? String(f.annualRatePct).replace('.', ',') : '', liquidity: f?.liquidity ?? '', broker: f?.broker ?? '' });
  const [err, setErr] = useState<string | null>(null);
  const up = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const save = async () => {
    const inv = parseMoney(v.invested);
    if (!v.name.trim()) return setErr('Dê um nome ao investimento.');
    if (!inv || inv <= 0) return setErr('Informe o valor aplicado.');
    const cur = parseMoney(v.current) ?? inv;
    await upsert('fixedIncomes', { id: f?.id ?? uid('fi_'), name: v.name.trim(), kind: v.kind as FixedIncome['kind'], investedCents: inv, currentCents: cur, currentUpdatedAt: f && f.currentCents === cur ? f.currentUpdatedAt : today, purchaseDate: v.date, maturityDate: v.maturity || undefined, rate: v.rate.trim() || undefined, annualRatePct: parseDecimal(v.annual) ?? undefined, liquidity: v.liquidity.trim() || undefined, broker: v.broker.trim() || undefined, accountId: f?.accountId });
    toast('Renda fixa salva');
    onClose();
  };
  return (
    <Sheet title={f ? 'Editar renda fixa' : 'Nova renda fixa'} onClose={onClose}>
      <div className="two">
        <Field label="Tipo"><select value={v.kind} onChange={up('kind')}>{Object.entries(FI_LABEL).map(([k, l]) => (<option key={k} value={k}>{l}</option>))}</select></Field>
        <Field label="Nome"><input name="nome" value={v.name} onChange={up('name')} placeholder="CDB Banco X" /></Field>
        <Field label="Valor aplicado (R$)"><MoneyInput name="aplicado" value={v.invested} onChange={(x) => setV({ ...v, invested: x })} /></Field>
        <Field label="Valor atual (R$)" hint="Copie do extrato"><MoneyInput value={v.current} onChange={(x) => setV({ ...v, current: x })} /></Field>
        <Field label="Data da aplicação"><input type="date" value={v.date} onChange={up('date')} /></Field>
        <Field label="Vencimento"><input type="date" value={v.maturity} onChange={up('maturity')} /></Field>
        <Field label="Taxa contratada" hint="Ex.: 110% do CDI"><input value={v.rate} onChange={up('rate')} /></Field>
        <Field label="Taxa anual p/ estimar (%)" hint="Opcional"><input name="taxa" inputMode="decimal" value={v.annual} onChange={up('annual')} /></Field>
        <Field label="Liquidez"><input value={v.liquidity} onChange={up('liquidity')} placeholder="diária" /></Field>
        <Field label="Instituição"><input value={v.broker} onChange={up('broker')} /></Field>
      </div>
      {err && <div className="neg" role="alert">{err}</div>}
      <div className="btnrow"><button className="btn" onClick={save}>Salvar</button>{f && <button className="btn danger" onClick={async () => { await remove('fixedIncomes', f.id); toast('Removido'); onClose(); }}>Excluir</button>}</div>
    </Sheet>
  );
}

// ------------------------- DIVIDENDOS -------------------------
const KIND_LABEL: Record<string, string> = { dividendo: 'Dividendo', jcp: 'JCP', rendimento: 'Rendimento', amortizacao: 'Amortização', outro: 'Provento', estimativa: 'Estimativa' };

function Dividendos() {
  const data = useStore((s) => s.data);
  const today = useStore((s) => s.today);
  const api = useStore((s) => s.settings.api);
  const ym = monthOf(today);
  const [calYm, setCalYm] = useState(addMonthsYM(ym, 1));
  const [day, setDay] = useState<ISODate | null>(null);
  const [add, setAdd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const rows = useMemo(() => dividendRows(data, today), [data, today]);
  const next = useMemo(() => forecastMonth(data, addMonthsYM(ym, 1), today), [data, ym, today]);
  const cal = useMemo(() => forecastMonth(data, calYm, today), [data, calYm, today]);
  const sums = useMemo(() => assetDividendSummaries(data, today), [data, today]);
  const paid = rows.filter((r) => r.event.paymentDate && r.event.paymentDate <= today);
  const thisMonth = rows.filter((r) => r.event.paymentDate && monthOf(r.event.paymentDate) === ym).reduce((s, r) => s + r.netCents, 0);
  const year = paid.filter((r) => r.event.paymentDate!.slice(0, 4) === today.slice(0, 4)).reduce((s, r) => s + r.netCents, 0);
  const series = passiveIncomeSeries(data, 12, today);
  const avg = Math.round(series.reduce((s, x) => s + x.cents, 0) / 12);
  const refresh = async () => {
    setBusy(true);
    try { const r = await refreshDividends(); setErrors([...new Set(r.errors.map((e) => `${e.ticker}: ${e.message}`))]); toast(r.added > 0 ? `${r.added} proventos novos` : 'Nenhum provento novo'); } finally { setBusy(false); }
  };
  const byDay = new Map<string, typeof cal.items>();
  for (const i of cal.items) byDay.set(i.date, [...(byDay.get(i.date) ?? []), i]);
  const cells: (number | null)[] = [...Array(weekdayOfFirst(calYm)).fill(null), ...Array.from({ length: daysInMonth(calYm) }, (_, i) => i + 1)];
  const dayItems = day ? byDay.get(day) ?? [] : cal.items;
  return (
    <>
      <div className="grid2">
        <div className="tile"><div className="lbl">Neste mês</div><div className="val num">{formatBRL(thisMonth)}</div></div>
        <div className="tile"><div className="lbl">Próximo mês (previsão)</div><div className="val num">{formatBRL(next.totalCents)}</div><div className="foot">{formatBRL(next.officialCents)} anunciados</div></div>
        <div className="tile"><div className="lbl">Recebido no ano</div><div className="val num">{formatBRL(year)}</div></div>
        <div className="tile"><div className="lbl">Média mensal (12 meses)</div><div className="val num">{formatBRL(avg)}</div></div>
      </div>
      <div className="btnrow" style={{ marginTop: 0, marginBottom: 12 }}>
        <button className="btn ghost" onClick={refresh} disabled={busy || data.assets.length === 0 || api.dividendProvider === 'manual'}><RefreshCw size={16} /> Buscar proventos</button>
        <button className="btn ghost" onClick={() => setAdd(true)} disabled={data.assets.length === 0}><Plus size={16} /> Cadastrar</button>
      </div>
      {errors.map((e) => (<div className="note neg" key={e} style={{ marginBottom: 8 }}>{e}</div>))}

      <div className="card">
        <div className="cardhead"><div><h2>Previsão de {monthLong(next.ym)}</h2><div className="hint">Quantidade que você possui × valor por ação ou cota</div></div></div>
        {next.items.length === 0 ? <div className="empty">Nenhum pagamento anunciado e sem histórico para estimar.</div> : next.items.map((i, k) => (
          <div className="row" key={k}>
            <div className="mid"><div className="t">{i.ticker} <span className={'badge ' + (i.official ? 'good' : 'est')}>{i.official ? 'anunciado' : 'estimativa'}</span></div><div className="s">{i.official ? `${KIND_LABEL[i.kind]} em ${formatDateBR(i.date)}` : `Projeção pela ${i.note}`} · {formatQty(i.quantity)} un.</div></div>
            <div className="end num">{formatBRL(i.cents)}</div>
          </div>
        ))}
        {next.estimatedCents > 0 && <Note>{formatBRL(next.estimatedCents)} são estimativas baseadas no histórico. Não é valor garantido: o pagamento real depende do anúncio oficial.</Note>}
        {next.withoutHistory.length > 0 && <Note>Sem anúncio nem histórico para estimar: {next.withoutHistory.join(', ')}.</Note>}
      </div>

      <div className="card">
        <h2 style={{ marginBottom: 10 }}>Calendário de recebimentos</h2>
        <MonthNav ym={calYm} onChange={(m) => { setCalYm(m); setDay(null); }} />
        <div className="cal">
          {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => (<div className="wd" key={i}>{d}</div>))}
          {cells.map((d, i) => {
            if (d === null) return <span key={i} />;
            const iso = `${calYm}-${String(d).padStart(2, '0')}`;
            const its = byDay.get(iso);
            const cls = [its ? 'has' : '', its && its.every((x) => !x.official) ? 'est' : '', iso === today ? 'today' : '', iso === day ? 'sel' : ''].join(' ');
            return its ? <button key={i} className={cls} onClick={() => setDay(iso === day ? null : iso)} aria-label={`${d}: ${its.length} pagamento(s)`}>{d}</button> : <span key={i} className={cls}>{d}</span>;
          })}
        </div>
        <Legend items={[{ label: 'Anunciado', color: cssVar('--gold') }, { label: 'Estimativa', color: cssVar('--gold'), dashed: true }]} />
        {dayItems.map((i, k) => (<div className="kv" key={k}><span>{formatDayMonth(i.date)} · {i.ticker} {i.official ? '' : '(estimativa)'}</span><b className="num">{formatBRL(i.cents)}</b></div>))}
      </div>

      {series.some((x) => x.cents > 0) && <div className="card"><h2>Evolução da renda passiva</h2><ChartBox kind="bar" small labels={series.map((x) => monthShort(x.ym))} series={[{ label: 'Proventos líquidos', data: series.map((x) => x.cents), color: cssVar('--s4') }]} /></div>}

      <div className="section">Por ativo</div>
      <div className="card" style={{ padding: '4px 14px' }}>
        {data.assets.length === 0 ? <Empty title="Sem ativos" text="Cadastre seus ativos na aba Bolsa." /> : data.assets.map((a) => {
          const s = sums.get(a.id);
          return (
            <div className="row" key={a.id}>
              <div className="mid"><div className="t">{a.ticker}</div><div className="s">{s?.lastPayment ? `Último: ${formatRate(s.lastPayment.event.ratePerUnit)}/un. em ${formatDateBR(s.lastPayment.event.paymentDate!)}` : 'Sem pagamentos registrados'}</div><div className="s">{s?.nextPayment ? `Próximo: ${formatDateBR(s.nextPayment.event.paymentDate!)} · ${formatBRL(s.nextPayment.netCents)}` : 'Próxima data não anunciada'}</div></div>
              <div className="end"><div className="num">{formatBRL(s?.receivedCents ?? 0)}</div><div className="s">recebidos</div></div>
            </div>
          );
        })}
      </div>

      <div className="section">Histórico de pagamentos</div>
      <div className="card" style={{ padding: '4px 14px' }}>
        {rows.length === 0 ? <Empty title="Nenhum provento" text="Busque pela API (se o seu plano permitir) ou cadastre manualmente." /> : rows.slice(0, 60).map((r) => (
          <div className="row" key={r.event.id}>
            <div className="mid">
              <div className="t">{r.asset.ticker} · {KIND_LABEL[r.event.kind]}</div>
              <div className="s">{formatRate(r.event.ratePerUnit)} × {formatQty(r.quantity)}{r.event.dataCom ? ` · data-com ${formatDayMonth(r.event.dataCom)}` : ''}{r.event.kind === 'jcp' ? ' · IR 15% descontado' : ''}</div>
              <div className="s">{r.event.paymentDate ? `Pagamento ${formatDateBR(r.event.paymentDate)}` : 'Data de pagamento não divulgada'} · {r.event.source === 'manual' ? 'informado por você' : r.event.sourceName}</div>
            </div>
            <div className="end">
              <div className="num">{formatBRL(r.netCents)}</div>
              {r.status === 'recebido' ? <span className="badge good">recebido</span> : r.status === 'a_confirmar' ? <button className="link" onClick={async () => { await confirmDividend(r.event.id); toast('Registrado na sua conta'); }}>Confirmar</button> : <span className="badge">{r.status === 'agendado' ? 'a receber' : 'sem data'}</span>}
              {r.event.source === 'manual' && r.status !== 'recebido' && <div><button className="link" onClick={() => remove('dividends', r.event.id)}>Excluir</button></div>}
            </div>
          </div>
        ))}
      </div>
      <Note>{api.dividendProvider === 'brapi' ? 'Fonte: brapi.dev. Proventos pela API exigem plano Startup ou Pro; no plano gratuito, cadastre manualmente ou escolha outra fonte em Ajustes.' : api.dividendProvider === 'yahoo' ? 'Fonte: Yahoo Finance (não oficial): traz só valor e data ex, sem data de pagamento e sem separar JCP.' : 'Busca automática desligada: os proventos são os que você cadastrar.'} Não há integração bancária: o recebimento é confirmado por você.</Note>
      {add && <DivForm onClose={() => setAdd(false)} />}
    </>
  );
}

function DivForm({ onClose }: { onClose: () => void }) {
  const data = useStore((s) => s.data);
  const today = useStore((s) => s.today);
  const [assetId, setAssetId] = useState(data.assets[0]?.id ?? '');
  const asset = data.assets.find((a) => a.id === assetId);
  const [kind, setKind] = useState<DividendKind>(asset?.type === 'fii' ? 'rendimento' : 'dividendo');
  const [rate, setRate] = useState('');
  const [dataCom, setDataCom] = useState('');
  const [pay, setPay] = useState(today);
  const [err, setErr] = useState<string | null>(null);
  const qty = asset ? quantityAt(data.operations, asset.id, dataCom || pay || today) : 0;
  const r = parseDecimal(rate);
  const save = async () => {
    if (!asset) return setErr('Escolha o ativo.');
    if (!r || r <= 0) return setErr('Informe o valor por ação ou cota.');
    if (!pay && !dataCom) return setErr('Informe a data-com ou a data de pagamento.');
    if (qty <= 0) return setErr('Você não tinha esse ativo na data informada.');
    await upsert('dividends', { id: uid('d_'), assetId: asset.id, kind, ratePerUnit: r, dataCom: dataCom || undefined, paymentDate: pay || undefined, source: 'manual', official: !!pay, key: 'manual|' + makeEventKey(asset.ticker, kind, dataCom || pay, r) });
    toast('Provento cadastrado');
    onClose();
  };
  return (
    <Sheet title="Cadastrar provento" onClose={onClose}>
      <div className="two">
        <Field label="Ativo"><select value={assetId} onChange={(e) => { setAssetId(e.target.value); const t = data.assets.find((a) => a.id === e.target.value)?.type; setKind(t === 'fii' ? 'rendimento' : 'dividendo'); }}>{data.assets.map((a) => (<option key={a.id} value={a.id}>{a.ticker}</option>))}</select></Field>
        <Field label="Tipo"><select value={kind} onChange={(e) => setKind(e.target.value as DividendKind)}><option value="dividendo">Dividendo</option><option value="jcp">JCP</option><option value="rendimento">Rendimento (FII)</option><option value="amortizacao">Amortização</option></select></Field>
      </div>
      <Field label="Valor por ação ou cota (R$)" hint={kind === 'jcp' ? 'Informe o valor bruto: o app desconta os 15% de IR.' : undefined}><input name="valor_cota" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0,10" /></Field>
      <div className="two">
        <Field label="Data-com (opcional)"><input type="date" value={dataCom} onChange={(e) => setDataCom(e.target.value)} /></Field>
        <Field label="Data de pagamento"><input type="date" value={pay} onChange={(e) => setPay(e.target.value)} /></Field>
      </div>
      {asset && r ? <div className="kv"><span>{formatQty(qty)} un. × {formatRate(r)}</span><b className="num">{formatBRL(Math.round(r * qty * 100 * (kind === 'jcp' ? 0.85 : 1)))}</b></div> : null}
      {err && <div className="neg" role="alert">{err}</div>}
      <div className="btnrow"><button className="btn" onClick={save}>Salvar</button></div>
    </Sheet>
  );
}
