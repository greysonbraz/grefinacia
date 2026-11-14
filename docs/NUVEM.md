# Nuvem do Grefinacia (Etapa 5) — login Google e Supabase

Estado: **base pronta, ainda não ligada ao app.** Faltam o projeto Supabase, o login Google e as telas.

## Como os dados ficam protegidos

- O aparelho continua sendo a fonte da verdade; o app funciona sem login e sem internet.
- Antes de subir, cada registro é cifrado no aparelho com AES-256-GCM (`src/services/vault.ts`).
- A chave fica na nuvem embrulhada pela sua **senha de sincronização**. O Supabase só vê texto cifrado.
- Se você esquecer essa senha, a cópia da nuvem não abre. Os dados do aparelho continuam intactos.
- No servidor, cada linha só é acessível ao dono (RLS em `supabase/migrations/0001_cofre.sql`).

## O que você precisa criar (grátis, sem cartão)

1. **Projeto no Supabase** (plano Free): anote a *Project URL* e a chave *publishable/anon*. Nunca copie a `service_role`.
2. **SQL:** no painel, *SQL Editor* → cole o conteúdo de `supabase/migrations/0001_cofre.sql` → *Run*.
3. **Login Google:** no Google Cloud, crie um cliente OAuth do tipo *Web* e um do tipo *Android*
   (pacote `br.com.grefinacia.app` + a impressão digital SHA-1 da chave de assinatura, que aparece no resumo do build *Gerar APK*).
   No Supabase, em *Authentication → Providers → Google*, informe o ID e o segredo do cliente Web.

O segredo do cliente Web e a `service_role` ficam só nos painéis. No app e no GitHub entram apenas a URL do projeto, a chave pública e o ID do cliente Web.

## Limites do plano gratuito (reconfirmar na página oficial antes de usar)

500 MB de banco, 5 GB de saída por mês, 50 mil usuários ativos, 2 projetos. O projeto pausa após cerca de uma semana sem uso e é reativado pelo painel.
