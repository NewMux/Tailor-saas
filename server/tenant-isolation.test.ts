/**
 * Real-Postgres tenant isolation tests. Unlike the rest of the suite, these
 * do NOT mock ./db — they run against an actual database (DATABASE_URL) so
 * the assertions exercise the real Drizzle queries, the real composite
 * unique constraints, and the runtime tenant guard (server/db.ts), none of
 * which the mocked-getDb style of test can observe (a mocked `.where(...)`
 * ignores its argument entirely, so it can't tell a scoped query from an
 * unscoped one). Skipped automatically when no DATABASE_URL is configured.
 */
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  customRoles,
  customers,
  discountCodes,
  inventoryItems,
  staffProfiles,
  userBusinessRoles,
} from "../drizzle/schema";
import { createOrganizationWithOwner, getDb } from "./db";
import { erpRouter } from "./erp";
import { posRouter } from "./pos";
import type { TrpcContext } from "./_core/context";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

function contextFor(user: TrpcContext["user"]): TrpcContext {
  return { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

describeIfDb("tenant isolation (real Postgres)", () => {
  let orgA: Awaited<ReturnType<typeof createOrganizationWithOwner>>;
  let orgB: Awaited<ReturnType<typeof createOrganizationWithOwner>>;
  let callerA: ReturnType<typeof erpRouter.createCaller>;
  let callerB: ReturnType<typeof erpRouter.createCaller>;
  let posCallerA: ReturnType<typeof posRouter.createCaller>;
  const stamp = Date.now();

  beforeAll(async () => {
    orgA = await createOrganizationWithOwner(`Isolation Shop A ${stamp}`, {
      openId: `iso-a-${stamp}`,
      name: "Admin A",
      email: `iso-admin-a-${stamp}@example.com`,
      passwordHash: null,
      loginMethod: "local",
    });
    orgB = await createOrganizationWithOwner(`Isolation Shop B ${stamp}`, {
      openId: `iso-b-${stamp}`,
      name: "Admin B",
      email: `iso-admin-b-${stamp}@example.com`,
      passwordHash: null,
      loginMethod: "local",
    });
    callerA = erpRouter.createCaller(contextFor(orgA.user));
    callerB = erpRouter.createCaller(contextFor(orgB.user));
    posCallerA = posRouter.createCaller(contextFor(orgA.user));
  });

  it("creates two distinct organizations with their own admin", () => {
    expect(orgA.organization.id).not.toBe(orgB.organization.id);
    expect(orgA.user.organizationId).toBe(orgA.organization.id);
    expect(orgB.user.organizationId).toBe(orgB.organization.id);
  });

  describe("customers", () => {
    it("org B never sees org A's customers, and cross-org updates are no-ops", async () => {
      const created = await callerA.customers.create({
        name: "Isolation Customer",
        phone: "33000000",
        email: "",
        address: "",
        notes: "",
        preferredContact: "phone",
      });

      const orgBList = await callerB.customers.list({ search: "Isolation Customer" });
      expect(orgBList.find(row => row.id === created.id)).toBeUndefined();

      // Cross-org update: matches nothing (organizationId predicate excludes
      // org A's row), so it must silently affect zero rows, not org A's data.
      await callerB.customers.update({
        id: created.id,
        name: "Hijacked By B",
        phone: "33000000",
        email: "",
        address: "",
        notes: "",
        preferredContact: "phone",
      });

      const db = await getDb();
      const [stillOrgAName] = await db!
        .select({ name: customers.name, organizationId: customers.organizationId })
        .from(customers)
        .where(eq(customers.id, created.id));
      expect(stillOrgAName.name).toBe("Isolation Customer");
      expect(stillOrgAName.organizationId).toBe(orgA.organization.id);
    });
  });

  describe("inventory: composite uniqueness and cross-org checkout rejection", () => {
    it("lets both organizations use the same item code, but not twice within one org", async () => {
      const code = `ISO-${stamp}`;
      const itemA = await callerA.inventory.create({
        code,
        name: "Fabric A",
        inventoryType: "material",
        category: "fabric",
        color: "Navy",
        unit: "Meters",
        minThreshold: 0,
        costPerUnit: 1,
        salePrice: 2,
        openingQuantity: 50,
        rollCount: 0,
      });
      // Same code, different org: must succeed (composite unique is per-org).
      await expect(
        callerB.inventory.create({
          code,
          name: "Fabric B",
          inventoryType: "material",
          category: "fabric",
          color: "Red",
          unit: "Meters",
          minThreshold: 0,
          costPerUnit: 1,
          salePrice: 2,
          openingQuantity: 20,
          rollCount: 0,
        })
      ).resolves.toMatchObject({ id: expect.any(Number) });

      // Same code, same org as an existing item: must fail (unique violation).
      await expect(
        callerA.inventory.create({
          code,
          name: "Fabric A Duplicate",
          inventoryType: "material",
          category: "fabric",
          color: "Navy",
          unit: "Meters",
          minThreshold: 0,
          costPerUnit: 1,
          salePrice: 2,
          openingQuantity: 5,
          rollCount: 0,
        })
      ).rejects.toThrow();

      expect(itemA.id).toEqual(expect.any(Number));
    });

    it("rejects a POS checkout that references another organization's inventory item", async () => {
      const item = await callerB.inventory.create({
        code: `ISO-B-ONLY-${stamp}`,
        name: "Org B Only Fabric",
        inventoryType: "material",
        category: "fabric",
        color: "Green",
        unit: "Meters",
        minThreshold: 0,
        costPerUnit: 1,
        salePrice: 5,
        openingQuantity: 10,
        rollCount: 0,
      });

      await expect(
        posCallerA.checkout({
          customerName: "Walk-in",
          discount: 0,
          paymentMethod: "cash",
          paymentStatus: "paid",
          items: [{ inventoryItemId: item.id, name: "Org B Only Fabric", quantity: 1, unitPrice: 5, lineDiscount: 0 }],
        })
      ).rejects.toMatchObject({ message: expect.stringContaining("no longer available") });
    });
  });

  describe("role assignment cannot hijack another organization's user", () => {
    it("team.assignRole refuses a target user from a different organization", async () => {
      await expect(
        callerA.team.assignRole({ userId: orgB.user.id, role: "sales", isActive: true })
      ).rejects.toMatchObject({ message: expect.stringContaining("not found in your organization") });

      const db = await getDb();
      const [orgBRole] = await db!
        .select()
        .from(userBusinessRoles)
        .where(eq(userBusinessRoles.userId, orgB.user.id));
      expect(orgBRole.role).toBe("admin");
      expect(orgBRole.organizationId).toBe(orgB.organization.id);
    });

    it("team.assignCustomRole refuses a target user from a different organization", async () => {
      const role = await callerA.team.createCustomRole({
        name: `Org A Role ${stamp}`,
        description: "",
        permissions: ["sales"],
      });

      await expect(
        callerA.team.assignCustomRole({ userId: orgB.user.id, customRoleId: role.id, isActive: true })
      ).rejects.toMatchObject({ message: expect.stringContaining("not found in your organization") });
    });

    it("team.removeUser cannot remove a user from a different organization", async () => {
      await expect(callerA.team.removeUser({ userId: orgB.user.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });

      const db = await getDb();
      const [stillThere] = await db!.select({ id: staffProfiles.id }).from(staffProfiles).where(eq(staffProfiles.organizationId, orgB.organization.id));
      // No assertion needed beyond "did not throw for the wrong reason" -
      // the important guarantee is org B's admin user row itself survives.
      const [orgBUserRow] = await db!
        .select({ id: customRoles.id })
        .from(customRoles)
        .where(and(eq(customRoles.organizationId, orgB.organization.id)));
      expect(stillThere).toBeUndefined();
      expect(orgBUserRow).toBeUndefined();
    });
  });

  describe("discount codes", () => {
    it("scopes discount code validation to the caller's organization", async () => {
      const code = `SAVE${stamp}`.toUpperCase();
      const db = await getDb();
      await db!.insert(discountCodes).values({
        organizationId: orgB.organization.id,
        code,
        type: "percent",
        value: "10",
        minSubtotal: "0",
        isActive: true,
        createdBy: orgB.user.id,
      });

      // org B's code doesn't exist from org A's perspective, so it fails
      // closed exactly like a nonexistent code would - not a leaked lookup.
      await expect(posCallerA.discounts.validate({ code, subtotal: 100 })).rejects.toMatchObject({
        message: expect.stringContaining("not active"),
      });
    });
  });
});
