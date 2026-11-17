import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { bankConfigured, setBankInvestmentCounted, syncBank, toast, useStore } from '../state/store';
import { groupByType, rateLabel, SUBTYPE_LABEL } from '../domain/bankInvest';
import { formatBRL, formatQty } from '../lib/money';
import { formatDateBR } from '../lib/dates';
import { ChartBox, Empty, Legend, Note, seriesColors, SwitchRow } from './kit';
import type { BankInvestment } from '../lib/types';

/** Investimentos que vieram dos bancos pela conexão (Etapa 14). */
export function BankInvestments() {
  const list = useStore((s) => s.data.bankInvestments ?? []);
  const report = useStore((s) => s.bank.investReport ?? []);
  const lastOk = useStore((s) => s.bank.lastOkAt);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const groups = useMemo(() => groupByType(list), [list]);
  const total = groups.reduce((s, g) => s + g.cents, 0);
  const gross = list.filter((i) => i.counted).reduce((s, i) => s + i.grossCents, 0);
  const applied = list.filter((i) => i.counted && i.originalCents).reduce((s, i) => s + (i.originalCents ?? 0), 0);
  const appliedBal = list.filter((i) => i.counted && i.originalCents).reduce((s, i) => s + i.balanceCents, 0);
  const pal = seriesColors();
  const sync = async () => {
    setBusy(true);
    try {
      const r = await syncBank();
      toast(r.errors.length ? 'A sincronização teve erros' : 'Investimentos atualizados', r.errors.length ? 'err' : 'ok');
    } finally {
      setBusy(false);
    }
  };

  if (!bankConfigured()) return <Empty title="Conecte seus bancos" text="Em Ajustes → Conexão bancária (Meu Pluggy). Os investimentos de cada banco aparecem aqui sozinhos." />;

  return (
    <>
      <div className="card hero">
        <div className="lbl">Investido nos bancos (valor líquido)</div>
        <div className="big num">{formatBRL(total)}</div>
        <div className="hint">Bruto {formatBRL(gross)}{applied > 0 ? ` · rendeu ${formatBRL(appliedBal - applied)} sobre o aplicado` : ''}{lastOk ? ` · atualizado ${formatDateBR(lastOk.slice(0, 10))}` : ''}</div>
        {groups.length > 0 && total > 0 && (
          <>
            <ChartBox kind="doughnut" small labels={groups.map((g) => g.label)} series={[{ label: 'Valor', data: groups.map((g) => g.cents) }]} colors={groups.map((_, i) => pal[i % pal.length])} />
            <Legend items={groups.map((g, i) => ({ label: g.label, color: pal[i % pal.length], value: formatBRL(g.cents) }))} />
          </>
        )}
        <button className="btn ghost sm" disabled={busy} onClick={sync}><RefreshCw size={16} style={busy ? { animation: 'spin 1s linear infinite' } : undefined} /> Atualizar agora</button>
      </div>

      {report.filter((r) => r.error || r.foreign).map((r) => (
        <div key={r.bank} className="note neg">{r.bank}: {r.error ? r.error : `${r.foreign} investimento(s) em moeda estrangeira ficaram de fora (veja a aba Dólar).`}</div>
      ))}
      {list.length === 0 && <Note>Nenhum investimento veio dos bancos ainda. Toque em "Atualizar agora". Se continuar vazio, no Meu Pluggy confira se o banco foi conectado com o produto "Investimentos" autorizado.</Note>}

      {groups.map((g) => (
        <div key={g.label}>
          <div className="section">{g.label} · {formatBRL(g.cents)}</div>
          <div className="card" style={{ padding: '4px 14px' }}>
            {g.items.map((i) => <Row key={i.id} i={i} open={open === i.id} onToggle={() => setOpen(open === i.id ? null : i.id)} />)}
          </div>
        </div>
      ))}
      <Note>Valores informados pelo banco pelo Open Finance (atualizam a cada 24 h no Meu Pluggy). Rentabilidade passada não vem pelo Open Finance; quando o banco informa o valor aplicado, o app mostra quanto rendeu. Aplicações e resgates na conta corrente não contam como gasto. Se você já cadastrou o mesmo investimento à mão (Bolsa ou Renda fixa), desligue "Contar no patrimônio" para não contar em dobro: ações com o mesmo código já vêm desligadas.</Note>
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
    </>
  );
}

function Row({ i, open, onToggle }: { i: BankInvestment; open: boolean; onToggle: () => void }) {
  const rate = rateLabel(i);
  const profit = i.originalCents ? i.balanceCents - i.originalCents : null;
  return (
    <div style={{ borderBottom: '1px solid var(--line)', padding: '8px 0', opacity: i.counted ? 1 : 0.6 }}>
      <button className="kv" style={{ width: '100%', textAlign: 'left', border: 0, padding: 0, background: 'none', color: 'inherit' }} onClick={onToggle}>
        <span>{i.name}<br /><span className="hint">{[i.bankName, SUBTYPE_LABEL[i.subtype ?? ''] ?? i.subtype, rate, i.dueDate ? `vence ${formatDateBR(i.dueDate)}` : ''].filter(Boolean).join(' · ')}</span></span>
        <b className="num">{formatBRL(i.balanceCents)}{profit !== null && <><br /><span className={'hint ' + (profit >= 0 ? 'pos' : 'neg')}>{profit >= 0 ? '+' : ''}{formatBRL(profit)}</span></>}</b>
      </button>
      {open && (
        <div style={{ marginTop: 6 }}>
          <div className="kv"><span>Valor bruto</span><b className="num">{formatBRL(i.grossCents)}</b></div>
          {i.grossCents !== i.balanceCents && <div className="kv"><span>Impostos (IR/IOF) se resgatar hoje</span><b className="num">{formatBRL(i.grossCents - i.balanceCents)}</b></div>}
          {i.originalCents ? <div className="kv"><span>Valor aplicado</span><b className="num">{formatBRL(i.originalCents)}</b></div> : null}
          {i.quantity ? <div className="kv"><span>Quantidade</span><b className="num">{formatQty(i.quantity)}{i.unitCents ? ` × ${formatBRL(i.unitCents)}` : ''}</b></div> : null}
          {i.issuer && <div className="kv"><span>Emissor</span><b>{i.issuer}</b></div>}
          {i.code && <div className="kv"><span>Código</span><b>{i.code}</b></div>}
          {i.date && <div className="kv"><span>Valor de</span><b>{formatDateBR(i.date)}</b></div>}
          <SwitchRow title="Contar no patrimônio" sub={i.countedReason === 'manual-duplicado' ? 'Desligado porque você já cadastrou esse código à mão.' : undefined} on={i.counted} onChange={(v) => void setBankInvestmentCounted(i.id, v)} />
        </div>
      )}
    </div>
  );
}
