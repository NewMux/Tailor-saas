import { TRPCError } from "@trpc/server";
import { eq, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
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
