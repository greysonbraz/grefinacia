import { describe, expect, it } from 'vitest';
import { maskMoneyInput, parseMoney } from '../src/lib/money';
import { formatNanoMoney } from '../src/domain/nanoPrompt';

const type = (keys: string) => { let v = ''; for (const k of keys) v = maskMoneyInput(v, v + k); return v; };

describe('valor sem precisar de vírgula', () => {
  it('digitando: os números entram pela direita', () => {
    expect(type('6')).toBe('0,06');
    expect(type('66648')).toBe('666,48');
    expect(type('120900')).toBe('1.209,00');
    expect(parseMoney(type('120900'))).toBe(120900);
  });
  it('apagar volta um dígito', () => {
    expect(maskMoneyInput('666,48', '666,4')).toBe('66,64');
    expect(maskMoneyInput('0,06', '0,0')).toBe('');
  });
  it('colar ou preencher de uma vez vale como escrito', () => {
    expect(maskMoneyInput('', '3500')).toBe('3.500,00');
    expect(maskMoneyInput('', '1.209,50')).toBe('1.209,50');
    expect(maskMoneyInput('', '10.000')).toBe('10.000,00');
  });
  it('vírgula digitada é ignorada', () => {
    expect(maskMoneyInput('1,20', '1,20,')).toBe('1,20');
  });
});

describe('respostas da IA do aparelho em reais', () => {
  it('formata valores com 2 casas; porcentagem fica', () => {
    expect(formatNanoMoney('Seu saldo atual é de 3.77. As despesas totais do mês são 5448.14.')).toBe('Seu saldo atual é de R$ 3,77. As despesas totais do mês são R$ 5.448,14.');
    expect(formatNanoMoney('Gastou R$ 1925.12 e a taxa é 3.80% a.a.')).toBe('Gastou R$ 1.925,12 e a taxa é 3.80% a.a.');
    expect(formatNanoMoney('Já está R$ 1.234,56')).toBe('Já está R$ 1.234,56');
  });
});
