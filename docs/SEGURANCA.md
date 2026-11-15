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
| Código da página | Content-Security-Policy: só scripts do próprio app, sem `eval`, conexões só com as fontes de cotação |
| Rede | Só HTTPS; backup automático do Google desligado |
| Arquivos compartilhados | Só a pasta de cache do app |
| Repositório | Varredura de segredos, auditoria de dependências e testes a cada envio |

## Limites conhecidos

- Os dados no aparelho não são cifrados pelo app: a proteção em repouso é a do Android. O PIN é uma trava de tela.
- A CSP depende de um *Android System WebView* atualizado; se estiver antigo, o app mostra uma tela pedindo a atualização.
- O cofre, a CSP no aparelho, notificações e biometria só podem ser validados no celular.

## Custo zero

A IA externa paga está desligada por código (`src/lib/flags.ts`). A verificação de proventos em segundo plano não consulta a brapi no plano gratuito e roda a cada ~6 h.
