import { useEffect, useState } from 'react';
import { Home as HomeIco, ArrowLeftRight, LineChart, Sparkles, Target } from 'lucide-react';
import { lock, rollDay, useStore, getState } from '../state/store';
import { watchAutoLock } from '../services/security';
import { nativeBridgeMissing } from '../services/platform';
import { Toast } from './kit';
import { Home } from './Home';
import { Transactions } from './Transactions';
import { Invest } from './Invest';
import { Assistant } from './Assistant';
import { Planning } from './Planning';
import { Settings } from './Settings';
import { LockScreen, Onboarding } from './Lock';

export type Tab = 'home' | 'transactions' | 'invest' | 'ai' | 'planning';
export interface Nav { go: (t: Tab, sub?: string) => void; openSettings: () => void }

const TABS: [Tab, string, typeof HomeIco][] = [['home', 'Início', HomeIco], ['transactions', 'Movimentações', ArrowLeftRight], ['invest', 'Investimentos', LineChart], ['ai', 'Grefinacia AI', Sparkles], ['planning', 'Planejamento', Target]];

export function App() {
  const ready = useStore((s) => s.ready);
  const locked = useStore((s) => s.locked);
  const onboarded = useStore((s) => s.settings.onboarded);
  const [tab, setTab] = useState<Tab>('home');
  const [sub, setSub] = useState<string | undefined>();
  const [settings, setSettings] = useState(false);

  useEffect(() => {
    const stop = watchAutoLock(() => getState().settings.security.lockAfterSec, lock);
    const vis = () => document.visibilityState === 'visible' && void rollDay();
    document.addEventListener('visibilitychange', vis);
    return () => { stop(); document.removeEventListener('visibilitychange', vis); };
  }, []);

  if (nativeBridgeMissing()) return (
    <div className="lock" role="alert">
      <div className="logo">Gre<i>finacia</i></div>
      <p>Este aparelho precisa atualizar o componente <b>Android System WebView</b> para o app funcionar por completo.</p>
      <p className="mut">Abra a Play Store, procure por "Android System WebView" (e "Google Chrome"), toque em Atualizar e abra o Grefinacia de novo. Seus dados continuam guardados.</p>
    </div>
  );
  if (!ready) return <div className="lock"><div className="logo">Gre<i>finacia</i></div></div>;
  if (!onboarded) return <><Onboarding /><Toast /></>;
  if (locked) return <><LockScreen /><Toast /></>;
  const nav: Nav = { go: (t, s) => { setTab(t); setSub(s); }, openSettings: () => setSettings(true) };
  return (
    <div className="app">
      {tab === 'home' && <Home nav={nav} />}
      {tab === 'transactions' && <Transactions />}
      {tab === 'invest' && <Invest initial={sub} />}
      {tab === 'ai' && <Assistant nav={nav} />}
      {tab === 'planning' && <Planning initial={sub} />}
      <nav className="nav" aria-label="Principal">
        {TABS.map(([id, label, I]) => (
          <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => nav.go(id)}><I size={21} strokeWidth={tab === id ? 2.2 : 1.8} />{label}</button>
        ))}
      </nav>
      {settings && <Settings onClose={() => setSettings(false)} />}
      <Toast />
    </div>
  );
}
