import { randomUUID } from "node:crypto";
import { createOrganizationWithOwner, getUserByEmail } from "../db";
import { sendEmail } from "./email";
import { shopSetupEmail } from "./emailTemplates";
import { isBillingEnabled } from "./env";
import { createAccountSetupLink } from "./localAuth";

export class ShopOnboardingError extends Error {}

/**
 * Creates a shop and its owner account for invite-only onboarding: the owner
 * has no password until they open the returned one-time setup link, which is
 * also emailed to them when email is configured. Shared by the ops console
 * (admin.ts organizations.create) and scripts/create-shop.ts.
 */
export async function createShopWithOwner(
  input: { shopName: string; ownerName: string; ownerEmail: string },
  baseUrl: string
) {
  const email = input.ownerEmail.trim().toLowerCase();
  if (await getUserByEmail(email)) {
    throw new ShopOnboardingError(
      "An account already exists for this email address."
    );
  }

  const { user, organization } = await createOrganizationWithOwner(
    input.shopName.trim(),
    {
      openId: `local_${randomUUID()}`,
      name: input.ownerName.trim(),
      email,
      passwordHash: null,
      loginMethod: "local",
    }
  );
  const setupUrl = await createAccountSetupLink(user.id, baseUrl);
  const { sent } = await sendEmail(
    shopSetupEmail(email, {
      name: user.name ?? email,
      shopName: organization.name,
      setupUrl,
      trialEndsAt: isBillingEnabled() ? organization.trialEndsAt : null,
    })
  );
  return { organization, owner: user, setupUrl, emailed: sent };
}
