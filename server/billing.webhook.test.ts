import { createHmac } from "node:crypto";
import { Environment, Paddle } from "@paddle/paddle-node-sdk";
import { describe, expect, it } from "vitest";

const SECRET = "pdl_ntfset_01example_secret_value";

/**
 * Builds a Paddle-Signature header the way Paddle does: HMAC-SHA256 over
 * "<timestamp>:<raw body>", hex encoded. Verifying against a signature we
 * construct here proves the receiver implements the documented scheme rather
 * than merely agreeing with itself.
 */
function signPayload(
  rawBody: string,
  secret = SECRET,
  timestamp = Math.floor(Date.now() / 1000)
) {
  const digest = createHmac("sha256", secret)
    .update(`${timestamp}:${rawBody}`)
    .digest("hex");
  return `ts=${timestamp};h1=${digest}`;
}

const SUBSCRIPTION_EVENT = JSON.stringify({
  event_id: "evt_01example",
  event_type: "subscription.activated",
  occurred_at: "2026-09-12T12:00:00.000000Z",
  notification_id: "ntf_01example",
  data: {
    id: "sub_01example",
    status: "active",
    customer_id: "ctm_01example",
    address_id: "add_01example",
    business_id: null,
    currency_code: "USD",
    created_at: "2026-09-12T12:00:00.000000Z",
    updated_at: "2026-09-12T12:00:00.000000Z",
    started_at: "2026-09-12T12:00:00.000000Z",
    first_billed_at: "2026-09-12T12:00:00.000000Z",
    next_billed_at: "2026-10-12T12:00:00.000000Z",
    paused_at: null,
    canceled_at: null,
    collection_mode: "automatic",
    billing_cycle: { interval: "month", frequency: 1 },
    current_billing_period: {
      starts_at: "2026-09-12T12:00:00.000000Z",
      ends_at: "2026-10-12T12:00:00.000000Z",
    },
    custom_data: { organizationId: 42 },
    items: [{ price: { id: "pri_01example" }, status: "active", quantity: 1 }],
  },
});

const paddle = new Paddle("apikey_test", { environment: Environment.sandbox });

describe("Paddle webhook signature verification", () => {
  it("accepts a correctly signed payload", async () => {
    const signature = signPayload(SUBSCRIPTION_EVENT);
    await expect(
      paddle.webhooks.isSignatureValid(SUBSCRIPTION_EVENT, SECRET, signature)
    ).resolves.toBe(true);
  });

  it("rejects a payload signed with the wrong secret", async () => {
    const signature = signPayload(
      SUBSCRIPTION_EVENT,
      "pdl_ntfset_01wrong_secret"
    );
    await expect(
      paddle.webhooks.isSignatureValid(SUBSCRIPTION_EVENT, SECRET, signature)
    ).resolves.toBe(false);
  });

  it("rejects a payload whose body was altered after signing", async () => {
    // The exact failure the raw-body requirement exists to prevent: parsing
    // and re-serialising the JSON changes the bytes and invalidates the HMAC.
    const signature = signPayload(SUBSCRIPTION_EVENT);
    const reserialised = JSON.stringify(JSON.parse(SUBSCRIPTION_EVENT));
    const tampered = reserialised.replace(
      '"organizationId":42',
      '"organizationId":43'
    );
    await expect(
      paddle.webhooks.isSignatureValid(tampered, SECRET, signature)
    ).resolves.toBe(false);
  });

  it("throws rather than returning false on a malformed signature header", async () => {
    // Documents why the webhook route wraps verification in try/catch: a
    // header it cannot even parse raises instead of reporting "not valid",
    // and an uncaught throw there would return 500 and make Paddle retry a
    // request that can never succeed.
    await expect(
      paddle.webhooks.isSignatureValid(
        SUBSCRIPTION_EVENT,
        SECRET,
        "not-a-signature"
      )
    ).rejects.toThrow(/Invalid webhook signature/);
  });

  it("unmarshals a verified subscription event into the fields billing stores", async () => {
    const event = await paddle.webhooks.unmarshal(
      SUBSCRIPTION_EVENT,
      SECRET,
      signPayload(SUBSCRIPTION_EVENT)
    );
    expect(event?.eventId).toBe("evt_01example");
    expect(event?.eventType).toBe("subscription.activated");

    const subscription = event?.data as {
      id: string;
      status: string;
      customerId: string;
      customData: { organizationId: number };
      items: Array<{ price?: { id?: string } }>;
      currentBillingPeriod?: { endsAt?: string };
    };
    expect(subscription.id).toBe("sub_01example");
    expect(subscription.status).toBe("active");
    expect(subscription.customerId).toBe("ctm_01example");
    // The link back to the tenant, set as customData when checkout opens.
    expect(subscription.customData.organizationId).toBe(42);
    expect(subscription.items[0]?.price?.id).toBe("pri_01example");
    expect(subscription.currentBillingPeriod?.endsAt).toBe(
      "2026-10-12T12:00:00.000000Z"
    );
  });
});
