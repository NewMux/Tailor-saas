import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loginRateLimiter } from "./rateLimit";

describe("auth rate limiting", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    // A minimal app carrying only the limiter under test - no database, no
    // auth logic - so this exercises exactly the throttling behavior and
    // nothing else can make the test flaky or slow. trust proxy is enabled
    // so a single X-Forwarded-For hop can stand in for distinct client IPs,
    // the same way it does behind Coolify's real reverse proxy.
    const app = express();
    app.set("trust proxy", 1);
    app.post("/login", loginRateLimiter, (_req, res) => res.status(401).json({ error: { code: "INVALID_CREDENTIALS" } }));
    server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  const attempt = (forwardedFor: string) =>
    fetch(`${baseUrl}/login`, { method: "POST", headers: { "X-Forwarded-For": forwardedFor } });

  it("allows the configured number of attempts, then blocks with 429", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await attempt("203.0.113.10")).status);
    // 10 attempts pass through to the (failing) handler, the 11th is throttled.
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
    expect(statuses[10]).toBe(429);
  });

  it("returns the same { error: { code, message } } shape the rest of the auth API uses", async () => {
    for (let i = 0; i < 10; i++) await attempt("203.0.113.11");
    const response = await attempt("203.0.113.11");
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body).toMatchObject({ error: { code: "TOO_MANY_REQUESTS", message: expect.stringContaining("Too many attempts") } });
  });

  it("scopes the limit per client IP rather than sharing one counter across every caller", async () => {
    for (let i = 0; i < 10; i++) await attempt("203.0.113.12");
    expect((await attempt("203.0.113.12")).status).toBe(429);

    // A different client IP must still have its own untouched quota - this
    // is what keeps a rate limit from becoming a whole-site lockout the
    // moment one abusive IP (or a misconfigured trust proxy pointing every
    // request at the same IP) exhausts it.
    expect((await attempt("203.0.113.99")).status).toBe(401);
  });
});
