/**
 * Foreign ids on create paths: a tenant must not be able to point its own
 * records at another tenant's customer, item, service, session or staff
 * member, and must never read another tenant's data through such a link.
 */
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { inventoryItems, services, staffDocuments } from "../drizzle/schema";
import { createOrganizationWithOwner, getDb } from "./db";
import { erpRouter } from "./erp";
import { posRouter } from "./pos";
import type { TrpcContext } from "./_core/context";

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const contextFor = (user: TrpcContext["user"]): TrpcContext => ({ user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] });

describeIfDb("tenant references (real Postgres)", () => {
  const stamp = Date.now();
  let a: ReturnType<typeof erpRouter.createCaller>;
  let b: ReturnType<typeof erpRouter.createCaller>;
  let posA: ReturnType<typeof posRouter.createCaller>;
  let orgAId: number;
  let bItemId: number;
  let aItemId: number;
  let bCustomerId: number;
  let bStaffId: number;
  let bSessionId: number;
  let bServiceId: number;
  let bDocumentId: number;

  beforeAll(async () => {
    const mk = (tag: string) => createOrganizationWithOwner(`Ref Shop ${tag} ${stamp}`, { openId: `ref-${tag}-${stamp}`, name: `Admin ${tag}`, email: `ref-${tag}-${stamp}@example.com`, passwordHash: null, loginMethod: "local" });
    const orgA = await mk("a");
    const orgB = await mk("b");
    orgAId = orgA.organization.id;
    a = erpRouter.createCaller(contextFor(orgA.user));
    b = erpRouter.createCaller(contextFor(orgB.user));
    posA = posRouter.createCaller(contextFor(orgA.user));
    const posB = posRouter.createCaller(contextFor(orgB.user));

    bItemId = (await b.inventory.create({ code: `REF-${stamp}`, name: "B Secret Fabric", inventoryType: "material", category: "fabric", color: "Red", unit: "Meters", minThreshold: 0, costPerUnit: 1, salePrice: 2, openingQuantity: 77, rollCount: 0 })).id;
    bCustomerId = (await b.customers.create({ name: "B Customer", phone: "33000001", email: "", address: "", notes: "", preferredContact: "phone" })).id;
    bStaffId = (await b.staff.create({ name: "B Tailor", phone: "1", jobTitle: "Tailor", baseSalary: 100, commissionRate: 0 })).id;
    bSessionId = ((await posB.session.open({ openingCash: 0 })) as { id: number }).id;
    bServiceId = (await b.services.create({ sku: `S-${stamp}`, name: "B Service", category: "tailoring", description: "", unitPrice: 10 })).id;
    const db = (await getDb())!;
    const [doc] = await db.insert(staffDocuments).values({ organizationId: orgB.organization.id, staffProfileId: bStaffId, label: "x", fileName: "x.pdf", contentType: "application/pdf", storageKey: `org/b/${stamp}`, storageUrl: "/x", uploadedBy: orgB.user.id }).returning();
    bDocumentId = doc!.id;
    aItemId = (await a.inventory.create({ code: `REFA-${stamp}`, name: "A Fabric", inventoryType: "material", category: "fabric", color: "Blue", unit: "Meters", minThreshold: 0, costPerUnit: 1, salePrice: 2, openingQuantity: 5, rollCount: 0 })).id;
    await a.staff.create({ name: "A Tailor", phone: "1", jobTitle: "Tailor", baseSalary: 100, commissionRate: 0 });
  });

  const rejected = (promise: Promise<unknown>) => expect(promise).rejects.toMatchObject({ code: expect.stringMatching(/NOT_FOUND|BAD_REQUEST|FORBIDDEN/) });

  it("services.create refuses another tenant's inventory item", async () => {
    await rejected(a.services.create({ sku: `X-${stamp}`, name: "Leak", category: "fabric", description: "", unitPrice: 1, inventoryItemId: bItemId }));
  });

  it("services.list and the POS catalog never expose a poisoned cross-tenant link", async () => {
    const db = (await getDb())!;
    await db.insert(services).values({ organizationId: orgAId, sku: `P-${stamp}`, name: "Poisoned", category: "fabric", unitPrice: "1.000", inventoryItemId: bItemId });
    const list = await a.services.list();
    const poisoned = list.find(row => row.name === "Poisoned");
    expect(poisoned?.inventory ?? null).toBeNull();
    const catalog = await posA.catalog.list();
    expect(JSON.stringify(catalog)).not.toContain("B Secret Fabric");
    // sanity: the item itself exists in org B
    const [row] = await db.select().from(inventoryItems).where(and(eq(inventoryItems.id, bItemId)));
    expect(row?.name).toBe("B Secret Fabric");
  });

  it("measurements cannot be attached to another tenant's customer", async () => {
    await rejected(a.customers.addMeasurement({ customerId: bCustomerId, measurements: {}, fitPreference: "", collarStyle: "", pocketStyle: "", notes: "", effectiveDate: new Date().toISOString() }));
  });

  it("manual sales refuse another tenant's customer and service", async () => {
    const base = { customerName: "X", discount: 0, paymentMethod: "cash" as const, paymentStatus: "paid" as const };
    await rejected(a.sales.create({ ...base, customerId: bCustomerId, items: [{ name: "i", quantity: 1, unitPrice: 1 }] }));
    await rejected(a.sales.create({ ...base, items: [{ serviceId: bServiceId, name: "i", quantity: 1, unitPrice: 1 }] }));
  });

  it("held POS orders refuse another tenant's session and customer", async () => {
    const item = { inventoryItemId: aItemId, name: "i", quantity: 1, unitPrice: 1, lineDiscount: 0 };
    await rejected(posA.orders.hold({ sessionId: bSessionId, items: [item] }));
    const own = ((await posA.session.open({ openingCash: 0 })) as { id: number }).id;
    await rejected(posA.orders.hold({ sessionId: own, customerId: bCustomerId, items: [item] }));
  });

  it("performance and attendance refuse another tenant's staff profile and document", async () => {
    await rejected(a.staff.addPerformance({ staffProfileId: bStaffId, workDate: "2026-10-01", metric: "m", units: 1, commissionEarned: 0, notes: "" }));
    const [ownProfile] = await a.staff.list();
    await rejected(a.staff.recordAttendance({ staffProfileId: ownProfile!.id, workDate: "2026-10-01", status: "absent", absenceReason: "sick", absenceDocumentId: bDocumentId, notes: "" }));
  });
});
