import { useState } from 'react';
import { Check } from 'lucide-react';
import type { DocGuess, HoldingGuess, TdGuess } from '../domain/docread';
import { matchHolding } from '../domain/docread';
import { formatUSD } from '../domain/dollar';
import { suggestCategory } from '../domain/importer';
import { formatBRL } from '../lib/money';
import { formatDateBR } from '../lib/dates';
import { uid } from '../lib/ids';
import type { PaymentMethod, Transaction, UsdHolding } from '../lib/types';
import { defaultAccountId, refreshUsQuotes, saveOperation, saveTransaction, toast, upsert, useStore } from '../state/store';
import { computePositions } from '../domain/portfolio';
import { formatQty } from '../lib/money';

/** Cartão de confirmação do que a AI leu numa foto: nada é salvo sem o seu toque. */
export function DocCard({ guess }: { guess: DocGuess }) {
  if (guess.kind === 'td') return <TdCard items={guess.items} />;
  if (guess.kind === 'carteira') return <HoldingsCard items={guess.items} />;
  if (guess.kind === 'boleto') return <BoletoCard g={guess} />;
  if (guess.kind === 'receipt') return <ReceiptCard g={guess} />;
  return null;
}

function TdCard({ items }: { items: TdGuess[] }) {
  const holdings = useStore((s) => s.data.usdHoldings ?? []);
  const [done, setDone] = useState<Set<number>>(new Set());
  const save = async (i: number) => {
    const g = items[i];
    const old = matchHolding(holdings, g.name);
    const h: UsdHolding = {
      ...(old ?? {}),
      id: old?.id ?? uid('us_'),
      kind: 'deposito',
      name: old?.name ?? g.name,
      balanceUsdCents: g.balanceUsdCents,
      appliedUsdCents: g.appliedUsdCents ?? old?.appliedUsdCents,
      ratePct: g.ratePct ?? old?.ratePct,
      startDate: g.startDate ?? old?.startDate,
      maturityDate: g.maturityDate ?? old?.maturityDate,
      updatedAt: new Date().toISOString(),
    };
    await upsert('usdHoldings', h);
    setDone((d) => new Set(d).add(i));
    toast(old ? `${h.name} atualizado` : `${h.name} adicionado em Exterior (US$)`);
  };
  return (
    <div className="doccard">
      {items.map((g, i) => {
        const old = matchHolding(holdings, g.name);
        return (
          <div className="docitem" key={i}>
            <div className="t">{g.name}</div>
            <div className="kv"><span>Valor de hoje</span><b className="num">{formatUSD(g.balanceUsdCents)}</b></div>
            {g.appliedUsdCents !== undefined && <div className="kv"><span>Aplicado</span><b className="num">{formatUSD(g.appliedUsdCents)}</b></div>}
            {g.ratePct !== undefined && <div className="kv"><span>Rentabilidade</span><b>{String(g.ratePct).replace('.', ',')}% ao ano</b></div>}
            {g.startDate && <div className="kv"><span>Aplicação</span><b>{formatDateBR(g.startDate)}</b></div>}
            {g.maturityDate && <div className="kv"><span>Vencimento</span><b>{formatDateBR(g.maturityDate)}</b></div>}
            {old && <div className="hint">Já existe "{old.name}" ({formatUSD(old.balanceUsdCents ?? 0)}): vou atualizar o mesmo item.</div>}
            {done.has(i)
              ? <div className="docdone"><Check size={16} /> Salvo</div>
              : <button className="btn sm" onClick={() => void save(i)}>{old ? 'Atualizar' : 'Adicionar'}</button>}
          </div>
        );
      })}
      {items.length > 1 && done.size < items.length && <button className="btn ghost sm" onClick={async () => { for (let i = 0; i < items.length; i++) if (!done.has(i)) await save(i); }}>Salvar todos</button>}
    </div>
  );
}

function BoletoCard({ g }: { g: Extract<DocGuess, { kind: 'boleto' }> }) {
  const today = useStore((s) => s.today);
  const [done, setDone] = useState(false);
  const b = g.boleto;
  const save = async () => {
    if (!b.amountCents) return;
    const t: Transaction = { id: uid('t_'), type: 'expense', kind: 'fixa', description: 'Boleto', amountCents: b.amountCents, categoryId: 'contas', date: today, dueDate: b.dueDate ?? today, paymentMethod: 'boleto', accountId: defaultAccountId(), status: 'pending', boletoLine: b.line, source: 'manual', createdAt: Date.now() };
    await saveTransaction(t);
    setDone(true);
    toast('Conta a pagar criada em Movimentações');
  };
  return (
    <div className="doccard"><div className="docitem">
      <div className="kv"><span>Valor</span><b className="num">{b.amountCents ? formatBRL(b.amountCents) : 'sem valor no boleto'}</b></div>
      {b.dueDate && <div className="kv"><span>Vencimento</span><b>{formatDateBR(b.dueDate)}</b></div>}
      {done ? <div className="docdone"><Check size={16} /> Criado como "a pagar"</div> : b.amountCents ? <button className="btn sm" onClick={() => void save()}>Criar conta a pagar</button> : <div className="hint">Lance pelo botão + em Movimentações informando o valor.</div>}
    </div></div>
  );
}

function ReceiptCard({ g }: { g: Extract<DocGuess, { kind: 'receipt' }> }) {
  const data = useStore((s) => s.data);
  const rules = useStore((s) => s.settings.importRules);
  const today = useStore((s) => s.today);
  const [method, setMethod] = useState<PaymentMethod>('debito');
  const [done, setDone] = useState(false);
  const r = g.receipt;
  const desc = r.merchant ?? 'Compra';
  const cat = suggestCategory(desc, 'expense', data, rules ?? []).categoryId;
  const catName = data.categories.find((c) => c.id === cat)?.name ?? cat;
  const save = async () => {
    const date = r.date ?? today;
    const t: Transaction = { id: uid('t_'), type: 'expense', kind: 'variavel', description: desc, amountCents: r.totalCents!, categoryId: cat, date, paymentMethod: method, accountId: defaultAccountId(), status: 'paid', paidDate: date, source: 'manual', notes: r.cnpj ? `CNPJ ${r.cnpj}` : undefined, createdAt: Date.now() };
    await saveTransaction(t);
    setDone(true);
    toast('Despesa lançada');
  };
  return (
    <div className="doccard"><div className="docitem">
      <div className="t">{desc}</div>
      <div className="kv"><span>Total</span><b className="num">{formatBRL(r.totalCents!)}</b></div>
      <div className="kv"><span>Data</span><b>{formatDateBR(r.date ?? today)}</b></div>
      <div className="kv"><span>Categoria sugerida</span><b>{catName}</b></div>
      {done ? <div className="docdone"><Check size={16} /> Lançado. Para mudar algo, abra em Movimentações.</div> : (
        <>
          <label className="field" style={{ margin: '8px 0' }}><span>Como pagou</span><select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}><option value="debito">Débito</option><option value="pix">Pix</option><option value="dinheiro">Dinheiro</option></select></label>
          <button className="btn sm" onClick={() => void save()}>Lançar despesa</button>
          <div className="hint" style={{ marginTop: 6 }}>Comprou no crédito? Use "Escanear cupom" na nova movimentação para escolher o cartão.</div>
        </>
      )}
    </div></div>
  );
}

/** Print de carteira: B3 entra como compra pelo preço médio (data de hoje); EUA entra/atualiza na aba Exterior. */
function HoldingsCard({ items }: { items: HoldingGuess[] }) {
  const data = useStore((s) => s.data);
  const today = useStore((s) => s.today);
  const [done, setDone] = useState<Set<string>>(new Set());
  const held = new Set(computePositions(data.assets, data.operations).filter((p) => p.quantity > 0).map((p) => p.asset.ticker));
  const fromBank = new Set((data.bankInvestments ?? []).map((i) => (i.code ?? '').toUpperCase()));
  const usHeld = (t: string) => (data.usdHoldings ?? []).find((h) => h.ticker === t);
  const mark = (t: string) => setDone((d) => new Set(d).add(t));
  const addB3 = async (g: HoldingGuess) => {
    let a = data.assets.find((x) => x.ticker === g.ticker);
    if (!a) { a = { id: uid('as_'), ticker: g.ticker, type: /11$/.test(g.ticker) ? 'fii' : 'acao' }; await upsert('assets', a); }
    const err = await saveOperation({ id: uid('op_'), assetId: a.id, side: 'buy', quantity: g.quantity!, priceCents: g.avgPriceCents!, feesCents: 0, date: today, broker: 'Print da carteira', createdAt: Date.now() });
    if (err) return toast(err, 'err');
    mark(g.ticker);
    toast(`${g.ticker} adicionado na Bolsa`);
  };
  const addUs = async (g: HoldingGuess) => {
    const old = usHeld(g.ticker);
    const cost = g.avgPriceCents ?? (g.valueCents && g.quantity ? Math.round(g.valueCents / g.quantity) : undefined);
    await upsert('usdHoldings', { ...(old ?? {}), id: old?.id ?? uid('us_'), kind: old?.kind ?? 'acao', name: old?.name ?? g.ticker, ticker: g.ticker, quantity: g.quantity, avgCostUsdCents: cost, balanceUsdCents: undefined, updatedAt: new Date().toISOString() });
    void refreshUsQuotes();
    mark(g.ticker);
    toast(old ? `${g.ticker} atualizado em Exterior (US$)` : `${g.ticker} adicionado em Exterior (US$)`);
  };
  return (
    <div className="doccard">
      {items.map((g) => {
        const isB3 = g.market === 'b3';
        const already = isB3 && (held.has(g.ticker) || fromBank.has(g.ticker));
        const canB3 = isB3 && !!g.quantity && !!g.avgPriceCents;
        const fmt = (c: number) => (isB3 ? formatBRL(c) : formatUSD(c));
        return (
          <div className="docitem" key={g.ticker}>
            <div className="t">{g.ticker} <span className="mut" style={{ fontWeight: 400, fontSize: 12.5 }}>{isB3 ? 'B3' : 'EUA'}</span></div>
            {g.quantity !== undefined && <div className="kv"><span>Quantidade</span><b className="num">{formatQty(g.quantity)}</b></div>}
            {g.avgPriceCents !== undefined && <div className="kv"><span>Preço médio</span><b className="num">{fmt(g.avgPriceCents)}</b></div>}
            {g.valueCents !== undefined && <div className="kv"><span>Valor no print</span><b className="num">{fmt(g.valueCents)}</b></div>}
            {done.has(g.ticker) ? <div className="docdone"><Check size={16} /> Salvo</div>
              : already ? <div className="hint">Já está no app{fromBank.has(g.ticker) ? ' (vem pelo banco)' : ''}: não adiciono de novo para não contar duas vezes.</div>
              : isB3 ? (canB3 ? <><button className="btn sm" onClick={() => void addB3(g)}>Adicionar na Bolsa</button><div className="hint" style={{ marginTop: 6 }}>Entra como compra de hoje pelo preço médio. Se souber a data da compra, ajuste em Investimentos → Bolsa.</div></> : <div className="hint">Faltou o preço médio no print. Cadastre em Investimentos → Bolsa.</div>)
              : g.quantity ? <><button className="btn sm" onClick={() => void addUs(g)}>{usHeld(g.ticker) ? 'Atualizar' : 'Adicionar'} em Exterior (US$)</button>{!g.avgPriceCents && <div className="hint" style={{ marginTop: 6 }}>Sem preço médio no print: o custo fica pelo valor de hoje (ajuste depois se quiser).</div>}</>
              : <div className="hint">Faltou a quantidade no print.</div>}
          </div>
        );
      })}
    </div>
  );
}
