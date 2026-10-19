import { expect, test } from "@playwright/test";

// Paddle's account review requires pricing, terms, privacy and refund pages
// that anyone can open without signing in.
test("pricing and legal pages are public", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { name: "Simple pricing for your tailoring shop" })).toBeVisible();
  for (const [link, heading] of [
    ["Terms of service", "Terms of service"],
    ["Privacy policy", "Privacy policy"],
    ["Refund policy", "Refund policy"],
  ] as const) {
    await page.getByRole("contentinfo").getByRole("link", { name: link }).click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  }
  await expect(page.getByText("Sign in to Tafsell")).toHaveCount(0);
});

// The Content-Security-Policy ships report-only; it is enforced only once the
// pages people actually use load without a single violation.
test("public pages load without Content-Security-Policy violations", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", message => {
    if (/content security policy/i.test(message.text())) violations.push(message.text());
  });
  for (const path of ["/", "/pricing", "/terms"]) {
    const response = await page.goto(path);
    expect(response?.headers()["content-security-policy-report-only"] ?? response?.headers()["content-security-policy"]).toBeTruthy();
    await page.waitForLoadState("networkidle");
  }
  expect(violations).toEqual([]);
});
