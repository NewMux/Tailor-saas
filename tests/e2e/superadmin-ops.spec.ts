import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { completeOwnerSetup, onboardShop } from "./helpers";

const grantStaffScript = fileURLToPath(new URL("../../scripts/grant-platform-staff.mjs", import.meta.url));

const stamp = Date.now();
const staffOwner = { name: "Staffer Owner", orgName: `Ops Staff Shop ${stamp}`, email: `ops-staff-${stamp}@example.com`, password: "password123" };
const newOperator = { name: "New Operator", email: `ops-new-${stamp}@example.com`, password: "password123" };
const targetOwner = { name: "Target Owner", orgName: `Ops Target Shop ${stamp}`, email: `ops-target-${stamp}@example.com`, password: "password123" };

async function loginExisting(page: import("@playwright/test").Page, org: typeof staffOwner) {
  await page.goto("/");
  await expect(page.getByText("Sign in to Tafsell")).toBeVisible();
  await page.locator("#email").fill(org.email);
  await page.locator("#password").fill(org.password);
  await page.locator('button[type=submit]').click();
  // Wait for the session token to actually land before navigating away -
  // page.goto() does a full reload, which would otherwise race the async
  // login request and lose it.
  await expect(page.getByText("Sign in to Tafsell")).toHaveCount(0, { timeout: 15000 });
}

test.describe.serial("superadmin ops console", () => {
  test("onboards the staff owner and grants superadmin access via the bootstrap scripts", async ({ page }) => {
    await onboardShop(page, staffOwner);
    execFileSync("node", [grantStaffScript, "--email", staffOwner.email, "--role", "superadmin"], { env: process.env, stdio: "inherit" });
  });

  test("creates the target shop from the ops console, and its owner sets up their account", async ({ page, browser }) => {
    await loginExisting(page, staffOwner);
    await page.goto("/ops");
    await page.getByRole("button", { name: "Create shop" }).click();
    await page.locator("#shop-name").fill(targetOwner.orgName);
    await page.locator("#owner-name").fill(targetOwner.name);
    await page.locator("#owner-email").fill(targetOwner.email);
    await page.getByRole("dialog").getByRole("button", { name: "Create shop" }).click();
    await expect(page.getByRole("heading", { name: "Shop created" })).toBeVisible();
    const setupLink = await page.getByRole("dialog").locator("input[readonly]").inputValue();
    expect(setupLink).toContain("reset_token=");
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText(targetOwner.orgName, { exact: true })).toBeVisible();

    const targetPage = await browser.newPage();
    await completeOwnerSetup(targetPage, setupLink, targetOwner.password);
    await targetPage.close();
  });

  test("lists organizations and suspends the target org from the ops console", async ({ page }) => {
    await loginExisting(page, staffOwner);
    await page.goto("/ops");
    await expect(page.getByRole("heading", { name: "Organizations" })).toBeVisible();
    await page.getByText(targetOwner.orgName, { exact: true }).click();

    await expect(page.getByRole("heading", { name: targetOwner.orgName })).toBeVisible();
    await page.getByRole("button", { name: "Suspend organization" }).click();
    await page.getByPlaceholder("Reason (required)").fill("Investigating suspicious activity (e2e test)");
    await page.getByRole("button", { name: "Suspend", exact: true }).click();
    await expect(page.getByText("suspended", { exact: true })).toBeVisible();
  });

  test("the suspended organization's owner is rejected at login", async ({ browser }) => {
    const targetPage = await browser.newPage();
    await targetPage.goto("/");
    await targetPage.locator("#email").fill(targetOwner.email);
    await targetPage.locator("#password").fill(targetOwner.password);
    await targetPage.locator('button[type=submit]').click();
    await expect(targetPage.getByText(/suspended/i)).toBeVisible();
    await targetPage.close();
  });

  test("reactivating restores the organization's access", async ({ page }) => {
    await loginExisting(page, staffOwner);
    await page.goto("/ops");
    await page.getByText(targetOwner.orgName, { exact: true }).click();
    await page.getByRole("button", { name: "Reactivate organization" }).click();
    await expect(page.getByText("active", { exact: true })).toBeVisible();
  });

  test("impersonating a user shows the banner in the workspace, and exiting restores the staff session", async ({ page }) => {
    await loginExisting(page, staffOwner);
    await page.goto("/ops");
    await page.getByText(targetOwner.orgName, { exact: true }).click();
    await page.getByRole("button", { name: "Impersonate" }).click();
    await page.getByPlaceholder("Reason (required)").fill("Support ticket #123 (e2e test)");
    await page.getByRole("button", { name: "Start impersonation" }).click();

    await expect(page.getByText("Viewing as another user")).toBeVisible();
    await expect(page.getByText("Tailoring desk")).toBeVisible();

    await page.getByRole("button", { name: "Exit impersonation" }).click();
    await expect(page.getByText("Viewing as another user")).toHaveCount(0);
  });

  test("invites a platform-only operator, who sets a password and lands in the console", async ({ page, browser }) => {
    await loginExisting(page, staffOwner);
    await page.goto("/ops/staff");
    await page.locator("#invite-name").fill(newOperator.name);
    await page.locator("#invite-email").fill(newOperator.email);
    await page.locator("#invite-reason").fill("Joins the support rota (e2e test)");
    await page.getByRole("button", { name: "Send invite" }).click();
    const setupLink = await page.locator("input[readonly]").first().inputValue();
    expect(setupLink).toContain("reset_token=");

    const operatorPage = await browser.newPage();
    await operatorPage.goto(setupLink);
    await expect(operatorPage.getByRole("heading", { name: "Set your password" })).toBeVisible({ timeout: 15000 });
    await operatorPage.locator("#recovery-password").fill(newOperator.password);
    await operatorPage.locator("#recovery-confirmation").fill(newOperator.password);
    await operatorPage.getByRole("button", { name: "Save password" }).click();
    // No shop to land in: straight to the operator console.
    await expect(operatorPage.getByText("Tafsell Platform Ops")).toBeVisible({ timeout: 15000 });
    await expect(operatorPage.getByText("Back to workspace")).toHaveCount(0);
    await operatorPage.close();
  });

  test("an operator cannot revoke their own access", async ({ page }) => {
    await loginExisting(page, staffOwner);
    await page.goto("/ops/staff");
    const ownRow = page.getByRole("row").filter({ hasText: staffOwner.email });
    await expect(ownRow.getByText("You")).toBeVisible();
    await expect(ownRow.getByRole("button", { name: "Revoke" })).toHaveCount(0);
  });
});
