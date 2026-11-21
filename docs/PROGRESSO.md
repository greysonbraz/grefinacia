# Grefinacia — progresso

Checkpoint de **17/11/2026**. `main` em `87e85f2` (versão 1.8.0, todas as etapas 1 a 11b). Etapa 12 (conexão bancária pelo Meu Pluggy) no branch `claude/etapa-12-pluggy` (versão 1.10.0, 258 testes; inclui 12b).

## Concluído e no `main`

| Etapa | Entrega | PR |
|---|---|---|
| 1–3 | Auditoria, tecnologias e planejamento (`docs/PLANEJAMENTO.md`) | — |
| 4 | Assinatura fixa do APK, cofre de segredos, CSP, cópias de segurança automáticas, validação de backup, IA paga desligada, cota da brapi protegida | 2 |
| 5a | Login com Google e cópia cifrada na nuvem (Supabase) | 1 |
| 5b | Sincronização automática registro a registro | 4 |
| 6 | Categorias próprias, transferência entre contas, limite do cartão, leitura da linha digitável de boletos, exportação JSON | 5 |
| 9 (parte) | Notícias do mercado financeiro por RSS, 12 fontes em 5 assuntos | 3 |
| 7 | Selo e contador de cota nas cotações, histórico de preços, desempenho x CDI/IPCA, carteira de cripto | 6 |
| 8a | Motor local ampliado: previsão de caixa, gastos fora do padrão, assinaturas, cobranças em dobro, raio-X da carteira, comparador de empréstimos | 7 |
| 9 | Importar extrato de conta e fatura de cartão (OFX e CSV), com prévia, duplicados, categoria automática, regras aprendidas e desfazer | 8 |
| 8b | Gemini Nano no aparelho para perguntas livres (experimental, desligado por padrão) | 9 |
| 10 | Testes completos, revisão final de segurança, roteiro de teste no celular, documentação das tecnologias | 10 |
| 11a | Proventos: status completos, só confirmado conta como recebido, confirmação pelo extrato, histórico de correções, painel de renda passiva, rentabilidade total, alertas novos | 11 |
| 11b | Fonte automática de proventos (brapi no pago, Yahoo no grátis), busca sozinha 1×/dia, aviso de fonte fora do ar; B3 decidida contra | 12 |

## Pronto no branch, aguardando teste no aparelho

| Etapa | Entrega | Branch |
|---|---|---|
| P1 | Purple Edition, etapas 3 e 4 do redesign: sistema visual roxo (tokens, contraste conferido, temas escuro e claro), voltar do Android, vibração, ocultar valores, Início reorganizado | `claude/purple-design` |
| 19 | Investimentos → Exterior (US$) com bonds e fundos; dias do cartão pela fatura do banco; regras do extrato do Inter (Global Account, Porquinho, Débito B3, Pix no crédito) | `claude/etapa-19-ajustes` |
| 18 | Faturas do cartão como no banco: fatura de cada compra pelo Open Finance (billId), tela Faturas (paga/aberta/futura, total do banco para conferir); câmbio para dólar fora dos gastos e somado na aba Dólar | `claude/etapa-18-faturas` |
| 17 | Compra no cartão conta no mês da fatura (padrão; chave em Ajustes → Cartões); previsão sem contar o cartão em dobro; "Renda fixa em dólar" na aba Dólar | `claude/etapa-17-cartao-fatura` |
| 16 | Notícias dos EUA e Wall Street: assunto novo com 5 fontes (3 em português, 2 em inglês) e atalho na aba Dólar | `claude/etapa-16-noticias-eua` |
| 15 | Aba Dólar na tela inicial (R$ / US$): conta em dólar, ações e ETFs dos EUA, investimentos em dólar do banco, PTAX com gráfico e conversor | `claude/etapa-15-dolar` |
| 14 | Investimentos dos bancos pela conexão (renda fixa, ações, fundos, previdência) em Investimentos → Nos bancos e no patrimônio | `claude/etapa-14-investimentos` |
| 13 | Tela inicial nova: gasto do mês dia a dia × mês passado, maiores categorias, previsão do mês inteiro e do mês que vem | `claude/etapa-13-inicio` |
| 12 | Conexão bancária pelo Meu Pluggy: saldos, extratos e cartões entrando sozinhos pelo importador, sem duplicar | `claude/etapa-12-pluggy` |

Detalhes da Etapa 12:
- **Por que Meu Pluggy:** a Belvo é paga e não atende uso pessoal. O Meu Pluggy é gratuito para uso pessoal, sem prazo, até 5 bancos do mesmo titular, atualização a cada 24 h (conferido em pluggy.ai e docs.pluggy.ai em 17/11/2026).
- **Onde:** Ajustes → Bancos e pagamentos → Conexão bancária (Meu Pluggy) → Abrir.
- **Passos do dono:** conectar os bancos em meu.pluggy.ai; no Dashboard, criar uma aplicação, em Demo → Conectar conta escolher "MeuPluggy" (um banco por vez) e copiar o Item ID de cada um; Client ID e Client Secret ficam na aplicação.
- **No app:** chaves no cofre do Android (não vão para nuvem, backup nem GitHub); um Item ID por banco; "Buscar contas" e escolher o destino de cada conta (criar conta/cartão ou ligar a um existente); "Sincronizar agora". Depois sincroniza sozinho ao abrir, no máximo a cada 12 h.
- **Sem duplicar:** identificador estável do banco (`providerId`, Open Finance) e, sem ele, a conferência por data, valor e descrição da importação. Pagamento da fatura dentro do cartão e lançamentos agendados ficam de fora. Cada sincronização é uma importação com "Desfazer".
- **Saldo:** conta criada pela conexão começa com o saldo do banco no dia seguinte à última atualização da Pluggy; a tela mostra saldo do banco × do app.
- **Autorização:** a do Meu Pluggy para a aplicação vale 1 ano; o app avisa 30 dias antes.
- **Proventos:** créditos de dividendos/JCP/rendimentos que chegam pela conexão confirmam os proventos sozinhos (Etapa 11a).

Detalhes do redesign Purple Edition (pedido do dono, 18/11/2026; plano em 10 etapas aprovado):
- Etapa 1 (auditoria, com as skills Impeccable, frontend-design e design-skills): nota técnica 14/20; P1: sem botão voltar do Android; branco sobre #8B5CF6 reprova contraste (4,05:1).
- Etapa 3: `src/styles.css` com tokens Purple (ver `DESIGN.md`), estados, foco, seleção; `@capacitor/haptics` (vibração leve); `src/ui/back.ts` (voltar do Android); `CountMoney`, `Skeleton`, `ChartBox minimal`; olho (`settings.hideValues`, sem mudar o banco).
- Etapa 4: Início em `src/ui/home/*`: patrimônio com evolução 6/12 meses → seu mês → gastos → próximos 15 dias (faturas agrupadas, proventos) → previsão → investimentos → saúde financeira → atalhos → análises → AI. Cálculos novos só de leitura em `src/domain/home.ts`.
- Etapa 5 (Movimentações): resumo receitas/despesas/resultado; busca + filtros (categoria, conta, cartão, origem) com contador e chips; aba Transferências; transferências (entre contas, investimento, câmbio) na lista com detalhe e "Desfazer"; total do dia; faturas em grupo com atalho "Faturas do cartão"; cadastro com valor em destaque e categoria sugerida pela descrição (`suggestCategory`, a mesma da importação); "Veio de" nos importados.
- Etapa 6 (Investimentos): aba "Visão geral" (padrão): total, distribuição por classe (ações, FIIs, ETFs, renda fixa, bancos, exterior, cripto), rentabilidade, proventos recebidos e previstos, maiores posições, evolução. Cálculo em `src/domain/investOverview.ts` (só leitura).
- Skill UI UX Pro Max instalada no claude-brain (checklist de app: toque 48dp, retorno ≤150 ms, cor nunca é o único sinal).
- Cripto ao vivo: canal público de dados da Binance (`wss://data-stream.binance.vision`, sem chave), só com a aba Cripto aberta; par em reais ou via USDT/BRL; fecha em segundo plano; sem conexão vale a CoinGecko (`src/services/liveCrypto.ts`). Não deu para testar o canal daqui (a rede da nuvem não abre WebSocket): conferir no celular.
- Etapa 7 (Grefinacia AI): orbe roxo que pulsa ao analisar, "Resumo de hoje" com números reais, alertas em cartões, perguntas em botões, indicador de digitação, "Ver a conta". Motor intocado.
- Etapas 8 e 9: controles nativos no roxo, transição curta ao trocar de aba (sem `fill-mode` para não prender janelas fixas), esqueleto nas notícias.
- Ideias de apps profissionais e fontes grátis: faixa "Mercado hoje" no Início (Ibovespa pelo Yahoo, dólar PTAX, Selic meta SGS 432, CDI SGS 4389, IPCA 12 meses SGS 13522; 1 busca/dia, só no Android) e **calendário financeiro** em Movimentações (entradas, contas, uma fatura por vencimento, proventos).
- APK: o dono pediu para gerar só depois de um salto grande. Versão 1.20.0 no código, sem APK desde 1.19.0.
- Ideias aprovadas pelo dono (1.21.0):
  - **Escanear cupom/nota:** "Nova movimentação → Escanear cupom ou nota" (Android). Foto pela câmera ou galeria (`@capacitor/camera`), texto lido no aparelho pelo ML Kit Text Recognition (modelo embutido, sem internet), interpretado em `src/domain/receipt.ts` (loja, total, data, CNPJ) e categoria sugerida. Só preenche: você confere e salva. Permissão de câmera no manifesto.
  - **Lembretes da fatura:** "Fatura X vence em N dias" (com valor) e "Fatura X fecha amanhã" (total até agora e a partir de quando as compras vão para a próxima). Chave em Ajustes → Notificações.
  - **Widget Android** (`GrefinaciaWidget`): livre para gastar, saldo disponível, próxima conta; o app envia os valores (`GrefinaciaPlugin.setWidget`); respeita "ocultar valores"; tocar abre o app.
  - Plugin nativo novo `GrefinaciaPlugin` (registrado em `MainActivity`); dependência `com.google.mlkit:text-recognition:16.0.1`.
- Teste instável observado: `tests/vault.test.ts` falhou uma vez na bateria completa e passou isolado e na repetição (tempo de criptografia).
- Etapa 10 (revisão final, 1.22.0): navegação automática agora confere as 5 abas em 360px com "reduzir movimento" (nada vaza para os lados); botões de ícone com 48dp (Android); rótulos da barra de baixo ajustados em telas estreitas. 301 testes; build Android do GitHub OK.
- APK do salto (1.22.0) enviado ao dono: tudo desde o 1.19.0.
- **App único (1.23.0)**, ideias do mockup do dono, só o que é gratuito (planos pagos e multiusuário ficam para conversar depois; logos de bancos não, são marcas registradas):
  - Início: nota de saúde financeira de 0 a 100 (anel; 40 pontos sobra da renda, 35 reserva, 25 parcelas), tocar no gráfico do patrimônio mostra o valor do mês, atalhos + Despesa / + Receita / Transferir, saldo previsto em 1, 2 e 3 meses (previsão de caixa).
  - AI no centro da barra de baixo (botão roxo elevado), orbe com halo girando (parado com "reduzir movimento"), microfone: reconhecimento de voz do próprio Android em pt-BR (`GrefinaciaPlugin.listen`, sem permissão de microfone no app; `<queries>` no manifesto).
  - Movimentações: detalhe em tela própria (valor grande, todos os dados, total da categoria no mês, outras vezes com a mesma descrição, Paguei/Editar/Excluir), filtro por período (7, 30, 90 dias ou datas escolhidas), gráficos por trimestre.
  - Planejamento: "Meu futuro" (1, 5 e 10 anos e aporte para R$ 1 milhão em 10/20/30 anos, em Liberdade), metas que dizem quanto guardar por mês até o prazo ("Usar esse valor"), aba **Desafios** (sem gastar, limite, guardar; progresso pelos lançamentos reais; guardados em `settings.challenges`), notificação "Relatório do mês" no dia 1 (números só do mês já fechado).
  - Marca nova: "G" branco no quadrado roxo com ponto lilás; ícone adaptativo com camada monocromática (ícones temáticos do Android 13+), abertura no fundo do app (#0b0914), logotipo nas telas de boas-vindas e bloqueio. Arte em `docs/marca/icone-512.png`.
- **1.28.0** (4 ideias aprovadas pelo dono):
  - **App mais leve:** leitor de texto pelo Google Play Services (`play-services-mlkit-text-recognition`, modelo baixado uma vez, grátis) e só processadores ARM (`abiFilters`). Artefato do build caiu de 32 MB para 12 MB (APK de ~61 MB para ~20 MB).
  - **AI lê print da carteira:** `parseHoldings` (B3: código, quantidade, preço médio, valor; EUA: código com US$). B3 entra como compra de hoje pelo preço médio (se não vier pelo banco nem estiver cadastrado); EUA entra/atualiza em Exterior (US$). Sempre com confirmação.
  - **Extrato e fatura em PDF:** pdf.js 6.4.299 (Apache-2.0) lê o texto no aparelho (worker do próprio app, permitido pela CSP); `parsePdfStatement` reconhece cabeçalhos de dia, datas no começo da linha, saldos/totais ignorados, fatura (compras viram saída) e "Parcela 2 de 10" → "(2/10)". Testado no navegador com um PDF de verdade.
  - **QR da nota fiscal (NFC-e):** leitor do Google (`play-services-code-scanner`, sem permissão de câmera no app); `parseNfceQr` (chave, CNPJ, mês, contingência com dia e valor) e `parseNfceHtml` (leiaute padrão do Portal da NFC-e: loja, CNPJ, data, total, itens). Só a Sefaz-PR é consultada pelo app (host na CSP); captcha ou outro leiaute → não insiste e oferece abrir no navegador. Não testado contra a página real (a nuvem não alcança o site): conferir no aparelho. Botões em Nova movimentação e no clipe da AI.
- **1.27.2**: campo de valor estilo caixa eletrônico (`maskMoneyInput`: 66648 → 666,48, sem vírgula; colar/preencher de uma vez vale como escrito); respostas do Gemini Nano com valores em R$ (`formatNanoMoney` + instrução); na categoria por dentro, a parcela aparece como selo (1/62) ao lado da data e o nome sem "(n/m)". Observação do dono: lançamento manual "Total do cartão inter" (R$ 1.894,43) duplica as compras vindas do banco; orientado a excluir.
- **1.27.1** (decisão do dono: "um cartão só por banco"): `src/domain/cardmerge.ts` + `mergeBankCards` juntam cartões do mesmo banco no cartão ligado à conexão (o com mais lançamentos): compras, recorrências, importações e vínculos passam para ele; o cartão repetido sai (cópia de segurança antes). Novo cartão de crédito do mesmo banco na conexão entra no cartão que já existe.
- **1.27.0**: causa real das parcelas em novembro: o cartão vinculado na conexão (`settings.bank.links`) não existia mais no app, e `buildTransactions` importava as compras da fatura sem cartão e sem conta (pagas na data da compra). Agora `ensureLinkedCards` recria o cartão vinculado com o mesmo código (dados do banco) ao abrir o app e a cada sincronização, e o reparo devolve ao cartão as compras órfãs (lançamento importado sem cartão nem conta cuja importação tem cartão), cada uma na fatura certa, e separa as parcelas. Aba Recorrentes mostra também as assinaturas do mês e os parcelamentos em andamento (pagas, faltam, valor por mês, até quando).
- **1.26.1**: no aparelho do dono as parcelas do TikTok ("(n/m)" certo) continuavam em novembro: os lançamentos apontavam para um cartão que não existe mais (recriado) e o vencimento era igual à data da compra. O reparo agora acha o cartão pela importação que trouxe o lançamento (ou o único cartão), corrige o `cardId` e recalcula os vencimentos quando todas as parcelas têm o mesmo. Detalhe mostra "cartão não encontrado" quando for o caso.
- **1.26.0**: parcelas do cartão vindas do banco. O Inter (pela Pluggy) manda cada parcela como lançamento separado, todas com a data da compra e "(n/m)"; sem fatura do banco, todas caíam na mesma fatura (ex.: 10 × R$ 120 no mesmo mês). `src/domain/installments.ts` põe a parcela n na fatura n−1 meses depois da primeira (só quando há várias parcelas da mesma compra com a mesma data; vencimento vindo da fatura do banco é mantido; lançados à mão não mudam), marca o grupo de parcelas e roda ao abrir o app e depois de cada sincronização, com cópia de segurança antes. Na lista, a compra aparece uma vez com "10x" no mês da compra e as parcelas seguintes ("2/10"…) no mês da fatura de cada uma.
- **1.25.0** (pedido do dono com prints de outro app):
  - Assinaturas com marca de desenho próprio (`BrandMark`: quadrado arredondado na cor do serviço, letra branca e o ponto lilás da marca Grefinacia; sem logos de terceiros). Bloco "Assinaturas do mês" no Início (`monthSubscriptions`), nas movimentações e no Raio-X.
  - Gráficos de Movimentações: tocar numa categoria (lista ou gráfico) abre os lançamentos dela no período; marcar um ou vários e mover para outra categoria, com "Lembrar para os próximos" (mesmas regras das importações). Visão "Grupos" (Moradia e contas, Alimentação, Lazer e assinaturas…) com as categorias de cada grupo. `src/domain/catview.ts`.
  - Investimentos do banco também nas abas certas (`bankTab`): ações/FII/ETF em Bolsa e CDB/LCI/Tesouro em Renda fixa, numa parte "Pelo banco"; renda fixa em dólar (Porquinho) em Renda fixa → "Em dólar". Só exibição: o patrimônio não muda. "Rendeu nos bancos" não quebra mais a linha.
- **AI lê fotos (1.24.0)**, pedido do dono com prints do Inter:
  - Clipe no chat da AI: "Foto ou print" (câmera ou galeria; texto lido no aparelho pelo ML Kit) ou "Arquivo de extrato" (abre o importador). `src/domain/docread.ts` reconhece Time Deposit / Meu Porquinho do Inter (lista e detalhe "Notas", inclusive em duas colunas), boleto (linha digitável) e cupom fiscal. A AI mostra o que leu e só salva com o toque (Adicionar/Atualizar; acha o item já cadastrado pelo nome).
  - Renda fixa em dólar ganhou valor aplicado, taxa ao ano, aplicação e vencimento; na aba Exterior: barra do prazo, dias que faltam, quanto rendeu e estimativa no vencimento (juros compostos pela taxa informada).
  - Cripto: painel "Mercado agora" com as 8 principais moedas, mesmo sem nenhuma cadastrada (antes ficava vazio e dizia "indisponível" porque o canal ao vivo só abria para moedas que você tinha). Ao vivo pela Binance; sem ele, CoinGecko buscada ao abrir a aba. Suas cotações se atualizam sozinhas ao abrir a aba se tiverem mais de 10 minutos. Tocar numa moeda abre o cadastro.

Detalhes da Etapa 19 (dono: dólar não aparecia em Investimentos; dezembro ainda R$ 756,72; extrato de 90 dias conferido sem ir para o repositório):
- Investimentos ganhou a aba "Exterior (US$)" (o mesmo painel da aba Dólar); tipos novos: Bonds e Fundos no exterior (pelo saldo).
- Fechamento e vencimento do cartão passam a vir da fatura mais recente do banco (`billClosingDate`); compras pendentes sem fatura do banco têm o vencimento refeito. Hipótese para dezembro: fechamento errado no cadastro do cartão (`balanceCloseDate`) jogando compras do fim do mês para janeiro.
- Extrato do Inter: "Depósito/IOF Global Account" = câmbio; "Cdb Porq…", "Crédito Resgate Fundo … Firf", "Débito B3 Nota Bov" = investimento; pontos e cashback = receita; "Crédito liberado Pix No Crédito" + Pix do mesmo valor/dia saem da conta quando o cartão está sincronizado (o gasto vem na fatura).

Detalhes da Etapa 18 (dono comparou com o app do Inter: dezembro R$ 756,72 no app × R$ 1.894,43 no banco):
- Causa: o app montava as faturas pelo dia de fechamento; parcelas futuras caíam um mês depois.
- `GET /bills?accountId=` e `creditCardMetadata.billId` de cada compra: o vencimento vem do banco; sem fatura informada (aberta/futura), segue o dia de fechamento. Compra que o banco muda de fatura é acertada na sincronização (nada apagado).
- Movimentações → "Faturas do cartão": barras por mês, fatura escolhida com situação, vencimento, "Total no banco" e as despesas.
- Câmbio (categoria "Transfer - Foreign exchange" ou "câmbio/compra de dólar/conta global" na descrição) vira transferência; a aba Dólar oferece somar na conta em dólar com valor estimado pela PTAX (editável). Inter Global continua fora do Open Finance: o saldo exato vem do comprovante.
- Depois de instalar: Conexão bancária → "Refazer a importação" para reprocessar o histórico com as faturas do banco.

Detalhes da Etapa 17 (pedido do dono depois de testar o 1.14.0):
- `costDate`/`costMonth` em `src/domain/ledger.ts`: compra no cartão pesa no mês do vencimento da fatura (quando o dinheiro sai). Vale para resumo do mês, tela inicial, Movimentações, Planejamento, salário e previsão. Ajustes → Cartões tem a chave para voltar ao "mês da compra".
- A lista de Movimentações continua pela data da compra, com a marca "fatura dez"; o topo explica o que entrou de fatura e o que foi para a próxima.
- Previsão do mês que vem: fatura já lançada entra em "contas" e a média do dia a dia só completa o que falta (antes o cartão podia contar duas vezes).
- Inter Global (Conta Global, Inter Dólar+, Meu Porquinho USD) fica numa instituição fora do Brasil: não vem pelo Open Finance. Tipo novo "Renda fixa em dólar" na aba Dólar para cadastrar à mão.

Detalhes da Etapa 16:
- Assunto "EUA e Wall Street" em Notícias: InfoMoney Wall Street, Money Times Internacional, Investing.com Brasil (ações), CNBC Markets e MarketWatch (estes dois em inglês). Feeds conferidos e lidos pelo leitor do app em 17/11/2026.
- Hosts novos na CSP: br.investing.com, search.cnbc.com, feeds.content.dowjones.io (só leitura do feed; a matéria abre no site).
- Atalho "Notícias dos EUA e Wall Street" na aba Dólar.

Detalhes da Etapa 15:
- Botão "R$ Reais / US$ Dólar" no topo da tela inicial; o painel em dólar tem total em US$ e em R$, divisão por tipo, cotação do dia com gráfico (30/90 dias, 12 meses), variação e conversor.
- Cotação: PTAX de venda do Banco Central (SGS série 1, dados abertos, sem chave; mesmo host do CDI/IPCA), 1 busca por dia. Ações/ETFs/REITs dos EUA: Yahoo Finance (não oficial), em dólar.
- Coleção nova `usdHoldings` (banco local v7, backup formato 6). A Conta Global do Inter normalmente não vem pelo Open Finance: saldo informado à mão. Investimentos em dólar vindos do banco (Etapa 14) aparecem aqui.
- O total em reais entra no patrimônio como "Dólar".

Detalhes da Etapa 14:
- `GET /investments?itemId=` da Pluggy a cada sincronização; Inter, Itaú e Santander constam com investimentos no Open Finance (tabela de cobertura da Pluggy, 30/10/2026).
- Coleção nova `bankInvestments` (banco local v6, backup formato 5, sincroniza na nuvem). É uma foto da posição: valor líquido, bruto, aplicado, quantidade, taxa, vencimento. Não vira operação de compra (o Open Finance não traz o histórico completo; inventar compras distorceria a rentabilidade).
- Entra no patrimônio de hoje ("Nos bancos"). Ação/FII/ETF com o mesmo código já cadastrado à mão vem desligada; cada posição tem "Contar no patrimônio". Resgatado por completo sai; moeda estrangeira fica de fora (aba Dólar, Etapa 15).
- Rentabilidade passada não vem pelo Open Finance; quando o banco informa o valor aplicado, mostra quanto rendeu.

Detalhes da Etapa 13:
- **Topo da tela inicial:** gasto do mês até hoje, gráfico acumulado dia a dia contra o mês passado, diferença até o mesmo dia, as 5 maiores categorias e a previsão do mês inteiro (já gasto + contas a vencer + recorrências + média do dia a dia).
- **Previsão do mês que vem:** entradas, contas e faturas já lançadas, parcelas de dívidas, média do dia a dia (3 meses fechados), quanto deve sobrar ou faltar e o saldo previsto.
- Resumo, patrimônio e gráficos seguem abaixo. Regras em `src/domain/home.ts`.
- **APK parado:** a auditoria do GitHub Actions bloqueia por alerta em `picomatch` (só ferramenta de build, sem versão corrigida em 17/11/2026). Dono escolheu esperar a correção.

Detalhes da Etapa 12b (correções depois do primeiro uso real, 17/11/2026):
- **Categorias:** a classificação da Pluggy (campo `category`) vira a categoria do app; regra sua e "como antes" continuam valendo. A Pluggy diz que a categorização é liberada no trial e depois é opcional: sem ela, voltam as palavras-chave.
- **Não é gasto:** transferência entre contas suas ("Same person transfer") e aplicação/resgate de investimento viram transferência com o outro lado "fora do app": mexem no saldo, não em receitas/despesas.
- **Saldo:** conta antiga ligada à conexão recebia 90 dias de histórico no saldo. Botão "Começar com o saldo do banco" (nada é apagado). Contas do banco ligadas à mesma conta do app têm os saldos somados.
- **Refazer a importação com as regras novas:** apaga o que veio da conexão (cópia de segurança antes) e importa de novo; o que foi lançado à mão fica.

Detalhes da Etapa 11b:
- **Achado:** a fonte padrão era a brapi, que no plano grátis não traz proventos, e a busca só acontecia ao tocar no botão. Na prática, nada era buscado sozinho.
- **Fonte "Automática"** (padrão): brapi com token e plano pago; senão Yahoo. Migração única para quem estava na brapi grátis.
- **Busca sozinha** ao abrir o app Android, no máximo a cada 20 h; a verificação com o app fechado recebe a fonte já resolvida.
- **Fonte fora do ar:** guarda desde quando, avisa na aba Dividendos, não mexe nos proventos salvos.
- **B3:** não usada. Dados e termos de uso atrás de proteção anti-robô; sem termos confirmados.

Detalhes da Etapa 11a (documentação completa em `docs/INVESTIMENTOS.md`):
- **Auditoria antes:** o resumo por ativo, o gráfico de renda passiva, o fechamento do mês e a liberdade financeira contavam como recebido todo provento com data de pagamento passada. Corrigido: só confirmado conta.
- **Status:** anunciado, aguardando data-com, direito adquirido, pagamento previsto, aguardando confirmação, pago, cancelado (+ selo "alterado").
- **Confirmação pelo extrato** importado (código do ativo ou palavra de provento + valor + data), ligando ao lançamento existente; "Recebi" também liga em vez de duplicar; crédito apagado desfaz a confirmação.
- **Histórico de correções** (valor, data, sumiço da fonte); cancelar em vez de apagar; confirmado não muda de valor.
- **Painel:** recebido no mês, no ano, total, média mensal, aguardando confirmação, próximos 6 meses (anunciado e estimado), por ativo, por tipo, gráfico de 12 meses para trás e 6 para frente.
- **Rentabilidade total** na aba Bolsa: valorização + vendas + proventos recebidos − custos, com patrimônio, recebido e futuros separados.
- **Avisos novos:** data-com chegando, provento confirmado, alterado, sumiu da fonte.
- **Fontes:** avaliadas B3, Fundos.NET, CVM, Yahoo, brapi e Alpha Vantage. Nenhuma fonte gratuita, oficial e liberada traz data de pagamento; nenhuma confirma o crédito na conta. Alpha Vantage descartada (sem B3). B3 em modo de melhor esforço aguarda decisão do dono (11b).

Detalhes da Etapa 10:
- **Testes:** 218 (23 novos): PIN (hash, sal, limite de tentativas), cliente da nuvem (chaves, erros, sessão, lotes, codificação na URL), nomes das coleções no SQL, todas as perguntas sugeridas do chat. `npm run test:coverage` mostra a cobertura (regras de cálculo entre 80% e 100%; telas cobertas pela navegação automática).
- **Revisão de segurança** (tabela em `docs/SEGURANCA.md`): 0 vulnerabilidades nas dependências; nenhum `innerHTML`/`eval`; links só `https`; manifesto e RLS conferidos. Corrigido: contador do PIN com registro corrompido. Reforçado: id do usuário codificado na exclusão da nuvem.
- **GitHub Actions** em Node 24: checkout v6, setup-node v6, setup-java v5, upload-artifact v6.
- **Documentos novos:** `docs/ROTEIRO-TESTE.md` (o que conferir no celular a cada versão) e `docs/TECNOLOGIAS.md` (tecnologias, serviços, limites, dados). README atualizado.

Detalhes da Etapa 8b (Gemini Nano, ML Kit GenAI `com.google.mlkit:genai-prompt:1.0.0-beta5`, conferido em 16/11/2026):
- **Onde:** Ajustes → Grefinacia AI → "IA no aparelho (Gemini Nano)". Desligado por padrão; mostra o estado (pronto, precisa baixar, indisponível) e baixa o modelo.
- **Como responde:** as perguntas que as regras locais reconhecem continuam com as regras (números exatos). Só as que elas não reconhecem vão ao Gemini Nano, com os totais do app (sem descrições de lançamentos), cortados para caber na janela de ~4.000 tokens. A resposta vem marcada "Gemini Nano, no aparelho. Pode errar".
- **Privacidade:** o texto não sai do celular; o ML Kit envia ao Google métricas de uso (aparelho, identificadores de instalação, tempo, tamanho, erros), conforme a página oficial de divulgação de dados. O app avisa isso na opção e na seção de privacidade.
- **Aparelhos:** lista oficial inclui Galaxy S25/S26 (Gemini Nano 4), Pixel 9/10/11 e outros. Exige Android 8+: **o mínimo do app subiu de Android 7 para Android 8**.
- **Nativo:** `android/app/src/main/java/br/com/grefinacia/app/NanoEngine.java` (compilado localmente contra a biblioteca real) e `GeminiNanoPlugin.java`, registrado na `MainActivity`.
- **Termos do Google (ML Kit GenAI):** 18+; avisar sobre as métricas; não usar como conselho profissional; recurso beta pode mudar.

Detalhes da Etapa 9 (tudo no aparelho, o arquivo não sai dele):
- **Onde:** Movimentações → botão de importar (no topo) ou Ajustes → Importar extrato.
- **Formatos:** OFX 1.x (SGML) e 2.x (XML), em UTF-8 ou Windows-1252; CSV com `;`, `,` ou tab, cabeçalho reconhecido pelo nome (data, descrição/histórico, valor ou débito/crédito, identificador), linhas antes do cabeçalho e linhas de saldo ignoradas. Fatura em CSV no formato "date,title,amount" tem o sinal invertido. Botão "inverter entradas e saídas" para CSV.
- **Prévia:** destino (conta ou cartão), totais e período; cada linha com categoria sugerida (regra sua → como você fez antes → palavra-chave → "Outros"). Ficam desmarcados: já importado (mesmo identificador do banco), parecido com lançamento existente, pagamento de fatura e repetido no arquivo.
- **Cartão:** compra de fatura já vencida entra paga pela conta do cartão; da fatura em aberto, a pagar.
- **Segurança dos dados:** cópia de segurança antes de importar e antes de desfazer; desfazer apaga só os lançamentos daquela importação.
- **Regras aprendidas:** trocar a categoria na prévia cria regra "descrição → categoria" (configuração `importRules`, sincroniza).
- **Banco local versão 5** (coleção `imports`, sincroniza) e **backup formato 4**. Na primeira abertura, relê a nuvem uma vez.
- **PDF não é lido**: o app pede para exportar em OFX ou CSV. **Conexão bancária automática** (Open Finance) continua fora; a leitura entrega sempre a mesma estrutura (`StatementRow`), pronta para um conector futuro.
- Os testes usam arquivos montados no formato de cada banco; falta conferir com extratos reais do dono.

Detalhes da Etapa 8a (tudo no aparelho, sem custo e sem internet):
- **Grefinacia AI → Raio-X:** previsão de caixa de 3, 6 ou 12 meses (gráfico e tabela); gastos fora do padrão (categoria contra a mediana de 6 meses; lançamento 3× acima do típico); cobranças em dobro (com "excluir" ou "não é duplicada"); assinaturas e cobranças mensais (cadastradas e detectadas, com aviso de aumento de preço); raio-X da carteira (classes, concentração, renda fixa vencendo).
- **Alertas** novos na aba Alertas e no Início, que levam ao Raio-X.
- **Chat local** responde: previsão dos próximos meses, gastos fora do padrão, assinaturas, cobranças em dobro, carteira e como comparar empréstimos.
- **Planejamento → Dívidas → Comparar empréstimos:** até 3 propostas, pela taxa ou pela parcela; Price ou SAC; parcela, total pago, custo e CET estimado; marca a de menor CET.
- **Configuração nova** `analysis.ignoredDuplicates` (pares marcados como "não é duplicada"); sincroniza com as demais configurações.
- **8b (Gemini Nano / Ollama) não foi feita**: depende de decisão do dono (ver "Próximo passo").

Já existia desde a versão 1.0: receitas e despesas, recorrências, parcelas, cartões e faturas, plano salarial, reservas,
orçamento, dívidas com simulações, ações/FIIs/ETFs, renda fixa, dividendos, chat local por regras, fechamento em PDF e CSV,
PIN, biometria, backup em arquivo cifrado, notificações.

## Em desenvolvimento

Etapa 12 pronta no branch `claude/etapa-12-pluggy`, aguardando o dono testar o APK 1.9.0 com os bancos dele.

## Falta desenvolver

| Item | O que é (todas as etapas 1 a 10 do plano estão feitas; isto é opcional) |
|---|---|
| — | Ollama no computador (alternativa à 8b), se o dono quiser |
| 9 (resto) | Leitura de PDF por banco, se valer a pena; ajustes com extratos reais do dono |
| — | Leitor de código de barras pela câmera; boleto em PDF (fora do plano das etapas; sob pedido) |

## O que foi verificado e o que não foi

- **Verificado por teste automático:** leitura de OFX (SGML e XML, Windows-1252) e CSV (vários layouts), prévia, duplicados, fatura, desfazer com cópia de segurança; previsão de caixa, fora do padrão, assinaturas, cobranças em dobro, raio-X da carteira, Price/SAC/CET; regras de cálculo, criptografia, backup, migração do banco (inclusive 3 → 4), sincronização com dois aparelhos simulados, leitura de feeds, leitura de boleto, rentabilidade por cotas, CDI e IPCA acumulados, cota da brapi.
- **Verificado contra as fontes reais (16/11/2026, fora do celular):** histórico da brapi (PETR4, 62 dias) e do Yahoo (1 ano), preço, histórico e busca na CoinGecko, CDI de 10 anos e IPCA do Banco Central. Tela de cripto e desempenho conferida no navegador com essas respostas reais.
- **Verificado pelo dono no Galaxy S26 Ultra:** instalação do APK assinado, login Google, envio e retorno dos dados pela nuvem após reinstalar, notícias, telas da Etapa 6 e da Etapa 7 ("tudo certo", sem detalhar item a item).
- **Não verificado:** sincronização com dois aparelhos reais ao mesmo tempo; isolamento entre duas contas logadas no Supabase (só o acesso sem login foi conferido); boleto real (os testes usam boletos montados no padrão); Etapa 8b no aparelho (código nativo só compila no GitHub); importação de bancos além do Inter; Etapa 8a com meses de dados reais.

## Problemas conhecidos e limites

- Conflito de sincronização compara o relógio do aparelho com o do servidor; relógio muito errado pode decidir errado.
- O projeto Supabase gratuito pausa após cerca de uma semana sem uso; reativa-se pelo painel. O app segue funcionando offline.
- Notícias só carregam no app Android (no navegador os sites bloqueiam a leitura). Feeds do CoinTelegraph Brasil e da CNN Brasil não existem mais.
- Cotações da brapi no plano gratuito têm atraso de ~30 min e não trazem proventos.
- Os dados no aparelho não são cifrados pelo app (proteção do Android); o PIN é trava de tela.
- Backup feito a partir da versão com transferências (formato 2) não abre em versões antigas do app.
- Rentabilidade da carteira não inclui proventos nem renda fixa (renda fixa não tem histórico de preço; o valor é informado à mão).
- O contador da brapi conta só o que o app faz neste aparelho; outro aparelho com o mesmo token e a verificação de proventos em segundo plano não entram.
- Cripto: preço de 1 unidade guardado com frações de centavo quando a compra é informada pelo total, para o custo bater exatamente com o valor pago.
- Previsão de caixa só conhece o que está lançado ou recorrente; receita sem lançamento não entra. O gasto do dia a dia é a média dos 3 últimos meses fechados.
- Detecção de assinaturas e de cobranças em dobro depende de descrições parecidas; extratos com descrições muito diferentes podem escapar (melhora com a importação de extratos, Etapa 9).
- CET do comparador é estimativa (tarifas tratadas como descontadas do valor recebido); o oficial é o do contrato.
- Importação: compra parcelada na fatura entra como compra simples daquela parcela; o app não junta as parcelas de meses diferentes.
- Se a conta foi criada com o saldo de hoje, lançamentos importados de antes dessa data entram no histórico sem mudar o saldo (é o certo: o saldo informado já os inclui).
- Gemini Nano (8b): beta do Google; respostas podem errar; só em celulares da lista oficial; cota de uso por app definida pelo AICore.

## Próximo passo

1. Dono instala o APK 1.9.0, abre Ajustes → Conexão bancária, coloca Client ID, Client Secret e o Item ID de cada banco, busca as contas, escolhe o destino e sincroniza.
2. Confere: lançamentos no mês certo, saldo "confere", nada duplicado, proventos confirmados.
3. Com o OK, merge do PR da Etapa 12 (só com pedido).

## Serviços em uso (todos gratuitos)

| Serviço | Para quê | Onde configurar |
|---|---|---|
| GitHub Actions | gerar o APK | Secrets `ANDROID_KEYSTORE_BASE64` e `ANDROID_KEYSTORE_PASSWORD` |
| Supabase (plano Free) | login e cópia cifrada | painel do projeto; SQL em `supabase/migrations/0001_cofre.sql` |
| Google Cloud OAuth | "Entrar com Google" | clientes Web e Android; provedor Google ligado no Supabase |
| brapi.dev / Yahoo Finance | cotações e histórico | token opcional informado pelo usuário no app |
| CoinGecko (API pública, sem chave) | criptomoedas | nada a configurar |
| Banco Central (SGS, dados abertos) | CDI e IPCA | nada a configurar |
| Feeds RSS | notícias | lista em `src/domain/news.ts` |
| Meu Pluggy (uso pessoal gratuito) | saldos, extratos e cartões dos seus bancos (Open Finance) | meu.pluggy.ai e dashboard.pluggy.ai; chaves em Ajustes → Conexão bancária |
| Gemini Nano (ML Kit GenAI, no aparelho) | perguntas livres no chat (opcional) | Ajustes → Grefinacia AI; nada a pagar |
