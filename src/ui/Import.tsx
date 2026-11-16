import { useMemo, useRef, useState } from 'react';
import { FileUp, Undo2 } from 'lucide-react';
import { applyImport, toast, undoImport, useStore } from '../state/store';
import { parseStatement, StatementError, type Statement } from '../domain/statement';
import { buildPreview, buildTransactions, learnedRules, makeBatch, previewTotals, rowsBeforeAccountStart, type PreviewRow, type Target } from '../domain/importer';
import { formatBRL } from '../lib/money';
import { formatDateBR } from '../lib/dates';
import { uid } from '../lib/ids';
import { Field, Full, Note, SwitchRow } from './kit';

const SOURCE_LABEL: Record<PreviewRow['categorySource'], string> = { regra: 'sua regra', historico: 'como antes', palavra: 'sugerida', padrao: 'sem palpite' };
const MAX_ROWS_SHOWN = 400;

/** Importar extrato da conta ou fatura do cartão (OFX ou CSV), com prévia, e desfazer importações. */
export function ImportStatement({ onClose }: { onClose: () => void }) {
  const data = useStore((s) => s.data);
  const settings = useStore((s) => s.settings);
  const today = useStore((s) => s.today);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; st: Statement } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [target, setTarget] = useState<string>(''); // "conta:<id>" ou "cartao:<id>"
  const [invert, setInvert] = useState(false);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [original, setOriginal] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);

  const accounts = data.accounts.filter((a) => !a.archived);
  const tgt: Target | null = target.startsWith('conta:') ? { kind: 'conta', accountId: target.slice(6) } : target.startsWith('cartao:') ? { kind: 'cartao', cardId: target.slice(7) } : null;

  const rebuild = (st: Statement, t: Target | null, inv: boolean) => {
    if (!t) return setRows([]);
    const r = buildPreview(st, t, data, settings, inv);
    setRows(r);
    setOriginal(new Map(r.map((x) => [x.key, x.categoryId])));
  };
  const pick = async (f: File | undefined) => {
    setErr(null);
    if (!f) return;
    try {
      const st = parseStatement(new Uint8Array(await f.arrayBuffer()));
      // destino provável: fatura → primeiro cartão; conta → primeira conta
      const guess = st.kind === 'cartao' && data.cards[0] ? `cartao:${data.cards[0].id}` : accounts[0] ? `conta:${accounts[0].id}` : data.cards[0] ? `cartao:${data.cards[0].id}` : '';
      setFile({ name: f.name, st });
      setTarget(guess);
      setInvert(false);
      rebuild(st, guess.startsWith('conta:') ? { kind: 'conta', accountId: guess.slice(6) } : guess ? { kind: 'cartao', cardId: guess.slice(7) } : null, false);
    } catch (e) {
      setFile(null);
      setErr(e instanceof StatementError ? e.message : 'Não consegui ler o arquivo. Use o OFX ou o CSV exportado pelo banco.');
    }
    if (fileRef.current) fileRef.current.value = '';
  };
  const setCategory = (key: string, categoryId: string) => {
    const r = rows.find((x) => x.key === key);
    if (!r) return;
    // a mesma descrição na prévia acompanha a troca
    const same = (x: PreviewRow) => x.type === r.type && x.row.description.toLowerCase() === r.row.description.toLowerCase();
    setRows(rows.map((x) => (x.key === key || same(x) ? { ...x, categoryId, categorySource: 'regra' } : x)));
  };
  const totals = useMemo(() => previewTotals(rows), [rows]);
  const before = tgt ? rowsBeforeAccountStart(rows, tgt, data) : 0;
  const flagged = rows.filter((r) => r.flag).length;

  const confirm = async () => {
    if (!file || !tgt || totals.count === 0) return;
    setBusy(true);
    try {
      const id = uid('imp_');
      const txs = buildTransactions(rows, tgt, data, id, () => uid('t_'), today);
      await applyImport(makeBatch(id, file.name, file.st, tgt, rows), txs, learnedRules(rows, original, settings.importRules ?? []));
      toast(`${txs.length} ${txs.length === 1 ? 'lançamento importado' : 'lançamentos importados'}`);
      setFile(null);
      setRows([]);
    } finally {
      setBusy(false);
    }
  };

  const history = [...data.imports].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const targetName = (b: { accountId?: string; cardId?: string }) => (b.accountId ? data.accounts.find((a) => a.id === b.accountId)?.name : data.cards.find((c) => c.id === b.cardId)?.name) ?? 'removido';
  const cats = (type: 'income' | 'expense') => data.categories.filter((c) => c.type === type);

  return (
    <Full title="Importar extrato" onBack={onClose}>
      {!file && (
        <div className="card">
          <h2>Escolha o arquivo</h2>
          <div className="hint" style={{ marginBottom: 12 }}>OFX ou CSV exportado pelo app ou site do banco. O arquivo é lido só neste aparelho.</div>
          <input ref={fileRef} type="file" accept=".ofx,.qfx,.csv,.txt,text/csv,application/x-ofx" style={{ display: 'none' }} onChange={(e) => void pick(e.target.files?.[0])} aria-label="Arquivo do extrato" />
          <button className="btn" onClick={() => fileRef.current?.click()}><FileUp size={18} /> Escolher arquivo</button>
          {err && <div className="neg" role="alert" style={{ marginTop: 10 }}>{err}</div>}
          {accounts.length === 0 && data.cards.length === 0 && <Note>Cadastre antes a conta ou o cartão em Ajustes, para o app saber onde colocar os lançamentos.</Note>}
          <Note>
            Como exportar: no app ou internet banking, procure "Extrato" → "Exportar" ou "Salvar como" e escolha OFX (às vezes chamado "Money" ou "Quicken") ou CSV/Excel.
            Na fatura do cartão, procure "Exportar fatura". PDF ainda não é lido.
          </Note>
        </div>
      )}

      {file && (
        <>
          <div className="card">
            <div className="kv"><span>Arquivo</span><b style={{ maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis' }}>{file.name}</b></div>
            <div className="kv"><span>Formato</span><b>{file.st.format.toUpperCase()}{file.st.bank ? ` · ${file.st.bank}` : ''}{file.st.kind === 'cartao' ? ' · fatura de cartão' : file.st.kind === 'conta' ? ' · extrato de conta' : ''}</b></div>
            <Field label="Colocar os lançamentos em">
              <select name="destino" value={target} onChange={(e) => { setTarget(e.target.value); const v = e.target.value; rebuild(file.st, v.startsWith('conta:') ? { kind: 'conta', accountId: v.slice(6) } : v ? { kind: 'cartao', cardId: v.slice(7) } : null, invert); }}>
                <option value="">Escolha…</option>
                {accounts.map((a) => (<option key={a.id} value={`conta:${a.id}`}>Conta: {a.name}</option>))}
                {data.cards.map((c) => (<option key={c.id} value={`cartao:${c.id}`}>Cartão: {c.name}</option>))}
              </select>
            </Field>
            {file.st.format === 'csv' && <SwitchRow title="Inverter entradas e saídas" sub="Use se as compras aparecerem como receita" on={invert} onChange={(v) => { setInvert(v); rebuild(file.st, tgt, v); }} />}
            {file.st.warnings.map((w) => (<Note key={w}>{w}</Note>))}
            <button className="link" onClick={() => { setFile(null); setRows([]); }}>Escolher outro arquivo</button>
          </div>

          {tgt && rows.length > 0 && (
            <>
              <div className="grid3">
                <div className="tile"><div className="lbl">Lançamentos</div><div className="val num">{totals.count}</div></div>
                <div className="tile"><div className="lbl">Entradas</div><div className="val num pos">{formatBRL(totals.incomeCents)}</div></div>
                <div className="tile"><div className="lbl">Saídas</div><div className="val num neg">{formatBRL(totals.expenseCents)}</div></div>
              </div>
              {totals.from && <div className="hint" style={{ margin: '-4px 0 10px' }}>De {formatDateBR(totals.from)} a {formatDateBR(totals.to)}. {flagged > 0 ? `${flagged} ${flagged === 1 ? 'item ficou desmarcado' : 'itens ficaram desmarcados'} para você conferir.` : ''}</div>}
              {before > 0 && <Note>{before} {before === 1 ? 'lançamento é anterior' : 'lançamentos são anteriores'} ao início do saldo da conta: {before === 1 ? 'entra' : 'entram'} no histórico e nos relatórios, mas não muda{before === 1 ? '' : 'm'} o saldo de hoje.</Note>}
              <div className="card" style={{ padding: '4px 14px' }}>
                {rows.slice(0, MAX_ROWS_SHOWN).map((r) => (
                  <div className={'improw' + (r.include ? '' : ' off')} key={r.key}>
                    <input type="checkbox" checked={r.include} onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, include: e.target.checked } : x)))} aria-label={`Importar ${r.row.description}`} />
                    <div className="mid">
                      <div className="t">{r.row.description}</div>
                      <div className="s">{formatDateBR(r.row.date)}</div>
                      {r.flag ? <div className="flagnote">{r.flagNote}</div> : null}
                      <select value={r.categoryId} onChange={(e) => setCategory(r.key, e.target.value)} aria-label={`Categoria de ${r.row.description}`}>
                        {cats(r.type).map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                      </select>
                      <span className="hint"> {SOURCE_LABEL[r.categorySource]}</span>
                    </div>
                    <div className={'num end ' + (r.type === 'income' ? 'pos' : '')}>{r.type === 'income' ? '+' : '−'}{formatBRL(r.amountCents)}</div>
                  </div>
                ))}
              </div>
              {rows.length > MAX_ROWS_SHOWN && <Note>Mostrando os {MAX_ROWS_SHOWN} primeiros de {rows.length}; todos os marcados serão importados.</Note>}
              <button className="btn" disabled={busy || totals.count === 0} onClick={confirm}>Importar {totals.count} {totals.count === 1 ? 'lançamento' : 'lançamentos'}</button>
              <Note>
                Antes de importar, o app guarda uma cópia de segurança de tudo. Trocar a categoria de um item ensina o app: da próxima vez, a mesma descrição já vem com ela.
                {tgt.kind === 'cartao' ? ' Compras de faturas já vencidas entram como pagas pela conta do cartão; as da fatura em aberto, como a pagar. Não importe também o "pagamento de fatura" do extrato da conta, senão o gasto conta duas vezes.' : ''}
              </Note>
            </>
          )}
          {!tgt && <Note>Escolha a conta ou o cartão para ver a prévia.</Note>}
        </>
      )}

      {history.length > 0 && (
        <>
          <div className="section">Importações anteriores</div>
          <div className="card" style={{ padding: '4px 14px' }}>
            {history.map((b) => (
              <div className="row" key={b.id}>
                <div className="mid">
                  <div className="t">{b.fileName}</div>
                  <div className="s">{formatDateBR(b.createdAt.slice(0, 10))} · {targetName(b)} · {b.count} {b.count === 1 ? 'lançamento' : 'lançamentos'}{b.from ? ` de ${formatDateBR(b.from)} a ${formatDateBR(b.to)}` : ''}</div>
                </div>
                <div className="end">
                  {b.undoneAt ? <span className="badge">desfeita</span> : (
                    <button className="link" onClick={async () => { if (!confirmUndo(b.count)) return; const n = await undoImport(b.id); toast(`${n} ${n === 1 ? 'lançamento removido' : 'lançamentos removidos'}`); }}><Undo2 size={14} /> Desfazer</button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <Note>Desfazer apaga só os lançamentos daquela importação (inclusive os que você editou depois). Uma cópia de segurança é guardada antes, em Ajustes → Cópias de segurança.</Note>
        </>
      )}
    </Full>
  );
}

const confirmUndo = (n: number) => (typeof window.confirm === 'function' ? window.confirm(`Apagar os ${n} lançamentos desta importação?`) : true);
