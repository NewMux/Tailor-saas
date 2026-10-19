import { TRPCError } from "@trpc/server";
import { and, eq, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { getDb } from "../db";

/**
 * Every read/write against a tenant table must include this predicate.
 * Centralizing it here (instead of writing `eq(table.organizationId, ...)`
 * inline at each of the ~250 call sites in erp/pos routers) makes it
 * mechanically obvious, at review time, which call sites are scoped.
 */
export function orgScope<T extends { organizationId: AnyPgColumn }>(
  table: T,
  organizationId: number
): SQL {
  return eq(table.organizationId, organizationId);
}

/** Was defined identically in both erp.ts and pos.ts before their split into server/erp/ and server/pos/; the one real exact duplication between them. */
export async function dbOrThrow() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database is unavailable.",
    });
  return db;
}

/**
 * Verifies that a record id supplied by the client belongs to the caller's
 * organization before it is stored as a reference (a customer on a sale, an
 * inventory item on a service, ...). Without this a tenant could point its
 * own rows at another tenant's records. A missing id is not checked.
 */
export async function assertOwned<
  T extends PgTable & { id: AnyPgColumn; organizationId: AnyPgColumn },
>(table: T, recordId: number | null | undefined, organizationId: number, label: string) {
  if (recordId === undefined || recordId === null) return;
  const db = await dbOrThrow();
  const rows = await db
    .select({ id: table.id })
    .from(table as PgTable)
    .where(and(eq(table.id, recordId), orgScope(table, organizationId)))
    .limit(1);
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: `${label} not found.` });
}
