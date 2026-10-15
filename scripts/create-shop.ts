/**
 * Creates a shop and its owner from the command line, the same way the ops
 * console's "Create shop" does (server/_core/shopOnboarding.ts), and prints
 * the owner's one-time setup link. For bootstrapping without the UI and for
 * the e2e tests; there is no public sign-up.
 *
 * Usage:
 *   DATABASE_URL=... AUTH_BASE_URL=https://app.example.com \
 *     pnpm shop:create --shop "Al Noor Tailors" --owner "Sara Ali" --email sara@example.com
 *
 * Prints "Setup link: <url>". Without AUTH_BASE_URL the link is a path
 * ("/?reset_token=...") to open on the app's own domain.
 */
import { closeDb } from "../server/db";
import {
  createShopWithOwner,
  ShopOnboardingError,
} from "../server/_core/shopOnboarding";

function readArg(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1]?.trim();
}

const shopName = readArg("shop");
const ownerName = readArg("owner");
const ownerEmail = readArg("email");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
if (
  !shopName ||
  shopName.length < 2 ||
  !ownerName ||
  ownerName.length < 2 ||
  !ownerEmail ||
  !/^\S+@\S+\.\S+$/.test(ownerEmail)
) {
  console.error(
    'Usage: pnpm shop:create --shop "Shop name" --owner "Owner name" --email owner@example.com'
  );
  process.exit(1);
}

try {
  const baseUrl = (process.env.AUTH_BASE_URL ?? "").trim().replace(/\/$/, "");
  const result = await createShopWithOwner(
    { shopName, ownerName, ownerEmail },
    baseUrl
  );
  console.log(
    `Created "${result.organization.name}" (organization ${result.organization.id}) owned by ${result.owner.email}.`
  );
  console.log(
    result.emailed
      ? "The setup link was emailed to the owner."
      : "Email is not configured: send the setup link to the owner yourself."
  );
  console.log(`Setup link: ${result.setupUrl}`);
} catch (error) {
  console.error(error instanceof ShopOnboardingError ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
