import type { AppData, Settings } from '../lib/types';
import { diffDays, formatDateBR, makeDate, addMonthsYM, monthName } from '../lib/dates';
import { formatBRL, formatPct, parseMoney } from '../lib/money';
import type { Overview } from './overview';
import { generateInsights } from './insights';
import { goalProgress } from './goals';
import { debtTotals, annualFromMonthly } from './debts';
import { monthSummary } from './ledger';
import { cashForecast, CLASS_LABEL, detectSubscriptions, findDuplicates, portfolioXray, unusualSpending } from './analysis';
import { monthShortYear } from '../lib/dates';

export interface ChatAnswer {
  text: string;
  calc?: string[]; // passo a passo dos cálculos
}

export const SUGGESTED_QUESTIONS = [
  'Quanto posso gastar até o próximo salário?',
  'Quanto consegui economizar este mês?',
  'Quanto posso investir sem prejudicar minhas contas?',
  'Quais despesas posso reduzir?',
  'Como posso aumentar minha reserva de emergência?',
  'Qual dívida devo quitar primeiro?',
  'Como fica meu saldo nos próximos meses?',
  'Tenho gastos fora do padrão?',
  'Quais assinaturas eu pago?',
];

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function nextPayday(settings: Settings, today: string): string {
  const ym = today.slice(0, 7);
  const d = makeDate(ym, settings.salary.payDay);
  return d > today ? d : makeDate(addMonthsYM(ym, 1), settings.salary.payDay);
}

function extractAmount(q: string): number | null {
  const m = q.match(/(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)\s*(mil)?/i);
  if (!m) return null;
  const c = parseMoney(m[1]);
  if (c === null) return null;
  return m[2] ? c * 1000 : c;
}

/** Respostas locais: regras + cálculos sobre os dados do aparelho. Nada sai do dispositivo. */
export function answerLocally(question: string, o: Overview, data: AppData, settings: Settings): ChatAnswer {
  const q = norm(question);
  const plan = o.spend.plan;
  const safeInvest = Math.min(Math.max(plan.investCents - Math.max(o.cur.investedCents, 0), 0), Math.max(o.projectedEndBalanceCents, 0));

  const name = (id: string) => data.categories.find((c) => c.id === id)?.name ?? id;
  const ddmm = (d: string) => d.slice(8, 10) + '/' + d.slice(5, 7);

  if (/(compar|simul).*(emprestimo|financiamento)|\bcet\b|tabela price|\bsac\b/.test(q)) {
    return { text: 'Para comparar propostas de empréstimo, abra Planejamento → Dívidas → Comparar empréstimos. Informe valor, prazo e a taxa ou a parcela de cada banco, mais tarifas e IOF: eu calculo parcela, total pago, juros e o custo efetivo (CET) pela Tabela Price e pela SAC. Compare sempre pelo CET, não só pela taxa.' };
  }
  if (/(previs|proximos meses|vai sobrar|vou ter|fluxo de caixa|\bcaixa\b|futuro)/.test(q)) {
    if (data.accounts.length === 0) return { text: 'Cadastre suas contas com o saldo de hoje (Ajustes → Contas) para eu prever o saldo dos próximos meses.' };
    const f = cashForecast(data, o.today, 6);
    const end = f.months[f.months.length - 1];
    return {
      text: f.firstNegative ? `Atenção: pela previsão, o saldo fica negativo em ${monthName(f.firstNegative)} (${formatBRL(f.months.find((m) => m.ym === f.firstNegative)!.endBalanceCents)}). Corte gastos do dia a dia ou adie compras antes disso.` : `Pela previsão, você termina ${monthName(end.ym)} com ${formatBRL(end.endBalanceCents)} nas contas. O mês mais apertado é ${monthName(f.lowest!.ym)}, com ${formatBRL(f.lowest!.endBalanceCents)}.`,
      calc: [`Saldo de hoje: ${formatBRL(f.startCents)}`, `Gasto do dia a dia estimado: ${formatBRL(f.variableMonthlyCents)} por mês (média de ${f.variableBasisMonths} ${f.variableBasisMonths === 1 ? 'mês' : 'meses'})`, ...f.months.map((m) => `${monthShortYear(m.ym)}: +${formatBRL(m.incomeCents)} − ${formatBRL(m.fixedCents + m.debtCents + m.variableCents)} → ${formatBRL(m.endBalanceCents)}`)],
    };
  }
  if (/(fora do padrao|incomum|anormal|estranh|acima do normal|fora do normal)/.test(q)) {
    const u = unusualSpending(data, o.today);
    if (!u.categories.length && !u.transactions.length) return { text: 'Não encontrei nada fora do padrão neste mês. Comparo cada categoria com a mediana dos 6 meses anteriores (preciso de pelo menos 3) e cada lançamento com o valor típico da categoria.' };
    return { text: 'Encontrei estes gastos acima do seu normal:', calc: [...u.categories.map((c) => `${name(c.categoryId)}: ${formatBRL(c.curCents)} neste mês, normal ${formatBRL(c.typicalCents)} (+${formatPct(c.pct)})`), ...u.transactions.map((t) => `${t.tx.description} em ${ddmm(t.tx.date)}: ${formatBRL(t.tx.amountCents)}, ${t.times.toFixed(1).replace('.', ',')}× o típico`)] };
  }
  if (/(duplicad|em dobro|duas vezes|cobrad[oa] 2)/.test(q)) {
    const d = findDuplicates(data, o.today, settings.analysis?.ignoredDuplicates ?? []);
    if (!d.length) return { text: 'Não achei cobranças repetidas nos últimos 60 dias (mesmo valor, mesma descrição, até 3 dias de diferença).' };
    return { text: `Achei ${d.length} ${d.length === 1 ? 'possível cobrança em dobro' : 'possíveis cobranças em dobro'}. Confira no Raio-X; se uma estiver certa, marque "não é duplicada".`, calc: d.map((x) => `${x.a.description}: ${formatBRL(x.a.amountCents)} em ${ddmm(x.a.date)} e ${ddmm(x.b.date)}`) };
  }
  if (/(assinatura|mensalidade|streaming|recorrent)/.test(q)) {
    const s = detectSubscriptions(data, o.today);
    if (!s.length) return { text: 'Não encontrei assinaturas. Eu considero as assinaturas cadastradas e as cobranças que se repetem com valor parecido por pelo menos 3 meses seguidos.' };
    const m = s.reduce((t, x) => t + x.monthlyCents, 0);
    return { text: `Você paga ${s.length} ${s.length === 1 ? 'assinatura ou cobrança mensal' : 'assinaturas ou cobranças mensais'}: ${formatBRL(m)} por mês, ${formatBRL(m * 12)} por ano.`, calc: s.map((x) => `${x.name}: ${formatBRL(x.monthlyCents)}/mês${x.increasedFromCents ? ` (era ${formatBRL(x.increasedFromCents)})` : ''}${x.source === 'detectada' ? ' · detectada nos lançamentos' : ''}`) };
  }
  if (/(diversific|alocac|raio.?x|minha carteira|distribu)/.test(q)) {
    const x = portfolioXray(data, o.today);
    if (x.totalCents <= 0) return { text: 'Você ainda não tem investimentos cadastrados.' };
    return { text: `Seus investimentos somam ${formatBRL(x.totalCents)}. Os 3 maiores itens são ${formatPct(x.top3Pct)} do total; na prática é como ter ${x.effectiveItems.toFixed(1).replace('.', ',')} itens do mesmo tamanho. Diversificar ou não é decisão sua; eu só mostro a fotografia.`, calc: x.classes.map((c) => `${CLASS_LABEL[c.cls]}: ${formatBRL(c.cents)} (${formatPct(c.pct)})`) };
  }
  if (/(divida|emprestimo|juros|financiamento|quitar)/.test(q)) {
    const t = debtTotals(data.debts);
    if (data.debts.length === 0) return { text: 'Você ainda não cadastrou dívidas. Cadastre em Planejamento → Dívidas para eu comparar juros e simular a quitação.' };
    const top = t.priority[0];
    return {
      text: `Seu saldo devedor total é ${formatBRL(t.balanceCents)}, com ${formatBRL(t.monthlyCents)} em parcelas por mês. Pelo custo, a prioridade é "${top.name}" (${formatPct(top.monthlyRatePct)} ao mês, cerca de ${formatPct(annualFromMonthly(top.monthlyRatePct))} ao ano): cada real extra nela evita mais juros do que nas outras. Nunca assuma uma dívida nova sem conferir se a parcela cabe no orçamento.`,
      calc: t.priority.map((d) => `${d.name}: saldo ${formatBRL(d.balanceCents)} × ${formatPct(d.monthlyRatePct)} a.m. ≈ ${formatBRL(Math.round((d.balanceCents * d.monthlyRatePct) / 100))} de juros por mês`),
    };
  }
  if (/(comprar|compra de|posso ter|financiar)/.test(q)) {
    const price = extractAmount(question);
    if (price === null) return { text: 'Me diga o valor da compra (ex.: "Posso comprar uma moto de R$ 15.000?") para eu comparar com seu saldo, suas reservas e o que sobra por mês.' };
    const monthlySpare = plan.saveCents + plan.investCents + Math.max(o.spend.remainingCents, 0);
    const cash = Math.max(o.balanceCents, 0);
    const months = monthlySpare > 0 ? Math.ceil(Math.max(price - cash, 0) / monthlySpare) : Infinity;
    const afterCash = o.projectedEndBalanceCents - price;
    const verdict = afterCash >= 0 ? `À vista cabe: depois das contas do mês ainda sobrariam ${formatBRL(afterCash)}. Mesmo assim, confira se isso não zera sua reserva de emergência.` : months === Infinity ? 'Hoje não cabe: não há sobra mensal para juntar esse valor. Primeiro é preciso reduzir despesas.' : `À vista hoje compromete suas contas (faltariam ${formatBRL(-afterCash)}). Guardando o que sobra por mês, você junta o valor em cerca de ${months} ${months === 1 ? 'mês' : 'meses'}, sem dívida.`;
    return { text: verdict + (o.debtCents > 0 ? ` Você já tem ${formatBRL(o.debtCents)} em dívidas; parcelar com juros aumentaria esse peso.` : ''), calc: [`Valor da compra: ${formatBRL(price)}`, `Saldo em contas: ${formatBRL(o.balanceCents)}`, `Saldo previsto no fim do mês (após contas): ${formatBRL(o.projectedEndBalanceCents)}`, `Sobra mensal pelo plano (guardar + investir + livre restante): ${formatBRL(monthlySpare)}`] };
  }
  if (/(gastar|sobra|livre)/.test(q)) {
    const pay = nextPayday(settings, o.today);
    const days = Math.max(diffDays(pay, o.today), 1);
    if (plan.risk === 'sem_receita') return { text: 'Ainda não há receita cadastrada neste mês. Cadastre seu salário em Planejamento para eu calcular quanto você pode gastar.' };
    const rem = o.spend.remainingCents;
    return {
      text: rem > 0 ? `Você ainda pode gastar ${formatBRL(rem)} neste mês. Até o próximo salário (${formatDateBR(pay)}, em ${days} dias) isso dá cerca de ${formatBRL(Math.floor(rem / days))} por dia.` : `Seu dinheiro livre do mês já acabou: você passou ${formatBRL(-rem)} do planejado. Até ${formatDateBR(pay)} o ideal é gastar só com o essencial.`,
      calc: [`Receita do mês: ${formatBRL(plan.incomeCents)}`, `− Despesas fixas, assinaturas e parcelas: ${formatBRL(plan.fixedCents)}`, `− Guardar (${formatPct(plan.savePct)}): ${formatBRL(plan.saveCents)}`, `− Investir (${formatPct(plan.investPct)}): ${formatBRL(plan.investCents)}`, `= Livre no mês: ${formatBRL(plan.freeCents)}`, `− Gastos variáveis já feitos: ${formatBRL(o.spend.variableSpentCents)}`, `= Restante: ${formatBRL(rem)}`],
    };
  }
  if (/(economiz|poupei|guardei)/.test(q) && !/reserva|emergencia|aumentar/.test(q)) {
    const net = o.cur.netCents;
    return { text: net >= 0 ? `Em ${monthName(o.ym)} você economizou ${formatBRL(net)} até agora${o.cur.incomeCents > 0 ? ` (${formatPct((net / o.cur.incomeCents) * 100)} da receita)` : ''}. Desse valor, ${formatBRL(o.cur.savedCents)} foram para reservas e ${formatBRL(Math.max(o.cur.investedCents, 0))} para investimentos.` : `Em ${monthName(o.ym)} você gastou ${formatBRL(-net)} a mais do que recebeu.`, calc: [`Receitas: ${formatBRL(o.cur.incomeCents)}`, `− Despesas: ${formatBRL(o.cur.expenseCents)}`, `= Resultado: ${formatBRL(net)}`] };
  }
  if (/invest/.test(q)) {
    if (plan.risk === 'deficit') return { text: `Neste mês não é recomendável investir: as despesas fixas passam da receita em ${formatBRL(plan.deficitCents)}. Priorize equilibrar as contas.` };
    return { text: safeInvest > 0 ? `Você pode investir ${formatBRL(safeInvest)} sem prejudicar suas contas. Onde investir é decisão sua; eu não compro nem vendo nada.` : 'Pelo plano e pelas contas a pagar, não há folga para um novo aporte agora.', calc: [`Sugerido pelo plano para investir: ${formatBRL(plan.investCents)}`, `− Já aportado no mês: ${formatBRL(Math.max(o.cur.investedCents, 0))}`, `Saldo previsto no fim do mês após as contas: ${formatBRL(o.projectedEndBalanceCents)}`, `= Menor valor entre os dois: ${formatBRL(safeInvest)}`] };
  }
  if (/(reduzir|cortar|desnecess|diminuir)/.test(q)) {
    const prev = monthSummary(data, o.prevYm);
    const cats = Object.entries(o.cur.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 4);
    if (cats.length === 0) return { text: 'Ainda não há despesas neste mês para analisar.' };
    const lines = cats.map(([id, v]) => {
      const p = prev.byCategory[id] ?? 0;
      const ch = p > 0 ? ` (${v >= p ? '+' : ''}${formatPct(((v - p) / p) * 100)} vs. mês passado)` : '';
      return `${name(id)}: ${formatBRL(v)}${ch}`;
    });
    const subs = o.cur.byKind['assinatura'] ?? 0;
    return { text: `Seus maiores gastos do mês estão abaixo. Comece pelos que mais subiram e pelos que não são essenciais.${subs > 0 ? ` Assinaturas somam ${formatBRL(subs)} por mês: veja se usa todas.` : ''}`, calc: lines };
  }
  if (/(reserva|emergencia)/.test(q)) {
    const g = data.goals.find((x) => /emerg/i.test(x.name));
    if (!g) return { text: `Você ainda não tem uma meta de reserva de emergência. Crie em Planejamento → Reservas. Pelo seu plano dá para guardar ${formatBRL(plan.saveCents)} por mês.` };
    const p = goalProgress(g, data.goalMoves, o.today);
    return { text: `Sua reserva tem ${formatBRL(p.accumulatedCents)} de ${formatBRL(g.targetCents)} (${formatPct(p.pct)}). Guardando ${formatBRL(plan.saveCents)} por mês, como sugere seu plano, faltam cerca de ${plan.saveCents > 0 ? Math.ceil(p.remainingCents / plan.saveCents) : '—'} meses. Para acelerar: aumente o percentual de "guardar" no plano salarial ou direcione o que sobrar do dinheiro livre.`, calc: [`Falta: ${formatBRL(p.remainingCents)}`, `Aporte mensal pelo plano: ${formatBRL(plan.saveCents)}`] };
  }
  if (/(dividendo|provento|rendimento)/.test(q)) {
    const f = o.nextForecast;
    return { text: f.totalCents > 0 ? `Previsão para o próximo mês: ${formatBRL(f.totalCents)} (${formatBRL(f.officialCents)} anunciados + ${formatBRL(f.estimatedCents)} estimados pelo histórico, sem garantia).` : 'Não há proventos anunciados nem histórico suficiente para estimar o próximo mês.', calc: f.items.map((i) => `${i.ticker}: ${formatBRL(i.cents)} ${i.official ? '(anunciado)' : '(estimativa)'}`) };
  }
  if (/(patrimonio|quanto tenho|saldo)/.test(q)) {
    return { text: `Seu patrimônio é ${formatBRL(o.netWorth.totalCents)}${o.debtCents > 0 ? `; descontando ${formatBRL(o.debtCents)} de dívidas, o líquido é ${formatBRL(o.netWorth.totalCents - o.debtCents)}` : ''}.`, calc: [`Contas: ${formatBRL(o.netWorth.accountsCents)}`, `Reservas: ${formatBRL(o.netWorth.goalsCents)}`, `Renda fixa: ${formatBRL(o.netWorth.fixedIncomeCents)}`, `Bolsa: ${formatBRL(o.netWorth.equityMarketCents)}`, ...(o.netWorth.cryptoCents ? [`Cripto: ${formatBRL(o.netWorth.cryptoCents)}`] : [])] };
  }
  const top = generateInsights(o, data, settings).slice(0, 3);
  return { text: 'No modo local eu respondo sobre: quanto você pode gastar, quanto economizou, quanto pode investir, despesas para reduzir, previsão do saldo nos próximos meses, gastos fora do padrão, assinaturas, cobranças em dobro, sua carteira, comparar empréstimos, reserva de emergência, dívidas, dividendos, patrimônio e se uma compra cabe no orçamento.' + (top.length ? ' O que mais chama atenção agora:' : ''), calc: top.map((i) => i.title) };
}

/** Resumo (só agregados, sem descrições de lançamentos) enviado ao serviço de IA quando o usuário autoriza. */
export function buildAiContext(o: Overview, data: AppData, settings: Settings): string {
  const name = (id: string) => data.categories.find((c) => c.id === id)?.name ?? id;
  const r = (c: number) => Math.round(c) / 100;
  return JSON.stringify({
    hoje: o.today,
    saldoContas: r(o.balanceCents),
    mesAtual: { receitas: r(o.cur.incomeCents), despesas: r(o.cur.expenseCents), porCategoria: Object.fromEntries(Object.entries(o.cur.byCategory).map(([k, v]) => [name(k), r(v)])), investido: r(o.cur.investedCents), guardado: r(o.cur.savedCents) },
    mesAnterior: { receitas: r(o.prev.incomeCents), despesas: r(o.prev.expenseCents) },
    planoSalarial: { receita: r(o.spend.plan.incomeCents), fixas: r(o.spend.plan.fixedCents), guardar: r(o.spend.plan.saveCents), investir: r(o.spend.plan.investCents), livre: r(o.spend.plan.freeCents), livreRestante: r(o.spend.remainingCents), diaPagamento: settings.salary.payDay },
    saldoPrevistoFimDoMes: r(o.projectedEndBalanceCents),
    patrimonio: r(o.netWorth.totalCents),
    carteira: o.positions.filter((p) => p.quantity > 0).map((p) => ({ ativo: p.asset.ticker, tipo: p.asset.type, quantidade: p.quantity, custo: r(p.costCents), valor: r(p.valueCents) })),
    rendaFixa: data.fixedIncomes.map((f) => ({ nome: f.name, aplicado: r(f.investedCents), atual: r(f.currentCents) })),
    dividas: data.debts.map((d) => ({ nome: d.name, saldo: r(d.balanceCents), parcela: r(d.installmentCents), parcelasRestantes: d.remainingInstallments, jurosMesPct: d.monthlyRatePct })),
    metas: data.goals.map((g) => ({ nome: g.name, meta: r(g.targetCents), acumulado: r(data.goalMoves.filter((m) => m.goalId === g.id).reduce((s, m) => s + m.amountCents, 0)) })),
    proventosProximoMes: { anunciado: r(o.nextForecast.officialCents), estimado: r(o.nextForecast.estimatedCents) },
    contasAtrasadas: o.overdue.length,
  });
}

export const AI_SYSTEM_PROMPT = 'Você é a Grefinacia AI, assistente de organização financeira pessoal em português do Brasil. Responda usando SOMENTE os dados do JSON fornecido; mostre os cálculos; se faltar dado, diga qual. Não prometa rentabilidade, não recomende dívida nova sem avaliar o orçamento, não execute operações. Você não substitui contador nem consultor de investimentos habilitado. Seja direta e breve.';
