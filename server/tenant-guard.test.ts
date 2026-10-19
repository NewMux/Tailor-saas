/** The tenant guard must catch the kind of query that caused the services/inventory leak. */
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { customers, inventoryItems, services } from "../drizzle/schema";
import { getDb } from "./db";
import { requestContext } from "./_core/requestContext";

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
// Queries are lazy: they must be awaited inside the scope to run in it.
const inTenantRequest = <T>(fn: () => PromiseLike<T>) => requestContext.run({ impersonatedBy: null, tenantScope: true }, async () => await fn());

describeIfDb("tenant guard (real Postgres)", () => {
  it("rejects the join that leaked another shop's inventory", async () => {
    const db = (await getDb())!;
    await expect(
      inTenantRequest(() =>
        db
          .select({ service: services, inventory: inventoryItems })
          .from(services)
          .leftJoin(inventoryItems, eq(services.inventoryItemId, inventoryItems.id))
          .where(and(eq(services.organizationId, 1), eq(services.isActive, true)))
      )
    ).rejects.toThrow(/inventoryItems.*not constrained/);
  });

  it("accepts the same join once the joined table is scoped", async () => {
    const db = (await getDb())!;
    await expect(
      inTenantRequest(() =>
        db
          .select({ service: services, inventory: inventoryItems })
          .from(services)
          .leftJoin(inventoryItems, and(eq(services.inventoryItemId, inventoryItems.id), eq(inventoryItems.organizationId, services.organizationId)))
          .where(and(eq(services.organizationId, 1), eq(services.isActive, true)))
      )
    ).resolves.toBeInstanceOf(Array);
  });

  it("rejects updates and deletes that are not scoped to the organization", async () => {
    const db = (await getDb())!;
    await expect(inTenantRequest(() => db.update(customers).set({ notes: "x" }).where(eq(customers.id, 1)))).rejects.toThrow(/TenantGuard/);
    await expect(inTenantRequest(() => db.delete(customers).where(eq(customers.id, 1)))).rejects.toThrow(/TenantGuard/);
  });

  it("rejects inserts that do not set the organization", async () => {
    const db = (await getDb())!;
    await expect(inTenantRequest(() => db.insert(customers).values({ name: "x", phone: "1" } as never))).rejects.toThrow();
  });

  it("leaves queries outside a tenant request alone (setup, platform tools, scripts)", async () => {
    const db = (await getDb())!;
    await expect(db.select().from(customers).where(and(eq(customers.id, 1), eq(customers.organizationId, 1)))).resolves.toBeInstanceOf(Array);
  });
});
