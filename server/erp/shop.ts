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
  staffProfiles,
  stockMovements,
  tailoringOrders,
  userBusinessRoles,
  userCustomRoles,
  users,
  type BusinessRole,
} from "../../drizzle/schema";
import { getDb } from "../db";
import {
  effectiveInventoryQuantity,
  rollDerivedQuantity,
} from "../inventoryQuantity";
export { rollDerivedQuantity } from "../inventoryQuantity";
import { tenantProcedure, router } from "../_core/trpc";
import { orgScope } from "../_core/tenantDb";
import { ENV } from "../_core/env";
import { hashOpaqueToken, randomToken } from "../_core/localAuth";
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
export const shopRouter = router({
  get: tenantProcedure.query(async ({ ctx }) => {
    await access(ctx.user.id, ctx.organizationId, [
      "admin",
      "sales",
      "inventory",
      "tailor",
      "payroll",
    ]);
    return (await dbOrThrow())
      .select()
      .from(shopSettings)
      .where(orgScope(shopSettings, ctx.organizationId))
      .limit(1)
      .then(rows => rows[0] || null);
  }),
  save: tenantProcedure
    .input(
      z.object({
        shopName: z.string().min(2),
        arabicShopName: z.string(),
        crNumber: z.string(),
        currency: z.string(),
        phone: z.string(),
        email: z.string(),
        address: z.string(),
        invoicePrefix: z.string().min(1).max(16),
        invoiceTerms: z.string().max(4000).optional(),
        vatEnabled: z.boolean().default(false),
        vatRate: z.number().min(0).max(100).default(10),
        vatNumber: z.string().max(80).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, adminRoles);
      const db = await dbOrThrow();
      const values = {
        ...input,
        vatRate: input.vatRate.toFixed(3),
        vatNumber: input.vatNumber || null,
        updatedBy: ctx.user.id,
      };
      const existing = (
        await db
          .select()
          .from(shopSettings)
          .where(orgScope(shopSettings, ctx.organizationId))
          .limit(1)
      )[0];
      if (existing)
        await db
          .update(shopSettings)
          .set(values)
          .where(
            and(
              eq(shopSettings.id, existing.id),
              orgScope(shopSettings, ctx.organizationId)
            )
          );
      else
        await db
          .insert(shopSettings)
          .values({ ...values, organizationId: ctx.organizationId });
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "SHOP_SETTINGS_SAVED",
        "shopSettings",
        existing?.id
      );
      return { success: true };
    }),
});
