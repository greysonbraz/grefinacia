import { useEffect, useRef, useState } from 'react';
import { remove, restoreAll, restoreSafetyCopy, toast, updateSettings, upsert, useStore, wipeAll, afterChange } from '../state/store';
import { listSafetyCopies, MAX_SAFETY_COPIES, type SafetyCopyInfo, type SafetyReason } from '../db/db';
import type { Account, Card, Category, Settings as S, TxType } from '../lib/types';
import { accountBalance, cardUsedCents } from '../domain/ledger';
import { DEFAULT_CATEGORIES } from '../lib/categories';
import { centsToInput, formatBRL, parseMoney } from '../lib/money';
import { formatDateBR } from '../lib/dates';
import { uid } from '../lib/ids';
import { biometricAvailable, createCredential } from '../services/security';
import { notificationPermission, requestNotificationPermission } from '../services/notify';
import { BackupError, createBackup, readBackup, saveAndShare } from '../services/backup';
import { isNative } from '../services/platform';
import { PAID_AI_ENABLED } from '../lib/flags';
import { cloudDeleteAll, cloudHasVault, cloudLogin, cloudLogout, cloudStatus, cloudSync, cloudUnlock, lastSyncAt, type CloudStatus } from '../state/cloud';
import { MIN_PASSPHRASE } from '../services/vault';
import { Field, Full, Ico, MoneyInput, Note, Progress, Seg, Sheet, SwitchRow } from './kit';
import { brapiQuota, getUsage } from '../services/usage';
import { PinPad } from './Lock';
import { nanoDownload, nanoStatus, NANO_STATE_LABEL, type NanoStatus } from '../services/nano';
import { ImportStatement } from './Import';
import { BankConnect } from './Bank';

const NOTIF: [keyof S['notifications']['types'], string, string][] = [
  ['salary', 'Salário', 'No dia do pagamento e ao confirmar o recebimento'],
  ['billsDue', 'Contas perto do vencimento', 'Dias antes e no dia'],
  ['cardInvoice', 'Fatura do cartão', 'Vencimento (com o valor) e o dia antes de fechar'],
  ['monthlyReport', 'Relatório do mês', 'No dia 1, quanto entrou, saiu e sobrou no mês que fechou'],
  ['overdue', 'Contas atrasadas', 'Lembrete diário por 3 dias'],
  ['dividendAnnounced', 'Proventos anunciados', 'Quando a fonte de dados trouxer um anúncio novo'],
  ['dividendSoon', 'Proventos perto do pagamento', 'Dias antes da data'],
  ['dividendReceived', 'Dia de pagamento de proventos', 'Para você confirmar o recebimento'],
  ['dividendDataCom', 'Data-com chegando', 'Último dia para ter direito ao provento'],
  ['dividendChanged', 'Provento confirmado, alterado ou cancelado', 'Quando o extrato confirmar ou a fonte mudar um evento'],
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
  const [cat, setCat] = useState<Category | 'new' | null>(null);
  const [transfer, setTransfer] = useState(false);
  const accName = (id: string) => (!id ? 'fora do app' : data.accounts.find((a) => a.id === id)?.name ?? 'conta removida');
  const [pin, setPin] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);
  const [importing, setImporting] = useState(false);
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
        {data.accounts.length > 1 && <button className="row link" onClick={() => setTransfer(true)}>Transferir entre contas</button>}
      </div>
      {data.transfers.length > 0 && (<>
        <div className="section">Últimas transferências</div>
        <div className="card" style={{ padding: '4px 14px' }}>
          {[...data.transfers].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 5).map((t) => (
            <div className="row" key={t.id}>
              <div className="mid"><div className="t">{accName(t.fromAccountId)} → {accName(t.toAccountId)}</div><div className="s">{formatDateBR(t.date)}{t.kind === 'investimento' ? ' · investimento' : t.kind === 'propria' ? ' · entre contas suas' : t.kind === 'cambio' ? ' · câmbio (dólar)' : ''}{t.note ? ' · ' + t.note : ''}</div></div>
              <div className="end num">{formatBRL(t.amountCents)}</div>
              <button className="btn danger sm" onClick={async () => { if (confirm('Desfazer esta transferência?')) { await remove('transfers', t.id); toast('Transferência desfeita'); } }}>Desfazer</button>
            </div>
          ))}
        </div>
      </>)}
      <div className="section">Cartões de crédito</div>
      <div className="card" style={{ padding: '4px 14px' }}>
        {data.cards.map((c) => (<button className="row" key={c.id} onClick={() => setCard(c)}><div className="mid"><div className="t">{c.name}</div><div className="s">Fecha dia {c.closingDay} · vence dia {c.dueDay}{c.limitCents ? ` · usado ${formatBRL(cardUsedCents(c.id, data))} de ${formatBRL(c.limitCents)}` : ''}</div></div></button>))}
        <button className="row link" onClick={() => setCard('new')}>+ Adicionar cartão</button>
        <SwitchRow title="Compra no cartão conta no mês da fatura" sub={st.cardMonth === 'compra' ? 'Desligado: conta no mês da compra' : 'O gasto entra no mês em que a fatura vence (quando o dinheiro sai). O que você compra agora aparece como previsão do mês da fatura.'} on={st.cardMonth !== 'compra'} onChange={(on) => void updateSettings({ cardMonth: on ? 'fatura' : 'compra' })} />
      </div>
      <div className="section">Categorias</div>
      <div className="card" style={{ padding: '4px 14px' }}>
        {data.categories.filter((c) => !DEFAULT_IDS.has(c.id)).map((c) => (<button className="row" key={c.id} onClick={() => setCat(c)}><div className="ic"><Ico name={c.icon} /></div><div className="mid"><div className="t">{c.name}</div><div className="s">{c.type === 'income' ? 'Receita' : 'Despesa'} · criada por você</div></div></button>))}
        <button className="row link" onClick={() => setCat('new')}>+ Criar categoria</button>
        <div className="hint" style={{ padding: '8px 0' }}>Além das {DEFAULT_CATEGORIES.length} categorias que já vêm com o app.</div>
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
        {NOTIF.map(([k, t, s]) => (<SwitchRow key={k} title={t} sub={s} on={n.types[k] !== false} onChange={(on) => setN({ types: { ...n.types, [k]: on } })} />))}
        <Note>Lembretes com data (contas, salário, proventos) são agendados no Android e chegam com o app fechado. Alertas de orçamento e saldo são calculados quando você usa o app. Na Samsung, deixe o Grefinacia como "Não restrito" em Bateria para não atrasar avisos.</Note>
      </div>

      <div className="section">Cotações e proventos</div>
      <div className="card">
        <Field label="Fonte das cotações"><select value={st.api.quoteProvider} onChange={(e) => setApi({ quoteProvider: e.target.value as never })}><option value="brapi">brapi.dev (recomendada)</option><option value="yahoo">Yahoo Finance (não oficial)</option><option value="manual">Nenhuma: preço manual</option></select></Field>
        <Field label="Fonte dos proventos"><select value={st.api.dividendProvider} onChange={(e) => setApi({ dividendProvider: e.target.value as never })}><option value="auto">Automática (recomendada)</option><option value="brapi">brapi.dev (plano Startup ou Pro)</option><option value="yahoo">Yahoo Finance (não oficial)</option><option value="manual">Nenhuma: cadastro manual</option></select></Field>
        <Field label="Token da brapi.dev" hint="Crie grátis em brapi.dev/dashboard. Sem token só funcionam PETR4, VALE3, ITUB4 e MGLU3."><input name="token" value={st.api.brapiToken} onChange={(e) => setApi({ brapiToken: e.target.value })} autoCapitalize="off" autoCorrect="off" /></Field>
        <Field label="Seu plano na brapi"><select value={st.api.brapiPlan} onChange={(e) => setApi({ brapiPlan: e.target.value as never })}><option value="free">Gratuito (1 ativo por consulta, sem proventos)</option><option value="startup">Startup</option><option value="pro">Pro</option></select></Field>
        <Note>Cotações têm atraso (não são tempo real). O Yahoo Finance é uma fonte não oficial, pode parar de funcionar e só responde no app Android.</Note>
        <QuotaBox plan={st.api.brapiPlan} />
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
          <Note>A Grefinacia AI responde por cálculos feitos no próprio aparelho, sem cobrança{st.ai.nano ? '' : ': nenhum dado sai dele'}. A opção de IA externa paga está desativada nesta versão.</Note>
          <NanoBox on={st.ai.nano} onChange={(nano) => setAi({ nano })} />
        </>)}
      </div>

      <div className="section">Bancos e pagamentos (Open Finance)</div>
      <div className="card">
        <div className="kv"><span>Importar extrato (OFX ou CSV)</span><button className="btn sm" onClick={() => setImporting(true)}>Importar</button></div>
        <div className="kv"><span>Conexão bancária (Meu Pluggy){st.bank.items.length ? ` · ${st.bank.items.length} ${st.bank.items.length === 1 ? 'banco' : 'bancos'}` : ''}</span><button className="btn sm" onClick={() => setBankOpen(true)}>Abrir</button></div>
        <div className="kv"><span>Pagamentos automáticos</span><b>Não disponível nesta versão</b></div>
        <Note>A leitura de saldos e extratos usa o Meu Pluggy, gratuito para uso pessoal e regulado pelo Banco Central: você autoriza cada banco no Open Finance e pode revogar quando quiser. Pagamentos automáticos não existem: o app só lê e nunca movimenta dinheiro. Nenhuma senha bancária é pedida ou armazenada.</Note>
      </div>

      <div className="section">Backup e outros aparelhos</div>
      <div className="card">
        <div className="kv"><span>Último backup</span><b>{st.lastBackupAt ? formatDateBR(st.lastBackupAt.slice(0, 10)) : 'nunca'}</b></div>
        <div className="btnrow"><button className="btn" onClick={() => setBk('create')}>Fazer backup</button><button className="btn ghost" onClick={() => setBk('restore')}>Restaurar</button></div>
        <Note>O backup é um arquivo criptografado com a senha que você escolher. Salve no Google Drive e use "Restaurar" em outro aparelho para levar seus dados. Para sincronizar sozinho entre aparelhos, use a nuvem logo abaixo.</Note>
      </div>
      <SafetyCopies />
      <CloudCard />

      <div className="section">Privacidade (LGPD)</div>
      <div className="card">
        <Note>Seus dados financeiros ficam somente neste aparelho. O app não tem servidor próprio, não usa seus dados para treinar modelos e só se conecta às fontes de cotação que você escolher (enviando apenas os códigos dos ativos){PAID_AI_ENABLED ? ' e, se você autorizar, ao serviço de IA' : ''}.{st.ai.nano ? ' Com a IA no aparelho (Gemini Nano) ligada, o Google recebe métricas de uso do ML Kit, não o conteúdo das perguntas.' : ''}</Note>
        <div className="btnrow"><button className="btn danger" onClick={async () => { if (confirm('Apagar todos os dados deste aparelho? Esta ação não pode ser desfeita.')) { await wipeAll(); onClose(); } }}>Apagar todos os meus dados</button></div>
      </div>
      <div className="hint" style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12, margin: '16px 0' }}>Grefinacia {__APP_VERSION__} ({__APP_BUILD__}) · {today.slice(0, 4)}</div>

      {acc && <AccountForm a={acc === 'new' ? null : acc} onClose={() => setAcc(null)} />}
      {card && <CardForm c={card === 'new' ? null : card} onClose={() => setCard(null)} />}
      {cat && <CategoryForm c={cat === 'new' ? null : cat} onClose={() => setCat(null)} />}
      {transfer && <TransferForm onClose={() => setTransfer(false)} />}
      {pin && <PinSheet onClose={() => setPin(false)} />}
      {bk && <BackupSheet mode={bk} onClose={() => setBk(null)} />}
      {importing && <ImportStatement onClose={() => setImporting(false)} />}
      {bankOpen && <BankConnect onClose={() => setBankOpen(false)} />}
    </Full>
  );
}

/** Conta Google e cópia cifrada na nuvem. Opcional: sem isto o app funciona igual. */
function CloudCard() {
  const [st, setSt] = useState<CloudStatus | null>(null);
  const [hasVault, setHasVault] = useState<boolean | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const refresh = async () => {
    const s = await cloudStatus();
    setSt(s);
    if (s.email && !s.unlocked) setHasVault(await cloudHasVault().catch(() => null));
  };
  useEffect(() => { void refresh(); }, []);
  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true); setErr(null);
    try { const msg = await fn(); if (msg) toast(msg); await refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Não foi possível concluir.'); }
    finally { setBusy(false); }
  };
  const unlock = () => run(async () => {
    if (hasVault === false) {
      if (pw.length < MIN_PASSPHRASE) throw new Error(`Use pelo menos ${MIN_PASSPHRASE} caracteres.`);
      if (pw !== pw2) throw new Error('As senhas não conferem.');
    }
    await cloudUnlock(pw); setPw(''); setPw2('');
    return 'Nuvem pronta neste aparelho';
  });
  if (!st) return null;
  return (<>
    <div className="section">Conta e nuvem</div>
    <div className="card">
      {!st.email ? (<>
        <div className="kv"><span>Conta</span><b>Não conectada</b></div>
        <div className="btnrow"><button className="btn" disabled={busy} onClick={() => void run(async () => { await cloudLogin(); return 'Conectado'; })}>{busy ? 'Aguarde…' : 'Entrar com Google'}</button></div>
        <Note>Opcional. Serve para guardar uma cópia cifrada dos seus dados na nuvem e levá-los a outro aparelho. Sem entrar, o app funciona igual e nada sai do celular.</Note>
      </>) : !st.unlocked ? (<>
        <div className="kv"><span>Conta</span><b>{st.email}</b></div>
        <Field label={hasVault === false ? 'Crie uma senha de sincronização' : 'Senha de sincronização'} hint={hasVault === false ? 'Ela cifra seus dados antes de saírem do aparelho. Se você esquecê-la, a cópia da nuvem não pode ser aberta por ninguém.' : 'A mesma que você criou no primeiro aparelho.'}><input name="senha_sync" type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        {hasVault === false && <Field label="Repita a senha"><input name="senha_sync2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>}
        <div className="btnrow"><button className="btn" disabled={busy || !pw} onClick={() => void unlock()}>{busy ? 'Aguarde…' : 'Continuar'}</button><button className="btn ghost" disabled={busy} onClick={() => void run(async () => { await cloudLogout(); })}>Sair</button></div>
      </>) : (<>
        <div className="kv"><span>Conta</span><b>{st.email}</b></div>
        <div className="kv"><span>Última sincronização</span><b>{lastSyncAt() ? new Date(lastSyncAt()).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'ainda não'}</b></div>
        <div className="btnrow"><button className="btn" disabled={busy} onClick={() => void run(async () => { const r = await cloudSync(); return `Sincronizado: ${r.pushed} enviados, ${r.pulled} recebidos` + (r.skipped ? `, ${r.skipped} ilegíveis` : ''); })}>{busy ? 'Aguarde…' : 'Sincronizar agora'}</button></div>
        <div className="btnrow"><button className="btn ghost sm" disabled={busy} onClick={() => void run(async () => { await cloudLogout(); })}>Sair da conta</button><button className="btn danger sm" disabled={busy} onClick={() => { if (confirm('Apagar a cópia da nuvem? Os dados deste aparelho continuam.')) void run(async () => { await cloudDeleteAll(); return 'Cópia da nuvem apagada'; }); }}>Apagar cópia da nuvem</button></div>
        <Note>Os dados são cifrados neste aparelho antes de subir; o servidor só guarda texto cifrado. O PIN, o token da brapi e as chaves não sobem. A sincronização roda sozinha ao abrir o app e pouco depois de cada alteração; em outro aparelho, entre com a mesma conta e a mesma senha. Se o mesmo lançamento for alterado em dois aparelhos, vale a alteração mais recente.</Note>
      </>)}
      {err && <div className="neg" role="alert">{err}</div>}
    </div>
  </>);
}

const DEFAULT_IDS = new Set(DEFAULT_CATEGORIES.map((c) => c.id));
const CATEGORY_ICONS = ['Tag', 'Home', 'Car', 'ShoppingCart', 'Utensils', 'HeartPulse', 'GraduationCap', 'Gamepad2', 'Plane', 'PawPrint', 'Baby', 'Dumbbell', 'Smartphone', 'Wrench', 'Briefcase', 'Gift', 'Coins', 'Wallet'];

function CategoryForm({ c, onClose }: { c: Category | null; onClose: () => void }) {
  const data = useStore((s) => s.data);
  const [name, setName] = useState(c?.name ?? '');
  const [type, setType] = useState<TxType>(c?.type ?? 'expense');
  const [icon, setIcon] = useState(c?.icon ?? 'Tag');
  const inUse = c ? data.transactions.some((t) => t.categoryId === c.id) || data.recurrences.some((r) => r.categoryId === c.id) : false;
  const save = async () => {
    const n = name.trim();
    if (!n) return toast('Informe o nome da categoria', 'err');
    if (data.categories.some((x) => x.id !== c?.id && x.type === type && x.name.toLowerCase() === n.toLowerCase())) return toast('Já existe uma categoria com esse nome', 'err');
    await upsert('categories', { id: c?.id ?? uid('cat_'), name: n, icon, type });
    toast('Categoria salva');
    onClose();
  };
  return (
    <Sheet title={c ? 'Editar categoria' : 'Nova categoria'} onClose={onClose}>
      {!c && <Seg value={type} onChange={setType} options={[['expense', 'Despesa'], ['income', 'Receita']]} />}
      <Field label="Nome"><input name="categoria" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Pets" /></Field>
      <Field label="Ícone">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {CATEGORY_ICONS.map((i) => (<button key={i} type="button" className="iconbtn" aria-label={i} aria-pressed={icon === i} style={icon === i ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined} onClick={() => setIcon(i)}><Ico name={i} /></button>))}
        </div>
      </Field>
      <div className="btnrow">
        <button className="btn" onClick={() => void save()}>Salvar</button>
        {c && <button className="btn danger" disabled={inUse} onClick={async () => { await remove('categories', c.id); toast('Categoria removida'); onClose(); }}>Excluir</button>}
      </div>
      {c && inUse && <Note>Esta categoria tem lançamentos. Para excluir, mude a categoria desses lançamentos antes.</Note>}
    </Sheet>
  );
}

export function TransferForm({ onClose }: { onClose: () => void }) {
  const data = useStore((s) => s.data);
  const today = useStore((s) => s.today);
  const accounts = data.accounts.filter((a) => !a.archived);
  const [from, setFrom] = useState(accounts[0]?.id ?? '');
  const [to, setTo] = useState(accounts[1]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const save = async () => {
    const cents = parseMoney(amount);
    if (!cents || cents <= 0) return toast('Informe um valor maior que zero', 'err');
    if (!from || !to || from === to) return toast('Escolha duas contas diferentes', 'err');
    await upsert('transfers', { id: uid('tr_'), fromAccountId: from, toAccountId: to, amountCents: cents, date, note: note.trim() || undefined, createdAt: Date.now() });
    toast('Transferência registrada');
    onClose();
  };
  const fromAcc = accounts.find((a) => a.id === from);
  return (
    <Sheet title="Transferir entre contas" onClose={onClose}>
      <div className="two">
        <Field label="De"><select name="de" value={from} onChange={(e) => setFrom(e.target.value)}>{accounts.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}</select></Field>
        <Field label="Para"><select name="para" value={to} onChange={(e) => setTo(e.target.value)}>{accounts.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}</select></Field>
      </div>
      <div className="two">
        <Field label="Valor (R$)" hint={fromAcc ? `Saldo: ${formatBRL(accountBalance(fromAcc, data))}` : undefined}><MoneyInput name="valor_transferencia" value={amount} onChange={setAmount} /></Field>
        <Field label="Data"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <Field label="Observação (opcional)"><input value={note} maxLength={60} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="btnrow"><button className="btn" onClick={() => void save()}>Transferir</button></div>
      <Note>Transferência só muda o dinheiro de conta: não entra como receita nem como despesa, e o app não movimenta dinheiro de verdade.</Note>
    </Sheet>
  );
}

const COPY_REASON: Record<SafetyReason, string> = { atualizacao: 'Antes de atualizar o app', restauracao: 'Antes de restaurar', importacao: 'Antes de importar', sincronizacao: 'Antes da primeira sincronização' };

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
  const [limit, setLimit] = useState(c?.limitCents ? centsToInput(c.limitCents) : '');
  const d = (v: string) => Math.min(Math.max(Number(v) || 1, 1), 31);
  return (
    <Sheet title={c ? 'Editar cartão' : 'Novo cartão'} onClose={onClose}>
      <Field label="Nome"><input name="cartao" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Cartão Inter" /></Field>
      <div className="two">
        <Field label="Dia do fechamento"><input name="fechamento" inputMode="numeric" value={closing} onChange={(e) => setClosing(e.target.value.replace(/\D/g, ''))} /></Field>
        <Field label="Dia do vencimento"><input name="vencimento" inputMode="numeric" value={due} onChange={(e) => setDue(e.target.value.replace(/\D/g, ''))} /></Field>
      </div>
      <Field label="Limite do cartão (R$, opcional)" hint="Usado para mostrar quanto do limite está tomado."><MoneyInput name="limite" value={limit} onChange={setLimit} /></Field>
      <Field label="Conta que paga a fatura"><select value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}</select></Field>
      <div className="btnrow">
        <button className="btn" onClick={async () => { if (!name.trim()) return toast('Informe o nome do cartão', 'err'); await upsert('cards', { id: c?.id ?? uid('c_'), name: name.trim(), closingDay: d(closing), dueDay: d(due), accountId: accountId || undefined, limitCents: parseMoney(limit) || undefined }); toast('Cartão salvo'); onClose(); }}>Salvar</button>
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

/** Consultas feitas neste mês pelas fontes gratuitas, contadas neste aparelho. */
function QuotaBox({ plan }: { plan: S['api']['brapiPlan'] }) {
  const u = getUsage();
  const q = brapiQuota(plan, u);
  const n = (x: number) => x.toLocaleString('pt-BR');
  return (
    <div style={{ marginTop: 10 }}>
      <div className="kv"><span>Consultas à brapi neste mês</span><b className={'num ' + (q.exhausted ? 'neg' : q.low ? 'warn' : '')}>{n(q.used)} de {n(q.limit)}</b></div>
      <Progress pct={Math.min(q.pct, 100)} tone={q.low ? 'over' : undefined} />
      <div className="kv"><span>CoinGecko · Banco Central · Yahoo</span><b className="num">{n(u.counts.coingecko)} · {n(u.counts.bcb)} · {n(u.counts.yahoo)}</b></div>
      <Note>
        {q.exhausted ? 'A cota da brapi deste mês acabou: o app não consulta mais até o dia 1º. ' : q.low ? 'A cota da brapi está no fim: o histórico de preços só é buscado quando você pede. ' : ''}
        Contagem deste aparelho, com o app aberto. Outro aparelho com o mesmo token e a verificação de proventos em segundo plano não entram, então o uso real pode ser um pouco maior. CoinGecko e Banco Central são gratuitos e sem cota mensal neste uso.
      </Note>
    </div>
  );
}

/** Gemini Nano no aparelho (experimental): ligar, ver o estado e baixar o modelo. */
function NanoBox({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  const [st, setSt] = useState<NanoStatus | null>(null);
  const [mb, setMb] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (on) void nanoStatus(true).then(setSt); }, [on]);
  const download = async () => {
    setErr(null);
    setMb(0);
    try {
      setSt(await nanoDownload((b) => setMb(Math.round(b / 1048576))));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Falhou. Tente de novo no Wi-Fi.');
      setSt(await nanoStatus(true));
    } finally {
      setMb(null);
    }
  };
  return (
    <div style={{ marginTop: 10 }}>
      <SwitchRow title="IA no aparelho (Gemini Nano)" sub="Experimental. Responde perguntas livres que as regras não entendem." on={on} onChange={onChange} />
      {on && (<>
        <div className="kv"><span>Estado</span><b>{st ? NANO_STATE_LABEL[st.state] : 'Verificando…'}</b></div>
        {st?.state === 'baixar' && mb === null && <button className="btn ghost" onClick={download}>Baixar o modelo</button>}
        {mb !== null && <div className="hint">Baixando… {mb} MB</div>}
        {st?.state === 'baixando' && mb === null && <button className="btn ghost" onClick={async () => setSt(await nanoStatus(true))}>Verificar de novo</button>}
        {err && <div className="neg" role="alert">{err}</div>}
        {st?.state === 'indisponivel' && <Note>Pode ser que o Android ainda esteja preparando o serviço de IA (AICore): com internet, isso leva de minutos a horas. Reiniciar o celular costuma ajudar. Celulares com bootloader desbloqueado não são aceitos.</Note>}
      </>)}
      <Note>
        Roda no próprio celular, sem custo. O texto das perguntas e dos seus dados não sai do aparelho. Ao usar, a biblioteca do Google (ML Kit) envia ao Google métricas de uso: modelo do aparelho, identificadores de instalação, tempo de resposta, tamanho das mensagens e erros.
        É um recurso em teste do Google (beta), pode errar e mudar. As contas exatas continuam vindo das regras do app; a IA só entra quando elas não reconhecem a pergunta. Não é conselho financeiro profissional.
      </Note>
    </div>
  );
}
