import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditLogs,
  customRoles,
  discountCodes,
  invoices,
  posSessions,
  sales,
  tailoringOrders,
  userBusinessRoles,
  userCustomRoles,
} from "../../drizzle/schema";
import { orgScope, dbOrThrow } from "../_core/tenantDb";
export { dbOrThrow };

export const money = (value: number) => Number(value.toFixed(3)).toFixed(3);
export const paymentMethod = z.enum([
  "cash",
  "benefitpay",
  "bank_transfer",
  "credit_card",
]);
export const returnMode = z.enum(["items", "amount", "exchange"]);
export const taxFor = (
  netAmount: number,
  shop:
    | { vatEnabled?: boolean | null; vatRate?: string | number | null }
    | null
    | undefined
) => {
  const vatRate = shop?.vatEnabled ? Number(shop.vatRate || 0) : 0;
  const vatAmount = (Math.max(0, netAmount) * vatRate) / 100;
  return {
    vatRate,
    vatAmount,
    netAmount: Math.max(0, netAmount),
    grossAmount: Math.max(0, netAmount) + vatAmount,
  };
};
export const taxFromGross = (
  grossAmount: number,
  shop:
    | { vatEnabled?: boolean | null; vatRate?: string | number | null }
    | null
    | undefined
) => {
  const vatRate = shop?.vatEnabled ? Number(shop.vatRate || 0) : 0;
  const gross = Math.max(0, grossAmount);
  const netAmount = gross / (1 + vatRate / 100);
  return {
    vatRate,
    vatAmount: gross - netAmount,
    netAmount,
    grossAmount: gross,
  };
};
export const cartItem = z
  .object({
    serviceId: z.number().int().optional(),
    inventoryItemId: z.number().int().optional(),
    name: z.string().min(1).max(160),
    quantity: z.number().positive().max(999),
    unitPrice: z.number().nonnegative().max(1000000),
    lineDiscount: z.number().min(0).max(1000000).default(0),
  })
  .refine(
    item => Boolean(item.serviceId || item.inventoryItemId),
    "Choose an inventory item or catalog item."
  );
export const paymentLine = z.object({
  method: paymentMethod,
  amount: z.number().positive().max(1000000),
  reference: z.string().trim().max(160).optional(),
});

export const calculateCheckoutTotal = (
  items: Array<{ quantity: number; unitPrice: number; lineDiscount?: number }>,
  discount: number
) => {
  const subtotal = items.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0
  );
  const lineDiscount = items.reduce(
    (sum, item) =>
      sum + Math.min(item.quantity * item.unitPrice, item.lineDiscount || 0),
    0
  );
  const total = Math.max(0, subtotal - lineDiscount - discount);
  return { subtotal, total };
};

export const calculateExchangeSettlement = (
  returnedGross: number,
  replacementGross: number
) => {
  const difference = Number((replacementGross - returnedGross).toFixed(3));
  return {
    difference,
    refundAmount: Math.max(0, -difference),
    amountDue: Math.max(0, difference),
  };
};

export async function requireCounterAccess(
  userId: number,
  organizationId: number
) {
  const db = await dbOrThrow();
  const role = (
    await db
      .select()
      .from(userBusinessRoles)
      .where(
        and(
          eq(userBusinessRoles.userId, userId),
          orgScope(userBusinessRoles, organizationId)
        )
      )
      .limit(1)
  )[0];
  if (!role)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Your ERP access could not be verified.",
    });
  if (!role.isActive)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Your ERP access is inactive.",
    });
  if (role.role === "admin") return;
  const assignment = (
    await db
      .select()
      .from(userCustomRoles)
      .where(
        and(
          eq(userCustomRoles.userId, userId),
          orgScope(userCustomRoles, organizationId)
        )
      )
      .limit(1)
  )[0];
  if (assignment) {
    const customRole = (
      await db
        .select()
        .from(customRoles)
        .where(
          and(
            eq(customRoles.id, assignment.customRoleId),
            orgScope(customRoles, organizationId)
          )
        )
        .limit(1)
    )[0];
    const permissions = Array.isArray(customRole?.permissionsJson)
      ? customRole.permissionsJson.filter(
          (value): value is string => typeof value === "string"
        )
      : [];
    if (
      !assignment.isActive ||
      !customRole?.isActive ||
      !permissions.includes("sales")
    )
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "Your owner-assigned role is not permitted to complete counter sales.",
      });
    return;
  }
  if (role.role !== "sales")
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Your role is not permitted to complete counter sales.",
    });
}

export async function audit(
  userId: number,
  organizationId: number,
  action: string,
  entityType: string,
  entityId: number | undefined,
  details: unknown
) {
  const db = await dbOrThrow();
  await db.insert(auditLogs).values({
    organizationId,
    actorId: userId,
    action,
    entityType,
    entityId,
    detailsJson: JSON.stringify(details),
  });
}

export async function existingCheckoutByReference(
  clientReference: string | undefined,
  organizationId: number
) {
  if (!clientReference) return null;
  const db = await dbOrThrow();
  const existing = (
    await db
      .select({
        saleId: sales.id,
        invoiceId: invoices.id,
        saleNumber: sales.saleNumber,
        total: sales.total,
        paidAmount: sales.paidAmount,
        paymentStatus: sales.paymentStatus,
      })
      .from(sales)
      .innerJoin(invoices, eq(invoices.saleId, sales.id))
      .where(
        and(
          eq(sales.clientReference, clientReference),
          orgScope(sales, organizationId)
        )
      )
      .limit(1)
  )[0];
  return existing
    ? {
        id: existing.saleId,
        invoiceId: existing.invoiceId,
        total: Number(existing.total),
        paidAmount: Number(existing.paidAmount),
        paymentStatus: existing.paymentStatus,
        saleNumber: existing.saleNumber,
      }
    : null;
}

export async function existingTailoringCheckoutByReference(
  clientReference: string | undefined,
  organizationId: number
) {
  const replay = await existingCheckoutByReference(
    clientReference,
    organizationId
  );
  if (!replay) return null;
  const db = await dbOrThrow();
  const order = (
    await db
      .select({ orderNumber: tailoringOrders.orderNumber })
      .from(tailoringOrders)
      .where(
        and(
          eq(tailoringOrders.saleId, replay.id),
          orgScope(tailoringOrders, organizationId)
        )
      )
      .limit(1)
  )[0];
  return {
    ...replay,
    total: replay.paidAmount,
    orderNumber: order?.orderNumber,
  };
}

export async function consumeDiscountUsage(
  tx: any,
  discountId: number,
  organizationId: number
) {
  const updated = await tx
    .update(discountCodes)
    .set({ usedCount: sql`${discountCodes.usedCount} + 1` })
    .where(
      and(
        eq(discountCodes.id, discountId),
        orgScope(discountCodes, organizationId),
        or(
          isNull(discountCodes.usageLimit),
          lt(discountCodes.usedCount, discountCodes.usageLimit)
        )
      )
    )
    .returning({ id: discountCodes.id });
  if (!updated.length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This discount code has reached its usage limit.",
    });
}

export const sessionInput = z.object({
  openingCash: z.number().min(0).max(1000000),
  notes: z.string().trim().max(2000).optional(),
});
export const checkoutInput = z
  .object({
    clientReference: z.string().trim().max(120).optional(),
    sessionId: z.number().int().positive().optional(),
    heldOrderId: z.number().int().positive().optional(),
    customerId: z.number().int().positive().optional(),
    customerName: z.string().min(1).max(160),
    customerPhone: z.string().max(50).optional(),
    note: z.string().trim().max(2000).optional(),
    discount: z.number().min(0).max(1000000).default(0),
    discountCode: z.string().trim().max(80).optional(),
    paymentMethod: paymentMethod.default("cash"),
    paymentStatus: z.enum(["paid", "partial", "unpaid"]).default("paid"),
    payments: z.array(paymentLine).max(8).optional(),
    items: z.array(cartItem).min(1),
  })
  .superRefine((value, ctx) => {
    for (const item of value.items)
      if (item.lineDiscount > item.quantity * item.unitPrice)
        ctx.addIssue({
          code: "custom",
          path: ["items"],
          message: `The discount for ${item.name} cannot exceed its line subtotal.`,
        });
  });

export const quickCheckoutInput = z.object({
  clientReference: z.string().trim().max(120).optional(),
  sessionId: z.number().int().positive().optional(),
  customerId: z.number().int().positive().optional(),
  customerName: z.string().min(1).max(160).default("Walk-in customer"),
  customerPhone: z.string().max(50).optional(),
  amount: z.number().positive().max(1000000),
  paymentMethod: paymentMethod.default("cash"),
  note: z.string().trim().max(2000).optional(),
});

export const tailoringCheckoutInput = z
  .object({
    clientReference: z.string().trim().max(120).optional(),
    sessionId: z.number().int().positive().optional(),
    customerId: z.number().int().positive(),
    measurementProfileId: z.number().int().positive(),
    assignedTailorId: z.number().int().positive(),
    serviceId: z.number().int().positive().optional(),
    garmentType: z.string().trim().min(2).max(80),
    quantity: z.number().int().min(1).max(20),
    dueDate: z.string().optional(),
    orderPrice: z.number().positive(),
    paymentAmount: z.number().min(0).max(1000000),
    customerSuppliedFabric: z.boolean().default(false),
    fabricNotes: z.string().max(2000).optional(),
    paymentMethod,
    notes: z.string().max(3000),
    productionNotes: z.string().max(3000),
  })
  .superRefine((value, ctx) => {
    if (value.paymentAmount > value.orderPrice)
      ctx.addIssue({
        code: "custom",
        path: ["paymentAmount"],
        message: "The payment collected cannot exceed the quoted order price.",
      });
  });

export const heldOrderInput = z.object({
  sessionId: z.number().int().positive(),
  customerId: z.number().int().positive().optional(),
  note: z.string().trim().max(2000).optional(),
  items: z.array(cartItem).min(1),
});

export const returnItemSelection = z
  .array(
    z.object({
      saleItemId: z.number().int().positive(),
      quantity: z.number().positive(),
    })
  )
  .max(1, "Choose only one item to return.");
export const exchangeReplacementInput = z
  .object({
    serviceId: z.number().int().positive().optional(),
    inventoryItemId: z.number().int().positive().optional(),
    quantity: z.number().positive().max(999),
  })
  .refine(
    item => Boolean(item.serviceId || item.inventoryItemId),
    "Choose a replacement product."
  );

export const returnInput = z
  .object({
    sessionId: z.number().int().positive().optional(),
    originalSaleId: z.number().int().positive(),
    paymentMethod,
    mode: returnMode.default("items"),
    amount: z.number().positive().max(1000000).optional(),
    reason: z.string().trim().max(2000).optional(),
    note: z.string().trim().max(2000).optional(),
    items: returnItemSelection.optional(),
    replacementItem: exchangeReplacementInput.optional(),
  })
  .superRefine((value, ctx) => {
    if (
      (value.mode === "items" || value.mode === "exchange") &&
      (!value.items || value.items.length === 0)
    )
      ctx.addIssue({
        code: "custom",
        path: ["items"],
        message: "Choose at least one item to return.",
      });
    if (value.mode === "amount" && (!value.amount || value.amount <= 0))
      ctx.addIssue({
        code: "custom",
        path: ["amount"],
        message: "Enter a refund amount.",
      });
    if (value.mode === "exchange" && !value.replacementItem)
      ctx.addIssue({
        code: "custom",
        path: ["replacementItem"],
        message: "Choose a replacement product.",
      });
  });

export async function validateSession(
  tx: any,
  sessionId: number,
  organizationId: number
) {
  const session = (
    await tx
      .select()
      .from(posSessions)
      .where(
        and(
          eq(posSessions.id, sessionId),
          orgScope(posSessions, organizationId)
        )
      )
      .limit(1)
  )[0];
  if (!session || session.status !== "open")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Open a POS session before completing this order.",
    });
  return session;
}

export async function resolveSession(
  tx: any,
  sessionId: number | undefined,
  userId: number,
  organizationId: number
) {
  if (sessionId) return validateSession(tx, sessionId, organizationId);
  const existing = (
    await tx
      .select()
      .from(posSessions)
      .where(
        and(
          orgScope(posSessions, organizationId),
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
  const result = await tx
    .insert(posSessions)
    .values({
      organizationId,
      sessionNumber,
      openedBy: userId,
      openingCash: money(0),
      notes: "Opened automatically while synchronizing offline sales",
    })
    .returning();
  const session = result[0];
  if (!session)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "The POS session could not be opened for offline sales.",
    });
  return session;
}

export async function resolveDiscount(
  tx: any,
  code: string | undefined,
  subtotal: number,
  organizationId: number
) {
  if (!code) return { id: null, snapshot: null, amount: 0 };
  const record = (
    await tx
      .select()
      .from(discountCodes)
      .where(
        and(
          eq(discountCodes.code, code.toUpperCase()),
          orgScope(discountCodes, organizationId)
        )
      )
      .limit(1)
  )[0];
  if (!record || !record.isActive)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This discount code is not active.",
    });
  if (record.expiresAt && new Date(record.expiresAt).getTime() < Date.now())
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This discount code has expired.",
    });
  if (record.usageLimit !== null && record.usedCount >= record.usageLimit)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This discount code has reached its usage limit.",
    });
  if (subtotal < Number(record.minSubtotal))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `This code requires a subtotal of at least ${money(Number(record.minSubtotal))} BHD.`,
    });
  const raw =
    record.type === "percent"
      ? (subtotal * Number(record.value)) / 100
      : Number(record.value);
  const amount = Math.min(
    subtotal,
    record.maxDiscount ? Math.min(raw, Number(record.maxDiscount)) : raw
  );
  return { id: record.id, snapshot: record.code, amount };
}
