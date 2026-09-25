import { BILLING_READ_ONLY_ERR_MSG } from "@shared/const";
import { toast } from "sonner";
import { navigate } from "wouter/use-browser-location";

let lastShownAt = 0;

/**
 * A read-only (unpaid) shop gets this error from every save. Show one
 * actionable toast instead of each screen's generic error, at most every
 * few seconds, and let the global billing banner explain the rest.
 */
export function checkBillingReadOnlyError(error: unknown) {
  if (!(error instanceof Error) || error.message !== BILLING_READ_ONLY_ERR_MSG) return;
  window.dispatchEvent(new Event("billing-status-changed"));
  if (Date.now() - lastShownAt < 4000) return;
  lastShownAt = Date.now();
  toast.error("Your shop is read-only until a subscription is active.", {
    id: "billing-read-only",
    action: { label: "Go to billing", onClick: () => navigate("/billing") },
  });
}
