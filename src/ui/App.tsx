import { useEffect, useRef, useState } from 'react';
import { Home as HomeIco, ArrowLeftRight, LineChart, Sparkles, Target } from 'lucide-react';
import { App as CapApp } from '@capacitor/app';
import { lock, rollDay, useStore, getState } from '../state/store';
import { isNative } from '../services/platform';
import { tap } from '../services/haptics';
import { closeTop } from './back';
import { watchAutoLock } from '../services/security';
import { nativeBridgeMissing } from '../services/platform';
import { startAutoSync } from '../state/cloud';
import { Logo, Toast } from './kit';
import { Home } from './Home';
import { Transactions } from './Transactions';
import { Invest } from './Invest';
import { Assistant } from './Assistant';
import { Planning } from './Planning';
import { Settings } from './Settings';
import { LockScreen, Onboarding } from './Lock';

export type Tab = 'home' | 'transactions' | 'invest' | 'ai' | 'planning';
export interface Nav { go: (t: Tab, sub?: string) => void; openSettings: () => void }

const TABS: [Tab, string, typeof HomeIco][] = [['home', 'Início', HomeIco], ['transactions', 'Movimentações', ArrowLeftRight], ['ai', 'AI', Sparkles], ['invest', 'Investimentos', LineChart], ['planning', 'Planejamento', Target]];

export function App() {
  const ready = useStore((s) => s.ready);
  const locked = useStore((s) => s.locked);
  const onboarded = useStore((s) => s.settings.onboarded);
  const [tab, setTab] = useState<Tab>('home');
  const [sub, setSub] = useState<string | undefined>();
  const [settings, setSettings] = useState(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    const stop = watchAutoLock(() => getState().settings.security.lockAfterSec, lock);
    const vis = () => document.visibilityState === 'visible' && void rollDay();
    document.addEventListener('visibilitychange', vis);
    return () => { stop(); document.removeEventListener('visibilitychange', vis); };
  }, []);

  useEffect(() => (ready ? startAutoSync() : undefined), [ready]);

  // botão "voltar" do Android: fecha a janela/tela aberta; sem nenhuma, volta ao Início; no Início, minimiza
  const tabRef = useRef(tab);
  tabRef.current = tab;
  useEffect(() => {
    if (!isNative()) return;
    const h = CapApp.addListener('backButton', () => {
      if (closeTop()) return;
      if (settingsRef.current) return setSettings(false);
      if (tabRef.current !== 'home') return setTab('home');
      void CapApp.minimizeApp();
    });
    return () => { void h.then((x) => x.remove()); };
  }, []);

  if (nativeBridgeMissing()) return (
    <div className="lock" role="alert">
      <Logo />
      <p>Este aparelho precisa atualizar o componente <b>Android System WebView</b> para o app funcionar por completo.</p>
      <p className="mut">Abra a Play Store, procure por "Android System WebView" (e "Google Chrome"), toque em Atualizar e abra o Grefinacia de novo. Seus dados continuam guardados.</p>
    </div>
  );
  if (!ready) return <div className="lock"><Logo /></div>;
  if (!onboarded) return <><Onboarding /><Toast /></>;
  if (locked) return <><LockScreen /><Toast /></>;
  const nav: Nav = { go: (t, s) => { setTab(t); setSub(s); }, openSettings: () => setSettings(true) };
  return (
    <div className="app">
      {tab === 'home' && <Home nav={nav} />}
      {tab === 'transactions' && <Transactions key={sub ?? 'tx'} initial={sub} />}
      {tab === 'invest' && <Invest initial={sub} />}
      {tab === 'ai' && <Assistant nav={nav} initial={sub} />}
      {tab === 'planning' && <Planning initial={sub} />}
      <nav className="nav" aria-label="Principal">
        {TABS.map(([id, label, I]) => (
          <button key={id} className={id === 'ai' ? 'nav-ai' : undefined} aria-label={id === 'ai' ? 'Grefinacia AI' : undefined} aria-current={tab === id ? 'page' : undefined} onClick={() => { if (tab !== id) tap(); nav.go(id); }}><span className="pill"><I size={21} strokeWidth={tab === id ? 2.2 : 1.8} /></span>{label}</button>
        ))}
      </nav>
      {settings && <Settings onClose={() => setSettings(false)} />}
      <Toast />
    </div>
  );
}
