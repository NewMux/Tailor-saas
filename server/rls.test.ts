/**
 * Real-Postgres checks on who can reach the data directly (see
 * drizzle/0015_enable_rls.sql and 0018_lock_down_data_api.sql). On Supabase a
 * table without RLS, or one granted to the public API roles, is readable and
 * writable by anyone holding the project's anon key through the Data API, so a
 * migration that forgets either must fail CI. Skipped without DATABASE_URL.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "./db";

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("row-level security and API grants (real Postgres)", () => {
  it("is enabled on every public table", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database connection unavailable");
    const rows = await db.execute<{ tablename: string }>(
      sql`select tablename from pg_tables where schemaname = 'public' and not rowsecurity order by tablename`
    );
    expect(rows.map(row => row.tablename)).toEqual([]);
  });

  it("leaves the public API roles no privileges on any table (when those roles exist)", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database connection unavailable");
    const roles = await db.execute<{ rolname: string }>(sql`select rolname from pg_roles where rolname in ('anon', 'authenticated')`);
    if (roles.length === 0) return; // plain Postgres: nothing to exposed
    const grants = await db.execute<{ grantee: string; table_name: string }>(
      sql`select grantee, table_name from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated') limit 5`
    );
    expect(grants).toEqual([]);
  });

  it("migration 0018 removes grants the Supabase roles start with", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database connection unavailable");
    const migration = readFileSync(path.join(__dirname, "../drizzle/0018_lock_down_data_api.sql"), "utf8").split("--> statement-breakpoint");
    class Rollback extends Error {}
    let granted = -1;
    let remaining = -1;
    await expect(
      db.transaction(async tx => {
        // Stand in for Supabase: the roles exist and hold everything, as they do by default.
        await tx.execute(sql`do $$ begin
          if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
          if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
        end $$`);
        await tx.execute(sql`grant usage on schema public to anon, authenticated`);
        await tx.execute(sql`grant all on all tables in schema public to anon, authenticated`);
        const before = await tx.execute<{ n: number }>(sql`select count(*)::int as n from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated')`);
        granted = before[0]!.n;
        for (const statement of migration) await tx.execute(sql.raw(statement));
        const after = await tx.execute<{ n: number }>(sql`select count(*)::int as n from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated')`);
        remaining = after[0]!.n;
        throw new Rollback();
      })
    ).rejects.toBeInstanceOf(Rollback);
    expect(granted).toBeGreaterThan(0);
    expect(remaining).toBe(0);
  });
});
