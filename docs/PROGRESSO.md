# Grefinacia — progresso

Checkpoint de **16/11/2026**. Versão 1.2.0 no branch `claude/etapa-7-investimentos` (ainda não está no `main`). 154 testes automáticos passando.
O `main` continua em `5663fbd` (versão 1.1.0, 125 testes).

## Concluído e no `main`

| Etapa | Entrega | PR |
|---|---|---|
| 1–3 | Auditoria, tecnologias e planejamento (`docs/PLANEJAMENTO.md`) | — |
| 4 | Assinatura fixa do APK, cofre de segredos, CSP, cópias de segurança automáticas, validação de backup, IA paga desligada, cota da brapi protegida | 2 |
| 5a | Login com Google e cópia cifrada na nuvem (Supabase) | 1 |
| 5b | Sincronização automática registro a registro | 4 |
| 6 | Categorias próprias, transferência entre contas, limite do cartão, leitura da linha digitável de boletos, exportação JSON | 5 |
| 9 (parte) | Notícias do mercado financeiro por RSS, 12 fontes em 5 assuntos | 3 |

## Pronto no branch, aguardando teste no aparelho

| Etapa | Entrega | Branch |
|---|---|---|
| 7 | Selo de atraso em toda cotação, contador de consultas da brapi, histórico de preços guardado no aparelho, desempenho da carteira contra CDI e IPCA, carteira de criptomoedas | `claude/etapa-7-investimentos` |

Detalhes da Etapa 7:
- **Selo da cotação:** fonte, horário e idade (verde até 1 h, amarelo até 4 dias, vermelho depois).
- **Contador da brapi** em Ajustes → Cotações: consultas do mês neste aparelho, de 15.000 (plano grátis). Nos últimos 10% o histórico só é buscado quando você pede; no limite, o app para de consultar até o dia 1º.
- **Histórico:** brapi (3 meses no plano grátis), Yahoo (1 ano) e CoinGecko (12 meses). Cada busca e cada cotação acrescentam dias, então o histórico cresce com o uso. Fica só no aparelho (não sincroniza; vai no backup).
- **Desempenho:** rentabilidade por cotas (compras e vendas não contam como ganho), períodos de 1 mês a tudo, comparada ao CDI e ao IPCA do Banco Central, com gráfico.
- **Cripto:** aba nova em Investimentos. Moedas populares na lista e busca por nome; quantidade com fração; compra pelo total pago ou pelo preço; preço médio, lucro, variação em 24 h, gráfico de preço; entra no saldo da conta (se marcado) e no patrimônio. Sincroniza entre aparelhos.
- **Banco local versão 4** (só acrescenta gavetas) e **backup formato 3** (backups antigos continuam abrindo; backup novo não abre em versão antiga do app).

Já existia desde a versão 1.0: receitas e despesas, recorrências, parcelas, cartões e faturas, plano salarial, reservas,
orçamento, dívidas com simulações, ações/FIIs/ETFs, renda fixa, dividendos, chat local por regras, fechamento em PDF e CSV,
PIN, biometria, backup em arquivo cifrado, notificações.

## Em desenvolvimento

Etapa 7 pronta no branch `claude/etapa-7-investimentos`, aguardando o dono testar o APK e autorizar o merge.

## Falta desenvolver

| Etapa | O que é |
|---|---|
| 8 | IA local ampliada (gastos fora do padrão, previsão de caixa, comparador de empréstimos); Gemini Nano no aparelho ou Ollama, como experimento |
| 9 (resto) | Importar extratos OFX/CSV (PDF onde for viável); precisa de um arquivo de exemplo por banco |
| 10 | Testes completos e roteiro de teste no aparelho |
| — | Leitor de código de barras pela câmera; boleto em PDF |

## O que foi verificado e o que não foi

- **Verificado por teste automático:** regras de cálculo, criptografia, backup, migração do banco (inclusive 3 → 4), sincronização com dois aparelhos simulados, leitura de feeds, leitura de boleto, rentabilidade por cotas, CDI e IPCA acumulados, cota da brapi.
- **Verificado contra as fontes reais (16/11/2026, fora do celular):** histórico da brapi (PETR4, 62 dias) e do Yahoo (1 ano), preço, histórico e busca na CoinGecko, CDI de 10 anos e IPCA do Banco Central. Tela de cripto e desempenho conferida no navegador com essas respostas reais.
- **Verificado pelo dono no Galaxy S26 Ultra:** instalação do APK assinado, login Google, envio e retorno dos dados pela nuvem após reinstalar, notícias, telas da Etapa 6.
- **Não verificado:** sincronização com dois aparelhos reais ao mesmo tempo; isolamento entre duas contas logadas no Supabase (só o acesso sem login foi conferido); boleto real (os testes usam boletos montados no padrão); Etapa 7 no celular (CoinGecko e Banco Central de dentro do app Android).

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
- Aviso no build: as actions `checkout`, `setup-node` e `setup-java` v4 usam Node 20, que o GitHub está descontinuando. Ainda funciona.

## Próximo passo

1. Dono instala o APK do branch `claude/etapa-7-investimentos` e testa: aba Cripto, botão atualizar, quadro Desempenho, selo das cotações, contador em Ajustes.
2. Com o OK, abrir o PR para o `main` (só com autorização).
3. Depois: Etapa 8 (IA local), resto da Etapa 9 (extratos) ou Etapa 10 (testes completos), à escolha do dono.

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
