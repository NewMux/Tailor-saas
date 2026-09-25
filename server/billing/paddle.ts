import { createHmac, timingSafeEqual } from "node:crypto";
import { ENV } from "../_core/env";

export const PADDLE_SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

function apiBaseUrl() {
  return ENV.paddleEnvironment === "production" ? "https://api.paddle.com" : "https://sandbox-api.paddle.com";
}

export class PaddleApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "PaddleApiError";
  }
}

async function paddleApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ENV.paddleApiKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json().catch(() => ({}))) as { data?: T; error?: { detail?: string } };
  if (!response.ok || payload.data === undefined) {
    throw new PaddleApiError(`Paddle API ${path} failed (${response.status}): ${payload.error?.detail ?? "no detail"}`, response.status);
  }
  return payload.data;
}

/**
 * Verifies a `Paddle-Signature: ts=<unix>;h1=<hex>` header: h1 is
 * HMAC-SHA256 of `${ts}:${rawBody}` with the notification destination's
 * secret. Several h1 values may be present while a secret is being rotated.
 */
export function verifyPaddleSignature(rawBody: string, header: string | undefined, secret: string, now = new Date()): boolean {
  if (!header || !secret) return false;
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of header.split(";")) {
    const [key, value] = part.split("=", 2).map(piece => piece?.trim() ?? "");
    if (key === "ts") timestamp = value;
    else if (key === "h1" && value) signatures.push(value);
  }
  const ts = Number(timestamp);
  if (!timestamp || !Number.isInteger(ts) || signatures.length === 0) return false;
  if (Math.abs(now.getTime() / 1000 - ts) > PADDLE_SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}:${rawBody}`).digest();
  return signatures.some(signature => {
    const provided = Buffer.from(signature, "hex");
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  });
}

/**
 * Checkout customData is supplied by the browser, so it is signed: the
 * webhook only trusts an organizationId whose signature it can verify,
 * which stops someone attaching a subscription to another shop.
 */
export function signOrganizationId(organizationId: number) {
  return createHmac("sha256", `${ENV.paddleWebhookSecret}:checkout`).update(String(organizationId)).digest("hex");
}

export function verifyOrganizationSignature(organizationId: number, signature: unknown) {
  if (typeof signature !== "string") return false;
  const expected = Buffer.from(signOrganizationId(organizationId), "hex");
  const provided = Buffer.from(signature, "hex");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export type PaddlePrice = {
  id: string;
  unit_price: { amount: string; currency_code: string };
  billing_cycle: { interval: "day" | "week" | "month" | "year"; frequency: number } | null;
  product_id: string;
};

let priceCache: { priceId: string; price: PaddlePrice; fetchedAt: number } | null = null;
const PRICE_CACHE_MS = 60 * 60 * 1000;

export async function getConfiguredPrice(): Promise<PaddlePrice> {
  if (priceCache && priceCache.priceId === ENV.paddlePriceId && Date.now() - priceCache.fetchedAt < PRICE_CACHE_MS) {
    return priceCache.price;
  }
  const price = await paddleApi<PaddlePrice>(`/prices/${encodeURIComponent(ENV.paddlePriceId)}`);
  priceCache = { priceId: ENV.paddlePriceId, price, fetchedAt: Date.now() };
  return price;
}

export async function createPortalSessionUrl(customerId: string, subscriptionId: string | null) {
  const session = await paddleApi<{ urls: { general: { overview: string } } }>(
    `/customers/${encodeURIComponent(customerId)}/portal-sessions`,
    { method: "POST", body: JSON.stringify(subscriptionId ? { subscription_ids: [subscriptionId] } : {}) }
  );
  return session.urls.general.overview;
}
