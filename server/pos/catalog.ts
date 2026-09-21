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
export const catalogRouter = router({
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
        .where(
          and(
            orgScope(services, ctx.organizationId),
            eq(services.isActive, true)
          )
        )
        .orderBy(services.name),
      db
        .select()
        .from(inventoryItems)
        .where(
          and(
            orgScope(inventoryItems, ctx.organizationId),
            eq(inventoryItems.isActive, true)
          )
        )
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
});
