# Segurança do Grefinacia

## Como instalar e atualizar sem perder dados

O Android só instala uma versão por cima de outra se as duas tiverem a **mesma assinatura**.
Por isso o APK oficial é assinado com uma chave fixa, guardada nos *Secrets* do GitHub.

**Cadastro da chave (uma vez):** em GitHub → repositório → *Settings → Secrets and variables → Actions → New repository secret*, crie:

| Nome | Valor |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | o arquivo da chave (`.jks`) convertido em base64 |
| `ANDROID_KEYSTORE_PASSWORD` | a senha da chave |

Para gerar uma chave: `keytool -genkeypair -keystore grefinacia.jks -alias grefinacia -keyalg RSA -keysize 2048 -validity 10000` e depois `base64 -w0 grefinacia.jks`.
Guarde o arquivo e a senha fora do GitHub (ex.: no seu Google Drive). **Se perder a chave**, a próxima versão não instala por cima: será preciso fazer backup, desinstalar, instalar e restaurar.

Com os Secrets cadastrados, o fluxo *Gerar APK* publica o artefato `grefinacia-apk`. Sem eles, publica `grefinacia-apk-TESTE-sem-assinatura-fixa`, que serve só para teste.

**Antes de qualquer atualização:** Ajustes → Backup e outros aparelhos → Fazer backup.

## O que protege os dados

| Proteção | Como |
|---|---|
| Bloqueio do app | PIN guardado só como hash (PBKDF2-SHA256, 210 mil iterações), biometria, bloqueio automático, espera crescente após 5 erros |
| Tela | Impede prints e esconde o conteúdo nos apps recentes |
| Tokens e chaves | Ficam no cofre do sistema (Android Keystore), fora do banco do app |
| Backup em arquivo | AES-256-GCM; qualquer alteração no arquivo faz a abertura falhar |
| Restauração | A estrutura do arquivo é conferida antes de gravar; o app guarda as 3 últimas cópias automáticas para desfazer |
| Atualização do banco | Versões novas só acrescentam estruturas, nunca apagam; uma cópia é guardada na primeira abertura |
| Código da página | Content-Security-Policy: só scripts do próprio app, sem `eval`, conexões só com os sites listados em `src/lib/csp.ts` |
| Nuvem | Criptografia ponta a ponta (a chave fica no aparelho) e RLS: cada linha só é lida pelo dono; sem login, nada |
| Conexão bancária (Meu Pluggy) | Só leitura. Client ID e Client Secret no cofre do Android, fora da nuvem, do backup e das cópias; a API key da Pluggy (2 h) só em memória. A Pluggy recomenda guardar o Secret em servidor: como o app é de um usuário só e lê só os dados dele, o cofre do aparelho é a alternativa sem custo. A varredura de segredos reconhece `pluggy_sk_…`. A autorização pode ser revogada no app do banco ou no Meu Pluggy |
| Importação de extrato | Arquivo lido só no aparelho, limite de 5 MB, cópia de segurança antes de importar e de desfazer |
| IA no aparelho | Gemini Nano desligado por padrão; o texto não sai do celular; o app avisa das métricas de uso que o ML Kit envia ao Google |
| Rede | Só HTTPS; backup automático do Google desligado |
| Arquivos compartilhados | Só a pasta de cache do app |
| Repositório | Varredura de segredos, auditoria de dependências e testes a cada envio |

## Revisão de segurança (Etapa 10, 16/11/2026)

| Item | Resultado |
|---|---|
| Dependências (`npm audit`) | 0 vulnerabilidades |
| Código perigoso (`innerHTML`, `eval`, `new Function`) | Nenhum uso |
| Links de notícias | Só `https`; `javascript:` e `data:` recusados |
| Tela de bloqueio | Com o app bloqueado só o PIN é montado; os dados não ficam na tela |
| Manifesto Android | Backup do Google desligado, sem HTTP, compartilhamento de arquivos não exposto; só a tela inicial é visível para outros apps |
| Regras da nuvem (SQL) | RLS ligado e obrigatório; visitante sem login sem acesso; limites de tamanho; nomes das coleções novas aceitos |
| Contador de erros do PIN | **Corrigido:** registro corrompido zerava a espera; agora conta como 5 erros |
| Exclusão na nuvem | **Reforçado:** identificador do usuário codificado no endereço |
| GitHub Actions | **Atualizado:** ações em Node 24 (o Node 20 está sendo desativado); permissões mínimas |
| Testes novos | PIN (hash, sal, limite de tentativas), cliente da nuvem (chaves, erros, sessão, lotes, codificação), todas as perguntas sugeridas do chat |

## Limites conhecidos

- Os dados no aparelho não são cifrados pelo app: a proteção em repouso é a do Android. O PIN é uma trava de tela.
- A CSP depende de um *Android System WebView* atualizado; se estiver antigo, o app mostra uma tela pedindo a atualização.
- O cofre, a CSP no aparelho, notificações e biometria só podem ser validados no celular ([roteiro](ROTEIRO-TESTE.md)).
- Quem tem acesso ao celular desbloqueado e com root pode mudar o relógio para pular a espera do PIN: o PIN é uma trava de tela, não criptografia.
- O Gemini Nano é beta do Google e pode errar; as contas exatas continuam com as regras do app.

## Custo zero

A IA externa paga está desligada por código (`src/lib/flags.ts`). A verificação de proventos em segundo plano não consulta a brapi no plano gratuito e roda a cada ~6 h.

## Auditoria de dependências (17/11/2026)

- Dependências do app (o que vai no APK): `npm audit --omit=dev --audit-level=high` bloqueia o build em qualquer alerta alto ou crítico.
- Ferramentas de build e teste (Vite, Vitest e plugins): `scripts/audit-tools.mjs` bloqueia quando já existe versão corrigida publicada; sem correção, só avisa no log.
- Motivo: alerta GHSA-fc5q-39xc-vjpf (ReDoS no `picomatch` ≤ 4.0.7, usado só pelas ferramentas de build) sem versão corrigida travava todos os APKs. Autorizado pelo dono em 17/11/2026. Quando sair a correção, o build volta a bloquear até atualizar.

