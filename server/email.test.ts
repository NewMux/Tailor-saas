import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV } from "./_core/env";
import { sendEmail } from "./_core/email";
import { passwordResetEmail, staffInviteEmail } from "./_core/emailTemplates";

describe("sendEmail (Resend)", () => {
  const original = { resendApiKey: ENV.resendApiKey, emailFrom: ENV.emailFrom };
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.assign(ENV, original);
  });

  it("is a no-op that reports sent:false when Resend is not configured", async () => {
    Object.assign(ENV, { resendApiKey: "", emailFrom: "" });
    const result = await sendEmail(passwordResetEmail("a@example.com", "https://app.example.com/?reset_token=x"));
    expect(result).toEqual({ sent: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the message to Resend with the configured sender", async () => {
    Object.assign(ENV, { resendApiKey: "re_test", emailFrom: "Tafsell <hello@example.com>" });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "email_1" }), { status: 200 }));
    const result = await sendEmail(passwordResetEmail("a@example.com", "https://app.example.com/?reset_token=x"));
    expect(result).toEqual({ sent: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer re_test");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ from: "Tafsell <hello@example.com>", to: ["a@example.com"] });
    expect(body.html).toContain("https://app.example.com/?reset_token=x");
    expect(body.text).toContain("https://app.example.com/?reset_token=x");
  });

  it("never throws when Resend rejects the request", async () => {
    Object.assign(ENV, { resendApiKey: "re_test", emailFrom: "hello@example.com" });
    fetchMock.mockResolvedValue(new Response("domain not verified", { status: 403 }));
    await expect(sendEmail(passwordResetEmail("a@example.com", "https://x"))).resolves.toEqual({ sent: false });
  });

  it("escapes user-controlled values in the HTML body", () => {
    const message = staffInviteEmail("b@example.com", {
      inviteeName: "<script>alert(1)</script>",
      shopName: "Shop & Co",
      roleName: "Cashier",
      inviteUrl: "https://app.example.com/?invite_token=abc",
    });
    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("&lt;script&gt;");
    expect(message.html).toContain("Shop &amp; Co");
  });
});
