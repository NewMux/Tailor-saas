import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who is really behind the current tenant request. Set by the tenant
 * middleware (server/_core/trpc.ts) so the shared audit() writers can record
 * the platform operator during an impersonation without every call site
 * passing it along.
 */
export type RequestActor = { impersonatedBy: number | null };

export const requestContext = new AsyncLocalStorage<RequestActor>();

export function currentImpersonator() {
  return requestContext.getStore()?.impersonatedBy ?? null;
}
