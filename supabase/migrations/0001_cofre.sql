-- Grefinacia — cofre na nuvem (Supabase / Postgres)
--
-- O servidor guarda apenas texto cifrado: os dados são criptografados no aparelho (ver src/services/vault.ts).
-- Mesmo assim, cada linha só pode ser lida e alterada pelo próprio dono (RLS).
-- Seguro para rodar mais de uma vez.

create table if not exists public.vault_meta (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  meta jsonb not null,
  updated_at timestamptz not null default now(),
  constraint vault_meta_size check (pg_column_size(meta) < 4096)
);

create table if not exists public.vault_records (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  collection text not null,
  id text not null,
  iv text not null,
  payload text not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, collection, id),
  constraint vault_records_collection check (collection ~ '^[a-zA-Z]{1,40}$'),
  constraint vault_records_id check (char_length(id) between 1 and 200),
  constraint vault_records_iv check (char_length(iv) between 16 and 24),
  -- limite por registro: protege a cota gratuita (500 MB) contra um app com defeito
  constraint vault_records_payload check (char_length(payload) <= 262144)
);

create index if not exists vault_records_changes on public.vault_records (user_id, updated_at);

-- A data de alteração é sempre a do servidor (o relógio do aparelho não decide quem é mais novo).
create or replace function public.vault_touch() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists vault_meta_touch on public.vault_meta;
create trigger vault_meta_touch before insert or update on public.vault_meta for each row execute function public.vault_touch();
drop trigger if exists vault_records_touch on public.vault_records;
create trigger vault_records_touch before insert or update on public.vault_records for each row execute function public.vault_touch();

-- Controle de acesso: RLS ligado e obrigatório; sem política, ninguém acessa.
alter table public.vault_meta enable row level security;
alter table public.vault_meta force row level security;
alter table public.vault_records enable row level security;
alter table public.vault_records force row level security;

drop policy if exists vault_meta_dono on public.vault_meta;
create policy vault_meta_dono on public.vault_meta for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists vault_records_dono on public.vault_records;
create policy vault_records_dono on public.vault_records for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Permissões explícitas: visitante sem login (anon) não toca em nada.
revoke all on public.vault_meta, public.vault_records from anon, public;
grant select, insert, update, delete on public.vault_meta, public.vault_records to authenticated;
