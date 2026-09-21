import { ORG_SUSPENDED_ERR_MSG } from "@shared/const";

let suspended = false;

export function isOrgSuspended() {
  return suspended;
}

export function markOrgSuspended() {
  if (suspended) return;
  suspended = true;
  window.dispatchEvent(new Event("org-suspended"));
}

export function clearOrgSuspended() {
  suspended = false;
}

export function checkOrgSuspendedError(error: unknown) {
  if (error instanceof Error && error.message === ORG_SUSPENDED_ERR_MSG) markOrgSuspended();
}
