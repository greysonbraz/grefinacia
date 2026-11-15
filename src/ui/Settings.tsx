import { useEffect, useRef, useState } from 'react';
import { remove, restoreAll, restoreSafetyCopy, toast, updateSettings, upsert, useStore, wipeAll, afterChange } from '../state/store';
import { listSafetyCopies, MAX_SAFETY_COPIES, type SafetyCopyInfo, type SafetyReason } from '../db/db';
import type { Account, Card, Settings as S } from '../lib/types';
import { accountBalance } from '../domain/ledger';
import { centsToInput, formatBRL, parseMoney } from '../lib/money';
import { formatDateBR } from '../lib/dates';
import { uid } from '../lib/ids';
import { biometricAvailable, createCredential } from '../services/security';
import { notificationPermission, requestNotificationPermission } from '../services/notify';
import { BackupError, createBackup, readBackup, saveAndShare } from '../services/backup';
import { isNative } from '../services/platform';
import { PAID_AI_ENABLED } from '../lib/flags';
import { Field, Full, MoneyInput, Note, Seg, Sheet, SwitchRow } from './kit';
import { PinPad } from './Lock';

const NOTIF: [keyof S['notifications']['types'], string, string][] = [
  ['salary', 'Salário', 'No dia do pagamento e ao confirmar o recebimento'],
  ['billsDue', 'Contas perto do vencimento', 'Dias antes e no dia'],
  ['overdue', 'Contas atrasadas', 'Lembrete diário por 3 dias'],
  ['dividendAnnounced', 'Proventos anunciados', 'Quando a fonte de dados trouxer um anúncio novo'],
  ['dividendSoon', 'Proventos perto do pagamento', 'Dias antes da data'],
  ['dividendReceived', 'Dia de pagamento de proventos', 'Para você confirmar o recebimento'],
  ['overBudget', 'Gastos acima do orçamento', 'Por categoria e no total planejado'],
  ['lowBalance', 'Saldo insuficiente', 'Quando as contas a pagar passam do saldo'],
  ['goalReached', 'Metas alcançadas', 'Ao completar um objetivo'],
  ['backup', 'Lembrete de backup', 'Uma vez por mês'],
];

export function Settings({ onClose }: { onClose: () => void }) {
  const data = useStore((s) => s.data);
  const st = useStore((s) => s.settings);
  const today = useStore((s) => s.today);
  const [acc, setAcc] = useState<Account | 'new' | null>(null);
  const [card, setCard] = useState<Card | 'new' | null>(null);
  const [pin, setPin] = useState(false);
  const [bk, setBk] = useState<'create' | 'restore' | null>(null);
  const [perm, setPerm] = useState<string>('');
  const n = st.notifications;
  const setN = (p: Partial<S['notifications']>) => updateSettings({ notifications: { ...n, ...p } });
  const setApi = (p: Partial<S['api']>) => updateSettings({ api: { ...st.api, ...p } });
  const setAi = (p: Partial<S['ai']>) => updateSettings({ ai: { ...st.ai, ...p } });
  const setSec = (p: Partial<S['security']>) => updateSettings({ security: { ...st.security, ...p } });
  if (!perm) void notificationPermission().then(setPerm);

  return (
    <Full title="Ajustes" onBack={onClose}>
      <div className="section">Aparência</div>
      <Seg value={st.theme} onChange={(theme) => updateSettings({ theme })} options={[['dark', 'Escuro'], ['light', 'Claro'], ['system', 'Do sistema']]} />

      <div className="section">Contas</div>
      <div className="card" style={{ padding: '4px 14px' }}>
        {data.accounts.map((a) => (<button className="row" key={a.id} onClick={() => setAcc(a)}><div className="mid"><div className="t">{a.name}</div><div className="s">Saldo inicial {formatBRL(a.initialCents)} em {formatDateBR(a.initialDate)}</div></div><div className="end num">{formatBRL(accountBalance(a, data))}</div></button>))}
        <button className="row link" onClick={() => setAcc('new')}>+ Adicionar conta</button>
      </div>
      <div className="section">Cartões de crédito</div>
      <div className="card" style={{ padding: '4px 14px' }}>
        {data.cards.map((c) => (<button className="row" key={c.id} onClick={() => setCard(c)}><div className="mid"><div className="t">{c.name}</div><div className="s">Fecha dia {c.closingDay} · vence dia {c.dueDay}</div></div></button>))}
        <button className="row link" onClick={() => setCard('new')}>+ Adicionar cartão</button>
      </div>

      <div className="section">Segurança</div>
      <div className="card">
        <SwitchRow title="Bloqueio por PIN" sub={st.security.enabled ? 'Pedido ao abrir o app' : 'Desligado'} on={st.security.enabled} onChange={(on) => (on ? setPin(true) : setSec({ enabled: false, biometric: false, hash: undefined, salt: undefined }))} />
        {st.security.enabled && (<>
          <SwitchRow title="Desbloquear com biometria" sub="Digital ou rosto cadastrados no aparelho" on={st.security.biometric} onChange={async (on) => { if (on && !(await biometricAvailable())) return toast(isNative() ? 'Nenhuma biometria cadastrada no aparelho' : 'Biometria só funciona no app Android', 'err'); await setSec({ biometric: on }); }} />
          <SwitchRow title="Ocultar em capturas e apps recentes" sub="Impede prints e esconde os valores na lista de apps" on={st.security.hideInRecents} onChange={(on) => setSec({ hideInRecents: on })} />
          <Field label="Bloquear depois de ficar em segundo plano por"><select value={st.security.lockAfterSec} onChange={(e) => setSec({ lockAfterSec: Number(e.target.value) })}><option value={0}>Imediatamente</option><option value={30}>30 segundos</option><option value={120}>2 minutos</option><option value={600}>10 minutos</option></select></Field>
          <button className="btn ghost" onClick={() => setPin(true)}>Trocar PIN</button>
        </>)}
        <Note>O PIN é guardado só como hash (PBKDF2-SHA256 com sal). Os dados ficam no armazenamento privado do app, protegido pela criptografia do Android; tokens e chaves ficam no cofre do sistema (Android Keystore); o backup exportado é criptografado com AES-256.</Note>
      </div>

      <div className="section">Notificações</div>
      <div className="card">
        <SwitchRow title="Notificações do Grefinacia" sub={perm === 'granted' ? 'Permitidas no Android' : perm === 'denied' ? 'Bloqueadas: libere nas configurações do Android' : 'Permissão ainda não concedida'} on={n.enabled} onChange={async (on) => { await setN({ enabled: on }); if (on) setPerm(await requestNotificationPermission()); }} />
        {perm !== 'granted' && n.enabled && <button className="btn ghost" style={{ margin: '8px 0' }} onClick={async () => { setPerm(await requestNotificationPermission()); void afterChange(); }}>Permitir notificações</button>}
        <div className="two" style={{ marginTop: 10 }}>
          <Field label="Horário dos lembretes"><input type="time" value={n.time} onChange={(e) => setN({ time: e.target.value || '09:00' })} /></Field>
          <Field label="Avisar contas com"><select value={n.billsDaysBefore} onChange={(e) => setN({ billsDaysBefore: Number(e.target.value) })}>{[0, 1, 2, 3, 5, 7].map((d) => (<option key={d} value={d}>{d === 0 ? 'só no dia' : `${d} ${d === 1 ? 'dia' : 'dias'} antes`}</option>))}</select></Field>
        </div>
        <Field label="Avisar proventos com"><select value={n.dividendDaysBefore} onChange={(e) => setN({ dividendDaysBefore: Number(e.target.value) })}>{[1, 2, 3, 5].map((d) => (<option key={d} value={d}>{d} {d === 1 ? 'dia' : 'dias'} antes</option>))}</select></Field>
        {NOTIF.map(([k, t, s]) => (<SwitchRow key={k} title={t} sub={s} on={n.types[k]} onChange={(on) => setN({ types: { ...n.types, [k]: on } })} />))}
        <Note>Lembretes com data (contas, salário, proventos) são agendados no Android e chegam com o app fechado. Alertas de orçamento e saldo são calculados quando você usa o app. Na Samsung, deixe o Grefinacia como "Não restrito" em Bateria para não atrasar avisos.</Note>
      </div>

      <div className="section">Cotações e proventos</div>
      <div className="card">
        <Field label="Fonte das cotações"><select value={st.api.quoteProvider} onChange={(e) => setApi({ quoteProvider: e.target.value as never })}><option value="brapi">brapi.dev (recomendada)</option><option value="yahoo">Yahoo Finance (não oficial)</option><option value="manual">Nenhuma: preço manual</option></select></Field>
        <Field label="Fonte dos proventos"><select value={st.api.dividendProvider} onChange={(e) => setApi({ dividendProvider: e.target.value as never })}><option value="brapi">brapi.dev (plano Startup ou Pro)</option><option value="yahoo">Yahoo Finance (não oficial)</option><option value="manual">Nenhuma: cadastro manual</option></select></Field>
        <Field label="Token da brapi.dev" hint="Crie grátis em brapi.dev/dashboard. Sem token só funcionam PETR4, VALE3, ITUB4 e MGLU3."><input name="token" value={st.api.brapiToken} onChange={(e) => setApi({ brapiToken: e.target.value })} autoCapitalize="off" autoCorrect="off" /></Field>
        <Field label="Seu plano na brapi"><select value={st.api.brapiPlan} onChange={(e) => setApi({ brapiPlan: e.target.value as never })}><option value="free">Gratuito (1 ativo por consulta, sem proventos)</option><option value="startup">Startup</option><option value="pro">Pro</option></select></Field>
        <Note>Cotações têm atraso (não são tempo real). O Yahoo Finance é uma fonte não oficial, pode parar de funcionar e só responde no app Android.</Note>
      </div>

      <div className="section">Grefinacia AI</div>
      <div className="card">
        {PAID_AI_ENABLED ? (<>
          <Seg value={st.ai.mode} onChange={(mode) => setAi({ mode })} options={[['local', 'Somente local'], ['api', 'IA externa (opcional)']]} />
          {st.ai.mode === 'api' && (<>
            <Field label="Chave de API da Anthropic" hint="Fica só neste aparelho. O uso é cobrado na sua conta da Anthropic."><input name="apikey" type="password" value={st.ai.apiKey} onChange={(e) => setAi({ apiKey: e.target.value })} /></Field>
            <Field label="Modelo"><input value={st.ai.model} onChange={(e) => setAi({ model: e.target.value })} /></Field>
            <SwitchRow title="Autorizo enviar um resumo dos meus dados" sub="Totais, categorias, carteira, dívidas e metas. Descrições de lançamentos não são enviadas." on={st.ai.consent} onChange={(consent) => setAi({ consent })} />
          </>)}
          <Note>No modo local nenhum dado sai do aparelho. A IA externa só é usada com chave e autorização; sem isso o chat responde por cálculos locais.</Note>
        </>) : (<>
          <div className="kv"><span>Modo</span><b>Local, sem custo</b></div>
          <Note>A Grefinacia AI responde por cálculos feitos no próprio aparelho: nenhum dado sai dele e não há cobrança. A opção de IA externa paga está desativada nesta versão.</Note>
        </>)}
      </div>

      <div className="section">Bancos e pagamentos (Open Finance)</div>
      <div className="card">
        <div className="kv"><span>Conexão bancária</span><b>Não disponível nesta versão</b></div>
        <div className="kv"><span>Pagamentos automáticos</span><b>Não disponível nesta versão</b></div>
        <Note>Ler saldos e extratos ou iniciar pagamentos exige contrato com um provedor autorizado pelo Banco Central (por exemplo Pluggy ou Belvo) e um servidor para guardar as credenciais do provedor. Enquanto isso não existir, tudo é cadastrado por você, o app só lembra dos vencimentos e nunca movimenta dinheiro. Nenhuma senha bancária é pedida ou armazenada.</Note>
      </div>

      <div className="section">Backup e outros aparelhos</div>
      <div className="card">
        <div className="kv"><span>Último backup</span><b>{st.lastBackupAt ? formatDateBR(st.lastBackupAt.slice(0, 10)) : 'nunca'}</b></div>
        <div className="btnrow"><button className="btn" onClick={() => setBk('create')}>Fazer backup</button><button className="btn ghost" onClick={() => setBk('restore')}>Restaurar</button></div>
        <Note>O backup é um arquivo criptografado com a senha que você escolher. Salve no Google Drive e use "Restaurar" em outro aparelho para levar seus dados. Sincronização automática entre aparelhos não existe nesta versão: ela depende de um servidor.</Note>
      </div>
      <SafetyCopies />

      <div className="section">Privacidade (LGPD)</div>
      <div className="card">
        <Note>Seus dados financeiros ficam somente neste aparelho. O app não tem servidor próprio, não usa seus dados para treinar modelos e só se conecta às fontes de cotação que você escolher (enviando apenas os códigos dos ativos){PAID_AI_ENABLED ? ' e, se você autorizar, ao serviço de IA' : ''}.</Note>
        <div className="btnrow"><button className="btn danger" onClick={async () => { if (confirm('Apagar todos os dados deste aparelho? Esta ação não pode ser desfeita.')) { await wipeAll(); onClose(); } }}>Apagar todos os meus dados</button></div>
      </div>
      <div className="hint" style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12, margin: '16px 0' }}>Grefinacia {__APP_VERSION__} ({__APP_BUILD__}) · {today.slice(0, 4)}</div>

      {acc && <AccountForm a={acc === 'new' ? null : acc} onClose={() => setAcc(null)} />}
      {card && <CardForm c={card === 'new' ? null : card} onClose={() => setCard(null)} />}
      {pin && <PinSheet onClose={() => setPin(false)} />}
      {bk && <BackupSheet mode={bk} onClose={() => setBk(null)} />}
    </Full>
  );
}

const COPY_REASON: Record<SafetyReason, string> = { atualizacao: 'Antes de atualizar o app', restauracao: 'Antes de restaurar', importacao: 'Antes de importar' };

/** Cópias que o app guarda sozinho antes de substituir os dados; permitem desfazer uma restauração. */
function SafetyCopies() {
  const data = useStore((s) => s.data);
  const [list, setList] = useState<SafetyCopyInfo[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    listSafetyCopies().then((l) => alive && setList(l)).catch(() => alive && setList([]));
    return () => { alive = false; };
  }, [data]);
  if (list.length === 0) return null;
  const back = async (id: string) => {
    if (!confirm('Voltar os dados para esta cópia? O que existe agora também fica guardado como cópia, então dá para desfazer.')) return;
    setBusy(true);
    try {
      const ok = await restoreSafetyCopy(id);
      toast(ok ? 'Dados restaurados da cópia' : 'Cópia não encontrada', ok ? 'ok' : 'err');
    } catch { toast('Não foi possível restaurar a cópia', 'err'); } finally { setBusy(false); }
  };
  return (<>
    <div className="section">Cópias automáticas neste aparelho</div>
    <div className="card" style={{ padding: '4px 14px' }}>
      {list.map((c) => (
        <div className="row" key={c.id}>
          <div className="mid"><div className="t">{COPY_REASON[c.reason]}</div><div className="s">{new Date(c.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · {c.records} {c.records === 1 ? 'registro' : 'registros'}</div></div>
          <button className="btn ghost sm" disabled={busy} onClick={() => void back(c.id)}>Voltar para esta</button>
        </div>
      ))}
      <Note>Antes de restaurar um backup ou de atualizar, o app guarda sozinho uma cópia dos dados (as {MAX_SAFETY_COPIES} mais recentes). Elas ficam só neste aparelho e somem se o app for desinstalado: o backup em arquivo continua sendo a proteção principal.</Note>
    </div>
  </>);
}

function AccountForm({ a, onClose }: { a: Account | null; onClose: () => void }) {
  const today = useStore((s) => s.today);
  const count = useStore((s) => s.data.accounts.length);
  const [name, setName] = useState(a?.name ?? '');
  const [kind, setKind] = useState(a?.kind ?? 'corrente');
  const [bal, setBal] = useState(a ? centsToInput(a.initialCents) : '');
  const [date, setDate] = useState(a?.initialDate ?? today);
  return (
    <Sheet title={a ? 'Editar conta' : 'Nova conta'} onClose={onClose}>
      <Field label="Nome"><input name="conta" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Nubank" /></Field>
      <Field label="Tipo"><select value={kind} onChange={(e) => setKind(e.target.value as Account['kind'])}><option value="corrente">Conta corrente</option><option value="poupanca">Poupança</option><option value="carteira">Dinheiro em espécie</option><option value="outro">Outro</option></select></Field>
      <div className="two">
        <Field label="Saldo inicial (R$)"><MoneyInput name="saldo_inicial" value={bal} onChange={setBal} /></Field>
        <Field label="Saldo referente a" hint="Lançamentos anteriores não mudam o saldo"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <div className="btnrow">
        <button className="btn" onClick={async () => { if (!name.trim()) return toast('Informe o nome da conta', 'err'); await upsert('accounts', { id: a?.id ?? uid('a_'), name: name.trim(), kind, initialCents: parseMoney(bal) ?? 0, initialDate: date }); toast('Conta salva'); onClose(); }}>Salvar</button>
        {a && count > 1 && <button className="btn danger" onClick={async () => { await remove('accounts', a.id); toast('Conta removida'); onClose(); }}>Excluir</button>}
      </div>
    </Sheet>
  );
}

function CardForm({ c, onClose }: { c: Card | null; onClose: () => void }) {
  const accounts = useStore((s) => s.data.accounts);
  const [name, setName] = useState(c?.name ?? '');
  const [closing, setClosing] = useState(String(c?.closingDay ?? 25));
  const [due, setDue] = useState(String(c?.dueDay ?? 5));
  const [accountId, setAccountId] = useState(c?.accountId ?? accounts[0]?.id ?? '');
  const d = (v: string) => Math.min(Math.max(Number(v) || 1, 1), 31);
  return (
    <Sheet title={c ? 'Editar cartão' : 'Novo cartão'} onClose={onClose}>
      <Field label="Nome"><input name="cartao" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Cartão Inter" /></Field>
      <div className="two">
        <Field label="Dia do fechamento"><input name="fechamento" inputMode="numeric" value={closing} onChange={(e) => setClosing(e.target.value.replace(/\D/g, ''))} /></Field>
        <Field label="Dia do vencimento"><input name="vencimento" inputMode="numeric" value={due} onChange={(e) => setDue(e.target.value.replace(/\D/g, ''))} /></Field>
      </div>
      <Field label="Conta que paga a fatura"><select value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}</select></Field>
      <div className="btnrow">
        <button className="btn" onClick={async () => { if (!name.trim()) return toast('Informe o nome do cartão', 'err'); await upsert('cards', { id: c?.id ?? uid('c_'), name: name.trim(), closingDay: d(closing), dueDay: d(due), accountId: accountId || undefined }); toast('Cartão salvo'); onClose(); }}>Salvar</button>
        {c && <button className="btn danger" onClick={async () => { await remove('cards', c.id); toast('Cartão removido'); onClose(); }}>Excluir</button>}
      </div>
    </Sheet>
  );
}

function PinSheet({ onClose }: { onClose: () => void }) {
  const st = useStore((s) => s.settings);
  const [first, setFirst] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Sheet title="PIN de bloqueio" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center', padding: '8px 0 16px' }}>
        <PinPad title={first ? 'Repita o PIN' : 'Novo PIN de 6 dígitos'} error={err} onDone={async (p) => {
          if (!first) { setFirst(p); setErr(null); return; }
          if (first !== p) { setFirst(null); setErr('Os PINs não conferem.'); return; }
          const cred = await createCredential(p);
          await updateSettings({ security: { ...st.security, ...cred, enabled: true, kind: 'pin' } });
          toast('PIN definido');
          onClose();
        }} />
      </div>
    </Sheet>
  );
}

function BackupSheet({ mode, onClose }: { mode: 'create' | 'restore'; onClose: () => void }) {
  const data = useStore((s) => s.data);
  const st = useStore((s) => s.settings);
  const today = useStore((s) => s.today);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const create = async () => {
    if (pw.length < 8) return setErr('Use uma senha com pelo menos 8 caracteres.');
    if (pw !== pw2) return setErr('As senhas não conferem.');
    setBusy(true);
    try {
      await saveAndShare(`grefinacia-backup-${today}.gfbackup`, await createBackup(data, st, pw), 'application/json');
      await updateSettings({ lastBackupAt: new Date().toISOString() });
      toast('Backup criado');
      onClose();
    } catch (e) { setErr('Não foi possível salvar: ' + (e instanceof Error ? e.message : 'erro')); } finally { setBusy(false); }
  };
  const restore = async () => {
    const f = file.current?.files?.[0];
    if (!f) return setErr('Escolha o arquivo de backup.');
    setBusy(true);
    try {
      const r = await readBackup(await f.text(), pw);
      await restoreAll(r.data, r.settings);
      toast('Backup restaurado');
      onClose();
    } catch (e) { setErr(e instanceof BackupError ? e.message : 'Não foi possível ler o arquivo.'); } finally { setBusy(false); }
  };
  return (
    <Sheet title={mode === 'create' ? 'Fazer backup' : 'Restaurar backup'} onClose={onClose}>
      {mode === 'restore' && <Field label="Arquivo de backup (.gfbackup)" hint="Restaurar substitui todos os dados atuais deste aparelho."><input ref={file} type="file" style={{ paddingTop: 12 }} /></Field>}
      <Field label="Senha do backup"><input name="senha_backup" type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      {mode === 'create' && <Field label="Repita a senha" hint="Sem essa senha não é possível abrir o backup. Guarde-a em lugar seguro."><input name="senha_backup2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>}
      {err && <div className="neg" role="alert">{err}</div>}
      <div className="btnrow"><button className="btn" disabled={busy} onClick={mode === 'create' ? create : restore}>{busy ? 'Aguarde…' : mode === 'create' ? 'Criar e salvar' : 'Restaurar'}</button></div>
    </Sheet>
  );
}
