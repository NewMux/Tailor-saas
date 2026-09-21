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
export const discountsRouter = router({
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
      return resolveDiscount(
        db,
        input.code,
        input.subtotal,
        ctx.organizationId
      );
    }),
});
