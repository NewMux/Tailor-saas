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
import { assertOwned, orgScope } from "../_core/tenantDb";
import { ENV } from "../_core/env";
import { hashOpaqueToken, randomToken } from "../_core/localAuth";
import {
  INVITE_TTL_MS,
  adminRoles,
  salesRoles,
  customerReadRoles,
  customerWriteRoles,
  measurementWriteRoles,
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
export const customersRouter = router({
  list: tenantProcedure
    .input(z.object({ search: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, customerReadRoles);
      const db = await dbOrThrow();
      const search = input?.search?.trim();
      const where = and(
        orgScope(customers, ctx.organizationId),
        eq(customers.isActive, true),
        search
          ? or(
              like(customers.name, `%${search}%`),
              like(customers.phone, `%${search}%`)
            )
          : undefined
      );
      return db
        .select()
        .from(customers)
        .where(where)
        .orderBy(desc(customers.createdAt))
        .limit(20);
    }),
  create: tenantProcedure
    .input(customerInput)
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, customerWriteRoles);
      const db = await dbOrThrow();
      const result = await db
        .insert(customers)
        .values({
          ...input,
          organizationId: ctx.organizationId,
          email: input.email || null,
          address: input.address || null,
          notes: input.notes || null,
        })
        .returning({ id: customers.id });
      const customerId = id(result);
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "CUSTOMER_CREATED",
        "customer",
        customerId
      );
      return { id: customerId };
    }),
  update: tenantProcedure
    .input(customerInput.extend({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, customerWriteRoles);
      const db = await dbOrThrow();
      await db
        .update(customers)
        .set({
          ...input,
          email: input.email || null,
          address: input.address || null,
          notes: input.notes || null,
        })
        .where(
          and(
            eq(customers.id, input.id),
            orgScope(customers, ctx.organizationId)
          )
        );
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "CUSTOMER_UPDATED",
        "customer",
        input.id
      );
      return { success: true };
    }),
  remove: tenantProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, salesRoles);
      const db = await dbOrThrow();
      const customer = (
        await db
          .select({ id: customers.id, name: customers.name })
          .from(customers)
          .where(
            and(
              eq(customers.id, input.id),
              orgScope(customers, ctx.organizationId)
            )
          )
          .limit(1)
      )[0];
      if (!customer)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Customer not found.",
        });
      await db
        .update(customers)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          and(
            eq(customers.id, input.id),
            orgScope(customers, ctx.organizationId)
          )
        );
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "CUSTOMER_ARCHIVED",
        "customer",
        input.id,
        {
          name: customer.name,
        }
      );
      return { success: true, id: input.id, name: customer.name };
    }),
  balance: tenantProcedure
    .input(z.object({ customerId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, salesRoles);
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
          message: "Customer not found.",
        });
      const rows = await db
        .select()
        .from(sales)
        .where(
          and(
            eq(sales.customerId, input.customerId),
            orgScope(sales, ctx.organizationId)
          )
        )
        .orderBy(desc(sales.createdAt))
        .limit(500);
      const balance = rows.reduce(
        (sum, sale) =>
          sum + Math.max(0, Number(sale.total) - Number(sale.paidAmount)),
        0
      );
      return {
        customer,
        balance,
        openInvoices: rows
          .filter(sale => Number(sale.total) - Number(sale.paidAmount) > 0.001)
          .map(sale => ({
            saleNumber: sale.saleNumber,
            total: Number(sale.total),
            paidAmount: Number(sale.paidAmount),
            outstanding: Number(sale.total) - Number(sale.paidAmount),
            createdAt: sale.createdAt,
          })),
      };
    }),
  sendBalance: tenantProcedure
    .input(
      z.object({
        customerId: z.number().int().positive(),
        channel: z.enum(["email", "whatsapp", "share"]),
        recipient: z.string().trim().max(320).optional(),
        message: z.string().max(4000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, salesRoles);
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
          message: "Customer not found.",
        });
      const recipient =
        input.recipient ||
        (input.channel === "email"
          ? customer.email || undefined
          : customer.phone || undefined);
      if (!recipient)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Add a ${input.channel === "email" ? "customer email" : "customer phone number"} before sending the balance.`,
        });
      const balance = (
        await db
          .select()
          .from(sales)
          .where(
            and(
              eq(sales.customerId, input.customerId),
              orgScope(sales, ctx.organizationId)
            )
          )
          .limit(500)
      ).reduce(
        (sum, sale) =>
          sum + Math.max(0, Number(sale.total) - Number(sale.paidAmount)),
        0
      );
      const message =
        input.message ||
        `Dear ${customer.name}, your current outstanding balance is ${balance.toFixed(3)} BHD.`;
      const result = await db
        .insert(customerBalanceDeliveries)
        .values({
          organizationId: ctx.organizationId,
          customerId: customer.id,
          channel: input.channel,
          recipient,
          message,
          status: "prepared",
          createdBy: ctx.user.id,
        })
        .returning({ id: customerBalanceDeliveries.id });
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "CUSTOMER_BALANCE_DELIVERY_PREPARED",
        "customer",
        customer.id,
        { channel: input.channel, recipient, balance }
      );
      return {
        id: Number(result[0]?.id || 0),
        channel: input.channel,
        recipient,
        balance,
        message,
      };
    }),
  measurements: tenantProcedure
    .input(z.object({ customerId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, customerReadRoles);
      return (await dbOrThrow())
        .select()
        .from(measurementProfiles)
        .where(
          and(
            eq(measurementProfiles.customerId, input.customerId),
            orgScope(measurementProfiles, ctx.organizationId)
          )
        )
        .orderBy(desc(measurementProfiles.version));
    }),
  addMeasurement: tenantProcedure
    .input(
      z.object({
        customerId: z.number().int(),
        measurements: z.record(z.string(), z.string()),
        fitPreference: z.string(),
        collarStyle: z.string(),
        pocketStyle: z.string(),
        notes: z.string(),
        effectiveDate: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, measurementWriteRoles);
      await assertOwned(customers, input.customerId, ctx.organizationId, "Customer");
      const db = await dbOrThrow();
      const latest = (
        await db
          .select({ version: max(measurementProfiles.version) })
          .from(measurementProfiles)
          .where(
            and(
              eq(measurementProfiles.customerId, input.customerId),
              orgScope(measurementProfiles, ctx.organizationId)
            )
          )
      )[0];
      const result = await db
        .insert(measurementProfiles)
        .values({
          ...input,
          organizationId: ctx.organizationId,
          measurementsJson: input.measurements,
          version: Number(latest?.version || 0) + 1,
          effectiveDate: new Date(input.effectiveDate),
          createdBy: ctx.user.id,
        })
        .returning({ id: measurementProfiles.id });
      const profileId = id(result);
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "MEASUREMENT_VERSION_CREATED",
        "measurementProfile",
        profileId
      );
      return { id: profileId };
    }),
});
