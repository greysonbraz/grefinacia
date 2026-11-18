import { useMemo, useState } from 'react';
import { Plus, Search, Repeat, CreditCard, FileUp, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, ChevronRight, SlidersHorizontal, X, ScanText } from 'lucide-react';
import { ImportStatement } from './Import';
import { CardBills } from './CardBills';
import { Agenda } from './Agenda';
import { TransferForm } from './Settings';
import { defaultAccountId, deleteRecurrence, deleteTransaction, markPaid, payInvoice, remove, rollDay, saveTransaction, toast, upsert, useStore } from '../state/store';
import type { PaymentMethod, Transaction, Transfer, TxKind, TxType } from '../lib/types';
import { KIND_DEFAULT_CATEGORY, KIND_LABEL, PAYMENT_LABEL } from '../lib/categories';
import { formatBoletoLine, parseBoleto } from '../domain/boleto';
import { centsToInput, formatBRL, parseMoney } from '../lib/money';
import { formatDateBR, formatDayMonth, lastMonths, monthOf, monthShort, weekdayShort } from '../lib/dates';
import { buildInstallments, costMonth, effectiveDue, monthSummary, openInvoices } from '../domain/ledger';
import { uid } from '../lib/ids';
import { suggestCategory } from '../domain/importer';
import { scanReceipt } from '../services/native';
import { isNative } from '../services/platform';
import { ChartBox, cssVar, Empty, Field, Ico, Legend, MoneyInput, MonthNav, Seg, seriesColors, Sheet, SwitchRow } from './kit';

type Filter = 'todas' | 'receitas' | 'despesas' | 'transferencias' | 'pendentes';
const INCOME_KINDS: TxKind[] = ['salario', 'hora_extra', 'adicional', 'outro_rendimento'];
const EXPENSE_KINDS: TxKind[] = ['variavel', 'fixa', 'cartao', 'parcelada', 'assinatura'];
interface Extra { categoryId: string; accountId: string; cardId: string; origin: '' | 'manual' | 'import' }
const NO_EXTRA: Extra = { categoryId: '', accountId: '', cardId: '', origin: '' };
type Item = { kind: 'tx'; t: Transaction } | { kind: 'tr'; t: Transfer };

export function Transactions({ initial }: { initial?: string } = {}) {
  const data = useStore((s) => s.data);
  const today = useStore((s) => s.today);
  const [ym, setYm] = useState(monthOf(today));
  const [filter, setFilter] = useState<Filter>('todas');
  const [extra, setExtra] = useState<Extra>(NO_EXTRA);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [q, setQ] = useState('');
  const [view, setView] = useState<'lista' | 'calendario' | 'graficos' | 'recorrentes'>(initial === 'calendario' ? 'calendario' : 'lista');
  const [edit, setEdit] = useState<Transaction | 'new' | null>(initial === 'nova' || initial === 'nova-receita' ? 'new' : null);
  const [transferOpen, setTransferOpen] = useState(initial === 'transferir');
  const [move, setMove] = useState<Transfer | null>(null);
  const [importing, setImporting] = useState(initial === 'importar');
  const [bills, setBills] = useState(initial === 'faturas');
  const mode = useStore((s) => s.settings.cardMonth);
  const sum = useMemo(() => monthSummary(data, ym), [data, ym, mode]);
  // modo "mês da fatura": o total do mês inclui a fatura que vence nele e deixa de fora as compras que vão para a próxima
  const cardIn = useMemo(() => (mode === 'fatura' ? data.transactions.filter((t) => t.type === 'expense' && t.cardId && costMonth(t) === ym && monthOf(t.date) !== ym).reduce((s, t) => s + t.amountCents, 0) : 0), [data, ym, mode]);
  const cardOut = useMemo(() => (mode === 'fatura' ? data.transactions.filter((t) => t.type === 'expense' && t.cardId && monthOf(t.date) === ym && costMonth(t) !== ym).reduce((s, t) => s + t.amountCents, 0) : 0), [data, ym, mode]);
  const cat = (id: string) => data.categories.find((c) => c.id === id);
  const accName = (id: string) => (!id ? 'fora do app' : data.accounts.find((a) => a.id === id)?.name ?? 'conta removida');
  const extraCount = Object.values(extra).filter(Boolean).length;
  const items = useMemo<Item[]>(() => {
    const needle = q.trim().toLowerCase();
    const inScope = (date: string, text: string) => (needle ? text.toLowerCase().includes(needle) : monthOf(date) === ym);
    const txOk = (t: Transaction) =>
      (filter === 'todas' || (filter === 'receitas' && t.type === 'income') || (filter === 'despesas' && t.type === 'expense') || (filter === 'pendentes' && t.status === 'pending')) &&
      (!extra.categoryId || t.categoryId === extra.categoryId) && (!extra.accountId || t.accountId === extra.accountId) && (!extra.cardId || t.cardId === extra.cardId) &&
      (!extra.origin || (extra.origin === 'import' ? t.source === 'import' : t.source !== 'import'));
    const trOk = (t: Transfer) => (filter === 'todas' || filter === 'transferencias') && !extra.categoryId && !extra.cardId && (!extra.accountId || t.fromAccountId === extra.accountId || t.toAccountId === extra.accountId) && (!extra.origin || (extra.origin === 'import' ? !!t.importId : !t.importId));
    const tx: Item[] = filter === 'transferencias' ? [] : data.transactions.filter((t) => inScope(t.date, t.description) && txOk(t)).map((t) => ({ kind: 'tx', t }));
    const tr: Item[] = (data.transfers ?? []).filter((t) => inScope(t.date, t.note ?? '') && trOk(t)).map((t) => ({ kind: 'tr', t }));
    return [...tx, ...tr].sort((a, b) => b.t.date.localeCompare(a.t.date) || b.t.createdAt - a.t.createdAt);
  }, [data.transactions, data.transfers, ym, filter, q, extra]);
  const invoices = useMemo(() => openInvoices(data), [data]);
  const groups = useMemo(() => { const m = new Map<string, Item[]>(); for (const it of items) m.set(it.t.date, [...(m.get(it.t.date) ?? []), it]); return [...m.entries()]; }, [items]);
  const dayNet = (list: Item[]) => list.reduce((s, it) => (it.kind === 'tx' ? s + (it.t.type === 'income' ? it.t.amountCents : -it.t.amountCents) : s), 0);

  return (
    <div className="screen">
      <div className="head"><h1>Movimentações</h1><button className="iconbtn" onClick={() => setImporting(true)} aria-label="Importar extrato"><FileUp size={18} /></button></div>
      {importing && <ImportStatement onClose={() => setImporting(false)} />}
      <MonthNav ym={ym} onChange={setYm} />
      <div className="group flow">
        <div className="flow-row"><span className="flow-ic in" aria-hidden><ArrowDownLeft size={16} /></span><span className="flow-l">Receitas</span><span className="num">{formatBRL(sum.incomeCents)}</span></div>
        <div className="flow-row"><span className="flow-ic out" aria-hidden><ArrowUpRight size={16} /></span><span className="flow-l">Despesas</span><span className="num">{formatBRL(sum.expenseCents)}</span>{sum.expensePendingCents > 0 && <span className="delta flat">{formatBRL(sum.expensePendingCents)} ainda a pagar</span>}</div>
        <div className="flow-row total"><span className="flow-ic" aria-hidden /><span className="flow-l">Resultado</span><span className={'num ' + (sum.netCents < 0 ? 'neg' : 'pos')}>{formatBRL(sum.netCents)}</span></div>
      </div>
      {(cardIn > 0 || cardOut > 0) && (
        <div className="hint" style={{ margin: '-4px 4px 10px' }}>
          {cardIn > 0 ? `Despesas incluem ${formatBRL(cardIn)} da fatura do cartão que vence neste mês (compras do mês anterior). ` : ''}
          {cardOut > 0 ? `${formatBRL(cardOut)} lançados no cartão com data neste mês contam no mês da fatura.` : ''}
        </div>
      )}
      <Seg value={view} onChange={setView} options={[['lista', 'Lançamentos'], ['calendario', 'Calendário'], ['graficos', 'Gráficos'], ['recorrentes', 'Recorrentes']]} />

      {view === 'lista' && (
        <>
          {(invoices.length > 0 || data.cards.length > 0) && (
            <div className="group">
              {invoices.map((inv) => {
                const card = data.cards.find((c) => c.id === inv.cardId);
                const late = inv.dueDate < today;
                return (
                  <div className="row" key={inv.cardId + inv.dueDate}>
                    <div className="ic"><CreditCard size={18} /></div>
                    <div className="mid"><div className="t">Fatura {card?.name ?? ''}</div><div className={'s ' + (late ? 'neg' : '')}>{late ? 'Venceu' : 'Vence'} em {formatDateBR(inv.dueDate)} · <span className="num">{formatBRL(inv.totalCents)}</span></div></div>
                    <button className="btn sm" onClick={async () => { const acc = card?.accountId ?? defaultAccountId(); if (!acc) return toast('Cadastre uma conta em Ajustes', 'err'); await payInvoice(inv.txIds, acc); toast('Fatura paga'); }}>Pagar</button>
                  </div>
                );
              })}
              {data.cards.length > 0 && <button className="row link" onClick={() => setBills(true)}><div className="ic"><CreditCard size={18} /></div><div className="mid"><div className="t">Faturas do cartão</div><div className="s">mês a mês, como no banco</div></div><ChevronRight size={18} /></button>}
            </div>
          )}
          {bills && <CardBills onClose={() => setBills(false)} />}
          <div className="searchbar">
            <label className="field" style={{ position: 'relative', margin: 0, flex: 1 }}>
              <Search size={16} style={{ position: 'absolute', left: 14, top: 16, color: 'var(--muted)' }} aria-hidden />
              <input style={{ paddingLeft: 38 }} placeholder="Buscar em todos os meses" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar movimentação" />
            </label>
            <button className="iconbtn filterbtn" onClick={() => setFiltersOpen(true)} aria-label={extraCount ? `Filtros (${extraCount} ativos)` : 'Filtros'}><SlidersHorizontal size={18} />{extraCount > 0 && <span className="count">{extraCount}</span>}</button>
          </div>
          <Seg value={filter} onChange={setFilter} options={[['todas', 'Todas'], ['receitas', 'Receitas'], ['despesas', 'Despesas'], ['transferencias', 'Transferências'], ['pendentes', 'Pendentes']]} />
          {extraCount > 0 && (
            <div className="chips" style={{ marginBottom: 10 }}>
              {extra.categoryId && <button onClick={() => setExtra({ ...extra, categoryId: '' })}>{cat(extra.categoryId)?.name} <X size={14} /></button>}
              {extra.accountId && <button onClick={() => setExtra({ ...extra, accountId: '' })}>{accName(extra.accountId)} <X size={14} /></button>}
              {extra.cardId && <button onClick={() => setExtra({ ...extra, cardId: '' })}>{data.cards.find((c) => c.id === extra.cardId)?.name} <X size={14} /></button>}
              {extra.origin && <button onClick={() => setExtra({ ...extra, origin: '' })}>{extra.origin === 'import' ? 'Importados' : 'Lançados à mão'} <X size={14} /></button>}
              <button onClick={() => setExtra(NO_EXTRA)}>Limpar filtros</button>
            </div>
          )}
          {items.length === 0 ? (
            extraCount || filter !== 'todas' || q
              ? <Empty title="Nada com esses filtros" text="Troque o mês ou limpe os filtros para ver mais." action="Limpar filtros" onAction={() => { setExtra(NO_EXTRA); setFilter('todas'); setQ(''); }} />
              : <Empty title="Nada por aqui" text="Lance uma receita ou despesa para começar." action="Nova movimentação" onAction={() => setEdit('new')} />
          ) : groups.map(([date, list]) => {
            const net = dayNet(list);
            return (
              <div key={date}>
                <div className="dayhead"><span>{weekdayShort(date)}, {formatDateBR(date)}</span>{net !== 0 && <span className={'num ' + (net > 0 ? 'pos' : '')}>{net > 0 ? '+' : '−'}{formatBRL(Math.abs(net))}</span>}</div>
                <div className="group">
                  {list.map((it) => {
                    if (it.kind === 'tr') {
                      const t = it.t;
                      return (
                        <button className="row" key={t.id} onClick={() => setMove(t)}>
                          <div className="ic"><ArrowLeftRight size={18} /></div>
                          <div className="mid"><div className="t">{t.note || 'Transferência'}</div><div className="s">{TR_LABEL[t.kind ?? ''] ?? 'Transferência'} · {accName(t.fromAccountId)} → {accName(t.toAccountId)}</div></div>
                          <div className="end"><div className="num mut">{formatBRL(t.amountCents)}</div></div>
                        </button>
                      );
                    }
                    const t = it.t;
                    const late = t.type === 'expense' && t.status === 'pending' && effectiveDue(t) < today;
                    return (
                      <button className="row" key={t.id} onClick={() => setEdit(t)}>
                        <div className="ic"><Ico name={cat(t.categoryId)?.icon ?? 'Circle'} size={18} /></div>
                        <div className="mid"><div className="t">{t.description}</div><div className="s">{cat(t.categoryId)?.name ?? '—'} · {PAYMENT_LABEL[t.paymentMethod]}{mode === 'fatura' && t.cardId && t.dueDate && monthOf(t.dueDate) !== monthOf(t.date) ? ` · fatura ${monthShort(monthOf(t.dueDate))}` : ''}</div></div>
                        <div className="end">
                          <div className={'num ' + (t.type === 'income' ? 'pos' : '')}>{t.type === 'income' ? '+' : '−'}{formatBRL(t.amountCents)}</div>
                          {t.status === 'pending' && <span className={'badge ' + (late ? 'bad' : 'warn')}>{late ? 'atrasada' : t.type === 'income' ? 'a receber' : `vence ${formatDayMonth(effectiveDue(t))}`}</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </>
      )}
      {filtersOpen && <FiltersSheet value={extra} onChange={setExtra} onClose={() => setFiltersOpen(false)} />}
      {move && <MoveSheet t={move} onClose={() => setMove(null)} />}
      {transferOpen && <TransferForm onClose={() => setTransferOpen(false)} />}
      {view === 'calendario' && <Agenda ym={ym} />}
      {view === 'graficos' && <TxCharts ym={ym} />}
      {view === 'recorrentes' && (
        <div className="card">
          <h2>Lançamentos que se repetem todo mês</h2>
          {data.recurrences.length === 0 ? <Empty title="Nenhum recorrente" text='Ao lançar uma despesa fixa ou assinatura, ative "Repetir todo mês".' /> : data.recurrences.map((r) => (
            <div className="row" key={r.id}>
              <div className="ic"><Repeat size={18} /></div>
              <div className="mid"><div className="t">{r.description}</div><div className="s">Todo dia {r.dayOfMonth} · {KIND_LABEL[r.kind]}</div></div>
              <div className="end"><div className="num">{formatBRL(r.amountCents)}</div>{r.source !== 'salary' && <button className="link" onClick={async () => { await deleteRecurrence(r.id); toast('Recorrência encerrada'); }}>Encerrar</button>}</div>
            </div>
          ))}
        </div>
      )}
      <button className="fab" onClick={() => setEdit('new')} aria-label="Nova movimentação"><Plus size={26} /></button>
      {edit && <TxForm tx={edit === 'new' ? null : edit} startType={initial === 'nova-receita' && edit === 'new' ? 'income' : 'expense'} onClose={() => setEdit(null)} />}
    </div>
  );
}

function TxCharts({ ym }: { ym: string }) {
  const data = useStore((s) => s.data);
  const [mode, setMode] = useState<'mensal' | 'anual'>('mensal');
  const pal = seriesColors();
  const name = (id: string) => data.categories.find((c) => c.id === id)?.name ?? id;
  const months = mode === 'mensal' ? [ym] : lastMonths(ym, 12);
  const sums = months.map((m) => monthSummary(data, m));
  const totals: Record<string, number> = {};
  for (const s of sums) for (const [k, v] of Object.entries(s.byCategory)) totals[k] = (totals[k] ?? 0) + v;
  const ents = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const total = ents.reduce((s, e) => s + e[1], 0);
  const top = ents.slice(0, 7);
  const rest = ents.slice(7).reduce((s, e) => s + e[1], 0);
  const items = [...top.map(([id, v], i) => ({ label: name(id), v, color: pal[i] })), ...(rest > 0 ? [{ label: 'Outras', v: rest, color: cssVar('--sother') }] : [])];
  return (
    <>
      <Seg value={mode} onChange={setMode} options={[['mensal', 'Este mês'], ['anual', 'Últimos 12 meses']]} />
      <div className="card">
        <h2>Onde você gasta mais</h2>
        {items.length === 0 ? <Empty title="Sem despesas" text="Não há despesas no período." /> : (
          <>
            <ChartBox kind="doughnut" labels={items.map((i) => i.label)} series={[{ label: 'Gastos', data: items.map((i) => i.v) }]} colors={items.map((i) => i.color)} />
            <table className="tbl" style={{ marginTop: 12 }}>
              <tbody>{items.map((i) => (<tr key={i.label}><td><i className="dot" style={{ background: i.color }} />{i.label}</td><td className="mut">{((i.v / total) * 100).toFixed(1).replace('.', ',')}%</td><td className="num">{formatBRL(i.v)}</td></tr>))}</tbody>
            </table>
          </>
        )}
      </div>
      {mode === 'anual' && (
        <div className="card">
          <h2>Receitas e despesas por mês</h2>
          <ChartBox kind="bar" labels={months.map(monthShort)} series={[{ label: 'Receitas', data: sums.map((s) => s.incomeCents), color: pal[2] }, { label: 'Despesas', data: sums.map((s) => s.expenseCents), color: pal[1] }]} />
          <Legend items={[{ label: 'Receitas', color: pal[2] }, { label: 'Despesas', color: pal[1] }]} />
        </div>
      )}
    </>
  );
}

function TxForm({ tx, onClose, startType = 'expense' }: { tx: Transaction | null; onClose: () => void; startType?: TxType }) {
  const data = useStore((s) => s.data);
  const today = useStore((s) => s.today);
  const [type, setType] = useState<TxType>(tx?.type ?? startType);
  const [kind, setKind] = useState<TxKind>(tx?.kind ?? (startType === 'income' ? 'outro_rendimento' : 'variavel'));
  const [desc, setDesc] = useState(tx?.description ?? '');
  const [amount, setAmount] = useState(tx ? centsToInput(tx.amountCents) : '');
  const [categoryId, setCategoryId] = useState(tx?.categoryId ?? (startType === 'income' ? KIND_DEFAULT_CATEGORY.outro_rendimento : 'mercado'));
  const [date, setDate] = useState(tx?.date ?? today);
  const [method, setMethod] = useState<PaymentMethod>(tx?.paymentMethod ?? 'pix');
  const [boleto, setBoleto] = useState(tx?.boletoLine ? formatBoletoLine(tx.boletoLine) : '');
  const [boletoMsg, setBoletoMsg] = useState<string | null>(null);
  const [accountId, setAccountId] = useState(tx?.accountId ?? defaultAccountId() ?? '');
  const [cardId, setCardId] = useState(tx?.cardId ?? data.cards[0]?.id ?? '');
  const [paid, setPaid] = useState(tx ? tx.status === 'paid' : true);
  const [repeat, setRepeat] = useState(false);
  const [parcels, setParcels] = useState('2');
  const [err, setErr] = useState<string | null>(null);
  const rules = useStore((s) => s.settings.importRules);
  // categoria escolhida por você não é trocada pela sugestão
  const [catTouched, setCatTouched] = useState(!!tx);
  const changeDesc = (v: string) => {
    setDesc(v);
    if (catTouched || v.trim().length < 3) return;
    const sug = suggestCategory(v, type, data, rules ?? []);
    if (sug.source !== 'padrao') setCategoryId(sug.categoryId);
  };
  const batch = tx?.importId ? data.imports.find((b) => b.id === tx.importId) : undefined;
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  /** Lê o cupom pela câmera e preenche o formulário (você confere antes de salvar). */
  const scan = async () => {
    setScanning(true);
    setErr(null);
    try {
      const r = await scanReceipt(today);
      if (!r) return;
      if (r.totalCents) setAmount(centsToInput(r.totalCents));
      if (r.date) setDate(r.date);
      if (r.merchant) {
        setDesc(r.merchant);
        const sug = suggestCategory(r.merchant, 'expense', data, rules ?? []);
        if (!catTouched && sug.source !== 'padrao') setCategoryId(sug.categoryId);
      }
      const got = [r.merchant && 'loja', r.totalCents && 'valor', r.date && 'data'].filter(Boolean);
      setScanNote(got.length ? `Li ${got.join(', ')} do cupom. Confira antes de salvar.` : 'Não consegui ler o cupom. Tente outra foto, com o cupom reto e bem iluminado.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Não foi possível ler o cupom.');
    } finally {
      setScanning(false);
    }
  };
  const kinds = type === 'income' ? INCOME_KINDS : EXPENSE_KINDS;
  const cats = data.categories.filter((c) => c.type === type);
  const credit = type === 'expense' && method === 'credito';
  const changeType = (t: TxType) => { setType(t); const k = t === 'income' ? 'outro_rendimento' : 'variavel'; setKind(k); setCategoryId(KIND_DEFAULT_CATEGORY[k]); if (t === 'income') setMethod('pix'); };
  const changeKind = (k: TxKind) => { setKind(k); if (!tx) setCategoryId(KIND_DEFAULT_CATEGORY[k]); if (k === 'cartao') setMethod('credito'); if (k === 'fixa' || k === 'assinatura') setRepeat(true); };

  /** Lê a linha digitável e preenche valor e vencimento. Nada é consultado fora do aparelho. */
  const readBoleto = (raw: string) => {
    setBoleto(raw);
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 47) return setBoletoMsg(digits.length ? `${digits.length} de 47 números` : null);
    const r = parseBoleto(raw, today);
    if (!r.ok) return setBoletoMsg(r.error);
    if (r.boleto.amountCents) setAmount(centsToInput(r.boleto.amountCents));
    if (r.boleto.dueDate) setDate(r.boleto.dueDate);
    setMethod('boleto');
    setPaid(false);
    setBoletoMsg(`Boleto lido${r.boleto.amountCents ? ': ' + formatBRL(r.boleto.amountCents) : ' (sem valor na linha)'}${r.boleto.dueDate ? ', vence em ' + formatDateBR(r.boleto.dueDate) : ''}. Confira com o boleto antes de pagar.`);
  };
  const boletoLine = () => { const r = parseBoleto(boleto, today); return r.ok ? r.boleto.line : undefined; };

  const save = async () => {
    const cents = parseMoney(amount);
    if (!desc.trim()) return setErr('Informe uma descrição.');
    if (!cents || cents <= 0) return setErr('Informe um valor maior que zero.');
    if (credit && !cardId) return setErr('Cadastre um cartão em Ajustes → Contas e cartões.');
    const card = credit ? data.cards.find((c) => c.id === cardId) : undefined;
    const base = { type, kind, description: desc.trim(), amountCents: cents, categoryId, paymentMethod: method, accountId: credit ? undefined : accountId || undefined, cardId: credit ? cardId : undefined, boletoLine: type === 'expense' && !credit ? boletoLine() : undefined };
    if (tx) {
      await saveTransaction({ ...tx, ...base, date, status: credit ? tx.status : paid ? 'paid' : 'pending', paidDate: paid ? tx.paidDate ?? date : undefined, dueDate: type === 'expense' && !credit ? (paid ? tx.dueDate : date) : tx.dueDate });
    } else if (kind === 'parcelada') {
      const n = Math.max(Math.round(Number(parcels) || 0), 2);
      await upsert('transactions', buildInstallments(base, cents, n, date, card));
    } else {
      const status = credit ? 'pending' : paid ? 'paid' : 'pending';
      let recurrenceId: string | undefined;
      if (repeat) {
        recurrenceId = uid('r_');
        await upsert('recurrences', { id: recurrenceId, ...base, dayOfMonth: Number(date.slice(8, 10)), startMonth: monthOf(date), active: true });
      }
      await saveTransaction({ id: uid('t_'), ...base, date, dueDate: type === 'expense' ? date : undefined, status, paidDate: status === 'paid' ? date : undefined, recurrenceId, recurrenceMonth: repeat ? monthOf(date) : undefined, createdAt: Date.now() });
      if (repeat) await rollDay();
    }
    toast(tx ? 'Movimentação atualizada' : 'Movimentação salva');
    onClose();
  };

  return (
    <Sheet title={tx ? 'Editar movimentação' : 'Nova movimentação'} onClose={onClose}>
      {!tx && <Seg value={type} onChange={changeType} options={[['expense', 'Despesa'], ['income', 'Receita']]} />}
      {!tx && type === 'expense' && isNative() && <button className="btn ghost" style={{ marginBottom: 12 }} disabled={scanning} onClick={scan}><ScanText size={18} /> {scanning ? 'Lendo o cupom…' : 'Escanear cupom ou nota'}</button>}
      {scanNote && <div className="note" style={{ marginTop: -4, marginBottom: 10 }}>{scanNote}</div>}
      {batch && <div className="note" style={{ marginTop: 0, marginBottom: 10 }}>Veio de: {batch.fileName}{tx?.cardId && tx.dueDate ? ` · fatura que vence em ${formatDateBR(tx.dueDate)}` : ''}</div>}
      <Field label={kind === 'parcelada' && !tx ? 'Valor de cada parcela (R$)' : 'Valor (R$)'}><span className="bigamount"><MoneyInput name="valor" value={amount} onChange={setAmount} autoFocus={!tx} /></span></Field>
      <Field label="Descrição" hint={!catTouched && !tx ? 'A categoria é sugerida pela descrição; troque se quiser.' : undefined}><input name="descricao" value={desc} onChange={(e) => changeDesc(e.target.value)} placeholder={type === 'income' ? 'Ex.: Salário de novembro' : 'Ex.: Mercado da semana'} /></Field>
      <div className="two">
        <Field label="Tipo"><select value={kind} onChange={(e) => changeKind(e.target.value as TxKind)} disabled={!!tx?.installment}>{kinds.map((k) => (<option key={k} value={k}>{KIND_LABEL[k]}</option>))}</select></Field>
        <Field label={kind === 'parcelada' && !tx ? '1ª parcela em' : 'Data'}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      {type === 'expense' && !credit && kind !== 'parcelada' && (
        <Field label="Linha digitável do boleto (opcional)" hint={boletoMsg ?? 'Cole os números do boleto: o app preenche valor e vencimento.'}><input name="boleto" inputMode="numeric" value={boleto} onChange={(e) => readBoleto(e.target.value)} placeholder="47 ou 48 números" /></Field>
      )}
      {kind === 'parcelada' && !tx && <Field label="Número de parcelas"><input inputMode="numeric" value={parcels} onChange={(e) => setParcels(e.target.value.replace(/\D/g, ''))} /></Field>}
      <Field label="Categoria"><select value={categoryId} onChange={(e) => { setCatTouched(true); setCategoryId(e.target.value); }}>{cats.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}</select></Field>
      <div className="two">
        <Field label="Forma de pagamento"><select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>{Object.entries(PAYMENT_LABEL).filter(([k]) => type === 'expense' || k !== 'credito').map(([k, l]) => (<option key={k} value={k}>{l}</option>))}</select></Field>
        {credit ? (
          <Field label="Cartão"><select value={cardId} onChange={(e) => setCardId(e.target.value)}>{data.cards.length === 0 && <option value="">Nenhum cartão</option>}{data.cards.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}</select></Field>
        ) : (
          <Field label="Conta"><select value={accountId} onChange={(e) => setAccountId(e.target.value)}>{data.accounts.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}</select></Field>
        )}
      </div>
      {!credit && kind !== 'parcelada' && <SwitchRow title={type === 'income' ? 'Já recebi' : 'Já paguei'} sub="Desligado, fica como pendente e não altera o saldo" on={paid} onChange={setPaid} />}
      {credit && <div className="note">Compras no crédito entram na fatura e só saem do saldo quando ela é paga.</div>}
      {!tx && kind !== 'parcelada' && <SwitchRow title="Repetir todo mês" sub="Cria o lançamento automaticamente nos próximos meses" on={repeat} onChange={setRepeat} />}
      {err && <div className="neg" role="alert" style={{ margin: '8px 0' }}>{err}</div>}
      <div className="btnrow"><button className="btn" onClick={save}>Salvar</button></div>
      {tx && (
        <div className="btnrow">
          {tx.status === 'pending' && !credit && <button className="btn ghost" onClick={async () => { await markPaid(tx); toast(tx.type === 'income' ? 'Marcado como recebido' : 'Marcado como pago'); onClose(); }}>{tx.type === 'income' ? 'Recebi' : 'Paguei'}</button>}
          <button className="btn danger" onClick={async () => { await deleteTransaction(tx); toast('Movimentação excluída'); onClose(); }}>Excluir</button>
          {tx.installment && tx.installment.number < tx.installment.total && <button className="btn danger" onClick={async () => { await deleteTransaction(tx, 'group'); toast('Parcelas excluídas'); onClose(); }}>Excluir esta e as próximas</button>}
        </div>
      )}
    </Sheet>
  );
}

const TR_LABEL: Record<string, string> = { '': 'Transferência', propria: 'Entre contas suas', investimento: 'Investimento', cambio: 'Câmbio (dólar)' };

/** Filtros além do tipo: categoria, conta, cartão e origem do lançamento. */
function FiltersSheet({ value, onChange, onClose }: { value: Extra; onChange: (v: Extra) => void; onClose: () => void }) {
  const data = useStore((s) => s.data);
  const [v, setV] = useState(value);
  return (
    <Sheet title="Filtros" onClose={onClose}>
      <Field label="Categoria"><select value={v.categoryId} onChange={(e) => setV({ ...v, categoryId: e.target.value })}><option value="">Todas</option>{data.categories.map((c) => (<option key={c.id} value={c.id}>{c.name}{c.type === 'income' ? ' (receita)' : ''}</option>))}</select></Field>
      <Field label="Conta"><select value={v.accountId} onChange={(e) => setV({ ...v, accountId: e.target.value })}><option value="">Todas</option>{data.accounts.filter((a) => !a.archived).map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}</select></Field>
      {data.cards.length > 0 && <Field label="Cartão"><select value={v.cardId} onChange={(e) => setV({ ...v, cardId: e.target.value })}><option value="">Todos</option>{data.cards.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}</select></Field>}
      <Field label="Origem"><select value={v.origin} onChange={(e) => setV({ ...v, origin: e.target.value as Extra['origin'] })}><option value="">Todas</option><option value="import">Importados (extrato ou banco)</option><option value="manual">Lançados à mão</option></select></Field>
      <div className="btnrow">
        <button className="btn ghost" onClick={() => { onChange(NO_EXTRA); onClose(); }}>Limpar</button>
        <button className="btn" onClick={() => { onChange(v); onClose(); }}>Aplicar</button>
      </div>
    </Sheet>
  );
}

/** Detalhe de uma transferência (entre contas, investimento ou câmbio), com opção de desfazer. */
function MoveSheet({ t, onClose }: { t: Transfer; onClose: () => void }) {
  const data = useStore((s) => s.data);
  const accName = (id: string) => (!id ? 'fora do app' : data.accounts.find((a) => a.id === id)?.name ?? 'conta removida');
  const batch = t.importId ? data.imports.find((b) => b.id === t.importId) : undefined;
  return (
    <Sheet title={TR_LABEL[t.kind ?? ''] ?? 'Transferência'} onClose={onClose}>
      <div className="kv"><span>Valor</span><b className="num">{formatBRL(t.amountCents)}</b></div>
      <div className="kv"><span>Data</span><b>{formatDateBR(t.date)}</b></div>
      <div className="kv"><span>De</span><b>{accName(t.fromAccountId)}</b></div>
      <div className="kv"><span>Para</span><b>{accName(t.toAccountId)}</b></div>
      {t.note && <div className="kv"><span>Descrição</span><b>{t.note}</b></div>}
      {batch && <div className="kv"><span>Origem</span><b>{batch.fileName}</b></div>}
      <div className="note">Não conta como receita nem despesa: o dinheiro só mudou de lugar.</div>
      <div className="btnrow"><button className="btn danger" onClick={async () => { if (typeof window.confirm === 'function' && !window.confirm('Desfazer esta transferência? O saldo da conta volta ao que era.')) return; await remove('transfers', t.id); toast('Transferência desfeita'); onClose(); }}>Desfazer</button></div>
    </Sheet>
  );
}
