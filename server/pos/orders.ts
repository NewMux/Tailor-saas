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
import { assertOwned, orgScope } from "../_core/tenantDb";
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
export const ordersRouter = router({
  held: tenantProcedure.query(async ({ ctx }) => {
    await requireCounterAccess(ctx.user.id, ctx.organizationId);
    const db = await dbOrThrow();
    return db
      .select()
      .from(posOrders)
      .where(
        and(
          orgScope(posOrders, ctx.organizationId),
          eq(posOrders.status, "held")
        )
      )
      .orderBy(desc(posOrders.updatedAt))
      .limit(100);
  }),
  hold: tenantProcedure
    .input(heldOrderInput)
    .mutation(async ({ ctx, input }) => {
      await requireCounterAccess(ctx.user.id, ctx.organizationId);
      await assertOwned(posSessions, input.sessionId, ctx.organizationId, "Register session");
      await assertOwned(customers, input.customerId, ctx.organizationId, "Customer");
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
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "POS_ORDER_HELD",
        "posOrder",
        id,
        {
          orderNumber,
          lineCount: input.items.length,
        }
      );
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
        .where(
          and(
            eq(posOrders.id, input.orderId),
            orgScope(posOrders, ctx.organizationId)
          )
        );
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "POS_ORDER_CANCELLED",
        "posOrder",
        input.orderId,
        {}
      );
      return { success: true };
    }),
});
