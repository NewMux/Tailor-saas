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
  hasAccess,
  audit,
  customerInput,
  tailoringOrderStatuses,
  tailoringStatus,
  tailoringListInput,
  tailoringRelationError,
  tailoringOrderInput,
} from "./shared";
export const inventoryRouter = router({
  list: tenantProcedure.query(async ({ ctx }) => {
    await access(ctx.user.id, ctx.organizationId, [
      "admin",
      "sales",
      "inventory",
    ]);
    const db = await dbOrThrow();
    const items = await db
      .select()
      .from(inventoryItems)
      .where(
        and(
          orgScope(inventoryItems, ctx.organizationId),
          eq(inventoryItems.isActive, true)
        )
      )
      .orderBy(inventoryItems.name);
    const ids = items.map(item => item.id);
    const movementRows = ids.length
      ? await db
          .select({ inventoryItemId: stockMovements.inventoryItemId })
          .from(stockMovements)
          .where(
            and(
              orgScope(stockMovements, ctx.organizationId),
              inArray(stockMovements.inventoryItemId, ids)
            )
          )
          .groupBy(stockMovements.inventoryItemId)
      : [];
    const movementIds = new Set(movementRows.map(row => row.inventoryItemId));
    // Purchase cost is for the people who manage stock.
    const seesCost = await hasAccess(ctx.user.id, ctx.organizationId, inventoryRoles);
    return items.map(({ costPerUnit, ...item }) => ({
      ...item,
      // Absent (not null) for callers who may not see cost; typed as present so
      // the stock screens, which only managers reach, keep their types.
      ...((seesCost ? { costPerUnit } : {}) as { costPerUnit: string }),
      quantity: three(
        effectiveInventoryQuantity({
          inventoryType: item.inventoryType,
          quantity: item.quantity,
          rollCount: item.rollCount,
          metersPerRoll: item.metersPerRoll,
          hasMovement: movementIds.has(item.id),
        })
      ),
    }));
  }),
  create: tenantProcedure
    .input(
      z.object({
        code: z.string().min(1),
        name: z.string().min(2),
        inventoryType: z.enum(["material", "item"]).default("material"),
        category: z.enum([
          "fabric",
          "lining",
          "buttons",
          "thread",
          "accessory",
          "other",
        ]),
        color: z.string(),
        size: z.string().optional(),
        widthInches: z.number().optional(),
        unit: z.string().min(1),
        minThreshold: z.number().min(0),
        costPerUnit: z.number().min(0),
        salePrice: z.number().min(0).default(0),
        openingQuantity: z.number().min(0),
        rollCount: z.number().int().min(0).default(0),
        metersPerRoll: z.number().positive().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, inventoryRoles);
      const db = await dbOrThrow();
      const openingQuantity =
        rollDerivedQuantity(
          input.inventoryType,
          input.rollCount,
          input.metersPerRoll
        ) ?? input.openingQuantity;
      const result = await db
        .insert(inventoryItems)
        .values({
          ...input,
          organizationId: ctx.organizationId,
          color: input.color || null,
          size: input.size || null,
          widthInches: input.widthInches?.toString(),
          quantity: three(openingQuantity),
          rollCount: input.rollCount,
          metersPerRoll: input.metersPerRoll?.toString() || null,
          minThreshold: three(input.minThreshold),
          costPerUnit: three(input.costPerUnit),
          salePrice: three(input.salePrice),
        })
        .returning({ id: inventoryItems.id });
      const itemId = id(result);
      if (openingQuantity)
        await db.insert(stockMovements).values({
          organizationId: ctx.organizationId,
          inventoryItemId: itemId,
          movementType: "opening",
          quantityChange: three(openingQuantity),
          quantityBefore: "0.000",
          quantityAfter: three(openingQuantity),
          createdBy: ctx.user.id,
          notes: "Opening balance",
        });
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "INVENTORY_CREATED",
        "inventoryItem",
        itemId
      );
      return { id: itemId };
    }),
  update: tenantProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        code: z.string().min(1),
        name: z.string().min(2),
        inventoryType: z.enum(["material", "item"]).default("material"),
        category: z.enum([
          "fabric",
          "lining",
          "buttons",
          "thread",
          "accessory",
          "other",
        ]),
        color: z.string(),
        size: z.string().optional(),
        widthInches: z.number().optional(),
        unit: z.string().min(1),
        minThreshold: z.number().min(0),
        costPerUnit: z.number().min(0),
        salePrice: z.number().min(0).default(0),
        rollCount: z.number().int().min(0),
        metersPerRoll: z.number().positive().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, inventoryRoles);
      const db = await dbOrThrow();
      const item = (
        await db
          .select()
          .from(inventoryItems)
          .where(
            and(
              eq(inventoryItems.id, input.id),
              orgScope(inventoryItems, ctx.organizationId)
            )
          )
          .limit(1)
      )[0];
      if (!item)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Inventory item not found.",
        });
      const seedQuantity =
        Number(item.quantity) <= 0
          ? rollDerivedQuantity(
              input.inventoryType,
              input.rollCount,
              input.metersPerRoll
            )
          : null;
      const quantityBefore = Number(item.quantity);
      const quantityAfter = seedQuantity ?? quantityBefore;
      await db.transaction(async tx => {
        await tx
          .update(inventoryItems)
          .set({
            code: input.code,
            name: input.name,
            inventoryType: input.inventoryType,
            category: input.category,
            color: input.color || null,
            size: input.size || null,
            widthInches: input.widthInches?.toString(),
            unit: input.unit,
            quantity: three(quantityAfter),
            minThreshold: three(input.minThreshold),
            costPerUnit: three(input.costPerUnit),
            salePrice: three(input.salePrice),
            rollCount: input.rollCount,
            metersPerRoll: input.metersPerRoll?.toString() || null,
          })
          .where(
            and(
              eq(inventoryItems.id, input.id),
              orgScope(inventoryItems, ctx.organizationId)
            )
          );
        if (seedQuantity !== null && seedQuantity > 0)
          await tx.insert(stockMovements).values({
            organizationId: ctx.organizationId,
            inventoryItemId: input.id,
            movementType: "opening",
            quantityChange: three(seedQuantity),
            quantityBefore: three(quantityBefore),
            quantityAfter: three(seedQuantity),
            createdBy: ctx.user.id,
            notes: "Opening balance derived from roll count × meters per roll",
          });
      });
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "INVENTORY_UPDATED",
        "inventoryItem",
        input.id,
        {
          ...input,
          quantity: quantityAfter,
          quantityDerivedFromRolls: seedQuantity !== null,
        }
      );
      return { success: true };
    }),
  adjust: tenantProcedure
    .input(
      z.object({
        inventoryItemId: z.number().int(),
        quantityChange: z.number(),
        rollCountChange: z.number().int().default(0),
        notes: z.string().max(1000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, inventoryRoles);
      const db = await dbOrThrow();
      const item = (
        await db
          .select()
          .from(inventoryItems)
          .where(
            and(
              eq(inventoryItems.id, input.inventoryItemId),
              orgScope(inventoryItems, ctx.organizationId)
            )
          )
          .limit(1)
      )[0];
      if (!item)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Inventory item not found.",
        });
      const before = Number(item.quantity);
      const rollQuantityChange =
        item.inventoryType === "material" &&
        input.quantityChange === 0 &&
        input.rollCountChange !== 0 &&
        Number(item.metersPerRoll) > 0
          ? input.rollCountChange * Number(item.metersPerRoll)
          : 0;
      const effectiveQuantityChange =
        input.quantityChange !== 0 ? input.quantityChange : rollQuantityChange;
      const after = before + effectiveQuantityChange;
      const rollCountAfter =
        Number(item.rollCount || 0) + input.rollCountChange;
      if (effectiveQuantityChange === 0 && input.rollCountChange === 0)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Enter a meter or roll adjustment.",
        });
      if (after < 0 || rollCountAfter < 0)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Stock cannot drop below zero.",
        });
      await db
        .update(inventoryItems)
        .set({ quantity: three(after), rollCount: rollCountAfter })
        .where(
          and(
            eq(inventoryItems.id, item.id),
            orgScope(inventoryItems, ctx.organizationId)
          )
        );
      await db.insert(stockMovements).values({
        organizationId: ctx.organizationId,
        inventoryItemId: item.id,
        movementType: "adjustment",
        quantityChange: three(effectiveQuantityChange),
        quantityBefore: three(before),
        quantityAfter: three(after),
        createdBy: ctx.user.id,
        notes: input.notes || null,
      });
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "STOCK_ADJUSTED",
        "inventoryItem",
        item.id,
        input
      );
      return { quantity: after };
    }),
  remove: tenantProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, inventoryRoles);
      const db = await dbOrThrow();
      const item = (
        await db
          .select({ id: inventoryItems.id, name: inventoryItems.name })
          .from(inventoryItems)
          .where(
            and(
              eq(inventoryItems.id, input.id),
              orgScope(inventoryItems, ctx.organizationId)
            )
          )
          .limit(1)
      )[0];
      if (!item)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Inventory item not found.",
        });
      await db
        .update(inventoryItems)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          and(
            eq(inventoryItems.id, input.id),
            orgScope(inventoryItems, ctx.organizationId)
          )
        );
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "INVENTORY_ARCHIVED",
        "inventoryItem",
        input.id,
        { name: item.name }
      );
      return { success: true, id: input.id, name: item.name };
    }),
});
