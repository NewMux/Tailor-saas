/** Salaries and unit costs are visible only to the roles that manage them. */
import { beforeAll, describe, expect, it } from "vitest";
import { userBusinessRoles, users } from "../drizzle/schema";
import { createOrganizationWithOwner, getDb } from "./db";
import { erpRouter } from "./erp";
import type { TrpcContext } from "./_core/context";

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const contextFor = (user: TrpcContext["user"]): TrpcContext => ({ user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] });

describeIfDb("field-level privacy (real Postgres)", () => {
  const stamp = Date.now();
  let admin: ReturnType<typeof erpRouter.createCaller>;
  let cashier: ReturnType<typeof erpRouter.createCaller>;

  beforeAll(async () => {
    const org = await createOrganizationWithOwner(`Privacy Shop ${stamp}`, { openId: `pv-${stamp}`, name: "Owner", email: `pv-${stamp}@example.com`, passwordHash: null, loginMethod: "local" });
    const db = (await getDb())!;
    const [clerk] = await db.insert(users).values({ openId: `pvc-${stamp}`, name: "Cashier", email: `pvc-${stamp}@example.com`, loginMethod: "local", role: "user", organizationId: org.organization.id }).returning();
    await db.insert(userBusinessRoles).values({ userId: clerk!.id, organizationId: org.organization.id, role: "sales", isActive: true });
    admin = erpRouter.createCaller(contextFor(org.user));
    cashier = erpRouter.createCaller(contextFor(clerk!));
    await admin.staff.create({ name: "Tailor Tom", phone: "123", jobTitle: "Tailor", baseSalary: 900, commissionRate: 5 });
    await admin.inventory.create({ code: `PV-${stamp}`, name: "Cloth", inventoryType: "material", category: "fabric", color: "Red", unit: "Meters", minThreshold: 0, costPerUnit: 7, salePrice: 12, openingQuantity: 10, rollCount: 0 });
  });

  it("shows salary and commission to admins", async () => {
    const [row] = await admin.staff.list();
    expect(row).toMatchObject({ name: "Tailor Tom", baseSalary: "900.000" });
    expect(row).toHaveProperty("commissionRate");
  });

  it("gives a cashier the directory only", async () => {
    const rows = await cashier.staff.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Tailor Tom", jobTitle: "Tailor", phone: "123" });
    expect(rows[0]).not.toHaveProperty("baseSalary");
    expect(rows[0]).not.toHaveProperty("commissionRate");
  });

  it("hides unit cost from a cashier but not from an admin", async () => {
    expect((await admin.inventory.list())[0]).toHaveProperty("costPerUnit", "7.000");
    const [row] = await cashier.inventory.list();
    expect(row).toMatchObject({ name: "Cloth", salePrice: "12.000" });
    expect(row).not.toHaveProperty("costPerUnit");
  });
});
