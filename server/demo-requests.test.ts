/**
 * POST /api/public/demo-request, the "Book a demo" form on tafsell.com.
 * Real Postgres and the real Express route; only Resend is mocked.
 */
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import express from "express";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SALES_EMAIL } from "@shared/const";
import { demoRequests } from "../drizzle/schema";
import { getDb } from "./db";
import { DEMO_REQUEST_PATH, registerDemoRequestRoute } from "./_core/demoRequests";
import { ENV } from "./_core/env";

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("demo requests (real Postgres)", () => {
  const stamp = Date.now();
  const realFetch = globalThis.fetch;
  const resendMock = vi.fn();
  const original = { resendApiKey: ENV.resendApiKey, emailFrom: ENV.emailFrom };
  let server: Server;
  let url: string;

  const post = (body: unknown, origin = "https://tafsell.com") =>
    realFetch(url, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });
  const rowsFor = async (email: string) => (await getDb())!.select().from(demoRequests).where(eq(demoRequests.email, email));

  beforeAll(async () => {
    const app = express();
    registerDemoRequestRoute(app);
    server = createServer(app).listen(0);
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    url = `http://127.0.0.1:${address.port}${DEMO_REQUEST_PATH}`;
  });

  afterAll(() => server.close());

  beforeEach(() => {
    resendMock.mockReset();
    vi.stubGlobal("fetch", resendMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.assign(ENV, original);
  });

  it("stores the request and emails it to sales with Reply-To set to the prospect", async () => {
    Object.assign(ENV, { resendApiKey: "re_test", emailFrom: "Tafsell <hello@example.com>" });
    resendMock.mockResolvedValue(new Response(JSON.stringify({ id: "email_1" }), { status: 200 }));
    const email = `lead-${stamp}@example.com`;
    const response = await post({ name: "Sara Ali", shopName: "خياط النور", email, phone: "+973 3300 0000", message: "Two branches", language: "ar" });
    expect(response.status).toBe(201);

    const [row] = await rowsFor(email);
    expect(row).toMatchObject({ name: "Sara Ali", shopName: "خياط النور", phone: "+973 3300 0000", message: "Two branches", language: "ar" });
    expect(row!.notifiedAt).toBeInstanceOf(Date);

    const body = JSON.parse(resendMock.mock.calls[0]![1].body);
    expect(body.to).toEqual([SALES_EMAIL]);
    expect(body.reply_to).toBe(email);
    expect(body.subject).toContain("خياط النور");
  });

  it("keeps the lead when email is not configured", async () => {
    Object.assign(ENV, { resendApiKey: "", emailFrom: "" });
    const email = `quiet-${stamp}@example.com`;
    const response = await post({ name: "Omar", shopName: "Omar Tailoring", email });
    expect(response.status).toBe(201);
    const [row] = await rowsFor(email);
    expect(row).toMatchObject({ phone: null, message: null, language: "en", notifiedAt: null });
    expect(resendMock).not.toHaveBeenCalled();
  });

  it("escapes what the prospect typed in the email body", async () => {
    Object.assign(ENV, { resendApiKey: "re_test", emailFrom: "hello@example.com" });
    resendMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await post({ name: "<b>x</b>", shopName: "Shop", email: `html-${stamp}@example.com`, message: "<script>alert(1)</script>" });
    const body = JSON.parse(resendMock.mock.calls[0]![1].body);
    expect(body.html).not.toContain("<script>");
    expect(body.html).toContain("&lt;script&gt;");
  });

  it("refuses invalid input and stores nothing", async () => {
    const email = `bad-${stamp}@example.com`;
    expect((await post({ name: "", shopName: "Shop", email })).status).toBe(400);
    expect((await post({ name: "A", shopName: "Shop\nBcc: x@example.com", email })).status).toBe(400);
    expect((await post({ name: "A", shopName: "Shop", email: "not-an-email" })).status).toBe(400);
    expect((await post({ name: "A", shopName: "Shop", email, message: "x".repeat(2001) })).status).toBe(400);
    expect(await rowsFor(email)).toEqual([]);
  });

  it("answers bots that fill the honeypot as if it worked, without storing", async () => {
    const email = `bot-${stamp}@example.com`;
    const response = await post({ name: "Bot", shopName: "Bot", email, website: "https://spam.example" });
    expect(response.status).toBe(201);
    expect(await rowsFor(email)).toEqual([]);
  });

  it("allows CORS from the marketing site only, without credentials", async () => {
    const preflight = (origin: string) =>
      realFetch(url, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST" } });

    const allowed = await preflight("https://tafsell.com");
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://tafsell.com");
    expect(allowed.headers.get("access-control-allow-credentials")).toBeNull();

    const refused = await preflight("https://evil.example");
    expect(refused.status).toBe(403);
    expect(refused.headers.get("access-control-allow-origin")).toBeNull();
  });
});
