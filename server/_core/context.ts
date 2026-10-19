import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import type { ImpersonationMode } from "./impersonationPolicy";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  organizationId?: number;
  platformRole?: "support" | "superadmin";
  /** Set only when the current session is a platform-staff impersonation session. A missing mode means read-only. */
  impersonation?: { platformStaffUserId: number; mode?: ImpersonationMode } | null;
  /** The session behind this request; step-up (password re-entry) reads reauthAt from it. */
  session?: { id: number; createdAt: Date; reauthAt: Date | null } | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  let impersonation: TrpcContext["impersonation"] = null;
  let session: TrpcContext["session"] = null;

  try {
    const auth = await sdk.authenticateRequest(opts.req);
    user = auth.user;
    impersonation = auth.impersonatedBy
      ? { platformStaffUserId: auth.impersonatedBy, mode: auth.session.impersonationMode === "write" ? "write" : "readonly" }
      : null;
    session = { id: auth.session.id, createdAt: auth.session.createdAt, reauthAt: auth.session.reauthAt };
  } catch {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    impersonation,
    session,
  };
}
