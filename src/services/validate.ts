import type { AppData, Settings } from '../lib/types';
import { DATA_KEYS, emptyData } from '../lib/defaults';

/**
 * Versão do formato dos dados dentro de um backup. Sobe quando entram coleções ou campos que uma versão
 * antiga do app não saberia guardar; assim um app antigo recusa o arquivo em vez de restaurar pela metade.
 */
export const DATA_SCHEMA = 1;

export class ImportError extends Error {}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const NESTED_SETTINGS = ['salary', 'notifications', 'api', 'ai', 'freedom', 'budgets'];
const MAX_DEPTH = 12;

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Copia o valor sem as chaves que poderiam alterar o comportamento dos objetos do app (`__proto__` etc.). */
function clean<T>(v: T, depth = 0): T {
  if (depth > MAX_DEPTH) throw new ImportError('Arquivo inválido: estrutura profunda demais.');
  if (Array.isArray(v)) return v.map((x) => clean(x, depth + 1)) as T;
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) if (!FORBIDDEN_KEYS.has(k)) out[k] = clean(val, depth + 1);
    return out as T;
  }
  return v;
}

/**
 * Confere a estrutura de dados vindos de fora (backup, cópia de segurança) antes de gravar no banco.
 *
 * Restaurar substitui tudo, então um arquivo torto não pode passar. A conferência é de estrutura:
 * cada seção é uma lista de registros com identificação única. Seções que não existiam na versão que
 * gerou o arquivo voltam vazias (ou com o padrão, no caso das categorias), para backups antigos seguirem abrindo.
 */
export function validateImported(parsed: unknown): { data: AppData; settings: Omit<Settings, 'security'> } {
  if (!isPlainObject(parsed) || !isPlainObject(parsed.data)) throw new ImportError('Arquivo inválido: não contém os dados do Grefinacia.');
  const schema = parsed.schema === undefined ? 1 : parsed.schema;
  if (typeof schema !== 'number' || !Number.isInteger(schema) || schema < 1) throw new ImportError('Arquivo inválido: versão dos dados desconhecida.');
  if (schema > DATA_SCHEMA) throw new ImportError('Este backup foi criado por uma versão mais nova do Grefinacia. Atualize o app e tente de novo.');

  const raw = clean(parsed.data);
  const data = emptyData();
  for (const k of DATA_KEYS) {
    const list = raw[k];
    if (list === undefined) continue; // arquivo de versão anterior, sem esta seção
    if (!Array.isArray(list)) throw new ImportError(`Backup inválido: a seção "${k}" não é uma lista.`);
    const seen = new Set<string>();
    list.forEach((item, i) => {
      if (!isPlainObject(item) || typeof item.id !== 'string' || item.id === '') throw new ImportError(`Backup inválido: o registro ${i + 1} da seção "${k}" não tem identificação.`);
      if (seen.has(item.id)) throw new ImportError(`Backup inválido: identificação repetida na seção "${k}".`);
      seen.add(item.id);
    });
    // sem categorias o app não consegue lançar nada: lista vazia mantém as categorias padrão
    if (k === 'categories' && list.length === 0) continue;
    (data[k] as unknown[]) = list;
  }

  const settings: Record<string, unknown> = isPlainObject(parsed.settings) ? clean(parsed.settings) : {};
  delete settings.security; // o PIN de bloqueio nunca vem de um arquivo
  for (const k of NESTED_SETTINGS) if (settings[k] !== undefined && !isPlainObject(settings[k])) delete settings[k];
  return { data, settings: settings as unknown as Omit<Settings, 'security'> };
}
