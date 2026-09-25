import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyPaddleSignature } from "./paddle";

const secret = "pdl_ntfset_test_secret";
const body = JSON.stringify({ event_id: "evt_1", event_type: "subscription.created" });
const now = new Date("2026-06-15T12:00:00Z");
const ts = Math.floor(now.getTime() / 1000);

function sign(timestamp: number, payload = body, key = secret) {
  return createHmac("sha256", key).update(`${timestamp}:${payload}`).digest("hex");
}

describe("verifyPaddleSignature", () => {
  it("accepts a correctly signed, fresh payload", () => {
    expect(verifyPaddleSignature(body, `ts=${ts};h1=${sign(ts)}`, secret, now)).toBe(true);
  });

  it("accepts when any of several h1 values matches (secret rotation)", () => {
    expect(verifyPaddleSignature(body, `ts=${ts};h1=${sign(ts, body, "old")};h1=${sign(ts)}`, secret, now)).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifyPaddleSignature(body.replace("created", "canceled"), `ts=${ts};h1=${sign(ts)}`, secret, now)).toBe(false);
  });

  it("rejects the wrong secret", () => {
    expect(verifyPaddleSignature(body, `ts=${ts};h1=${sign(ts, body, "other")}`, secret, now)).toBe(false);
  });

  it("rejects a replayed (stale) signature", () => {
    const old = ts - 10 * 60;
    expect(verifyPaddleSignature(body, `ts=${old};h1=${sign(old)}`, secret, now)).toBe(false);
  });

  it("rejects missing or malformed headers", () => {
    expect(verifyPaddleSignature(body, undefined, secret, now)).toBe(false);
    expect(verifyPaddleSignature(body, "garbage", secret, now)).toBe(false);
    expect(verifyPaddleSignature(body, `ts=${ts}`, secret, now)).toBe(false);
    expect(verifyPaddleSignature(body, `ts=${ts};h1=zz`, secret, now)).toBe(false);
  });
});
