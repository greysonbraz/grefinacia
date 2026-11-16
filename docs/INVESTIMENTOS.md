# Módulo de investimentos

Bolsa (ações, FIIs, ETFs), renda fixa, cripto e proventos. Todos os cálculos rodam no aparelho; dinheiro em centavos.

## Carteira

- **Preço médio** com custos de corretagem; venda baixa o custo pelo preço médio e gera resultado realizado (`src/domain/portfolio.ts`).
- **Desempenho** por cotas (compras e vendas não contam como ganho), comparado a CDI e IPCA do Banco Central (`src/domain/market.ts`).
- **Rentabilidade total** (Etapa 11, `src/domain/passiveIncome.ts → totalReturn`):
  `valorização da posição atual + resultado em vendas + proventos RECEBIDOS`, sobre o total investido (compras + custos).
  Mostra à parte: **patrimônio atual**, **proventos recebidos** e **proventos futuros** (que não entram no resultado).
  O IR do JCP já sai do valor líquido; IR sobre lucro de vendas não é calculado.

## Proventos (Etapa 11)

### Ciclo de cada provento

| Status | Quando |
|---|---|
| Anunciado | A fonte trouxe o evento, sem data-com nem pagamento |
| Aguardando data-com | Hoje é a data-com ou antes dela (ainda dá para comprar e ter direito) |
| Direito adquirido | A data-com passou e você tinha o ativo; data de pagamento ainda não divulgada |
| Pagamento previsto | Data de pagamento no futuro |
| Aguardando confirmação | A data de pagamento passou, mas **ninguém confirmou** que o dinheiro caiu |
| Pago | Confirmado pelo extrato importado ou pelo botão "Recebi" |
| Cancelado | Pela fonte ou por você. Fica no histórico, fora dos totais |

Além do status, o selo **alterado** aparece quando a fonte corrigiu valor ou data, ou deixou de trazer o evento.

### Regras de integridade

- **Quantidade elegível** = o que você tinha no fim da data-com, contando compras e vendas até esse dia.
  Antes da data-com, vale a quantidade de hoje.
- **Valor bruto** = quantidade × valor por ação ou cota. **Líquido**: JCP com 15% de IR retido; dividendos e rendimentos de FII
  sem desconto para pessoa física.
- **Só "Pago" é dinheiro recebido.** Painéis, gráfico de renda passiva, fechamento do mês, liberdade financeira e
  rentabilidade total usam a data da confirmação, nunca a data prevista.
- **Sem duplicidade:** cada evento tem uma chave (ativo, tipo, data-com, valor). Valor corrigido para a mesma data-com é
  tratado como correção do evento existente, não como evento novo.
- **Nada é apagado:** "excluir" virou "cancelar"; correções da fonte ficam no histórico do evento (data, origem, o que mudou).
  Provento já confirmado não muda de valor: a fonte só deixa uma anotação.
- **Sumiu da fonte:** marcado para conferência ("não aparece mais em …"), sem cancelar sozinho.
- **O que você cadastrou** prevalece sobre a fonte.

### Confirmação pelo extrato

Depois de cada mudança (inclusive ao importar extrato), o app procura nas receitas o crédito de cada provento a receber:

- código do ativo na descrição (ex.: "DIVIDENDOS ITSA4") e valor igual ao líquido ou ao bruto (tolerância de 1% ou 2 centavos); ou
- palavra de provento ("dividendo", "JCP", "juros s/ capital", "rendimento", "provento") + prefixo do código (ex.: "JCP ITSA"),
  com tolerância de 0,5%;
- data entre 3 dias antes e 10 dias depois do pagamento (sem data de pagamento: até 120 dias depois da data-com).

Achou: marca "Pago (confirmado pelo extrato)", liga ao lançamento existente e não cria outro. O botão "Recebi" também liga
a um crédito existente antes de criar receita nova. Se o crédito ligado for apagado (ex.: importação desfeita), a
confirmação é desfeita, com anotação.

### Avisos

Novo provento anunciado · data-com chegando · pagamento chegando · dia do pagamento · pagamento confirmado pelo extrato ·
provento alterado · provento sumiu da fonte. Cada um pode ser desligado em Ajustes → Notificações.

## Fontes de dados (avaliadas em 16/11/2026)

| Fonte | Oficial? | Traz | Situação no app |
|---|---|---|---|
| Yahoo Finance | Não | Data-ex e valor, ações e FIIs. Sem data de pagamento, sem separar JCP | Em uso (escolha em Ajustes) |
| brapi.dev | Não | Datas completas e tipo | Só nos planos pagos; no grátis não consulta |
| B3: lista de proventos de ações (site público) | Dado oficial; endereço interno do site, sem contrato | Tipo (JCP/dividendo), valor, aprovação, data-com. Sem pagamento, sem FIIs | **Não usado.** Respondeu de forma intermitente (proteção anti-robô). Decisão do dono pendente (Etapa 11b) |
| B3: ficha da empresa/fundo | Idem | Datas completas | **Bloqueado** para acesso automático; o app não contorna |
| Fundos.NET (informes de rendimento de FII) | Oficial | Data-base, pagamento, valor | **Bloqueado** para acesso automático |
| CVM: informe mensal de FII (dados abertos, ODbL) | Oficial | Total distribuído no mês e dividend yield, sem datas; ~1 mês de atraso | Não usado ainda; serve para conferência mensal |
| Alpha Vantage | Não | Datas completas para EUA | **Descartada**: sem proventos da B3 (PETR4 e ITSA4 vieram vazios no teste do dono) |

**Nenhuma fonte gratuita confirma que o dinheiro caiu na sua conta.** Só a Área do Investidor da B3 sabe, e ela não tem API
gratuita para pessoa física. Por isso "Pago" vem do seu extrato importado ou do seu "Recebi".

**Fonte fora do ar:** o app mantém os proventos que já tinha, mostra a mensagem de erro da fonte e tenta de novo depois.
A busca automática com o app fechado roda a cada ~6 h (o Android decide o horário); no plano grátis da brapi ela não consulta nada.

## Onde está cada coisa

| Arquivo | O quê |
|---|---|
| `src/domain/dividends.ts` | Status, quantidade elegível, previsão, junção com histórico de correções, cancelar/reativar |
| `src/domain/passiveIncome.ts` | Painel de renda passiva, confirmação pelo extrato, rentabilidade total |
| `src/services/quotes.ts` | Busca de cotações e proventos (brapi, Yahoo) |
| `src/state/store.ts` | `refreshDividends`, `reconcileDividends`, `confirmDividend`, `cancelDividend`, `reactivateDividend` |
| `src/ui/Proventos.tsx` | Painel, histórico e rentabilidade total |
| `public/runners/runner.js` | Verificação com o app fechado |
| `tests/etapa11.test.ts` | Testes das regras acima |
