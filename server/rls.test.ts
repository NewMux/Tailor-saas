/**
 * Real-Postgres check that every table in "public" has row-level security
 * enabled (see drizzle/0015_enable_rls.sql). On Supabase a table without RLS
 * is readable and writable by anyone holding the project's anon key through
 * the Data API, so a migration that forgets ENABLE ROW LEVEL SECURITY must
 * fail CI. Skipped automatically when no DATABASE_URL is configured.
 */
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "./db";

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("row-level security (real Postgres)", () => {
  it("is enabled on every public table", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database connection unavailable");
    const rows = await db.execute<{ tablename: string }>(
      sql`select tablename from pg_tables where schemaname = 'public' and not rowsecurity order by tablename`
    );
    expect(rows.map(row => row.tablename)).toEqual([]);
  });
});
