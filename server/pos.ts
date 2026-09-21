import { and, desc, eq, inArray, isNull, like, lt, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditLogs,
  customers,
  customRoles,
  discountCodes,
  inventoryItems,
  invoicePayments,
  invoices,
  measurementProfiles,
  posOrders,
  posPayments,
  posSessions,
  saleItems,
  sales,
  services,
  shopSettings,
  staffProfiles,
  stockMovements,
  tailoringOrders,
  userBusinessRoles,
  userCustomRoles,
} from "../drizzle/schema";
import { getDb } from "./db";
import { effectiveInventoryQuantity } from "./inventoryQuantity";
import { tenantProcedure, router } from "./_core/trpc";
import { orgScope } from "./_core/tenantDb";
import {
  money,
  paymentMethod,
  returnMode,
  taxFor,
  taxFromGross,
  cartItem,
  paymentLine,
  calculateCheckoutTotal,
  calculateExchangeSettlement,
  dbOrThrow,
  requireCounterAccess,
  audit,
  existingCheckoutByReference,
  existingTailoringCheckoutByReference,
  consumeDiscountUsage,
  sessionInput,
  checkoutInput,
  quickCheckoutInput,
  tailoringCheckoutInput,
  heldOrderInput,
  returnItemSelection,
  exchangeReplacementInput,
  returnInput,
  validateSession,
  resolveSession,
  resolveDiscount,
} from "./pos/shared";
export * from "./pos/shared";

export const posRouter = router({
  catalog: router({
    list: tenantProcedure.query(async ({ ctx }) => {
      await requireCounterAccess(ctx.user.id, ctx.organizationId);
      const db = await dbOrThrow();
      const [serviceRows, inventoryRows] = await Promise.all([
        db
          .select({ service: services, inventory: inventoryItems })
          .from(services)
          .leftJoin(
            inventoryItems,
            eq(services.inventoryItemId, inventoryItems.id)
          )
          .where(and(orgScope(services, ctx.organizationId), eq(services.isActive, true)))
          .orderBy(services.name),
        db
          .select()
          .from(inventoryItems)
          .where(and(orgScope(inventoryItems, ctx.organizationId), eq(inventoryItems.isActive, true)))
          .orderBy(inventoryItems.name),
      ]);
      const inventoryIds = inventoryRows.map(item => item.id);
      const movementRows = inventoryIds.length
        ? await db
            .select({ inventoryItemId: stockMovements.inventoryItemId })
            .from(stockMovements)
            .where(
              and(
                orgScope(stockMovements, ctx.organizationId),
                inArray(stockMovements.inventoryItemId, inventoryIds)
              )
            )
            .groupBy(stockMovements.inventoryItemId)
        : [];
      const movementIds = new Set(movementRows.map(row => row.inventoryItemId));
      const effectiveQuantity = (item: (typeof inventoryRows)[number]) =>
        money(
          effectiveInventoryQuantity({
            inventoryType: item.inventoryType,
            quantity: item.quantity,
            rollCount: item.rollCount,
            metersPerRoll: item.metersPerRoll,
            hasMovement: movementIds.has(item.id),
          })
        );
      const linkedInventoryIds = new Set(
        serviceRows
          .map(row => row.inventory?.id)
          .filter((value): value is number => Boolean(value))
      );
      const serviceCatalog = serviceRows.map(({ service, inventory }) => ({
        id: service.id,
        catalogKey: `service:${service.id}`,
        kind: "service" as const,
        serviceId: service.id,
        inventoryItemId: inventory?.id || null,
        sku: service.sku,
        name: service.name,
        category: service.category,
        description: service.description || "",
        unitPrice: service.unitPrice,
        defaultFabricMeters: service.defaultFabricMeters || null,
        isActive: service.isActive,
        inventory: inventory?.id
          ? {
              id: inventory.id,
              code: inventory.code,
              name: inventory.name,
              quantity: effectiveQuantity(inventory),
              unit: inventory.unit,
              isActive: inventory.isActive,
            }
          : null,
      }));
      const inventoryCatalog = inventoryRows
        .filter(item => !linkedInventoryIds.has(item.id))
        .map(item => ({
          id: item.id,
          catalogKey: `inventory:${item.id}`,
          kind: "inventory" as const,
          serviceId: null,
          inventoryItemId: item.id,
          sku: item.code,
          name: item.name,
          category: item.category,
          description: `${item.unit} · direct inventory item`,
          unitPrice:
            Number(item.salePrice) > 0 ? item.salePrice : item.costPerUnit,
          defaultFabricMeters: null,
          isActive: item.isActive,
          inventory: {
            id: item.id,
            code: item.code,
            name: item.name,
            quantity: effectiveQuantity(item),
            unit: item.unit,
            isActive: item.isActive,
          },
        }));
      return [...serviceCatalog, ...inventoryCatalog];
    }),
  }),
  session: router({
    current: tenantProcedure.query(async ({ ctx }) => {
      await requireCounterAccess(ctx.user.id, ctx.organizationId);
      const db = await dbOrThrow();
      return (
        (
          await db
            .select()
            .from(posSessions)
            .where(and(orgScope(posSessions, ctx.organizationId), eq(posSessions.status, "open")))
            .orderBy(desc(posSessions.openedAt))
            .limit(1)
        )[0] || null
      );
    }),
    open: tenantProcedure
      .input(sessionInput)
      .mutation(async ({ ctx, input }) => {
        await requireCounterAccess(ctx.user.id, ctx.organizationId);
        const db = await dbOrThrow();
        const existing = (
          await db
            .select()
            .from(posSessions)
            .where(and(orgScope(posSessions, ctx.organizationId), eq(posSessions.status, "open")))
            .orderBy(desc(posSessions.openedAt))
            .limit(1)
        )[0];
        if (existing) return existing;
        const sessionNumber = `POS-${new Date()
          .toISOString()
          .replace(/[-:.TZ]/g, "")
          .slice(0, 14)}`;
        const result = await db
          .insert(posSessions)
          .values({
            organizationId: ctx.organizationId,
            sessionNumber,
            openedBy: ctx.user.id,
            openingCash: money(input.openingCash),
            notes: input.notes || null,
          })
          .returning();
        const session = result[0];
        await audit(
          ctx.user.id, ctx.organizationId,
          "POS_SESSION_OPENED",
          "posSession",
          session.id,
          { sessionNumber, openingCash: input.openingCash }
        );
        return session;
      }),
    close: tenantProcedure
      .input(
        z.object({
          sessionId: z.number().int().positive(),
          closingCash: z.number().min(0),
          notes: z.string().trim().max(2000).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireCounterAccess(ctx.user.id, ctx.organizationId);
        const db = await dbOrThrow();
        const session = (
          await db
            .select()
            .from(posSessions)
            .where(and(eq(posSessions.id, input.sessionId), orgScope(posSessions, ctx.organizationId)))
            .limit(1)
        )[0];
        if (!session || session.status !== "open")
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "The POS session is not open.",
          });
        await db
          .update(posSessions)
          .set({
            status: "closed",
            closingCash: money(input.closingCash),
            closedAt: new Date(),
            notes: input.notes || session.notes,
          })
          .where(and(eq(posSessions.id, session.id), orgScope(posSessions, ctx.organizationId)));
        await audit(
          ctx.user.id, ctx.organizationId,
          "POS_SESSION_CLOSED",
          "posSession",
          session.id,
          {
            sessionNumber: session.sessionNumber,
            closingCash: input.closingCash,
          }
        );
        return { success: true };
      }),
  }),
  orders: router({
    held: tenantProcedure.query(async ({ ctx }) => {
      await requireCounterAccess(ctx.user.id, ctx.organizationId);
      const db = await dbOrThrow();
      return db
        .select()
        .from(posOrders)
        .where(and(orgScope(posOrders, ctx.organizationId), eq(posOrders.status, "held")))
        .orderBy(desc(posOrders.updatedAt))
        .limit(100);
    }),
    hold: tenantProcedure
      .input(heldOrderInput)
      .mutation(async ({ ctx, input }) => {
        await requireCounterAccess(ctx.user.id, ctx.organizationId);
        const db = await dbOrThrow();
        const orderNumber = `HOLD-${Date.now()}`;
        const result = await db
          .insert(posOrders)
          .values({
            organizationId: ctx.organizationId,
            orderNumber,
            sessionId: input.sessionId,
            customerId: input.customerId,
            cartJson: input.items,
            note: input.note || null,
            createdBy: ctx.user.id,
          })
          .returning({ id: posOrders.id });
        const id = Number(result[0]?.id || 0);
        await audit(ctx.user.id, ctx.organizationId, "POS_ORDER_HELD", "posOrder", id, {
          orderNumber,
          lineCount: input.items.length,
        });
        return { id, orderNumber };
      }),
    cancel: tenantProcedure
      .input(z.object({ orderId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await requireCounterAccess(ctx.user.id, ctx.organizationId);
        const db = await dbOrThrow();
        await db
          .update(posOrders)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(and(eq(posOrders.id, input.orderId), orgScope(posOrders, ctx.organizationId)));
        await audit(
          ctx.user.id, ctx.organizationId,
          "POS_ORDER_CANCELLED",
          "posOrder",
          input.orderId,
          {}
        );
        return { success: true };
      }),
  }),
  discounts: router({
    validate: tenantProcedure
      .input(
        z.object({
          code: z.string().trim().min(1).max(80),
          subtotal: z.number().min(0),
        })
      )
      .query(async ({ ctx, input }) => {
        await requireCounterAccess(ctx.user.id, ctx.organizationId);
        const db = await dbOrThrow();
        return resolveDiscount(db, input.code, input.subtotal, ctx.organizationId);
      }),
  }),
  checkout: tenantProcedure
    .input(checkoutInput)
    .mutation(async ({ ctx, input }) => {
      await requireCounterAccess(ctx.user.id, ctx.organizationId);
      const replay = await existingCheckoutByReference(input.clientReference, ctx.organizationId);
      if (replay) return replay;
      const db = await dbOrThrow();
      const shop = (
        await db
          .select()
          .from(shopSettings)
          .where(orgScope(shopSettings, ctx.organizationId))
          .limit(1)
      )[0];
      const saleNumber = `POS-${Date.now()}`;
      const checkout = await db.transaction(async tx => {
        const resolvedSession = await resolveSession(
          tx,
          input.sessionId,
          ctx.user.id,
          ctx.organizationId
        );
        const resolved = [] as Array<{
          serviceId: number | null;
          inventoryItemId: number | null;
          name: string;
          quantity: number;
          unitPrice: number;
          lineDiscount: number;
          stockPerSaleUnit: number;
          stock: {
            id: number;
            name: string;
            quantity: string;
            unit: string;
          } | null;
        }>;
        for (const item of input.items) {
          if (item.inventoryItemId && !item.serviceId) {
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
                .for("update")
                .limit(1)
            )[0];
            if (!stock?.isActive)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "This inventory item is no longer available at POS.",
              });
            const stockMovement = (
              await tx
                .select({ id: stockMovements.id })
                .from(stockMovements)
                .where(
                  and(
                    eq(stockMovements.inventoryItemId, stock.id),
                    orgScope(stockMovements, ctx.organizationId)
                  )
                )
                .limit(1)
            )[0];
            const availableQuantity = effectiveInventoryQuantity({
              inventoryType: stock.inventoryType,
              quantity: stock.quantity,
              rollCount: stock.rollCount,
              metersPerRoll: stock.metersPerRoll,
              hasMovement: Boolean(stockMovement),
            });
            const effectiveStock =
              availableQuantity === Number(stock.quantity)
                ? stock
                : { ...stock, quantity: money(availableQuantity) };
            const lineSubtotal = item.quantity * item.unitPrice;
            resolved.push({
              serviceId: null,
              inventoryItemId: effectiveStock.id,
              name: effectiveStock.name,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              lineDiscount: Math.min(item.lineDiscount, lineSubtotal),
              stockPerSaleUnit: 1,
              stock: effectiveStock,
            });
            continue;
          }
          const catalogItem = (
            await tx
              .select()
              .from(services)
              .where(and(eq(services.id, item.serviceId!), orgScope(services, ctx.organizationId)))
              .limit(1)
          )[0];
          if (!catalogItem || !catalogItem.isActive)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `${item.name} is no longer available at POS.`,
            });
          if (
            item.inventoryItemId &&
            item.inventoryItemId !== catalogItem.inventoryItemId
          )
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `${catalogItem.name} no longer matches the selected inventory item.`,
            });
          const stock = catalogItem.inventoryItemId
            ? (
                await tx
                  .select()
                  .from(inventoryItems)
                  .where(
                    and(
                      eq(inventoryItems.id, catalogItem.inventoryItemId),
                      orgScope(inventoryItems, ctx.organizationId)
                    )
                  )
                  .for("update")
                  .limit(1)
              )[0]
            : null;
          if (catalogItem.inventoryItemId && !stock?.isActive)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `${catalogItem.name} has no active inventory link.`,
            });
          const stockMovement = stock
            ? (
                await tx
                  .select({ id: stockMovements.id })
                  .from(stockMovements)
                  .where(
                    and(
                      eq(stockMovements.inventoryItemId, stock.id),
                      orgScope(stockMovements, ctx.organizationId)
                    )
                  )
                  .limit(1)
              )[0]
            : null;
          const availableQuantity = stock
            ? effectiveInventoryQuantity({
                inventoryType: stock.inventoryType,
                quantity: stock.quantity,
                rollCount: stock.rollCount,
                metersPerRoll: stock.metersPerRoll,
                hasMovement: Boolean(stockMovement),
              })
            : 0;
          const effectiveStock = stock
            ? availableQuantity === Number(stock.quantity)
              ? stock
              : { ...stock, quantity: money(availableQuantity) }
            : null;
          const unitPrice = Number(catalogItem.unitPrice);
          const lineSubtotal = item.quantity * unitPrice;
          resolved.push({
            serviceId: catalogItem.id,
            inventoryItemId: catalogItem.inventoryItemId,
            name: catalogItem.name,
            quantity: item.quantity,
            unitPrice,
            lineDiscount: Math.min(item.lineDiscount, lineSubtotal),
            stockPerSaleUnit: catalogItem.inventoryItemId
              ? Number(catalogItem.defaultFabricMeters || 1)
              : 0,
            stock: effectiveStock,
          });
        }
        const subtotal = resolved.reduce(
          (sum, item) => sum + item.quantity * item.unitPrice,
          0
        );
        const lineDiscount = resolved.reduce(
          (sum, item) => sum + item.lineDiscount,
          0
        );
        const code = await resolveDiscount(
          tx,
          input.discountCode,
          subtotal - lineDiscount,
          ctx.organizationId
        );
        const customer = input.customerId
          ? (
              await tx
                .select()
                .from(customers)
                .where(and(eq(customers.id, input.customerId), orgScope(customers, ctx.organizationId)))
                .limit(1)
            )[0]
          : null;
        if (input.customerId && !customer)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "The selected customer was not found.",
          });
        const taxableSubtotal = Math.max(
          0,
          subtotal - lineDiscount - input.discount - code.amount
        );
        const tax = taxFor(taxableSubtotal, shop);
        const total = tax.grossAmount;
        const payments = input.payments?.length
          ? input.payments
          : input.paymentStatus === "paid"
            ? [{ method: input.paymentMethod, amount: total }]
            : [];
        const paidAmount = payments.reduce(
          (sum, payment) => sum + payment.amount,
          0
        );
        if (paidAmount > total + 0.001)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Payments cannot exceed the order total.",
          });
        const calculatedStatus =
          paidAmount >= total - 0.001
            ? "paid"
            : paidAmount > 0
              ? "partial"
              : "unpaid";
        const saleResult = await tx
          .insert(sales)
          .values({
            organizationId: ctx.organizationId,
            saleNumber,
            clientReference: input.clientReference || null,
            customerId: customer?.id || null,
            customerNameSnapshot: customer?.name || input.customerName,
            customerPhoneSnapshot:
              customer?.phone || input.customerPhone || null,
            subtotal: money(subtotal),
            discount: money(lineDiscount + input.discount + code.amount),
            vatRate: money(tax.vatRate),
            vatAmount: money(tax.vatAmount),
            total: money(total),
            paidAmount: money(paidAmount),
            paymentMethod: payments[0]?.method || input.paymentMethod,
            paymentStatus: calculatedStatus,
            source: "counter",
            sessionId: resolvedSession.id,
            discountCodeId: code.id,
            discountCodeSnapshot: code.snapshot,
            createdBy: ctx.user.id,
          })
          .returning({ id: sales.id });
        const saleId = Number(saleResult[0]?.id || 0);
        if (!saleId)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "The sale header could not be created.",
          });
        for (const item of resolved) {
          await tx
            .insert(saleItems)
            .values({
              organizationId: ctx.organizationId,
              saleId,
              serviceId: item.serviceId,
              inventoryItemId: item.inventoryItemId,
              nameSnapshot: item.name,
              quantity: money(item.quantity),
              unitPrice: money(item.unitPrice),
              lineDiscount: money(item.lineDiscount),
              lineTotal: money(
                Math.max(0, item.quantity * item.unitPrice - item.lineDiscount)
              ),
              assignedTailorId: null,
              measurementProfileId: null,
            });
          if (item.inventoryItemId && item.stock) {
            const before = Number(item.stock.quantity);
            const quantityDeducted = item.quantity * item.stockPerSaleUnit;
            const after = before - quantityDeducted;
            if (after < 0)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `${item.stock.name} does not have enough stock.`,
              });
            await tx
              .update(inventoryItems)
              .set({ quantity: money(after) })
              .where(and(eq(inventoryItems.id, item.stock.id), orgScope(inventoryItems, ctx.organizationId)));
            await tx
              .insert(stockMovements)
              .values({
                organizationId: ctx.organizationId,
                inventoryItemId: item.stock.id,
                movementType: "sale",
                quantityChange: money(-quantityDeducted),
                quantityBefore: money(before),
                quantityAfter: money(after),
                referenceType: "sale",
                referenceId: saleId,
                createdBy: ctx.user.id,
                notes: `${saleNumber} · ${money(item.stockPerSaleUnit)} ${item.stock.unit} per sale unit`,
              });
          }
        }
        if (payments.length)
          for (const payment of payments)
            await tx
              .insert(posPayments)
              .values({
                organizationId: ctx.organizationId,
                saleId,
                method: payment.method,
                amount: money(payment.amount),
                reference: payment.reference || null,
                createdBy: ctx.user.id,
              });
        if (code.id) await consumeDiscountUsage(tx, code.id, ctx.organizationId);
        const invoiceResult = await tx
          .insert(invoices)
          .values({
            organizationId: ctx.organizationId,
            saleId,
            invoiceNumber: `${shop?.invoicePrefix || "INV"}-${String(saleId).padStart(6, "0")}`,
            status: calculatedStatus,
            notes: `${input.note || "Issued from Odoo-style POS register."}${tax.vatAmount > 0 ? ` VAT ${money(tax.vatRate)}% included.` : ""}`,
          })
          .returning({ id: invoices.id });
        const invoiceId = Number(invoiceResult[0]?.id || 0);
        if (!invoiceId)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "The invoice could not be created.",
          });
        if (input.heldOrderId)
          await tx
            .update(posOrders)
            .set({ status: "paid", updatedAt: new Date() })
            .where(and(eq(posOrders.id, input.heldOrderId), orgScope(posOrders, ctx.organizationId)));
        return {
          saleId,
          invoiceId,
          total,
          paidAmount,
          paymentStatus: calculatedStatus,
          lineCount: resolved.length,
        };
      });
      await audit(
        ctx.user.id, ctx.organizationId,
        "POS_CHECKOUT_COMPLETED",
        "sale",
        checkout.saleId,
        {
          saleNumber,
          total: checkout.total,
          paidAmount: checkout.paidAmount,
          paymentStatus: checkout.paymentStatus,
          lineCount: checkout.lineCount,
        }
      );
      return {
        id: checkout.saleId,
        invoiceId: checkout.invoiceId,
        total: checkout.total,
        paidAmount: checkout.paidAmount,
        paymentStatus: checkout.paymentStatus,
        saleNumber,
      };
    }),
  quickCheckout: tenantProcedure
    .input(quickCheckoutInput)
    .mutation(async ({ ctx, input }) => {
      await requireCounterAccess(ctx.user.id, ctx.organizationId);
      const replay = await existingCheckoutByReference(input.clientReference, ctx.organizationId);
      if (replay) return replay;
      const db = await dbOrThrow();
      const shop = (
        await db
          .select()
          .from(shopSettings)
          .where(orgScope(shopSettings, ctx.organizationId))
          .limit(1)
      )[0];
      const saleNumber = `POS-${Date.now()}`;
      const tax = taxFor(input.amount, shop);
      const total = tax.grossAmount;
      const checkout = await db.transaction(async tx => {
        const resolvedSession = await resolveSession(
          tx,
          input.sessionId,
          ctx.user.id,
          ctx.organizationId
        );
        const customer = input.customerId
          ? (
              await tx
                .select()
                .from(customers)
                .where(and(eq(customers.id, input.customerId), orgScope(customers, ctx.organizationId)))
                .limit(1)
            )[0]
          : null;
        if (input.customerId && !customer)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "The selected customer was not found.",
          });
        const saleResult = await tx
          .insert(sales)
          .values({
            organizationId: ctx.organizationId,
            saleNumber,
            clientReference: input.clientReference || null,
            customerId: customer?.id || null,
            customerNameSnapshot: customer?.name || input.customerName,
            customerPhoneSnapshot:
              customer?.phone || input.customerPhone || null,
            subtotal: money(input.amount),
            discount: money(0),
            vatRate: money(tax.vatRate),
            vatAmount: money(tax.vatAmount),
            total: money(total),
            paidAmount: money(total),
            paymentMethod: input.paymentMethod,
            paymentStatus: "paid",
            source: "counter",
            sessionId: resolvedSession.id,
            createdBy: ctx.user.id,
          })
          .returning({ id: sales.id });
        const saleId = Number(saleResult[0]?.id || 0);
        if (!saleId)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "The walk-in sale could not be created.",
          });
        await tx.insert(saleItems).values({
          organizationId: ctx.organizationId,
          saleId,
          serviceId: null,
          inventoryItemId: null,
          nameSnapshot: "Walk-in sale",
          quantity: money(1),
          unitPrice: money(input.amount),
          lineDiscount: money(0),
          lineTotal: money(input.amount),
          assignedTailorId: null,
          measurementProfileId: null,
        });
        await tx
          .insert(posPayments)
          .values({
            organizationId: ctx.organizationId,
            saleId,
            method: input.paymentMethod,
            amount: money(total),
            reference: null,
            createdBy: ctx.user.id,
          });
        const invoiceResult = await tx
          .insert(invoices)
          .values({
            organizationId: ctx.organizationId,
            saleId,
            invoiceNumber: `${shop?.invoicePrefix || "INV"}-${String(saleId).padStart(6, "0")}`,
            status: "paid",
            notes: `${input.note || "Walk-in amount sale from POS register."}${tax.vatAmount > 0 ? ` VAT ${money(tax.vatRate)}% added.` : ""}`,
          })
          .returning({ id: invoices.id });
        const invoiceId = Number(invoiceResult[0]?.id || 0);
        if (!invoiceId)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "The walk-in invoice could not be created.",
          });
        return {
          saleId,
          invoiceId,
          total,
          paidAmount: total,
          paymentStatus: "paid" as const,
        };
      });
      await audit(
        ctx.user.id, ctx.organizationId,
        "POS_WALKIN_CHECKOUT_COMPLETED",
        "sale",
        checkout.saleId,
        {
          saleNumber,
          total: checkout.total,
          paymentMethod: input.paymentMethod,
        }
      );
      return {
        id: checkout.saleId,
        invoiceId: checkout.invoiceId,
        total: checkout.total,
        paidAmount: checkout.paidAmount,
        paymentStatus: checkout.paymentStatus,
        saleNumber,
      };
    }),
  returns: router({
    lookup: tenantProcedure
      .input(
        z.object({
          saleNumber: z.string().trim().min(1).max(160),
          search: z.string().trim().min(1).max(160).optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        await requireCounterAccess(ctx.user.id, ctx.organizationId);
        const db = await dbOrThrow();
        const term = (input.search || input.saleNumber).trim();
        const exact = (
          await db
            .select()
            .from(sales)
            .where(and(eq(sales.saleNumber, term), orgScope(sales, ctx.organizationId)))
            .limit(1)
        )[0];
        const sale =
          exact ||
          (
            await db
              .select()
              .from(sales)
              .where(
                and(
                  orgScope(sales, ctx.organizationId),
                  or(
                    like(sales.saleNumber, `%${term}%`),
                    like(sales.customerNameSnapshot, `%${term}%`),
                    like(sales.customerPhoneSnapshot, `%${term}%`)
                  ),
                  sql`${sales.returnOfSaleId} is null`
                )
              )
              .orderBy(desc(sales.createdAt))
              .limit(1)
          )[0];
        if (!sale || sale.returnOfSaleId) return null;
        const items = await db
          .select()
          .from(saleItems)
          .where(and(eq(saleItems.saleId, sale.id), orgScope(saleItems, ctx.organizationId)));
        return { sale, items };
      }),
    create: tenantProcedure
      .input(returnInput)
      .mutation(async ({ ctx, input }) => {
        await requireCounterAccess(ctx.user.id, ctx.organizationId);
        const db = await dbOrThrow();
        const shop = (
          await db
            .select()
            .from(shopSettings)
            .where(orgScope(shopSettings, ctx.organizationId))
            .limit(1)
        )[0];
        const result = await db.transaction(async tx => {
          const resolvedSession = await resolveSession(
            tx,
            input.sessionId,
            ctx.user.id,
            ctx.organizationId
          );
          const original = (
            await tx
              .select()
              .from(sales)
              .where(and(eq(sales.id, input.originalSaleId), orgScope(sales, ctx.organizationId)))
              .limit(1)
          )[0];
          if (!original)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "The original sale was not found.",
            });
          const originalItems = await tx
            .select()
            .from(saleItems)
            .where(and(eq(saleItems.saleId, original.id), orgScope(saleItems, ctx.organizationId)));
          const priorReturns = await tx
            .select()
            .from(sales)
            .where(and(eq(sales.returnOfSaleId, original.id), orgScope(sales, ctx.organizationId)));
          const priorRefunds = priorReturns.filter(
            row => row.returnMode !== "exchange_replacement"
          );
          const priorReturnIds = new Set(priorRefunds.map(row => row.id));
          const priorReturnItems = (
            await tx.select().from(saleItems).where(orgScope(saleItems, ctx.organizationId))
          ).filter(item => priorReturnIds.has(item.saleId));
          const lines =
            input.mode === "items" || input.mode === "exchange"
              ? (input.items || []).map(request => {
                  const source = originalItems.find(
                    item => item.id === request.saleItemId
                  );
                  if (!source)
                    throw new TRPCError({
                      code: "BAD_REQUEST",
                      message:
                        "A returned item does not belong to the original sale.",
                    });
                  const alreadyReturned = priorReturnItems
                    .filter(item => item.nameSnapshot === source.nameSnapshot)
                    .reduce(
                      (sum, item) => sum + Math.abs(Number(item.quantity)),
                      0
                    );
                  if (
                    alreadyReturned + request.quantity >
                    Number(source.quantity) + 0.001
                  )
                    throw new TRPCError({
                      code: "BAD_REQUEST",
                      message: `Cannot return more ${source.nameSnapshot} than was sold.`,
                    });
                  const originalQuantity = Math.max(
                    Number(source.quantity),
                    0.001
                  );
                  return {
                    source,
                    quantity: request.quantity,
                    lineTotal:
                      request.quantity *
                      (Number(source.lineTotal) / originalQuantity),
                  };
                })
              : [];
          const originalGross = Math.max(0, Number(original.total));
          const alreadyRefundedGross = priorRefunds.reduce(
            (sum, row) => sum + Math.abs(Number(row.total)),
            0
          );
          const vatRate = Number(original.vatRate || 0);
          const requestedGross =
            input.mode === "amount"
              ? Number(input.amount || 0)
              : lines.reduce((sum, line) => sum + line.lineTotal, 0) *
                (1 + vatRate / 100);
          if (requestedGross <= 0)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "The refund amount must be greater than zero.",
            });
          if (alreadyRefundedGross + requestedGross > originalGross + 0.001)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "The refund cannot exceed the remaining amount on the original sale.",
            });
          if (input.mode === "amount" && !input.reason?.trim())
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Enter a reason for an amount-based refund.",
            });
          let replacement: {
            serviceId: number | null;
            inventoryItemId: number | null;
            name: string;
            quantity: number;
            unitPrice: number;
            stockPerSaleUnit: number;
            stock: any;
          } | null = null;
          if (input.mode === "exchange") {
            const replacementInput = input.replacementItem;
            if (!replacementInput)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Choose a replacement product.",
              });
            if (replacementInput.serviceId) {
              const service = (
                await tx
                  .select()
                  .from(services)
                  .where(and(eq(services.id, replacementInput.serviceId), orgScope(services, ctx.organizationId)))
                  .limit(1)
              )[0];
              if (!service || !service.isActive)
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: "The replacement service is no longer active.",
                });
              const stock = service.inventoryItemId
                ? (
                    await tx
                      .select()
                      .from(inventoryItems)
                      .where(
                        and(
                          eq(inventoryItems.id, service.inventoryItemId),
                          orgScope(inventoryItems, ctx.organizationId)
                        )
                      )
                      .for("update")
                      .limit(1)
                  )[0] || null
                : null;
              const stockPerSaleUnit = service.inventoryItemId
                ? Number(service.defaultFabricMeters || 1)
                : 0;
              if (
                stock &&
                Number(stock.quantity) + 0.001 <
                  replacementInput.quantity * stockPerSaleUnit
              )
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: `Not enough stock for ${service.name}.`,
                });
              replacement = {
                serviceId: service.id,
                inventoryItemId: service.inventoryItemId || null,
                name: service.name,
                quantity: replacementInput.quantity,
                unitPrice: Number(service.unitPrice),
                stockPerSaleUnit,
                stock,
              };
            } else {
              const stock = replacementInput.inventoryItemId
                ? (
                    await tx
                      .select()
                      .from(inventoryItems)
                      .where(
                        and(
                          eq(inventoryItems.id, replacementInput.inventoryItemId),
                          orgScope(inventoryItems, ctx.organizationId)
                        )
                      )
                      .for("update")
                      .limit(1)
                  )[0] || null
                : null;
              if (!stock || !stock.isActive)
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message:
                    "The replacement inventory item is no longer active.",
                });
              const unitPrice =
                Number(stock.salePrice) > 0
                  ? Number(stock.salePrice)
                  : Number(stock.costPerUnit);
              if (unitPrice <= 0)
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: `Set a sale price for ${stock.name} before using it as an exchange replacement.`,
                });
              if (Number(stock.quantity) + 0.001 < replacementInput.quantity)
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: `Not enough stock for ${stock.name}.`,
                });
              replacement = {
                serviceId: null,
                inventoryItemId: stock.id,
                name: stock.name,
                quantity: replacementInput.quantity,
                unitPrice,
                stockPerSaleUnit: 1,
                stock,
              };
            }
          }
          const replacementNet = replacement
            ? replacement.quantity * replacement.unitPrice
            : 0;
          const replacementGross = replacement
            ? replacementNet * (1 + vatRate / 100)
            : 0;
          const settlement = calculateExchangeSettlement(
            requestedGross,
            replacementGross
          );
          const settlementAmount = settlement.difference;
          const netTotal =
            input.mode === "amount"
              ? requestedGross / (1 + vatRate / 100)
              : lines.reduce((sum, line) => sum + line.lineTotal, 0);
          const vatAmount = requestedGross - netTotal;
          const saleNumber = `RET-${Date.now()}`;
          const saleResult = await tx
            .insert(sales)
            .values({
              organizationId: ctx.organizationId,
              saleNumber,
              customerId: original.customerId,
              customerNameSnapshot: original.customerNameSnapshot,
              customerPhoneSnapshot: original.customerPhoneSnapshot,
              subtotal: money(-netTotal),
              discount: "0.000",
              vatRate: money(vatRate),
              vatAmount: money(-vatAmount),
              total: money(-requestedGross),
              paidAmount: money(-requestedGross),
              paymentMethod: input.paymentMethod,
              paymentStatus: "paid",
              source: "counter",
              sessionId: resolvedSession.id,
              returnOfSaleId: original.id,
              returnMode: input.mode,
              returnReason: input.reason || input.note || null,
              createdBy: ctx.user.id,
            })
            .returning({ id: sales.id });
          const saleId = Number(saleResult[0]?.id || 0);
          if (input.mode === "items" || input.mode === "exchange")
            for (const line of lines) {
              await tx
                .insert(saleItems)
                .values({
                  organizationId: ctx.organizationId,
                  saleId,
                  serviceId: line.source.serviceId,
                  inventoryItemId: line.source.inventoryItemId,
                  nameSnapshot: line.source.nameSnapshot,
                  quantity: money(-line.quantity),
                  unitPrice: money(Number(line.source.unitPrice)),
                  lineDiscount: money(Number(line.source.lineDiscount)),
                  lineTotal: money(-line.lineTotal),
                  assignedTailorId: line.source.assignedTailorId,
                  measurementProfileId: line.source.measurementProfileId,
                });
              if (line.source.inventoryItemId) {
                const stock = (
                  await tx
                    .select()
                    .from(inventoryItems)
                    .where(
                      and(
                        eq(inventoryItems.id, line.source.inventoryItemId),
                        orgScope(inventoryItems, ctx.organizationId)
                      )
                    )
                    .for("update")
                    .limit(1)
                )[0];
                if (stock) {
                  const before = Number(stock.quantity);
                  const stockPerSaleUnit = line.source.serviceId
                    ? Number(
                        (
                          await tx
                            .select({
                              defaultFabricMeters: services.defaultFabricMeters,
                            })
                            .from(services)
                            .where(
                              and(
                                eq(services.id, line.source.serviceId),
                                orgScope(services, ctx.organizationId)
                              )
                            )
                            .limit(1)
                        )[0]?.defaultFabricMeters || 1
                      )
                    : 1;
                  const after = before + line.quantity * stockPerSaleUnit;
                  await tx
                    .update(inventoryItems)
                    .set({ quantity: money(after) })
                    .where(and(eq(inventoryItems.id, stock.id), orgScope(inventoryItems, ctx.organizationId)));
                  await tx
                    .insert(stockMovements)
                    .values({
                      organizationId: ctx.organizationId,
                      inventoryItemId: stock.id,
                      movementType: "return",
                      quantityChange: money(line.quantity),
                      quantityBefore: money(before),
                      quantityAfter: money(after),
                      referenceType: "sale",
                      referenceId: saleId,
                      createdBy: ctx.user.id,
                      notes: `${saleNumber} · return of ${original.saleNumber}`,
                    });
                }
              }
            }
          else {
            await tx
              .insert(saleItems)
              .values({
                organizationId: ctx.organizationId,
                saleId,
                serviceId: null,
                inventoryItemId: null,
                nameSnapshot: `Refund · ${input.reason}`,
                quantity: "1.000",
                unitPrice: money(netTotal),
                lineDiscount: "0.000",
                lineTotal: money(-netTotal),
                assignedTailorId: null,
                measurementProfileId: null,
              });
          }
          await tx
            .insert(posPayments)
            .values({
              organizationId: ctx.organizationId,
              saleId,
              method: input.paymentMethod,
              amount: money(-requestedGross),
              reference: `${input.mode === "exchange" ? "Exchange return" : "Refund"} of ${original.saleNumber}${input.reason ? ` · ${input.reason}` : ""}`,
              createdBy: ctx.user.id,
            });
          const invoiceResult = await tx
            .insert(invoices)
            .values({
              organizationId: ctx.organizationId,
              saleId,
              invoiceNumber: `${shop?.invoicePrefix || "INV"}-${String(saleId).padStart(6, "0")}`,
              status: "paid",
              notes:
                input.note ||
                `${input.mode === "amount" ? "Amount refund" : input.mode === "exchange" ? "Exchange return" : "Item return"} of ${original.saleNumber}${input.reason ? ` · ${input.reason}` : ""}.`,
            })
            .returning({ id: invoices.id });
          let replacementSaleId: number | null = null;
          let replacementInvoiceId: number | null = null;
          if (replacement && input.mode === "exchange") {
            const replacementSaleNumber = `EXC-${Date.now()}`;
            const replacementSaleResult = await tx
              .insert(sales)
              .values({
                organizationId: ctx.organizationId,
                saleNumber: replacementSaleNumber,
                customerId: original.customerId,
                customerNameSnapshot: original.customerNameSnapshot,
                customerPhoneSnapshot: original.customerPhoneSnapshot,
                subtotal: money(replacementNet),
                discount: "0.000",
                vatRate: money(vatRate),
                vatAmount: money(replacementGross - replacementNet),
                total: money(replacementGross),
                paidAmount: money(replacementGross),
                paymentMethod: input.paymentMethod,
                paymentStatus: "paid",
                source: "counter",
                sessionId: resolvedSession.id,
                returnOfSaleId: original.id,
                returnMode: "exchange_replacement",
                returnReason: `Replacement for ${original.saleNumber}`,
                createdBy: ctx.user.id,
              })
              .returning({ id: sales.id });
            replacementSaleId = Number(replacementSaleResult[0]?.id || 0);
            await tx
              .insert(saleItems)
              .values({
                organizationId: ctx.organizationId,
                saleId: replacementSaleId,
                serviceId: replacement.serviceId,
                inventoryItemId: replacement.inventoryItemId,
                nameSnapshot: replacement.name,
                quantity: money(replacement.quantity),
                unitPrice: money(replacement.unitPrice),
                lineDiscount: "0.000",
                lineTotal: money(replacementNet),
                assignedTailorId: null,
                measurementProfileId: null,
              });
            if (replacement.stock && replacement.inventoryItemId) {
              const before = Number(replacement.stock.quantity);
              const after =
                before - replacement.quantity * replacement.stockPerSaleUnit;
              await tx
                .update(inventoryItems)
                .set({ quantity: money(after) })
                .where(
                  and(
                    eq(inventoryItems.id, replacement.inventoryItemId),
                    orgScope(inventoryItems, ctx.organizationId)
                  )
                );
              await tx
                .insert(stockMovements)
                .values({
                  organizationId: ctx.organizationId,
                  inventoryItemId: replacement.inventoryItemId,
                  movementType: "sale",
                  quantityChange: money(
                    -replacement.quantity * replacement.stockPerSaleUnit
                  ),
                  quantityBefore: money(before),
                  quantityAfter: money(after),
                  referenceType: "exchange",
                  referenceId: replacementSaleId,
                  createdBy: ctx.user.id,
                  notes: `${replacementSaleNumber} · replacement for ${original.saleNumber}`,
                });
            }
            await tx
              .insert(posPayments)
              .values({
                organizationId: ctx.organizationId,
                saleId: replacementSaleId,
                method: input.paymentMethod,
                amount: money(requestedGross),
                reference: `Exchange credit from ${original.saleNumber}`,
                createdBy: ctx.user.id,
              });
            if (Math.abs(settlementAmount) > 0.0005)
              await tx
                .insert(posPayments)
                .values({
                  organizationId: ctx.organizationId,
                  saleId: replacementSaleId,
                  method: input.paymentMethod,
                  amount: money(settlementAmount),
                  reference:
                    settlementAmount > 0
                      ? `Exchange balance due from ${original.saleNumber}`
                      : `Exchange refund to original ${original.saleNumber}`,
                  createdBy: ctx.user.id,
                });
            const replacementInvoiceResult = await tx
              .insert(invoices)
              .values({
                organizationId: ctx.organizationId,
                saleId: replacementSaleId,
                invoiceNumber: `${shop?.invoicePrefix || "INV"}-${String(replacementSaleId).padStart(6, "0")}`,
                status: "paid",
                notes: `Replacement item for exchange ${original.saleNumber}. ${settlementAmount > 0 ? `Balance collected: ${money(settlementAmount)}.` : settlementAmount < 0 ? `Refund issued: ${money(Math.abs(settlementAmount))}.` : "No balance due."}`,
              })
              .returning({ id: invoices.id });
            replacementInvoiceId = Number(replacementInvoiceResult[0]?.id || 0);
          }
          return {
            saleId,
            invoiceId: Number(invoiceResult[0]?.id || 0),
            saleNumber,
            total:
              input.mode === "exchange" ? settlementAmount : -requestedGross,
            replacementSaleId,
            replacementInvoiceId,
            settlementAmount:
              input.mode === "exchange" ? settlementAmount : null,
          };
        });
        await audit(
          ctx.user.id, ctx.organizationId,
          input.mode === "exchange"
            ? "POS_EXCHANGE_COMPLETED"
            : "POS_RETURN_COMPLETED",
          "sale",
          result.saleId,
          {
            originalSaleId: input.originalSaleId,
            total: result.total,
            replacementSaleId: result.replacementSaleId,
            settlementAmount: result.settlementAmount,
          }
        );
        return result;
      }),
  }),
  tailoringCheckout: tenantProcedure
    .input(tailoringCheckoutInput)
    .mutation(async ({ ctx, input }) => {
      await requireCounterAccess(ctx.user.id, ctx.organizationId);
      const replay = await existingTailoringCheckoutByReference(
        input.clientReference,
        ctx.organizationId
      );
      if (replay) return replay;
      const db = await dbOrThrow();
      const shop = (
        await db
          .select()
          .from(shopSettings)
          .where(orgScope(shopSettings, ctx.organizationId))
          .limit(1)
      )[0];
      const orderNumber = `TO-${Date.now()}`;
      const saleNumber = `POS-TO-${Date.now()}`;
      const paymentStatus =
        input.paymentAmount >= input.orderPrice - 0.001
          ? "paid"
          : input.paymentAmount > 0
            ? "partial"
            : ("unpaid" as const);
      const orderTax = taxFromGross(input.orderPrice, shop);
      const transaction = await db.transaction(async tx => {
        const resolvedSession = await resolveSession(
          tx,
          input.sessionId,
          ctx.user.id,
          ctx.organizationId
        );
        const customer = (
          await tx
            .select()
            .from(customers)
            .where(and(eq(customers.id, input.customerId), orgScope(customers, ctx.organizationId)))
            .limit(1)
        )[0];
        if (!customer)
          throw new TRPCError({
            code: "NOT_FOUND",
            message:
              "Choose a valid customer before creating a tailoring order.",
          });
        const measurement = (
          await tx
            .select()
            .from(measurementProfiles)
            .where(
              and(
                eq(measurementProfiles.id, input.measurementProfileId),
                orgScope(measurementProfiles, ctx.organizationId)
              )
            )
            .limit(1)
        )[0];
        if (!measurement || measurement.customerId !== customer.id)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Choose a saved measurement version belonging to this customer.",
          });
        const tailor = (
          await tx
            .select()
            .from(staffProfiles)
            .where(and(eq(staffProfiles.id, input.assignedTailorId), orgScope(staffProfiles, ctx.organizationId)))
            .limit(1)
        )[0];
        if (!tailor?.isActive)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Choose an active tailor for this production order.",
          });
        const service = input.serviceId
          ? (
              await tx
                .select()
                .from(services)
                .where(and(eq(services.id, input.serviceId), orgScope(services, ctx.organizationId)))
                .limit(1)
            )[0]
          : null;
        if (input.serviceId && (!service || !service.isActive))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The selected tailoring service is no longer available.",
          });
        const linkedStock = service?.inventoryItemId
          ? (
              await tx
                .select()
                .from(inventoryItems)
                .where(
                  and(
                    eq(inventoryItems.id, service.inventoryItemId),
                    orgScope(inventoryItems, ctx.organizationId)
                  )
                )
                .for("update")
                .limit(1)
            )[0]
          : null;
        if (service?.inventoryItemId && !linkedStock?.isActive)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "The selected tailoring service has no active material link.",
          });
        const stockPerPiece = service?.inventoryItemId
          ? Number(service.defaultFabricMeters || 1)
          : 0;
        const stockNeeded = input.quantity * stockPerPiece;
        const linkedStockMovement = linkedStock
          ? (
              await tx
                .select({ id: stockMovements.id })
                .from(stockMovements)
                .where(
                  and(
                    eq(stockMovements.inventoryItemId, linkedStock.id),
                    orgScope(stockMovements, ctx.organizationId)
                  )
                )
                .limit(1)
            )[0]
          : null;
        const linkedAvailableQuantity = linkedStock
          ? effectiveInventoryQuantity({
              inventoryType: linkedStock.inventoryType,
              quantity: linkedStock.quantity,
              rollCount: linkedStock.rollCount,
              metersPerRoll: linkedStock.metersPerRoll,
              hasMovement: Boolean(linkedStockMovement),
            })
          : 0;
        const effectiveLinkedStock = linkedStock
          ? linkedAvailableQuantity === Number(linkedStock.quantity)
            ? linkedStock
            : { ...linkedStock, quantity: money(linkedAvailableQuantity) }
          : null;
        if (
          !input.customerSuppliedFabric &&
          effectiveLinkedStock &&
          linkedAvailableQuantity < stockNeeded
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${effectiveLinkedStock.name} does not have enough stock for this tailoring order.`,
          });
        const orderResult = await tx
          .insert(tailoringOrders)
          .values({
            organizationId: ctx.organizationId,
            orderNumber,
            customerId: customer.id,
            measurementProfileId: measurement.id,
            assignedTailorId: tailor.id,
            garmentType: input.garmentType,
            quantity: input.quantity,
            dueDate: input.dueDate ? new Date(input.dueDate) : null,
            price: money(input.orderPrice),
            customerSuppliedFabric: input.customerSuppliedFabric,
            fabricNotes: input.fabricNotes || null,
            status: "confirmed",
            notes: input.notes || null,
            productionNotes: input.productionNotes || null,
            createdBy: ctx.user.id,
          })
          .returning({ id: tailoringOrders.id });
        const orderId = Number(orderResult[0]?.id || 0);
        const saleResult = await tx
          .insert(sales)
          .values({
            organizationId: ctx.organizationId,
            saleNumber,
            clientReference: input.clientReference || null,
            customerId: customer.id,
            customerNameSnapshot: customer.name,
            customerPhoneSnapshot: customer.phone || null,
            subtotal: money(orderTax.netAmount),
            discount: "0.000",
            vatRate: money(orderTax.vatRate),
            vatAmount: money(orderTax.vatAmount),
            total: money(input.orderPrice),
            paidAmount: money(input.paymentAmount),
            paymentMethod: input.paymentMethod,
            paymentStatus,
            source: "tailoring",
            sessionId: resolvedSession.id,
            createdBy: ctx.user.id,
          })
          .returning({ id: sales.id });
        const saleId = Number(saleResult[0]?.id || 0);
        await tx
          .update(tailoringOrders)
          .set({ saleId })
          .where(and(eq(tailoringOrders.id, orderId), orgScope(tailoringOrders, ctx.organizationId)));
        if (input.paymentAmount > 0)
          await tx
            .insert(posPayments)
            .values({
              organizationId: ctx.organizationId,
              saleId,
              method: input.paymentMethod,
              amount: money(input.paymentAmount),
              reference: `${orderNumber} initial payment`,
              createdBy: ctx.user.id,
            });
        await tx
          .insert(saleItems)
          .values({
            organizationId: ctx.organizationId,
            saleId,
            serviceId: service?.id || null,
            inventoryItemId: linkedStock?.id || null,
            nameSnapshot: `${service?.name || input.garmentType} tailoring order · ${paymentStatus === "paid" ? "full payment" : paymentStatus === "partial" ? "deposit" : "unpaid"}`,
            quantity: money(input.quantity),
            unitPrice: money(orderTax.netAmount / input.quantity),
            lineDiscount: "0.000",
            lineTotal: money(orderTax.netAmount),
            assignedTailorId: tailor.id,
            measurementProfileId: measurement.id,
          });
        if (
          !input.customerSuppliedFabric &&
          effectiveLinkedStock &&
          stockNeeded > 0
        ) {
          const before = linkedAvailableQuantity;
          const after = before - stockNeeded;
          await tx
            .update(inventoryItems)
            .set({ quantity: money(after) })
            .where(and(eq(inventoryItems.id, effectiveLinkedStock.id), orgScope(inventoryItems, ctx.organizationId)));
          await tx
            .insert(stockMovements)
            .values({
              organizationId: ctx.organizationId,
              inventoryItemId: effectiveLinkedStock.id,
              movementType: "sale",
              quantityChange: money(-stockNeeded),
              quantityBefore: money(before),
              quantityAfter: money(after),
              referenceType: "tailoring_order",
              referenceId: orderId,
              createdBy: ctx.user.id,
              notes: `${orderNumber} · ${money(stockPerPiece)} ${effectiveLinkedStock.unit} per piece`,
            });
        }
        const invoiceResult = await tx
          .insert(invoices)
          .values({
            organizationId: ctx.organizationId,
            saleId,
            invoiceNumber: `${shop?.invoicePrefix || "INV"}-${String(saleId).padStart(6, "0")}`,
            status: paymentStatus,
            notes: `${orderNumber} · ${input.garmentType} · quoted ${money(input.orderPrice)} BHD incl. VAT · ${paymentStatus === "paid" ? "full payment" : paymentStatus === "partial" ? "deposit" : "no payment"} collected from POS.${input.customerSuppliedFabric ? " Customer supplied fabric." : " Shop fabric."}`,
          })
          .returning({ id: invoices.id });
        const invoiceId = Number(invoiceResult[0]?.id || 0);
        if (input.paymentAmount > 0)
          await tx
            .insert(invoicePayments)
            .values({
              organizationId: ctx.organizationId,
              invoiceId,
              amount: money(input.paymentAmount),
              paymentMethod: input.paymentMethod,
              reference: `${orderNumber} initial payment`,
              previousPaidAmount: "0.000",
              paidTotal: money(input.paymentAmount),
              remainingAmount: money(
                Math.max(0, input.orderPrice - input.paymentAmount)
              ),
              createdBy: ctx.user.id,
            });
        return { orderId, saleId, invoiceId };
      });
      await audit(
        ctx.user.id, ctx.organizationId,
        "POS_TAILORING_CHECKOUT_COMPLETED",
        "tailoringOrder",
        transaction.orderId,
        {
          orderNumber,
          saleNumber,
          paymentAmount: input.paymentAmount,
          orderPrice: input.orderPrice,
          paymentStatus,
        }
      );
      return {
        ...transaction,
        orderNumber,
        saleNumber,
        total: input.paymentAmount,
        paymentStatus,
      };
    }),
});
