/**
 * End to end through the real routers and Postgres: an owner invites staff
 * with a custom role, the invitee accepts, and what they can do is exactly what
 * the role names. Removing the custom role removes their access.
 */
import { hashOpaqueToken } from "./_core/localAuth";
import { beforeAll, describe, expect, it } from "vitest";
import { acceptInviteAndCreateUser, createOrganizationWithOwner, getActiveInviteByTokenHash } from "./db";
import { erpRouter } from "./erp";
import type { TrpcContext } from "./_core/context";

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const contextFor = (user: TrpcContext["user"]): TrpcContext => ({ user, req: { headers: { origin: "http://localhost" } } as unknown as TrpcContext["req"], res: {} as TrpcContext["res"] });

describeIfDb("staff invite onboarding (real Postgres)", () => {
  const stamp = Date.now();
  let owner: ReturnType<typeof erpRouter.createCaller>;
  let invitee: ReturnType<typeof erpRouter.createCaller>;
  let inviteeId: number;

  beforeAll(async () => {
    const org = await createOrganizationWithOwner(`Invite Shop ${stamp}`, { openId: `inv-${stamp}`, name: "Owner", email: `inv-owner-${stamp}@example.com`, passwordHash: null, loginMethod: "local" });
    owner = erpRouter.createCaller(contextFor(org.user));
    const role = await owner.team.createCustomRole({ name: "Stock keeper", description: "", permissions: ["inventory"] });
    const invite = await owner.access.inviteStaff({ name: "Stock Person", email: `inv-staff-${stamp}@example.com`, customRoleId: role.id });
    const token = decodeURIComponent(invite.inviteUrl.split("invite_token=")[1]!);
    const row = await getActiveInviteByTokenHash(hashOpaqueToken(token));
    const accepted = await acceptInviteAndCreateUser(row!.id, { openId: `inv-staff-${stamp}`, name: "Stock Person", email: `inv-staff-${stamp}@example.com`, passwordHash: "x", loginMethod: "local" });
    inviteeId = accepted.user.id;
    invitee = erpRouter.createCaller(contextFor(accepted.user));
  });

  it("lets the invitee do what the custom role names", async () => {
    await expect(invitee.inventory.list()).resolves.toBeDefined();
  });

  it("refuses everything the role does not name", async () => {
    await expect(invitee.customers.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(invitee.dashboard()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(invitee.team.listRoles()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("removes all access when the owner clears the custom role", async () => {
    await owner.team.clearCustomRole({ userId: inviteeId });
    await expect(invitee.inventory.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(invitee.customers.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
