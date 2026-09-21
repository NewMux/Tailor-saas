import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { auditLogs } from "../drizzle/schema";
import { createImpersonationSession, endImpersonationSession, IMPERSONATION_TTL_MS, sessionTokenFromRequest } from "./_core/localAuth";
import { protectedProcedure, router, superadminProcedure } from "./_core/trpc";
import { getDb, getUserById } from "./db";

async function dbOrThrow() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  return db;
}

async function audit(organizationId: number, actorId: number, action: string, entityType: string, entityId?: number, details?: unknown) {
  const db = await dbOrThrow();
  await db.insert(auditLogs).values({
    organizationId,
    actorId,
    action,
    entityType,
    entityId,
    detailsJson: details ? JSON.stringify(details) : null,
  });
}

const impersonationRouter = router({
  start: superadminProcedure
    .input(z.object({ userId: z.number().int().positive(), reason: z.string().trim().min(3).max(300) }))
    .mutation(async ({ ctx, input }) => {
      const targetUser = await getUserById(input.userId);
      if (!targetUser || !targetUser.organizationId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "That user does not belong to an organization." });
      }

      const token = await createImpersonationSession(targetUser.id, ctx.user.id);
      await audit(targetUser.organizationId, ctx.user.id, "IMPERSONATION_STARTED", "user", targetUser.id, {
        reason: input.reason,
        platformStaffEmail: ctx.user.email,
      });

      return {
        token,
        expiresInMs: IMPERSONATION_TTL_MS,
        target: { id: targetUser.id, name: targetUser.name, email: targetUser.email, organizationId: targetUser.organizationId },
      };
    }),

  end: protectedProcedure.mutation(async ({ ctx }) => {
    if (!ctx.impersonation) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This session is not an impersonation session." });
    }
    if (!ctx.user.organizationId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Your account is not linked to an organization." });
    }

    const token = sessionTokenFromRequest(ctx.req);
    const session = token ? await endImpersonationSession(token) : undefined;
    const durationMs = session ? Date.now() - session.createdAt.getTime() : null;

    await audit(ctx.user.organizationId, ctx.impersonation.platformStaffUserId, "IMPERSONATION_ENDED", "user", ctx.user.id, { durationMs });

    return { ok: true } as const;
  }),
});

export const adminRouter = router({
  impersonation: impersonationRouter,
});
