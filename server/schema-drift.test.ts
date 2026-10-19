/**
 * Migrations are hand-written SQL, so nothing else guarantees that the
 * database the migrations produce matches drizzle/schema.ts (which the code
 * queries against). Compares table and column names in both directions.
 */
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { is, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "../drizzle/schema";
import { getDb } from "./db";

// Columns from the retired loyalty feature. Unused (they have defaults), kept
// rather than dropped because they may hold data in some environments.
const LEGACY_COLUMNS = new Set([
  "shopSettings.loyaltyEarnRate",
  "shopSettings.loyaltyPointValue",
  "sales.loyaltyPointsRedeemed",
  "sales.loyaltyPointsEarned",
]);

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("schema.ts matches the migrated database (real Postgres)", () => {
  it("has the same tables and columns", async () => {
    const db = (await getDb())!;
    const rows = await db.execute<{ table_name: string; column_name: string }>(
      sql`select table_name, column_name from information_schema.columns where table_schema = 'public'`
    );
    const actual = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!actual.has(row.table_name)) actual.set(row.table_name, new Set());
      actual.get(row.table_name)!.add(row.column_name);
    }

    const declared = new Map<string, Set<string>>();
    for (const value of Object.values(schema)) {
      if (!is(value, PgTable)) continue;
      const config = getTableConfig(value);
      declared.set(config.name, new Set(config.columns.map(column => column.name)));
    }

    const problems: string[] = [];
    for (const [table, columns] of Array.from(declared)) {
      const real = actual.get(table);
      if (!real) {
        problems.push(`table ${table} is in schema.ts but not in the database`);
        continue;
      }
      for (const column of Array.from(columns)) if (!real.has(column)) problems.push(`${table}.${column} is in schema.ts but not in the database`);
      for (const column of Array.from(real)) if (!columns.has(column) && !LEGACY_COLUMNS.has(`${table}.${column}`)) problems.push(`${table}.${column} is in the database but not in schema.ts`);
    }
    for (const table of Array.from(actual.keys())) {
      // Left over from the single-tenant era; unused and dropped by migration 0018.
      if (!declared.has(table) && !["loyaltyAccounts", "loyaltyTransactions"].includes(table)) problems.push(`table ${table} is in the database but not in schema.ts`);
    }
    expect(problems).toEqual([]);
  });
});
