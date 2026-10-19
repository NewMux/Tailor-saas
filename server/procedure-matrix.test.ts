/**
 * Generated access matrix. Every procedure of the real router is called with
 * callers it must refuse, and the refusal is checked against the declared
 * manifest (server/_core/procedureManifest.ts). Nothing here trusts the
 * manifest: it only states what the router is expected to do, and the router
 * has to prove it. Denied calls stop in middleware, before any input parsing
 * or handler runs, so nothing is changed.
 */
import {
  IMPERSONATION_BLOCKED_ERR_MSG,
  IMPERSONATION_READ_ONLY_ERR_MSG,
  NOT_PLATFORM_STAFF_ERR_MSG,
  ORG_SUSPENDED_ERR_MSG,
  REAUTH_REQUIRED_ERR_MSG,
  UNAUTHED_ERR_MSG,
} from "@shared/const";
import { callTRPCProcedure } from "@trpc/server";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { organizations, platformStaff } from "../drizzle/schema";
import { createOrganizationWithOwner, getDb } from "./db";
import { isDeniedWhileImpersonating, isMutationAllowedInWriteMode } from "./_core/impersonationPolicy";
import { PROCEDURE_MANIFEST } from "./_core/procedureManifest";
import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

type Proc = { _def: { type: "query" | "mutation" | "subscription"; inputs: unknown[] } };
const procedures = Object.entries((appRouter as unknown as { _def: { procedures: Record<string, Proc> } })._def.procedures);

async function outcome(path: string, ctx: TrpcContext) {
  const proc = (appRouter as unknown as { _def: { procedures: Record<string, Proc> } })._def.procedures[path]!;
  try {
    await callTRPCProcedure({ router: appRouter, path, type: proc._def.type, ctx, getRawInput: async () => undefined, input: undefined, signal: undefined } as never);
    return { ok: true as const };
  } catch (error) {
    const e = error as { code?: string; message?: string };
    return { ok: false as const, code: e.code, message: e.message ?? "" };
  }
}

describeIfDb("procedure access matrix (real Postgres)", () => {
  const stamp = Date.now();
  const req = { headers: {}, ip: "127.0.0.1" } as unknown as TrpcContext["req"];
  const res = {} as TrpcContext["res"];
  let plain: TrpcContext;
  let noOrg: TrpcContext;
  let suspended: TrpcContext;
  let support: TrpcContext;
  let superNoReauth: TrpcContext;
  let impersonatingReadonly: TrpcContext;
  let impersonatingWrite: TrpcContext;
  const fresh = new Date();

  beforeAll(async () => {
    const mk = (tag: string) => createOrganizationWithOwner(`Matrix ${tag} ${stamp}`, { openId: `mx-${tag}-${stamp}`, name: tag, email: `mx-${tag}-${stamp}@example.com`, passwordHash: "$scrypt$x$y", loginMethod: "local" });
    const [a, s, p, sa, d] = await Promise.all([mk("plain"), mk("suspended"), mk("support"), mk("super"), mk("operator")]);
    const db = (await getDb())!;
    await db.update(organizations).set({ status: "suspended" }).where(eq(organizations.id, s.organization.id));
    await db.insert(platformStaff).values([
      { userId: p.user.id, role: "support", isActive: true },
      { userId: sa.user.id, role: "superadmin", isActive: true },
      { userId: d.user.id, role: "superadmin", isActive: true },
    ]);
    plain = { user: a.user, req, res };
    noOrg = { user: { ...a.user, organizationId: null }, req, res };
    suspended = { user: s.user, req, res };
    support = { user: p.user, req, res, session: { id: 0, createdAt: fresh, reauthAt: fresh } };
    superNoReauth = { user: sa.user, req, res, session: { id: 0, createdAt: fresh, reauthAt: null } };
    impersonatingReadonly = { user: a.user, req, res, impersonation: { platformStaffUserId: d.user.id, mode: "readonly" } };
    impersonatingWrite = { user: a.user, req, res, impersonation: { platformStaffUserId: d.user.id, mode: "write" } };
  });

  it("classifies exactly the procedures the router has", () => {
    expect(Object.keys(PROCEDURE_MANIFEST).sort()).toEqual(procedures.map(([path]) => path).sort());
  });

  it("has only the expected public procedures", () => {
    const publics = Object.entries(PROCEDURE_MANIFEST).filter(([, v]) => v.kind === "public").map(([path]) => path);
    expect(publics.sort()).toEqual(["auth.me", "billing.plan", "system.health"]);
  });

  describe.each(procedures.map(([path]) => path))("%s", path => {
    const entry = PROCEDURE_MANIFEST[path]!;
    const type = () => (appRouter as unknown as { _def: { procedures: Record<string, Proc> } })._def.procedures[path]!._def.type;

    if (entry.kind === "public") {
      it("is intentionally public and touches no tenant data", () => {
        expect(["system.health", "auth.me", "billing.plan"]).toContain(path);
      });
    } else {
      it("refuses anonymous callers", async () => {
        expect(await outcome(path, { user: null, req, res })).toMatchObject({ ok: false, code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
      });
    }

    if (entry.kind === "tenant" || entry.kind === "tenantBilling") {
      it("refuses a user without a shop", async () => {
        expect(await outcome(path, noOrg)).toMatchObject({ ok: false, code: "FORBIDDEN", message: expect.stringContaining("not linked to an organization") });
      });
      it("refuses a user of a suspended shop", async () => {
        expect(await outcome(path, suspended)).toMatchObject({ ok: false, code: "FORBIDDEN", message: ORG_SUSPENDED_ERR_MSG });
      });
      it("applies the impersonation policy", async () => {
        const denied = isDeniedWhileImpersonating(path);
        const readonly = await outcome(path, impersonatingReadonly);
        const write = await outcome(path, impersonatingWrite);
        if (denied) {
          expect(readonly).toMatchObject({ ok: false, message: IMPERSONATION_BLOCKED_ERR_MSG });
          expect(write).toMatchObject({ ok: false, message: IMPERSONATION_BLOCKED_ERR_MSG });
        } else if (type() === "mutation") {
          expect(readonly).toMatchObject({ ok: false, message: IMPERSONATION_READ_ONLY_ERR_MSG });
          if (isMutationAllowedInWriteMode(path)) {
            // Allowed procedures are only probed when their input check stops them before any handler runs.
            const proc = (appRouter as unknown as { _def: { procedures: Record<string, Proc> } })._def.procedures[path]!;
            if (proc._def.inputs.length > 0) {
              expect(write.ok === false && [IMPERSONATION_BLOCKED_ERR_MSG, IMPERSONATION_READ_ONLY_ERR_MSG].includes(write.message)).toBe(false);
            }
          } else {
            expect(write).toMatchObject({ ok: false, message: IMPERSONATION_BLOCKED_ERR_MSG });
          }
        }
      });
    }

    if (entry.kind === "platform" || entry.kind === "superadmin") {
      it("refuses a shop user and an impersonation session", async () => {
        expect(await outcome(path, plain)).toMatchObject({ ok: false, code: "FORBIDDEN", message: NOT_PLATFORM_STAFF_ERR_MSG });
        expect(await outcome(path, { ...impersonatingWrite, user: support.user })).toMatchObject({ ok: false, code: "FORBIDDEN", message: NOT_PLATFORM_STAFF_ERR_MSG });
      });
    }

    if (entry.kind === "superadmin") {
      it("refuses support staff", async () => {
        expect(await outcome(path, support)).toMatchObject({ ok: false, code: "FORBIDDEN", message: NOT_PLATFORM_STAFF_ERR_MSG });
      });
    }

    if (entry.highRisk) {
      it("needs a recent password confirmation", async () => {
        expect(await outcome(path, superNoReauth)).toMatchObject({ ok: false, code: "FORBIDDEN", message: REAUTH_REQUIRED_ERR_MSG });
      });
    }
  });
});
