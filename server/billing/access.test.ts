import { describe, expect, it } from "vitest";
import { billingAccess } from "./access";

const now = new Date("2026-06-15T12:00:00Z");
const future = new Date("2026-06-20T00:00:00Z");
const past = new Date("2026-06-10T00:00:00Z");

function org(overrides: Partial<Parameters<typeof billingAccess>[0]> = {}) {
  return { subscriptionStatus: "trialing" as const, trialEndsAt: future, billingExempt: false, ...overrides };
}

describe("billingAccess", () => {
  it("never restricts anyone when billing is not configured", () => {
    expect(billingAccess(org({ subscriptionStatus: "canceled" }), now, false)).toEqual({ access: "full", reason: "billing_disabled" });
  });

  it("gives full access during the trial and read-only once it ends", () => {
    expect(billingAccess(org(), now, true)).toEqual({ access: "full", reason: "trialing" });
    expect(billingAccess(org({ trialEndsAt: past }), now, true)).toEqual({ access: "read_only", reason: "trial_expired" });
    expect(billingAccess(org({ trialEndsAt: null }), now, true).access).toBe("read_only");
  });

  it("gives full access to paying and exempt organizations", () => {
    expect(billingAccess(org({ subscriptionStatus: "active", trialEndsAt: past }), now, true).access).toBe("full");
    expect(billingAccess(org({ subscriptionStatus: "canceled", billingExempt: true }), now, true)).toEqual({ access: "full", reason: "exempt" });
  });

  it("makes past-due, paused and canceled subscriptions read-only", () => {
    for (const subscriptionStatus of ["past_due", "paused", "canceled"] as const) {
      expect(billingAccess(org({ subscriptionStatus }), now, true)).toEqual({ access: "read_only", reason: subscriptionStatus });
    }
  });
});
