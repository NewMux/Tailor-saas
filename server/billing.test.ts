/**
 * Real-Postgres tests for Paddle webhook handling and read-only billing
 * enforcement. Skipped automatically when no DATABASE_URL is configured.
 */
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { BILLING_READ_ONLY_ERR_MSG } from "@shared/const";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { organizations } from "../drizzle/schema";
import { adminRouter } from "./admin";
import { applyPaddleEvent, PADDLE_WEBHOOK_PATH, type PaddleEvent } from "./billing/webhook";
import { signOrganizationId } from "./billing/paddle";
import { createOrganizationWithOwner, getDb } from "./db";
import { erpRouter } from "./erp";
import { platformStaff } from "../drizzle/schema";
import { ENV } from "./_core/env";
import type { TrpcContext } from "./_core/context";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

function contextFor(user: TrpcContext["user"], extra: Partial<TrpcContext> = {}): TrpcContext {
  return { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"], ...extra };
}

function customer(name: string, phone: string) {
  return { name, phone, email: "", address: "", notes: "", preferredContact: "" };
}

const paddleSettings = {
  paddleApiKey: "pdl_test_key",
  paddleClientToken: "test_client_token",
  paddlePriceId: "pri_test",
  paddleWebhookSecret: "pdl_ntfset_test",
};

describeIfDb("billing (real Postgres)", () => {
  const stamp = Date.now();
  const original = { ...ENV };
  let shop: Awaited<ReturnType<typeof createOrganizationWithOwner>>;
  let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
  let eventCounter = 0;

  const event = (type: string, status: string, overrides: Partial<PaddleEvent["data"]> = {}, occurredAt = new Date()): PaddleEvent => ({
    event_id: `evt_${stamp}_${++eventCounter}`,
    event_type: type,
    occurred_at: occurredAt.toISOString(),
    data: {
      id: `sub_${stamp}`,
      status,
      customer_id: `ctm_${stamp}`,
      custom_data: { organizationId: String(shop.organization.id), organizationSignature: signOrganizationId(shop.organization.id) },
      current_billing_period: { starts_at: "2026-06-01T00:00:00Z", ends_at: "2026-07-01T00:00:00Z" },
      ...overrides,
    },
  });

  const setOrg = (values: Partial<typeof organizations.$inferInsert>) =>
    db.update(organizations).set(values).where(eq(organizations.id, shop.organization.id));
  const getOrg = async () => (await db.select().from(organizations).where(eq(organizations.id, shop.organization.id)))[0]!;

  beforeAll(async () => {
    Object.assign(ENV, paddleSettings);
    db = (await getDb())!;
    shop = await createOrganizationWithOwner(`Billing Shop ${stamp}`, {
      openId: `billing-${stamp}`,
      name: "Billing Owner",
      email: `billing-${stamp}@example.com`,
      passwordHash: null,
      loginMethod: "local",
    });
  });

  afterAll(() => {
    Object.assign(ENV, original);
  });

  it("starts new organizations on a trial", () => {
    expect(shop.organization.subscriptionStatus).toBe("trialing");
    expect(shop.organization.trialEndsAt!.getTime()).toBeGreaterThan(Date.now() + (ENV.trialDays - 1) * 86_400_000);
  });

  describe("read-only enforcement", () => {
    it("allows everything during the trial", async () => {
      const caller = erpRouter.createCaller(contextFor(shop.user));
      await expect(caller.customers.create(customer(`Trial Customer ${stamp}`, "33330001"))).resolves.toBeTruthy();
    });

    it("blocks mutations but not queries once the trial has expired", async () => {
      await setOrg({ subscriptionStatus: "trialing", trialEndsAt: new Date(Date.now() - 1000) });
      const caller = erpRouter.createCaller(contextFor(shop.user));
      await expect(caller.customers.list({} as never)).resolves.toBeDefined();
      await expect(caller.customers.create(customer(`Blocked ${stamp}`, "33330002"))).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: BILLING_READ_ONLY_ERR_MSG,
      });
      const status = await caller.billing.status();
      expect(status).toMatchObject({ access: "read_only", reason: "trial_expired", canManage: true });
    });

    it("lets a read-only shop still start checkout", async () => {
      const caller = erpRouter.createCaller(contextFor(shop.user));
      const config = await caller.billing.checkoutConfig();
      expect(config.priceId).toBe("pri_test");
      expect(config.customData.organizationSignature).toBe(signOrganizationId(shop.organization.id));
    });

    it("does not block platform staff impersonating the shop", async () => {
      const caller = erpRouter.createCaller(contextFor(shop.user, { impersonation: { platformStaffUserId: shop.user.id } }));
      await expect(caller.customers.create(customer(`Support ${stamp}`, "33330003"))).resolves.toBeTruthy();
    });

    it("never blocks anyone when billing is not configured", async () => {
      Object.assign(ENV, { paddleApiKey: "" });
      try {
        const caller = erpRouter.createCaller(contextFor(shop.user));
        await expect(caller.customers.create(customer(`No Billing ${stamp}`, "33330004"))).resolves.toBeTruthy();
      } finally {
        Object.assign(ENV, paddleSettings);
      }
    });
  });

  describe("Paddle webhook events", () => {
    it("activates the organization named in signed custom data", async () => {
      const result = await applyPaddleEvent(event("subscription.created", "active"));
      expect(result).toMatchObject({ outcome: "applied", status: "active" });
      const org = await getOrg();
      expect(org).toMatchObject({ subscriptionStatus: "active", paddleSubscriptionId: `sub_${stamp}`, paddleCustomerId: `ctm_${stamp}` });
      expect(org.currentPeriodEndsAt?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    });

    it("processes each event id only once", async () => {
      const once = event("subscription.updated", "active");
      await applyPaddleEvent(once);
      expect(await applyPaddleEvent(once)).toEqual({ outcome: "duplicate" });
    });

    it("ignores events older than the last one applied", async () => {
      const result = await applyPaddleEvent(event("subscription.past_due", "past_due", {}, new Date(Date.now() - 60 * 60 * 1000)));
      expect(result).toEqual({ outcome: "stale" });
      expect((await getOrg()).subscriptionStatus).toBe("active");
    });

    it("moves to past_due and back to active on later events", async () => {
      await applyPaddleEvent(event("subscription.past_due", "past_due", {}, new Date(Date.now() + 1000)));
      expect((await getOrg()).subscriptionStatus).toBe("past_due");
      await applyPaddleEvent(event("subscription.updated", "active", {}, new Date(Date.now() + 2000)));
      expect((await getOrg()).subscriptionStatus).toBe("active");
    });

    it("refuses to bind a subscription through unsigned custom data", async () => {
      const other = await createOrganizationWithOwner(`Billing Victim ${stamp}`, {
        openId: `billing-victim-${stamp}`,
        name: "Victim",
        email: `billing-victim-${stamp}@example.com`,
        passwordHash: null,
        loginMethod: "local",
      });
      const result = await applyPaddleEvent(
        event("subscription.created", "active", { id: `sub_forged_${stamp}`, custom_data: { organizationId: String(other.organization.id), organizationSignature: "00" } })
      );
      expect(result).toEqual({ outcome: "unknown_organization" });
    });

    it("rejects webhook requests with a bad signature and accepts signed ones", async () => {
      const { createApp } = await import("./_core/app");
      const server: Server = createApp().listen(0);
      try {
        const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${PADDLE_WEBHOOK_PATH}`;
        const body = JSON.stringify(event("subscription.canceled", "canceled", {}, new Date(Date.now() + 3000)));
        const bad = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "Paddle-Signature": "ts=1;h1=00" }, body });
        expect(bad.status).toBe(400);

        const ts = Math.floor(Date.now() / 1000);
        const h1 = createHmac("sha256", paddleSettings.paddleWebhookSecret).update(`${ts}:${body}`).digest("hex");
        const good = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "Paddle-Signature": `ts=${ts};h1=${h1}` }, body });
        expect(good.status).toBe(200);
        expect((await getOrg()).subscriptionStatus).toBe("canceled");
      } finally {
        await new Promise(resolve => server.close(resolve));
      }
    });
  });

  describe("ops console billing controls", () => {
    it("lets a superadmin exempt an organization and extend a trial", async () => {
      const staff = await createOrganizationWithOwner(`Billing Ops ${stamp}`, {
        openId: `billing-ops-${stamp}`,
        name: "Ops",
        email: `billing-ops-${stamp}@example.com`,
        passwordHash: null,
        loginMethod: "local",
      });
      await db.insert(platformStaff).values({ userId: staff.user.id, role: "superadmin", isActive: true });
      const ops = adminRouter.createCaller(contextFor(staff.user));

      await ops.organizations.setBillingExempt({ organizationId: shop.organization.id, exempt: true, reason: "Partner shop" });
      expect((await ops.organizations.detail({ organizationId: shop.organization.id })).planStatus).toBe("exempt");
      await ops.organizations.setBillingExempt({ organizationId: shop.organization.id, exempt: false, reason: "Partner ended" });

      const extended = await ops.organizations.extendTrial({ organizationId: shop.organization.id, days: 7 });
      expect(extended.subscriptionStatus).toBe("trialing");
      expect(extended.trialEndsAt!.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    });
  });
});
