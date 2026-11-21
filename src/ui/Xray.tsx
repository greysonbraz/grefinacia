import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { deleteTransaction, toast, updateSettings, useStore } from '../state/store';
import { cashForecast, CLASS_LABEL, detectSubscriptions, findDuplicates, portfolioXray, simulateLoan, unusualSpending, type LoanResult } from '../domain/analysis';
import { formatBRL, formatPct, parseDecimal, parseMoney } from '../lib/money';
import { formatDateBR, monthShortYear } from '../lib/dates';
import { BrandMark, ChartBox, Field, Full, Legend, MoneyInput, Note, Progress, Seg, seriesColors } from './kit';

const ddmm = (d: string) => d.slice(8, 10) + '/' + d.slice(5, 7);

// ============================ RAIO-X (Grefinacia AI) ============================

/** Análises detalhadas, calculadas no aparelho: previsão de caixa, fora do padrão, cobranças em dobro, assinaturas e carteira. */
export function Xray() {
  const data = useStore((s) => s.data);
  const settings = useStore((s) => s.settings);
  const today = useStore((s) => s.today);
  const catName = (id: string) => data.categories.find((c) => c.id === id)?.name ?? id;
  const ignored = settings.analysis?.ignoredDuplicates ?? [];
  const unusual = useMemo(() => unusualSpending(data, today), [data, today]);
  const dups = useMemo(() => findDuplicates(data, today, ignored), [data, today, ignored]);
  const subs = useMemo(() => detectSubscriptions(data, today), [data, today]);
  const xray = useMemo(() => portfolioXray(data, today), [data, today]);
  const subsTotal = subs.reduce((t, s) => t + s.monthlyCents, 0);
  const pal = seriesColors();
  const ignore = async (key: string) => {
    await updateSettings({ analysis: { ignoredDuplicates: [...ignored, key] } });
    toast('Certo, não aviso mais deste par');
  };
  return (
    <>
      <Forecast />

      <div className="card">
        <h2>Fora do padrão</h2>
        {unusual.categories.length === 0 && unusual.transactions.length === 0 ? <div className="hint">Nada fora do seu normal neste mês.</div> : null}
        {unusual.categories.map((c) => (
          <div key={c.categoryId} style={{ marginBottom: 10 }}>
            <div className="kv"><span>{catName(c.categoryId)}</span><b className="num neg">+{formatPct(c.pct)}</b></div>
            <Progress pct={Math.min((c.curCents / (c.typicalCents * 2)) * 100, 100)} tone="over" />
            <div className="hint">{formatBRL(c.curCents)} neste mês · normal {formatBRL(c.typicalCents)}</div>
          </div>
        ))}
        {unusual.transactions.map((t) => (
          <div className="kv" key={t.tx.id}><span>{t.tx.description} · {ddmm(t.tx.date)}</span><b className="num">{formatBRL(t.tx.amountCents)} <span className="badge warn">{t.times.toFixed(1).replace('.', ',')}× o típico</span></b></div>
        ))}
        <Note>Cada categoria é comparada com a mediana dos 6 meses anteriores (mínimo de 3 meses). Um lançamento chama atenção quando passa de 3 vezes o valor típico da categoria e de R$ 100.</Note>
      </div>

      <div className="card">
        <h2>Cobranças em dobro</h2>
        {dups.length === 0 ? <div className="hint">Nenhuma cobrança repetida nos últimos 60 dias.</div> : dups.map((d) => (
          <div key={d.key} className="dup">
            <div className="kv"><span>{d.a.description}</span><b className="num">{formatBRL(d.a.amountCents)}</b></div>
            <div className="hint">Em {formatDateBR(d.a.date)} e em {formatDateBR(d.b.date)}{d.b.description !== d.a.description ? ` (“${d.b.description}”)` : ''}</div>
            <div className="btnrow" style={{ marginTop: 8 }}>
              <button className="btn sm ghost" onClick={() => ignore(d.key)}>Não é duplicada</button>
              <button className="btn sm danger" onClick={async () => { await deleteTransaction(d.b); toast('Lançamento repetido excluído'); }} aria-label={`Excluir o lançamento de ${formatDateBR(d.b.date)}`}><Trash2 size={16} /> Excluir o de {ddmm(d.b.date)}</button>
            </div>
          </div>
        ))}
        <Note>Mesmo valor, até 3 dias de diferença e descrição parecida. Excluir só apaga o lançamento no app; se o banco cobrou duas vezes, peça o estorno a ele.</Note>
      </div>

      <div className="card">
        <h2>Assinaturas e cobranças mensais</h2>
        {subs.length === 0 ? <div className="hint">Nenhuma encontrada.</div> : (
          <>
            <div className="grid2">
              <div className="tile"><div className="lbl">Por mês</div><div className="val num">{formatBRL(subsTotal)}</div></div>
              <div className="tile"><div className="lbl">Por ano</div><div className="val num">{formatBRL(subsTotal * 12)}</div></div>
            </div>
            {subs.map((s) => (
              <div className="kv" key={s.key}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><BrandMark name={s.name} size={32} /><span>{s.name} {s.source === 'detectada' ? <span className="badge">detectada</span> : null} {s.increasedFromCents ? <span className="badge bad">era {formatBRL(s.increasedFromCents)}</span> : null}</span></span>
                <b className="num">{formatBRL(s.monthlyCents)}</b>
              </div>
            ))}
          </>
        )}
        <Note>Entram as assinaturas cadastradas e as cobranças com valor parecido em pelo menos 3 meses seguidos. Uma que não aparece há 45 dias é tratada como cancelada.</Note>
      </div>

      <div className="card">
        <h2>Raio-X da carteira</h2>
        {xray.totalCents <= 0 ? <div className="hint">Sem investimentos cadastrados.</div> : (
          <>
            <ChartBox kind="doughnut" small labels={xray.classes.map((c) => CLASS_LABEL[c.cls])} series={[{ label: 'Investimentos', data: xray.classes.map((c) => c.cents) }]} colors={xray.classes.map((_, i) => pal[i])} />
            <Legend items={xray.classes.map((c, i) => ({ label: CLASS_LABEL[c.cls], color: pal[i], value: formatPct(c.pct) }))} />
            <div className="kv"><span>3 maiores itens</span><b className="num">{formatPct(xray.top3Pct)}</b></div>
            <div className="kv"><span>Equivale a ter</span><b className="num">{xray.effectiveItems.toFixed(1).replace('.', ',')} itens do mesmo tamanho</b></div>
            {xray.maturing.map((m) => (<div className="kv" key={m.name + m.date}><span>{m.name} vence em {ddmm(m.date)}</span><b className="num">{formatBRL(m.cents)}</b></div>))}
            {xray.unquoted > 0 && <Note>{xray.unquoted} {xray.unquoted === 1 ? 'item está' : 'itens estão'} sem cotação e entram pelo custo.</Note>}
          </>
        )}
        <Note>Fotografia da sua carteira, não recomendação. Renda fixa entra pelo valor atual que você informou.</Note>
      </div>
    </>
  );
}

function Forecast() {
  const data = useStore((s) => s.data);
  const today = useStore((s) => s.today);
  const [months, setMonths] = useState<'3' | '6' | '12'>('6');
  const f = useMemo(() => cashForecast(data, today, Number(months)), [data, today, months]);
  const pal = seriesColors();
  if (data.accounts.length === 0) return <div className="card"><h2>Previsão de caixa</h2><div className="hint">Cadastre suas contas com o saldo de hoje (Ajustes → Contas) para ver a previsão.</div></div>;
  return (
    <div className="card">
      <h2>Previsão de caixa</h2>
      <Seg value={months} onChange={setMonths} options={[['3', '3 meses'], ['6', '6 meses'], ['12', '12 meses']]} />
      <ChartBox kind="bar" labels={f.months.map((m) => monthShortYear(m.ym))} series={[{ label: 'Saldo no fim do mês', data: f.months.map((m) => m.endBalanceCents), color: pal[0] }]} />
      {f.firstNegative ? <div className="alert bad" style={{ marginTop: 10 }}><div><div className="t">Saldo negativo em {monthShortYear(f.firstNegative)}</div><div className="s">Reduza o gasto do dia a dia ou adie compras antes disso.</div></div></div> : null}
      <table className="tbl" style={{ marginTop: 8 }}>
        <thead><tr><th>Mês</th><th>Entra</th><th>Sai</th><th>Saldo</th></tr></thead>
        <tbody>
          {f.months.map((m) => (
            <tr key={m.ym}><td>{monthShortYear(m.ym)}</td><td className="num pos">{formatBRL(m.incomeCents)}</td><td className="num">{formatBRL(m.fixedCents + m.debtCents + m.variableCents)}</td><td className={'num ' + (m.endBalanceCents < 0 ? 'neg' : '')}>{formatBRL(m.endBalanceCents)}</td></tr>
          ))}
        </tbody>
      </table>
      <Note>
        Parte do saldo de hoje ({formatBRL(f.startCents)}). Entra: receitas lançadas e recorrentes. Sai: contas lançadas e recorrentes, parcelas, dívidas cadastradas e o gasto do dia a dia
        {f.variableBasisMonths ? ` estimado em ${formatBRL(f.variableMonthlyCents)} por mês (média dos últimos ${f.variableBasisMonths} ${f.variableBasisMonths === 1 ? 'mês' : 'meses'} fechados)` : ' (ainda sem meses fechados para estimar)'}.
        Receita sem lançamento nem recorrência não entra: cadastre seu salário no plano.
      </Note>
    </div>
  );
}

// ============================ COMPARADOR DE EMPRÉSTIMOS ============================

interface Offer { name: string; amount: string; months: string; mode: 'taxa' | 'parcela'; rate: string; installment: string; fees: string }
const blank = (i: number): Offer => ({ name: `Proposta ${i}`, amount: '10.000,00', months: '12', mode: 'taxa', rate: '', installment: '', fees: '' });

/** Compara até 3 propostas de empréstimo pelo custo efetivo (CET), em Price e SAC. */
export function LoanCompare({ onClose }: { onClose: () => void }) {
  const [offers, setOffers] = useState<Offer[]>([blank(1), blank(2)]);
  const [system, setSystem] = useState<'price' | 'sac'>('price');
  const set = (i: number, patch: Partial<Offer>) => setOffers(offers.map((o, k) => (k === i ? { ...o, ...patch } : o)));
  const results: (LoanResult | null)[] = offers.map((o) => {
    const amountCents = parseMoney(o.amount) ?? 0;
    const months = Math.round(Number(o.months) || 0);
    const feesCents = parseMoney(o.fees) ?? 0;
    if (o.mode === 'taxa') {
      const rate = parseDecimal(o.rate);
      return rate === null ? null : simulateLoan({ amountCents, months, monthlyRatePct: rate, feesCents, system });
    }
    const inst = parseMoney(o.installment);
    return inst ? simulateLoan({ amountCents, months, installmentCents: inst, feesCents, system: 'price' }) : null;
  });
  const valid = results.map((r, i) => ({ r, i })).filter((x): x is { r: LoanResult; i: number } => x.r !== null);
  const best = valid.length > 1 ? valid.reduce((a, b) => (b.r.cetMonthlyPct < a.r.cetMonthlyPct ? b : a)) : null;
  return (
    <Full title="Comparar empréstimos" onBack={onClose}>
      <Seg value={system} onChange={setSystem} options={[['price', 'Price (parcelas iguais)'], ['sac', 'SAC (parcelas caem)']]} />
      {offers.map((o, i) => {
        const r = results[i];
        return (
          <div className="card" key={i}>
            <Field label="Nome"><input value={o.name} onChange={(e) => set(i, { name: e.target.value })} aria-label={`Nome da proposta ${i + 1}`} /></Field>
            <div className="two">
              <Field label="Valor pedido (R$)"><MoneyInput name={`valor_${i}`} value={o.amount} onChange={(v) => set(i, { amount: v })} /></Field>
              <Field label="Prazo (meses)"><input name={`prazo_${i}`} inputMode="numeric" value={o.months} onChange={(e) => set(i, { months: e.target.value })} /></Field>
            </div>
            <Seg value={o.mode} onChange={(mode) => set(i, { mode })} options={[['taxa', 'Sei a taxa'], ['parcela', 'Sei a parcela']]} />
            <div className="two">
              {o.mode === 'taxa'
                ? <Field label="Juros ao mês (%)"><input name={`taxa_${i}`} inputMode="decimal" value={o.rate} onChange={(e) => set(i, { rate: e.target.value })} placeholder="2,5" /></Field>
                : <Field label="Parcela (R$)" hint="Calculo a taxa pela Price"><MoneyInput name={`parcela_${i}`} value={o.installment} onChange={(v) => set(i, { installment: v })} /></Field>}
              <Field label="Tarifas, IOF e seguro (R$)"><MoneyInput name={`tarifas_${i}`} value={o.fees} onChange={(v) => set(i, { fees: v })} /></Field>
            </div>
            {r ? (
              <div style={{ marginTop: 4 }}>
                {best?.i === i && <span className="badge good" style={{ marginBottom: 6 }}>menor custo efetivo</span>}
                <div className="kv"><span>Parcela{system === 'sac' && o.mode === 'taxa' ? ' (1ª → última)' : ''}</span><b className="num">{r.firstInstallmentCents === r.lastInstallmentCents ? formatBRL(r.firstInstallmentCents) : `${formatBRL(r.firstInstallmentCents)} → ${formatBRL(r.lastInstallmentCents)}`}</b></div>
                <div className="kv"><span>Juros</span><b className="num">{formatPct(r.monthlyRatePct)} ao mês</b></div>
                <div className="kv"><span>Total pago (com tarifas)</span><b className="num">{formatBRL(r.totalPaidCents)}</b></div>
                <div className="kv"><span>Custo além do valor pedido</span><b className="num neg">{formatBRL(r.costCents)}</b></div>
                <div className="kv"><span>CET estimado</span><b className="num">{formatPct(r.cetMonthlyPct)} a.m. · {formatPct(r.cetAnnualPct)} a.a.</b></div>
              </div>
            ) : <div className="hint">Preencha valor, prazo e a taxa ou a parcela.</div>}
            {offers.length > 1 && <button className="link" style={{ marginTop: 8 }} onClick={() => setOffers(offers.filter((_, k) => k !== i))}>Remover proposta</button>}
          </div>
        );
      })}
      {offers.length < 3 && <button className="btn ghost" onClick={() => setOffers([...offers, blank(offers.length + 1)])}><Plus size={18} /> Adicionar proposta</button>}
      <Note>
        Compare pelo CET (custo efetivo total), não só pelos juros: ele inclui tarifas, IOF e seguros. Aqui as tarifas são tratadas como descontadas do dinheiro que você recebe.
        É uma estimativa; o CET oficial vem no contrato e o banco é obrigado a informar. Na SAC as parcelas começam maiores e o juro total é menor. Antes de contratar, confira se a parcela cabe na previsão de caixa.
      </Note>
    </Full>
  );
}
