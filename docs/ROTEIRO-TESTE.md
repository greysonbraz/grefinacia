# Roteiro de teste no celular

O que os testes automáticos **não** conseguem conferir, porque depende do Android de verdade.
Use quando sair uma versão nova. Marque cada item; se algo falhar, anote o número do item e o que apareceu na tela.

**Antes de começar:** Ajustes → Backup e outros aparelhos → **Fazer backup** (guarde o arquivo e a senha).

## 1. Instalação e atualização

| # | Faça | Esperado |
|---|---|---|
| 1.1 | Baixe o APK em GitHub → Actions → *Gerar APK* → **grefinacia-apk** e instale **por cima** | Instala sem pedir para desinstalar; os dados continuam |
| 1.2 | Abra o app | Abre no Início com seus dados. Ajustes → Cópias automáticas neste aparelho mostra uma cópia "atualização" se o banco mudou de versão |
| 1.3 | Ajustes → rodapé | Mostra a versão nova |

## 2. Bloqueio e privacidade

| # | Faça | Esperado |
|---|---|---|
| 2.1 | Ajustes → Segurança: crie um PIN | Pede o PIN ao reabrir |
| 2.2 | Erre o PIN 5 vezes | A partir do 5º erro, espera de 30 s (dobra a cada novo erro) |
| 2.3 | Ligue a biometria e reabra | Pede a digital ou o rosto; "Usar senha" volta ao PIN |
| 2.4 | Saia do app pelo tempo configurado e volte | Pede o PIN de novo |
| 2.5 | Tente tirar print com "esconder nos recentes" ligado | O Android bloqueia o print; nos apps recentes a tela aparece em branco |

## 3. Notificações

| # | Faça | Esperado |
|---|---|---|
| 3.1 | Ajustes → Notificações: permita | O Android pergunta uma vez e fica "Permitidas" |
| 3.2 | Cadastre uma conta a pagar vencendo amanhã | Lembrete no horário escolhido, mesmo com o app fechado |
| 3.3 | Reinicie o celular antes do horário | O lembrete continua chegando |
| 3.4 | Samsung: Configurações → Apps → Grefinacia → Bateria → **Não restrito** | Avisos não atrasam |

## 4. Nuvem (login Google)

| # | Faça | Esperado |
|---|---|---|
| 4.1 | Ajustes → Conta e nuvem → Entrar com Google | Mostra seu e-mail; pede a senha de sincronização (a primeira vez cria) |
| 4.2 | Altere um lançamento | Em até alguns segundos "Sincronizado" |
| 4.3 | Em outro aparelho (quando tiver), entre com a mesma conta e a mesma senha | Os dados aparecem; uma mudança num aparelho chega no outro |
| 4.4 | Sem internet, altere algo e depois reconecte | A mudança sobe quando a internet volta |

## 5. Investimentos

| # | Faça | Esperado |
|---|---|---|
| 5.1 | Bolsa → atualizar | Cotações com selo verde ("há N min"); Desempenho com Carteira, CDI e IPCA |
| 5.2 | Cripto → + → Bitcoin, quantidade 0,001, total pago → Salvar → atualizar | Preço da CoinGecko, lucro ou prejuízo, gráfico no detalhe |
| 5.3 | Ajustes → Cotações e proventos | Contador da brapi aumentou; fonte dos proventos "Automática" |
| 5.4 | Investimentos → Dividendos (com FIIs ou ações na carteira) | "Proventos atualizados em …" sem tocar em nada; proventos aparecem com status |
| 5.5 | Importe um extrato com crédito de dividendo/JCP/rendimento | O provento passa para "Pago" sozinho, sem lançamento duplicado |

## 6. Importar extrato

| # | Faça | Esperado |
|---|---|---|
| 6.1 | Movimentações → botão de importar → escolha OFX ou CSV do banco | Prévia com categorias; "pagamento de fatura" e repetidos vêm desmarcados |
| 6.2 | Importe | Lançamentos aparecem no mês certo |
| 6.3 | Importe o mesmo arquivo de novo | Tudo vem desmarcado como "Já importado" |
| 6.4 | Importações anteriores → Desfazer | Só aqueles lançamentos somem |
| 6.5 | Tente um PDF | Mensagem pedindo OFX ou CSV |

## 6b. Conexão bancária (Meu Pluggy)

| # | Faça | Esperado |
|---|---|---|
| 6b.1 | Ajustes → Conexão bancária → coloque Client ID e Client Secret → Guardar | "Chaves guardadas no cofre"; o campo do Secret volta vazio |
| 6b.2 | Adicione o Item ID de cada banco → Buscar contas dos bancos | Aparecem as contas e cartões de cada banco |
| 6b.3 | Escolha "Criar conta nova" (ou uma existente) para cada uma → Sincronizar agora | Lançamentos em Movimentações; o saldo mostra "confere" |
| 6b.4 | Sincronizar agora de novo | "Nada novo desde a última vez" (sem duplicar) |
| 6b.6 | Conta com "diferença" → Começar com o saldo do banco | Passa a "confere"; lançamentos continuam |
| 6b.7 | Refazer a importação com as regras novas | Gráfico por categoria sem quase tudo em "Outros"; transferências entre contas suas fora das despesas |
| 6b.5 | Movimentações → Importar → Importações anteriores | Cada sincronização aparece com "Desfazer" |

## 7. Grefinacia AI

| # | Faça | Esperado |
|---|---|---|
| 7.1 | Raio-X | Previsão de caixa, fora do padrão, assinaturas, cobranças em dobro, carteira |
| 7.2 | Chat: "Quanto posso gastar até o próximo salário?" | Resposta com a conta, sem internet |
| 7.3 | Ajustes → Grefinacia AI → IA no aparelho (Gemini Nano) → ligar | Estado "Pronto" ou "Precisa baixar" (baixe no Wi-Fi) |
| 7.4 | Chat: "Me explique o que é CDB com liquidez diária" | Resposta marcada "Gemini Nano, no aparelho. Pode errar" |
| 7.5 | Modo avião + 7.4 | Continua respondendo (roda no celular) |

## 8. Outros

| # | Faça | Esperado |
|---|---|---|
| 8.1 | Início → ícone de jornal (Notícias) | Lista de notícias; o link abre no navegador |
| 8.2 | Movimentações → + → despesa → campo do boleto: cole a linha digitável de um boleto real | Valor, vencimento e banco corretos |
| 8.3 | Planejamento → Relatórios → PDF | Abre a tela de compartilhar com o PDF |
| 8.4 | Backup → Restaurar com o arquivo do início | Dados voltam; a senha errada é recusada |

## 9. Apagar tudo (só se quiser testar; faça o backup antes)

| # | Faça | Esperado |
|---|---|---|
| 9.1 | Ajustes → Privacidade (LGPD) → Apagar todos os meus dados | O app volta ao começo; restaurar o backup traz tudo de volta |
