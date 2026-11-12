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
const tab = (n) => page.locator('nav.nav button', { hasText: n }).click();
const seg = (n) => page.locator('.seg button', { hasText: n }).first().click();
const text = async () => (await page.locator('body').innerText()).replace(/ /g, ' ');
try {
  await page.goto('http://localhost:4173/');
  // onboarding
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
  await seg('Gráficos');
  await page.waitForTimeout(600);
  await shot('03-movimentacoes-graficos');
  await seg('Lançamentos');
  await shot('02-movimentacoes');

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
  await page.getByRole('button', { name: 'Voltar' }).click();

  // investimentos
  await tab('Investimentos');
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
  await shot('04-investimentos');
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

  // chat
  await tab('Grefinacia AI');
  await page.getByText('Quanto posso gastar até o próximo salário?').click();
  await page.waitForTimeout(500);
  t = await text();
  ok(t.includes('R$ 1.000,00') && t.includes('Livre no mês'), 'chat responde com R$ 1.000,00 e mostra o cálculo');
  await page.fill('.composer input', 'Posso comprar uma moto de R$ 15.000?');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  ok((await text()).includes('Valor da compra: R$ 15.000,00'), 'chat analisa compra com valor');
  await shot('09-grefinacia-ai');

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

  // início + notificações planejadas
  await tab('Início');
  await page.waitForTimeout(900);
  await shot('01-inicio');
  t = await text();
  ok(t.includes('Patrimônio total') && t.includes('Total de dívidas') && t.includes('R$ 10.000,00'), 'painel mostra patrimônio e dívidas');
  // tema claro + persistência
  await page.getByRole('button', { name: 'Ajustes' }).click();
  await seg('Claro');
  ok((await page.evaluate(() => document.documentElement.dataset.theme)) === 'light', 'tema claro aplicado');
  await page.getByRole('button', { name: 'Voltar' }).click();
  await page.waitForTimeout(500);
  await shot('12-inicio-claro');
  await page.reload();
  await page.waitForSelector('nav.nav');
  await page.waitForTimeout(500);
  t = await text();
  ok(t.includes('Total de dívidas') && (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light', 'dados e tema persistem após recarregar');
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
} catch (e) { errors.push('EXCEPTION ' + e.message); await shot('erro'); }
console.log('\nERROS:', errors.length ? errors : 'nenhum');
await browser.close(); srv.kill();
process.exit(errors.length ? 1 : 0);
