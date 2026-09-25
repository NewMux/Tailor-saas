import { adminRouter } from "./admin";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { getPlatformStaffByUserId, getUserById } from "./db";
import { erpRouter } from "./erp";
import { publicBillingRouter } from "./erp/billing";
import { posRouter } from "./pos";

// Registration, login, logout, and password recovery are exposed by the
// standalone local auth routes. This tRPC procedure reports the synced
// app-level user profile to the authenticated ERP client, plus whether
// they're platform staff and, if this is an impersonation session, who
// started it - the server-verified source of truth for the ops UI (not
// just "a second token happens to be in localStorage", which could be
// stale after the impersonation session expires).
const authRouter = router({
  me: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.user) return null;
    const [platformStaffRow, impersonator] = await Promise.all([
      getPlatformStaffByUserId(ctx.user.id),
      ctx.impersonation ? getUserById(ctx.impersonation.platformStaffUserId) : undefined,
    ]);
    return {
      ...ctx.user,
      isPlatformStaff: Boolean(platformStaffRow),
      impersonation: ctx.impersonation ? { by: impersonator?.name || impersonator?.email || "platform staff" } : null,
    };
  }),
});

export const appRouter = router({ system: systemRouter, auth: authRouter, erp: erpRouter, pos: posRouter, admin: adminRouter, billing: publicBillingRouter });
export type AppRouter = typeof appRouter;
