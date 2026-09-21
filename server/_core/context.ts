import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  organizationId?: number;
  platformRole?: "support" | "superadmin";
  /** Set only when the current session is a platform-staff impersonation session. */
  impersonation?: { platformStaffUserId: number } | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  let impersonation: TrpcContext["impersonation"] = null;

  try {
    const auth = await sdk.authenticateRequest(opts.req);
    user = auth.user;
    impersonation = auth.impersonatedBy ? { platformStaffUserId: auth.impersonatedBy } : null;
  } catch {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    impersonation,
  };
}
