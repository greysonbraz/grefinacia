import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { updateSettings, useStore } from '../state/store';
import { NEWS_SOURCES, TOPIC_LABEL, type NewsItem, type NewsTopic } from '../domain/news';
import { loadNews, type NewsResult } from '../services/news';
import { isNative } from '../services/platform';
import { Full, Note, Seg, SwitchRow, Skeleton } from './kit';

const TOPICS = Object.entries(TOPIC_LABEL) as [NewsTopic, string][];

function when(iso: string): string {
  if (!iso) return '';
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  if (min < 60 * 24) return `há ${Math.round(min / 60)} h`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/** Notícias do mercado financeiro: título, resumo e link para a matéria no site de origem. */
export function News({ onClose, initialTopic = 'economia' }: { onClose: () => void; initialTopic?: NewsTopic }) {
  const disabled = useStore((s) => s.settings.news.disabledSources);
  const [topic, setTopic] = useState<NewsTopic>(initialTopic);
  const [res, setRes] = useState<NewsResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [sources, setSources] = useState(false);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    setRes(null);
    loadNews(topic, disabled)
      .then((r) => alive && setRes(r))
      .catch(() => alive && setRes({ items: [], at: Date.now(), failed: ['todas as fontes'], fromCache: false }))
      .finally(() => alive && setBusy(false));
    return () => { alive = false; };
  }, [topic, disabled]);

  const toggle = (id: string, on: boolean) => updateSettings({ news: { disabledSources: on ? disabled.filter((x) => x !== id) : [...disabled, id] } });

  return (
    <Full title="Notícias" onBack={onClose} action={<button className="btn ghost sm" onClick={() => setSources((v) => !v)}>Fontes</button>}>
      <Seg value={topic} onChange={setTopic} options={TOPICS} />
      {sources && (
        <div className="card">
          <h2>Fontes de {TOPIC_LABEL[topic]}</h2>
          {NEWS_SOURCES.filter((s) => s.topic === topic).map((s) => (<SwitchRow key={s.id} title={s.name} on={!disabled.includes(s.id)} onChange={(on) => void toggle(s.id, on)} />))}
        </div>
      )}
      {busy && (<div role="status" aria-label="Buscando notícias">{[0, 1, 2, 3].map((i) => (<div className="news-skel" key={i}><Skeleton w="40%" h={11} /><Skeleton h={16} /><Skeleton w="85%" h={16} /><Skeleton w="65%" h={12} /></div>))}</div>)}
      {res && !busy && res.items.length === 0 && (
        <div className="empty">{isNative() ? 'Não foi possível buscar notícias agora. Confira a internet e tente de novo em alguns minutos.' : 'As notícias só carregam no app Android (o navegador bloqueia a leitura dos sites).'}</div>
      )}
      {res && res.items.map((n: NewsItem) => (
        <a key={n.id} className="news" href={n.url} target="_blank" rel="noopener noreferrer">
          <div className="news-meta"><span>{n.source}</span><span>{when(n.date)}</span></div>
          <div className="news-title">{n.title}</div>
          {n.summary && <div className="news-sum">{n.summary}</div>}
          <div className="news-open"><ExternalLink size={13} /> Ler no site</div>
        </a>
      ))}
      {res && res.items.length > 0 && (
        <Note>
          Atualizado {when(new Date(res.at).toISOString())}{res.failed.length > 0 ? `. Sem resposta de: ${res.failed.join(', ')}` : ''}. O app mostra só o título e um resumo; a matéria completa abre no site de cada veículo. Notícia não é recomendação de investimento.
        </Note>
      )}
    </Full>
  );
}
