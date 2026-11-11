import { useEffect, useRef, type ReactNode } from 'react';
import { Chart, LineController, BarController, DoughnutController, LineElement, PointElement, BarElement, ArcElement, CategoryScale, LinearScale, Tooltip, Filler, type ChartConfiguration } from 'chart.js';
import * as L from 'lucide-react';
import { formatBRL, formatCompact, formatPct } from '../lib/money';
import { addMonthsYM, capFirst, monthLong } from '../lib/dates';
import { useStore } from '../state/store';

Chart.register(LineController, BarController, DoughnutController, LineElement, PointElement, BarElement, ArcElement, CategoryScale, LinearScale, Tooltip, Filler);

const ICONS = L as unknown as Record<string, L.LucideIcon>;
export function Ico({ name, size = 20 }: { name: string; size?: number }) {
  const C = ICONS[name] ?? L.Circle;
  return <C size={size} strokeWidth={1.8} aria-hidden />;
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Fechar"><L.X size={18} /></button>
        </header>
        <div className="body">{children}</div>
      </div>
    </div>
  );
}

export function Full({ title, onBack, children, action }: { title: string; onBack: () => void; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="full" role="dialog" aria-label={title}>
      <div className="screen">
        <div className="head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="iconbtn" onClick={onBack} aria-label="Voltar"><L.ArrowLeft size={18} /></button>
            <h1 style={{ fontSize: 20 }}>{title}</h1>
          </div>
          {action}
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, error, hint }: { label: string; children: ReactNode; error?: string | null; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
      {error && <div className="err">{error}</div>}
    </label>
  );
}
export function MoneyInput({ value, onChange, placeholder = '0,00', name }: { value: string; onChange: (v: string) => void; placeholder?: string; name?: string }) {
  return <input name={name} inputMode="decimal" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value.replace(/[^0-9.,-]/g, ''))} />;
}
export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="tog" onClick={() => onChange(!on)} />;
}
export function SwitchRow({ title, sub, on, onChange }: { title: string; sub?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="switch">
      <div><div>{title}</div>{sub && <div className="s">{sub}</div>}</div>
      <Toggle on={on} onChange={onChange} label={title} />
    </div>
  );
}
export function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="seg" role="group">
      {options.map(([v, l]) => (<button key={v} aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>))}
    </div>
  );
}
export function MonthNav({ ym, onChange }: { ym: string; onChange: (ym: string) => void }) {
  return (
    <div className="monthnav">
      <button className="iconbtn" onClick={() => onChange(addMonthsYM(ym, -1))} aria-label="Mês anterior"><L.ChevronLeft size={18} /></button>
      <b>{capFirst(monthLong(ym))}</b>
      <button className="iconbtn" onClick={() => onChange(addMonthsYM(ym, 1))} aria-label="Próximo mês"><L.ChevronRight size={18} /></button>
    </div>
  );
}
export function Progress({ pct, tone }: { pct: number; tone?: 'over' | 'done' }) {
  return <div className={'bar ' + (tone ?? '')} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: Math.min(Math.max(pct, 0), 100) + '%' }} /></div>;
}
/** Variação com seta e cor; `goodWhenUp=false` para despesas. */
export function Delta({ pct, goodWhenUp = true, suffix }: { pct: number | null; goodWhenUp?: boolean; suffix?: string }) {
  if (pct === null) return <span className="delta flat">sem base de comparação</span>;
  const flat = Math.abs(pct) < 0.05;
  const up = pct > 0;
  const good = flat ? null : up === goodWhenUp;
  return (
    <span className={'delta ' + (good === null ? 'flat' : good ? 'up' : 'down')}>
      {flat ? <L.Minus size={13} /> : up ? <L.ArrowUpRight size={13} /> : <L.ArrowDownRight size={13} />}
      {formatPct(Math.abs(pct))}{suffix ? ' ' + suffix : ''}
    </span>
  );
}
export function Empty({ title, text, action, onAction }: { title: string; text: string; action?: string; onAction?: () => void }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {text}
      {action && <div><button className="btn" onClick={onAction}>{action}</button></div>}
    </div>
  );
}
export function Note({ children }: { children: ReactNode }) {
  return <div className="note"><L.Info size={14} /><span>{children}</span></div>;
}
export function Money({ cents, sign }: { cents: number; sign?: boolean }) {
  return <span className={'num' + (sign ? (cents > 0 ? ' pos' : cents < 0 ? ' neg' : '') : '')}>{sign && cents > 0 ? '+' : ''}{formatBRL(cents)}</span>;
}
export function Toast() {
  const t = useStore((s) => s.toast);
  return t ? <div className={'toast ' + (t.tone === 'err' ? 'err' : '')} role="status">{t.text}</div> : null;
}

// ---------------- gráficos ----------------
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
export const seriesColors = () => ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8'].map(cssVar);

export type ChartKind = 'line' | 'bar' | 'doughnut';
export interface Series { label: string; data: number[]; color?: string; fill?: boolean; dashed?: boolean }

/** Gráfico interativo (toque para ver valores). Valores em centavos. */
export function ChartBox({ kind, labels, series, small, stacked, colors }: { kind: ChartKind; labels: string[]; series: Series[]; small?: boolean; stacked?: boolean; colors?: string[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const theme = useStore((s) => s.settings.theme);
  useEffect(() => {
    if (!ref.current) return;
    const pal = seriesColors();
    const text = cssVar('--muted');
    const line = cssVar('--line');
    const surface = cssVar('--surface');
    const datasets = series.map((s, i) => {
      const c = s.color ?? pal[i % pal.length];
      if (kind === 'doughnut') return { label: s.label, data: s.data, backgroundColor: colors ?? s.data.map((_, j) => pal[j % pal.length]), borderColor: surface, borderWidth: 2, hoverOffset: 4 };
      if (kind === 'bar') return { label: s.label, data: s.data, backgroundColor: c, borderRadius: 4, maxBarThickness: 22, borderColor: surface, borderWidth: stacked ? 1 : 0 };
      return { label: s.label, data: s.data, borderColor: c, backgroundColor: c + '22', borderWidth: 2, tension: 0.3, pointRadius: s.data.length > 14 ? 0 : 3, pointHoverRadius: 6, pointBackgroundColor: c, pointBorderColor: surface, pointBorderWidth: 2, fill: !!s.fill, borderDash: s.dashed ? [5, 4] : undefined };
    });
    const cfg: ChartConfiguration = {
      type: kind,
      data: { labels, datasets: datasets as never },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 450 },
        interaction: { mode: kind === 'doughnut' ? 'nearest' : 'index', intersect: kind === 'doughnut' },
        plugins: {
          legend: { display: false },
          tooltip: { backgroundColor: cssVar('--surface2'), titleColor: cssVar('--text'), bodyColor: cssVar('--text'), borderColor: line, borderWidth: 1, padding: 10, cornerRadius: 10, boxPadding: 4, callbacks: { label: (ctx: any) => ` ${kind === 'doughnut' ? ctx.label : ctx.dataset.label}: ${formatBRL(Number(ctx.raw))}` } },
        },
        ...(kind === 'doughnut' ? { cutout: '68%' } : { scales: { x: { stacked, grid: { display: false }, ticks: { color: text, font: { size: 11 }, maxRotation: 0, autoSkipPadding: 8 }, border: { color: line } }, y: { stacked, grid: { color: line + '80' }, border: { display: false }, ticks: { color: text, font: { size: 11 }, maxTicksLimit: 5, callback: (v: string | number) => formatCompact(Number(v)) } } } }),
      } as never,
    };
    const chart = new Chart(ref.current, cfg);
    return () => chart.destroy();
  }, [kind, JSON.stringify(labels), JSON.stringify(series), theme, stacked, JSON.stringify(colors)]);
  return <div className={'chartbox' + (small ? ' sm' : '')}><canvas ref={ref} role="img" aria-label={series.map((s) => s.label).join(', ')} /></div>;
}
export function Legend({ items }: { items: { label: string; color: string; value?: string; dashed?: boolean }[] }) {
  return (
    <div className="legend" style={{ marginTop: 10 }}>
      {items.map((i) => (<span key={i.label}><i className="dot" style={{ background: i.dashed ? 'none' : i.color, border: i.dashed ? `1px dashed ${i.color}` : undefined }} />{i.label}{i.value && <> <b className="num">{i.value}</b></>}</span>))}
    </div>
  );
}
