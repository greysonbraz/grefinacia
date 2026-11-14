import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { AppData, Settings, Transaction } from '../lib/types';
import { isNative } from './platform';
import { DATA_SCHEMA, ImportError, validateImported } from './validate';

const enc = new TextEncoder();
const dec = new TextDecoder();
const ITER = 310_000;

const b64 = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iter: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export interface BackupFile {
  app: 'grefinacia';
  v: 1;
  kdf: 'PBKDF2-SHA256';
  iter: number;
  salt: string;
  iv: string;
  data: string;
  createdAt: string;
}

/** Backup criptografado com AES-256-GCM (chave derivada da senha por PBKDF2). Sem a senha, não há como abrir. */
export async function createBackup(data: AppData, settings: Settings, password: string): Promise<string> {
  const { security: _security, ...rest } = settings;
  void _security; // a senha/PIN de bloqueio fica só no aparelho
  const payload = JSON.stringify({ schema: DATA_SCHEMA, data, settings: rest });
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITER);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(payload));
  const file: BackupFile = { app: 'grefinacia', v: 1, kdf: 'PBKDF2-SHA256', iter: ITER, salt: b64(salt), iv: b64(iv), data: b64(cipher), createdAt: new Date().toISOString() };
  return JSON.stringify(file);
}

export class BackupError extends Error {}

const NOT_A_BACKUP = 'Arquivo inválido: não é um backup do Grefinacia.';
const NEWER_APP = 'Este backup foi criado por uma versão mais nova do Grefinacia. Atualize o app e tente de novo.';
/** Limites aceitos para o custo da derivação de chave: evita que um arquivo forjado trave o aparelho. */
const MIN_ITER = 100_000;
const MAX_ITER = 5_000_000;

/**
 * Abre um backup. A criptografia (AES-GCM) já garante que o conteúdo não foi alterado: qualquer byte trocado
 * faz a abertura falhar. Depois de aberto, a estrutura é conferida antes de qualquer coisa ir para o banco.
 */
export async function readBackup(text: string, password: string): Promise<{ data: AppData; settings: Omit<Settings, 'security'> }> {
  let file: Partial<BackupFile> & { v?: unknown };
  try {
    file = JSON.parse(text) as Partial<BackupFile>;
  } catch {
    throw new BackupError(NOT_A_BACKUP);
  }
  if (typeof file !== 'object' || file === null || file.app !== 'grefinacia' || typeof file.data !== 'string' || !file.data) throw new BackupError(NOT_A_BACKUP);
  if (file.v !== 1) throw new BackupError(typeof file.v === 'number' && file.v > 1 ? NEWER_APP : NOT_A_BACKUP);
  if (typeof file.salt !== 'string' || typeof file.iv !== 'string' || typeof file.iter !== 'number' || !Number.isInteger(file.iter) || file.iter < MIN_ITER || file.iter > MAX_ITER) throw new BackupError(NOT_A_BACKUP);
  let plain: string;
  try {
    const key = await deriveKey(password, unb64(file.salt), file.iter);
    plain = dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(file.iv) }, key, unb64(file.data)));
  } catch {
    throw new BackupError('Senha incorreta ou arquivo corrompido.');
  }
  try {
    return validateImported(JSON.parse(plain));
  } catch (e) {
    if (e instanceof ImportError) throw new BackupError(e.message);
    throw new BackupError('Backup corrompido: o conteúdo não pôde ser lido.');
  }
}

export function transactionsToCSV(txs: Transaction[], catName: (id: string) => string, accountName: (id?: string) => string): string {
  const esc = (v: string) => (/[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
  const head = ['Data', 'Tipo', 'Descrição', 'Categoria', 'Valor (R$)', 'Forma de pagamento', 'Conta', 'Situação', 'Vencimento'];
  const rows = [...txs].sort((a, b) => a.date.localeCompare(b.date)).map((t) =>
    [t.date.split('-').reverse().join('/'), t.type === 'income' ? 'Receita' : 'Despesa', t.description, catName(t.categoryId), (t.amountCents / 100).toFixed(2).replace('.', ','), t.paymentMethod, accountName(t.accountId), t.status === 'paid' ? (t.type === 'income' ? 'Recebido' : 'Pago') : 'Pendente', (t.dueDate ?? '').split('-').reverse().join('/')].map(esc).join(';'),
  );
  return '﻿' + [head.join(';'), ...rows].join('\r\n');
}

/** Salva o arquivo no cache do app e abre a folha de compartilhamento do Android (Drive, Arquivos, WhatsApp…). */
export async function saveAndShare(filename: string, content: string, mime: string, base64 = false): Promise<'shared' | 'downloaded'> {
  if (isNative()) {
    const r = base64 ? await Filesystem.writeFile({ path: filename, data: content, directory: Directory.Cache }) : await Filesystem.writeFile({ path: filename, data: content, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: filename, dialogTitle: 'Salvar arquivo', files: [r.uri] });
    return 'shared';
  }
  const blob = base64 ? new Blob([Uint8Array.from(atob(content), (c) => c.charCodeAt(0))], { type: mime }) : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'downloaded';
}
