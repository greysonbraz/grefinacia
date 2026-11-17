import { useState } from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';
import { disconnectBank, linkBankAccount, loadBankAccounts, syncBank, toast, updateSettings, useStore } from '../state/store';
import { accountBalance } from '../domain/ledger';
import { balanceGap, consentWarning } from '../domain/bankSync';
import { formatBRL } from '../lib/money';
import { formatDateBR } from '../lib/dates';
import { isNative } from '../services/platform';
import { Field, Full, Note } from './kit';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS: Record<string, string> = {
  UPDATED: 'atualizado',
  UPDATING: 'o Meu Pluggy ainda está coletando os dados; tente de novo em alguns minutos',
  LOGIN_ERROR: 'a autorização no banco falhou; reconecte o banco no Meu Pluggy',
  OUTDATED: 'a última atualização falhou; o Meu Pluggy tenta de novo sozinho',
  WAITING_USER_INPUT: 'o banco pede uma confirmação sua no Meu Pluggy',
  WAITING_USER_ACTION: 'o banco pede uma confirmação sua no Meu Pluggy',
  ERRO: 'erro ao consultar',
};
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

/** Conexão bancária pelo Meu Pluggy (Open Finance, uso pessoal gratuito). */
export function BankConnect({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const data = useStore((s) => s.data);
  const bank = useStore((s) => s.bank);
  const today = useStore((s) => s.today);
  const b = settings.bank;
  const [clientId, setClientId] = useState(b.clientId);
  const [secret, setSecret] = useState('');
  const [label, setLabel] = useState('');
  const [itemId, setItemId] = useState('');
  const [busy, setBusy] = useState<'' | 'contas' | 'sync'>('');
  const [errors, setErrors] = useState<string[]>([]);
  const hasCreds = !!(b.clientId && b.clientSecret);

  const saveCreds = async () => {
    if (!clientId.trim()) return toast('Informe o Client ID', 'err');
    if (!secret.trim() && !b.clientSecret) return toast('Informe o Client Secret', 'err');
    await updateSettings({ bank: { ...b, clientId: clientId.trim(), clientSecret: secret.trim() || b.clientSecret } });
    setSecret('');
    toast('Chaves guardadas no cofre do aparelho');
  };
  const addItem = async () => {
    const id = itemId.trim();
    if (!UUID.test(id)) return toast('O Item ID tem o formato 1a2b3c4d-…: copie do Dashboard (Demo → Itens conectados)', 'err');
    if (b.items.some((i) => i.itemId === id)) return toast('Esse banco já está na lista', 'err');
    if (b.items.length >= 5) return toast('O plano gratuito do Meu Pluggy aceita até 5 bancos', 'err');
    await updateSettings({ bank: { ...b, items: [...b.items, { itemId: id, label: label.trim() }] } });
    setItemId('');
    setLabel('');
  };
  const removeItem = async (id: string) => {
    const accIds = bank.accounts.filter((a) => a.itemId === id).map((a) => a.id);
    const links = Object.fromEntries(Object.entries(b.links).filter(([k]) => !accIds.includes(k)));
    await updateSettings({ bank: { ...b, items: b.items.filter((i) => i.itemId !== id), links } });
  };
  const run = async (what: 'contas' | 'sync') => {
    setBusy(what);
    setErrors([]);
    try {
      if (what === 'contas') {
        const r = await loadBankAccounts();
        setErrors(r.errors);
        toast(r.errors.length ? 'Alguns bancos não responderam' : 'Contas carregadas: vincule cada uma abaixo', r.errors.length ? 'err' : 'ok');
      } else {
        const r = await syncBank();
        setErrors(r.errors);
        toast(r.imported ? `${r.imported} ${r.imported === 1 ? 'lançamento novo' : 'lançamentos novos'}` : r.errors.length ? 'A sincronização teve erros' : 'Nada novo desde a última vez', r.errors.length && !r.accounts ? 'err' : 'ok');
      }
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)]);
    } finally {
      setBusy('');
    }
  };
  const choiceOf = (accId: string) => {
    const l = b.links[accId];
    return !l ? '' : l.kind === 'ignorar' ? 'ignorar' : `${l.kind}:${l.id}`;
  };
  const linked = bank.accounts.filter((a) => b.links[a.id] && b.links[a.id].kind !== 'ignorar');

  return (
    <Full title="Conexão bancária" onBack={onClose}>
      <div className="card">
        <h2>Como funciona</h2>
        <div className="hint">
          Pelo <b>Meu Pluggy</b> (gratuito para uso pessoal, regulado pelo Banco Central), o app lê saldos, extratos e cartões dos bancos que você autorizou no Open Finance.
          Os lançamentos entram como numa importação de extrato: sem duplicar, com categoria automática e com "Desfazer". O app só lê; nunca movimenta dinheiro.
        </div>
        {!isNative() && <Note>No navegador a conexão não funciona: use o app Android.</Note>}
      </div>

      <div className="section">1. Chaves da sua aplicação na Pluggy</div>
      <div className="card">
        <Field label="Client ID"><input name="pluggy_id" value={clientId} onChange={(e) => setClientId(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} /></Field>
        <Field label="Client Secret" hint={b.clientSecret ? 'Guardado. Preencha só se quiser trocar.' : 'Aparece uma vez no Dashboard; se perdeu, gere outro lá.'}>
          <input name="pluggy_secret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={b.clientSecret ? '••••••••' : ''} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        </Field>
        <div className="btnrow"><button className="btn" onClick={saveCreds}>Guardar chaves</button></div>
        <Note>As chaves ficam só no cofre deste celular (Android Keystore). Não vão para a nuvem, para o backup nem para o GitHub, e não são mostradas de novo. Quem tiver as duas lê os dados dos bancos conectados: não envie para ninguém.</Note>
      </div>

      <div className="section">2. Bancos (um Item ID por banco)</div>
      <div className="card">
        {b.items.map((i) => (
          <div className="kv" key={i.itemId}>
            <span>{i.label || bank.items[i.itemId]?.name || 'Banco'}<br /><span className="hint">{i.itemId.slice(0, 8)}…{bank.items[i.itemId]?.status ? ` · ${STATUS[bank.items[i.itemId].status] ?? bank.items[i.itemId].status}` : ''}{bank.items[i.itemId]?.error ? ` · ${bank.items[i.itemId].error}` : ''}</span></span>
            <button className="link" onClick={() => removeItem(i.itemId)} aria-label={`Remover ${i.label || i.itemId}`}><Trash2 size={16} /></button>
          </div>
        ))}
        <div className="two">
          <Field label="Nome (opcional)"><input name="pluggy_label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Inter" /></Field>
          <Field label="Item ID"><input name="pluggy_item" value={itemId} onChange={(e) => setItemId(e.target.value)} placeholder="1a2b3c4d-…" autoCapitalize="off" autoCorrect="off" spellCheck={false} /></Field>
        </div>
        <div className="btnrow"><button className="btn ghost" onClick={addItem}>Adicionar banco</button></div>
        <Note>No Dashboard da Pluggy: Aplicações → sua aplicação → Demo → Itens conectados → clique no banco e copie o id. Cada banco conectado no Meu Pluggy é um item.</Note>
        {Object.entries(bank.items).map(([id, it]) => {
          const w = consentWarning(it.consentExpiresAt, today);
          return w ? <div key={id} className="note neg">{it.name}: a autorização do Meu Pluggy {w.expired ? 'venceu' : `vence em ${w.days} dias`}. Renove no Dashboard: Demo → Conectar conta → MeuPluggy.</div> : null;
        })}
      </div>

      <div className="section">3. Onde cada conta entra no app</div>
      <div className="card">
        {!hasCreds && <Note>Guarde as chaves no passo 1 para liberar este botão.</Note>}
        {hasCreds && !b.items.length && <Note>Adicione pelo menos um banco no passo 2 (botão "Adicionar banco").</Note>}
        <button className="btn ghost" disabled={!hasCreds || !b.items.length || !!busy} onClick={() => run('contas')}><RefreshCw size={16} style={busy === 'contas' ? { animation: 'spin 1s linear infinite' } : undefined} /> Buscar contas dos bancos</button>
        {bank.accounts.map((a) => (
          <Field key={a.id} label={`${a.bankName} · ${a.marketingName || a.name}${a.number ? ` (${String(a.number).slice(-4)})` : ''} · ${a.type === 'CREDIT' ? 'cartão' : 'conta'}`}>
            <select value={choiceOf(a.id)} onChange={async (e) => { if (e.target.value) await linkBankAccount(a.id, e.target.value); }} aria-label={`Destino de ${a.name}`}>
              <option value="" disabled>Escolha…</option>
              <option value="novo">{a.type === 'CREDIT' ? 'Criar cartão novo' : 'Criar conta nova'}</option>
              {a.type === 'CREDIT'
                ? data.cards.map((c) => (<option key={c.id} value={`cartao:${c.id}`}>Cartão: {c.name}</option>))
                : data.accounts.filter((x) => !x.archived).map((x) => (<option key={x.id} value={`conta:${x.id}`}>Conta: {x.name}</option>))}
              <option value="ignorar">Não importar</option>
            </select>
          </Field>
        ))}
        {Object.keys(bank.items).length > 0 && bank.accounts.length === 0 && <Note>O Meu Pluggy não devolveu nenhuma conta ainda. Veja o status do banco no passo 2; se estiver coletando, espere uns minutos e busque de novo.</Note>}
        {bank.accounts.length > 0 && <Note>Escolha um destino para cada conta (escolher "Criar…" cria na hora). Conta criada pela conexão começa com o saldo do banco; o histórico importado entra nos relatórios sem mudar esse saldo.</Note>}
        <Field label="Na primeira vez, buscar histórico de">
          <select value={b.historyDays} onChange={(e) => updateSettings({ bank: { ...b, historyDays: Number(e.target.value) } })}>
            {[30, 90, 180, 365].map((d) => (<option key={d} value={d}>{d === 365 ? '12 meses' : `${d} dias`}</option>))}
          </select>
        </Field>
      </div>

      <div className="section">4. Sincronizar</div>
      <div className="card">
        <button className="btn" disabled={!linked.length || !!busy} onClick={() => run('sync')}><RefreshCw size={16} style={busy === 'sync' ? { animation: 'spin 1s linear infinite' } : undefined} /> Sincronizar agora</button>
        {!linked.length && bank.accounts.length > 0 && <Note>Escolha o destino de cada conta no passo 3 para liberar este botão.</Note>}
        <div className="kv"><span>Última sincronização</span><b>{when(bank.lastOkAt)}</b></div>
        {(bank.report ?? []).map((r) => (
          <div className="kv" key={r.account}>
            <span>{r.account}<br /><span className="hint">{r.error ? r.error : [
              `desde ${formatDateBR(r.from)}: ${r.received} ${r.received === 1 ? 'lançamento' : 'lançamentos'} no banco`,
              r.already ? `${r.already} já estavam no app` : '',
              r.similar ? `${r.similar} parecidos com lançamentos que você já tinha (ficaram de fora)` : '',
              r.invoice ? `${r.invoice} pagamentos de fatura` : '',
              r.pending ? `${r.pending} agendados/pendentes` : '',
              r.payments ? `${r.payments} pagamentos do cartão` : '',
              r.foreign ? `${r.foreign} em moeda estrangeira sem valor em reais` : '',
              r.received === 0 ? 'o banco ainda não mandou nada para esse período' : '',
            ].filter(Boolean).join(' · ')}</span></span>
            <b className={'num ' + (r.error ? 'warn' : r.imported ? 'pos' : '')}>{r.error ? 'erro' : `+${r.imported}`}</b>
          </div>
        ))}
        {bank.error && <div className="note neg">{bank.error}</div>}
        {errors.map((e) => (<div className="note neg" key={e}>{e}</div>))}
        {linked.map((a) => {
          const l = b.links[a.id];
          if (l.kind !== 'conta') return null;
          const acc = data.accounts.find((x) => x.id === l.id);
          if (!acc) return null;
          const gap = balanceGap(a.balance, accountBalance(acc, data));
          return <div className="kv" key={a.id}><span>{acc.name}<br /><span className="hint">banco {formatBRL(Math.round(a.balance * 100))} · app {formatBRL(accountBalance(acc, data))}</span></span><b className={'num ' + (Math.abs(gap) <= 100 ? 'pos' : 'warn')}>{Math.abs(gap) <= 100 ? 'confere' : `diferença ${formatBRL(gap)}`}</b></div>;
        })}
        <Note>
          {isNative() ? 'O app sincroniza sozinho ao abrir, no máximo a cada 12 horas. ' : ''}O Meu Pluggy atualiza os bancos a cada 24 h; o saldo do banco é o da última atualização dele
          {Object.values(bank.items)[0]?.lastUpdatedAt ? ` (${formatDateBR(Object.values(bank.items)[0].lastUpdatedAt!.slice(0, 10))})` : ''}.
          Lançamentos parecidos com um que você já tinha ficam de fora para não duplicar; cada sincronização aparece em Movimentações → Importar → Importações anteriores, com "Desfazer".
          Créditos de dividendos, JCP e rendimentos confirmam os proventos sozinhos.
        </Note>
      </div>

      {(hasCreds || b.items.length > 0) && (
        <button className="btn danger" onClick={async () => { if (typeof window.confirm !== 'function' || window.confirm('Desconectar? As chaves saem do cofre; os lançamentos já importados ficam.')) { await disconnectBank(); setClientId(''); toast('Conexão removida deste aparelho'); } }}>Desconectar</button>
      )}
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
    </Full>
  );
}
