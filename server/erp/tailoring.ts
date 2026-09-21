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
export const tailoringRouter = router({
  list: tenantProcedure
    .input(tailoringListInput.optional())
    .query(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, tailoringRoles);
      const db = await dbOrThrow();
      const [
        orders,
        clientRows,
        tailorRows,
        measurementRows,
        saleRows,
        invoiceRows,
      ] = await Promise.all([
        db
          .select()
          .from(tailoringOrders)
          .where(orgScope(tailoringOrders, ctx.organizationId))
          .orderBy(desc(tailoringOrders.createdAt))
          .limit(100),
        db
          .select()
          .from(customers)
          .where(orgScope(customers, ctx.organizationId)),
        db
          .select()
          .from(staffProfiles)
          .where(orgScope(staffProfiles, ctx.organizationId)),
        db
          .select()
          .from(measurementProfiles)
          .where(orgScope(measurementProfiles, ctx.organizationId)),
        db
          .select({
            id: sales.id,
            saleNumber: sales.saleNumber,
            paidAmount: sales.paidAmount,
            total: sales.total,
            paymentStatus: sales.paymentStatus,
            paymentMethod: sales.paymentMethod,
          })
          .from(sales)
          .where(orgScope(sales, ctx.organizationId))
          .orderBy(desc(sales.createdAt))
          .limit(500),
        db
          .select({
            saleId: invoices.saleId,
            invoiceNumber: invoices.invoiceNumber,
            status: invoices.status,
          })
          .from(invoices)
          .where(orgScope(invoices, ctx.organizationId))
          .limit(500),
      ]);
      const clients = new Map(clientRows.map(client => [client.id, client]));
      const tailors = new Map(tailorRows.map(tailor => [tailor.id, tailor]));
      const measurements = new Map(
        measurementRows.map(profile => [profile.id, profile])
      );
      const salesById = new Map(saleRows.map(sale => [sale.id, sale]));
      const invoicesBySaleId = new Map(
        invoiceRows.map(invoice => [invoice.saleId, invoice])
      );
      const mappedOrders = orders.map(order => ({
        ...order,
        sale: order.saleId ? salesById.get(order.saleId) || null : null,
        invoice: order.saleId
          ? invoicesBySaleId.get(order.saleId) || null
          : null,
        customerName:
          clients.get(order.customerId)?.name || "Archived customer",
        customerPhone: clients.get(order.customerId)?.phone || null,
        tailorName: order.assignedTailorId
          ? tailors.get(order.assignedTailorId)?.name || "Former tailor"
          : null,
        measurementVersion: order.measurementProfileId
          ? measurements.get(order.measurementProfileId)?.version || null
          : null,
      }));
      const search = input?.search?.trim().toLowerCase();
      return mappedOrders.filter(
        order =>
          !search ||
          [
            order.orderNumber,
            order.customerName,
            order.customerPhone || "",
            order.dueDate
              ? new Date(order.dueDate).toISOString().slice(0, 10)
              : "",
            order.createdAt
              ? new Date(order.createdAt).toISOString().slice(0, 10)
              : "",
          ].some(value => String(value).toLowerCase().includes(search))
      );
    }),
  create: tenantProcedure
    .input(tailoringOrderInput)
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, tailoringRoles);
      const db = await dbOrThrow();
      const customer = (
        await db
          .select()
          .from(customers)
          .where(
            and(
              eq(customers.id, input.customerId),
              orgScope(customers, ctx.organizationId)
            )
          )
          .limit(1)
      )[0];
      if (!customer)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Choose a valid customer for the tailoring order.",
        });
      const profile = input.measurementProfileId
        ? (
            await db
              .select()
              .from(measurementProfiles)
              .where(
                and(
                  eq(measurementProfiles.id, input.measurementProfileId),
                  orgScope(measurementProfiles, ctx.organizationId)
                )
              )
              .limit(1)
          )[0]
        : null;
      const tailor = input.assignedTailorId
        ? (
            await db
              .select()
              .from(staffProfiles)
              .where(
                and(
                  eq(staffProfiles.id, input.assignedTailorId),
                  orgScope(staffProfiles, ctx.organizationId)
                )
              )
              .limit(1)
          )[0]
        : null;
      const relationError = tailoringRelationError(
        input.customerId,
        profile?.customerId,
        input.assignedTailorId ? Boolean(tailor?.isActive) : null
      );
      if (relationError === "measurement")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Save or choose a measurement version belonging to this customer before confirming the tailoring order.",
        });
      if (relationError === "tailor")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Choose an active tailor.",
        });
      const orderNumber = `TO-${Date.now()}`;
      const result = await db
        .insert(tailoringOrders)
        .values({
          ...input,
          organizationId: ctx.organizationId,
          orderNumber,
          measurementProfileId: input.measurementProfileId || null,
          assignedTailorId: input.assignedTailorId || null,
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          price: three(input.price),
          customerSuppliedFabric: input.customerSuppliedFabric,
          fabricNotes: input.fabricNotes || null,
          notes: input.notes || null,
          productionNotes: input.productionNotes || null,
          createdBy: ctx.user.id,
          status: "confirmed",
        })
        .returning({ id: tailoringOrders.id });
      const orderId = id(result);
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "TAILORING_ORDER_CREATED",
        "tailoringOrder",
        orderId,
        {
          orderNumber,
          customerId: input.customerId,
          garmentType: input.garmentType,
          dueDate: input.dueDate,
        }
      );
      return { id: orderId, orderNumber };
    }),
  update: tenantProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        assignedTailorId: z.number().int().positive().optional(),
        status: tailoringStatus,
        dueDate: z.string().optional(),
        productionNotes: z.string().max(3000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, tailoringRoles);
      const db = await dbOrThrow();
      const current = (
        await db
          .select()
          .from(tailoringOrders)
          .where(
            and(
              eq(tailoringOrders.id, input.id),
              orgScope(tailoringOrders, ctx.organizationId)
            )
          )
          .limit(1)
      )[0];
      if (!current)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Tailoring order not found.",
        });
      if (input.assignedTailorId) {
        const tailor = (
          await db
            .select()
            .from(staffProfiles)
            .where(
              and(
                eq(staffProfiles.id, input.assignedTailorId),
                orgScope(staffProfiles, ctx.organizationId)
              )
            )
            .limit(1)
        )[0];
        if (!tailor?.isActive)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Choose an active tailor.",
          });
      }
      await db
        .update(tailoringOrders)
        .set({
          assignedTailorId: input.assignedTailorId || null,
          status: input.status,
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          productionNotes: input.productionNotes || null,
        })
        .where(
          and(
            eq(tailoringOrders.id, input.id),
            orgScope(tailoringOrders, ctx.organizationId)
          )
        );
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "TAILORING_ORDER_UPDATED",
        "tailoringOrder",
        input.id,
        input
      );
      return { success: true };
    }),
});
