import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const grantStaffScript = fileURLToPath(new URL("../../scripts/grant-platform-staff.mjs", import.meta.url));

const stamp = Date.now();
const staffOwner = { name: "Staffer Owner", orgName: `Ops Staff Shop ${stamp}`, email: `ops-staff-${stamp}@example.com`, password: "password123" };
const targetOwner = { name: "Target Owner", orgName: `Ops Target Shop ${stamp}`, email: `ops-target-${stamp}@example.com`, password: "password123" };

async function registerNewOrg(page: import("@playwright/test").Page, org: typeof staffOwner) {
  await page.goto("/");
  const needAccount = page.getByText("Need an account? Register");
  await expect(needAccount).toBeVisible({ timeout: 15000 });
  await needAccount.click();
  await expect(page.getByText("Create your shop")).toBeVisible({ timeout: 15000 });
  await page.locator("#name").fill(org.name);
  await page.locator("#orgName").fill(org.orgName);
  await page.locator("#email").fill(org.email);
  await page.locator("#password").fill(org.password);
  await page.locator('button[type=submit]').click();
  await expect(page.getByText("Tailoring desk")).toBeVisible({ timeout: 15000 });
}

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
  test("registers a staff owner and a target owner", async ({ page, browser }) => {
    await registerNewOrg(page, staffOwner);
    const targetPage = await browser.newPage();
    await registerNewOrg(targetPage, targetOwner);
    await targetPage.close();
  });

  test("grants the staff owner superadmin access via the bootstrap script", () => {
    execFileSync("node", [grantStaffScript, "--email", staffOwner.email, "--role", "superadmin"], { env: process.env, stdio: "inherit" });
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
});
