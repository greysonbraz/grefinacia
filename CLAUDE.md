# Grefinacia — instruções para o Claude

App Android de finanças pessoais e investimentos (B3). React 19 + TypeScript + Vite + Capacitor 8.
Os dados ficam no aparelho (IndexedDB); login Google e nuvem (Supabase) são opcionais e cifrados no aparelho.

## Antes de começar
1. Leia `docs/PROGRESSO.md` (estado, o que falta, próximo passo).
2. Se o repositório `greysonbraz/claude-brain` estiver na sessão, leia lá
   `CLAUDE BRAIN/02 - PROJETOS/GREFINACIA/NEXT_SESSION.md` e `CURRENT_STATE.md`.
3. Confira o código real (`git log`, `npm test`): a documentação pode estar atrasada.

## Regras do dono do projeto
- **Custo zero:** nada pago, sem cartão, sem teste grátis que vire cobrança. Reconfirmar limites antes de usar um serviço.
- **Uma etapa por vez**, com autorização antes de avançar. Não fazer merge, commit de checkpoint ou deploy sem ele pedir.
- **Nunca perder dados:** mudanças no banco local só acrescentam; cópia de segurança antes de substituir dados.
- **Não mudar o `appId`** `br.com.grefinacia.app` (criaria outro app, sem os dados).
- **Segredos fora do repositório:** só a URL e a chave publishable do Supabase e o ID do cliente OAuth Web podem estar no código.
  Chave secreta do Supabase, segredo do cliente Google e a chave de assinatura ficam nos painéis / Secrets do GitHub.
- Falar em português simples; dar passo a passo com link direto. Painéis traduzidos pelo navegador mudam os nomes dos campos.

## Comandos
```bash
npm ci
npm test            # varredura de segredos + testes (Vitest)
npm run build       # tsc + vite (com CSP)
PW_ROOT=<pasta do playwright> npm run e2e   # navegação automática no navegador
npm run android:sync
```
Este ambiente de nuvem não compila Android: o APK sai pelo GitHub Actions (`.github/workflows/build-apk.yml`),
em todo push para `main` e para branches `claude/**`. Com os Secrets da chave, sai o artefato `grefinacia-apk`.

## Onde está cada coisa
| Pasta | Conteúdo |
|---|---|
| `src/lib` | dinheiro em centavos, datas, tipos, padrões, CSP, configuração pública da nuvem, flags |
| `src/domain` | regras puras e testadas (lançamentos, carteira, dividendos, dívidas, boleto, notícias) |
| `src/services` | cotações, notificações, segurança, backup, cofre de segredos, nuvem, sincronização |
| `src/db` | IndexedDB (estrutura v3) e cópias de segurança automáticas |
| `src/state` | estado do app (`store.ts`) e ações da nuvem (`cloud.ts`) |
| `src/ui` | telas |
| `supabase/migrations` | SQL das tabelas da nuvem (RLS) |
| `docs` | PROGRESSO, PLANEJAMENTO, SEGURANCA, NUVEM |

## Cuidados técnicos
- Host externo novo precisa entrar em `src/lib/csp.ts` (há teste que cobra).
- Coleção nova: `types.ts`, `defaults.ts` (DATA_KEYS), subir `DB_VERSION`, `SYNCED` em `services/sync.ts` e `DATA_SCHEMA` em `services/validate.ts`.
- Mudanças feitas pelo app passam por `upsert`/`remove`/`updateSettings` do store (marcam pendência de sincronização).
  O que vem da nuvem entra por `applyRemote` (não marca).
- A IA paga fica desligada em `src/lib/flags.ts`; há teste que impede religar sem querer.
