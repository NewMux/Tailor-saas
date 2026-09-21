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
export const tailoringCheckoutProcedure = tenantProcedure
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
          message: "Choose a valid customer before creating a tailoring order.",
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
          message: "Choose an active tailor for this production order.",
        });
      const service = input.serviceId
        ? (
            await tx
              .select()
              .from(services)
              .where(
                and(
                  eq(services.id, input.serviceId),
                  orgScope(services, ctx.organizationId)
                )
              )
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
        .where(
          and(
            eq(tailoringOrders.id, orderId),
            orgScope(tailoringOrders, ctx.organizationId)
          )
        );
      if (input.paymentAmount > 0)
        await tx.insert(posPayments).values({
          organizationId: ctx.organizationId,
          saleId,
          method: input.paymentMethod,
          amount: money(input.paymentAmount),
          reference: `${orderNumber} initial payment`,
          createdBy: ctx.user.id,
        });
      await tx.insert(saleItems).values({
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
          .where(
            and(
              eq(inventoryItems.id, effectiveLinkedStock.id),
              orgScope(inventoryItems, ctx.organizationId)
            )
          );
        await tx.insert(stockMovements).values({
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
        await tx.insert(invoicePayments).values({
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
      ctx.user.id,
      ctx.organizationId,
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
  });
