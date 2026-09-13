import { expect, test } from "@playwright/test";

const stamp = Date.now();
const orgOne = { name: "Owner One", orgName: `Shop One ${stamp}`, email: `owner1-${stamp}@example.com`, password: "password123" };
const orgTwo = { name: "Owner Two", orgName: `Shop Two ${stamp}`, email: `owner2-${stamp}@example.com`, password: "password123" };

async function registerNewOrg(page: import("@playwright/test").Page, org: typeof orgOne) {
  // "/" is the public landing page now; /signup opens the registration form
  // directly (see DashboardLayout's signed-out routing).
  await page.goto("/signup");
  const needAccount = page.getByText("Need an account? Register");
  if (await needAccount.count()) await needAccount.click();
  await expect(page.getByText("Create your shop")).toBeVisible();
  await page.locator("#name").fill(org.name);
  await page.locator("#orgName").fill(org.orgName);
  await page.locator("#email").fill(org.email);
  await page.locator("#password").fill(org.password);
  await page.locator('button[type=submit]').click();
  await expect(page.getByText("Tailoring desk")).toBeVisible({ timeout: 15000 });
}

async function loginExisting(page: import("@playwright/test").Page, org: typeof orgOne) {
  await page.goto("/login");
  await expect(page.getByText("Sign in to Tafsell")).toBeVisible();
  await page.locator("#email").fill(org.email);
  await page.locator("#password").fill(org.password);
  await page.locator('button[type=submit]').click();
  await expect(page.getByText("Tailoring desk")).toBeVisible({ timeout: 15000 });
}

test.describe("public landing page", () => {
  test("a signed-out visitor gets marketing copy, and the CTA opens signup", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Run your tailoring business/ })).toBeVisible();
    // The sign-in form must NOT be what a first-time visitor sees.
    await expect(page.getByText("Sign in to Tafsell")).toHaveCount(0);

    await page.getByRole("button", { name: "Start free trial" }).first().click();
    await expect(page.getByText("Create your shop")).toBeVisible();
  });

  test("the landing page switches to right-to-left Arabic", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "العربية" }).click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { name: /أدر أعمال الخياطة/ })).toBeVisible();
  });
});

test.describe.serial("multi-tenant signup and isolation", () => {
  test("registering with a shop name creates a new, empty organization", async ({ page }) => {
    await registerNewOrg(page, orgOne);
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

  test("a new shop starts on a free trial rather than being paywalled", async ({ page }) => {
    await loginExisting(page, orgOne);
    await page.goto("/billing");
    // Billing is disabled unless Paddle is configured, so accept either the
    // trial banner or the explicit "not set up" notice - both mean unlocked.
    await expect(
      page.getByText(/free trial|Billing is not set up on this deployment/)
    ).toBeVisible({ timeout: 15000 });
    // What must never appear here is the lockout.
    await expect(page.getByText("Your workspace is locked")).toHaveCount(0);
  });

  test("a second registration creates a fully separate organization", async ({ page }) => {
    await registerNewOrg(page, orgTwo);
    await expect(page.getByText("Tailoring desk")).toBeVisible({ timeout: 15000 });

    await page.goto("/settings");
    // Org two's staff directory must show only its own owner, never org one's.
    const staffAccess = page.locator("#staff-access");
    await expect(staffAccess.getByText(orgTwo.name)).toBeVisible();
    await expect(staffAccess.getByText(orgOne.name)).toHaveCount(0);
  });
});
