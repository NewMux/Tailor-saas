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
import { getDb } from "../db";
import {
  effectiveInventoryQuantity,
  rollDerivedQuantity,
} from "../inventoryQuantity";
export { rollDerivedQuantity } from "../inventoryQuantity";
import { storageGetSignedUrl, storagePut } from "../storage";
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
export const servicesRouter = router({
  list: tenantProcedure.query(async ({ ctx }) => {
    await access(ctx.user.id, ctx.organizationId, catalogRoles);
    const records = await (
      await dbOrThrow()
    )
      .select({ service: services, inventory: inventoryItems })
      .from(services)
      .leftJoin(inventoryItems, eq(services.inventoryItemId, inventoryItems.id))
      .where(
        and(orgScope(services, ctx.organizationId), eq(services.isActive, true))
      )
      .orderBy(services.name);
    return records.map(record => ({
      ...record.service,
      inventory: record.inventory?.id
        ? {
            id: record.inventory.id,
            code: record.inventory.code,
            name: record.inventory.name,
            quantity: record.inventory.quantity,
            unit: record.inventory.unit,
            isActive: record.inventory.isActive,
          }
        : null,
    }));
  }),
  create: tenantProcedure
    .input(
      z.object({
        sku: z.string().min(1),
        name: z.string().min(2),
        category: z.enum([
          "tailoring",
          "fabric",
          "alteration",
          "accessory",
          "other",
        ]),
        description: z.string(),
        unitPrice: z.number().positive(),
        inventoryItemId: z.number().int().optional(),
        defaultFabricMeters: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, inventoryRoles);
      const result = await (
        await dbOrThrow()
      )
        .insert(services)
        .values({
          ...input,
          organizationId: ctx.organizationId,
          description: input.description || null,
          unitPrice: three(input.unitPrice),
          defaultFabricMeters: input.defaultFabricMeters?.toString(),
        })
        .returning({ id: services.id });
      const serviceId = id(result);
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "SERVICE_CREATED",
        "service",
        serviceId
      );
      return { id: serviceId };
    }),
});
