import { countRequest } from './usage';

/**
 * Cliente mínimo da API da Pluggy para o Meu Pluggy (uso pessoal gratuito, Open Finance).
 * Documentação conferida em 17/11/2026: docs.pluggy.ai (autenticação, contas, transações v2, limites).
 *
 * - POST /auth troca Client ID + Client Secret por uma API key que vale 2 horas.
 * - GET /items/{id}: situação da conexão e validade da autorização (consentExpiresAt, 1 ano no Meu Pluggy).
 * - GET /accounts?itemId=: contas e cartões do banco (saldo em reais).
 * - GET /v2/transactions?accountId=&dateFrom=: transações em páginas de 500, com cursor (`next`).
 * Limite: 360 consultas por minuto por endpoint. O Meu Pluggy atualiza os dados a cada 24 h.
 */
const BASE = 'https://api.pluggy.ai';

export class PluggyError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message);
  }
}

export interface PluggyItem {
  id: string;
  status: string; // UPDATED, UPDATING, LOGIN_ERROR, OUTDATED...
  executionStatus?: string;
  lastUpdatedAt?: string;
  consentExpiresAt?: string;
  connector?: { name?: string };
  error?: { code?: string; message?: string } | null;
}
export interface PluggyAccount {
  id: string;
  itemId: string;
  type: 'BANK' | 'CREDIT' | string;
  subtype?: string;
  name: string;
  marketingName?: string | null;
  number?: string | null;
  balance: number;
  currencyCode?: string;
  creditData?: { creditLimit?: number | null; availableCreditLimit?: number | null; balanceCloseDate?: string | null; balanceDueDate?: string | null } | null;
}
export interface PluggyTransaction {
  id: string;
  providerId?: string | null;
  description: string;
  amount: number;
  amountInAccountCurrency?: number | null;
  date: string;
  type: 'DEBIT' | 'CREDIT' | string;
  status: 'POSTED' | 'PENDING' | string;
  currencyCode?: string;
  creditCardMetadata?: { installmentNumber?: number | null; totalInstallments?: number | null; purchaseDate?: string | null; billId?: string | null } | null;
  /** Categoria da Pluggy (nome em inglês; null sem categorização). */
  category?: string | null;
  categoryId?: string | null;
}

async function call<T>(path: string, init: RequestInit & { apiKey?: string } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (init.apiKey) headers['X-API-KEY'] = init.apiKey;
  let res: Response;
  try {
    countRequest('pluggy');
    res = await fetch(BASE + path, { ...init, headers, signal: ctrl.signal });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new PluggyError(/abort/i.test(msg) ? 'A Pluggy demorou para responder. Tente de novo.' : 'Sem conexão com a Pluggy. Seus dados continuam no aparelho.');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    const detail = body?.message ? ` (Pluggy: ${String(body.message).slice(0, 160)})` : '';
    if ((res.status === 400 || res.status === 401 || res.status === 403) && path === '/auth')
      throw new PluggyError(`A Pluggy não aceitou o Client ID e o Client Secret (erro ${res.status})${detail}. Gere um Client Secret novo no Dashboard, cole aqui e toque em "Guardar chaves".`, res.status);
    if (res.status === 401 || res.status === 403)
      throw new PluggyError(`As chaves entraram, mas a Pluggy negou acesso a esse banco (erro ${res.status})${detail}. Confira se o Item ID é de um item da mesma aplicação do Client ID (no Dashboard: Demo → Itens conectados).`, res.status);
    if (res.status === 404) throw new PluggyError('A Pluggy não achou esse banco: confira o Item ID copiado do Dashboard.', res.status);
    if (res.status === 429) throw new PluggyError('Muitas consultas seguidas à Pluggy. Espere um minuto.', res.status);
    throw new PluggyError(`A Pluggy respondeu com erro ${res.status}.${detail}`, res.status);
  }
  return (await res.json()) as T;
}

let cached: { creds: string; apiKey: string; until: number } | null = null;

/** API key da Pluggy (vale 2 h; guardada só em memória e renovada 10 min antes). */
export async function pluggyApiKey(clientId: string, clientSecret: string, now = Date.now()): Promise<string> {
  if (!clientId.trim() || !clientSecret.trim()) throw new PluggyError('Informe o Client ID e o Client Secret da sua aplicação na Pluggy.');
  const creds = `${clientId.trim()}\n${clientSecret.trim()}`;
  if (cached && cached.creds === creds && cached.until > now) return cached.apiKey;
  const r = await call<{ apiKey?: string }>('/auth', { method: 'POST', body: JSON.stringify({ clientId: clientId.trim(), clientSecret: clientSecret.trim() }) });
  if (!r.apiKey) throw new PluggyError('Resposta inesperada da Pluggy ao entrar.');
  cached = { creds, apiKey: r.apiKey, until: now + 110 * 60_000 };
  return r.apiKey;
}
/** Esquece a API key em memória (credenciais trocadas ou apagadas). */
export const forgetPluggyKey = () => void (cached = null);

export const getItem = (apiKey: string, itemId: string) => call<PluggyItem>(`/items/${encodeURIComponent(itemId.trim())}`, { apiKey });

export async function listAccounts(apiKey: string, itemId: string): Promise<PluggyAccount[]> {
  const r = await call<{ results?: PluggyAccount[] }>(`/accounts?itemId=${encodeURIComponent(itemId.trim())}`, { apiKey });
  return Array.isArray(r.results) ? r.results : [];
}

export interface PluggyInvestment {
  id: string;
  itemId?: string;
  name: string;
  code?: string | null;
  isin?: string | null;
  type: string;
  subtype?: string | null;
  balance: number;
  amount?: number | null;
  amountOriginal?: number | null;
  quantity?: number | null;
  value?: number | null;
  currencyCode?: string | null;
  date?: string | null;
  dueDate?: string | null;
  issuer?: string | null;
  rate?: number | null;
  rateType?: string | null;
  fixedAnnualRate?: number | null;
  status?: string | null;
}

/** Fatura do cartão (Open Finance): vencimento, fechamento e total informados pelo banco. */
export interface PluggyBill {
  id: string;
  dueDate: string;
  billClosingDate?: string | null;
  totalAmount: number;
  totalAmountCurrencyCode?: string | null;
  minimumPaymentAmount?: number | null;
}
/** Faturas de um cartão. */
export async function listBills(apiKey: string, accountId: string): Promise<PluggyBill[]> {
  const out: PluggyBill[] = [];
  for (let page = 1; page <= 10; page++) {
    const r = await call<{ results?: PluggyBill[]; totalPages?: number }>(`/bills?accountId=${encodeURIComponent(accountId)}&pageSize=500&page=${page}`, { apiKey });
    if (Array.isArray(r.results)) out.push(...r.results);
    if (!r.totalPages || page >= r.totalPages) break;
  }
  return out;
}

/** Investimentos de um banco (renda fixa, ações, fundos, previdência), em páginas de 500. */
export async function listInvestments(apiKey: string, itemId: string): Promise<PluggyInvestment[]> {
  const out: PluggyInvestment[] = [];
  for (let page = 1; page <= 20; page++) {
    const r = await call<{ results?: PluggyInvestment[]; totalPages?: number }>(`/investments?itemId=${encodeURIComponent(itemId.trim())}&pageSize=500&page=${page}`, { apiKey });
    if (Array.isArray(r.results)) out.push(...r.results);
    if (!r.totalPages || page >= r.totalPages) break;
  }
  return out;
}

/** Todas as transações de uma conta desde `dateFrom` (aaaa-mm-dd), seguindo o cursor. Para em 40 páginas (20 mil). */
export async function listTransactions(apiKey: string, accountId: string, dateFrom: string): Promise<PluggyTransaction[]> {
  const out: PluggyTransaction[] = [];
  let query: string | null = `?accountId=${encodeURIComponent(accountId)}&dateFrom=${encodeURIComponent(dateFrom)}`;
  for (let page = 0; query && page < 40; page++) {
    const r: { results?: PluggyTransaction[]; next?: string | null } = await call(`/v2/transactions${query}`, { apiKey });
    if (Array.isArray(r.results)) out.push(...r.results);
    query = typeof r.next === 'string' && r.next.startsWith('?') ? r.next : null;
  }
  return out;
}
