import { useEffect, useMemo, useState } from 'react';
import { CreditCard, Coins, Receipt, ArrowDownLeft } from 'lucide-react';
import { useStore } from '../state/store';
import { monthAgenda, type AgendaItem } from '../domain/home';
import { daysInMonth, formatDayMonth, weekdayOfFirst } from '../lib/dates';
import { formatBRL } from '../lib/money';

const ICON = { entrada: ArrowDownLeft, conta: Receipt, fatura: CreditCard, provento: Coins };

/** Calendário financeiro: o que entra e o que sai em cada dia do mês (contas, faturas, salário e proventos). */
export function Agenda({ ym }: { ym: string }) {
  const data = useStore((s) => s.data);
  const today = useStore((s) => s.today);
  const [day, setDay] = useState<string | null>(today.slice(0, 7) === ym ? today : null);
  useEffect(() => setDay(today.slice(0, 7) === ym ? today : null), [ym, today]);
  const agenda = useMemo(() => monthAgenda(data, ym, today), [data, ym, today]);
  const cells: (number | null)[] = [...Array(weekdayOfFirst(ym)).fill(null), ...Array.from({ length: daysInMonth(ym) }, (_, i) => i + 1)];
  const all = [...agenda.values()].flat();
  const inSum = all.filter((i) => i.kind === 'entrada' || i.kind === 'provento').reduce((s, i) => s + i.cents, 0);
  const outSum = all.filter((i) => i.kind === 'conta' || i.kind === 'fatura').reduce((s, i) => s + i.cents, 0);
  const list: [string, AgendaItem[]][] = day ? (agenda.has(day) ? [[day, agenda.get(day)!]] : []) : [...agenda.entries()];
  return (
    <>
      <div className="card">
        <div className="cal agenda">
          {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => (<div className="wd" key={i}>{d}</div>))}
          {cells.map((d, i) => {
            if (d === null) return <span key={i} />;
            const iso = `${ym}-${String(d).padStart(2, '0')}`;
            const its = agenda.get(iso);
            const ins = its?.some((x) => x.kind === 'entrada' || x.kind === 'provento');
            const outs = its?.some((x) => x.kind === 'conta' || x.kind === 'fatura');
            const cls = [its ? 'has' : '', iso === today ? 'today' : '', iso === day ? 'sel' : ''].join(' ');
            return (
              <button key={i} className={cls} onClick={() => setDay(iso === day ? null : iso)} aria-label={`${d}${its ? `: ${its.length} ${its.length === 1 ? 'item' : 'itens'}` : ''}`} aria-pressed={iso === day}>
                {d}{its && <span className="marks" aria-hidden>{ins && <i className="in" />}{outs && <i className="out" />}</span>}
              </button>
            );
          })}
        </div>
        <div className="kv" style={{ marginTop: 10 }}><span>Entradas no mês</span><b className="num pos">{formatBRL(inSum)}</b></div>
        <div className="kv"><span>Contas e faturas no mês</span><b className="num">{formatBRL(outSum)}</b></div>
      </div>
      {list.length === 0 ? <div className="empty">{day ? 'Nada marcado para este dia.' : 'Nada marcado neste mês.'}</div> : list.map(([d, its]) => (
        <div key={d}>
          <div className="dayhead"><span>{formatDayMonth(d)}{d === today ? ' · hoje' : ''}</span></div>
          <div className="group">
            {its.map((it) => {
              const I = ICON[it.kind];
              const positive = it.kind === 'entrada' || it.kind === 'provento';
              return (
                <div className="row" key={it.id}>
                  <div className={'ic ' + (positive ? 'in' : '')}><I size={18} /></div>
                  <div className="mid"><div className="t">{it.title}</div><div className="s">{it.kind === 'fatura' ? 'fatura do cartão' : it.kind === 'provento' ? 'provento' : it.kind === 'entrada' ? 'entrada' : 'conta'}{it.done ? (positive ? ' · recebido' : ' · pago') : positive ? ' · a receber' : ' · a pagar'}</div></div>
                  <div className="end"><div className={'num ' + (positive ? 'pos' : '')}>{positive ? '+' : '−'}{formatBRL(it.cents)}</div></div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}
