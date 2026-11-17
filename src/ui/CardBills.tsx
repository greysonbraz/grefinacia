import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { cardBills } from '../domain/bills';
import { formatBRL } from '../lib/money';
import { capFirst, formatDateBR, monthName, monthOf, monthShort } from '../lib/dates';
import { ChartBox, cssVar, Full, Note, Seg } from './kit';

const STATUS = { paga: 'Paga', aberta: 'Aberta', futura: 'Futura' } as const;

/** Faturas do cartão, mês a mês, como no app do banco (Etapa 18). */
export function CardBills({ onClose, cardId: initial }: { onClose: () => void; cardId?: string }) {
  const data = useStore((s) => s.data);
  const today = useStore((s) => s.today);
  const bank = useStore((s) => s.bank);
  const links = useStore((s) => s.settings.bank.links);
  const [cardId, setCardId] = useState(initial ?? data.cards[0]?.id ?? '');
  // faturas do banco do cartão ligado pela conexão
  const pluggyId = Object.entries(links).find(([, l]) => l.kind === 'cartao' && l.id === cardId)?.[0];
  const bankBills = (pluggyId && bank.bills?.[pluggyId]) || [];
  const bills = useMemo(() => cardBills(data, cardId, today, bankBills), [data, cardId, today, bankBills]);
  const openIdx = Math.max(bills.findIndex((b) => b.status === 'aberta'), 0);
  const [sel, setSel] = useState<number | null>(null);
  const i = sel ?? openIdx;
  const from = Math.max(0, i - 4);
  const view = bills.slice(from, from + 8);
  const cur = bills[i];
  const color = (s: string) => (s === 'paga' ? cssVar('--s3') : s === 'aberta' ? cssVar('--s1') : cssVar('--sother'));

  return (
    <Full title="Faturas" onBack={onClose}>
      {data.cards.length > 1 && <Seg value={cardId} onChange={(v) => { setCardId(v); setSel(null); }} options={data.cards.map((c) => [c.id, c.name.slice(0, 18)] as [string, string])} />}
      {bills.length === 0 ? <div className="empty">Nenhuma compra neste cartão ainda.</div> : (
        <>
          <div className="card">
            <ChartBox kind="bar" small labels={view.map((b) => monthShort(monthOf(b.dueDate)))} series={[{ label: 'Fatura', data: view.map((b) => Math.max(b.totalCents, 0)) }]} colors={view.map((b, k) => (from + k === i ? color(b.status) : color(b.status) + '99'))} />
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginTop: 8 }}>
              {bills.map((b, k) => (
                <button key={b.dueDate} className={'btn sm ' + (k === i ? '' : 'ghost')} style={{ flex: '0 0 auto' }} onClick={() => setSel(k)}>{monthShort(monthOf(b.dueDate))}</button>
              ))}
            </div>
          </div>
          {cur && (
            <div className="card">
              <div className="kv" style={{ border: 0 }}>
                <span><b>{capFirst(monthName(monthOf(cur.dueDate)))}</b> <span className="hint">· {STATUS[cur.status]}</span></span>
                <b className="num" style={{ fontSize: 24 }}>{formatBRL(cur.totalCents)}</b>
              </div>
              <div className="kv"><span>Vencimento</span><b>{formatDateBR(cur.dueDate)}</b></div>
              {cur.bankTotalCents !== undefined && (
                <div className="kv"><span>Total no banco</span><b className={'num ' + (Math.abs(cur.bankTotalCents - cur.totalCents) <= 100 ? 'pos' : 'warn')}>{formatBRL(cur.bankTotalCents)}{Math.abs(cur.bankTotalCents - cur.totalCents) <= 100 ? ' · confere' : ''}</b></div>
              )}
              <div className="section" style={{ marginTop: 10 }}>Despesas da fatura</div>
              {cur.items.length === 0 && <div className="hint">Nenhum lançamento desta fatura no app.</div>}
              {cur.items.map((t) => (
                <div className="kv" key={t.id}>
                  <span>{t.description}<br /><span className="hint">{formatDateBR(t.date)}</span></span>
                  <b className={'num ' + (t.type === 'income' ? 'pos' : '')}>{t.type === 'income' ? '−' : ''}{formatBRL(t.amountCents)}</b>
                </div>
              ))}
            </div>
          )}
          <Note>Cada compra fica na fatura que o banco informou pelo Open Finance (quando ele informa); sem isso, o app calcula pelo dia de fechamento do cartão. Parcelas futuras aparecem nas faturas dos próximos meses. "Total no banco" é o valor da fatura no banco, para conferir.</Note>
        </>
      )}
    </Full>
  );
}
