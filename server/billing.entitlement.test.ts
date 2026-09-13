import { describe, expect, it } from "vitest";
import {
  evaluateBillingAccess,
  type BillingSnapshot,
} from "./billingEntitlement";

const NOW = new Date("2026-09-12T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function organization(
  overrides: Partial<BillingSnapshot> = {}
): BillingSnapshot {
  return {
    subscriptionStatus: "trialing",
    trialEndsAt: null,
    currentPeriodEndsAt: null,
    paddleSubscriptionId: null,
    ...overrides,
  };
}

function evaluate(snapshot: BillingSnapshot, billingConfigured = true) {
  return evaluateBillingAccess(snapshot, {
    now: NOW,
    billingConfigured,
    gracePeriodDays: 7,
  });
}

describe("billing entitlement", () => {
  it("never paywalls a deployment that has no Paddle credentials", () => {
    // Otherwise an unconfigured deployment would lock every shop out with no
    // way for anyone to pay.
    const access = evaluate(
      organization({ subscriptionStatus: "expired" }),
      false
    );
    expect(access.allowed).toBe(true);
    expect(access.reason).toBe("billing_disabled");
  });

  it("allows a trial that has not run out yet and counts the days left", () => {
    const access = evaluate(
      organization({ trialEndsAt: new Date(NOW.getTime() + 3.2 * DAY) })
    );
    expect(access.allowed).toBe(true);
    expect(access.reason).toBe("trialing");
    expect(access.daysRemaining).toBe(4);
  });

  it("blocks a trial the moment it runs out", () => {
    const access = evaluate(
      organization({ trialEndsAt: new Date(NOW.getTime() - 1000) })
    );
    expect(access.allowed).toBe(false);
    expect(access.reason).toBe("trial_expired");
  });

  it("blocks a trialing organization that somehow has no trial deadline", () => {
    // Fails closed: a missing deadline must not read as an unlimited trial.
    expect(evaluate(organization({ trialEndsAt: null })).allowed).toBe(false);
  });

  it("trusts the subscription over the local trial clock once Paddle has one", () => {
    // A Paddle-side trial captures the card up front, so the subscription is
    // authoritative even though the local trial date has passed.
    const access = evaluate(
      organization({
        trialEndsAt: new Date(NOW.getTime() - 30 * DAY),
        paddleSubscriptionId: "sub_123",
        currentPeriodEndsAt: new Date(NOW.getTime() + 10 * DAY),
      })
    );
    expect(access.allowed).toBe(true);
    expect(access.reason).toBe("subscribed");
  });

  it("allows an active subscription", () => {
    const access = evaluate(
      organization({
        subscriptionStatus: "active",
        currentPeriodEndsAt: new Date(NOW.getTime() + 20 * DAY),
      })
    );
    expect(access.allowed).toBe(true);
    expect(access.reason).toBe("subscribed");
    expect(access.daysRemaining).toBe(20);
  });

  it("keeps a shop open during the grace window after a failed renewal", () => {
    const access = evaluate(
      organization({
        subscriptionStatus: "past_due",
        currentPeriodEndsAt: new Date(NOW.getTime() - 2 * DAY),
      })
    );
    expect(access.allowed).toBe(true);
    expect(access.reason).toBe("grace_period");
    expect(access.daysRemaining).toBe(5);
  });

  it("blocks once the grace window after a failed renewal has passed", () => {
    const access = evaluate(
      organization({
        subscriptionStatus: "past_due",
        currentPeriodEndsAt: new Date(NOW.getTime() - 8 * DAY),
      })
    );
    expect(access.allowed).toBe(false);
    expect(access.reason).toBe("payment_failed");
  });

  it("blocks a past_due subscription with no known paid-until date", () => {
    expect(
      evaluate(organization({ subscriptionStatus: "past_due" })).allowed
    ).toBe(false);
  });

  it("serves a cancelled subscription until the paid period actually ends", () => {
    const stillPaid = evaluate(
      organization({
        subscriptionStatus: "canceled",
        currentPeriodEndsAt: new Date(NOW.getTime() + 5 * DAY),
      })
    );
    expect(stillPaid.allowed).toBe(true);

    const lapsed = evaluate(
      organization({
        subscriptionStatus: "canceled",
        currentPeriodEndsAt: new Date(NOW.getTime() - DAY),
      })
    );
    expect(lapsed.allowed).toBe(false);
    expect(lapsed.reason).toBe("subscription_canceled");
  });

  it("blocks a paused subscription", () => {
    const access = evaluate(organization({ subscriptionStatus: "paused" }));
    expect(access.allowed).toBe(false);
    expect(access.reason).toBe("subscription_paused");
  });

  it("blocks an expired trial status", () => {
    expect(
      evaluate(organization({ subscriptionStatus: "expired" })).allowed
    ).toBe(false);
  });

  it("fails closed on an unrecognised status", () => {
    const access = evaluate(
      organization({ subscriptionStatus: "something_new" as never })
    );
    expect(access.allowed).toBe(false);
  });
});
