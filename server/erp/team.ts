import {
  and,
  desc,
  eq,
  gte,
  inArray,
  like,
  lte,
  max,
  or,
  sql,
} from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditLogs,
  attendance,
  customerBalanceDeliveries,
  customRoles,
  customers,
  inventoryItems,
  invoiceDeliveries,
  invoicePayments,
  invoices,
  measurementProfiles,
  pendingAccessRequests,
  performanceRecords,
  posPayments,
  salaryPayouts,
  saleItems,
  sales,
  services,
  shopSettings,
  staffAccessInvites,
  staffDocuments,
  staffProfiles,
  stockMovements,
  tailoringOrders,
  userBusinessRoles,
  userCustomRoles,
  users,
  type BusinessRole,
} from "../../drizzle/schema";
import { getDb, getOrganizationById } from "../db";
import {
  effectiveInventoryQuantity,
  rollDerivedQuantity,
} from "../inventoryQuantity";
export { rollDerivedQuantity } from "../inventoryQuantity";
import { storageGetSignedUrl, storagePut } from "../storage";
import { tenantProcedure, router } from "../_core/trpc";
import { orgScope } from "../_core/tenantDb";
import { sendEmail } from "../_core/email";
import { staffInviteEmail } from "../_core/emailTemplates";
import { appBaseUrl } from "../_core/urls";
import { hashOpaqueToken, randomToken, revokeAllSessionsForUser } from "../_core/localAuth";
import {
  INVITE_TTL_MS,
  adminRoles,
  salesRoles,
  catalogRoles,
  inventoryRoles,
  payrollRoles,
  tailoringRoles,
  staffDirectoryRoles,
  staffDocumentMimeTypes,
  staffDocumentExtensions,
  customPermissionValues,
  type CustomPermission,
  customRoleCanAccess,
  three,
  getMonthBounds,
  absenceDeductionFor,
  id,
  getDashboardRangeStart,
  getCustomDashboardRange,
  dashboardInput,
  salesSource,
  salesHistoryInput,
  invoiceListInput,
  invoicePaymentInput,
  invoiceDeleteInput,
  manualSaleInput,
  monthInput,
  getMonthWindow,
  dbOrThrow,
  access,
  audit,
  customerInput,
  tailoringOrderStatuses,
  tailoringStatus,
  tailoringListInput,
  tailoringRelationError,
  tailoringOrderInput,
} from "./shared";
export const teamRouter = router({
  listRoles: tenantProcedure.query(async ({ ctx }) => {
    await access(ctx.user.id, ctx.organizationId, adminRoles);
    const db = await dbOrThrow();
    const baseRoles = await db
      .select({
        userId: userBusinessRoles.userId,
        businessRole: userBusinessRoles.role,
        isActive: userBusinessRoles.isActive,
        name: users.name,
        email: users.email,
      })
      .from(userBusinessRoles)
      .leftJoin(users, eq(userBusinessRoles.userId, users.id))
      .where(orgScope(userBusinessRoles, ctx.organizationId));
    const assignments = await db
      .select()
      .from(userCustomRoles)
      .where(orgScope(userCustomRoles, ctx.organizationId));
    const definitions = await db
      .select()
      .from(customRoles)
      .where(orgScope(customRoles, ctx.organizationId));
    const byUser = new Map(
      assignments.map(assignment => [assignment.userId, assignment])
    );
    const byId = new Map(definitions.map(role => [role.id, role]));
    return baseRoles.map(base => {
      const assignment = byUser.get(base.userId);
      const customRole = assignment
        ? byId.get(assignment.customRoleId)
        : undefined;
      return {
        ...base,
        customRoleId: customRole?.id || null,
        customRoleName: customRole?.name || null,
        customRoleActive: Boolean(assignment?.isActive && customRole?.isActive),
      };
    });
  }),
  removeUser: tenantProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, adminRoles);
      if (input.userId === ctx.user.id)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "The owner account cannot be removed.",
        });
      const db = await dbOrThrow();
      const target = (
        await db
          .select({ id: users.id, role: users.role })
          .from(users)
          .where(
            and(eq(users.id, input.userId), orgScope(users, ctx.organizationId))
          )
          .limit(1)
      )[0];
      if (!target)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This user no longer exists.",
        });
      const targetBusinessRole = (
        await db
          .select()
          .from(userBusinessRoles)
          .where(
            and(
              eq(userBusinessRoles.userId, input.userId),
              orgScope(userBusinessRoles, ctx.organizationId)
            )
          )
          .limit(1)
      )[0];
      if (target.role === "admin" || targetBusinessRole?.role === "admin")
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Owner accounts cannot be removed.",
        });
      await db.transaction(async tx => {
        await tx
          .delete(userCustomRoles)
          .where(
            and(
              eq(userCustomRoles.userId, input.userId),
              orgScope(userCustomRoles, ctx.organizationId)
            )
          );
        await tx
          .delete(userBusinessRoles)
          .where(
            and(
              eq(userBusinessRoles.userId, input.userId),
              orgScope(userBusinessRoles, ctx.organizationId)
            )
          );
        await tx
          .delete(pendingAccessRequests)
          .where(
            and(
              eq(pendingAccessRequests.userId, input.userId),
              orgScope(pendingAccessRequests, ctx.organizationId)
            )
          );
        await tx
          .delete(staffAccessInvites)
          .where(
            and(
              eq(staffAccessInvites.acceptedByUserId, input.userId),
              orgScope(staffAccessInvites, ctx.organizationId)
            )
          );
        await tx
          .update(staffProfiles)
          .set({ userId: null, isActive: false, updatedAt: new Date() })
          .where(
            and(
              eq(staffProfiles.userId, input.userId),
              orgScope(staffProfiles, ctx.organizationId)
            )
          );
        await tx
          .delete(users)
          .where(
            and(eq(users.id, input.userId), orgScope(users, ctx.organizationId))
          );
      });
      // Their open sessions would otherwise linger until they expire.
      await revokeAllSessionsForUser(input.userId);
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "USER_REMOVED",
        "user",
        input.userId,
        {
          access: "revoked",
          records: "preserved",
        }
      );
      return { success: true };
    }),
  listCustomRoles: tenantProcedure.query(async ({ ctx }) => {
    await access(ctx.user.id, ctx.organizationId, adminRoles);
    const rows = await (await dbOrThrow())
      .select()
      .from(customRoles)
      .where(orgScope(customRoles, ctx.organizationId))
      .orderBy(customRoles.name);
    return rows.map(role => ({
      ...role,
      permissions: Array.isArray(role.permissionsJson)
        ? role.permissionsJson.filter(
            (value): value is string => typeof value === "string"
          )
        : [],
    }));
  }),
  createCustomRole: tenantProcedure
    .input(
      z.object({
        name: z.string().min(2).max(80),
        description: z.string().max(320),
        permissions: z.array(z.enum(customPermissionValues)).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, adminRoles);
      const result = await (
        await dbOrThrow()
      )
        .insert(customRoles)
        .values({
          organizationId: ctx.organizationId,
          name: input.name.trim(),
          description: input.description.trim() || null,
          permissionsJson: input.permissions,
          createdBy: ctx.user.id,
        })
        .returning({ id: customRoles.id });
      const roleId = id(result);
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "CUSTOM_ROLE_CREATED",
        "customRole",
        roleId,
        input
      );
      return { id: roleId };
    }),
  updateCustomRole: tenantProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().min(2).max(80),
        description: z.string().max(320),
        permissions: z.array(z.enum(customPermissionValues)).min(1),
        isActive: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, adminRoles);
      await (
        await dbOrThrow()
      )
        .update(customRoles)
        .set({
          name: input.name.trim(),
          description: input.description.trim() || null,
          permissionsJson: input.permissions,
          isActive: input.isActive,
        })
        .where(
          and(
            eq(customRoles.id, input.id),
            orgScope(customRoles, ctx.organizationId)
          )
        );
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "CUSTOM_ROLE_UPDATED",
        "customRole",
        input.id,
        input
      );
      return { success: true };
    }),
  assignCustomRole: tenantProcedure
    .input(
      z.object({
        userId: z.number().int().positive(),
        customRoleId: z.number().int().positive(),
        isActive: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, adminRoles);
      const db = await dbOrThrow();
      const [role, targetUser] = await Promise.all([
        db
          .select()
          .from(customRoles)
          .where(
            and(
              eq(customRoles.id, input.customRoleId),
              orgScope(customRoles, ctx.organizationId)
            )
          )
          .limit(1)
          .then(rows => rows[0]),
        db
          .select({ id: users.id })
          .from(users)
          .where(
            and(eq(users.id, input.userId), orgScope(users, ctx.organizationId))
          )
          .limit(1)
          .then(rows => rows[0]),
      ]);
      if (!role?.isActive)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Choose an active owner-managed role.",
        });
      // userCustomRoles.userId is globally unique (not per-org), so without
      // this check an admin could pass another organization's userId and
      // have onConflictDoUpdate silently hijack that user's role via the
      // unique-constraint conflict path.
      if (!targetUser)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found in your organization.",
        });
      await db
        .insert(userCustomRoles)
        .values({
          ...input,
          organizationId: ctx.organizationId,
          updatedBy: ctx.user.id,
        })
        .onConflictDoUpdate({
          target: userCustomRoles.userId,
          set: {
            customRoleId: input.customRoleId,
            isActive: input.isActive,
            updatedBy: ctx.user.id,
          },
        });
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "CUSTOM_ROLE_ASSIGNED",
        "user",
        input.userId,
        input
      );
      return { success: true };
    }),
  clearCustomRole: tenantProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, adminRoles);
      await (await dbOrThrow())
        .delete(userCustomRoles)
        .where(
          and(
            eq(userCustomRoles.userId, input.userId),
            orgScope(userCustomRoles, ctx.organizationId)
          )
        );
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "CUSTOM_ROLE_CLEARED",
        "user",
        input.userId
      );
      return { success: true };
    }),
  assignRole: tenantProcedure
    .input(
      z.object({
        userId: z.number().int(),
        role: z.enum(["admin", "sales", "tailor", "inventory", "payroll"]),
        isActive: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, adminRoles);
      const db = await dbOrThrow();
      // userBusinessRoles.userId is globally unique (not per-org): verify
      // the target belongs to this organization first, or an admin could
      // pass another organization's userId and hijack that user's role via
      // the onConflictDoUpdate unique-constraint conflict path.
      const targetUser = (
        await db
          .select({ id: users.id })
          .from(users)
          .where(
            and(eq(users.id, input.userId), orgScope(users, ctx.organizationId))
          )
          .limit(1)
      )[0];
      if (!targetUser)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found in your organization.",
        });
      // Same protection removeUser gives owners: another admin (or the owner
      // by mistake) must not be able to demote or deactivate the owner and
      // lock them out of their own shop.
      const organization = await getOrganizationById(ctx.organizationId);
      if (
        organization?.ownerId === input.userId &&
        (input.role !== "admin" || !input.isActive)
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "The shop owner must stay an active admin.",
        });
      await db
        .insert(userBusinessRoles)
        .values({ ...input, organizationId: ctx.organizationId })
        .onConflictDoUpdate({
          target: userBusinessRoles.userId,
          set: { role: input.role, isActive: input.isActive, isPlaceholder: false },
        });
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "BUSINESS_ROLE_ASSIGNED",
        "user",
        input.userId,
        input
      );
      return { success: true };
    }),
});

export const accessRouter = router({
  listInvites: tenantProcedure.query(async ({ ctx }) => {
    await access(ctx.user.id, ctx.organizationId, adminRoles);
    const db = await dbOrThrow();
    const [invites, roles] = await Promise.all([
      db
        .select()
        .from(staffAccessInvites)
        .where(orgScope(staffAccessInvites, ctx.organizationId))
        .orderBy(desc(staffAccessInvites.invitedAt)),
      db
        .select()
        .from(customRoles)
        .where(orgScope(customRoles, ctx.organizationId)),
    ]);
    const roleById = new Map(roles.map(role => [role.id, role]));
    return invites.map(invite => ({
      ...invite,
      tokenHash: undefined,
      roleName: roleById.get(invite.customRoleId)?.name || "Archived role",
    }));
  }),
  inviteStaff: tenantProcedure
    .input(
      z.object({
        name: z.string().trim().min(2).max(160),
        email: z.string().trim().email().max(320),
        customRoleId: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, adminRoles);
      const db = await dbOrThrow();
      const role = (
        await db
          .select()
          .from(customRoles)
          .where(
            and(
              eq(customRoles.id, input.customRoleId),
              orgScope(customRoles, ctx.organizationId)
            )
          )
          .limit(1)
      )[0];
      if (!role?.isActive)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Choose an active role before preparing staff access.",
        });
      const email = input.email.toLowerCase();
      const token = randomToken("invite");
      const tokenHash = hashOpaqueToken(token);
      const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
      await db
        .insert(staffAccessInvites)
        .values({
          organizationId: ctx.organizationId,
          name: input.name,
          email,
          tokenHash,
          expiresAt,
          customRoleId: role.id,
          invitedBy: ctx.user.id,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: [staffAccessInvites.organizationId, staffAccessInvites.email],
          set: {
            name: input.name,
            tokenHash,
            expiresAt,
            customRoleId: role.id,
            invitedBy: ctx.user.id,
            invitedAt: new Date(),
            isActive: true,
            acceptedByUserId: null,
            acceptedAt: null,
          },
        });
      const inviteUrl = `${appBaseUrl(ctx.req)}/?invite_token=${encodeURIComponent(token)}`;
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "STAFF_ACCESS_PREPARED",
        "staffAccessInvite",
        undefined,
        { email, roleId: role.id }
      );
      const organization = await getOrganizationById(ctx.organizationId);
      const { sent: emailSent } = await sendEmail(
        staffInviteEmail(email, {
          inviteeName: input.name,
          shopName: organization?.name ?? "your shop",
          roleName: role.name,
          inviteUrl,
        })
      );
      return { email, roleName: role.name, inviteUrl, emailSent };
    }),
  cancelInvite: tenantProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, adminRoles);
      const db = await dbOrThrow();
      await db
        .update(staffAccessInvites)
        .set({ isActive: false })
        .where(
          and(
            eq(staffAccessInvites.id, input.id),
            orgScope(staffAccessInvites, ctx.organizationId)
          )
        );
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "STAFF_ACCESS_CANCELLED",
        "staffAccessInvite",
        input.id
      );
      return { success: true };
    }),
  listPending: tenantProcedure.query(async ({ ctx }) => {
    await access(ctx.user.id, ctx.organizationId, adminRoles);
    const db = await dbOrThrow();
    const [requests, people] = await Promise.all([
      db
        .select()
        .from(pendingAccessRequests)
        .where(
          and(
            orgScope(pendingAccessRequests, ctx.organizationId),
            eq(pendingAccessRequests.status, "pending")
          )
        )
        .orderBy(desc(pendingAccessRequests.requestedAt)),
      db.select().from(users).where(orgScope(users, ctx.organizationId)),
    ]);
    const byId = new Map(people.map(person => [person.id, person]));
    return requests.map(request => ({
      ...request,
      name: byId.get(request.userId)?.name || `User #${request.userId}`,
      email: byId.get(request.userId)?.email || null,
    }));
  }),
  approvePending: tenantProcedure
    .input(
      z.object({
        requestId: z.number().int().positive(),
        customRoleId: z.number().int().positive(),
        note: z.string().max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, adminRoles);
      const db = await dbOrThrow();
      const [request, role] = await Promise.all([
        db
          .select()
          .from(pendingAccessRequests)
          .where(
            and(
              eq(pendingAccessRequests.id, input.requestId),
              orgScope(pendingAccessRequests, ctx.organizationId)
            )
          )
          .limit(1)
          .then(rows => rows[0]),
        db
          .select()
          .from(customRoles)
          .where(
            and(
              eq(customRoles.id, input.customRoleId),
              orgScope(customRoles, ctx.organizationId)
            )
          )
          .limit(1)
          .then(rows => rows[0]),
      ]);
      if (!request || request.status !== "pending")
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This access request is no longer waiting for review.",
        });
      if (!role?.isActive)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Choose an active owner-managed role.",
        });
      await db.transaction(async tx => {
        await tx
          .insert(userBusinessRoles)
          .values({
            userId: request.userId,
            organizationId: ctx.organizationId,
            role: "sales",
            isActive: true,
            isPlaceholder: true,
          })
          .onConflictDoUpdate({
            target: userBusinessRoles.userId,
            set: { isActive: true },
          });
        await tx
          .insert(userCustomRoles)
          .values({
            userId: request.userId,
            organizationId: ctx.organizationId,
            customRoleId: role.id,
            isActive: true,
            updatedBy: ctx.user.id,
          })
          .onConflictDoUpdate({
            target: userCustomRoles.userId,
            set: {
              customRoleId: role.id,
              isActive: true,
              updatedBy: ctx.user.id,
            },
          });
        await tx
          .update(pendingAccessRequests)
          .set({
            status: "approved",
            reviewedAt: new Date(),
            reviewedBy: ctx.user.id,
            note: input.note || null,
          })
          .where(
            and(
              eq(pendingAccessRequests.id, request.id),
              orgScope(pendingAccessRequests, ctx.organizationId)
            )
          );
      });
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "ACCESS_REQUEST_APPROVED",
        "pendingAccessRequest",
        request.id,
        { userId: request.userId, roleId: role.id }
      );
      return { success: true };
    }),
  rejectPending: tenantProcedure
    .input(
      z.object({
        requestId: z.number().int().positive(),
        note: z.string().max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, adminRoles);
      const db = await dbOrThrow();
      const request = (
        await db
          .select()
          .from(pendingAccessRequests)
          .where(
            and(
              eq(pendingAccessRequests.id, input.requestId),
              orgScope(pendingAccessRequests, ctx.organizationId)
            )
          )
          .limit(1)
      )[0];
      if (!request || request.status !== "pending")
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This access request is no longer waiting for review.",
        });
      await db
        .update(pendingAccessRequests)
        .set({
          status: "rejected",
          reviewedAt: new Date(),
          reviewedBy: ctx.user.id,
          note: input.note || null,
        })
        .where(
          and(
            eq(pendingAccessRequests.id, request.id),
            orgScope(pendingAccessRequests, ctx.organizationId)
          )
        );
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "ACCESS_REQUEST_REJECTED",
        "pendingAccessRequest",
        request.id,
        { userId: request.userId }
      );
      return { success: true };
    }),
});

export const accessApprovalRouter = router({
  approveWithPermissions: tenantProcedure
    .input(
      z.object({
        requestId: z.number().int().positive(),
        name: z.string().trim().min(2).max(80),
        description: z.string().trim().max(320),
        permissions: z
          .array(
            z.enum([
              "dashboard",
              "customers",
              "sales",
              "inventory",
              "production",
              "payroll",
            ])
          )
          .min(1),
        note: z.string().max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, adminRoles);
      const db = await dbOrThrow();
      const request = (
        await db
          .select()
          .from(pendingAccessRequests)
          .where(
            and(
              eq(pendingAccessRequests.id, input.requestId),
              orgScope(pendingAccessRequests, ctx.organizationId)
            )
          )
          .limit(1)
      )[0];
      if (!request || request.status !== "pending")
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This access request is no longer waiting for review.",
        });
      const transaction = await db.transaction(async tx => {
        const roleResult = await tx
          .insert(customRoles)
          .values({
            organizationId: ctx.organizationId,
            name: input.name,
            description: input.description || null,
            permissionsJson: input.permissions,
            isActive: true,
            createdBy: ctx.user.id,
          })
          .returning({ id: customRoles.id });
        const roleId = id(roleResult);
        await tx
          .insert(userBusinessRoles)
          .values({
            userId: request.userId,
            organizationId: ctx.organizationId,
            role: "sales",
            isActive: true,
            isPlaceholder: true,
          })
          .onConflictDoUpdate({
            target: userBusinessRoles.userId,
            set: { isActive: true },
          });
        await tx
          .insert(userCustomRoles)
          .values({
            userId: request.userId,
            organizationId: ctx.organizationId,
            customRoleId: roleId,
            isActive: true,
            updatedBy: ctx.user.id,
          })
          .onConflictDoUpdate({
            target: userCustomRoles.userId,
            set: {
              customRoleId: roleId,
              isActive: true,
              updatedBy: ctx.user.id,
            },
          });
        await tx
          .update(pendingAccessRequests)
          .set({
            status: "approved",
            reviewedAt: new Date(),
            reviewedBy: ctx.user.id,
            note: input.note || null,
          })
          .where(
            and(
              eq(pendingAccessRequests.id, request.id),
              orgScope(pendingAccessRequests, ctx.organizationId)
            )
          );
        return roleId;
      });
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "ACCESS_REQUEST_APPROVED_WITH_PERMISSIONS",
        "pendingAccessRequest",
        request.id,
        { userId: request.userId, roleId: transaction }
      );
      return { roleId: transaction };
    }),
});
