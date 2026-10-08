-- Foundation: schemas, extensions, default privileges and shared helpers.
-- Conventions are documented in docs/database.md.

-- ---------------------------------------------------------------------------
-- Private schema
-- ---------------------------------------------------------------------------
-- Holds SECURITY DEFINER helpers and trigger functions. It is deliberately not
-- listed in config.toml [api] schemas, so PostgREST never exposes it.
create schema if not exists private;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- Functions are executable by PUBLIC by default; make every grant explicit.
alter default privileges in schema private revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- Default privileges in public
-- ---------------------------------------------------------------------------
-- Supabase grants anon full table access by default and relies on RLS alone.
-- The MVP has no anonymous data at all, so anon gets nothing: a table that
-- ships without RLS by mistake is still unreadable to signed-out users.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon, public;

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
-- btree_gist powers the exclusion constraints that stop overlapping bed and
-- resident allocations (E6-T3).
create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- Shared trigger: maintain updated_at
-- ---------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function private.set_updated_at() is
  'BEFORE UPDATE trigger that stamps updated_at. Attach to every table with an updated_at column.';
