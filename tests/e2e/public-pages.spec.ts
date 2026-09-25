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
