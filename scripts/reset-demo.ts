/**
 * Wipes and reseeds the internal sales-demo organization's business data.
 *
 * Never touches organizations/users/userBusinessRoles/shopSettings — the demo
 * org, its owner login, and its branding are created exactly once, manually,
 * through the app's normal "Create your shop" sign-up (see DEMO.md). This
 * script only clears and rebuilds the business-data tables so the demo never
 * accumulates junk from repeated click-throughs, while login credentials and
 * branding stay stable across every run.
 *
 * Reseeding goes entirely through the app's own tRPC procedures (not raw
 * inserts) so composite-unique sequence numbers, stock decrements, and audit
 * trail rows are generated exactly as they would be for a real user.
 *
 * Usage: DATABASE_URL=... DEMO_OWNER_EMAIL=demo@example.com pnpm demo:reset
 */
import { eq } from "drizzle-orm";
import {
  attendance,
  auditLogs,
  customRoles,
  customerBalanceDeliveries,
  customers,
  discountCodes,
  inventoryItems,
  invoiceDeliveries,
  invoicePayments,
  invoices,
  measurementProfiles,
  organizations,
  performanceRecords,
  posOrders,
  posPayments,
  posSessions,
  saleItems,
  sales,
  salaryPayouts,
  services,
  staffAccessInvites,
  staffDocuments,
  staffProfiles,
  stockMovements,
  tailoringOrders,
  userCustomRoles,
} from "../drizzle/schema";
import { getDb, getUserByEmail } from "../server/db";
import { erpRouter } from "../server/erp";
import { posRouter } from "../server/pos";
import type { TrpcContext } from "../server/_core/context";

const DATABASE_URL = process.env.DATABASE_URL;
const DEMO_OWNER_EMAIL = process.env.DEMO_OWNER_EMAIL;
const DEMO_ORG_SLUG = process.env.DEMO_ORG_SLUG;

if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!DEMO_OWNER_EMAIL) throw new Error("DEMO_OWNER_EMAIL is required");

function contextFor(user: TrpcContext["user"]): TrpcContext {
  return { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

// Child-before-parent order so the wipe never trips a foreign-key error.
const WIPE_ORDER = [
  auditLogs,
  staffDocuments,
  attendance,
  performanceRecords,
  salaryPayouts,
  stockMovements,
  saleItems,
  posPayments,
  invoicePayments,
  invoiceDeliveries,
  customerBalanceDeliveries,
  tailoringOrders,
  invoices,
  posOrders,
  userCustomRoles,
  staffAccessInvites,
  sales,
  measurementProfiles,
  staffProfiles,
  services,
  customRoles,
  posSessions,
  discountCodes,
  customers,
  inventoryItems,
] as const;

async function step<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    console.error(`Demo reset failed during: ${label}`);
    throw err;
  }
}

async function main() {
  const startedAt = Date.now();
  const db = await getDb();
  if (!db) throw new Error("Database connection unavailable — check DATABASE_URL.");

  const demoUser = await getUserByEmail(DEMO_OWNER_EMAIL!);
  if (!demoUser) {
    throw new Error(
      `No user found for DEMO_OWNER_EMAIL="${DEMO_OWNER_EMAIL}". Register the demo organization once, ` +
        `through the app's normal "Create your shop" sign-up, with this email — see DEMO.md.`
    );
  }
  if (!demoUser.organizationId) {
    throw new Error(
      `User "${DEMO_OWNER_EMAIL}" exists but has no organization — registration did not complete. See DEMO.md.`
    );
  }
  const organizationId = demoUser.organizationId;

  if (DEMO_ORG_SLUG) {
    const org = (
      await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1)
    )[0];
    if (!org || org.slug !== DEMO_ORG_SLUG) {
      throw new Error(
        `Resolved organization slug "${org?.slug}" does not match DEMO_ORG_SLUG="${DEMO_ORG_SLUG}". ` +
          "Refusing to run — this check exists to avoid wiping the wrong environment's data."
      );
    }
  }

  console.log(`Resetting demo data for organization ${organizationId} (owner: ${DEMO_OWNER_EMAIL})...`);

  await step("wipe phase", () =>
    db.transaction(async tx => {
      for (const table of WIPE_ORDER) {
        await tx.delete(table).where(eq(table.organizationId, organizationId));
      }
    })
  );
  console.log("Wiped existing demo business data.");

  const erpCaller = erpRouter.createCaller(contextFor(demoUser));
  const posCaller = posRouter.createCaller(contextFor(demoUser));
  const today = new Date().toISOString().slice(0, 10);
  const dueInAWeek = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const currentPayPeriod = new Date().toISOString().slice(0, 7);

  const customerRows = await step("seed customers", async () => [
    await erpCaller.customers.create({
      name: "Ahmed Al-Rashid",
      phone: "33112233",
      email: "ahmed.rashid@example.com",
      address: "Manama, Bahrain",
      notes: "Prefers a slim fit.",
      preferredContact: "Phone",
    }),
    await erpCaller.customers.create({
      name: "Fatima Yusuf",
      phone: "33445566",
      email: "fatima.yusuf@example.com",
      address: "Riffa, Bahrain",
      notes: "",
      preferredContact: "WhatsApp",
    }),
    await erpCaller.customers.create({
      name: "Khalid Mansour",
      phone: "33667788",
      email: "khalid.mansour@example.com",
      address: "Muharraq, Bahrain",
      notes: "",
      preferredContact: "Phone",
    }),
    await erpCaller.customers.create({
      name: "Mariam Al-Sayed",
      phone: "33889900",
      email: "mariam.alsayed@example.com",
      address: "Isa Town, Bahrain",
      notes: "Regular customer since 2023.",
      preferredContact: "Email",
    }),
  ]);
  const [ahmed, fatima, khalid] = customerRows;

  const inventoryRows = await step("seed inventory", async () => [
    await erpCaller.inventory.create({
      code: "FAB-NVY-001",
      name: "Navy Wool Blend",
      inventoryType: "material",
      category: "fabric",
      color: "Navy",
      unit: "Meters",
      minThreshold: 10,
      costPerUnit: 3.5,
      salePrice: 6,
      openingQuantity: 120,
      rollCount: 4,
      metersPerRoll: 30,
    }),
    await erpCaller.inventory.create({
      code: "FAB-WHT-002",
      name: "White Cotton",
      inventoryType: "material",
      category: "fabric",
      color: "White",
      unit: "Meters",
      minThreshold: 10,
      costPerUnit: 2.2,
      salePrice: 4,
      openingQuantity: 90,
      rollCount: 3,
      metersPerRoll: 30,
    }),
    await erpCaller.inventory.create({
      code: "ACC-CUF-001",
      name: "Silver Cufflinks",
      inventoryType: "item",
      category: "accessory",
      color: "Silver",
      unit: "Pieces",
      minThreshold: 5,
      costPerUnit: 4,
      salePrice: 8,
      openingQuantity: 25,
      rollCount: 0,
    }),
  ]);
  const [navyFabric, , cufflinks] = inventoryRows;

  const serviceRows = await step("seed services", async () => [
    await erpCaller.services.create({
      sku: "SVC-THOUB-STD",
      name: "Thoub Stitching - Standard",
      category: "tailoring",
      description: "Standard bespoke thoub stitching.",
      unitPrice: 25,
      inventoryItemId: navyFabric.id,
      defaultFabricMeters: 3.5,
    }),
    await erpCaller.services.create({
      sku: "SVC-ALT-HEM",
      name: "Hem Alteration",
      category: "alteration",
      description: "Adjust hem length.",
      unitPrice: 10,
    }),
  ]);
  const [thoubService, altService] = serviceRows;

  const staffRows = await step("seed staff", async () => [
    await erpCaller.staff.create({ name: "Yusuf Rahman", phone: "36001122", jobTitle: "Master Tailor", baseSalary: 350, commissionRate: 2 }),
    await erpCaller.staff.create({ name: "Sara Ibrahim", phone: "36003344", jobTitle: "Sales Associate", baseSalary: 250, commissionRate: 1 }),
  ]);
  const [tailor] = staffRows;

  const measurement = await step("seed measurement profile", () =>
    erpCaller.customers.addMeasurement({
      customerId: ahmed.id,
      measurements: { chest: "42", length: "58", shoulder: "19" },
      fitPreference: "Slim",
      collarStyle: "Classic",
      pocketStyle: "Straight",
      notes: "",
      effectiveDate: today,
    })
  );

  await step("seed tailoring order", () =>
    erpCaller.tailoring.create({
      customerId: ahmed.id,
      measurementProfileId: measurement.id,
      assignedTailorId: tailor.id,
      garmentType: "Thoub",
      quantity: 2,
      dueDate: dueInAWeek,
      price: 65,
      customerSuppliedFabric: false,
      notes: "Rush order for Eid.",
      productionNotes: "",
    })
  );

  const session = await step("open POS session", () =>
    posCaller.session.open({ openingCash: 50, notes: "Demo reset opening float" })
  );

  await step("seed paid POS sale", () =>
    posCaller.checkout({
      sessionId: session.id,
      customerId: fatima.id,
      customerName: "Fatima Yusuf",
      discount: 0,
      paymentMethod: "cash",
      paymentStatus: "paid",
      items: [
        { inventoryItemId: cufflinks.id, name: "Silver Cufflinks", quantity: 1, unitPrice: 8, lineDiscount: 0 },
        { serviceId: altService.id, name: "Hem Alteration", quantity: 1, unitPrice: 10, lineDiscount: 0 },
      ],
    })
  );

  await step("seed partially-paid POS sale", () =>
    posCaller.checkout({
      sessionId: session.id,
      customerId: khalid.id,
      customerName: "Khalid Mansour",
      discount: 0,
      paymentMethod: "benefitpay",
      paymentStatus: "partial",
      items: [{ serviceId: thoubService.id, name: "Thoub Stitching - Standard", quantity: 1, unitPrice: 25, lineDiscount: 0 }],
    })
  );

  await step("seed salary payout", () =>
    erpCaller.staff.createPayout({
      staffProfileId: tailor.id,
      payPeriod: currentPayPeriod,
      allowances: 20,
      overtime: 0,
      deductions: 0,
      notes: "Demo reset payout",
    })
  );

  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `Demo reset complete in ${elapsedSeconds}s: ${customerRows.length} customers, ${inventoryRows.length} inventory items, ` +
      `${serviceRows.length} services, ${staffRows.length} staff, 1 tailoring order, 2 POS sales, 1 payout.`
  );
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
