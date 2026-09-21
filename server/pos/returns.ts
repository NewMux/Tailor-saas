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
export const returnsRouter = router({
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
          .where(
            and(eq(sales.saleNumber, term), orgScope(sales, ctx.organizationId))
          )
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
        .where(
          and(
            eq(saleItems.saleId, sale.id),
            orgScope(saleItems, ctx.organizationId)
          )
        );
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
            .where(
              and(
                eq(sales.id, input.originalSaleId),
                orgScope(sales, ctx.organizationId)
              )
            )
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
          .where(
            and(
              eq(saleItems.saleId, original.id),
              orgScope(saleItems, ctx.organizationId)
            )
          );
        const priorReturns = await tx
          .select()
          .from(sales)
          .where(
            and(
              eq(sales.returnOfSaleId, original.id),
              orgScope(sales, ctx.organizationId)
            )
          );
        const priorRefunds = priorReturns.filter(
          row => row.returnMode !== "exchange_replacement"
        );
        const priorReturnIds = new Set(priorRefunds.map(row => row.id));
        const priorReturnItems = (
          await tx
            .select()
            .from(saleItems)
            .where(orgScope(saleItems, ctx.organizationId))
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
                .where(
                  and(
                    eq(services.id, replacementInput.serviceId),
                    orgScope(services, ctx.organizationId)
                  )
                )
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
                message: "The replacement inventory item is no longer active.",
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
            await tx.insert(saleItems).values({
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
                  .where(
                    and(
                      eq(inventoryItems.id, stock.id),
                      orgScope(inventoryItems, ctx.organizationId)
                    )
                  );
                await tx.insert(stockMovements).values({
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
          await tx.insert(saleItems).values({
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
        await tx.insert(posPayments).values({
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
          await tx.insert(saleItems).values({
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
            await tx.insert(stockMovements).values({
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
          await tx.insert(posPayments).values({
            organizationId: ctx.organizationId,
            saleId: replacementSaleId,
            method: input.paymentMethod,
            amount: money(requestedGross),
            reference: `Exchange credit from ${original.saleNumber}`,
            createdBy: ctx.user.id,
          });
          if (Math.abs(settlementAmount) > 0.0005)
            await tx.insert(posPayments).values({
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
          total: input.mode === "exchange" ? settlementAmount : -requestedGross,
          replacementSaleId,
          replacementInvoiceId,
          settlementAmount: input.mode === "exchange" ? settlementAmount : null,
        };
      });
      await audit(
        ctx.user.id,
        ctx.organizationId,
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
});
