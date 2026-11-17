import { useMemo, useState } from 'react';
import { Plus, Search, Repeat, CreditCard, FileUp } from 'lucide-react';
import { ImportStatement } from './Import';
import { defaultAccountId, deleteRecurrence, deleteTransaction, markPaid, payInvoice, rollDay, saveTransaction, toast, upsert, useStore } from '../state/store';
import type { PaymentMethod, Transaction, TxKind, TxType } from '../lib/types';
import { KIND_DEFAULT_CATEGORY, KIND_LABEL, PAYMENT_LABEL } from '../lib/categories';
import { formatBoletoLine, parseBoleto } from '../domain/boleto';
import { centsToInput, formatBRL, parseMoney } from '../lib/money';
import { formatDateBR, formatDayMonth, lastMonths, monthOf, monthShort, weekdayShort } from '../lib/dates';
import { buildInstallments, costMonth, effectiveDue, monthSummary, openInvoices } from '../domain/ledger';
import { uid } from '../lib/ids';
import { ChartBox, cssVar, Empty, Field, Ico, Legend, MoneyInput, MonthNav, Seg, seriesColors, Sheet, SwitchRow } from './kit';

type Filter = 'todas' | 'receitas' | 'despesas' | 'pendentes';
const INCOME_KINDS: TxKind[] = ['salario', 'hora_extra', 'adicional', 'outro_rendimento'];
const EXPENSE_KINDS: TxKind[] = ['variavel', 'fixa', 'cartao', 'parcelada', 'assinatura'];

export function Transactions() {
  const data = useStore((s) => s.data);
  const today = useStore((s) => s.today);
  const [ym, setYm] = useState(monthOf(today));
  const [filter, setFilter] = useState<Filter>('todas');
  const [q, setQ] = useState('');
  const [view, setView] = useState<'lista' | 'graficos' | 'recorrentes'>('lista');
  const [edit, setEdit] = useState<Transaction | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const mode = useStore((s) => s.settings.cardMonth);
  const sum = useMemo(() => monthSummary(data, ym), [data, ym, mode]);
  // modo "mês da fatura": o total do mês inclui a fatura que vence nele e deixa de fora as compras que vão para a próxima
  const cardIn = useMemo(() => (mode === 'fatura' ? data.transactions.filter((t) => t.type === 'expense' && t.cardId && costMonth(t) === ym && monthOf(t.date) !== ym).reduce((s, t) => s + t.amountCents, 0) : 0), [data, ym, mode]);
  const cardOut = useMemo(() => (mode === 'fatura' ? data.transactions.filter((t) => t.type === 'expense' && t.cardId && monthOf(t.date) === ym && costMonth(t) !== ym).reduce((s, t) => s + t.amountCents, 0) : 0), [data, ym, mode]);
  const cat = (id: string) => data.categories.find((c) => c.id === id);
  const list = useMemo(() => data.transactions
    .filter((t) => (q ? t.description.toLowerCase().includes(q.toLowerCase()) : monthOf(t.date) === ym))
    .filter((t) => filter === 'todas' || (filter === 'receitas' && t.type === 'income') || (filter === 'despesas' && t.type === 'expense') || (filter === 'pendentes' && t.status === 'pending'))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt), [data.transactions, ym, filter, q]);
  const invoices = useMemo(() => openInvoices(data), [data]);
  const groups = useMemo(() => { const m = new Map<string, Transaction[]>(); for (const t of list) m.set(t.date, [...(m.get(t.date) ?? []), t]); return [...m.entries()]; }, [list]);

  return (
    <div className="screen">
      <div className="head"><h1>Movimentações</h1><button className="iconbtn" onClick={() => setImporting(true)} aria-label="Importar extrato"><FileUp size={18} /></button></div>
      {importing && <ImportStatement onClose={() => setImporting(false)} />}
      <MonthNav ym={ym} onChange={setYm} />
      <div className="grid2">
        <div className="tile"><div className="lbl">Receitas</div><div className="val num">{formatBRL(sum.incomeCents)}</div></div>
        <div className="tile"><div className="lbl">Despesas</div><div className="val num">{formatBRL(sum.expenseCents)}</div>{sum.expensePendingCents > 0 && <div className="foot">{formatBRL(sum.expensePendingCents)} a pagar</div>}</div>
      </div>
      {(cardIn > 0 || cardOut > 0) && (
        <div className="hint" style={{ margin: '-4px 4px 10px' }}>
          {cardIn > 0 ? `Despesas incluem ${formatBRL(cardIn)} da fatura do cartão que vence neste mês (compras do mês anterior). ` : ''}
          {cardOut > 0 ? `${formatBRL(cardOut)} comprados no cartão neste mês contam no mês da fatura.` : ''}
        </div>
      )}
      <Seg value={view} onChange={setView} options={[['lista', 'Lançamentos'], ['graficos', 'Gráficos'], ['recorrentes', 'Recorrentes']]} />

      {view === 'lista' && (
        <>
          {invoices.map((inv) => {
            const card = data.cards.find((c) => c.id === inv.cardId);
            return (
              <div className="card" key={inv.cardId + inv.dueDate} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <CreditCard size={20} />
                <div style={{ flex: 1 }}><div style={{ fontWeight: 560 }}>Fatura {card?.name ?? ''}</div><div className="hint">Vence em {formatDateBR(inv.dueDate)} · <span className="num">{formatBRL(inv.totalCents)}</span></div></div>
                <button className="btn sm" onClick={async () => { const acc = card?.accountId ?? defaultAccountId(); if (!acc) return toast('Cadastre uma conta em Ajustes', 'err'); await payInvoice(inv.txIds, acc); toast('Fatura paga'); }}>Pagar</button>
              </div>
            );
          })}
          <label className="field" style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: 14, top: 16, color: 'var(--muted)' }} />
            <input style={{ paddingLeft: 38 }} placeholder="Buscar em todos os meses" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar movimentação" />
          </label>
          <Seg value={filter} onChange={setFilter} options={[['todas', 'Todas'], ['receitas', 'Receitas'], ['despesas', 'Despesas'], ['pendentes', 'Pendentes']]} />
          {list.length === 0 ? <Empty title="Nada por aqui" text="Lance uma receita ou despesa para começar." action="Nova movimentação" onAction={() => setEdit('new')} /> : groups.map(([date, items]) => (
            <div key={date}>
              <div className="section">{weekdayShort(date)}, {formatDateBR(date)}</div>
              <div className="card" style={{ padding: '4px 14px' }}>
                {items.map((t) => {
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
          ))}
        </>
      )}
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
      {edit && <TxForm tx={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
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

function TxForm({ tx, onClose }: { tx: Transaction | null; onClose: () => void }) {
  const data = useStore((s) => s.data);
  const today = useStore((s) => s.today);
  const [type, setType] = useState<TxType>(tx?.type ?? 'expense');
  const [kind, setKind] = useState<TxKind>(tx?.kind ?? 'variavel');
  const [desc, setDesc] = useState(tx?.description ?? '');
  const [amount, setAmount] = useState(tx ? centsToInput(tx.amountCents) : '');
  const [categoryId, setCategoryId] = useState(tx?.categoryId ?? 'mercado');
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
      <Field label="Tipo"><select value={kind} onChange={(e) => changeKind(e.target.value as TxKind)} disabled={!!tx?.installment}>{kinds.map((k) => (<option key={k} value={k}>{KIND_LABEL[k]}</option>))}</select></Field>
      <Field label="Descrição"><input name="descricao" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={type === 'income' ? 'Ex.: Salário de novembro' : 'Ex.: Mercado da semana'} /></Field>
      <div className="two">
        <Field label={kind === 'parcelada' && !tx ? 'Valor de cada parcela (R$)' : 'Valor (R$)'}><MoneyInput name="valor" value={amount} onChange={setAmount} /></Field>
        <Field label={kind === 'parcelada' && !tx ? '1ª parcela em' : 'Data'}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      {type === 'expense' && !credit && kind !== 'parcelada' && (
        <Field label="Linha digitável do boleto (opcional)" hint={boletoMsg ?? 'Cole os números do boleto: o app preenche valor e vencimento.'}><input name="boleto" inputMode="numeric" value={boleto} onChange={(e) => readBoleto(e.target.value)} placeholder="47 ou 48 números" /></Field>
      )}
      {kind === 'parcelada' && !tx && <Field label="Número de parcelas"><input inputMode="numeric" value={parcels} onChange={(e) => setParcels(e.target.value.replace(/\D/g, ''))} /></Field>}
      <Field label="Categoria"><select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>{cats.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}</select></Field>
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
