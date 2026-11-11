import { useMemo, useState } from 'react';
import { Plus, TriangleAlert, FileText, Sheet as SheetIco } from 'lucide-react';
import { defaultAccountId, deleteGoal, moveGoal, remove, saveSalary, saveTransaction, toast, updateSettings, upsert, useStore } from '../state/store';
import type { Debt, DebtKind, Goal } from '../lib/types';
import { spendableView } from '../domain/salary';
import { goalProgress } from '../domain/goals';
import { monthSummary } from '../domain/ledger';
import { budgetStatuses } from '../domain/overview';
import { annualFromMonthly, debtTotals, presentValue, simulateAnticipation, simulateExtra, simulateRefinance, simulateStrategy } from '../domain/debts';
import { financialFreedom, monthlyClosing } from '../domain/reports';
import { simulateGrowth } from '../domain/fixedincome';
import { exportClosingPdf } from '../services/reports';
import { saveAndShare, transactionsToCSV } from '../services/backup';
import { centsToInput, formatBRL, formatPct, parseDecimal, parseMoney } from '../lib/money';
import { formatDateBR, monthLong, monthOf } from '../lib/dates';
import { uid } from '../lib/ids';
import { ChartBox, cssVar, Empty, Field, Full, Ico, Legend, MoneyInput, MonthNav, Note, Progress, Seg, seriesColors, Sheet } from './kit';

type Sub = 'salario' | 'reservas' | 'orcamento' | 'dividas' | 'liberdade' | 'relatorios';

export function Planning({ initial }: { initial?: string }) {
  const [sub, setSub] = useState<Sub>((initial as Sub) ?? 'salario');
  return (
    <div className="screen">
      <div className="head"><h1>Planejamento</h1></div>
      <Seg value={sub} onChange={setSub} options={[['salario', 'Salário'], ['reservas', 'Reservas'], ['orcamento', 'Orçamento'], ['dividas', 'Dívidas'], ['liberdade', 'Liberdade'], ['relatorios', 'Relatórios']]} />
      {sub === 'salario' && <Salario />}
      {sub === 'reservas' && <Reservas />}
      {sub === 'orcamento' && <Orcamento />}
      {sub === 'dividas' && <Dividas />}
      {sub === 'liberdade' && <Liberdade />}
      {sub === 'relatorios' && <Relatorios />}
    </div>
  );
}

function Salario() {
  const data = useStore((s) => s.data);
  const settings = useStore((s) => s.settings);
  const today = useStore((s) => s.today);
  const sal = settings.salary;
  const [amount, setAmount] = useState(sal.amountCents ? centsToInput(sal.amountCents) : '');
  const [day, setDay] = useState(String(sal.payDay));
  const [save, setSave] = useState(sal.savePct);
  const [invest, setInvest] = useState(sal.investPct);
  const dirty = (parseMoney(amount) ?? 0) !== sal.amountCents || Number(day) !== sal.payDay || save !== sal.savePct || invest !== sal.investPct;
  const preview = { ...settings, salary: { ...sal, amountCents: parseMoney(amount) ?? 0, savePct: save, investPct: invest } };
  const v = useMemo(() => spendableView(data, preview, monthOf(today), today), [data, amount, save, invest, today]);
  const p = v.plan;
  const debts = v.fixedItems.length ? data.transactions.filter((t) => monthOf(t.date) === v.ym && t.type === 'expense' && ['fixa', 'assinatura', 'parcelada'].includes(t.kind) && (t.categoryId === 'dividas' || t.kind === 'parcelada')).reduce((s, t) => s + t.amountCents, 0) : 0;
  const parts = [
    { label: 'Despesas essenciais', cents: p.fixedCents - debts, color: cssVar('--s1') },
    { label: 'Dívidas e parcelas', cents: debts, color: cssVar('--s8') },
    { label: 'Guardar', cents: p.saveCents, color: cssVar('--s3') },
    { label: 'Investir', cents: p.investCents, color: cssVar('--s7') },
    { label: 'Livre', cents: p.freeCents, color: cssVar('--s4') },
  ].filter((x) => x.cents > 0);
  const total = parts.reduce((s, x) => s + x.cents, 0);
  return (
    <>
      <div className="card">
        <h2>Seu salário</h2>
        <div className="two" style={{ marginTop: 10 }}>
          <Field label="Valor líquido (R$)"><MoneyInput name="salario" value={amount} onChange={setAmount} /></Field>
          <Field label="Dia do pagamento"><input name="dia" inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value.replace(/\D/g, '').slice(0, 2))} /></Field>
        </div>
        <Field label={`Guardar: ${save}% do que sobra após as fixas`}><input type="range" min={0} max={100} step={5} value={save} onChange={(e) => { const n = Number(e.target.value); setSave(n); if (n + invest > 100) setInvest(100 - n); }} style={{ padding: 0, minHeight: 32, accentColor: 'var(--gold)' }} /></Field>
        <Field label={`Investir: ${invest}%`}><input type="range" min={0} max={100 - save} step={5} value={invest} onChange={(e) => setInvest(Number(e.target.value))} style={{ padding: 0, minHeight: 32, accentColor: 'var(--gold)' }} /></Field>
        <div className="hint">Livre para gastar: {100 - save - invest}%</div>
        {dirty && <div className="btnrow"><button className="btn" onClick={async () => { const d = Math.min(Math.max(Number(day) || 1, 1), 31); await saveSalary(parseMoney(amount) ?? 0, d, save, invest, sal.accountId ?? defaultAccountId()); toast('Plano salarial salvo'); }}>Salvar plano</button></div>}
      </div>

      {p.risk === 'deficit' && <div className="alert bad"><TriangleAlert size={20} /><div><div className="t">Risco de faltar dinheiro</div><div className="s">As despesas fixas ({formatBRL(p.fixedCents)}) passam da receita em {formatBRL(p.deficitCents)}. Não há valor para guardar ou investir neste mês: reduza compromissos ou renegocie parcelas.</div></div></div>}
      {p.risk === 'apertado' && <div className="alert warn"><TriangleAlert size={20} /><div><div className="t">Mês apertado</div><div className="s">Sobra pouco dinheiro livre. Uma divisão mais conservadora seria guardar {Math.min(save, 10)}% e investir {Math.min(invest, 5)}% até as despesas fixas baixarem.</div></div></div>}

      {p.risk !== 'sem_receita' ? (
        <div className="card">
          <div className="cardhead"><div><h2>Divisão de {monthLong(v.ym)}</h2><div className="hint">Receita {v.incomeSource === 'recebido' ? 'recebida' : v.incomeSource === 'previsto' ? 'prevista' : 'lançada'}: <span className="num">{formatBRL(p.incomeCents)}</span></div></div></div>
          {total > 0 && <div className="comp" style={{ height: 14 }}>{parts.map((x) => (<i key={x.label} style={{ width: (x.cents / total) * 100 + '%', background: x.color }} />))}</div>}
          {parts.map((x) => (<div className="kv" key={x.label}><span><i className="dot" style={{ background: x.color }} />{x.label}</span><b className="num">{formatBRL(x.cents)}</b></div>))}
          <div className="grid2" style={{ marginTop: 14, marginBottom: 0 }}>
            <div className="tile"><div className="lbl">1. Posso guardar</div><div className="val num">{formatBRL(p.saveCents)}</div></div>
            <div className="tile"><div className="lbl">2. Posso investir</div><div className="val num">{formatBRL(p.investCents)}</div></div>
            <div className="tile" style={{ gridColumn: '1 / -1' }}><div className="lbl">3. Sobra para usar no mês</div><div className={'val num ' + (v.remainingCents < 0 ? 'neg' : '')}>{formatBRL(v.remainingCents)}</div><div className="foot">de {formatBRL(p.freeCents)} livres; {formatBRL(v.variableSpentCents)} já gastos{v.perDayCents > 0 ? `; ${formatBRL(v.perDayCents)} por dia até o fim do mês` : ''}</div></div>
          </div>
        </div>
      ) : <div className="card"><Empty title="Informe seu salário" text="Com o valor e o dia do pagamento, o app separa as despesas fixas e sugere quanto guardar e investir." /></div>}

      <div className="section">Compromissos fixos do mês</div>
      <div className="card" style={{ padding: '4px 14px' }}>
        {v.fixedItems.length === 0 ? <Empty title="Sem despesas fixas" text="Lance despesas fixas, assinaturas e parcelas em Movimentações." /> : v.fixedItems.map((f, i) => (<div className="row" key={i}><div className="mid"><div className="t">{f.description}</div></div><div className="end"><span className="num">{formatBRL(f.amountCents)}</span> <span className={'badge ' + (f.status === 'paid' ? 'good' : 'warn')}>{f.status === 'paid' ? 'paga' : 'a pagar'}</span></div></div>))}
      </div>
    </>
  );
}

const GOAL_ICONS: [string, string][] = [['ShieldCheck', 'Reserva de emergência'], ['Car', 'Veículo'], ['Plane', 'Viagem'], ['Home', 'Imóvel'], ['Sunrise', 'Independência financeira'], ['Star', 'Objetivo pessoal'], ['PiggyBank', 'Futuro']];

function Reservas() {
  const data = useStore((s) => s.data);
  const today = useStore((s) => s.today);
  const [edit, setEdit] = useState<Goal | 'new' | null>(null);
  const [move, setMove] = useState<Goal | null>(null);
  const total = data.goalMoves.reduce((s, m) => s + m.amountCents, 0);
  return (
    <>
      <div className="tile" style={{ marginBottom: 12 }}><div className="lbl">Total guardado</div><div className="val num" style={{ fontSize: 24 }}>{formatBRL(total)}</div></div>
      {data.goals.length === 0 && <div className="card"><Empty title="Crie seu primeiro objetivo" text="Reserva de emergência, veículo, viagem ou o que fizer sentido para você." action="Novo objetivo" onAction={() => setEdit('new')} /></div>}
      {data.goals.map((g) => {
        const p = goalProgress(g, data.goalMoves, today);
        return (
          <div className="card" key={g.id}>
            <div className="cardhead">
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><div className="row" style={{ border: 0, padding: 0, minHeight: 0, width: 'auto' }}><div className="ic"><Ico name={g.icon} size={18} /></div></div><div><h2>{g.name}</h2><div className="hint">{formatBRL(p.accumulatedCents)} de {formatBRL(g.targetCents)}</div></div></div>
              <button className="link" onClick={() => setEdit(g)}>Editar</button>
            </div>
            <Progress pct={p.pct} tone={p.status === 'concluida' ? 'done' : undefined} />
            <div className="kv" style={{ marginTop: 8 }}><span>Alcançado</span><b className="num">{formatPct(Math.min(p.pct, 999))}</b></div>
            <div className="kv"><span>Previsão</span><b>{p.status === 'concluida' ? 'Meta alcançada' : p.etaDate ? `${formatDateBR(p.etaDate)} (${p.etaMonths} ${p.etaMonths === 1 ? 'mês' : 'meses'})` : 'Defina um aporte mensal'}</b></div>
            {p.basis !== 'nenhum' && p.status !== 'concluida' && <div className="hint">Considerando {formatBRL(p.monthlyCents)} por mês ({p.basis === 'plano' ? 'aporte planejado' : 'média dos últimos 90 dias'}).{p.status === 'atrasada' && p.requiredMonthlyCents ? ` Para cumprir o prazo de ${formatDateBR(g.deadline!)}: ${formatBRL(p.requiredMonthlyCents)} por mês.` : ''}</div>}
            <div className="btnrow"><button className="btn sm" style={{ flex: 1 }} onClick={() => setMove(g)}>Depositar ou retirar</button></div>
          </div>
        );
      })}
      <button className="fab" onClick={() => setEdit('new')} aria-label="Novo objetivo"><Plus size={26} /></button>
      {edit && <GoalForm g={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {move && <MoveForm g={move} onClose={() => setMove(null)} />}
    </>
  );
}

function GoalForm({ g, onClose }: { g: Goal | null; onClose: () => void }) {
  const today = useStore((s) => s.today);
  const [name, setName] = useState(g?.name ?? '');
  const [icon, setIcon] = useState(g?.icon ?? 'ShieldCheck');
  const [target, setTarget] = useState(g ? centsToInput(g.targetCents) : '');
  const [monthly, setMonthly] = useState(g?.monthlyPlanCents ? centsToInput(g.monthlyPlanCents) : '');
  const [deadline, setDeadline] = useState(g?.deadline ?? '');
  const [initial, setInitial] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    const t = parseMoney(target);
    if (!name.trim()) return setErr('Dê um nome ao objetivo.');
    if (!t || t <= 0) return setErr('Informe o valor da meta.');
    const goal: Goal = { id: g?.id ?? uid('g_'), name: name.trim(), icon, targetCents: t, monthlyPlanCents: parseMoney(monthly) ?? undefined, deadline: deadline || undefined, createdAt: g?.createdAt ?? Date.now() };
    await upsert('goals', goal);
    const ini = parseMoney(initial);
    if (!g && ini && ini > 0) await moveGoal(goal, ini, today, undefined, 'Saldo inicial');
    toast('Objetivo salvo');
    onClose();
  };
  return (
    <Sheet title={g ? 'Editar objetivo' : 'Novo objetivo'} onClose={onClose}>
      <Field label="Tipo"><select value={icon} onChange={(e) => { setIcon(e.target.value); if (!name) setName(GOAL_ICONS.find((i) => i[0] === e.target.value)![1]); }}>{GOAL_ICONS.map(([i, l]) => (<option key={i} value={i}>{l}</option>))}</select></Field>
      <Field label="Nome"><input name="objetivo" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Reserva de emergência" /></Field>
      <div className="two">
        <Field label="Meta (R$)"><MoneyInput name="meta" value={target} onChange={setTarget} /></Field>
        <Field label="Aporte mensal planejado"><MoneyInput value={monthly} onChange={setMonthly} /></Field>
        <Field label="Prazo (opcional)"><input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></Field>
        {!g && <Field label="Já tenho guardado"><MoneyInput name="inicial" value={initial} onChange={setInitial} /></Field>}
      </div>
      {err && <div className="neg" role="alert">{err}</div>}
      <div className="btnrow"><button className="btn" onClick={save}>Salvar</button>{g && <button className="btn danger" onClick={async () => { await deleteGoal(g.id); toast('Objetivo excluído'); onClose(); }}>Excluir</button>}</div>
    </Sheet>
  );
}

function MoveForm({ g, onClose }: { g: Goal; onClose: () => void }) {
  const data = useStore((s) => s.data);
  const today = useStore((s) => s.today);
  const [dir, setDir] = useState<'dep' | 'ret'>('dep');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [accountId, setAccountId] = useState(defaultAccountId() ?? '');
  const [err, setErr] = useState<string | null>(null);
  const moves = data.goalMoves.filter((m) => m.goalId === g.id).sort((a, b) => b.date.localeCompare(a.date));
  const save = async () => {
    const c = parseMoney(amount);
    if (!c || c <= 0) return setErr('Informe o valor.');
    const e = await moveGoal(g, dir === 'dep' ? c : -c, date, accountId || undefined);
    if (e) return setErr(e);
    toast(dir === 'dep' ? 'Depósito registrado' : 'Retirada registrada');
    onClose();
  };
  return (
    <Sheet title={g.name} onClose={onClose}>
      <Seg value={dir} onChange={setDir} options={[['dep', 'Depositar'], ['ret', 'Retirar']]} />
      <div className="two">
        <Field label="Valor (R$)"><MoneyInput name="valor_reserva" value={amount} onChange={setAmount} /></Field>
        <Field label="Data"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <Field label={dir === 'dep' ? 'Sai de qual conta?' : 'Volta para qual conta?'}><select value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">Não mexer em nenhuma conta</option>{data.accounts.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}</select></Field>
      {err && <div className="neg" role="alert">{err}</div>}
      <div className="btnrow"><button className="btn" onClick={save}>Confirmar</button></div>
      {moves.length > 0 && <div className="section">Histórico</div>}
      {moves.map((m) => (<div className="kv" key={m.id}><span>{formatDateBR(m.date)} {m.note ?? ''}</span><b className={'num ' + (m.amountCents >= 0 ? 'pos' : 'neg')}>{m.amountCents >= 0 ? '+' : '−'}{formatBRL(Math.abs(m.amountCents))} <button className="link" onClick={() => remove('goalMoves', m.id)}>×</button></b></div>))}
    </Sheet>
  );
}

function Orcamento() {
  const data = useStore((s) => s.data);
  const settings = useStore((s) => s.settings);
  const today = useStore((s) => s.today);
  const cur = useMemo(() => monthSummary(data, monthOf(today)), [data, today]);
  const st = budgetStatuses(settings.budgets, cur);
  const [edit, setEdit] = useState<string | null>(null);
  const [val, setVal] = useState('');
  const cats = data.categories.filter((c) => c.type === 'expense');
  const totalLimit = st.reduce((s, b) => s + b.limitCents, 0);
  return (
    <>
      {totalLimit > 0 && <div className="card"><div className="kv"><span>Planejado no mês</span><b className="num">{formatBRL(totalLimit)}</b></div><div className="kv"><span>Gasto nas categorias com limite</span><b className="num">{formatBRL(st.reduce((s, b) => s + b.spentCents, 0))}</b></div></div>}
      <div className="card" style={{ padding: '4px 14px' }}>
        {cats.map((c) => {
          const b = st.find((x) => x.categoryId === c.id);
          const spent = cur.byCategory[c.id] ?? 0;
          return (
            <button className="row" key={c.id} onClick={() => { setEdit(c.id); setVal(b ? centsToInput(b.limitCents) : ''); }} style={{ flexWrap: 'wrap' }}>
              <div className="ic"><Ico name={c.icon} size={18} /></div>
              <div className="mid"><div className="t">{c.name}</div><div className="s">{b ? `${formatBRL(spent)} de ${formatBRL(b.limitCents)}` : spent > 0 ? `${formatBRL(spent)} gastos · sem limite` : 'Toque para definir um limite'}</div></div>
              {b && <span className={'badge ' + (b.pct >= 100 ? 'bad' : b.pct >= 80 ? 'warn' : 'good')}>{Math.round(b.pct)}%</span>}
              {b && <div style={{ width: '100%', paddingLeft: 50 }}><Progress pct={b.pct} tone={b.pct >= 100 ? 'over' : undefined} /></div>}
            </button>
          );
        })}
      </div>
      <Note>Quando uma categoria passa do limite, o app avisa por notificação (uma vez por mês e por categoria).</Note>
      {edit && (
        <Sheet title={`Limite mensal: ${cats.find((c) => c.id === edit)?.name}`} onClose={() => setEdit(null)}>
          <Field label="Limite por mês (R$)" hint="Deixe vazio para remover o limite"><MoneyInput name="limite" value={val} onChange={setVal} /></Field>
          <div className="btnrow"><button className="btn" onClick={async () => { const b = { ...settings.budgets }; const c = parseMoney(val); if (c && c > 0) b[edit] = c; else delete b[edit]; await updateSettings({ budgets: b }); toast('Orçamento salvo'); setEdit(null); }}>Salvar</button></div>
        </Sheet>
      )}
    </>
  );
}

const DEBT_LABEL: Record<DebtKind, string> = { emprestimo: 'Empréstimo pessoal', financiamento: 'Financiamento', cartao: 'Cartão de crédito', cheque_especial: 'Cheque especial', parcelamento: 'Parcelamento', consignado: 'Consignado', outro: 'Outra obrigação' };

function Dividas() {
  const data = useStore((s) => s.data);
  const [edit, setEdit] = useState<Debt | 'new' | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [extra, setExtra] = useState('300');
  const t = debtTotals(data.debts);
  const ex = parseMoney(extra) ?? 0;
  const av = useMemo(() => simulateStrategy(data.debts, ex, 'avalanche'), [data.debts, ex]);
  const sn = useMemo(() => simulateStrategy(data.debts, ex, 'snowball'), [data.debts, ex]);
  const d = detail ? data.debts.find((x) => x.id === detail) : null;
  const fmtM = (m: number) => (m === Infinity ? 'não quita' : `${m} ${m === 1 ? 'mês' : 'meses'}`);
  return (
    <>
      <div className="grid2">
        <div className="tile"><div className="lbl">Saldo devedor total</div><div className="val num">{formatBRL(t.balanceCents)}</div></div>
        <div className="tile"><div className="lbl">Parcelas por mês</div><div className="val num">{formatBRL(t.monthlyCents)}</div><div className="foot">≈ {formatBRL(t.monthlyInterestCents)} são juros</div></div>
      </div>
      {data.debts.length === 0 ? <div className="card"><Empty title="Nenhuma dívida cadastrada" text="Cadastre empréstimos, financiamentos, cartões e parcelamentos para simular quitação e comparar juros." action="Cadastrar dívida" onAction={() => setEdit('new')} /></div> : (
        <>
          <div className="section">Prioridade de quitação (maior juro primeiro)</div>
          <div className="card" style={{ padding: '4px 14px' }}>
            {t.priority.map((x, i) => (
              <button className="row" key={x.id} onClick={() => setDetail(x.id)}>
                <div className="ic num" style={{ color: 'var(--text)', fontWeight: 650 }}>{i + 1}</div>
                <div className="mid"><div className="t">{x.name}</div><div className="s">{DEBT_LABEL[x.kind]}{x.institution ? ' · ' + x.institution : ''} · {x.remainingInstallments}× {formatBRL(x.installmentCents)}</div></div>
                <div className="end"><div className="num">{formatBRL(x.balanceCents)}</div><span className={'badge ' + (x.monthlyRatePct >= 4 ? 'bad' : x.monthlyRatePct >= 2 ? 'warn' : '')}>{formatPct(x.monthlyRatePct)} a.m.</span></div>
              </button>
            ))}
          </div>
          {t.priority[0] && t.priority[0].monthlyRatePct >= 4 && <div className="alert warn"><TriangleAlert size={20} /><div><div className="t">Juros elevados em "{t.priority[0].name}"</div><div className="s">{formatPct(t.priority[0].monthlyRatePct)} ao mês equivale a {formatPct(annualFromMonthly(t.priority[0].monthlyRatePct))} ao ano. Vale simular portabilidade ou renegociação, sempre conferindo o CET da proposta.</div></div></div>}
          <div className="card">
            <h2>Comparar estratégias</h2>
            <Field label="Valor extra por mês (R$)"><MoneyInput value={extra} onChange={setExtra} /></Field>
            <table className="tbl"><thead><tr><th>Estratégia</th><th>Prazo</th><th>Juros pagos</th></tr></thead><tbody>
              <tr><td>Avalanche (maior juro primeiro)</td><td>{fmtM(av.months)}</td><td className="num">{av.months === Infinity ? '—' : formatBRL(av.interestCents)}</td></tr>
              <tr><td>Bola de neve (menor saldo primeiro)</td><td>{fmtM(sn.months)}</td><td className="num">{sn.months === Infinity ? '—' : formatBRL(sn.interestCents)}</td></tr>
            </tbody></table>
            <Note>{av.months === Infinity ? 'Com as parcelas atuais, pelo menos uma dívida não é quitada: a parcela não cobre os juros.' : av.interestCents < sn.interestCents ? `A avalanche economiza ${formatBRL(sn.interestCents - av.interestCents)} em juros. A bola de neve quita a primeira dívida mais cedo, o que ajuda na motivação.` : 'As duas estratégias dão o mesmo resultado para as suas dívidas.'} Simulação com juros compostos mensais sobre o saldo informado; contratos reais podem ter seguros e tarifas.</Note>
          </div>
        </>
      )}
      <button className="fab" onClick={() => setEdit('new')} aria-label="Cadastrar dívida"><Plus size={26} /></button>
      {edit && <DebtForm d={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {d && <DebtDetail d={d} onClose={() => setDetail(null)} onEdit={() => { setDetail(null); setEdit(d); }} />}
    </>
  );
}

function DebtForm({ d, onClose }: { d: Debt | null; onClose: () => void }) {
  const [v, setV] = useState({ kind: d?.kind ?? 'emprestimo', name: d?.name ?? '', inst: d?.institution ?? '', orig: d ? centsToInput(d.originalCents) : '', bal: d ? centsToInput(d.balanceCents) : '', inst$: d ? centsToInput(d.installmentCents) : '', n: d ? String(d.remainingInstallments) : '', rate: d ? String(d.monthlyRatePct).replace('.', ',') : '', cet: d?.cetPct ? String(d.cetPct).replace('.', ',') : '', due: d ? String(d.dueDay) : '10', end: d?.endDate ?? '' });
  const [err, setErr] = useState<string | null>(null);
  const up = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const save = async () => {
    const inst = parseMoney(v.inst$) ?? 0;
    const n = Math.round(Number(v.n) || 0);
    const rate = parseDecimal(v.rate) ?? 0;
    let bal = parseMoney(v.bal);
    if (!v.name.trim()) return setErr('Dê um nome à dívida.');
    if (rate < 0 || rate > 30) return setErr('Informe os juros ao mês (0 a 30%).');
    if ((bal === null || bal <= 0) && inst > 0 && n > 0) bal = presentValue(inst, rate, n);
    if (!bal || bal <= 0) return setErr('Informe o saldo devedor, ou a parcela e o número de parcelas para o app estimar.');
    await upsert('debts', { id: d?.id ?? uid('db_'), kind: v.kind as DebtKind, name: v.name.trim(), institution: v.inst.trim(), originalCents: parseMoney(v.orig) ?? bal, balanceCents: bal, installmentCents: inst, remainingInstallments: n, monthlyRatePct: rate, cetPct: parseDecimal(v.cet) ?? undefined, dueDay: Math.min(Math.max(Number(v.due) || 1, 1), 31), endDate: v.end || undefined, createdAt: d?.createdAt ?? Date.now() });
    toast('Dívida salva');
    onClose();
  };
  return (
    <Sheet title={d ? 'Editar dívida' : 'Nova dívida'} onClose={onClose}>
      <div className="two">
        <Field label="Tipo"><select value={v.kind} onChange={up('kind')}>{Object.entries(DEBT_LABEL).map(([k, l]) => (<option key={k} value={k}>{l}</option>))}</select></Field>
        <Field label="Nome"><input name="divida" value={v.name} onChange={up('name')} placeholder="Empréstimo do carro" /></Field>
        <Field label="Instituição"><input value={v.inst} onChange={up('inst')} /></Field>
        <Field label="Valor original (R$)"><MoneyInput value={v.orig} onChange={(x) => setV({ ...v, orig: x })} /></Field>
        <Field label="Saldo devedor atual (R$)" hint="Vazio: estimo pelas parcelas"><MoneyInput name="saldo_devedor" value={v.bal} onChange={(x) => setV({ ...v, bal: x })} /></Field>
        <Field label="Valor da parcela (R$)"><MoneyInput name="parcela" value={v.inst$} onChange={(x) => setV({ ...v, inst$: x })} /></Field>
        <Field label="Parcelas restantes"><input name="parcelas" inputMode="numeric" value={v.n} onChange={up('n')} /></Field>
        <Field label="Juros ao mês (%)"><input name="juros" inputMode="decimal" value={v.rate} onChange={up('rate')} /></Field>
        <Field label="CET ao ano (%)" hint="Está no contrato"><input inputMode="decimal" value={v.cet} onChange={up('cet')} /></Field>
        <Field label="Dia do vencimento"><input inputMode="numeric" value={v.due} onChange={up('due')} /></Field>
      </div>
      <Field label="Data de encerramento (opcional)"><input type="date" value={v.end} onChange={up('end')} /></Field>
      {err && <div className="neg" role="alert">{err}</div>}
      <div className="btnrow"><button className="btn" onClick={save}>Salvar</button>{d && <button className="btn danger" onClick={async () => { await remove('debts', d.id); toast('Dívida removida'); onClose(); }}>Excluir</button>}</div>
    </Sheet>
  );
}

function DebtDetail({ d, onClose, onEdit }: { d: Debt; onClose: () => void; onEdit: () => void }) {
  const today = useStore((s) => s.today);
  const [extra, setExtra] = useState('300');
  const [lastN, setLastN] = useState('3');
  const [nr, setNr] = useState('');
  const [nm, setNm] = useState(String(d.remainingInstallments || 12));
  const [fee, setFee] = useState('');
  const ex = simulateExtra(d, parseMoney(extra) ?? 0);
  const an = simulateAnticipation(d, Math.round(Number(lastN) || 0));
  const newRate = parseDecimal(nr);
  const rf = newRate !== null && Number(nm) > 0 ? simulateRefinance(d, newRate, Math.round(Number(nm)), parseMoney(fee) ?? 0) : null;
  const fmtM = (m: number) => (m === Infinity ? 'nunca (parcela não cobre os juros)' : `${m} ${m === 1 ? 'mês' : 'meses'}`);
  const pay = async () => {
    const interest = Math.min(Math.round((d.balanceCents * d.monthlyRatePct) / 100), d.installmentCents);
    const principal = Math.min(d.installmentCents - interest, d.balanceCents);
    const base = { type: 'expense' as const, kind: 'fixa' as const, date: today, paymentMethod: 'boleto' as const, accountId: defaultAccountId(), status: 'paid' as const, paidDate: today, createdAt: Date.now() };
    if (principal > 0) await saveTransaction({ ...base, id: uid('t_'), description: `Parcela ${d.name} (amortização)`, amountCents: principal, categoryId: 'dividas' });
    if (interest > 0) await saveTransaction({ ...base, id: uid('t_'), description: `Parcela ${d.name} (juros)`, amountCents: interest, categoryId: 'juros', createdAt: Date.now() + 1 });
    await upsert('debts', { ...d, balanceCents: Math.max(d.balanceCents - principal, 0), remainingInstallments: Math.max(d.remainingInstallments - 1, 0) });
    toast('Parcela registrada e saldo atualizado');
  };
  return (
    <Full title={d.name} onBack={onClose} action={<button className="btn sm" onClick={onEdit}>Editar</button>}>
      <div className="card">
        <div className="kv"><span>Instituição</span><b>{d.institution || '—'}</b></div>
        <div className="kv"><span>Valor original</span><b className="num">{formatBRL(d.originalCents)}</b></div>
        <div className="kv"><span>Saldo devedor atual</span><b className="num">{formatBRL(d.balanceCents)}</b></div>
        <div className="kv"><span>Parcelas restantes</span><b className="num">{d.remainingInstallments} × {formatBRL(d.installmentCents)}</b></div>
        <div className="kv"><span>Juros</span><b className="num">{formatPct(d.monthlyRatePct)} a.m. ({formatPct(annualFromMonthly(d.monthlyRatePct))} a.a.)</b></div>
        <div className="kv"><span>CET</span><b className="num">{d.cetPct ? formatPct(d.cetPct) + ' a.a.' : 'não informado'}</b></div>
        <div className="kv"><span>Vencimento</span><b>todo dia {d.dueDay}{d.endDate ? ` · até ${formatDateBR(d.endDate)}` : ''}</b></div>
        {d.installmentCents > 0 && d.balanceCents > 0 && <div className="btnrow"><button className="btn ghost" onClick={pay}>Registrar pagamento de uma parcela</button></div>}
      </div>
      <div className="card">
        <h2>Se eu pagar um valor extra por mês</h2>
        <Field label="Extra mensal (R$)"><MoneyInput value={extra} onChange={setExtra} /></Field>
        <div className="kv"><span>Prazo sem extra</span><b>{fmtM(ex.base.months)}</b></div>
        <div className="kv"><span>Prazo com extra</span><b>{fmtM(ex.withExtra.months)}</b></div>
        {ex.base.months !== Infinity && <><div className="kv"><span>Prazo reduzido</span><b className="pos">{ex.monthsSaved} {ex.monthsSaved === 1 ? 'mês' : 'meses'}</b></div><div className="kv"><span>Juros economizados</span><b className="num pos">{formatBRL(ex.interestSavedCents)}</b></div></>}
        <Note>Risco: o extra sai do seu caixa. Mantenha a reserva de emergência antes de acelerar a quitação.</Note>
      </div>
      <div className="card">
        <h2>Se eu antecipar as últimas parcelas</h2>
        <Field label="Quantas parcelas (do fim do contrato)"><input inputMode="numeric" value={lastN} onChange={(e) => setLastN(e.target.value.replace(/\D/g, ''))} /></Field>
        <div className="kv"><span>Valor nominal das parcelas</span><b className="num">{formatBRL(an.nominalCents)}</b></div>
        <div className="kv"><span>Valor a pagar hoje (estimado)</span><b className="num">{formatBRL(an.payNowCents)}</b></div>
        <div className="kv"><span>Economia</span><b className="num pos">{formatBRL(an.savedCents)}</b></div>
        <Note>Desconto calculado pela taxa informada. O valor exato vem do banco, que é obrigado a reduzir os juros proporcionalmente na antecipação.</Note>
      </div>
      <div className="card">
        <h2>Vale a pena trocar por outro empréstimo?</h2>
        <div className="two">
          <Field label="Nova taxa ao mês (%)"><input name="nova_taxa" inputMode="decimal" value={nr} onChange={(e) => setNr(e.target.value)} /></Field>
          <Field label="Novo prazo (meses)"><input inputMode="numeric" value={nm} onChange={(e) => setNm(e.target.value.replace(/\D/g, ''))} /></Field>
        </div>
        <Field label="Tarifas e custos da troca (R$)"><MoneyInput value={fee} onChange={setFee} /></Field>
        {rf ? (<>
          <div className="kv"><span>Custo restante do contrato atual</span><b className="num">{formatBRL(rf.currentTotalCents)}</b></div>
          <div className="kv"><span>Nova parcela</span><b className="num">{formatBRL(rf.newPaymentCents)} ({rf.paymentDiffCents >= 0 ? '+' : '−'}{formatBRL(Math.abs(rf.paymentDiffCents))})</b></div>
          <div className="kv"><span>Custo total da nova proposta</span><b className="num">{formatBRL(rf.newTotalCents)}</b></div>
          <div className="kv"><span>{rf.savedCents >= 0 ? 'Economia total' : 'Custo a mais'}</span><b className={'num ' + (rf.savedCents >= 0 ? 'pos' : 'neg')}>{formatBRL(Math.abs(rf.savedCents))}</b></div>
          <Note>{rf.savedCents > 0 ? 'No custo total a troca compensa.' : 'No custo total a troca não compensa.'}{rf.paymentDiffCents < 0 && rf.savedCents <= 0 ? ' A parcela cai, mas o prazo maior faz você pagar mais juros no total.' : ''} Compare sempre o CET das duas propostas e confirme que a nova parcela cabe no orçamento.</Note>
        </>) : <Note>Informe a taxa da nova proposta para comparar.</Note>}
      </div>
    </Full>
  );
}

function Liberdade() {
  const data = useStore((s) => s.data);
  const settings = useStore((s) => s.settings);
  const today = useStore((s) => s.today);
  const f = useMemo(() => financialFreedom(data, settings, today), [data, settings, today]);
  const plan = spendableView(data, settings, monthOf(today), today).plan;
  const monthly = plan.saveCents + plan.investCents;
  const g = simulateGrowth(Math.max(f.netWorthCents, 0), monthly, settings.freedom.yieldPct, 240);
  const hit = f.requiredCents ? g.find((x) => x.valueCents >= f.requiredCents!) : undefined;
  const pal = seriesColors();
  return (
    <>
      <div className="grid2">
        <div className="tile"><div className="lbl">Patrimônio líquido</div><div className="val num">{formatBRL(f.netWorthCents)}</div></div>
        <div className="tile"><div className="lbl">Renda passiva mensal</div><div className="val num">{formatBRL(f.passiveMonthlyCents)}</div><div className="foot">média de proventos em 12 meses</div></div>
        <div className="tile"><div className="lbl">Despesas mensais</div><div className="val num">{formatBRL(f.expensesMonthlyCents)}</div><div className="foot">média recente</div></div>
        <div className="tile"><div className="lbl">Despesas cobertas</div><div className="val num">{formatPct(f.coveragePct)}</div><div className="foot">pela renda passiva</div></div>
      </div>
      <div className="card">
        <h2>Meta de independência financeira</h2>
        <Field label={`Rendimento anual que você assume: ${settings.freedom.yieldPct}%`} hint="É uma premissa sua, não uma previsão do app."><input type="range" min={2} max={12} step={0.5} value={settings.freedom.yieldPct} onChange={(e) => updateSettings({ freedom: { yieldPct: Number(e.target.value) } })} style={{ padding: 0, minHeight: 32, accentColor: 'var(--gold)' }} /></Field>
        {f.requiredCents ? (<>
          <div className="kv"><span>Patrimônio necessário</span><b className="num">{formatBRL(f.requiredCents)}</b></div>
          <Progress pct={f.progressPct ?? 0} />
          <div className="hint" style={{ marginTop: 6 }}>{formatPct(f.progressPct ?? 0)} do caminho. Conta: despesas de um ano ÷ rendimento assumido.</div>
        </>) : <Empty title="Faltam dados" text="Registre suas despesas por pelo menos um mês para calcular a meta." />}
      </div>
      {f.requiredCents && (
        <div className="card">
          <h2>Projeção em 20 anos</h2>
          <div className="hint" style={{ marginBottom: 8 }}>Aportando {formatBRL(monthly)} por mês (guardar + investir do seu plano).</div>
          <ChartBox kind="line" small labels={g.map((x) => (x.month % 24 === 0 ? `${x.month / 12}a` : ''))} series={[{ label: 'Patrimônio projetado', data: g.map((x) => x.valueCents), fill: true }, { label: 'Meta', data: g.map(() => f.requiredCents!), color: pal[3], dashed: true }]} />
          <Legend items={[{ label: 'Patrimônio projetado', color: pal[0] }, { label: 'Meta', color: pal[3], dashed: true }]} />
          <Note>{hit ? `Nesse cenário a meta seria atingida em cerca de ${Math.ceil(hit.month / 12)} anos.` : 'Nesse cenário a meta não é atingida em 20 anos.'} Projeção com taxa constante e sem inflação: serve para comparar cenários, não é promessa de rentabilidade.</Note>
        </div>
      )}
    </>
  );
}

function Relatorios() {
  const data = useStore((s) => s.data);
  const today = useStore((s) => s.today);
  const [ym, setYm] = useState(monthOf(today));
  const c = useMemo(() => monthlyClosing(data, ym, today), [data, ym, today]);
  const run = async (f: () => Promise<unknown>, ok: string) => { try { await f(); toast(ok); } catch (e) { toast('Não foi possível gerar o arquivo: ' + (e instanceof Error ? e.message : 'erro'), 'err'); } };
  return (
    <>
      <MonthNav ym={ym} onChange={setYm} />
      <div className="card">
        <h2>Fechamento de {monthLong(ym)}</h2>
        <div className="kv" style={{ marginTop: 8 }}><span>Total recebido</span><b className="num">{formatBRL(c.receivedCents)}</b></div>
        <div className="kv"><span>Total gasto</span><b className="num">{formatBRL(c.spentCents)}</b></div>
        <div className="kv"><span>Total economizado</span><b className={'num ' + (c.savedCents < 0 ? 'neg' : 'pos')}>{formatBRL(c.savedCents)}</b></div>
        <div className="kv"><span>Guardado em reservas</span><b className="num">{formatBRL(c.reservedCents)}</b></div>
        <div className="kv"><span>Total investido</span><b className="num">{formatBRL(c.investedCents)}</b></div>
        <div className="kv"><span>Proventos recebidos</span><b className="num">{formatBRL(c.dividendsCents)}</b></div>
        <div className="kv"><span>Juros pagos</span><b className="num">{formatBRL(c.interestPaidCents)}</b></div>
        <div className="kv"><span>Dívidas restantes</span><b className="num">{formatBRL(c.debtRemainingCents)}</b></div>
        <div className="kv"><span>Variação patrimonial</span><b className={'num ' + (c.netWorthChangeCents < 0 ? 'neg' : 'pos')}>{formatBRL(c.netWorthChangeCents)}</b></div>
        <div className="kv"><span>Resultado do período</span><b className={'num ' + (c.resultCents < 0 ? 'neg' : 'pos')}>{formatBRL(c.resultCents)}</b></div>
      </div>
      <button className="btn" style={{ marginBottom: 10 }} onClick={() => run(() => exportClosingPdf(data, ym, today), 'PDF gerado')}><FileText size={18} /> Relatório mensal em PDF</button>
      <button className="btn ghost" style={{ marginBottom: 10 }} onClick={() => run(() => exportClosingPdf(data, ym, today, true), 'PDF gerado')}><FileText size={18} /> Relatório anual em PDF (12 meses)</button>
      <button className="btn ghost" onClick={() => run(() => saveAndShare(`grefinacia-movimentacoes-${ym}.csv`, transactionsToCSV(data.transactions, (id) => data.categories.find((x) => x.id === id)?.name ?? id, (id) => data.accounts.find((a) => a.id === id)?.name ?? ''), 'text/csv'), 'Planilha gerada')}><SheetIco size={18} /> Planilha (CSV) de todas as movimentações</button>
      <Note>Juros pagos somam as despesas na categoria "Juros e encargos" (o botão "Registrar pagamento de parcela" das dívidas já separa os juros). Este fechamento é uma ferramenta de organização pessoal e não substitui um contador habilitado.</Note>
    </>
  );
}
