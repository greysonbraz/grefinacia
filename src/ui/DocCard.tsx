import { useState } from 'react';
import { Check } from 'lucide-react';
import type { DocGuess, TdGuess } from '../domain/docread';
import { matchHolding } from '../domain/docread';
import { formatUSD } from '../domain/dollar';
import { suggestCategory } from '../domain/importer';
import { formatBRL } from '../lib/money';
import { formatDateBR } from '../lib/dates';
import { uid } from '../lib/ids';
import type { PaymentMethod, Transaction, UsdHolding } from '../lib/types';
import { defaultAccountId, saveTransaction, toast, upsert, useStore } from '../state/store';

/** Cartão de confirmação do que a AI leu numa foto: nada é salvo sem o seu toque. */
export function DocCard({ guess }: { guess: DocGuess }) {
  if (guess.kind === 'td') return <TdCard items={guess.items} />;
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
