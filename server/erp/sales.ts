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
export const salesRouter = router({
  list: tenantProcedure.query(async ({ ctx }) => {
    await access(ctx.user.id, ctx.organizationId, salesRoles);
    return (await dbOrThrow())
      .select()
      .from(sales)
      .where(orgScope(sales, ctx.organizationId))
      .orderBy(desc(sales.createdAt))
      .limit(100);
  }),
  create: tenantProcedure
    .input(
      z.object({
        customerId: z.number().int().optional(),
        customerName: z.string().min(1),
        customerPhone: z.string().optional(),
        discount: z.number().min(0),
        paymentMethod: z.enum([
          "cash",
          "benefitpay",
          "bank_transfer",
          "credit_card",
        ]),
        paymentStatus: z.enum(["paid", "partial", "unpaid"]),
        items: z
          .array(
            z.object({
              serviceId: z.number().int().optional(),
              inventoryItemId: z.number().int().optional(),
              name: z.string().min(1),
              quantity: z.number().positive(),
              unitPrice: z.number().nonnegative(),
            })
          )
          .min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, salesRoles);
      const db = await dbOrThrow();
      const shop = (
        await db
          .select()
          .from(shopSettings)
          .where(orgScope(shopSettings, ctx.organizationId))
          .limit(1)
      )[0];
      const subtotal = input.items.reduce(
        (sum, item) => sum + item.quantity * item.unitPrice,
        0
      );
      const total = Math.max(0, subtotal - input.discount);
      const saleNumber = `SALE-${Date.now()}`;
      const invoicePrefix = shop?.invoicePrefix || "INV";
      const saleId = await db.transaction(async tx => {
        const saleResult = await tx
          .insert(sales)
          .values({
            organizationId: ctx.organizationId,
            saleNumber,
            customerId: input.customerId,
            customerNameSnapshot: input.customerName,
            customerPhoneSnapshot: input.customerPhone || null,
            subtotal: three(subtotal),
            discount: three(input.discount),
            total: three(total),
            paymentMethod: input.paymentMethod,
            paymentStatus: input.paymentStatus,
            createdBy: ctx.user.id,
          })
          .returning({ id: sales.id });
        const createdId = id(saleResult);
        for (const item of input.items) {
          await tx.insert(saleItems).values({
            organizationId: ctx.organizationId,
            saleId: createdId,
            serviceId: item.serviceId,
            inventoryItemId: item.inventoryItemId,
            nameSnapshot: item.name,
            quantity: three(item.quantity),
            unitPrice: three(item.unitPrice),
            lineTotal: three(item.quantity * item.unitPrice),
          });
          if (item.inventoryItemId) {
            const stock = (
              await tx
                .select()
                .from(inventoryItems)
                .where(
                  and(
                    eq(inventoryItems.id, item.inventoryItemId),
                    orgScope(inventoryItems, ctx.organizationId)
                  )
                )
                .limit(1)
            )[0];
            if (!stock)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Linked inventory item was not found.",
              });
            const before = Number(stock.quantity);
            const after = before - item.quantity;
            if (after < 0)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `${stock.name} does not have enough stock.`,
              });
            await tx
              .update(inventoryItems)
              .set({ quantity: three(after) })
              .where(
                and(
                  eq(inventoryItems.id, stock.id),
                  orgScope(inventoryItems, ctx.organizationId)
                )
              );
            await tx.insert(stockMovements).values({
              organizationId: ctx.organizationId,
              inventoryItemId: stock.id,
              movementType: "sale",
              quantityChange: three(-item.quantity),
              quantityBefore: three(before),
              quantityAfter: three(after),
              referenceType: "sale",
              referenceId: createdId,
              createdBy: ctx.user.id,
              notes: saleNumber,
            });
          }
        }
        await tx.insert(invoices).values({
          organizationId: ctx.organizationId,
          saleId: createdId,
          invoiceNumber: `${invoicePrefix}-${String(createdId).padStart(6, "0")}`,
          status: input.paymentStatus,
        });
        return createdId;
      });
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "SALE_COMPLETED",
        "sale",
        saleId,
        { total }
      );
      return { id: saleId, total };
    }),
});

export const salesHistoryRouter = router({
  list: tenantProcedure
    .input(salesHistoryInput.optional())
    .query(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, salesRoles);
      const db = await dbOrThrow();
      const [saleRows, invoiceRows] = await Promise.all([
        db
          .select()
          .from(sales)
          .where(orgScope(sales, ctx.organizationId))
          .orderBy(desc(sales.createdAt))
          .limit(500),
        db
          .select()
          .from(invoices)
          .where(orgScope(invoices, ctx.organizationId)),
      ]);
      const invoiceBySale = new Map(
        invoiceRows.map(invoice => [invoice.saleId, invoice])
      );
      const search = input?.search?.trim().toLowerCase();
      const start = input?.startDate
        ? new Date(`${input.startDate}T00:00:00.000Z`)
        : null;
      const end = input?.endDate
        ? new Date(`${input.endDate}T23:59:59.999Z`)
        : null;
      return saleRows
        .filter(
          sale =>
            (!input?.source || sale.source === input.source) &&
            (!input?.paymentStatus ||
              sale.paymentStatus === input.paymentStatus) &&
            (!start || sale.createdAt >= start) &&
            (!end || sale.createdAt <= end) &&
            (!search ||
              [
                sale.saleNumber,
                sale.customerNameSnapshot,
                sale.customerPhoneSnapshot || "",
              ].some(value => value.toLowerCase().includes(search)))
        )
        .map(sale => ({
          ...sale,
          invoice: invoiceBySale.get(sale.id) || null,
        }));
    }),
  monthlyReport: tenantProcedure
    .input(monthInput)
    .query(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, salesRoles);
      const db = await dbOrThrow();
      const { start, end } = getMonthWindow(input.month);
      const [allSales, invoiceRows, allItems, shop] = await Promise.all([
        db
          .select()
          .from(sales)
          .where(orgScope(sales, ctx.organizationId))
          .orderBy(desc(sales.createdAt))
          .limit(1000),
        db
          .select()
          .from(invoices)
          .where(orgScope(invoices, ctx.organizationId)),
        db
          .select()
          .from(saleItems)
          .where(orgScope(saleItems, ctx.organizationId)),
        db
          .select()
          .from(shopSettings)
          .where(orgScope(shopSettings, ctx.organizationId))
          .limit(1)
          .then(rows => rows[0] || null),
      ]);
      const rows = allSales.filter(
        sale => sale.createdAt >= start && sale.createdAt <= end
      );
      const invoiceBySale = new Map(
        invoiceRows.map(invoice => [invoice.saleId, invoice])
      );
      const includedIds = new Set(rows.map(sale => sale.id));
      const bySource = new Map<string, { count: number; total: number }>();
      const byPayment = new Map<string, { count: number; total: number }>();
      const topLines = new Map<string, { quantity: number; total: number }>();
      for (const sale of rows) {
        const source = bySource.get(sale.source) || { count: 0, total: 0 };
        source.count += 1;
        source.total += Number(sale.total);
        bySource.set(sale.source, source);
        const payment = byPayment.get(sale.paymentMethod) || {
          count: 0,
          total: 0,
        };
        payment.count += 1;
        payment.total += Number(sale.total);
        byPayment.set(sale.paymentMethod, payment);
      }
      for (const line of allItems)
        if (includedIds.has(line.saleId)) {
          const current = topLines.get(line.nameSnapshot) || {
            quantity: 0,
            total: 0,
          };
          current.quantity += Number(line.quantity);
          current.total += Number(line.lineTotal);
          topLines.set(line.nameSnapshot, current);
        }
      const total = rows.reduce((sum, sale) => sum + Number(sale.total), 0);
      return {
        month: input.month,
        shop,
        totals: {
          saleCount: rows.length,
          revenue: total,
          averageOrder: rows.length ? total / rows.length : 0,
          paidCount: rows.filter(sale => sale.paymentStatus === "paid").length,
          partialCount: rows.filter(sale => sale.paymentStatus === "partial")
            .length,
          unpaidCount: rows.filter(sale => sale.paymentStatus === "unpaid")
            .length,
        },
        bySource: Array.from(bySource, ([source, values]) => ({
          source,
          ...values,
        })),
        byPayment: Array.from(byPayment, ([paymentMethod, values]) => ({
          paymentMethod,
          ...values,
        })),
        topLines: Array.from(topLines, ([name, values]) => ({
          name,
          ...values,
        }))
          .sort((left, right) => right.total - left.total)
          .slice(0, 8),
        sales: rows.map(sale => ({
          ...sale,
          invoice: invoiceBySale.get(sale.id) || null,
        })),
      };
    }),
});
