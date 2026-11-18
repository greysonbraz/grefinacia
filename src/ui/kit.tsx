import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { Chart, LineController, BarController, DoughnutController, LineElement, PointElement, BarElement, ArcElement, CategoryScale, LinearScale, Tooltip, Filler, type ChartConfiguration } from 'chart.js';
import * as L from 'lucide-react';
import { formatBRL, formatCompact, formatPct } from '../lib/money';
import { addMonthsYM, capFirst, monthLong } from '../lib/dates';
import { quoteFreshness } from '../domain/market';
import { useStore } from '../state/store';
import { useBackHandler } from './back';
import { tap } from '../services/haptics';

Chart.register(LineController, BarController, DoughnutController, LineElement, PointElement, BarElement, ArcElement, CategoryScale, LinearScale, Tooltip, Filler);

const ICONS = L as unknown as Record<string, L.LucideIcon>;
export function Ico({ name, size = 20 }: { name: string; size?: number }) {
  const C = ICONS[name] ?? L.Circle;
  return <C size={size} strokeWidth={1.8} aria-hidden />;
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useBackHandler(onClose);
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
  useBackHandler(onBack);
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
export function MoneyInput({ value, onChange, placeholder = '0,00', name, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; name?: string; autoFocus?: boolean }) {
  return <input name={name} inputMode="decimal" value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value.replace(/[^0-9.,-]/g, ''))} />;
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
      {options.map(([v, l]) => (<button key={v} aria-pressed={value === v} onClick={() => { if (v !== value) tap(); onChange(v); }}>{l}</button>))}
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
/** Selo da cotação: fonte, horário e há quanto tempo (verde até 1 h; amarelo até 4 dias; vermelho depois). */
export function QuoteStamp({ quote, compact }: { quote?: { time: string; source: string }; compact?: boolean }) {
  if (!quote) return <span className="badge warn">sem cotação</span>;
  const f = quoteFreshness(quote.time);
  const when = new Date(quote.time).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const cls = 'badge ' + (f.tone === 'ok' ? 'good' : f.tone === 'warn' ? 'warn' : 'bad');
  const title = `${quote.source}, cotação de ${when} (${f.age}). Fontes gratuitas têm atraso; não é tempo real.`;
  return compact ? <span className={cls} title={title} aria-label={title}>{f.age}</span> : <span className={cls} title={title}>{quote.source} · {when} · {f.age}</span>;
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
export interface Series { label: string; data: (number | null)[]; color?: string; fill?: boolean; dashed?: boolean }

/** Gráfico interativo (toque para ver valores). Valores em centavos, ou em % com `format="pct"`. */
export function ChartBox({ kind, labels, series, small, stacked, colors, format = 'brl', minimal, onPick }: { kind: ChartKind; labels: string[]; series: Series[]; small?: boolean; stacked?: boolean; colors?: string[]; format?: 'brl' | 'pct' | 'rate'; /** sem eixo de valores e sem grade (gráfico de tendência) */ minimal?: boolean; /** toque num ponto/barra: índice escolhido */ onPick?: (index: number) => void }) {
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
      if (kind === 'bar') return { label: s.label, data: s.data, backgroundColor: colors && series.length === 1 ? colors : c, borderRadius: 4, maxBarThickness: 22, borderColor: surface, borderWidth: stacked ? 1 : 0 };
      return { label: s.label, data: s.data, borderColor: c, backgroundColor: c + '22', borderWidth: 2, tension: 0.3, pointRadius: s.data.length > 14 ? 0 : 3, pointHoverRadius: 6, pointBackgroundColor: c, pointBorderColor: surface, pointBorderWidth: 2, fill: !!s.fill, borderDash: s.dashed ? [5, 4] : undefined };
    });
    const cfg: ChartConfiguration = {
      type: kind,
      data: { labels, datasets: datasets as never },
      options: {
        onClick: onPick ? (_e: unknown, els: { index: number }[]) => { if (els[0]) { tap(); onPick(els[0].index); } } : undefined,
        responsive: true,
        maintainAspectRatio: false,
        animation: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? false : { duration: 600, easing: 'easeOutQuart' },
        interaction: { mode: kind === 'doughnut' ? 'nearest' : 'index', intersect: kind === 'doughnut' },
        plugins: {
          legend: { display: false },
          tooltip: { backgroundColor: cssVar('--surface2'), titleColor: cssVar('--text'), bodyColor: cssVar('--text'), borderColor: line, borderWidth: 1, padding: 10, cornerRadius: 10, boxPadding: 4, callbacks: { label: (ctx: any) => ` ${kind === 'doughnut' ? ctx.label : ctx.dataset.label}: ${format === 'pct' ? formatPct(Number(ctx.raw), true) : format === 'rate' ? 'R$ ' + Number(ctx.raw).toLocaleString('pt-BR', { minimumFractionDigits: 4 }) : formatBRL(Number(ctx.raw))}` } },
        },
        ...(kind === 'doughnut' ? { cutout: '68%' } : { scales: { x: { stacked, grid: { display: false }, ticks: { color: text, font: { size: 11 }, maxRotation: 0, autoSkipPadding: 8 }, border: { color: line } }, y: { stacked, display: !minimal, grid: { color: line + '80' }, border: { display: false }, ticks: { color: text, font: { size: 11 }, maxTicksLimit: 5, callback: (v: string | number) => (format === 'pct' ? formatPct(Number(v)) : format === 'rate' ? Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : formatCompact(Number(v))) } } } }),
      } as never,
    };
    const chart = new Chart(ref.current, cfg);
    return () => chart.destroy();
  }, [kind, JSON.stringify(labels), JSON.stringify(series), theme, stacked, JSON.stringify(colors), format, minimal]);
  return <div className={'chartbox' + (small ? ' sm' : '') + (minimal ? ' xs' : '')}><canvas ref={ref} role="img" aria-label={series.map((s) => s.label).join(', ')} /></div>;
}
export function Legend({ items }: { items: { label: string; color: string; value?: string; dashed?: boolean }[] }) {
  return (
    <div className="legend" style={{ marginTop: 10 }}>
      {items.map((i) => (<span key={i.label}><i className="dot" style={{ background: i.dashed ? 'none' : i.color, border: i.dashed ? `1px dashed ${i.color}` : undefined }} />{i.label}{i.value && <> <b className="num">{i.value}</b></>}</span>))}
    </div>
  );
}

/**
 * Valor em reais que anima até o número novo quando ele muda (contagem curta, 450 ms, saída suave).
 * Com "reduzir movimento" ligado, troca direto. Fica borrado quando "ocultar valores" está ligado (classe .num).
 */
export function CountMoney({ cents, className = '' }: { cents: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(cents);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = shown.current;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || from === cents || typeof requestAnimationFrame !== 'function') {
      shown.current = cents;
      el.textContent = formatBRL(cents);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min((t - t0) / 450, 1);
      const v = Math.round(from + (cents - from) * (1 - Math.pow(1 - k, 4)));
      el.textContent = formatBRL(v);
      if (k < 1) raf = requestAnimationFrame(step);
      else shown.current = cents;
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); shown.current = cents; };
  }, [cents]);
  return <span ref={ref} className={'num ' + className}>{formatBRL(cents)}</span>;
}

/** Bloco de carregamento no formato do conteúdo que vai chegar. */
export function Skeleton({ w = '100%', h = 14, style }: { w?: number | string; h?: number; style?: CSSProperties }) {
  return <span className="skel" style={{ width: w, height: h, ...style }} aria-hidden />;
}

/** Marca do Grefinacia: o "G" branco no quadrado roxo (mesmo desenho do ícone do app). */
export function LogoMark({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden className="logomark">
      <defs>
        <linearGradient id="lm-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#a78bfa" /><stop offset="0.55" stopColor="#7c3aed" /><stop offset="1" stopColor="#4c1d95" /></linearGradient>
        <radialGradient id="lm-gl" cx="0.28" cy="0.2" r="0.7"><stop offset="0" stopColor="#fff" stopOpacity="0.35" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
      </defs>
      <rect width="100" height="100" rx="24" fill="url(#lm-bg)" />
      <rect width="100" height="100" rx="24" fill="url(#lm-gl)" />
      <path d="M70.6 33.4 A25 25 0 1 0 75 54 H52" fill="none" stroke="#fff" strokeWidth="9.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="80" cy="22" r="4.6" fill="#f5d0fe" />
    </svg>
  );
}

/** Logotipo completo: marca + nome. */
export function Logo({ size = 44 }: { size?: number }) {
  return <div className="logo"><LogoMark size={size} /><span>Gre<i>finacia</i></span></div>;
}
