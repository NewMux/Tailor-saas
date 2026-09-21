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
export const invoicesRouter = router({
  list: tenantProcedure
    .input(invoiceListInput.optional())
    .query(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, salesRoles);
      const db = await dbOrThrow();
      const search = input?.search?.trim().toLowerCase();
      const start = input?.startDate
        ? new Date(`${input.startDate}T00:00:00.000Z`)
        : null;
      const end = input?.endDate
        ? new Date(`${input.endDate}T23:59:59.999Z`)
        : null;
      const [invoiceRows, saleRows] = await Promise.all([
        db
          .select()
          .from(invoices)
          .where(orgScope(invoices, ctx.organizationId))
          .orderBy(desc(invoices.issuedAt))
          .limit(500),
        db
          .select()
          .from(sales)
          .where(orgScope(sales, ctx.organizationId))
          .orderBy(desc(sales.createdAt))
          .limit(500),
      ]);
      const saleById = new Map(saleRows.map(sale => [sale.id, sale]));
      return invoiceRows
        .map(invoice => ({
          ...invoice,
          sale: saleById.get(invoice.saleId) || null,
        }))
        .filter(
          row =>
            (!input?.status || row.status === input.status) &&
            (!input?.source || row.sale?.source === input.source) &&
            (!input?.paymentMethod ||
              row.sale?.paymentMethod === input.paymentMethod) &&
            (!start || row.issuedAt >= start) &&
            (!end || row.issuedAt <= end) &&
            (!search ||
              [
                row.invoiceNumber,
                row.sale?.saleNumber || "",
                row.sale?.customerNameSnapshot || "",
                row.sale?.customerPhoneSnapshot || "",
              ].some(value => value.toLowerCase().includes(search)))
        );
    }),
  detail: tenantProcedure
    .input(z.object({ invoiceId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, salesRoles);
      const db = await dbOrThrow();
      const invoice = (
        await db
          .select()
          .from(invoices)
          .where(
            and(
              eq(invoices.id, input.invoiceId),
              orgScope(invoices, ctx.organizationId)
            )
          )
          .limit(1)
      )[0];
      if (!invoice)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Invoice not found.",
        });
      const sale = (
        await db
          .select()
          .from(sales)
          .where(
            and(
              eq(sales.id, invoice.saleId),
              orgScope(sales, ctx.organizationId)
            )
          )
          .limit(1)
      )[0];
      if (!sale)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Sale for this invoice was not found.",
        });
      const items = await db
        .select()
        .from(saleItems)
        .where(
          and(
            eq(saleItems.saleId, sale.id),
            orgScope(saleItems, ctx.organizationId)
          )
        );
      const shop =
        (
          await db
            .select()
            .from(shopSettings)
            .where(orgScope(shopSettings, ctx.organizationId))
            .limit(1)
        )[0] || null;
      const [deliveries, paymentRecords] = await Promise.all([
        db
          .select()
          .from(invoiceDeliveries)
          .where(
            and(
              eq(invoiceDeliveries.invoiceId, invoice.id),
              orgScope(invoiceDeliveries, ctx.organizationId)
            )
          )
          .orderBy(desc(invoiceDeliveries.createdAt))
          .limit(20),
        db
          .select()
          .from(invoicePayments)
          .where(
            and(
              eq(invoicePayments.invoiceId, invoice.id),
              orgScope(invoicePayments, ctx.organizationId)
            )
          )
          .orderBy(invoicePayments.createdAt, invoicePayments.id)
          .limit(200),
      ]);
      return { invoice, sale, items, shop, deliveries, paymentRecords };
    }),
  addPayment: tenantProcedure
    .input(invoicePaymentInput)
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, salesRoles);
      const db = await dbOrThrow();
      const result = await db.transaction(async tx => {
        const invoice = (
          await tx
            .select()
            .from(invoices)
            .where(
              and(
                eq(invoices.id, input.invoiceId),
                orgScope(invoices, ctx.organizationId)
              )
            )
            .for("update")
            .limit(1)
        )[0];
        if (!invoice)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Invoice not found.",
          });
        const sale = (
          await tx
            .select()
            .from(sales)
            .where(
              and(
                eq(sales.id, invoice.saleId),
                orgScope(sales, ctx.organizationId)
              )
            )
            .for("update")
            .limit(1)
        )[0];
        if (!sale)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Sale for this invoice was not found.",
          });
        const total = Number(sale.total || 0);
        const previousPaid = Number(sale.paidAmount || 0);
        const amount = Number(input.amount.toFixed(3));
        const remainingBefore = Math.max(0, total - previousPaid);
        if (remainingBefore <= 0.001)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This invoice is already fully paid.",
          });
        if (amount > remainingBefore + 0.001)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Payment cannot exceed the remaining balance of ${remainingBefore.toFixed(3)} BHD.`,
          });
        const paidTotal = Math.min(total, previousPaid + amount);
        const remainingAmount = Math.max(0, total - paidTotal);
        const nextStatus =
          paidTotal >= total - 0.001
            ? "paid"
            : paidTotal > 0
              ? "partial"
              : "unpaid";
        const paymentResult = await tx
          .insert(invoicePayments)
          .values({
            organizationId: ctx.organizationId,
            invoiceId: invoice.id,
            amount: amount.toFixed(3),
            paymentMethod: input.paymentMethod,
            reference: input.reference || null,
            previousPaidAmount: previousPaid.toFixed(3),
            paidTotal: paidTotal.toFixed(3),
            remainingAmount: remainingAmount.toFixed(3),
            createdBy: ctx.user.id,
          })
          .returning({
            id: invoicePayments.id,
            createdAt: invoicePayments.createdAt,
          });
        await tx.insert(posPayments).values({
          organizationId: ctx.organizationId,
          saleId: sale.id,
          method: input.paymentMethod,
          amount: amount.toFixed(3),
          reference: input.reference || `${invoice.invoiceNumber} payment`,
          createdBy: ctx.user.id,
        });
        await tx
          .update(sales)
          .set({
            paidAmount: paidTotal.toFixed(3),
            paymentStatus: nextStatus,
            paymentMethod: input.paymentMethod,
          })
          .where(
            and(eq(sales.id, sale.id), orgScope(sales, ctx.organizationId))
          );
        await tx
          .update(invoices)
          .set({ status: nextStatus })
          .where(
            and(
              eq(invoices.id, invoice.id),
              orgScope(invoices, ctx.organizationId)
            )
          );
        return {
          invoice,
          sale,
          payment: {
            id: Number(paymentResult[0]?.id || 0),
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            amount: amount.toFixed(3),
            previousPaidAmount: previousPaid.toFixed(3),
            paidTotal: paidTotal.toFixed(3),
            remainingAmount: remainingAmount.toFixed(3),
            paymentMethod: input.paymentMethod,
            reference: input.reference || null,
            createdAt: paymentResult[0]?.createdAt || new Date(),
          },
          total,
          paidTotal,
          remainingAmount,
          paymentStatus: nextStatus,
        };
      });
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "INVOICE_PAYMENT_ADDED",
        "invoice",
        input.invoiceId,
        {
          amount: result.payment.amount,
          paidTotal: result.paidTotal,
          remainingAmount: result.remainingAmount,
          paymentMethod: input.paymentMethod,
        }
      );
      return result;
    }),
  delete: tenantProcedure
    .input(invoiceDeleteInput)
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, adminRoles);
      const db = await dbOrThrow();
      const result = await db.transaction(async tx => {
        const invoice = (
          await tx
            .select()
            .from(invoices)
            .where(
              and(
                eq(invoices.id, input.invoiceId),
                orgScope(invoices, ctx.organizationId)
              )
            )
            .for("update")
            .limit(1)
        )[0];
        if (!invoice)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Invoice not found.",
          });
        const sale = (
          await tx
            .select()
            .from(sales)
            .where(
              and(
                eq(sales.id, invoice.saleId),
                orgScope(sales, ctx.organizationId)
              )
            )
            .for("update")
            .limit(1)
        )[0];
        if (!sale)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Sale for this invoice was not found.",
          });
        const lines = await tx
          .select()
          .from(saleItems)
          .where(
            and(
              eq(saleItems.saleId, sale.id),
              orgScope(saleItems, ctx.organizationId)
            )
          );
        const stockLines = lines.filter(
          line => line.inventoryItemId && Number(line.quantity) > 0
        );
        for (const line of stockLines) {
          const item = (
            await tx
              .select()
              .from(inventoryItems)
              .where(
                and(
                  eq(inventoryItems.id, line.inventoryItemId!),
                  orgScope(inventoryItems, ctx.organizationId)
                )
              )
              .for("update")
              .limit(1)
          )[0];
          if (!item) continue;
          const quantityBefore = Number(item.quantity || 0);
          const quantityAfter = quantityBefore + Number(line.quantity);
          await tx
            .update(inventoryItems)
            .set({ quantity: three(quantityAfter) })
            .where(
              and(
                eq(inventoryItems.id, item.id),
                orgScope(inventoryItems, ctx.organizationId)
              )
            );
          await tx.insert(stockMovements).values({
            organizationId: ctx.organizationId,
            inventoryItemId: item.id,
            movementType: "return",
            quantityChange: three(Number(line.quantity)),
            quantityBefore: three(quantityBefore),
            quantityAfter: three(quantityAfter),
            referenceType: "invoice_delete",
            referenceId: invoice.id,
            createdBy: ctx.user.id,
            notes: `Restored stock after deleting ${invoice.invoiceNumber}`,
          });
        }
        await tx
          .update(tailoringOrders)
          .set({ saleId: null, updatedAt: new Date() })
          .where(
            and(
              eq(tailoringOrders.saleId, sale.id),
              orgScope(tailoringOrders, ctx.organizationId)
            )
          );
        await tx
          .delete(invoiceDeliveries)
          .where(
            and(
              eq(invoiceDeliveries.invoiceId, invoice.id),
              orgScope(invoiceDeliveries, ctx.organizationId)
            )
          );
        await tx
          .delete(invoicePayments)
          .where(
            and(
              eq(invoicePayments.invoiceId, invoice.id),
              orgScope(invoicePayments, ctx.organizationId)
            )
          );
        await tx
          .delete(posPayments)
          .where(
            and(
              eq(posPayments.saleId, sale.id),
              orgScope(posPayments, ctx.organizationId)
            )
          );
        await tx
          .delete(saleItems)
          .where(
            and(
              eq(saleItems.saleId, sale.id),
              orgScope(saleItems, ctx.organizationId)
            )
          );
        await tx
          .delete(invoices)
          .where(
            and(
              eq(invoices.id, invoice.id),
              orgScope(invoices, ctx.organizationId)
            )
          );
        await tx
          .delete(sales)
          .where(
            and(eq(sales.id, sale.id), orgScope(sales, ctx.organizationId))
          );
        return {
          invoiceNumber: invoice.invoiceNumber,
          saleNumber: sale.saleNumber,
          restoredStockLines: stockLines.length,
        };
      });
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "INVOICE_DELETED",
        "invoice",
        input.invoiceId,
        result
      );
      return result;
    }),
  prepareDelivery: tenantProcedure
    .input(
      z.object({
        invoiceId: z.number().int().positive(),
        channel: z.enum(["email", "whatsapp", "share"]),
        recipient: z.string().trim().max(320).optional(),
        message: z.string().trim().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, salesRoles);
      const db = await dbOrThrow();
      const invoice = (
        await db
          .select()
          .from(invoices)
          .where(
            and(
              eq(invoices.id, input.invoiceId),
              orgScope(invoices, ctx.organizationId)
            )
          )
          .limit(1)
      )[0];
      if (!invoice)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Invoice not found.",
        });
      const result = await db
        .insert(invoiceDeliveries)
        .values({
          organizationId: ctx.organizationId,
          invoiceId: input.invoiceId,
          channel: input.channel,
          recipient: input.recipient || null,
          status: "prepared",
          message: input.message || null,
          createdBy: ctx.user.id,
        })
        .returning({ id: invoiceDeliveries.id });
      const deliveryId = id(result);
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "INVOICE_DELIVERY_PREPARED",
        "invoice",
        input.invoiceId,
        { channel: input.channel, recipient: input.recipient }
      );
      return { id: deliveryId, status: "prepared" as const };
    }),
});
