/**
 * Endereço do projeto Supabase, chave PÚBLICA (publishable) e ID público do cliente OAuth Web do Google.
 *
 * Nada aqui é segredo: a chave publishable sozinha não lê nem grava nada, porque as tabelas só aceitam
 * usuário logado e cada linha só é visível ao dono (RLS em supabase/migrations/0001_cofre.sql).
 * A chave secreta do Supabase (sb_secret_... / service_role) e a chave secreta do cliente Google (GOCSPX-...)
 * NUNCA entram neste repositório nem no app.
 */
export const SUPABASE_URL = 'https://slgiagmfbbjifjkapusr.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_aIw0d8JnGoKdrpXsCA7wpA_2KFPvn3I';
export const GOOGLE_WEB_CLIENT_ID = '1097693430093-0ltf7e3un90u25cv3soemr9g1augf1rv.apps.googleusercontent.com';
