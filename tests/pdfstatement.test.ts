import { describe, expect, it } from 'vitest';
import { parsePdfStatement } from '../src/domain/statement';

describe('extrato em PDF', () => {
  it('conta (estilo Inter): cabeçalho do dia, saída com menos, saldo ignorado', () => {
    const lines = [
      'Extrato da conta', 'Período: 01/11/2026 a 17/11/2026',
      '16 de novembro de 2026 Saldo do dia: R$ 3,77',
      'Pix enviado: "Cp :18236120-Franciele" -R$ 297,00 R$ 3,77',
      'Pix recebido: "Fulano de Tal" R$ 300,00 R$ 300,77',
      '13 de novembro de 2026 Saldo do dia: R$ 0,77',
      'Pix enviado: "Eduarda C" -R$ 20,00 R$ 0,77',
    ];
    const st = parsePdfStatement(lines, '2026-11-21');
    expect(st.kind).toBe('conta');
    expect(st.rows).toEqual([
      { date: '2026-11-16', amount: -29700, description: 'Pix enviado: Cp :18236120-Franciele' },
      { date: '2026-11-16', amount: 30000, description: 'Pix recebido: Fulano de Tal' },
      { date: '2026-11-13', amount: -2000, description: 'Pix enviado: Eduarda C' },
    ]);
  });
  it('fatura do cartão: compras viram saída e "Parcela 2 de 10" vira (2/10)', () => {
    const lines = [
      'Fatura do cartão', 'Vencimento 07/12/2026', 'Total da fatura R$ 1.417,02',
      '07 nov 2026 EBN TIKTOK SH SAO PAULO Parcela 1 de 10 R$ 120,21',
      '14/11 AMAZON MARKETPLACE R$ 52,09',
      '20/11 Pagamento recebido -R$ 500,00',
    ];
    const st = parsePdfStatement(lines, '2026-11-21');
    expect(st.kind).toBe('cartao');
    expect(st.rows).toEqual([
      { date: '2026-11-07', amount: -12021, description: 'EBN TIKTOK SH SAO PAULO (1/10)' },
      { date: '2026-11-14', amount: -5209, description: 'AMAZON MARKETPLACE' },
      { date: '2026-11-20', amount: 50000, description: 'Pagamento recebido' },
    ]);
  });
  it('sem lançamentos: erro claro', () => {
    expect(() => parsePdfStatement(['Olá', 'Nada aqui'], '2026-11-21')).toThrow(/não achei lançamentos/);
  });
});
