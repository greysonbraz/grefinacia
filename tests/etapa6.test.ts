import { describe, expect, it } from 'vitest';
import { dueDateFromFactor, formatBoletoLine, parseBoleto } from '../src/domain/boleto';
import { accountBalance, cardUsedCents } from '../src/domain/ledger';
import { netWorthAt } from '../src/domain/networth';
import { DEFAULT_SETTINGS, emptyData } from '../src/lib/defaults';
import type { AppData } from '../src/lib/types';
import { exportOpenJson } from '../src/services/backup';
import { validateImported } from '../src/services/validate';

const TODAY = '2026-11-15';

// Montagem de boletos de teste, com os dígitos verificadores calculados aqui de forma independente.
const dv10 = (d: string) => { let s = 0; [...d].reverse().forEach((c, i) => { const p = Number(c) * (i % 2 === 0 ? 2 : 1); s += p > 9 ? p - 9 : p; }); return String((10 - (s % 10)) % 10); };
const dv11 = (d: string) => { let s = 0; [...d].reverse().forEach((c, i) => { s += Number(c) * ((i % 8) + 2); }); const r = 11 - (s % 11); return String(r === 0 || r === 10 || r === 11 ? 1 : r); };
/** Linha de 47 dígitos a partir de banco, fator de vencimento, valor em centavos e campo livre (25 dígitos). */
function bankLine(bank: string, factor: number, cents: number, free = '1234567890123456789012345') {
  const f = String(factor).padStart(4, '0'), v = String(cents).padStart(10, '0');
  const dvGeral = dv11(bank + '9' + f + v + free);
  const c1 = bank + '9' + free.slice(0, 5), c2 = free.slice(5, 15), c3 = free.slice(15, 25);
  return c1 + dv10(c1) + c2 + dv10(c2) + c3 + dv10(c3) + dvGeral + f + v;
}
/** Conta de consumo (48 dígitos), valor em reais com verificador módulo 10. */
function utilityLine(cents: number) {
  const body = '8' + '3' + '6' + String(cents).padStart(11, '0') + '0123' + '1234567890123456789012345'.slice(0, 25);
  const dvGeral = dv10(body.slice(0, 3) + body.slice(3));
  const barcode = body.slice(0, 3) + dvGeral + body.slice(3);
  return [0, 11, 22, 33].map((i) => barcode.slice(i, i + 11)).map((b) => b + dv10(b)).join('');
}

describe('boleto: leitura da linha digitável', () => {
  it('boleto bancário: valor, vencimento e banco', () => {
    // fator 1267 no ciclo novo = 22/02/2025 + 267 dias = 16/11/2025; em 2026 o mais próximo ainda é o ciclo novo
    const r = parseBoleto(bankLine('001', 1700, 123456), TODAY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.boleto).toMatchObject({ kind: 'bancario', amountCents: 123456, bankCode: '001' });
    expect(r.boleto.dueDate).toBe('2027-01-23'); // 22/02/2025 + 700 dias
  });

  it('aceita a linha com pontos e espaços, como vem no boleto', () => {
    const line = bankLine('341', 1650, 9990);
    const r = parseBoleto(formatBoletoLine(line), TODAY);
    expect(r.ok && r.boleto.amountCents).toBe(9990);
    expect(formatBoletoLine(line)).toMatch(/^\d{5}\.\d{5} \d{5}\.\d{6} \d{5}\.\d{6} \d \d{14}$/);
  });

  it('um número trocado é recusado', () => {
    const line = bankLine('237', 1700, 50000);
    for (const i of [3, 15, 28, 32, 40, 46]) {
      const wrong = line.slice(0, i) + ((Number(line[i]) + 1) % 10) + line.slice(i + 1);
      expect(parseBoleto(wrong, TODAY).ok, 'posição ' + i).toBe(false);
    }
  });

  it('boleto sem valor ou sem vencimento não inventa dados', () => {
    const r = parseBoleto(bankLine('104', 0, 0), TODAY);
    expect(r.ok && r.boleto.amountCents).toBeNull();
    expect(r.ok && r.boleto.dueDate).toBeNull();
  });

  it('conta de consumo (48 números): só o valor', () => {
    const r = parseBoleto(utilityLine(15990), TODAY);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.boleto).toMatchObject({ kind: 'arrecadacao', amountCents: 15990, dueDate: null, bankCode: null });
  });

  it('tamanho errado explica o que falta', () => {
    expect(parseBoleto('', TODAY)).toEqual({ ok: false, error: 'Informe a linha digitável.' });
    const r = parseBoleto('12345', TODAY);
    expect(!r.ok && r.error).toContain('foram informados 5');
  });

  it('fator de vencimento: virada de 22/02/2025', () => {
    expect(dueDateFromFactor(9999, '2025-02-01')).toBe('2025-02-21'); // último dia do ciclo antigo
    expect(dueDateFromFactor(1000, '2025-03-01')).toBe('2025-02-22'); // primeiro dia do ciclo novo
    expect(dueDateFromFactor(1000, '2000-07-10')).toBe('2000-07-03'); // o mesmo número, lido em 2000
    expect(dueDateFromFactor(0, TODAY)).toBeNull();
  });
});

describe('transferências e limite do cartão', () => {
  const base = (): AppData => ({
    ...emptyData(),
    accounts: [{ id: 'a', name: 'Corrente', kind: 'corrente', initialCents: 100000, initialDate: '2026-11-01' }, { id: 'b', name: 'Poupança', kind: 'poupanca', initialCents: 0, initialDate: '2026-11-01' }],
    transfers: [{ id: 'tr1', fromAccountId: 'a', toAccountId: 'b', amountCents: 30000, date: '2026-11-10', createdAt: 1 }],
  });

  it('transferência muda o saldo das duas contas e não muda o patrimônio', () => {
    const d = base();
    expect(accountBalance(d.accounts[0], d)).toBe(70000);
    expect(accountBalance(d.accounts[1], d)).toBe(30000);
    const without = { ...d, transfers: [] };
    expect(netWorthAt(d, TODAY, TODAY).totalCents).toBe(netWorthAt(without, TODAY, TODAY).totalCents);
  });

  it('transferência anterior à data do saldo inicial não conta; data de corte é respeitada', () => {
    const d = base();
    d.transfers.push({ id: 'tr0', fromAccountId: 'a', toAccountId: 'b', amountCents: 5000, date: '2026-10-20', createdAt: 0 });
    expect(accountBalance(d.accounts[0], d)).toBe(70000);
    expect(accountBalance(d.accounts[0], d, '2026-11-05')).toBe(100000);
  });

  it('limite usado do cartão = compras no crédito ainda não pagas', () => {
    const d = base();
    const tx = (id: string, status: 'paid' | 'pending', cardId?: string) => ({ id, type: 'expense' as const, kind: 'cartao' as const, description: 'x', amountCents: 10000, categoryId: 'compras', date: TODAY, paymentMethod: 'credito' as const, cardId, status, createdAt: 1 });
    d.transactions.push(tx('1', 'pending', 'c1'), tx('2', 'pending', 'c1'), tx('3', 'paid', 'c1'), tx('4', 'pending', 'c2'));
    expect(cardUsedCents('c1', d)).toBe(20000);
    expect(cardUsedCents('c9', d)).toBe(0);
  });

  it('backup antigo (sem transferências) abre com a lista vazia', () => {
    const old = emptyData() as Partial<AppData>;
    delete old.transfers;
    expect(validateImported({ schema: 1, data: old, settings: {} }).data.transfers).toEqual([]);
  });
});

describe('exportação aberta em JSON', () => {
  it('leva os dados e não leva PIN nem token', () => {
    const d = { ...emptyData(), accounts: [{ id: 'a', name: 'Conta', kind: 'corrente' as const, initialCents: 1, initialDate: TODAY }] };
    const s = { ...DEFAULT_SETTINGS, api: { ...DEFAULT_SETTINGS.api, brapiToken: 'TOKEN-SECRETO' }, security: { ...DEFAULT_SETTINGS.security, hash: 'HASH-DO-PIN' } };
    const out = exportOpenJson(d, s);
    const parsed = JSON.parse(out);
    expect(parsed.data.accounts[0].name).toBe('Conta');
    expect(out).not.toContain('TOKEN-SECRETO');
    expect(out).not.toContain('HASH-DO-PIN');
    expect(parsed.settings.security).toBeUndefined();
  });
});
