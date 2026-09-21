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
} from "../../drizzle/schema";
import { getDb } from "../db";
import { effectiveInventoryQuantity } from "../inventoryQuantity";
import { tenantProcedure, router } from "../_core/trpc";
import { orgScope } from "../_core/tenantDb";
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
} from "./shared";
export const checkoutProcedure = tenantProcedure
  .input(checkoutInput)
  .mutation(async ({ ctx, input }) => {
    await requireCounterAccess(ctx.user.id, ctx.organizationId);
    const replay = await existingCheckoutByReference(
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
            .where(
              and(
                eq(services.id, item.serviceId!),
                orgScope(services, ctx.organizationId)
              )
            )
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
              .where(
                and(
                  eq(customers.id, input.customerId),
                  orgScope(customers, ctx.organizationId)
                )
              )
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
          customerPhoneSnapshot: customer?.phone || input.customerPhone || null,
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
        await tx.insert(saleItems).values({
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
            .where(
              and(
                eq(inventoryItems.id, item.stock.id),
                orgScope(inventoryItems, ctx.organizationId)
              )
            );
          await tx.insert(stockMovements).values({
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
          await tx.insert(posPayments).values({
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
          .where(
            and(
              eq(posOrders.id, input.heldOrderId),
              orgScope(posOrders, ctx.organizationId)
            )
          );
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
      ctx.user.id,
      ctx.organizationId,
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
  });

export const quickCheckoutProcedure = tenantProcedure
  .input(quickCheckoutInput)
  .mutation(async ({ ctx, input }) => {
    await requireCounterAccess(ctx.user.id, ctx.organizationId);
    const replay = await existingCheckoutByReference(
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
              .where(
                and(
                  eq(customers.id, input.customerId),
                  orgScope(customers, ctx.organizationId)
                )
              )
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
          customerPhoneSnapshot: customer?.phone || input.customerPhone || null,
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
      await tx.insert(posPayments).values({
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
      ctx.user.id,
      ctx.organizationId,
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
  });
