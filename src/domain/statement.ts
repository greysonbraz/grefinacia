import type { ISODate } from '../lib/types';

/**
 * Leitura de extratos bancários em arquivo (Etapa 9). Só lê: não grava nada e não fala com a internet.
 *
 * Formatos:
 * - OFX (Open Financial Exchange), versões 1.x (SGML, sem tags de fechamento) e 2.x (XML). É o "Exportar para
 *   Money/Quicken" que quase todo banco brasileiro oferece. Traz um identificador único por lançamento (FITID).
 * - CSV de bancos e cartões: colunas são reconhecidas pelo nome do cabeçalho (data, descrição, valor, débito/crédito).
 *
 * Toda fonte de extrato entrega a mesma coisa (`StatementRow`), para que um conector futuro (Open Finance) entre
 * no lugar do arquivo sem mudar o resto.
 */
export interface StatementRow {
  date: ISODate;
  amount: number; // em centavos; positivo = entrou dinheiro, negativo = saiu
  description: string;
  fitId?: string;
  /** Categoria dada pelo banco/Pluggy (em inglês), quando houver. */
  bankCategory?: string;
  /** Cartão: vencimento da fatura em que o banco colocou o lançamento (quando informado). */
  dueDate?: ISODate;
}
export interface Statement {
  format: 'ofx' | 'csv';
  kind: 'conta' | 'cartao' | 'desconhecido';
  bank?: string;
  rows: StatementRow[];
  warnings: string[];
}

export class StatementError extends Error {}

// ============================ TEXTO DO ARQUIVO ============================

/**
 * Converte os bytes do arquivo em texto. Bancos brasileiros ainda geram muito arquivo em Windows-1252 (Latin-1):
 * se o cabeçalho disser, ou se o UTF-8 der caracteres inválidos, lê como Windows-1252.
 */
export function decodeStatement(bytes: Uint8Array): string {
  const head = new TextDecoder('ascii').decode(bytes.slice(0, 600)).toUpperCase();
  if (/CHARSET:\s*(1252|ISO-?8859-?1)|ENCODING=["']?(WINDOWS-1252|ISO-8859-1)/.test(head)) return new TextDecoder('windows-1252').decode(bytes);
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(bytes) : utf8.replace(/^﻿/, '');
}

const clean = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

/** Valor em reais escrito em qualquer formato comum ("-1.234,56", "1234.56", "R$ 12,00", "(12,34)", "12,34 D") → centavos. */
export function parseAmount(raw: string): number | null {
  let s = raw.trim().replace(/R\$|\s| /g, '');
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/[Dd]$/.test(s)) { neg = true; s = s.slice(0, -1); } else if (/[Cc]$/.test(s)) s = s.slice(0, -1);
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
  if (s.endsWith('-')) { neg = !neg; s = s.slice(0, -1); }
  if (!/^[\d.,]+$/.test(s)) return null;
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  let norm: string;
  if (lastComma > lastDot) norm = s.replace(/\./g, '').replace(',', '.'); // 1.234,56
  else if (lastDot > lastComma) {
    // 1,234.56 ou 1234.56; "1.234" sozinho (milhar) é raro em extrato: com 3 casas após o ponto e sem vírgula, trata como milhar
    norm = lastComma >= 0 || !/\.\d{3}$/.test(s) ? s.replace(/,/g, '') : s.replace(/\./g, '');
  } else norm = s;
  const v = Number(norm);
  if (!Number.isFinite(v)) return null;
  const cents = Math.round(v * 100 + (v >= 0 ? 1e-9 : -1e-9));
  return neg ? -cents : cents;
}

/** Datas "dd/mm/aaaa", "dd/mm/aa", "dd-mm-aaaa", "aaaa-mm-dd", "aaaammdd" → aaaa-mm-dd. */
export function parseDate(raw: string): ISODate | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let r = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (r) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s.split(/\s/)[0]))) {
    [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
    if (y < 100) y += 2000;
  } else if ((r = /^(\d{4})(\d{2})(\d{2})/.exec(s))) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ============================ OFX ============================

const tag = (block: string, name: string): string | undefined => {
  // SGML: <NAME>valor (até a próxima tag ou quebra de linha); XML: <NAME>valor</NAME>
  const r = new RegExp(`<${name}>([^<\\r\\n]*)`, 'i').exec(block);
  return r ? clean(r[1]) : undefined;
};

export function isOfx(text: string): boolean {
  return /OFXHEADER|<OFX>/i.test(text.slice(0, 2000));
}

export function parseOfx(text: string): Statement {
  if (!isOfx(text)) throw new StatementError('O arquivo não parece um OFX.');
  const warnings: string[] = [];
  const card = /<CREDITCARDMSGSRSV1>|<CCSTMTRS>/i.test(text);
  const bank = tag(text, 'ORG') ?? tag(text, 'BANKID');
  const rows: StatementRow[] = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  let bad = 0;
  for (const raw of blocks) {
    const b = raw.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0];
    const date = parseDate(tag(b, 'DTPOSTED') ?? '');
    const amount = parseAmount(tag(b, 'TRNAMT') ?? '');
    if (!date || amount === null) {
      bad++;
      continue;
    }
    const name = tag(b, 'NAME') ?? '';
    const memo = tag(b, 'MEMO') ?? '';
    // alguns bancos põem o texto útil no MEMO e um código no NAME (ou o contrário): usa os dois quando diferem
    const description = name && memo && !memo.includes(name) && !name.includes(memo) ? `${name} ${memo}` : memo.length > name.length ? memo : name;
    rows.push({ date, amount, description: description || (amount >= 0 ? 'Crédito' : 'Débito'), fitId: tag(b, 'FITID') || undefined });
  }
  if (!blocks.length) throw new StatementError('Nenhum lançamento encontrado no OFX.');
  if (bad) warnings.push(`${bad} ${bad === 1 ? 'lançamento ilegível foi ignorado' : 'lançamentos ilegíveis foram ignorados'}.`);
  return { format: 'ofx', kind: card ? 'cartao' : 'conta', bank, rows, warnings };
}

// ============================ CSV ============================

/** Divide uma linha CSV respeitando aspas. */
export function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const HEAD = {
  date: /^(data|date|dt|data (da )?(transacao|lancamento|movimento|compra)|data mov)$/,
  desc: /^(descricao|description|historico|title|titulo|estabelecimento|lancamento|detalhes|memo|nome|transacao)$/,
  amount: /^(valor|amount|quantia|valor r|valor rs|valor em r|valor brl|montante)$/,
  debit: /^(debito|saida|saidas|valor debito)$/,
  credit: /^(credito|entrada|entradas|valor credito)$/,
  id: /^(identificador|id|codigo|cod|documento|n documento|numero do documento)$/,
};
export type CsvColumns = { date: number; desc: number[]; amount?: number; debit?: number; credit?: number; id?: number };

function findColumns(cells: string[]): CsvColumns | null {
  const h = cells.map(norm);
  const at = (re: RegExp) => h.findIndex((x) => re.test(x));
  const date = at(HEAD.date), amount = at(HEAD.amount), debit = at(HEAD.debit), credit = at(HEAD.credit), id = at(HEAD.id);
  // "Histórico" e "Descrição" juntos (ex.: "Pix enviado" + "Fulano")
  const desc = h.map((x, i) => (HEAD.desc.test(x) ? i : -1)).filter((i) => i >= 0);
  if (date < 0 || !desc.length || (amount < 0 && (debit < 0 || credit < 0))) return null;
  return { date, desc, amount: amount >= 0 ? amount : undefined, debit: debit >= 0 ? debit : undefined, credit: credit >= 0 ? credit : undefined, id: id >= 0 ? id : undefined };
}

/**
 * Lê CSV de banco ou de cartão. Procura a linha de cabeçalho (alguns bancos põem o nome da conta e o período antes),
 * descobre o separador (; , ou tab) e as colunas pelo nome. Arquivo de cartão (cabeçalho em inglês "date,title,amount",
 * como o do Nubank) vem com compras positivas: o sinal é invertido para compras saírem como gasto.
 */
export function parseCsv(text: string): Statement {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const warnings: string[] = [];
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    for (const sep of [';', ',', '\t']) {
      const cells = splitCsvLine(lines[i], sep);
      if (cells.length < 3) continue;
      const cols = findColumns(cells);
      if (!cols) continue;
      const header = cells.map(norm);
      const cardLike = header.includes('title') && header.includes('amount');
      const rows: StatementRow[] = [];
      let bad = 0;
      for (const line of lines.slice(i + 1)) {
        const c = splitCsvLine(line, sep);
        const date = parseDate(c[cols.date] ?? '');
        let amount: number | null;
        if (cols.amount !== undefined) amount = parseAmount(c[cols.amount] ?? '');
        else {
          const deb = parseAmount(c[cols.debit!] ?? '') ?? 0;
          const cred = parseAmount(c[cols.credit!] ?? '') ?? 0;
          amount = cred !== 0 || deb !== 0 ? Math.abs(cred) - Math.abs(deb) : null;
        }
        const description = clean([...new Set(cols.desc.map((k) => clean(c[k] ?? '')).filter(Boolean))].join(' - '));
        if (!date || amount === null || amount === 0) {
          // linhas de saldo e rodapé não têm data ou valor: só conta como problema se parecia um lançamento
          if (date || description) bad++;
          continue;
        }
        rows.push({ date, amount: cardLike ? -amount : amount, description: description || (amount >= 0 ? 'Crédito' : 'Débito'), fitId: cols.id !== undefined && c[cols.id] ? c[cols.id] : undefined });
      }
      if (!rows.length) throw new StatementError('Achei o cabeçalho do CSV, mas nenhum lançamento com data e valor.');
      if (bad) warnings.push(`${bad} ${bad === 1 ? 'linha sem data ou valor foi ignorada' : 'linhas sem data ou valor foram ignoradas'} (saldos e totais costumam ser assim).`);
      return { format: 'csv', kind: cardLike ? 'cartao' : 'desconhecido', rows, warnings };
    }
  }
  throw new StatementError('Não reconheci as colunas do CSV. Preciso de colunas de data, descrição e valor (ou débito e crédito).');
}

/** Lê o arquivo, seja OFX ou CSV. */
export function parseStatement(bytes: Uint8Array): Statement {
  if (bytes.length > 5 * 1024 * 1024) throw new StatementError('Arquivo grande demais (máximo 5 MB).');
  const text = decodeStatement(bytes);
  if (/^%PDF/.test(text)) throw new StatementError('Extrato em PDF ainda não é lido. No app ou site do banco, exporte em OFX ("Money" ou "Quicken") ou CSV.');
  return isOfx(text) ? parseOfx(text) : parseCsv(text);
}
