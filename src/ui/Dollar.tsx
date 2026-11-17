import { useEffect, useMemo, useState } from 'react';
import { Newspaper, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { News } from './News';
import { refreshDollar, refreshUsQuotes, remove, toast, upsert, useStore } from '../state/store';
import { dollarSummary, formatUSD, holdingCostUsd, holdingUsd, isAsset, KIND_LABEL, rateChange, USD_HISTORY_ID } from '../domain/dollar';
import { formatBRL, parseDecimal } from '../lib/money';
import { addDays, formatDateBR, formatDayMonth } from '../lib/dates';
import { uid } from '../lib/ids';
import type { UsdHolding } from '../lib/types';
import { ChartBox, Field, Legend, Note, Seg, seriesColors, Sheet } from './kit';

/** Painel em dólar (Etapa 15): contas em dólar, ações e ETFs dos EUA e investimentos em dólar do banco. */
export function DollarHome() {
  const data = useStore((s) => s.data);
  const today = useStore((s) => s.today);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<UsdHolding | 'novo' | null>(null);
  const [range, setRange] = useState<'30' | '90' | '365'>('90');
  const [news, setNews] = useState(false);
  const sum = useMemo(() => dollarSummary(data), [data]);
  const hist = data.marketHistory.find((h) => h.id === USD_HISTORY_ID);
  const pts = (hist?.points ?? []).filter(([d]) => d >= addDays(today, -Number(range)));
  const ch = hist ? rateChange(hist.points, Number(range)) : null;
  const ch1 = hist ? rateChange(hist.points, 1) : null;
  const pal = seriesColors();
  const holdings = [...(data.usdHoldings ?? [])].sort((a, b) => holdingUsd(b) - holdingUsd(a));
  const bankUsd = (data.bankInvestments ?? []).filter((i) => i.currency === 'USD');

  const refresh = async (force: boolean) => {
    setBusy(true);
    try {
      const errs = [...(await refreshDollar(force)), ...(await refreshUsQuotes())];
      if (force) toast(errs.length ? errs[0].message : 'Cotações atualizadas', errs.length ? 'err' : 'ok');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { void refresh(false); /* uma vez ao abrir; a busca do dólar é no máximo 1×/dia */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="card hero">
        <div className="lbl">Total em dólar</div>
        <div className="big num">{formatUSD(sum.totalUsd)}</div>
        <div className="hint">{sum.totalBrl !== null ? `≈ ${formatBRL(sum.totalBrl)} pela cotação de ${formatDateBR(sum.rate!.date)}` : 'Sem cotação do dólar ainda: toque em Atualizar.'}{sum.gainUsd ? ` · ações ${sum.gainUsd >= 0 ? '+' : ''}${formatUSD(sum.gainUsd)}` : ''}</div>
        {sum.byKind.length > 0 && (
          <>
            <div className="comp" aria-hidden>{sum.byKind.map((k, i) => (<i key={k.label} style={{ width: (k.usd / sum.totalUsd) * 100 + '%', background: pal[i % pal.length] }} />))}</div>
            <Legend items={sum.byKind.map((k, i) => ({ label: k.label, color: pal[i % pal.length], value: formatUSD(k.usd) }))} />
          </>
        )}
      </div>

      <div className="card">
        <div className="kv" style={{ border: 0 }}>
          <span><b>Dólar hoje</b><br /><span className="hint">PTAX de venda, Banco Central{sum.rate ? ` · ${formatDateBR(sum.rate.date)}` : ''}</span></span>
          <b className="num" style={{ fontSize: 22 }}>{sum.rate ? `R$ ${sum.rate.rate.toLocaleString('pt-BR', { minimumFractionDigits: 4 })}` : '—'}</b>
        </div>
        <div className="hint">{ch1 !== null ? `${ch1 >= 0 ? '+' : ''}${ch1.toFixed(2).replace('.', ',')}% no último dia útil` : ''}{ch !== null ? ` · ${ch >= 0 ? '+' : ''}${ch.toFixed(2).replace('.', ',')}% em ${range === '365' ? '12 meses' : `${range} dias`}` : ''}</div>
        <Seg value={range} onChange={setRange} options={[['30', '30 dias'], ['90', '90 dias'], ['365', '12 meses']]} />
        {pts.length > 1 ? <ChartBox kind="line" small format="rate" labels={pts.map(([d]) => formatDayMonth(d))} series={[{ label: 'R$ por dólar', data: pts.map(([, v]) => v), fill: true, color: pal[2] }]} /> : <div className="empty">Histórico da cotação aparece depois da primeira atualização.</div>}
        <Converter rate={sum.rate?.rate ?? null} />
        <button className="btn ghost sm" disabled={busy} onClick={() => refresh(true)}><RefreshCw size={16} style={busy ? { animation: 'spin 1s linear infinite' } : undefined} /> Atualizar cotações</button>
      </div>

      <div className="section">Contas e investimentos em dólar</div>
      <div className="card" style={{ padding: '4px 14px' }}>
        {holdings.length === 0 && bankUsd.length === 0 && <div className="empty">Cadastre sua conta em dólar (ex.: Conta Global do Inter) e suas ações ou ETFs americanos.</div>}
        {holdings.map((h) => {
          const v = holdingUsd(h);
          const g = isAsset(h) && h.priceUsdCents !== undefined ? v - holdingCostUsd(h) : null;
          return (
            <button key={h.id} className="row" style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, color: 'inherit' }} onClick={() => setEdit(h)}>
              <div className="mid"><div className="t">{h.name}{h.ticker ? ` (${h.ticker})` : ''}</div><div className="s">{KIND_LABEL[h.kind]}{isAsset(h) && h.quantity ? ` · ${h.quantity.toLocaleString('pt-BR')} × ${h.priceUsdCents !== undefined ? formatUSD(h.priceUsdCents) : 'sem cotação'}` : ''}{h.changePct !== undefined ? ` · ${h.changePct >= 0 ? '+' : ''}${h.changePct.toFixed(2).replace('.', ',')}% hoje` : ''}</div></div>
              <div className="end num">{formatUSD(v)}{g !== null && <div className={'s ' + (g >= 0 ? 'pos' : 'neg')}>{g >= 0 ? '+' : ''}{formatUSD(g)}</div>}</div>
            </button>
          );
        })}
        {bankUsd.map((i) => (
          <div key={i.id} className="row"><div className="mid"><div className="t">{i.name}</div><div className="s">{i.bankName} · pela conexão bancária{i.counted ? '' : ' · fora do patrimônio'}</div></div><div className="end num">{formatUSD(i.balanceCents)}</div></div>
        ))}
      </div>
      <button className="btn" onClick={() => setEdit('novo')}><Plus size={18} /> Adicionar</button>
      <button className="btn ghost" onClick={() => setNews(true)}><Newspaper size={18} /> Notícias dos EUA e Wall Street</button>
      {news && <News initialTopic="eua" onClose={() => setNews(false)} />}
      <Note>A conta em dólar dos bancos (como a Conta Global do Inter) normalmente não vem pelo Open Finance: informe o saldo aqui e atualize quando quiser. Ações e ETFs dos EUA usam a cotação do Yahoo Finance (não oficial, com atraso); o dólar usa a PTAX do Banco Central, publicada no fim de cada dia útil. O total em reais entra no patrimônio da tela inicial como "Dólar".</Note>
      {edit && <HoldingSheet h={edit === 'novo' ? null : edit} onClose={() => setEdit(null)} />}
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
    </>
  );
}

function Converter({ rate }: { rate: number | null }) {
  const [v, setV] = useState('100');
  const [dir, setDir] = useState<'usd' | 'brl'>('usd');
  if (!rate) return null;
  const n = parseDecimal(v) ?? 0;
  const out = dir === 'usd' ? formatBRL(Math.round(n * rate * 100)) : formatUSD(Math.round((n / rate) * 100));
  return (
    <div className="two" style={{ alignItems: 'end', margin: '10px 0' }}>
      <Field label={dir === 'usd' ? 'Converter US$' : 'Converter R$'}><input inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} /></Field>
      <button className="btn ghost sm" onClick={() => setDir(dir === 'usd' ? 'brl' : 'usd')} aria-label="Inverter">= {out} ⇄</button>
    </div>
  );
}

function HoldingSheet({ h, onClose }: { h: UsdHolding | null; onClose: () => void }) {
  const [kind, setKind] = useState<UsdHolding['kind']>(h?.kind ?? 'conta');
  const [name, setName] = useState(h?.name ?? '');
  const [ticker, setTicker] = useState(h?.ticker ?? '');
  const [qty, setQty] = useState(h?.quantity !== undefined ? String(h.quantity).replace('.', ',') : '');
  const [cost, setCost] = useState(h?.avgCostUsdCents !== undefined ? (h.avgCostUsdCents / 100).toFixed(2).replace('.', ',') : '');
  const [bal, setBal] = useState(h?.balanceUsdCents !== undefined ? (h.balanceUsdCents / 100).toFixed(2).replace('.', ',') : '');
  const asset = kind === 'acao' || kind === 'etf' || kind === 'reit';
  const save = async () => {
    const now = new Date().toISOString();
    if (asset) {
      const t = ticker.trim().toUpperCase();
      const q = parseDecimal(qty);
      const c = parseDecimal(cost);
      if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(t)) return toast('Informe o código, ex.: AAPL, VOO', 'err');
      if (!q || q <= 0) return toast('Informe a quantidade', 'err');
      if (c === null || c < 0) return toast('Informe o preço médio pago (em dólar)', 'err');
      await upsert('usdHoldings', { ...(h ?? {}), id: h?.id ?? uid('us_'), kind, name: name.trim() || t, ticker: t, quantity: q, avgCostUsdCents: c * 100, balanceUsdCents: undefined, updatedAt: now });
      void refreshUsQuotes();
    } else {
      const b = parseDecimal(bal);
      if (!name.trim()) return toast('Dê um nome, ex.: Conta Global Inter', 'err');
      if (b === null) return toast('Informe o saldo em dólar', 'err');
      await upsert('usdHoldings', { id: h?.id ?? uid('us_'), kind, name: name.trim(), balanceUsdCents: Math.round(b * 100), updatedAt: now });
    }
    toast('Salvo');
    onClose();
  };
  return (
    <Sheet title={h ? 'Editar' : 'Adicionar em dólar'} onClose={onClose}>
      <Field label="Tipo">
        <select value={kind} onChange={(e) => setKind(e.target.value as UsdHolding['kind'])}>
          {(Object.keys(KIND_LABEL) as UsdHolding['kind'][]).map((k) => (<option key={k} value={k}>{KIND_LABEL[k]}</option>))}
        </select>
      </Field>
      {asset ? (
        <>
          <div className="two">
            <Field label="Código (EUA)"><input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="VOO" autoCapitalize="characters" /></Field>
            <Field label="Nome (opcional)"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Vanguard S&P 500" /></Field>
          </div>
          <div className="two">
            <Field label="Quantidade"><input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="1,5" /></Field>
            <Field label="Preço médio (US$)"><input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="450,00" /></Field>
          </div>
        </>
      ) : (
        <div className="two">
          <Field label="Nome"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Conta Global Inter" /></Field>
          <Field label="Saldo (US$)"><input inputMode="decimal" value={bal} onChange={(e) => setBal(e.target.value)} placeholder="250,00" /></Field>
        </div>
      )}
      <div className="btnrow">
        <button className="btn" onClick={save}>Salvar</button>
        {h && <button className="btn danger" onClick={async () => { if (typeof window.confirm !== 'function' || window.confirm('Apagar este item?')) { await remove('usdHoldings', h.id); onClose(); } }}><Trash2 size={16} /> Apagar</button>}
      </div>
    </Sheet>
  );
}
