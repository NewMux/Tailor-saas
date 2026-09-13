import { Environment, Paddle } from "@paddle/paddle-node-sdk";
import { BILLING } from "./env";

let client: Paddle | null = null;

/**
 * Lazily constructed Paddle API client. Returns null when this deployment has
 * no Paddle API key, so every caller has to handle the "billing not
 * configured" case explicitly rather than crashing at import time (which
 * would take the whole ERP down just because billing isn't set up yet).
 */
export function getPaddle(): Paddle | null {
  if (!BILLING.paddleApiKey) return null;
  if (!client) {
    client = new Paddle(BILLING.paddleApiKey, {
      environment:
        BILLING.paddleEnvironment === "production"
          ? Environment.production
          : Environment.sandbox,
    });
  }
  return client;
}
