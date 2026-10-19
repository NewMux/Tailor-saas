/**
 * What an operator may do while impersonating a shop user, by procedure path.
 *
 * - Read-only sessions refuse every mutation.
 * - Some procedures are refused in both modes: they mint or change access
 *   (a persistent back door), change billing, or expose personal documents.
 * - Write sessions allow only the day-to-day data fixes listed below; every
 *   other mutation is refused, so a procedure added later fails closed.
 */
export type ImpersonationMode = "readonly" | "write";

const ALWAYS_DENIED_PREFIXES = ["access.", "accessApproval.", "team.", "billing.", "staff.", "shop."];

const WRITE_ALLOWED_PREFIXES = ["customers.", "tailoring.", "inventory.", "services."];
const WRITE_DENIED_EXACT = new Set(["customers.remove", "inventory.remove"]);

/** Paths are matched relative to the ERP router, so "erp.team.x" and "team.x" are the same procedure. */
const normalize = (path: string) => (path.startsWith("erp.") ? path.slice(4) : path);

export function isDeniedWhileImpersonating(path: string) {
  const p = normalize(path);
  return ALWAYS_DENIED_PREFIXES.some(prefix => p.startsWith(prefix));
}

export function isMutationAllowedInWriteMode(path: string) {
  const p = normalize(path);
  return !WRITE_DENIED_EXACT.has(p) && WRITE_ALLOWED_PREFIXES.some(prefix => p.startsWith(prefix));
}
