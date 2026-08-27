import { eq, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * Every read/write against a tenant table must include this predicate.
 * Centralizing it here (instead of writing `eq(table.organizationId, ...)`
 * inline at each of the ~250 call sites in erp.ts/pos.ts) makes it
 * mechanically obvious, at review time, which call sites are scoped.
 */
export function orgScope<T extends { organizationId: AnyPgColumn }>(table: T, organizationId: number): SQL {
  return eq(table.organizationId, organizationId);
}
