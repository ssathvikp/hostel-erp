import { afterAll, describe, expect, it } from "vitest";

import { connectToDatabase } from "../support/db";

/**
 * Enforces the rules in docs/database.md against the live schema, so a
 * migration that forgets one fails CI instead of shipping a hole. Each query
 * returns the offending objects; the expected result is always empty.
 */
const sql = connectToDatabase();

afterAll(async () => {
  await sql.end();
});

describe("schema guards", () => {
  it("enables row-level security on every table in public", async () => {
    const offenders = await sql<{ table: string }[]>`
      select c.relname as table
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r', 'p')
        and not c.relrowsecurity
      order by 1`;
    expect(offenders.map((o) => o.table)).toEqual([]);
  });

  it("gives the anon role no table privileges in public", async () => {
    const offenders = await sql<{ grant: string }[]>`
      select table_name || ': ' || privilege_type as grant
      from information_schema.role_table_grants
      where grantee = 'anon' and table_schema = 'public'
      order by 1`;
    expect(offenders.map((o) => o.grant)).toEqual([]);
  });

  it("creates every view in public with security_invoker", async () => {
    const offenders = await sql<{ view: string }[]>`
      select c.relname as view
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('v', 'm')
        and not coalesce(c.reloptions @> array['security_invoker=true'], false)
      order by 1`;
    expect(offenders.map((o) => o.view)).toEqual([]);
  });

  it("keeps SECURITY DEFINER functions out of the exposed public schema", async () => {
    const offenders = await sql<{ fn: string }[]>`
      select p.proname as fn
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
      order by 1`;
    expect(offenders.map((o) => o.fn)).toEqual([]);
  });

  it("pins search_path on every function in public and private", async () => {
    const offenders = await sql<{ fn: string }[]>`
      select n.nspname || '.' || p.proname as fn
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      left join pg_depend d on d.objid = p.oid and d.deptype = 'e'
      where n.nspname in ('public', 'private')
        and d.objid is null
        and not exists (
          select 1 from unnest(coalesce(p.proconfig, '{}')) as cfg
          where cfg like 'search_path=%'
        )
      order by 1`;
    expect(offenders.map((o) => o.fn)).toEqual([]);
  });

  it("does not expose the private schema to anon", async () => {
    const [row] = await sql<{ usable: boolean }[]>`
      select has_schema_privilege('anon', 'private', 'usage') as usable`;
    expect(row?.usable).toBe(false);
  });
});
