import { useMemo, useState } from 'react';
import { Plus, RefreshCw, Search } from 'lucide-react';
import { defaultAccountId, deleteCryptoAsset, deleteCryptoOperation, refreshCryptoQuotes, refreshHistory, saveCryptoOperation, toast, upsert, useStore } from '../state/store';
import type { CryptoAsset, HistoryPoint, ISODate } from '../lib/types';
import { computePositions, portfolioTotals, type InvestOp, type Position } from '../domain/portfolio';
import { benchmarkCurve, cdiAccumulated, historyId, ipcaAccumulated, PERIOD_LABEL, periodStart, pointsBetween, portfolioPerformance, sample, type Period } from '../domain/market';
import { POPULAR_COINS, searchCoins, type CoinHit } from '../services/market';
import { centsToInput, formatBRL, formatPct, formatQty, parseDecimal, parseMoney } from '../lib/money';
import { addMonths, formatDateBR, formatDayMonth, monthShortYear } from '../lib/dates';
import { uid } from '../lib/ids';
import { ChartBox, Empty, Field, Full, Legend, MoneyInput, Note, QuoteStamp, Seg, seriesColors, Sheet, SwitchRow } from './kit';

const spin = (busy: boolean) => (busy ? { animation: 'spin 1s linear infinite' } : undefined);
const uniq = (xs: string[]) => [...new Set(xs)];

// ============================ DESEMPENHO x CDI x IPCA ============================

/** Rentabilidade da carteira (bolsa ou cripto) comparada ao CDI e ao IPCA, no período escolhido. */
export function PerformanceCard({ scope }: { scope: 'b3' | 'cripto' }) {
  const data = useStore((s) => s.data);
  const today = useStore((s) => s.today);
  const [period, setPeriod] = useState<Period>('6m');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const ops: InvestOp[] = scope === 'b3' ? data.operations : data.cryptoOps;
  const keys = scope === 'b3' ? data.assets.map((a) => [a.id, historyId('b3', a.ticker), a.ticker] as const) : data.cryptoAssets.map((a) => [a.id, historyId('cripto', a.coinId), a.symbol] as const);
  const hist = (id: string) => data.marketHistory.find((h) => h.id === id);
  const firstOp = ops.reduce<ISODate | undefined>((m, o) => (!m || o.date < m ? o.date : m), undefined);
  const from = periodStart(period, today, firstOp);

  const res = useMemo(() => {
    const prices: Record<string, HistoryPoint[]> = {};
    for (const [id, key] of keys) prices[id] = hist(key)?.points ?? [];
    const perf = portfolioPerformance(ops, prices, from, today);
    const cdi = hist(historyId('indice', 'CDI'))?.points ?? [];
    const ipca = hist(historyId('indice', 'IPCA'))?.points ?? [];
    const pts = sample(perf.points, 60);
    const dates = pts.map((p) => p.date);
    return { perf, pts, cdiAcc: cdiAccumulated(cdi, from, today), ipcaAcc: ipcaAccumulated(ipca, from, today), cdiCurve: benchmarkCurve('cdi', cdi, from, dates), ipcaCurve: benchmarkCurve('ipca', ipca, from, dates), hasIdx: cdi.length > 0 };
  }, [data.marketHistory, ops, from, today]);

  if (!firstOp) return null;
  const { perf, pts, cdiAcc, ipcaAcc, cdiCurve, ipcaCurve, hasIdx } = res;
  const pal = seriesColors();
  const noHistory = keys.every(([, key]) => !hist(key)?.points.length);
  const estimated = perf.estimated.map((id) => keys.find(([k]) => k === id)?.[2] ?? id);
  const update = async () => {
    setBusy(true);
    try {
      const r = await refreshHistory(scope, true);
      setErrors(uniq(r.errors.map((e) => `${e.ticker}: ${e.message}`)));
      toast(r.errors.length ? 'Histórico atualizado em parte' : 'Histórico atualizado', r.errors.length ? 'err' : 'ok');
    } finally {
      setBusy(false);
    }
  };
  // sem nenhum fechamento guardado, a conta usaria só os preços das operações: melhor não mostrar número
  const pct = noHistory ? null : perf.pct;
  const ofCdi = pct !== null && cdiAcc.pct > 0.01 ? (pct / cdiAcc.pct) * 100 : null;
  const realGain = pct !== null && ipcaAcc.until ? ((1 + pct / 100) / (1 + ipcaAcc.pct / 100) - 1) * 100 : null;
  return (
    <div className="card">
      <div className="cardhead">
        <h2 style={{ margin: 0 }}>Desempenho</h2>
        <button className="iconbtn" onClick={update} disabled={busy} aria-label="Atualizar histórico de preços e índices"><RefreshCw size={18} style={spin(busy)} /></button>
      </div>
      <Seg value={period} onChange={setPeriod} options={(Object.keys(PERIOD_LABEL) as Period[]).map((p) => [p, PERIOD_LABEL[p]])} />
      <div className="grid3">
        <div className="tile"><div className="lbl">Carteira</div><div className={'val num ' + (pct === null ? '' : pct >= 0 ? 'pos' : 'neg')}>{pct === null ? '—' : formatPct(pct, true)}</div></div>
        <div className="tile"><div className="lbl">CDI</div><div className="val num">{hasIdx ? formatPct(cdiAcc.pct, true) : '—'}</div></div>
        <div className="tile"><div className="lbl">IPCA</div><div className="val num">{ipcaAcc.until ? formatPct(ipcaAcc.pct, true) : '—'}</div></div>
      </div>
      {pct !== null && hasIdx && (
        <div className="kv">
          <span>Comparado ao CDI</span>
          {/* "% do CDI" só faz sentido com ganho; com perda, mostra a distância em pontos */}
          <b className={'num ' + (pct >= cdiAcc.pct ? 'pos' : 'neg')}>{ofCdi !== null && pct >= 0 ? `${ofCdi.toFixed(0)}% do CDI` : `${formatPct(Math.abs(pct - cdiAcc.pct)).replace('%', '')} pontos ${pct >= cdiAcc.pct ? 'acima' : 'abaixo'}`}</b>
        </div>
      )}
      {realGain !== null && <div className="kv"><span>Ganho acima da inflação</span><b className={'num ' + (realGain >= 0 ? 'pos' : 'neg')}>{formatPct(realGain, true)}</b></div>}
      {pts.length > 1 && !noHistory && (
        <>
          <ChartBox kind="line" format="pct" labels={pts.map((p) => formatDayMonth(p.date))} series={[{ label: 'Carteira', data: pts.map((p) => p.pct) }, { label: 'CDI', data: cdiCurve, color: pal[2], dashed: true }, { label: 'IPCA', data: ipcaCurve, color: pal[4], dashed: true }]} />
          <Legend items={[{ label: 'Carteira', color: pal[0] }, { label: 'CDI', color: pal[2], dashed: true }, { label: 'IPCA', color: pal[4], dashed: true }]} />
        </>
      )}
      {(noHistory || !hasIdx) && <Note>Toque em atualizar para buscar o histórico de preços e os índices do Banco Central.</Note>}
      {estimated.length > 0 && !noHistory && <Note>Sem preço de fechamento em parte do período para {estimated.join(', ')}: nesses dias valeu o preço da sua última operação.</Note>}
      <Note>
        Rentabilidade por cotas, como nos fundos: compras e vendas não contam como ganho. Proventos não entram aqui.
        {ipcaAcc.until ? ` IPCA divulgado até ${monthShortYear(ipcaAcc.until)}.` : ''}
        {scope === 'b3' ? ' A brapi gratuita traz até 3 meses de preços; o app guarda cada dia buscado, então o histórico cresce com o uso.' : ' A CoinGecko gratuita traz até 12 meses; o app guarda cada dia buscado.'}
      </Note>
      {errors.map((e) => (<div className="note neg" key={e}>{e}</div>))}
    </div>
  );
}

/** Gráfico do preço de um ativo, com o histórico guardado no aparelho. */
export function PriceChart({ historyKey, today }: { historyKey: string; today: ISODate }) {
  const h = useStore((s) => s.data.marketHistory.find((x) => x.id === historyKey));
  const [months, setMonths] = useState<'1' | '3' | '12'>('3');
  const pts = sample(pointsBetween(h?.points ?? [], addMonths(today, -Number(months)), today), 80);
  if (!h?.points.length) return null;
  const first = pts[0]?.[1];
  const last = pts[pts.length - 1]?.[1];
  return (
    <div className="card">
      <h2>Preço</h2>
      <Seg value={months} onChange={setMonths} options={[['1', '1 mês'], ['3', '3 meses'], ['12', '12 meses']]} />
      {pts.length > 1 ? (
        <>
          <ChartBox kind="line" labels={pts.map(([d]) => formatDayMonth(d))} series={[{ label: 'Preço', data: pts.map(([, v]) => v), fill: true }]} />
          {first && last ? <div className="kv"><span>Variação no período</span><b className={'num ' + (last >= first ? 'pos' : 'neg')}>{formatPct(((last - first) / first) * 100, true)}</b></div> : null}
        </>
      ) : <Note>Ainda não há pontos suficientes neste período.</Note>}
      <Note>Fonte: {h.source}. {h.points.length} dias guardados neste aparelho, desde {formatDateBR(h.points[0][0])}.</Note>
    </div>
  );
}

// ============================ CRIPTO ============================

export function Cripto() {
  const data = useStore((s) => s.data);
  const today = useStore((s) => s.today);
  const [busy, setBusy] = useState(false);
  const [add, setAdd] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const positions = useMemo(() => computePositions(data.cryptoAssets, data.cryptoOps), [data.cryptoAssets, data.cryptoOps]);
  const totals = portfolioTotals(positions, []);
  const held = positions.filter((p) => p.quantity > 0).sort((a, b) => b.valueCents - a.valueCents);
  const pal = seriesColors();
  const refresh = async () => {
    setBusy(true);
    try {
      const r = await refreshCryptoQuotes();
      const h = await refreshHistory('cripto');
      setErrors(uniq([...r.errors, ...h.errors].map((e) => `${e.ticker}: ${e.message}`)));
      toast(r.updated > 0 ? `${r.updated} ${r.updated === 1 ? 'cotação atualizada' : 'cotações atualizadas'}` : 'Nenhuma cotação atualizada', r.updated > 0 ? 'ok' : 'err');
    } finally {
      setBusy(false);
    }
  };
  const slices = held.slice(0, 8).map((p, i) => ({ label: p.asset.symbol, v: p.valueCents, color: pal[i] }));
  const dp = detail ? positions.find((p) => p.asset.id === detail) : null;
  return (
    <>
      <div className="card hero">
        <div className="cardhead">
          <div><div className="lbl">Valor em cripto</div><div className="big num" style={{ fontSize: 30 }}>{formatBRL(totals.equityValueCents)}</div></div>
          <button className="iconbtn" onClick={refresh} disabled={busy || data.cryptoAssets.length === 0} aria-label="Atualizar cotações de cripto"><RefreshCw size={18} style={spin(busy)} /></button>
        </div>
        <div className="kv"><span>Total investido</span><b className="num">{formatBRL(totals.investedCents)}</b></div>
        <div className="kv"><span>Lucro ou prejuízo</span><b className={'num ' + (totals.pnlCents > 0 ? 'pos' : totals.pnlCents < 0 ? 'neg' : '')}>{totals.pnlPct === null ? '—' : `${formatBRL(totals.pnlCents)} (${formatPct(totals.pnlPct, true)})`}</b></div>
        {totals.realizedCents !== 0 && <div className="kv"><span>Resultado já realizado em vendas</span><b className="num">{formatBRL(totals.realizedCents)}</b></div>}
        <Note>Preços da CoinGecko em reais (API pública e gratuita), com alguns minutos de atraso. Cripto oscila muito: trate como parte pequena da carteira.</Note>
        {errors.map((e) => (<div className="note neg" key={e}>{e}</div>))}
      </div>
      {held.length === 0 ? <div className="card"><Empty title="Nenhuma cripto" text="Cadastre suas moedas com a quantidade, o preço ou o total pago e a data da compra." action="Adicionar cripto" onAction={() => setAdd(true)} /></div> : (
        <>
          <div className="card" style={{ padding: '4px 14px' }}>
            {held.map((p) => (
              <button className="row" key={p.asset.id} onClick={() => setDetail(p.asset.id)}>
                <div className="ic" style={{ fontSize: 11, fontWeight: 650, color: 'var(--text)' }}>{p.asset.symbol.slice(0, 4)}</div>
                <div className="mid">
                  <div className="t">{p.asset.name} {p.asset.quote ? <QuoteStamp quote={p.asset.quote} compact /> : null}</div>
                  <div className="s">{formatQty(p.quantity)} {p.asset.symbol} × PM {formatBRL(Math.round(p.avgPriceCents))}{p.asset.quote?.changePct !== undefined ? ` · 24 h ${formatPct(p.asset.quote.changePct, true)}` : ''}</div>
                </div>
                <div className="end"><div className="num">{formatBRL(p.valueCents)}</div>{p.pnlPct === null ? <span className="badge warn">sem cotação</span> : <div className={'s num ' + (p.pnlCents! >= 0 ? 'pos' : 'neg')}>{formatPct(p.pnlPct, true)}</div>}</div>
              </button>
            ))}
          </div>
          {slices.length > 1 && (
            <div className="card">
              <h2>Participação</h2>
              <ChartBox kind="doughnut" small labels={slices.map((s) => s.label)} series={[{ label: 'Cripto', data: slices.map((s) => s.v) }]} colors={slices.map((s) => s.color)} />
              <Legend items={slices.map((s) => ({ label: s.label, color: s.color, value: ((s.v / totals.equityValueCents) * 100).toFixed(1).replace('.', ',') + '%' }))} />
            </div>
          )}
        </>
      )}
      <PerformanceCard scope="cripto" />
      <button className="fab" onClick={() => setAdd(true)} aria-label="Adicionar cripto ou operação"><Plus size={26} /></button>
      {add && <CryptoForm onClose={() => setAdd(false)} />}
      {dp && <CryptoDetail p={dp} today={today} onClose={() => setDetail(null)} />}
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
    </>
  );
}

/** Número de casas decimais digitadas (para limitar a 8 na quantidade de cripto). */
const decimals = (s: string) => (s.includes(',') ? s.split(',')[1].length : s.includes('.') && !/^\d{1,3}(\.\d{3})+$/.test(s) ? s.split('.')[1].length : 0);

function CryptoForm({ onClose, asset }: { onClose: () => void; asset?: CryptoAsset }) {
  const data = useStore((s) => s.data);
  const today = useStore((s) => s.today);
  const known = [...data.cryptoAssets.map(({ coinId, symbol, name }) => ({ coinId, symbol, name })), ...POPULAR_COINS.filter((c) => !data.cryptoAssets.some((a) => a.coinId === c.coinId))];
  const [coinId, setCoinId] = useState(asset?.coinId ?? 'bitcoin');
  const [found, setFound] = useState<CoinHit[]>([]);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [mode, setMode] = useState<'total' | 'unit'>('total');
  const [qty, setQty] = useState('');
  const [money, setMoney] = useState('');
  const [fees, setFees] = useState('');
  const [date, setDate] = useState(today);
  const [broker, setBroker] = useState(data.cryptoOps[data.cryptoOps.length - 1]?.broker ?? '');
  const [debit, setDebit] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const options = [...known, ...found.filter((f) => !known.some((k) => k.coinId === f.coinId))];
  const coin = asset ? { coinId: asset.coinId, symbol: asset.symbol, name: asset.name } : options.find((c) => c.coinId === coinId);
  const search = async () => {
    setSearching(true);
    try {
      const r = await searchCoins(query);
      if (!Array.isArray(r)) return setErr(r.message);
      setErr(r.length ? null : 'Nenhuma moeda encontrada com esse nome.');
      setFound(r);
      if (r[0]) setCoinId(r[0].coinId);
    } finally {
      setSearching(false);
    }
  };
  const q = parseDecimal(qty);
  const m = parseMoney(money);
  const unitCents = q && m ? (mode === 'unit' ? m : m / q) : null;
  const save = async () => {
    if (!coin) return setErr('Escolha a moeda.');
    if (!q || q <= 0) return setErr('Informe a quantidade.');
    if (decimals(qty.trim()) > 8) return setErr('Use no máximo 8 casas decimais na quantidade.');
    if (!m || m <= 0 || !unitCents) return setErr(mode === 'unit' ? 'Informe o preço de 1 unidade.' : 'Informe o total pago ou recebido.');
    if (date > today) return setErr('A data não pode ser no futuro.');
    let a = asset ?? data.cryptoAssets.find((x) => x.coinId === coin.coinId);
    if (!a) {
      a = { id: uid('cr_'), coinId: coin.coinId, symbol: coin.symbol, name: coin.name };
      await upsert('cryptoAssets', a);
    }
    const e = await saveCryptoOperation({ id: uid('co_'), assetId: a.id, side, quantity: q, priceCents: unitCents, feesCents: parseMoney(fees) ?? 0, date, broker: broker.trim(), accountId: debit ? defaultAccountId() : undefined, createdAt: Date.now() });
    if (e) return setErr(e);
    toast(side === 'buy' ? 'Compra registrada' : 'Venda registrada');
    onClose();
  };
  return (
    <Sheet title={asset ? `Nova operação em ${asset.symbol}` : 'Adicionar cripto'} onClose={onClose}>
      <Seg value={side} onChange={setSide} options={[['buy', 'Compra'], ['sell', 'Venda']]} />
      {!asset && (
        <>
          <Field label="Moeda">
            <select name="moeda" value={coinId} onChange={(e) => setCoinId(e.target.value)}>
              {options.map((c) => (<option key={c.coinId} value={c.coinId}>{c.name} ({c.symbol})</option>))}
            </select>
          </Field>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <label className="field" style={{ flex: 1, margin: 0 }}><span>Não está na lista? Busque pelo nome</span><input name="busca_moeda" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ex.: Polygon, Pepe" onKeyDown={(e) => e.key === 'Enter' && void search()} /></label>
            <button className="btn sm ghost" style={{ minHeight: 48 }} onClick={search} disabled={searching || query.trim().length < 2} aria-label="Buscar moeda"><Search size={18} /></button>
          </div>
        </>
      )}
      <Seg value={mode} onChange={setMode} options={[['total', side === 'buy' ? 'Total pago' : 'Total recebido'], ['unit', 'Preço por unidade']]} />
      <div className="two">
        <Field label={`Quantidade${coin ? ` (${coin.symbol})` : ''}`} hint="Pode ter fração, ex.: 0,0025"><input name="quantidade" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0,0025" /></Field>
        <Field label={mode === 'unit' ? 'Preço de 1 unidade (R$)' : side === 'buy' ? 'Total pago (R$)' : 'Total recebido (R$)'}><MoneyInput name="valor" value={money} onChange={setMoney} /></Field>
      </div>
      {mode === 'total' && unitCents ? <div className="hint" style={{ margin: '-4px 0 8px' }}>Preço por unidade: {formatBRL(Math.round(unitCents))}</div> : null}
      <div className="two">
        <Field label="Data"><input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Taxas (R$, opcional)"><MoneyInput value={fees} onChange={setFees} /></Field>
      </div>
      <Field label="Corretora ou exchange"><input name="corretora" value={broker} onChange={(e) => setBroker(e.target.value)} placeholder="Ex.: Mercado Bitcoin, Binance, Nubank" /></Field>
      <SwitchRow title={side === 'buy' ? 'Debitar da conta principal' : 'Creditar na conta principal'} sub="Desligue para moedas que você já tinha" on={debit} onChange={setDebit} />
      {err && <div className="neg" role="alert" style={{ margin: '8px 0' }}>{err}</div>}
      <div className="btnrow"><button className="btn" onClick={save}>Salvar</button></div>
    </Sheet>
  );
}

function CryptoDetail({ p, today, onClose }: { p: Position<CryptoAsset>; today: ISODate; onClose: () => void }) {
  const data = useStore((s) => s.data);
  const [op, setOp] = useState(false);
  const [manual, setManual] = useState(p.asset.manualPriceCents ? centsToInput(p.asset.manualPriceCents) : '');
  const ops = data.cryptoOps.filter((o) => o.assetId === p.asset.id).sort((a, b) => b.date.localeCompare(a.date));
  return (
    <Full title={p.asset.symbol} onBack={onClose} action={<button className="btn sm" onClick={() => setOp(true)}>Operação</button>}>
      <div className="card">
        <div className="hint" style={{ marginBottom: 8 }}>{p.asset.name}</div>
        <div className="kv"><span>Quantidade</span><b className="num">{formatQty(p.quantity)} {p.asset.symbol}</b></div>
        <div className="kv"><span>Preço médio</span><b className="num">{formatBRL(Math.round(p.avgPriceCents))}</b></div>
        <div className="kv"><span>Cotação atual</span><b className="num">{p.priceCents === null ? 'sem cotação' : formatBRL(p.priceCents)}{p.priceSource === 'manual' ? ' (manual)' : ''}</b></div>
        {p.asset.quote?.changePct !== undefined && <div className="kv"><span>Variação em 24 h</span><b className={'num ' + (p.asset.quote.changePct >= 0 ? 'pos' : 'neg')}>{formatPct(p.asset.quote.changePct, true)}</b></div>}
        <div className="kv"><span>Valor de mercado</span><b className="num">{p.priceCents === null ? '—' : formatBRL(p.valueCents)}</b></div>
        <div className="kv"><span>Total investido</span><b className="num">{formatBRL(p.costCents)}</b></div>
        <div className="kv"><span>Lucro ou prejuízo</span><b className={'num ' + ((p.pnlCents ?? 0) >= 0 ? 'pos' : 'neg')}>{p.pnlCents === null ? '—' : `${formatBRL(p.pnlCents)} (${formatPct(p.pnlPct!, true)})`}</b></div>
        {p.realizedCents !== 0 && <div className="kv"><span>Realizado em vendas</span><b className="num">{formatBRL(p.realizedCents)}</b></div>}
        {p.asset.quote && <div style={{ marginTop: 8 }}><QuoteStamp quote={p.asset.quote} /></div>}
      </div>
      <PriceChart historyKey={historyId('cripto', p.asset.coinId)} today={today} />
      <div className="card">
        <h2>Preço manual</h2>
        <div className="hint" style={{ marginBottom: 10 }}>Usado somente quando não houver cotação automática.</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <label className="field" style={{ flex: 1, margin: 0 }}><MoneyInput value={manual} onChange={setManual} /></label>
          <button className="btn sm" style={{ minHeight: 48 }} onClick={async () => { await upsert('cryptoAssets', { ...p.asset, manualPriceCents: parseMoney(manual) ?? undefined }); toast('Preço manual salvo'); }}>Salvar</button>
        </div>
      </div>
      <div className="section">Histórico de compras e vendas</div>
      <div className="card" style={{ padding: '4px 14px' }}>
        {ops.map((o) => (
          <div className="row" key={o.id}>
            <div className="mid"><div className="t">{o.side === 'buy' ? 'Compra' : 'Venda'} de {formatQty(o.quantity)} a {formatBRL(Math.round(o.priceCents))}</div><div className="s">{formatDateBR(o.date)}{o.broker ? ' · ' + o.broker : ''}{o.feesCents ? ' · taxas ' + formatBRL(o.feesCents) : ''}</div></div>
            <div className="end"><div className="num">{formatBRL(Math.round(o.quantity * o.priceCents))}</div><button className="link" onClick={async () => { const e = await deleteCryptoOperation(o.id); toast(e ?? 'Operação excluída', e ? 'err' : 'ok'); }}>Excluir</button></div>
          </div>
        ))}
      </div>
      <button className="btn danger" onClick={async () => { await deleteCryptoAsset(p.asset.id); toast('Moeda removida'); onClose(); }}>Remover moeda e todo o histórico</button>
      {op && <CryptoForm asset={p.asset} onClose={() => setOp(false)} />}
    </Full>
  );
}
