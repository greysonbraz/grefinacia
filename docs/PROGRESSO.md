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
