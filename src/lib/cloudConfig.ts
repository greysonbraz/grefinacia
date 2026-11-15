/**
 * Endereço do projeto Supabase e chave PÚBLICA (publishable).
 *
 * Esta chave é feita para ficar dentro do app: sozinha ela não lê nem grava nada, porque as tabelas
 * só aceitam usuário logado e cada linha só é visível ao dono (RLS em supabase/migrations/0001_cofre.sql).
 * A chave secreta (sb_secret_... / service_role) NUNCA entra neste repositório nem no app.
 */
export const SUPABASE_URL = 'https://slgiagmfbbjifjkapusr.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_aIw0d8JnGoKdrpXsCA7wpA_2KFPvn3I';
