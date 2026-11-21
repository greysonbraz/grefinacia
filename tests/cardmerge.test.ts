import { describe, expect, it } from 'vitest';
import { planCardMerge } from '../src/domain/cardmerge';
import { emptyData } from '../src/lib/defaults';
import type { Transaction } from '../src/lib/types';

const card = (id: string, name: string) => ({ id, name, closingDay: 30, dueDay: 7 }) as never;
const tx = (id: string, cardId: string) => ({ id, cardId, type: 'expense' }) as unknown as Transaction;

describe('um cartão só por banco', () => {
  it('junta o cartão repetido do mesmo banco no ligado à conexão (o com mais lançamentos)', () => {
    const d = emptyData();
    d.cards = [card('novo', 'Inter · PLATINUM PRIME DUO final 1568'), card('velho', 'Cartão Inter'), card('nu', 'Nubank')];
    d.transactions = [tx('1', 'novo'), tx('2', 'novo'), tx('3', 'velho')];
    const accounts = [{ id: 'accC', itemId: 'it1', bankName: 'Inter', type: 'CREDIT' }];
    const r = planCardMerge(d, { accC: { kind: 'cartao', id: 'novo' } }, accounts);
    expect([...r.map]).toEqual([['velho', 'novo']]);
  });
  it('dois cartões do mesmo banco na conexão viram um só; outro banco fica separado', () => {
    const d = emptyData();
    d.cards = [card('a', 'Inter · Black'), card('b', 'Inter · Gold'), card('x', 'Itaú · Click')];
    d.transactions = [tx('1', 'b'), tx('2', 'b'), tx('3', 'a')];
    const accounts = [{ id: 'A', itemId: 'it1', bankName: 'Inter' }, { id: 'B', itemId: 'it1', bankName: 'Inter' }, { id: 'X', itemId: 'it2', bankName: 'Itaú' }];
    const r = planCardMerge(d, { A: { kind: 'cartao', id: 'a' }, B: { kind: 'cartao', id: 'b' }, X: { kind: 'cartao', id: 'x' } }, accounts);
    expect([...r.map]).toEqual([['a', 'b']]);
    expect(r.links.A).toEqual({ kind: 'cartao', id: 'b' });
    expect(r.links.X).toEqual({ kind: 'cartao', id: 'x' });
  });
  it('nada a juntar', () => {
    const d = emptyData();
    d.cards = [card('a', 'Inter · Black')];
    expect(planCardMerge(d, { A: { kind: 'cartao', id: 'a' } }, [{ id: 'A', itemId: 'i', bankName: 'Inter' }]).map.size).toBe(0);
  });
});
