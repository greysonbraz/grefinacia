import { describe, expect, it } from 'vitest';
import { approxTokens, buildNanoRequest, cleanNanoAnswer, NANO_MAX_OUTPUT, NANO_SYSTEM, nanoContext } from '../src/domain/nanoPrompt';
import { answerLocally } from '../src/domain/chat';
import { computeOverview } from '../src/domain/overview';
import { DEFAULT_SETTINGS, emptyData } from '../src/lib/defaults';
import { mergeSettings } from '../src/db/db';
import { askNano, nanoStatus } from '../src/services/nano';
import type { AppData } from '../src/lib/types';

const TODAY = '2026-11-16';
const data: AppData = { ...emptyData(), accounts: [{ id: 'a1', name: 'Conta', kind: 'corrente', initialCents: 250000, initialDate: '2026-01-01' }] };

describe('Gemini Nano: pergunta montada para o modelo do aparelho', () => {
  it('instrução curta (o Google recomenda até 150 palavras) e em português', () => {
    expect(NANO_SYSTEM.split(/\s+/).length).toBeLessThanOrEqual(150);
    expect(NANO_SYSTEM).toMatch(/SOMENTE os números/);
  });

  it('leva só totais e os extras do motor local; nada de descrição de lançamento', () => {
    const d: AppData = { ...data, transactions: [{ id: 't1', type: 'expense', kind: 'variavel', description: 'Farmácia do João segredo', amountCents: 5000, categoryId: 'saude', date: TODAY, paymentMethod: 'pix', accountId: 'a1', status: 'paid', createdAt: 1 }] };
    const ctx = nanoContext(computeOverview(d, DEFAULT_SETTINGS, TODAY), d, DEFAULT_SETTINGS);
    expect(Object.keys(ctx)).toEqual(expect.arrayContaining(['saldoContas', 'mesAtual', 'previsaoSaldo', 'assinaturasPorMes', 'foraDoPadrao']));
    expect(JSON.stringify(ctx)).not.toContain('segredo');
  });

  it('cabe no limite do modelo: corta primeiro as partes menos importantes', () => {
    const big = { saldoContas: 1, mesAtual: { receitas: 1 }, assinaturas: Array.from({ length: 200 }, (_, i) => ({ nome: 'Assinatura ' + i, valor: i })), carteira: Array.from({ length: 200 }, (_, i) => ({ ativo: 'ATIV' + i, valor: i })), previsaoSaldo: [{ mes: '2026-11', saldoFinal: 1 }] };
    const r = buildNanoRequest('Quanto tenho?', big, 4000);
    expect(r.dropped).toEqual(['assinaturas']); // bastou tirar a menos importante
    expect(r.prompt).toContain('previsaoSaldo');
    expect(r.tokens + NANO_MAX_OUTPUT).toBeLessThanOrEqual(4000);
    const small = buildNanoRequest('Quanto tenho?', big, 1200);
    expect(small.tokens + NANO_MAX_OUTPUT).toBeLessThanOrEqual(1200);
    expect(small.dropped.slice(0, 2)).toEqual(['assinaturas', 'carteira']);
  });

  it('pergunta enorme é cortada; dados pequenos vão inteiros', () => {
    const r = buildNanoRequest('a'.repeat(5000), { saldo: 10 }, 4000);
    expect(r.prompt.endsWith('a'.repeat(500))).toBe(true);
    expect(r.prompt).not.toContain('a'.repeat(501));
    expect(r.dropped).toEqual([]);
    expect(approxTokens('abc')).toBe(1);
  });

  it('limpa marcações da resposta', () => {
    expect(cleanNanoAnswer('## Resumo\n**Saldo:** R$ 10\n- item\n\n\n\nfim')).toBe('Resumo\nSaldo: R$ 10\n• item\n\nfim');
  });
});

describe('Gemini Nano: quando entra', () => {
  it('só nas perguntas que as regras não reconhecem', () => {
    const o = computeOverview(data, DEFAULT_SETTINGS, TODAY);
    expect(answerLocally('Quanto posso gastar até o próximo salário?', o, data, DEFAULT_SETTINGS).fallback).toBeUndefined();
    expect(answerLocally('Me explique o que é CDB com liquidez diária', o, data, DEFAULT_SETTINGS).fallback).toBe(true);
  });
  it('vem desligado por padrão e backups antigos ganham o padrão', () => {
    expect(DEFAULT_SETTINGS.ai.nano).toBe(false);
    expect(mergeSettings({ ai: { mode: 'local', apiKey: '', model: 'x', consent: false } as never }).ai.nano).toBe(false);
  });
  it('fora do app Android não tenta usar', async () => {
    expect((await nanoStatus(true)).state).toBe('so_android');
    await expect(askNano('oi', {})).rejects.toThrow(/Só funciona no app Android/);
  });
});
