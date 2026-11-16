# Grefinacia — progresso

Checkpoint de **16/11/2026**. `main` em `3a84942` (versão 1.2.0). Etapa 8a no PR nº 7 (aprovada no aparelho, aguardando merge). Etapa 9 no branch `claude/etapa-9-extratos` (versão 1.4.0, 187 testes), feito em cima da 8a.

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

## Pronto no branch, aguardando teste no aparelho

| Etapa | Entrega | Branch |
|---|---|---|
| 8a | Motor local ampliado: previsão de caixa, gastos fora do padrão, assinaturas, cobranças em dobro, raio-X da carteira, comparador de empréstimos | PR nº 7 (testada pelo dono) |
| 9 | Importar extrato de conta e fatura de cartão (OFX e CSV), com prévia, duplicados, categoria automática, regras aprendidas e desfazer | `claude/etapa-9-extratos` |

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

Etapa 9 pronta no branch `claude/etapa-9-extratos`, aguardando o dono testar o APK (de preferência com um extrato real) e autorizar o PR. A 8a está no PR nº 7, aguardando merge.

## Falta desenvolver

| Etapa | O que é |
|---|---|
| 8b | Linguagem natural com Gemini Nano no aparelho ou Ollama no computador, como experimento |
| 9 (resto) | Leitura de PDF por banco, se valer a pena; ajustes com extratos reais do dono |
| 10 | Testes completos e roteiro de teste no aparelho |
| — | Leitor de código de barras pela câmera; boleto em PDF |

## O que foi verificado e o que não foi

- **Verificado por teste automático:** leitura de OFX (SGML e XML, Windows-1252) e CSV (vários layouts), prévia, duplicados, fatura, desfazer com cópia de segurança; previsão de caixa, fora do padrão, assinaturas, cobranças em dobro, raio-X da carteira, Price/SAC/CET; regras de cálculo, criptografia, backup, migração do banco (inclusive 3 → 4), sincronização com dois aparelhos simulados, leitura de feeds, leitura de boleto, rentabilidade por cotas, CDI e IPCA acumulados, cota da brapi.
- **Verificado contra as fontes reais (16/11/2026, fora do celular):** histórico da brapi (PETR4, 62 dias) e do Yahoo (1 ano), preço, histórico e busca na CoinGecko, CDI de 10 anos e IPCA do Banco Central. Tela de cripto e desempenho conferida no navegador com essas respostas reais.
- **Verificado pelo dono no Galaxy S26 Ultra:** instalação do APK assinado, login Google, envio e retorno dos dados pela nuvem após reinstalar, notícias, telas da Etapa 6 e da Etapa 7 ("tudo certo", sem detalhar item a item).
- **Não verificado:** sincronização com dois aparelhos reais ao mesmo tempo; isolamento entre duas contas logadas no Supabase (só o acesso sem login foi conferido); boleto real (os testes usam boletos montados no padrão); Etapa 9 com extratos reais (os testes usam arquivos montados no formato de cada banco); Etapa 8a com meses de dados reais.

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
- Aviso no build: as actions `checkout`, `setup-node` e `setup-java` v4 usam Node 20, que o GitHub está descontinuando. Ainda funciona.

## Próximo passo

1. Dono faz o merge do PR nº 7 (Etapa 8a).
2. Dono instala o APK do branch `claude/etapa-9-extratos` e importa um extrato real (OFX ou CSV) de cada banco que usa. Se algum arquivo não for lido ou vier com sinal/categoria errados, ajustar com um exemplo dele (pode trocar valores e nomes).
3. Com o OK, abrir o PR da Etapa 9 (só com autorização).
4. Depois: 8b (experimental) ou Etapa 10 (testes completos).

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
