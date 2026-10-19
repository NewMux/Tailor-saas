/**
 * /manus-storage serves staff documents. Real Postgres + the real Express
 * proxy; only the S3 signing is real too (no network: it just presigns).
 */
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authSessions, platformStaff, staffDocuments, staffProfiles } from "../drizzle/schema";
import { createOrganizationWithOwner, getDb } from "./db";
import { ENV } from "./_core/env";
import { createImpersonationSession, hashOpaqueToken, randomToken } from "./_core/localAuth";
import { registerStorageProxy } from "./_core/storageProxy";

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("storage proxy (real Postgres)", () => {
  const stamp = Date.now();
  const key = `org/0/staff/0/proxy-${stamp}.pdf`;
  let server: Server;
  let base: string;
  let ownerToken: string;
  let impersonationToken: string;
  const original = { ...ENV };

  const get = (path: string, token?: string) =>
    fetch(`${base}/manus-storage/${path}`, { redirect: "manual", headers: token ? { Authorization: `Bearer ${token}` } : {} });

  beforeAll(async () => {
    Object.assign(ENV, { s3Endpoint: "https://s3.example.com", s3Region: "auto", s3Bucket: "docs", s3AccessKeyId: "AKID", s3SecretAccessKey: "secret", forgeApiUrl: "", forgeApiKey: "" });
    const db = (await getDb())!;
    const owner = await createOrganizationWithOwner(`Proxy Shop ${stamp}`, { openId: `px-${stamp}`, name: "Proxy Owner", email: `px-${stamp}@example.com`, passwordHash: null, loginMethod: "local" });
    const staff = await createOrganizationWithOwner(`Proxy Staff Org ${stamp}`, { openId: `pxs-${stamp}`, name: "Proxy Operator", email: `pxs-${stamp}@example.com`, passwordHash: null, loginMethod: "local" });
    await db.insert(platformStaff).values({ userId: staff.user.id, role: "superadmin", isActive: true });
    const [profile] = await db.insert(staffProfiles).values({ organizationId: owner.organization.id, name: "Tailor", jobTitle: "Tailor", baseSalary: "100.000" }).returning();
    await db.insert(staffDocuments).values({ organizationId: owner.organization.id, staffProfileId: profile!.id, label: "Contract", fileName: "c.pdf", contentType: "application/pdf", storageKey: key, storageUrl: `/manus-storage/${key}`, uploadedBy: owner.user.id });

    ownerToken = randomToken("local");
    await db.insert(authSessions).values({ tokenHash: hashOpaqueToken(ownerToken), userId: owner.user.id, expiresAt: new Date(Date.now() + 3_600_000) });
    impersonationToken = await createImpersonationSession(owner.user.id, staff.user.id);

    const app = express();
    registerStorageProxy(app);
    server = createServer(app).listen(0);
    await once(server, "listening");
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  });

  afterAll(() => {
    Object.assign(ENV, original);
    server?.close();
  });

  it("answers anonymous callers with 401, not a 502", async () => {
    expect((await get(key)).status).toBe(401);
  });

  it("answers anonymous callers with 401 even when storage is not configured", async () => {
    const configured = { ...ENV };
    Object.assign(ENV, { s3Endpoint: "", s3Region: "", s3Bucket: "", s3AccessKeyId: "", s3SecretAccessKey: "" });
    try {
      expect((await get(key)).status).toBe(401);
    } finally {
      Object.assign(ENV, configured);
    }
  });

  it("redirects an authorized admin to a signed URL", async () => {
    const response = await get(key, ownerToken);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("X-Amz-Signature");
  });

  it("refuses impersonation sessions, whatever the target's role", async () => {
    expect((await get(key, impersonationToken)).status).toBe(403);
  });
});
