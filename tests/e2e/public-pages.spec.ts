import { expect, test } from "@playwright/test";

// Prospects and customers must be able to read pricing, terms and privacy
// without signing in.
test("pricing and legal pages are public", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { name: "Pricing that fits your shop" })).toBeVisible();
  for (const [link, heading] of [
    ["Terms of service", "Terms of service"],
    ["Privacy policy", "Privacy policy"],
  ] as const) {
    await page.getByRole("contentinfo").getByRole("link", { name: link }).click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  }
  await expect(page.getByText("Sign in to Tafsell")).toHaveCount(0);
});

test("legal pages read in Arabic when the language is switched", async ({ page }) => {
  await page.goto("/terms");
  await page.getByRole("button", { name: "عربي" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "شروط الخدمة" })).toBeVisible();
  await expect(page.getByText("اتفاقية خدمة موقّعة")).toBeVisible();
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
