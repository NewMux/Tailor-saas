/**
 * Real-Postgres tests for the platform-staff authorization tiers
 * (platformProcedure / superadminProcedure in server/_core/trpc.ts).
 * Skipped automatically when no DATABASE_URL is configured, same as
 * tenant-isolation.test.ts.
 */
import { NOT_PLATFORM_STAFF_ERR_MSG, UNAUTHED_ERR_MSG } from "@shared/const";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { platformStaff } from "../drizzle/schema";
import { createOrganizationWithOwner, getDb } from "./db";
import { platformProcedure, router, superadminProcedure } from "./_core/trpc";
import type { TrpcContext } from "./_core/context";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const testRouter = router({
  whoami: platformProcedure.query(({ ctx }) => ({ role: ctx.platformRole })),
  dangerous: superadminProcedure.mutation(() => ({ ok: true }) as const),
});

function contextFor(user: TrpcContext["user"]): TrpcContext {
  return { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

describeIfDb("platform staff authorization (real Postgres)", () => {
  const stamp = Date.now();
  let regularOwner: Awaited<ReturnType<typeof createOrganizationWithOwner>>;
  let supportStaffOwner: Awaited<ReturnType<typeof createOrganizationWithOwner>>;
  let superadminOwner: Awaited<ReturnType<typeof createOrganizationWithOwner>>;
  let inactiveStaffOwner: Awaited<ReturnType<typeof createOrganizationWithOwner>>;

  beforeAll(async () => {
    const db = await getDb();

    regularOwner = await createOrganizationWithOwner(`Platform Test Shop A ${stamp}`, {
      openId: `platform-a-${stamp}`,
      name: "Owner A",
      email: `platform-owner-a-${stamp}@example.com`,
      passwordHash: null,
      loginMethod: "local",
    });
    supportStaffOwner = await createOrganizationWithOwner(`Platform Test Shop B ${stamp}`, {
      openId: `platform-b-${stamp}`,
      name: "Owner B",
      email: `platform-owner-b-${stamp}@example.com`,
      passwordHash: null,
      loginMethod: "local",
    });
    superadminOwner = await createOrganizationWithOwner(`Platform Test Shop C ${stamp}`, {
      openId: `platform-c-${stamp}`,
      name: "Owner C",
      email: `platform-owner-c-${stamp}@example.com`,
      passwordHash: null,
      loginMethod: "local",
    });
    inactiveStaffOwner = await createOrganizationWithOwner(`Platform Test Shop D ${stamp}`, {
      openId: `platform-d-${stamp}`,
      name: "Owner D",
      email: `platform-owner-d-${stamp}@example.com`,
      passwordHash: null,
      loginMethod: "local",
    });

    await db!.insert(platformStaff).values([
      { userId: supportStaffOwner.user.id, role: "support", isActive: true },
      { userId: superadminOwner.user.id, role: "superadmin", isActive: true },
      { userId: inactiveStaffOwner.user.id, role: "superadmin", isActive: false },
    ]);
  });

  it("rejects an unauthenticated caller", async () => {
    const caller = testRouter.createCaller(contextFor(null));
    await expect(caller.whoami()).rejects.toMatchObject({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  });

  it("rejects a tenant org owner with no platformStaff row, even though its global role is 'admin'", async () => {
    // Regression test for the finding that motivated this design:
    // createOrganizationWithOwner sets users.role="admin" for every
    // self-serve org owner, so platform access must never be derived from
    // that column.
    expect(regularOwner.user.role).toBe("admin");
    const caller = testRouter.createCaller(contextFor(regularOwner.user));
    await expect(caller.whoami()).rejects.toMatchObject({ code: "FORBIDDEN", message: NOT_PLATFORM_STAFF_ERR_MSG });
  });

  it("treats an inactive platformStaff row as no access at all", async () => {
    const caller = testRouter.createCaller(contextFor(inactiveStaffOwner.user));
    await expect(caller.whoami()).rejects.toMatchObject({ code: "FORBIDDEN", message: NOT_PLATFORM_STAFF_ERR_MSG });
  });

  it("lets a support-role staff member through platformProcedure but not superadminProcedure", async () => {
    const caller = testRouter.createCaller(contextFor(supportStaffOwner.user));
    await expect(caller.whoami()).resolves.toEqual({ role: "support" });
    await expect(caller.dangerous()).rejects.toMatchObject({ code: "FORBIDDEN", message: NOT_PLATFORM_STAFF_ERR_MSG });
  });

  it("lets a superadmin through both platformProcedure and superadminProcedure", async () => {
    const caller = testRouter.createCaller(contextFor(superadminOwner.user));
    await expect(caller.whoami()).resolves.toEqual({ role: "superadmin" });
    await expect(caller.dangerous()).resolves.toEqual({ ok: true });
  });

  it("re-checks isActive live (revoking access blocks the next call)", async () => {
    const db = await getDb();
    const caller = testRouter.createCaller(contextFor(supportStaffOwner.user));
    await expect(caller.whoami()).resolves.toEqual({ role: "support" });

    await db!.update(platformStaff).set({ isActive: false }).where(eq(platformStaff.userId, supportStaffOwner.user.id));
    await expect(caller.whoami()).rejects.toMatchObject({ code: "FORBIDDEN" });

    await db!.update(platformStaff).set({ isActive: true }).where(eq(platformStaff.userId, supportStaffOwner.user.id));
  });
});
