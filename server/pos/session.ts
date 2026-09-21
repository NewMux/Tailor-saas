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
export const sessionRouter = router({
  current: tenantProcedure.query(async ({ ctx }) => {
    await requireCounterAccess(ctx.user.id, ctx.organizationId);
    const db = await dbOrThrow();
    return (
      (
        await db
          .select()
          .from(posSessions)
          .where(
            and(
              orgScope(posSessions, ctx.organizationId),
              eq(posSessions.status, "open")
            )
          )
          .orderBy(desc(posSessions.openedAt))
          .limit(1)
      )[0] || null
    );
  }),
  open: tenantProcedure.input(sessionInput).mutation(async ({ ctx, input }) => {
    await requireCounterAccess(ctx.user.id, ctx.organizationId);
    const db = await dbOrThrow();
    const existing = (
      await db
        .select()
        .from(posSessions)
        .where(
          and(
            orgScope(posSessions, ctx.organizationId),
            eq(posSessions.status, "open")
          )
        )
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
      ctx.user.id,
      ctx.organizationId,
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
          .where(
            and(
              eq(posSessions.id, input.sessionId),
              orgScope(posSessions, ctx.organizationId)
            )
          )
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
        .where(
          and(
            eq(posSessions.id, session.id),
            orgScope(posSessions, ctx.organizationId)
          )
        );
      await audit(
        ctx.user.id,
        ctx.organizationId,
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
});
