# Grefinacia — Auditoria e planejamento (fase custo zero)

Data: 12/11/2026 · Cobre as Etapas 1, 2 e 3. Nenhuma funcionalidade foi implementada nesta entrega.

---

## 1. Resumo

1. **O código-fonte do app existe e está saudável.** Ele está no repositório `greysonbraz/grefinacia` (React + TypeScript + Capacitor 8). Rodei aqui: 50 testes passam, o build compila e as dependências não têm vulnerabilidade conhecida. Não é preciso reconstruir nada.
2. **O pacote Android que montei ontem é um app separado e deve ser aposentado.** Ele foi feito a partir do artifact compilado, antes de eu saber que o código-fonte existia. Usa outro identificador (`br.com.grefinacia`, contra `br.com.grefinacia.app` do projeto original), então o Android trata os dois como apps diferentes, com dados separados.
3. **Risco real de perder dados hoje:** cada APK gerado no GitHub sai assinado com uma chave nova. O Android recusa atualizar um app por cima de outro com assinatura diferente; a saída é desinstalar, e desinstalar apaga os dados. Isso precisa ser corrigido antes de você colocar dados reais.
4. **Boa parte do que você pediu já existe** (receitas/despesas, cartões e faturas, dívidas com simulações, ações/FIIs/ETFs, dividendos, relatórios, PIN/biometria, backup criptografado, IA local por regras). Faltam: login Google e nuvem, cripto, notícias, importação de extratos, boletos, categorias personalizadas, histórico de preços e IA local mais forte.
5. **Tudo o que falta dá para fazer sem pagar nada**, com quatro exceções que não têm via gratuita oficial: Open Finance direto com os bancos, DDA, cotações em tempo real da B3 e proventos com data de pagamento. Para cada uma há um substituto gratuito (seção 5).

---

## 2. Etapa 1 — Auditoria do projeto atual

### 2.1 Onde está cada coisa

| Local | O que é | Situação |
|---|---|---|
| `greysonbraz/grefinacia` (público) | Código-fonte real do app, projeto Android e workflow "Gerar APK" | É aqui que o app deve evoluir |
| `greysonbraz/saudetech-dashboards`, branch `claude/android-app-vsb8y3` | Pacote Android que montei ontem a partir do artifact | Duplicado. O PR foi fechado sem merge. Reaproveito dele só o ícone, a tela de abertura e a configuração de assinatura |
| Artifact no claude.ai | Versão web em arquivo único do mesmo código | Serve para testar no navegador; os dados dele ficam no navegador |
| `grefinacia.zip` dentro do repositório | Cópia do próprio código (conferi: idêntica, só muda a quebra de linha) | Redundante; pode sair numa limpeza, com seu OK |

### 2.2 O que verifiquei rodando

- `npm ci`: 212 pacotes, **0 vulnerabilidades**.
- `npm test`: **50 de 50 testes passam** (regras de cálculo).
- `npm run build`: compila sem erros (TypeScript em modo estrito).
- Varredura de segredos no repositório e no zip: **nenhuma chave ou senha encontrada**.
- Assinatura do APK gerado ontem no GitHub: certificado criado às 09:28:24 UTC, durante o próprio build. Confirma que cada build usa uma chave descartável.

Não verifiquei: o app rodando num celular (este ambiente não compila Android) nem chamadas reais às APIs de cotação. O README original também avisa que o app nunca foi testado em aparelho.

### 2.3 Riscos encontrados, em ordem de importância

| # | Risco | Consequência | Correção (gratuita) |
|---|---|---|---|
| 1 | Cada APK tem assinatura diferente | Atualizar exige desinstalar, o que apaga os dados. Também impede o login Google, que depende da assinatura | Chave de assinatura fixa guardada nos Secrets do GitHub |
| 2 | Dois apps diferentes circulando (o de ontem e o original) | Dados digitados em um não aparecem no outro | Ficar só com o original; levar os dados pelo backup `.gfbackup` |
| 3 | Verificador de proventos em segundo plano chama a brapi a cada hora, por ativo, mesmo no plano gratuito (que não tem proventos) | Pode gastar a cota gratuita de 15.000 requisições/mês sem trazer nada | Não chamar no plano gratuito; reduzir a frequência |
| 4 | Restaurar backup substitui tudo sem cópia de segurança e valida pouco o arquivo | Um arquivo errado ou corrompido apaga o que havia | Cópia automática antes de restaurar; validação completa do arquivo |
| 5 | Token da brapi e chave de IA ficam em texto puro no banco local | Quem tiver acesso aos arquivos do app lê os segredos | Guardar no cofre do Android (Keystore) |
| 6 | Dados locais não são criptografados pelo app | O PIN é uma trava de tela, não criptografia. A proteção real é a do Android | Aceitável agora; criptografia em repouso fica como reforço opcional |
| 7 | Sem Content-Security-Policy | Menos barreiras se algum conteúdo externo (ex.: notícias) trouxer script | Adicionar CSP e exibir conteúdo externo só como texto |
| 8 | APK de debug no uso diário | Permite inspecionar o app por cabo USB com depuração ligada | Gerar APK de release assinado |
| 9 | Banco local sem controle de versão (`DB_VERSION = 1`) | Novas funções exigem migração; sem cuidado, risco de perda | Migrações que só acrescentam + testes de migração |
| 10 | Testes de interface (e2e) existem mas não rodam no GitHub; não há testes de segurança | Regressões passam despercebidas | Rodar e2e, auditoria de dependências e varredura de segredos no CI |

O que já está bem feito: PIN guardado só como hash (PBKDF2-SHA256, 210 mil iterações, com sal e comparação em tempo constante), bloqueio progressivo após 5 erros, biometria, bloqueio automático, proteção contra print e apps recentes, backup em AES-256-GCM, backup automático do Google desligado, notificações com conteúdo oculto na tela de bloqueio, dinheiro sempre em centavos inteiros, nenhum uso de `innerHTML`/`eval`, e o resumo enviado à IA externa só sai com autorização e sem descrições de lançamentos.

---

## 3. Etapa 2 — Tecnologias e funcionalidades existentes

### 3.1 Tecnologias

| Camada | Tecnologia |
|---|---|
| Interface | React 19, TypeScript 7 (estrito), Vite 8, CSS próprio, ícones lucide-react, fonte Geist |
| Gráficos e PDF | Chart.js 4, jsPDF 4 |
| Dados | IndexedDB (biblioteca `idb`), 14 coleções + configurações |
| Android | Capacitor 8 (minSdk 24, targetSdk 36) |
| Plugins nativos | notificações locais, biometria, privacy screen, filesystem, share, app, status bar, background runner, HTTP nativo |
| Segurança | Web Crypto (PBKDF2, AES-GCM) |
| Testes | Vitest (50 testes), script e2e com Playwright |
| CI | GitHub Actions: testa, compila e publica o APK de debug |
| Dados externos | brapi.dev, Yahoo Finance (não oficial), API da Anthropic (opcional, paga, desligada por padrão) |

Tamanho: cerca de 5.700 linhas de código, organizadas em `lib` (dinheiro, datas, tipos), `domain` (regras puras e testadas), `services` (cotações, notificações, segurança, backup, PDF, IA), `db`, `state` e `ui`.

### 3.2 Telas atuais

- **Início:** resumo do mês, contas, gráficos (patrimônio, receitas × despesas, categorias, investimentos, economias, dividendos, dívidas).
- **Movimentações:** lançamentos, filtros, gráficos, recorrentes, parcelamentos, faturas de cartão.
- **Investimentos:** Bolsa (ações, FIIs, ETFs), renda fixa, dividendos (previsão, calendário, histórico), simulador de aportes.
- **Grefinacia AI:** conversa (9 assuntos respondidos por cálculo local) e análises (21 tipos de alerta por regras).
- **Planejamento:** salário, reservas, orçamento, dívidas (quitação, antecipação, portabilidade, avalanche × bola de neve), independência financeira, relatórios e fechamento em PDF.
- **Ajustes:** contas, cartões, segurança, notificações, fontes de cotação, IA, backup, privacidade.

### 3.3 Seu pedido × o que existe

| Item | Situação | Etapa |
|---|---|---|
| **1. Autenticação e armazenamento** | | |
| Login Google | Não existe | 5 |
| Armazenamento seguro | Existe (local, PIN, biometria); falta cofre para segredos | 4 |
| Backup e recuperação | Existe, manual (arquivo criptografado) | 5 (automático na nuvem) |
| Sincronização entre aparelhos | Não existe | 5 |
| Funcionar offline | Existe (100% offline) | manter |
| **2. Controle financeiro** | | |
| Receitas e despesas, parcelas, recorrências | Existe | — |
| Categorias personalizadas | Falta (lista fixa) | 6 |
| Cartões, faturas, vencimentos | Existe; falta o limite do cartão na tela | 6 |
| Contas bancárias | Existe; falta transferência entre contas | 6 |
| Empréstimos, financiamentos, dívidas | Existe, com simulações | — |
| Relatórios mensais e anuais, gráficos | Existe | — |
| Exportar CSV / JSON | CSV das movimentações existe; JSON aberto falta | 6 |
| **3. IA** | | |
| Regras locais, análise de despesas, plano de quitação | Existe | — |
| Gastos excessivos, sugestões, comparação de empréstimos, análise de investimentos | Parcial | 8 |
| Previsão de fluxo de caixa | Parcial (só até o fim do mês) | 8 |
| Modelo local (Ollama / no aparelho) | Falta | 8 |
| **4. Investimentos B3** | | |
| Ações, FIIs, ETFs, dividendos, preço médio, rentabilidade, patrimônio | Existe | — |
| Histórico de preços, gráficos de desempenho | Falta | 7 |
| **5. Criptomoedas** | Falta | 7 |
| **6. Notícias** | Falta | 9 |
| **7. Open Finance / bancos** | Falta; sem via gratuita oficial | 9 (importar extratos) |
| **8. Boletos e contas** | Parcial: contas pendentes, vencimentos, alertas e histórico existem; falta cadastro de boleto e leitura da linha digitável | 6 |
| **9. Segurança** | Base boa, com as lacunas da seção 2.3 | 4 |
| **11. Interface** | 5 abas + Ajustes; faltam cripto, notícias, boletos, importação, conta/sincronização | 6 a 9 |

---

## 4. Serviços gratuitos avaliados e seus limites

Limites conferidos por busca em 12/11/2026. **Não consegui abrir as páginas oficiais a partir deste ambiente** (a rede daqui bloqueia esses sites), então trate os números como indicativos. Antes de usar cada serviço eu reconfirmo na página oficial e mostro a você.

| Serviço | Uso no app | Limites do plano gratuito | Cartão | Ao atingir o limite |
|---|---|---|---|---|
| **Supabase Free** | Login Google e banco na nuvem | 500 MB de banco; 5 GB de saída/mês; 50 mil usuários ativos/mês; 2 projetos ativos. **Pausa o projeto após cerca de 1 semana sem atividade**; restaura-se pelo painel (prazo máximo de restauração: fontes divergem entre 90 dias e 1 ano) | Não pede (fonte secundária) | Restringe o projeto; não há cobrança sem plano pago |
| **Firebase Spark** | Alternativa ao Supabase | Firestore: 1 GiB, 50 mil leituras/dia, 20 mil gravações/dia, 10 GiB de saída/mês. Login: 50 mil usuários ativos/mês. Armazenamento de arquivos e Functions ficam fora do plano gratuito | Não | O serviço para até a cota renovar; não cobra |
| **Login Google (Google Cloud OAuth)** | Botão "Entrar com Google" | Sem custo para login básico (nome e e-mail). Em modo de teste: até 100 usuários cadastrados | Não | — |
| **brapi.dev Gratuito** | Cotações B3 | 15.000 requisições/mês; 1 ativo por requisição; atraso de ~30 min; histórico de 3 meses; **sem dividendos** | Não | Bloqueia novas chamadas |
| **Yahoo Finance** | Histórico longo e proventos | Não oficial, sem contrato nem garantia; já está no app com esse aviso | — | Pode parar a qualquer momento |
| **Banco Central (SGS)** | Selic, CDI, IPCA, dólar | Oficial e aberto. Consultas por período de até 10 anos; "últimos N" até 20 valores | Não | — |
| **Mercado Bitcoin (API pública)** | Cripto em reais | Dados públicos sem chave; limite oficial não confirmado | Não | Erro 429 |
| **CoinGecko Demo** | Cripto (alternativa) | 10.000 chamadas/mês; exige chave demo gratuita. Taxa por minuto: a documentação diz ~30, a página de preços diz 100 | Não | Bloqueia. Existe "cobrança de excedente" desligada por padrão; nunca ativar |
| **RSS** | Notícias | Sem custo. Uso previsto: título, resumo e link para o site original | — | — |
| **Gemini Nano no aparelho (ML Kit GenAI)** | IA local em linguagem natural | Roda no celular; só com o app aberto; cota por app; depende do modelo do aparelho; API ainda em beta | Não | — |
| **Ollama** | IA local no seu computador | Gratuito; exige o PC ligado na mesma rede | Não | — |
| **GitHub Actions** | Gerar o APK | Repositório público: gratuito. Privado: cerca de 2.000 min/mês e 500 MB de artefatos (confirmar) | Não | Para de rodar até o mês virar |

Regras que vou seguir: nada de cartão, nada de teste grátis que vire cobrança, nenhum recurso com cobrança automática ligado, e controles dentro do app para não passar das cotas (cache, intervalo mínimo entre consultas e contador de uso visível).

---

## 5. O que não existe de graça, e o que entra no lugar

| Você pediu | Por que não dá | O que faço no lugar |
|---|---|---|
| Open Finance com BB, Sicredi, Inter, Nubank, Itaú, Bradesco, Caixa, Santander | Só instituições autorizadas pelo Banco Central participam. Agregadores (Pluggy, Belvo) são pagos; relato de mercado fala em milhares de reais por mês | Importação de extratos OFX e CSV (e PDF onde for viável), com a arquitetura pronta para um conector no futuro |
| DDA (busca automática de boletos) | Só é acessado pelo app do seu banco; as APIs são comerciais | Cadastro manual de boleto com leitura da linha digitável (extrai valor e vencimento) e, opcionalmente, leitor de código de barras pela câmera |
| Cotações da B3 em tempo real | O dado oficial é licenciado e pago | brapi gratuito, com atraso de ~30 min sempre indicado na tela junto do horário e da fonte |
| Proventos com data de pagamento via API | brapi só nos planos pagos; o Yahoo não traz a data de pagamento | Cadastro manual (já existe) e Yahoo como estimativa, marcado como não oficial |

**Meu Pluggy (possibilidade a avaliar depois):** a Pluggy mantém um app gratuito para a pessoa conectar as próprias contas via Open Finance e ler os dados por API com credenciais de desenvolvimento. Não consegui confirmar os termos de uso nem os limites, e ele exige guardar um `client_secret`. Fica fora do plano agora; se interessar, avaliamos na Etapa 9 com os termos na mão.

---

## 6. Arquitetura proposta

**Princípios**

- O aparelho continua sendo a fonte da verdade. O app funciona inteiro sem internet e sem login.
- Login é opcional e serve só para backup na nuvem e sincronização.
- Toda mudança no banco local é aditiva (cria o que falta, nunca apaga) e precedida de cópia de segurança automática.
- Cada fonte externa (cotações, cripto, notícias, IA, bancos) entra como um "provedor" trocável, como já é feito hoje com brapi/Yahoo/manual. Se uma fonte gratuita acabar, troca-se o provedor sem mexer no resto.
- Números sempre calculados por código testado. Modelo de linguagem, quando houver, só explica.

**Login e nuvem — recomendação: Supabase Free**

| | Supabase Free (recomendado) | Firebase Spark |
|---|---|---|
| Login Google | Sim | Sim |
| Controle de acesso | RLS em SQL, versionado no repositório e testável | Regras de segurança do Firestore |
| Ponto fraco | Pausa após ~1 semana sem uso; reativa-se com um clique no painel | Não pausa, mas prende mais ao Google e não tem SQL |
| Risco de cobrança | Nenhum sem cartão | Nenhum sem cartão |

Recomendo o Supabase porque você pediu RLS, as regras ficam auditáveis no repositório e não há aprisionamento. A pausa não causa perda: o app segue funcionando offline e avisa que a sincronização está parada. Se você preferir "nunca pausa", o Firebase atende.

**Criptografia ponta a ponta (recomendado):** os dados são cifrados no aparelho (AES-256-GCM) antes de subir, com uma chave derivada de uma senha de sincronização que só você conhece. O servidor guarda só texto cifrado. Contrapartida: se você esquecer essa senha, a cópia da nuvem não abre (os dados do aparelho continuam intactos).

**Desenho do banco na nuvem:** uma tabela de registros cifrados por usuário (`user_id`, coleção, id, conteúdo cifrado, data de alteração, marcador de exclusão), com RLS `user_id = auth.uid()` em leitura e escrita e permissões apenas para usuários autenticados. Nenhuma chave secreta no app nem no GitHub: a chave pública do Supabase é feita para ficar no app e depende do RLS; a `service_role` e o segredo do cliente OAuth nunca saem do painel.

**IA em camadas**

1. Motor local de regras (já existe; será ampliado). Sempre disponível, offline.
2. Linguagem natural opcional, local e gratuita: Gemini Nano no próprio aparelho, se o seu modelo suportar, ou Ollama no seu computador pela rede de casa.
3. IA paga (Anthropic, com chave própria): já existe e já vem desligada. Proposta: mantê-la oculta nesta fase.

---

## 7. Etapa 3 — Plano por etapas

Em cada etapa eu entrego: código, testes, um APK no GitHub para você instalar, e um resumo do que mudou e do que não pude testar. Só sigo para a próxima com seu OK.

### Etapa 4 — Segurança e base
- Passar a trabalhar em `greysonbraz/grefinacia`; documentação em `docs/`.
- Chave de assinatura fixa e APK de release no GitHub Actions. Ícone e tela de abertura próprios.
- Corrigir o verificador de proventos para não gastar a cota da brapi.
- CSP, compartilhamento de arquivos restrito ao cache, segredos no cofre do Android.
- Banco local versionado, cópia automática antes de restaurar/importar/migrar, validação completa de backup, garantia de que backups antigos continuam abrindo.
- CI: testes, e2e, auditoria de dependências, varredura de segredos.
- Testes de segurança: criptografia (arquivo adulterado deve falhar), bloqueio de PIN, importação de arquivo malicioso, presença da CSP.
- **Você faz:** cadastrar 4 Secrets da chave no GitHub (passo a passo junto).

### Etapa 5 — Login Google e nuvem
- 5a: login Google opcional, backup automático cifrado na nuvem, restauração em outro aparelho.
- 5b: sincronização por registro entre aparelhos, com fila offline (a alteração mais recente vence).
- RLS, testes de isolamento entre dois usuários, guia de configuração.
- **Você faz:** criar o projeto no Supabase e o cliente OAuth no Google Cloud (ambos gratuitos e sem cartão; passo a passo junto). Eu não crio contas em seu nome.

### Etapa 6 — Controle financeiro
- Categorias personalizadas, transferências entre contas, limite e uso do cartão.
- Contas a pagar e boletos: cadastro manual, leitura da linha digitável, histórico de pagamentos; leitor de código de barras opcional.
- Exportação JSON aberta e CSV de todas as coleções.

### Etapa 7 — Investimentos, cotações e cripto
- Selo de atraso, horário e fonte em toda cotação; contador de cota da brapi.
- Histórico de preços guardado no aparelho; desempenho da carteira comparado a CDI e IPCA (Banco Central).
- Criptomoedas: carteira, preço médio, rentabilidade, variação e histórico.

### Etapa 8 — IA gratuita
- 8a: motor local ampliado — gastos fora do padrão, assinaturas esquecidas, cobranças duplicadas, previsão de caixa de 3 a 12 meses, comparador de empréstimos (CET, Price × SAC, custo total), análise de carteira.
- 8b (experimental): linguagem natural com Gemini Nano e/ou Ollama.

### Etapa 9 — Notícias e importação de extratos
- Leitor de notícias por RSS: título, resumo e link; fontes configuráveis; só texto. Os endereços dos feeds serão validados nesta etapa (não consegui abri-los daqui).
- Importar OFX e CSV: prévia, detecção de duplicados, categorização automática por regras, desfazer importação. PDF conforme viabilidade por banco.
- Estrutura de conectores pronta para Open Finance futuro.
- **Você faz:** enviar 1 extrato de exemplo de cada banco que usa (pode alterar os valores; não vai para o GitHub).

### Etapa 10 — Testes completos
- Suíte completa, revisão final de segurança, roteiro de teste no aparelho para o que só o celular valida (notificações, biometria, login, câmera, IA local) e documentação final das tecnologias.

---

## 8. Decisões que preciso de você

1. **Posso trabalhar no repositório `greysonbraz/grefinacia`** (com permissão de escrita) e aposentar o pacote de ontem?
2. **Nuvem:** Supabase Free (recomendado) ou Firebase Spark?
3. **Criptografia ponta a ponta com senha de sincronização** (recomendado) ou dados legíveis no servidor, protegidos só por RLS?
4. **IA paga da Anthropic** que já existe: manter oculta e desligada (recomendado) ou remover?

E duas informações:
- **Onde estão seus dados reais hoje?** No artifact (navegador), no APK de ontem, no APK do repositório grefinacia, ou em nenhum ainda?
- **Qual é o seu celular?** O README cita um Galaxy S26 Ultra; isso define se a IA no aparelho é viável.

**Faça agora, independente das respostas:** se já digitou dados reais em algum app, abra Ajustes → Backup e outros aparelhos → Fazer backup, e guarde o arquivo `.gfbackup` e a senha.

---

## 9. Limitações deste ambiente

- Não compila nem executa Android. O APK sai pelo GitHub Actions e o teste em aparelho é seu.
- A rede daqui bloqueia os sites dos serviços (Supabase, Firebase, brapi, CoinGecko, portais de notícia). As integrações serão testadas com respostas simuladas, como o projeto original já faz, a menos que você libere esses sites nas configurações do ambiente (gratuito).
- Não crio contas nem aceito termos em seu nome.

---

## 10. Fontes consultadas

- Supabase: [preços](https://supabase.com/pricing) · [pausa de projetos](https://supabase.com/docs/guides/platform/free-project-pausing) · [changelog da restauração](https://supabase.com/changelog/27497-paused-free-plan-projects-are-restorable-for-90-days)
- Firebase: [preços](https://firebase.google.com/pricing) · [limites de autenticação](https://firebase.google.com/docs/auth/limits) · [FAQ](https://firebase.google.com/support/faq)
- Google OAuth: [público do app e modo de teste](https://support.google.com/cloud/answer/15549945?hl=en)
- brapi: [limites do plano gratuito](https://brapi.dev/faq/o-plano-gratuito-tem-limitacoes-importantes) · [limites da API](https://brapi.dev/faq/quais-as-limitacoes) · [atraso por plano](https://brapi.dev/faq/qual-a-diferenca-real-no-atraso-delay-dos-dados-entre-os-planos)
- B3: [política de consumo de market data](https://www.b3.com.br/data/files/66/82/D8/17/973699100A29E189AC094EA8/Politica%20de%20Consumo%20Market%20Data%20B3.pdf)
- Banco Central: [dados abertos do SGS](https://dadosabertos.bcb.gov.br/dataset/27803-sgs/resource/226d3f10-7d05-445d-a2a6-df62b7d48fd5?inner_span=True) · [guia prático no TabNews](https://www.tabnews.com.br/SidneyBissoli/series-do-banco-central-como-consultar-o-sgs-a-focus-e-a-ptax-sem-cair-nas-armadilhas)
- CoinGecko: [preços](https://www.coingecko.com/en/api/pricing.md) · [limites de taxa](https://docs.coingecko.com/docs/common-errors-rate-limit.md)
- Binance: [API de dados públicos](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/public-api-definitions)
- Open Finance: [Meu Pluggy no GitHub](https://github.com/pluggyai/meu-pluggy) · [custo de agregadores, relato no TabNews](https://www.tabnews.com.br/GuilhermeVieira/estou-desenvolvendo-um-app-de-financas-pessoais-e-nao-consigo-pagar-o-open-finance-pluggy-r2-5k-mes-belvo-r6k-mes-tecnospeed-r1-5k-de-entrada-r540) · [quem pode participar](https://dock.tech/fluid/blog/financeiro/open-finance/)
- DDA: [como funciona, Nubank](https://blog.nubank.com.br/dda-o-que-e-como-funciona/) · [APIs comerciais, TecnoSpeed](https://blog.tecnospeed.com.br/api-de-dda/)
- Extratos: [extrato Nubank em PDF, OFX e CSV](https://tecnoblog.net/responde/como-tirar-o-extrato-da-conta-nubank-no-aplicativo/) · [exportar OFX dos principais bancos](https://www.facilite.co/como-exportar-arquivo-ofx-dos-principais-bancos)
- IA no aparelho: [ML Kit GenAI](https://developers.google.com/ml-kit/genai) · [Prompt API](https://developer.android.com/blog/posts/ml-kit-s-prompt-api-unlock-custom-on-device-gemini-nano-experiences)
- Login Google no Capacitor: [plugin social-login](https://github.com/Cap-go/capacitor-social-login) · [configuração Android](https://capgo.app/docs/plugins/social-login/google/android/)
- Notícias: [Agência Brasil, condições de reprodução](https://agenciabrasil.ebc.com.br/sobre)
