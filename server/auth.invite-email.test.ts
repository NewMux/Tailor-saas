/**
 * Real-Postgres, real-HTTP tests for the invite and password-reset flows in
 * server/_core/localAuth.ts. Skipped automatically without DATABASE_URL.
 */
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createOrganizationWithOwner } from "./db";
import { erpRouter } from "./erp";
import { ENV } from "./_core/env";
import type { TrpcContext } from "./_core/context";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const sentEmails: Array<{ to: string; subject: string; text: string }> = [];
vi.mock("./_core/email", () => ({
  sendEmail: vi.fn(async (message: { to: string; subject: string; text: string }) => {
    sentEmails.push(message);
    return { sent: true };
  }),
}));

function contextFor(user: TrpcContext["user"]): TrpcContext {
  return { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

describeIfDb("invite + reset email flows (real Postgres)", () => {
  const stamp = Date.now();
  let server: Server;
  let baseUrl: string;
  let inviteToken: string;
  const invitedEmail = `invitee-${stamp}@example.com`;
  const originalEnv = { authBaseUrl: ENV.authBaseUrl, resendApiKey: ENV.resendApiKey, emailFrom: ENV.emailFrom };

  beforeAll(async () => {
    Object.assign(ENV, { authBaseUrl: "https://app.example.com", resendApiKey: "re_test", emailFrom: "hello@example.com" });
    const { createApp } = await import("./_core/app");
    server = createApp().listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const owner = await createOrganizationWithOwner(`Invite Shop ${stamp}`, {
      openId: `invite-owner-${stamp}`,
      name: "Owner",
      email: `invite-owner-${stamp}@example.com`,
      passwordHash: null,
      loginMethod: "local",
    });
    const caller = erpRouter.createCaller(contextFor(owner.user));
    const role = await caller.team.createCustomRole({ name: `Cashier ${stamp}`, description: "", permissions: ["sales"] });
    const invite = await caller.access.inviteStaff({ name: "New Hire", email: invitedEmail, customRoleId: role.id });
    expect(invite.emailSent).toBe(true);
    expect(invite.inviteUrl.startsWith("https://app.example.com/?invite_token=")).toBe(true);
    inviteToken = decodeURIComponent(invite.inviteUrl.split("invite_token=")[1]!);
  });

  afterAll(async () => {
    Object.assign(ENV, originalEnv);
    await new Promise(resolve => server?.close(resolve));
  });

  const post = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it("emails the invite link to the invited address", () => {
    const email = sentEmails.find(message => message.to === invitedEmail);
    expect(email?.subject).toContain(`Invite Shop ${stamp}`);
    expect(email?.text).toContain("invite_token=");
  });

  it("describes an invite so the form can lock the invited email", async () => {
    const response = await fetch(`${baseUrl}/api/auth/invite?token=${encodeURIComponent(inviteToken)}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ email: invitedEmail, name: "New Hire", shopName: `Invite Shop ${stamp}` });
    expect((await fetch(`${baseUrl}/api/auth/invite?token=invite_bogus`)).status).toBe(404);
  });

  it("rejects accepting an invite with a different email address", async () => {
    const response = await post("/api/auth/register", {
      mode: "join_invite",
      inviteToken,
      name: "Someone Else",
      email: `stranger-${stamp}@example.com`,
      password: "password-123",
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVITE_EMAIL_MISMATCH");
  });

  it("accepts the invite with the invited address", async () => {
    const response = await post("/api/auth/register", {
      mode: "join_invite",
      inviteToken,
      name: "New Hire",
      email: invitedEmail.toUpperCase(),
      password: "password-123",
    });
    expect(response.status).toBe(201);
  });

  it("emails a password reset link", async () => {
    sentEmails.length = 0;
    const response = await post("/api/auth/forgot", { email: invitedEmail });
    expect(response.status).toBe(200);
    expect((await response.json()).message).toMatch(/we've sent a password reset link/i);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]!.to).toBe(invitedEmail);
    expect(sentEmails[0]!.text).toContain("https://app.example.com/?reset_token=");
  });
});
