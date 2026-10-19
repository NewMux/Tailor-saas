import { createContext, type TrpcContext } from "../_core/context";

/**
 * Builds a context for a bearer token the way production does: through
 * createContext and the real session lookup, so tests see what a real
 * request sees (impersonation mode, session state included).
 */
export async function contextFromToken(token: string): Promise<TrpcContext> {
  const req = { headers: { authorization: `Bearer ${token}` }, ip: "127.0.0.1" } as unknown as TrpcContext["req"];
  return createContext({ req, res: {} as TrpcContext["res"] } as never);
}

/**
 * Context for an operator who just confirmed their password (default) or has
 * not, for procedures that require a recent confirmation.
 */
export function operatorContext(user: NonNullable<TrpcContext["user"]>, options: { reauth?: boolean } = {}): TrpcContext {
  const reauth = options.reauth ?? true;
  return {
    user,
    req: { headers: {}, ip: "127.0.0.1" } as unknown as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    session: { id: 0, createdAt: new Date(), reauthAt: reauth ? new Date() : null },
  };
}
