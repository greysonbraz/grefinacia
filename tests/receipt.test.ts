import { describe, expect, it } from 'vitest';
import { parseReceipt } from '../src/domain/receipt';

describe('leitura de cupom (texto da câmera)', () => {
  it('NFC-e típica: loja, total a pagar e data', () => {
    const t = `SUPERMERCADO BOM PRECO LTDA
CNPJ: 12.345.678/0001-90  IE: 123456
RUA DAS FLORES, 100 - CENTRO
DOCUMENTO AUXILIAR DA NOTA FISCAL DE CONSUMIDOR ELETRONICA
ARROZ 5KG 1 UN X 27,90 27,90
FEIJAO 1KG 2 UN X 8,49 16,98
QTD. TOTAL DE ITENS 3
VALOR TOTAL R$ 44,88
DESCONTO R$ 0,00
VALOR A PAGAR R$ 44,88
CARTAO DE DEBITO 44,88
Emissao: 16/11/2026 18:32:10`;
    expect(parseReceipt(t, '2026-11-18')).toEqual({ merchant: 'SUPERMERCADO BOM PRECO LTDA', totalCents: 4488, date: '2026-11-16', cnpj: '12.345.678/0001-90' });
  });
  it('total na linha seguinte, milhar com ponto, data com ano curto; troco e tributos ignorados', () => {
    const t = `POSTO JATAY
TOTAL A PAGAR
R$ 1.250,00
TROCO R$ 50,00
Tributos aprox R$ 300,00
17/11/26`;
    expect(parseReceipt(t, '2026-11-18')).toMatchObject({ merchant: 'POSTO JATAY', totalCents: 125000, date: '2026-11-17' });
  });
  it('sem total escrito: usa o maior valor com R$; data no futuro é descartada', () => {
    const t = `Padaria Pao Quente\nCafe R$ 6,50\nPao R$ 12,00\n20/12/2026`;
    expect(parseReceipt(t, '2026-11-18')).toMatchObject({ merchant: 'Padaria Pao Quente', totalCents: 1200, date: null });
  });
  it('texto ilegível não inventa nada', () => {
    expect(parseReceipt('### ??', '2026-11-18')).toEqual({ merchant: null, totalCents: null, date: null, cnpj: null });
  });
});
