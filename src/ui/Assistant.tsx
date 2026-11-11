import { useMemo, useRef, useState } from 'react';
import { Send, TriangleAlert, CircleCheck, Info } from 'lucide-react';
import { useStore } from '../state/store';
import { computeOverview } from '../domain/overview';
import { generateInsights } from '../domain/insights';
import { answerLocally, buildAiContext, SUGGESTED_QUESTIONS } from '../domain/chat';
import { askAi } from '../services/ai';
import type { Nav } from './App';
import { Note, Seg } from './kit';

interface Msg { role: 'user' | 'assistant'; content: string; calc?: string[]; via?: string }

export function Assistant({ nav }: { nav: Nav }) {
  const data = useStore((s) => s.data);
  const settings = useStore((s) => s.settings);
  const today = useStore((s) => s.today);
  const [view, setView] = useState<'chat' | 'analises'>('chat');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const o = useMemo(() => computeOverview(data, settings, today), [data, settings, today]);
  const insights = useMemo(() => generateInsights(o, data, settings), [o, data, settings]);
  const useApi = settings.ai.mode === 'api' && settings.ai.consent && settings.ai.apiKey.trim().length > 0;

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
    }
    setMsgs((m) => [...m, reply]);
    setBusy(false);
    setTimeout(() => end.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  return (
    <div className="screen" style={{ paddingBottom: view === 'chat' ? 150 : 110 }}>
      <div className="head"><div><h1>Grefinacia AI</h1><div className="sub">{useApi ? 'IA externa ligada, com sua autorização' : 'Modo local: nada sai do aparelho'}</div></div></div>
      <Seg value={view} onChange={setView} options={[['chat', 'Conversa'], ['analises', `Análises (${insights.length})`]]} />
      {view === 'analises' ? (
        <>
          {insights.length === 0 && <div className="empty">Sem alertas no momento. Lance suas movimentações para receber análises.</div>}
          {insights.map((i) => (
            <button key={i.id} className={'alert ' + i.tone} onClick={() => i.target && nav.go(i.target === 'dividends' ? 'invest' : (i.target as never), i.target === 'dividends' ? 'dividendos' : undefined)}>
              {i.tone === 'bad' || i.tone === 'warn' ? <TriangleAlert size={20} /> : i.tone === 'good' ? <CircleCheck size={20} /> : <Info size={20} />}
              <div><div className="t">{i.title}</div><div className="s">{i.text}</div></div>
            </button>
          ))}
          <Note>Análises calculadas por regras sobre os seus dados. São apoio à organização financeira, não recomendação de investimento, e o app nunca compra, vende ou paga nada sozinho.</Note>
        </>
      ) : (
        <>
          {msgs.length === 0 && (
            <div className="card">
              <h2>Pergunte sobre o seu dinheiro</h2>
              <div className="hint" style={{ marginBottom: 12 }}>Respondo com os dados que você registrou e mostro a conta.</div>
              {SUGGESTED_QUESTIONS.map((q) => (<button key={q} className="row" onClick={() => ask(q)}><div className="mid"><div className="t" style={{ whiteSpace: 'normal' }}>{q}</div></div></button>))}
            </div>
          )}
          <div className="chat">
            {msgs.map((m, i) => (
              <div key={i} className={'msg ' + (m.role === 'user' ? 'me' : 'ai')}>
                {m.content}
                {m.calc && m.calc.length > 0 && <div className="calc num">{m.calc.map((c, k) => (<div key={k}>{c}</div>))}</div>}
                {m.via && <div className="calc">{m.via}</div>}
              </div>
            ))}
            {busy && <div className="msg ai mut">Calculando…</div>}
            <div ref={end} />
          </div>
          <form className="composer" onSubmit={(e) => { e.preventDefault(); void ask(text); }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Escreva sua pergunta" aria-label="Pergunta" />
            <button className="iconbtn" style={{ background: 'var(--gold)', color: 'var(--gold-ink)', width: 46, height: 46 }} aria-label="Enviar"><Send size={18} /></button>
          </form>
        </>
      )}
    </div>
  );
}
