import { describe, expect, it } from 'vitest';
import { nfceHostAllowed, parseNfceHtml, parseNfceQr } from '../src/domain/nfce';

const CHAVE = '41261112345678000190650010000123451000012345';

describe('QR da NFC-e', () => {
  it('online: chave, estado, CNPJ, mês e número; link vira https', () => {
    const q = parseNfceQr(`http://www.fazenda.pr.gov.br/nfce/qrcode?p=${CHAVE}|2|1|1|ABCDEF0123456789`)!;
    expect(q).toMatchObject({ url: `https://www.fazenda.pr.gov.br/nfce/qrcode?p=${CHAVE}|2|1|1|ABCDEF0123456789`, chave: CHAVE, uf: '41', cnpj: '12345678000190', ym: '2026-11', numero: 12345 });
    expect(q.offline).toBeUndefined();
    expect(nfceHostAllowed(q.url)).toBe(true);
  });
  it('contingência traz dia e valor', () => {
    const q = parseNfceQr(`https://www.fazenda.pr.gov.br/nfce/qrcode?p=${CHAVE}|2|1|07|52.30|6a6b|1|HASH`)!;
    expect(q.offline).toEqual({ day: 7, totalCents: 5230 });
  });
  it('QR que não é de nota', () => {
    expect(parseNfceQr('https://exemplo.com/?p=123')).toBeNull();
    expect(parseNfceQr('WIFI:S:casa;T:WPA;P:senha;;')).toBeNull();
    expect(nfceHostAllowed('https://www.nfce.fazenda.sp.gov.br/qrcode?p=1')).toBe(false);
  });
});

describe('página pública da NFC-e', () => {
  const html = `<html><body>
    <div id="u20" class="txtTopo">SUPERMERCADO BOM PRECO LTDA</div>
    <div class="text">CNPJ: 12.345.678/0001-90</div>
    <table id="tabResult">
      <tr id="Item + 1"><td><span class="txtTit">ARROZ TIPO 1 5KG</span><span class="RCod">(Código: 123)</span><br><span class="Rqtd"><strong>Qtde.:</strong>1</span><span class="RUN"><strong>UN: </strong>UN</span></td><td><span class="valor">24,90</span></td></tr>
      <tr id="Item + 2"><td><span class="txtTit">BANANA PRATA</span><span class="Rqtd"><strong>Qtde.:</strong>1,235</span><span class="RUN"><strong>UN: </strong>KG</span></td><td><span class="valor">7,40</span></td></tr>
    </table>
    <div id="totalNota"><div id="linhaTotal"><label>Qtd. total de itens:</label><span class="totalNumb">2</span></div>
    <div id="linhaTotal"><label>Valor total R$:</label><span class="totalNumb">32,30</span></div>
    <div id="linhaTotal" class="linhaShade"><label>Valor a pagar R$:</label><span class="totalNumb txtMax">32,30</span></div></div>
    <li><strong>Emissão: </strong>07/11/2026 12:34:56 - Via Consumidor</li>
  </body></html>`;
  it('loja, CNPJ, data, total e itens', () => {
    expect(parseNfceHtml(html)).toEqual({
      merchant: 'SUPERMERCADO BOM PRECO LTDA', cnpj: '12.345.678/0001-90', date: '2026-11-07', totalCents: 3230,
      items: [{ name: 'ARROZ TIPO 1 5KG', qty: 1, unit: 'UN', totalCents: 2490 }, { name: 'BANANA PRATA', qty: 1.235, unit: 'KG', totalCents: 740 }],
    });
  });
  it('captcha ou página diferente: não tenta (abre no navegador)', () => {
    expect(parseNfceHtml('<html><div class="g-recaptcha"></div>captcha</html>')).toBeNull();
    expect(parseNfceHtml('<html><body>Serviço indisponível</body></html>')).toBeNull();
  });
});
