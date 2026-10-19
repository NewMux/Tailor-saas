import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

// These helpers create shops and operators with the real scripts, against
// whatever DATABASE_URL points at. Never let that be a shared database.
const databaseHost = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "").hostname;
  } catch {
    return "";
  }
})();
if (databaseHost && !["localhost", "127.0.0.1", "::1", "[::1]", "postgres"].includes(databaseHost)) {
  throw new Error(`E2E tests refuse to run against a non-local database (${databaseHost}).`);
}

export type ShopOwner = {
  name: string;
  orgName: string;
  email: string;
  password: string;
};

/**
 * Creates a shop the way operators do (there is no public sign-up) via
 * scripts/create-shop.ts, and returns the owner's one-time setup link.
 */
export function createShop(owner: ShopOwner) {
  const output = execFileSync(
    "pnpm",
    [
      "exec",
      "tsx",
      "scripts/create-shop.ts",
      "--shop",
      owner.orgName,
      "--owner",
      owner.name,
      "--email",
      owner.email,
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, AUTH_BASE_URL: "" },
      encoding: "utf8",
    }
  );
  const match = output.match(/Setup link: (\S+)/);
  if (!match) throw new Error(`create-shop printed no setup link:\n${output}`);
  return match[1];
}

/** Opens an owner's setup link, chooses their password, and lands in the workspace. */
export async function completeOwnerSetup(
  page: Page,
  setupLink: string,
  password: string
) {
  await page.goto(setupLink);
  await expect(
    page.getByRole("heading", { name: "Set your password" })
  ).toBeVisible({ timeout: 15000 });
  await page.locator("#recovery-password").fill(password);
  await page.locator("#recovery-confirmation").fill(password);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByText("Tailoring desk")).toBeVisible({
    timeout: 15000,
  });
}

/** Creates a shop and finishes its owner's setup in the browser. */
export async function onboardShop(page: Page, owner: ShopOwner) {
  await completeOwnerSetup(page, createShop(owner), owner.password);
}
