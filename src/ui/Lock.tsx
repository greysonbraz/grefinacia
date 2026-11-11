import { useEffect, useState } from 'react';
import { Fingerprint, Delete } from 'lucide-react';
import { toast, unlock, updateSettings, upsert, useStore, getState } from '../state/store';
import { biometricAvailable, biometricUnlock, clearFailures, createCredential, lockoutRemainingMs, registerFailure, verifyCredential } from '../services/security';
import { requestNotificationPermission } from '../services/notify';
import { parseMoney } from '../lib/money';
import { todayISO } from '../lib/dates';
import { uid } from '../lib/ids';
import { Field, MoneyInput } from './kit';

export function PinPad({ title, sub, onDone, error }: { title: string; sub?: string; onDone: (pin: string) => void; error?: string | null }) {
  const [pin, setPin] = useState('');
  useEffect(() => { if (pin.length === 6) { onDone(pin); setPin(''); } }, [pin]);
  const press = (d: string) => setPin((p) => (p.length < 6 ? p + d : p));
  return (
    <>
      <div><div style={{ fontWeight: 600, fontSize: 17 }}>{title}</div>{sub && <div className="mut" style={{ fontSize: 13 }}>{sub}</div>}</div>
      <div className="pins" aria-label={`${pin.length} de 6 dígitos`}>{[0, 1, 2, 3, 4, 5].map((i) => (<i key={i} className={i < pin.length ? 'on' : ''} />))}</div>
      {error && <div className="neg" role="alert" style={{ fontSize: 13 }}>{error}</div>}
      <div className="pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (<button key={d} onClick={() => press(d)}>{d}</button>))}
        <span />
        <button onClick={() => press('0')}>0</button>
        <button onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Apagar"><Delete size={22} style={{ margin: 'auto' }} /></button>
      </div>
    </>
  );
}

export function LockScreen() {
  const sec = useStore((s) => s.settings.security);
  const [err, setErr] = useState<string | null>(null);
  const tryBio = async () => { if (sec.biometric && (await biometricUnlock()) === 'ok') { clearFailures(); unlock(); } };
  useEffect(() => { void tryBio(); }, []);
  const check = async (pin: string) => {
    const wait = lockoutRemainingMs();
    if (wait > 0) return setErr(`Muitas tentativas. Aguarde ${Math.ceil(wait / 1000)} s.`);
    if (await verifyCredential(sec, pin)) { clearFailures(); unlock(); }
    else { const w = registerFailure(); setErr(w > 0 ? `PIN incorreto. Aguarde ${Math.ceil(w / 1000)} s para tentar de novo.` : 'PIN incorreto.'); }
  };
  return (
    <div className="lock">
      <div className="logo">Gre<i>finacia</i></div>
      <PinPad title="Digite seu PIN" onDone={check} error={err} />
      {sec.biometric && <button className="btn ghost sm" onClick={tryBio}><Fingerprint size={18} /> Usar biometria</button>}
    </div>
  );
}

export function Onboarding() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [acc, setAcc] = useState('Conta principal');
  const [bal, setBal] = useState('');
  const [first, setFirst] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const finish = async (pin?: string) => {
    const s = getState().settings;
    let security = s.security;
    if (pin) {
      const cred = await createCredential(pin);
      security = { ...security, ...cred, enabled: true, kind: 'pin', biometric: await biometricAvailable() };
    }
    await upsert('accounts', { id: uid('a_'), name: acc.trim() || 'Conta principal', kind: 'corrente', initialCents: parseMoney(bal) ?? 0, initialDate: todayISO() });
    await updateSettings({ onboarded: true, userName: name.trim() || undefined, security });
    void requestNotificationPermission().catch(() => undefined);
    toast('Tudo pronto. Comece lançando seu salário em Planejamento.');
  };
  if (step === 0) return (
    <div className="lock" style={{ alignItems: 'stretch', textAlign: 'left', maxWidth: 440, margin: '0 auto' }}>
      <div className="logo">Gre<i>finacia</i></div>
      <p className="mut">Seu centro de controle financeiro. Os dados ficam só neste aparelho.</p>
      <Field label="Como quer ser chamado? (opcional)"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" /></Field>
      <Field label="Nome da sua conta principal"><input value={acc} onChange={(e) => setAcc(e.target.value)} /></Field>
      <Field label="Saldo de hoje nessa conta (R$)" hint="Você pode cadastrar outras contas depois, em Ajustes."><MoneyInput value={bal} onChange={setBal} name="saldo" /></Field>
      <button className="btn" onClick={() => setStep(1)}>Continuar</button>
    </div>
  );
  return (
    <div className="lock">
      <div className="logo">Gre<i>finacia</i></div>
      <PinPad title={first ? 'Repita o PIN' : 'Crie um PIN de 6 dígitos'} sub="Protege o app toda vez que ele é aberto" error={err} onDone={(p) => {
        if (!first) { setFirst(p); setErr(null); }
        else if (first === p) void finish(p);
        else { setFirst(null); setErr('Os PINs não conferem. Comece de novo.'); }
      }} />
      <button className="link" onClick={() => void finish()}>Agora não, entrar sem PIN</button>
    </div>
  );
}
