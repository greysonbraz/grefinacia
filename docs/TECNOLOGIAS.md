# Tecnologias do Grefinacia

Versão 1.25.0 (novembro de 2026). Regras e fontes de proventos: [INVESTIMENTOS.md](INVESTIMENTOS.md). Tudo gratuito; nenhum serviço pede cartão.

## Aplicativo

| Parte | Tecnologia | Para quê |
|---|---|---|
| Interface | React 19 + TypeScript | Telas e estado do app |
| Empacotamento web | Vite 8 | Compila o código; injeta a política de segurança (CSP) |
| App Android | Capacitor 8 | Transforma o app web em APK e dá acesso a recursos do celular |
| Banco local | IndexedDB (biblioteca `idb`) | Todos os dados ficam no aparelho; estrutura versão 5 |
| Gráficos | Chart.js 4 | Gráficos interativos |
| PDF | jsPDF 4 | Relatórios mensais e anuais |
| Ícones | lucide-react | Ícones da interface |
| Testes | Vitest 5, jsdom, fake-indexeddb, Playwright | Testes automáticos e navegação automática no navegador |

## Recursos do celular (plugins Capacitor)

| Plugin | Uso |
|---|---|
| `@capacitor/local-notifications` | Lembretes de contas, salário e proventos |
| `@capacitor/background-runner` | Verificação de proventos com o app fechado (~6 h) |
| `@aparajita/capacitor-biometric-auth` | Digital e rosto |
| `@aparajita/capacitor-secure-storage` | Cofre do Android (Keystore) para token, sessão e chave da nuvem |
| `@capacitor-community/privacy-screen` | Bloqueia prints e esconde nos apps recentes |
| `@capgo/capacitor-social-login` | Entrar com Google |
| `@capacitor/filesystem`, `@capacitor/share` | Salvar e compartilhar backup, PDF e CSV |
| `GeminiNano` (próprio, `android/app/src/main/java/br/com/grefinacia/app/`) | IA no aparelho pelo ML Kit GenAI (`com.google.mlkit:genai-prompt:1.0.0-beta5`) |

Mínimo: **Android 8** (API 26). Alvo: API 36.

## Serviços externos

| Serviço | Uso | Limite gratuito (conferido em 11/2026) | Onde configurar |
|---|---|---|---|
| Supabase (Free) | Login e cópia cifrada na nuvem | 500 MB; pausa após ~1 semana sem uso | Painel do projeto; SQL em `supabase/migrations/` |
| Google Cloud OAuth | Entrar com Google | Login básico sem custo | Clientes Web e Android |
| brapi.dev (Grátis) | Cotações e histórico B3 | 15.000 consultas/mês, 3 meses de histórico, sem cartão | Token opcional em Ajustes |
| Yahoo Finance | Cotações e proventos (não oficial) | Sem contrato; pode parar | — |
| CoinGecko (pública) | Cripto em reais | Sem chave; limite por minuto por endereço; 365 dias de histórico | — |
| Banco Central (SGS) | CDI e IPCA | Dados abertos; até 10 anos por consulta | — |
| Feeds RSS | Notícias | Sem custo; só título, resumo e link | `src/domain/news.ts` |
| Gemini Nano (no aparelho) | Perguntas livres no chat (opcional) | Sem custo; cota por app do AICore; envia métricas de uso ao Google | Ajustes → Grefinacia AI |
| Meu Pluggy (Pluggy, regulada pelo Banco Central) | Saldos, extratos e cartões dos seus bancos pelo Open Finance | Grátis para uso pessoal, sem prazo; até 5 bancos do mesmo titular; atualiza a cada 24 h; autorização vale 1 ano | meu.pluggy.ai, dashboard.pluggy.ai; chaves em Ajustes → Conexão bancária |
| Binance (dados públicos de mercado) | Preço de cripto ao vivo na aba Cripto | Grátis, sem chave, só leitura; WebSocket aberto só com a aba aberta | nada a configurar |
| ML Kit Text Recognition (Google, no aparelho) | Ler cupom/nota pela câmera | Grátis; modelo embutido no app, sem internet | nada a configurar |
| Reconhecimento de voz do Android (`RecognizerIntent`, pt-BR) | Falar a pergunta para a Grefinacia AI | Grátis; serviço do próprio celular (Google), o app não pede permissão de microfone | nada a configurar |
| GitHub Actions | Gerar o APK assinado | Gratuito para o repositório | Secrets `ANDROID_KEYSTORE_BASE64` e `ANDROID_KEYSTORE_PASSWORD` |

Hosts liberados na CSP: `src/lib/csp.ts` (um teste falha se entrar host novo sem querer).

## Dados

| Coleção | Conteúdo | Sincroniza |
|---|---|---|
| accounts, cards, categories, transactions, recurrences, transfers | Dinheiro do dia a dia | Sim |
| goals, goalMoves, debts | Planejamento | Sim |
| assets, operations, dividends, fixedIncomes, cryptoAssets, cryptoOps | Investimentos | Sim |
| imports | Importações de extrato (para desfazer) | Sim |
| snapshots, firedAlerts, marketHistory | Retratos do patrimônio, controle de avisos, histórico de preços | Não (cada aparelho refaz) |

Configurações (incluindo regras de importação e pares "não é duplicada") sincronizam sem PIN, token nem chaves.
Dinheiro sempre em centavos inteiros; datas como texto `AAAA-MM-DD`.

## Segurança

Detalhes em [SEGURANCA.md](SEGURANCA.md). Resumo: PIN com PBKDF2, cofre do Android, backup AES-256-GCM, nuvem com
criptografia ponta a ponta e RLS, CSP restrita, só HTTPS, banco que só acrescenta estruturas, cópia de segurança antes de
restaurar, importar ou atualizar.

## Comandos

```bash
npm ci
npm test                 # varredura de segredos + 301 testes
npm run test:coverage    # mesmos testes com relatório de cobertura
npm run build            # TypeScript + Vite (com CSP)
PW_ROOT=<pasta do playwright> npm run e2e
npm run android:sync     # gera o projeto Android (o APK sai pelo GitHub Actions)
```
