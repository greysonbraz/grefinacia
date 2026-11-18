import { createRequire } from 'node:module';
// Playwright: usa o que estiver instalado no projeto (GitHub Actions) ou o caminho indicado em PW_ROOT
// (máquinas que já têm o Playwright instalado fora do projeto).
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire(process.env.PW_ROOT + '/')('playwright'));
}
import { spawn } from 'node:child_process';
const srv = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
const page = await ctx.newPage();
const errors = [];
let expectCspBlock = false; // durante o teste da CSP, o bloqueio aparece no console e é o resultado esperado
page.on('console', (m) => m.type() === 'error' && !(expectCspBlock && /Content Security Policy/i.test(m.text())) && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
const ok = (c, msg) => { if (!c) { errors.push('ASSERT ' + msg); console.log('FALHOU:', msg); } else console.log('ok:', msg); };
const shot = (n) => page.screenshot({ path: `shots/${n}.png` });
const tab = (n) => page.getByRole('navigation', { name: 'Principal' }).getByRole('button', { name: n, exact: true }).click();
const seg = (n) => page.locator('.seg button', { hasText: n }).first().click();
const text = async () => (await page.locator('body').innerText()).replace(/ /g, ' ');
try {
  await page.goto('http://localhost:4173/');
  // onboarding
  await page.waitForSelector('.logomark');
  await shot('00-boas-vindas');
  await page.fill('input[name=saldo]', '2.500,00');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByText('Agora não, entrar sem PIN').click();
  await page.waitForSelector('nav.nav');
  ok((await text()).includes('R$ 2.500,00'), 'saldo inicial aparece no painel');

  // salário
  await tab('Planejamento');
  await page.fill('input[name=salario]', '3500');
  await page.fill('input[name=dia]', '20');
  await page.getByRole('button', { name: 'Salvar plano' }).click();
  await page.waitForTimeout(600);

  // despesas: fixa recorrente 1500, variável 200
  await tab('Movimentações');
  const addTx = async (kind, desc, val, extra) => {
    await page.locator('.fab').click();
    await page.locator('.sheet select').first().selectOption(kind);
    await page.fill('input[name=descricao]', desc);
    await page.fill('input[name=valor]', val);
    if (extra) await extra();
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await page.waitForTimeout(500);
  };
  await addTx('fixa', 'Aluguel', '1.500,00');
  await addTx('variavel', 'Mercado', '200');
  ok((await text()).includes('R$ 1.700,00'), 'despesas do mês somam 1.700');
  await seg('Recorrentes');
  ok((await text()).includes('Aluguel'), 'despesa fixa virou recorrente');
  await seg('Calendário');
  await page.waitForTimeout(300);
  ok((await text()).includes('Contas e faturas no mês') && (await text()).includes('Aluguel'), 'calendário financeiro mostra as contas do mês');
  await shot('03b-calendario');
  await seg('Gráficos');
  await page.waitForTimeout(600);
  await shot('03-movimentacoes-graficos');
  await seg('Lançamentos');
  await shot('02-movimentacoes');
  // detalhe em tela própria
  await page.locator('.screen .group button.row').filter({ hasText: /−|\+/ }).first().click();
  ok(await page.getByRole('dialog', { name: 'Movimentação' }).isVisible(), 'detalhe da movimentação em tela própria');
  await page.waitForTimeout(600);
  await shot('02b-detalhe');
  await page.getByRole('dialog', { name: 'Movimentação' }).getByRole('button', { name: 'Voltar', exact: true }).click();
  // filtro por período
  await page.getByRole('button', { name: 'Filtros' }).click();
  await page.getByLabel('Período').selectOption('90');
  await page.getByRole('button', { name: 'Aplicar' }).click();
  ok(await page.getByRole('button', { name: /Últimos 90 dias/ }).isVisible(), 'filtro: últimos 90 dias');
  await page.getByRole('button', { name: 'Limpar filtros' }).click();

  // plano: 3500 - 1500 = 2000 → 20% 400, 20% 400, livre 1200, restante 1000
  await tab('Planejamento');
  let t = await text();
  ok(t.includes('R$ 400,00') && t.includes('R$ 1.200,00') && t.includes('R$ 1.000,00'), 'plano salarial: guardar 400, investir 400, livre 1.200, resta 1.000');
  await shot('06-planejamento-salario');

  // reserva
  await seg('Reservas');
  await page.locator('.fab').click();
  await page.fill('input[name=objetivo]', 'Reserva de emergência');
  await page.fill('input[name=meta]', '10.000');
  await page.fill('input[name=inicial]', '2.000');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Depositar ou retirar' }).click();
  await page.fill('input[name=valor_reserva]', '500');
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await page.waitForTimeout(400);
  t = await text();
  ok(t.includes('R$ 2.500,00 de R$ 10.000,00') && t.includes('25,0%'), 'reserva: 2.500 de 10.000 = 25%');
  await shot('07-reservas');

  // dívida
  await seg('Dívidas');
  await page.locator('.fab').click();
  await page.fill('input[name=divida]', 'Empréstimo pessoal');
  await page.fill('input[name=saldo_devedor]', '10.000');
  await page.fill('input[name=parcela]', '528,71');
  await page.fill('input[name=parcelas]', '24');
  await page.fill('input[name=juros]', '2');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await page.waitForTimeout(400);
  await page.locator('.row', { hasText: 'Empréstimo pessoal' }).click();
  await page.fill('input[name=nova_taxa]', '1,2');
  await page.waitForTimeout(300);
  t = await text();
  ok(t.includes('24 meses') && t.includes('Economia total'), 'simulações da dívida aparecem (24 meses, portabilidade)');
  await shot('08-divida-simulacoes');
  await page.getByRole('button', { name: 'Voltar', exact: true }).click();

  // investimentos
  await tab('Investimentos');
  await seg('Bolsa (B3)');
  const addOp = async (tk, type, q, p) => {
    await page.locator('.fab').click();
    await page.fill('input[name=ticker]', tk);
    await page.locator('.sheet select').first().selectOption(type);
    await page.fill('input[name=quantidade]', q);
    await page.fill('input[name=preco]', p);
    await page.fill('input[name=corretora]', 'XP');
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await page.waitForTimeout(400);
  };
  await addOp('ITSA4', 'acao', '100', '10,00');
  await addOp('MXRF11', 'fii', '200', '10,00');
  t = await text();
  ok(t.includes('R$ 3.000,00') && t.includes('sem cotação'), 'carteira: investido 3.000 e ativos marcados "sem cotação" (sem dados inventados)');
  ok(t.includes('Desempenho') && t.includes('CDI') && t.includes('IPCA'), 'bolsa: quadro de desempenho comparando com CDI e IPCA');
  await shot('04-investimentos');
  await seg('Visão geral');
  await page.waitForTimeout(400);
  t = await text();
  ok(t.includes('Seus investimentos hoje') && t.includes('Maiores posições') && t.includes('Fundos imobiliários'), 'visão geral dos investimentos');
  await shot('04a-visao-geral');
  await seg('Bolsa (B3)');
  // cripto: compra fracionada informando o total pago
  await seg('Cripto');
  await page.locator('.fab').click();
  await page.locator('.sheet select[name=moeda]').selectOption('bitcoin');
  await page.fill('input[name=quantidade]', '0,01');
  await page.fill('input[name=valor]', '3.000,00');
  t = await text();
  ok(t.includes('Preço por unidade: R$ 300.000,00'), 'cripto: total pago ÷ quantidade = preço por unidade');
  await page.fill('input[name=corretora]', 'Exchange');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await page.waitForTimeout(500);
  t = await text();
  ok(t.includes('Bitcoin') && t.includes('0,01 BTC') && t.includes('R$ 3.000,00') && t.includes('sem cotação'), 'cripto: 0,01 BTC por R$ 3.000, marcado "sem cotação"');
  await shot('04b-cripto');
  ok(t.includes('Mercado agora') && t.includes('Ethereum') && t.includes('Dogecoin'), 'cripto: mercado agora com as principais moedas');
  await page.locator('.row', { hasText: 'Bitcoin' }).first().click();
  t = await text();
  ok(t.includes('Preço médio') && t.includes('R$ 300.000,00'), 'cripto: detalhe com preço médio');
  await page.getByRole('button', { name: 'Voltar', exact: true }).click();
  // provento manual MXRF11 0,10 pagamento mês que vem
  await seg('Dividendos');
  await page.getByRole('button', { name: 'Cadastrar' }).click();
  await page.locator('.sheet select').first().selectOption({ label: 'MXRF11' });
  await page.fill('input[name=valor_cota]', '0,10');
  const d = new Date(); d.setMonth(d.getMonth() + 1, 15);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-15`;
  await page.locator('.sheet input[type=date]').nth(1).fill(iso);
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await page.waitForTimeout(500);
  t = await text();
  ok(t.includes('R$ 20,00') && t.includes('anunciado') && t.includes('ITSA4'), 'previsão: 200 cotas × 0,10 = R$ 20,00 anunciado; ITSA4 sem histórico');
  await page.locator('.cal .has').first().scrollIntoViewIfNeeded();
  await shot('05-dividendos');
  t = await text();
  ok(t.includes('Recebido no mês') && t.includes('Aguardando confirmação') && t.includes('Pagamento previsto'), 'proventos: painel separa recebido de previsto; status "Pagamento previsto"');
  await page.locator('.divmain', { hasText: 'MXRF11' }).first().click();
  t = await text();
  ok(t.includes('Quantidade elegível') && t.includes('informado por você') && t.includes('Recebi') && t.includes('Cancelar'), 'proventos: detalhe com quantidade elegível, origem e ações');
  await page.locator('.divdetail').scrollIntoViewIfNeeded();
  await shot('05b-proventos-historico');
  await seg('Bolsa (B3)');
  t = await text();
  ok(t.includes('Rentabilidade total') && t.includes('Proventos futuros') && t.includes('Patrimônio atual'), 'bolsa: rentabilidade total separando patrimônio, recebido e futuro');
  await seg('Dividendos');

  // chat
  await tab('Grefinacia AI');
  await page.waitForTimeout(300);
  await shot('09a-ai-inicio');
  await page.getByText('Quanto posso gastar até o próximo salário?').click();
  await page.waitForTimeout(500);
  t = await text();
  ok(t.includes('R$ 1.000,00') && t.includes('Livre no mês'), 'chat responde com R$ 1.000,00 e mostra o cálculo');
  await page.fill('.composer input', 'Posso comprar uma moto de R$ 15.000?');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  ok((await text()).includes('Valor da compra: R$ 15.000,00'), 'chat analisa compra com valor');
  await shot('09-grefinacia-ai');
  await page.fill('.composer input', 'Como fica meu saldo nos próximos meses?');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  t = await text();
  ok(t.includes('Saldo de hoje') && t.includes('Gasto do dia a dia estimado'), 'chat responde a previsão de caixa com a conta');
  await seg('Raio-X');
  await page.waitForTimeout(400);
  t = await text();
  ok(t.includes('Previsão de caixa') && t.includes('Cobranças em dobro') && t.includes('Assinaturas e cobranças mensais') && t.includes('Raio-X da carteira'), 'Raio-X: previsão, cobranças em dobro, assinaturas e carteira');
  await shot('09b-raio-x');

  // comparador de empréstimos
  await tab('Planejamento');
  await seg('Dívidas');
  await page.getByRole('button', { name: /Comparar empréstimos/ }).click();
  await page.waitForTimeout(400); // animação de entrada da tela
  await page.fill('input[name=taxa_0]', '2');
  await page.fill('input[name=taxa_1]', '3');
  await page.fill('input[name=tarifas_1]', '0');
  t = await text();
  ok(t.includes('R$ 945,60') && t.includes('menor custo efetivo') && t.includes('CET estimado'), 'comparador: 10 mil em 12× a 2% = R$ 945,60 e aponta o menor CET');
  await shot('10-comparador');
  await page.getByRole('button', { name: 'Voltar', exact: true }).click();

  // importar extrato (CSV) com prévia e desfazer
  await tab('Movimentações');
  await page.getByRole('button', { name: 'Importar extrato' }).click();
  await page.waitForTimeout(400);
  const csv = 'Data;Histórico;Descrição;Valor\n02/11/2026;Pix enviado;Padaria Pão Quente;-12,50\n03/11/2026;Compra;UBER *TRIP;-23,50\n04/11/2026;Pagamento de fatura;Cartão;-500,00\n';
  await page.locator('input[type=file]').setInputFiles({ name: 'extrato.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await page.waitForTimeout(400);
  t = await text();
  ok(t.includes('Importar 2 lançamentos') && t.includes('Pagamento de fatura') && t.includes('UBER *TRIP'), 'importação: prévia com 2 marcados e pagamento de fatura desmarcado');
  ok((await page.locator('select[aria-label="Categoria de Compra - UBER *TRIP"]').inputValue()) === 'transporte', 'importação: Uber sugerido como Transporte');
  await shot('11-importar');
  await page.getByRole('button', { name: 'Importar 2 lançamentos' }).click();
  await page.waitForTimeout(500);
  t = await text();
  ok(t.includes('Importações anteriores') && t.includes('extrato.csv') && t.includes('Desfazer'), 'importação: aparece no histórico com Desfazer');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /Desfazer/ }).click();
  await page.waitForTimeout(500);
  ok((await text()).includes('desfeita'), 'importação: desfeita');
  await page.getByRole('button', { name: 'Voltar', exact: true }).click();

  // relatórios
  await tab('Planejamento');
  await seg('Relatórios');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Relatório mensal em PDF/ }).click()]);
  const path = await dl.path();
  const { statSync, readFileSync } = await import('node:fs');
  ok(readFileSync(path).subarray(0, 5).toString() === '%PDF-' && statSync(path).size > 2000, 'PDF de fechamento gerado');
  await shot('10-relatorios');
  await seg('Liberdade');
  await page.waitForTimeout(500);
  await shot('11-liberdade');
  ok((await text()).includes('Meu futuro') && (await text()).includes('Para chegar a R$ 1 milhão'), 'liberdade: meu futuro e R$ 1 milhão');
  await seg('Desafios');
  await page.getByRole('button', { name: /7 dias sem comer fora/ }).click();
  await page.waitForTimeout(400);
  ok((await text()).includes('7 dias sem alimentação fora'), 'desafio começou');
  await shot('11b-desafios');

  // início + notificações planejadas
  await tab('Início');
  await page.waitForTimeout(900);
  await shot('01-inicio');
  // resto do Início (a tela rola dentro de .screen)
  for (const [i, y] of [[2, 900], [3, 1800], [4, 2700], [5, 3600]]) {
    await page.evaluate((top) => document.querySelector('.screen')?.scrollTo(0, top), y);
    await page.waitForTimeout(250);
    await shot(`01-inicio-${i}`);
  }
  await page.evaluate(() => document.querySelector('.screen')?.scrollTo(0, 0));
  t = await text();
  ok(t.includes('Patrimônio total') && t.includes('Dívidas') && t.includes('R$ 10.000,00') && t.includes('Saúde financeira'), 'painel mostra patrimônio, dívidas e saúde financeira');
  // ocultar valores (olho) e mostrar de novo
  await page.getByRole('button', { name: 'Ocultar valores' }).click();
  ok((await page.evaluate(() => document.documentElement.dataset.hide)) === '1', 'olho oculta os valores');
  await page.getByRole('button', { name: 'Mostrar valores' }).click();
  ok(t.includes('Gastos de') && t.includes('Previsão de'), 'início mostra gastos do mês e previsão do mês que vem');
  // aba Dólar: conta em dólar e ETF
  await seg('US$ Dólar');
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await page.locator('.sheet input').nth(0).fill('Conta Global Inter');
  await page.locator('.sheet input').nth(1).fill('250,00');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await page.waitForTimeout(300);
  t = await text();
  ok(t.includes('Total em dólar') && t.includes('$250.00'), 'aba Dólar soma a conta em dólar');
  await shot('01b-dolar');
  // renda fixa em dólar (Porquinho): vencimento e estimativa
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await page.locator('.sheet select').first().selectOption('deposito');
  await page.getByLabel('Nome').fill('TD Meu Porquinho 90 dias');
  await page.getByLabel('Valor de hoje (US$)').fill('10,95');
  await page.getByLabel('Valor aplicado (US$)').fill('10,90');
  await page.getByLabel('Rentabilidade (% ao ano)').fill('3,8');
  await page.getByLabel('Aplicação').fill('2026-10-05');
  await page.getByLabel('Vencimento').fill('2027-01-03');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await page.waitForTimeout(300);
  t = await text();
  ok(t.includes('03/01/2027') && t.includes('Rendeu até agora') && t.includes('No vencimento'), 'Porquinho: vencimento, rendimento e estimativa');
  await page.locator('.deposit').scrollIntoViewIfNeeded();
  await shot('01c-porquinho');
  await seg('R$ Reais');
  // tema claro + persistência
  await page.getByRole('button', { name: 'Ajustes' }).click();
  await seg('Claro');
  ok((await page.evaluate(() => document.documentElement.dataset.theme)) === 'light', 'tema claro aplicado');
  await page.getByRole('switch', { name: 'IA no aparelho (Gemini Nano)' }).scrollIntoViewIfNeeded();
  await page.getByRole('switch', { name: 'IA no aparelho (Gemini Nano)' }).click();
  await page.waitForTimeout(400);
  t = await text();
  ok(t.includes('Só funciona no app Android') && t.includes('métricas de uso'), 'Gemini Nano: opção com aviso de métricas; no navegador avisa que é só no Android');
  await shot('12-gemini-nano');
  await page.locator('.kv', { hasText: 'Conexão bancária (Meu Pluggy)' }).getByRole('button', { name: 'Abrir' }).click();
  await page.waitForTimeout(400);
  t = await text();
  ok(t.includes('Chaves da sua aplicação na Pluggy') && t.includes('Um Item ID por banco'.replace('Um', 'um')) && t.includes('No navegador a conexão não funciona'), 'conexão bancária: tela com chaves, bancos e aviso de que só funciona no Android');
  await page.fill('input[name=pluggy_item]', 'nao-e-um-id');
  await page.getByRole('button', { name: 'Adicionar banco' }).click();
  await page.waitForTimeout(300);
  ok((await text()).includes('O Item ID tem o formato'), 'conexão bancária: recusa Item ID em formato errado');
  await shot('13-conexao-bancaria');
  await page.getByRole('button', { name: 'Voltar', exact: true }).last().click(); // fecha a tela de cima
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Voltar', exact: true }).click();
  await page.waitForTimeout(500);
  await shot('12-inicio-claro');
  await page.reload();
  await page.waitForSelector('nav.nav');
  await page.waitForTimeout(500);
  t = await text();
  ok(t.includes('Patrimônio total') && t.includes('R$ 10.000,00') && (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light', 'dados e tema persistem após recarregar');
  // segurança: a política de conteúdo está no app compilado e bloqueia script embutido e eval
  const csp = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? '');
  ok(csp.includes("script-src 'self'") && !csp.includes('unsafe-eval') && csp.includes("object-src 'none'"), 'CSP presente, sem eval e sem plugins');
  expectCspBlock = true;
  // as tentativas rodam num setTimeout, fora da chamada de depuração do Playwright (que ignora a CSP para eval)
  await page.evaluate(() => {
    setTimeout(() => {
      const el = document.createElement('script');
      el.textContent = 'window.__inlineRan = true';
      document.head.appendChild(el);
      try { window.__evalRan = (0, eval)('1 + 1') === 2; } catch { window.__evalRan = false; }
      window.__cspChecked = true;
    }, 0);
  });
  await page.waitForFunction(() => window.__cspChecked === true);
  const tried = await page.evaluate(() => ({ inline: window.__inlineRan === true, evalRan: window.__evalRan === true }));
  await page.waitForTimeout(200);
  expectCspBlock = false;
  ok(!tried.inline, 'script embutido é bloqueado pela CSP');
  ok(!tried.evalRan, 'eval é bloqueado pela CSP');
  // overflow horizontal
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'sem rolagem horizontal em 412px');
  // celular pequeno (360px) e "reduzir movimento": nada vaza para os lados em nenhuma aba
  await page.setViewportSize({ width: 360, height: 760 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const name of ['Início', 'Movimentações', 'Investimentos', 'Grefinacia AI', 'Planejamento']) {
    await tab(name);
    await page.waitForTimeout(250);
    const wide = await page.evaluate(() => {
      const vw = window.innerWidth;
      return [...document.querySelectorAll('.screen *')].filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0) return false;
        // faixas que rolam de propósito (abas, atalhos, mercado) ficam de fora
        if (el.closest('.seg, .shortcuts, .mstrip, .chips, .qchips')) return false;
        return r.right > vw + 1;
      }).map((el) => el.className || el.tagName).slice(0, 3);
    });
    ok(wide.length === 0, `360px sem vazamento em ${name}${wide.length ? ': ' + wide.join(', ') : ''}`);
  }
  await tab('Início');
  await shot('99-inicio-360');
} catch (e) { errors.push('EXCEPTION ' + e.message); await shot('erro'); }
console.log('\nERROS:', errors.length ? errors : 'nenhum');
await browser.close(); srv.kill();
process.exit(errors.length ? 1 : 0);
