import { useMemo, useRef, useState } from 'react';
import { Send, TriangleAlert, CircleCheck, Info, Sparkles } from 'lucide-react';
import { formatBRL } from '../lib/money';
import { monthPace } from '../domain/home';
import { useStore } from '../state/store';
import { computeOverview } from '../domain/overview';
import { generateInsights } from '../domain/insights';
import { answerLocally, buildAiContext, SUGGESTED_QUESTIONS } from '../domain/chat';
import { askAi } from '../services/ai';
import { PAID_AI_ENABLED } from '../lib/flags';
import type { Nav } from './App';
import { Note, Seg } from './kit';
import { Xray } from './Xray';
import { askNano } from '../services/nano';
import { nanoContext } from '../domain/nanoPrompt';

interface Msg { role: 'user' | 'assistant'; content: string; calc?: string[]; via?: string }

export function Assistant({ nav, initial }: { nav: Nav; initial?: string }) {
  const data = useStore((s) => s.data);
  const settings = useStore((s) => s.settings);
  const today = useStore((s) => s.today);
  const [view, setView] = useState<'chat' | 'analises' | 'raiox'>(initial === 'raiox' || initial === 'analises' ? initial : 'chat');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const o = useMemo(() => computeOverview(data, settings, today), [data, settings, today]);
  const insights = useMemo(() => generateInsights(o, data, settings), [o, data, settings]);
  const useApi = PAID_AI_ENABLED && settings.ai.mode === 'api' && settings.ai.consent && settings.ai.apiKey.trim().length > 0;

  const ask = async (q: string) => {
    if (!q.trim() || busy) return;
    const history = msgs.map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: 'user', content: q }]);
    setText('');
    setBusy(true);
    let reply: Msg;
    if (useApi) {
      try { reply = { role: 'assistant', content: await askAi(q, buildAiContext(o, data, settings), settings.ai, history), via: 'IA externa' }; }
      catch (e) { const l = answerLocally(q, o, data, settings); reply = { role: 'assistant', content: l.text, calc: l.calc, via: `Resposta local (a IA externa falhou: ${e instanceof Error ? e.message : 'erro'})` }; }
    } else {
      const l = answerLocally(q, o, data, settings);
      reply = { role: 'assistant', content: l.text, calc: l.calc };
      // pergunta que as regras não reconhecem: a IA do aparelho responde, se você ligou em Ajustes
      if (l.fallback && settings.ai.nano) {
        try {
          const n = await askNano(q, nanoContext(o, data, settings));
          reply = { role: 'assistant', content: n.text, via: 'Gemini Nano, no aparelho. Pode errar: confira os números nas telas do app.' + (n.dropped.length ? ' Parte dos dados ficou de fora por falta de espaço.' : '') };
        } catch (e) {
          reply = { ...reply, via: `Resposta local (Gemini Nano: ${e instanceof Error ? e.message : 'indisponível'})` };
        }
      }
    }
    setMsgs((m) => [...m, reply]);
    setBusy(false);
    setTimeout(() => end.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  return (
    <div className="screen" style={{ paddingBottom: view === 'chat' ? 150 : 110 }}>
      <div className="head ai-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className={'orb' + (busy ? ' thinking' : '')} aria-hidden><Sparkles size={20} /></span>
          <div><h1>Grefinacia AI</h1><div className="sub">{useApi ? 'IA externa ligada, com sua autorização' : settings.ai.nano ? 'Regras locais + Gemini Nano no aparelho' : 'Modo local: nada sai do aparelho'}</div></div>
        </div>
      </div>
      <Seg value={view} onChange={setView} options={[['chat', 'Conversa'], ['analises', `Alertas (${insights.length})`], ['raiox', 'Raio-X']]} />
      {view === 'raiox' ? (
        <>
          <Xray />
          <Note>Tudo calculado no aparelho, por regras que mostram a conta. Não é recomendação de investimento e o app nunca compra, vende ou paga nada sozinho.</Note>
        </>
      ) : view === 'analises' ? (
        <>
          {insights.length === 0 && <div className="empty">Sem alertas no momento. Lance suas movimentações para receber análises.</div>}
          {insights.map((i) => (
            <button key={i.id} className={'alert ' + i.tone} onClick={() => (i.target === 'raiox' ? setView('raiox') : goInsight(nav, i.target))}>
              {i.tone === 'bad' || i.tone === 'warn' ? <TriangleAlert size={20} /> : i.tone === 'good' ? <CircleCheck size={20} /> : <Info size={20} />}
              <div><div className="t">{i.title}</div><div className="s">{i.text}</div></div>
            </button>
          ))}
          <Note>Análises calculadas por regras sobre os seus dados. São apoio à organização financeira, não recomendação de investimento, e o app nunca compra, vende ou paga nada sozinho.</Note>
        </>
      ) : (
        <>
          {msgs.length === 0 && (
            <>
              <AiBrief o={o} />
              {insights.slice(0, 2).map((i) => (
                <button key={i.id} className={'ai-card ' + i.tone} onClick={() => (i.target === 'raiox' ? setView('raiox') : goInsight(nav, i.target))}>
                  {i.tone === 'bad' || i.tone === 'warn' ? <TriangleAlert size={18} /> : i.tone === 'good' ? <CircleCheck size={18} /> : <Info size={18} />}
                  <div><div className="t">{i.title}</div><div className="s">{i.text}</div></div>
                </button>
              ))}
              <div className="ghead"><h2>Pergunte sobre o seu dinheiro</h2></div>
              <div className="hint" style={{ margin: '-4px 4px 10px' }}>Respondo com os dados que você registrou e mostro a conta.</div>
              <div className="qchips">{SUGGESTED_QUESTIONS.map((q) => (<button key={q} onClick={() => ask(q)}>{q}</button>))}</div>
            </>
          )}
          <div className="chat" aria-live="polite">
            {msgs.map((m, i) => (
              <div key={i} className={'msg ' + (m.role === 'user' ? 'me' : 'ai')}>
                {m.content}
                {m.calc && m.calc.length > 0 && <details className="calc" open={i === msgs.length - 1}><summary>Ver a conta</summary><div className="num">{m.calc.map((c, k) => (<div key={k}>{c}</div>))}</div></details>}
                {m.via && <div className="calc">{m.via}</div>}
              </div>
            ))}
            {busy && <div className="msg ai typing" role="status" aria-label="Analisando seus dados"><i /><i /><i /><span>Analisando seus dados</span></div>}
            <div ref={end} />
          </div>
          {msgs.length > 0 && !busy && <div className="qchips small">{SUGGESTED_QUESTIONS.filter((q) => !msgs.some((m) => m.content === q)).slice(0, 4).map((q) => (<button key={q} onClick={() => ask(q)}>{q}</button>))}</div>}
          <form className="composer" onSubmit={(e) => { e.preventDefault(); void ask(text); }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Escreva sua pergunta" aria-label="Pergunta" />
            <button className="iconbtn send" disabled={busy || !text.trim()} aria-label="Enviar"><Send size={18} /></button>
          </form>
        </>
      )}
    </div>
  );
}

/** Resumo do dia da assistente: números reais do app (nada estimado sem dizer). */
function AiBrief({ o }: { o: ReturnType<typeof computeOverview> }) {
  const data = useStore((s) => s.data);
  const today = useStore((s) => s.today);
  const pace = useMemo(() => monthPace(data, today), [data, today]);
  const diff = pace.spentCents - pace.lastMonthSameDayCents;
  return (
    <section className="ai-brief" aria-label="Resumo de hoje">
      <div className="ai-brief-title"><Sparkles size={16} /> Resumo de hoje</div>
      <div className="ai-stats">
        <div><span>Livre para gastar</span><b className={'num ' + (o.spend.remainingCents < 0 ? 'neg' : '')}>{formatBRL(o.spend.remainingCents)}</b>{o.spend.perDayCents > 0 && <small className="num">{formatBRL(o.spend.perDayCents)} por dia até o fim do mês</small>}</div>
        <div><span>Gasto no mês</span><b className="num">{formatBRL(pace.spentCents)}</b>{pace.lastMonthSameDayCents > 0 && <small className={diff > 0 ? 'neg' : 'pos'}>{diff > 0 ? `${formatBRL(diff)} a mais` : `${formatBRL(-diff)} a menos`} que no mês passado</small>}</div>
        <div><span>Previsão do mês</span><b className="num">{formatBRL(pace.projectedCents)}</b><small>de gastos</small></div>
        <div><span>Fim do mês</span><b className={'num ' + (o.projectedEndBalanceCents < 0 ? 'neg' : '')}>{formatBRL(o.projectedEndBalanceCents)}</b><small>saldo previsto</small></div>
      </div>
    </section>
  );
}

/** Abre a tela de um alerta. */
export function goInsight(nav: Nav, target: string | undefined): void {
  if (!target) return;
  if (target === 'dividends') nav.go('invest', 'dividendos');
  else if (target === 'raiox') nav.go('ai', 'raiox');
  else nav.go(target as never);
}
