import { expect, test } from "@playwright/test";
import { onboardShop } from "./helpers";

const stamp = Date.now();
const orgOne = { name: "Owner One", orgName: `Shop One ${stamp}`, email: `owner1-${stamp}@example.com`, password: "password123" };
const orgTwo = { name: "Owner Two", orgName: `Shop Two ${stamp}`, email: `owner2-${stamp}@example.com`, password: "password123" };

async function loginExisting(page: import("@playwright/test").Page, org: typeof orgOne) {
  await page.goto("/");
  await expect(page.getByText("Sign in to Tafsell")).toBeVisible();
  await page.locator("#email").fill(org.email);
  await page.locator("#password").fill(org.password);
  await page.locator('button[type=submit]').click();
  await expect(page.getByText("Tailoring desk")).toBeVisible({ timeout: 15000 });
}

test.describe.serial("invite-only onboarding and isolation", () => {
  test("the sign-in screen offers no public sign-up", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Sign in to Tafsell")).toBeVisible();
    await expect(page.getByRole("link", { name: "Book a demo" })).toHaveAttribute("href", "https://tafsell.com/#book-a-demo");
    await expect(page.getByText("Need an account? Register")).toHaveCount(0);
    await expect(page.getByText("Create your shop")).toHaveCount(0);
  });

  test("a shop created for an owner starts as a new, empty organization", async ({ page }) => {
    await onboardShop(page, orgOne);
    // A brand-new organization has zero sales/customers - proves this
    // dashboard isn't showing another tenant's seeded data.
    await expect(page.getByText("Registered clients")).toBeVisible();
    await expect(page.getByText("No sales are recorded in this period.")).toBeVisible();
  });

  test("owner settings offers invite-based staff onboarding, not the old approval queue", async ({ page }) => {
    await loginExisting(page, orgOne);
    await page.goto("/settings");
    await expect(page.getByRole("button", { name: "Invite staff" })).toBeVisible();
    await expect(page.getByText("New staff requests")).toHaveCount(0);

    await page.getByRole("button", { name: "Invite staff" }).click();
    await expect(page.getByRole("heading", { name: "Invite a staff member" })).toBeVisible();
    // No custom role exists yet in this fresh org, so the role select and
    // submit button must stay disabled rather than allowing a broken invite.
    await expect(page.getByRole("combobox")).toContainText("Create a role first");
    await expect(page.getByRole("button", { name: "Create invite link" })).toBeDisabled();
    await page.keyboard.press("Escape");
  });

  test("a second shop is a fully separate organization", async ({ page }) => {
    await onboardShop(page, orgTwo);
    await expect(page.getByText("Tailoring desk")).toBeVisible({ timeout: 15000 });

    await page.goto("/settings");
    // Org two's staff directory must show only its own owner, never org one's.
    const staffAccess = page.locator("#staff-access");
    await expect(staffAccess.getByText(orgTwo.name)).toBeVisible();
    await expect(staffAccess.getByText(orgOne.name)).toHaveCount(0);
  });
});
