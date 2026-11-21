import { beforeEach, describe, expect, it } from 'vitest';
import { deleteDB } from 'idb';
import { decodeStatement, parseAmount, parseCsv, parseDate, parseOfx, parseStatement, StatementError } from '../src/domain/statement';
import { buildPreview, buildTransactions, learnedRules, makeBatch, previewTotals, rowsBeforeAccountStart, suggestCategory } from '../src/domain/importer';
import { DEFAULT_SETTINGS, emptyData, DATA_KEYS } from '../src/lib/defaults';
import type { Account, AppData, Card, Settings, Transaction } from '../src/lib/types';
import { closeDB, DB_VERSION, listSafetyCopies } from '../src/db/db';
import { SYNCED } from '../src/services/sync';
import { DATA_SCHEMA, validateImported } from '../src/services/validate';
import { applyImport, getState, init, undoImport, upsert } from '../src/state/store';
import { setSecretStoreForTests } from '../src/services/secrets';

const TODAY = '2026-11-16';
const acc: Account = { id: 'a1', name: 'Conta', kind: 'corrente', initialCents: 100000, initialDate: '2026-10-01' };
const card: Card = { id: 'c1', name: 'Cartão', closingDay: 3, dueDay: 10, accountId: 'a1' };
const base = (p: Partial<AppData> = {}): AppData => ({ ...emptyData(), accounts: [acc], cards: [card], ...p });
const S: Settings = { ...DEFAULT_SETTINGS };
const enc = (s: string) => new TextEncoder().encode(s);
/** Texto em Windows-1252 (como muitos bancos geram): á=E1, ç=E7, ã=E3. */
const latin1 = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0) & 0xff));

// Modelos montados aqui a partir do formato público de cada arquivo (não são extratos reais).
const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
ENCODING:USASCII
CHARSET:1252

<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><FI><ORG>Banco Exemplo<FID>001</FI></SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL<BANKACCTFROM><BANKID>001<ACCTID>12345</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20261101<DTEND>20261115
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261103100000[-3:BRT]<TRNAMT>-23.50<FITID>A001<MEMO>UBER *TRIP S\xe3o Paulo</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261105<TRNAMT>3500.00<FITID>A002<NAME>PAGTO SALARIO<MEMO>EMPRESA LTDA</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261110<TRNAMT>-1.250,00<FITID>A003<MEMO>PAGAMENTO FATURA CART\xc3O</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261112<TRNAMT>-89,90<FITID>A004<MEMO>DROGARIA S\xc3O JO\xc3O</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

const OFX_XML_CARD = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="211"?>
<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>BRL</CURDEF><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261005</DTPOSTED><TRNAMT>-55.00</TRNAMT><FITID>C1</FITID><NAME>iFood *Restaurante</NAME></STMTTRN>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261108</DTPOSTED><TRNAMT>-39.90</TRNAMT><FITID>C2</FITID><NAME>Netflix.com</NAME></STMTTRN>
<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20261010</DTPOSTED><TRNAMT>800.00</TRNAMT><FITID>C3</FITID><NAME>Pagamento recebido</NAME></STMTTRN>
</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;

const CSV_CONTA_VIRGULA = `Data,Valor,Identificador,Descrição
01/11/2026,-23.50,6a1b,Transferência enviada pelo Pix - FULANO DE TAL
02/11/2026,3500.00,6a1c,Transferência recebida - EMPRESA LTDA
03/11/2026,"-1,234.56",6a1d,Pagamento de boleto efetuado - ALUGUEL`;

const CSV_CARTAO = `date,title,amount
2026-11-01,Uber *Trip,23.50
2026-11-02,Mercadolivre*Loja,150.00
2026-11-03,Pagamento recebido,-500.00`;

const CSV_PONTO_E_VIRGULA = `Extrato Conta Corrente
Conta ;12345-6
Período ;01/11/2026 a 15/11/2026

Data Lançamento;Histórico;Descrição;Valor;Saldo
01/11/2026;Pix enviado ;Padaria Pão Quente;-12,50;987,50
03/11/2026;Pix recebido;Fulano;1.234,56;2.222,06
;;Saldo do dia;;2.222,06`;

const CSV_DEB_CRED = `Data;Lançamento;Débito;Crédito
05/11/2026;Compra Supermercado X;150,00;
06/11/2026;Rendimento poupança;;12,34`;

describe('leitura de valores e datas', () => {
  it('valores em qualquer formato comum', () => {
    expect(parseAmount('-1.234,56')).toBe(-123456);
    expect(parseAmount('1234.56')).toBe(123456);
    expect(parseAmount('1,234.56')).toBe(123456);
    expect(parseAmount('R$ -12,00')).toBe(-1200);
    expect(parseAmount('(12,34)')).toBe(-1234);
    expect(parseAmount('12,34 D')).toBe(-1234);
    expect(parseAmount('12,34C')).toBe(1234);
    expect(parseAmount('-23.50')).toBe(-2350);
    expect(parseAmount('abc')).toBeNull();
  });
  it('datas nos formatos dos bancos', () => {
    expect(parseDate('03/11/2026')).toBe('2026-11-03');
    expect(parseDate('3/11/26')).toBe('2026-11-03');
    expect(parseDate('2026-11-03')).toBe('2026-11-03');
    expect(parseDate('20261103100000[-3:BRT]')).toBe('2026-11-03');
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate('')).toBeNull();
  });
});

describe('OFX', () => {
  it('versão 1 (SGML) em Windows-1252: acentos, valores com vírgula, conta', () => {
    const st = parseStatement(latin1(OFX_SGML));
    expect(st).toMatchObject({ format: 'ofx', kind: 'conta', bank: 'Banco Exemplo' });
    expect(st.rows.map((r) => r.amount)).toEqual([-2350, 350000, -125000, -8990]);
    expect(st.rows[0]).toEqual({ date: '2026-11-03', amount: -2350, description: 'UBER *TRIP São Paulo', fitId: 'A001' });
    expect(st.rows[1].description).toBe('PAGTO SALARIO EMPRESA LTDA');
    expect(st.rows[3].description).toBe('DROGARIA SÃO JOÃO');
  });
  it('versão 2 (XML) de cartão', () => {
    const st = parseOfx(OFX_XML_CARD);
    expect(st.kind).toBe('cartao');
    expect(st.rows.map((r) => [r.description, r.amount])).toEqual([['iFood *Restaurante', -5500], ['Netflix.com', -3990], ['Pagamento recebido', 80000]]);
  });
  it('arquivo sem lançamentos e PDF dão mensagem clara', () => {
    expect(() => parseOfx('OFXHEADER:100\n<OFX></OFX>')).toThrow(StatementError);
    expect(() => parseStatement(enc('%PDF-1.7 ...'))).toThrow(/opção de PDF/);
    expect(() => parseStatement(enc('nada,a,ver\n1,2,3'))).toThrow(/Não reconheci as colunas/);
  });
  it('UTF-8 com BOM é lido como UTF-8', () => {
    expect(decodeStatement(enc('﻿Descrição'))).toBe('Descrição');
  });
});

describe('CSV', () => {
  it('conta com vírgula e aspas', () => {
    const st = parseCsv(CSV_CONTA_VIRGULA);
    expect(st.rows.map((r) => [r.date, r.amount, r.fitId])).toEqual([['2026-11-01', -2350, '6a1b'], ['2026-11-02', 350000, '6a1c'], ['2026-11-03', -123456, '6a1d']]);
  });
  it('fatura de cartão em inglês: compras positivas viram gasto', () => {
    const st = parseCsv(CSV_CARTAO);
    expect(st.kind).toBe('cartao');
    expect(st.rows.map((r) => r.amount)).toEqual([-2350, -15000, 50000]);
  });
  it('ponto e vírgula, linhas antes do cabeçalho, histórico + descrição, linha de saldo ignorada', () => {
    const st = parseCsv(CSV_PONTO_E_VIRGULA);
    expect(st.rows).toHaveLength(2);
    expect(st.rows[0]).toMatchObject({ date: '2026-11-01', amount: -1250, description: 'Pix enviado - Padaria Pão Quente' });
    expect(st.rows[1].amount).toBe(123456);
    expect(st.warnings[0]).toMatch(/1 linha sem data ou valor/);
  });
  it('colunas separadas de débito e crédito', () => {
    expect(parseCsv(CSV_DEB_CRED).rows.map((r) => r.amount)).toEqual([-15000, 1234]);
  });
});

describe('prévia: categorias, duplicados e fatura', () => {
  it('sugere categoria: sua regra, depois o histórico, depois palavras comuns', () => {
    const d = base({ transactions: [{ id: 'x', type: 'expense', kind: 'variavel', description: 'Padaria Pão Quente', amountCents: 1000, categoryId: 'alimentacao', date: '2026-10-01', paymentMethod: 'pix', status: 'paid', createdAt: 1 } as Transaction] });
    expect(suggestCategory('UBER *TRIP', 'expense', d, [])).toEqual({ categoryId: 'transporte', source: 'palavra' });
    expect(suggestCategory('UBER EATS PEDIDO', 'expense', d, [{ pattern: 'uber eats', categoryId: 'alimentacao' }])).toEqual({ categoryId: 'alimentacao', source: 'regra' });
    expect(suggestCategory('PADARIA PAO QUENTE 123', 'expense', d, [])).toEqual({ categoryId: 'alimentacao', source: 'historico' });
    expect(suggestCategory('NETFLIX.COM', 'expense', d, []).categoryId).toBe('assinaturas');
    expect(suggestCategory('PAGTO SALARIO', 'income', d, []).categoryId).toBe('salario');
    expect(suggestCategory('XPTO 9981', 'expense', d, [])).toEqual({ categoryId: 'outros_gasto', source: 'padrao' });
  });

  it('desmarca já importado, parecido com lançamento existente, pagamento de fatura e repetido no arquivo', () => {
    const st = parseStatement(latin1(OFX_SGML));
    st.rows.push({ ...st.rows[3], fitId: undefined }); // repetida no arquivo (sem id)
    st.rows[3] = { ...st.rows[3], fitId: undefined };
    const existing: Transaction[] = [
      { id: 'e1', type: 'expense', kind: 'variavel', description: 'Uber', amountCents: 2350, categoryId: 'transporte', date: '2026-11-03', paymentMethod: 'pix', accountId: 'a1', status: 'paid', createdAt: 1, fitId: 'A001', importId: 'old' },
      { id: 'e2', type: 'income', kind: 'salario', description: 'Salário', amountCents: 350000, categoryId: 'salario', date: '2026-11-05', paymentMethod: 'transferencia', accountId: 'a1', status: 'paid', createdAt: 2 },
    ];
    const p = buildPreview(st, { kind: 'conta', accountId: 'a1' }, base({ transactions: existing }), S);
    expect(p.map((r) => r.flag)).toEqual(['importado', 'possivel', 'fatura', undefined, 'repetido']);
    expect(p.map((r) => r.include)).toEqual([false, false, false, true, false]);
    expect(p[3]).toMatchObject({ type: 'expense', amountCents: 8990, categoryId: 'saude' });
    expect(previewTotals(p)).toEqual({ count: 1, incomeCents: 0, expenseCents: 8990, from: '2026-11-12', to: '2026-11-12' });
  });
});

describe('lançamentos criados', () => {
  it('conta: pagos na data, na conta, com origem e identificador do banco', () => {
    const st = parseCsv(CSV_CONTA_VIRGULA);
    const p = buildPreview(st, { kind: 'conta', accountId: 'a1' }, base(), S);
    let n = 0;
    const txs = buildTransactions(p, { kind: 'conta', accountId: 'a1' }, base(), 'imp1', () => 'n' + n++, TODAY);
    expect(txs).toHaveLength(3);
    expect(txs[0]).toMatchObject({ type: 'expense', amountCents: 2350, status: 'paid', paidDate: '2026-11-01', accountId: 'a1', paymentMethod: 'pix', source: 'import', importId: 'imp1', fitId: '6a1b' });
    expect(txs[1]).toMatchObject({ type: 'income', kind: 'outro_rendimento' });
    expect(txs[2]).toMatchObject({ paymentMethod: 'boleto', amountCents: 123456 });
  });
  it('cartão: fatura vencida entra paga pela conta do cartão; fatura em aberto, a pagar; pagamento recebido fica de fora', () => {
    const st = parseOfx(OFX_XML_CARD);
    const tgt = { kind: 'cartao' as const, cardId: 'c1' };
    const p = buildPreview(st, tgt, base(), S);
    expect(p.map((r) => r.include)).toEqual([true, true, false]);
    let n = 0;
    const [old, open] = buildTransactions(p, tgt, base(), 'imp2', () => 'n' + n++, TODAY);
    // compra de 05/10 (fecha dia 3): fatura de novembro, vence 10/11 < hoje → paga pela conta a1
    expect(old).toMatchObject({ kind: 'cartao', paymentMethod: 'credito', cardId: 'c1', dueDate: '2026-11-10', status: 'paid', paidDate: '2026-11-10', accountId: 'a1', categoryId: 'alimentacao' });
    // compra de 08/11: fatura de dezembro, ainda em aberto
    expect(open).toMatchObject({ status: 'pending', dueDate: '2026-12-10', accountId: undefined, categoryId: 'assinaturas' });
  });
  it('aprende regra quando você troca a categoria na prévia', () => {
    const p = buildPreview(parseCsv(CSV_CARTAO), { kind: 'cartao', cardId: 'c1' }, base(), S);
    const original = new Map(p.map((r) => [r.key, r.categoryId]));
    p[1] = { ...p[1], categoryId: 'lazer' };
    expect(learnedRules(p, original, [])).toEqual([{ pattern: 'mercadolivre loja', categoryId: 'lazer' }]);
  });
  it('avisa quando há lançamentos antes do início do saldo da conta', () => {
    const p = buildPreview(parseCsv(CSV_CONTA_VIRGULA), { kind: 'conta', accountId: 'a1' }, base({ accounts: [{ ...acc, initialDate: '2026-11-02' }] }), S);
    expect(rowsBeforeAccountStart(p, { kind: 'conta', accountId: 'a1' }, base({ accounts: [{ ...acc, initialDate: '2026-11-02' }] }))).toBe(1);
  });
});

describe('dados: banco, backup e sincronização', () => {
  it('importações viajam entre aparelhos e vão no backup; regras ficam nas configurações', () => {
    expect(SYNCED.has('imports')).toBe(true);
    expect(DATA_KEYS).toContain('imports');
    expect(DB_VERSION).toBeGreaterThanOrEqual(5);
    expect(DATA_SCHEMA).toBeGreaterThanOrEqual(4);
    const v = validateImported({ schema: 4, data: { imports: [{ id: 'i1' }] }, settings: { importRules: 'quebrado' } });
    expect(v.data.imports).toHaveLength(1);
    expect('importRules' in v.settings).toBe(false);
  });

  describe('com o banco do aparelho', () => {
    beforeEach(async () => {
      await closeDB();
      await deleteDB('grefinacia');
      setSecretStoreForTests(null);
    });
    it('importar guarda cópia de segurança; desfazer apaga só aqueles lançamentos', async () => {
      await init();
      await upsert('accounts', acc);
      await upsert('transactions', { id: 'manual', type: 'expense', kind: 'variavel', description: 'Manual', amountCents: 100, categoryId: 'mercado', date: TODAY, paymentMethod: 'pix', accountId: 'a1', status: 'paid', createdAt: 1 });
      const st = parseCsv(CSV_CONTA_VIRGULA);
      const tgt = { kind: 'conta' as const, accountId: 'a1' };
      const p = buildPreview(st, tgt, getState().data, getState().settings);
      let n = 0;
      const txs = buildTransactions(p, tgt, getState().data, 'imp1', () => 'imp-t' + n++, TODAY);
      await applyImport(makeBatch('imp1', 'extrato.csv', st, tgt, p), txs, [{ pattern: 'aluguel', categoryId: 'moradia' }]);
      expect(getState().data.transactions).toHaveLength(4);
      expect(getState().settings.importRules).toEqual([{ pattern: 'aluguel', categoryId: 'moradia' }]);
      expect((await listSafetyCopies())[0].reason).toBe('importacao');
      // importar o mesmo arquivo de novo: tudo vem desmarcado como já importado
      expect(buildPreview(st, tgt, getState().data, getState().settings).every((r) => r.flag === 'importado' && !r.include)).toBe(true)
      expect(await undoImport('imp1')).toBe(3);
      expect(getState().data.transactions.map((t) => t.id)).toEqual(['manual']);
      expect(getState().data.imports[0].undoneAt).toBeTruthy();
      expect(await undoImport('imp1')).toBe(0);
      expect(await listSafetyCopies()).toHaveLength(2);
      await new Promise((r) => setTimeout(r, 600));
    });
  });
});
