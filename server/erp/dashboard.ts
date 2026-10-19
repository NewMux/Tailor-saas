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
  dashboardRoles,
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
  audit,
  customerInput,
  tailoringOrderStatuses,
  tailoringStatus,
  tailoringListInput,
  tailoringRelationError,
  tailoringOrderInput,
} from "./shared";
export const dashboardProcedure = tenantProcedure
  .input(dashboardInput.optional())
  .query(async ({ ctx, input }) => {
    await access(ctx.user.id, ctx.organizationId, dashboardRoles);
    const db = await dbOrThrow();
    const range = input?.range || "30d";
    const customRange =
      range === "custom" && input?.startDate && input?.endDate
        ? getCustomDashboardRange(input.startDate, input.endDate)
        : null;
    const rangeStart = customRange?.start || getDashboardRangeStart(range);
    const orgId = ctx.organizationId;
    const salesWhere = and(
      orgScope(sales, orgId),
      customRange
        ? and(
            gte(sales.createdAt, customRange.start),
            lte(sales.createdAt, customRange.end)
          )
        : rangeStart
          ? gte(sales.createdAt, rangeStart)
          : undefined
    );
    const today = getDashboardRangeStart("today")!;
    const weekStart = getDashboardRangeStart("7d")!;
    const monthStart = getDashboardRangeStart("30d")!;
    const [customerCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(customers)
      .where(orgScope(customers, orgId));
    const [inventoryCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(inventoryItems)
      .where(
        and(orgScope(inventoryItems, orgId), eq(inventoryItems.isActive, true))
      );
    const [rangeMetrics] = await db
      .select({
        total: sql<string>`coalesce(sum(${sales.total}), 0)`,
        count: sql<number>`count(*)`,
      })
      .from(sales)
      .where(salesWhere);
    const [todayMetrics] = await db
      .select({ total: sql<string>`coalesce(sum(${sales.total}), 0)` })
      .from(sales)
      .where(and(orgScope(sales, orgId), gte(sales.createdAt, today)));
    const [weekMetrics] = await db
      .select({ total: sql<string>`coalesce(sum(${sales.total}), 0)` })
      .from(sales)
      .where(and(orgScope(sales, orgId), gte(sales.createdAt, weekStart)));
    const [monthMetrics] = await db
      .select({ total: sql<string>`coalesce(sum(${sales.total}), 0)` })
      .from(sales)
      .where(and(orgScope(sales, orgId), gte(sales.createdAt, monthStart)));
    const low = await db
      .select()
      .from(inventoryItems)
      .where(
        and(
          orgScope(inventoryItems, orgId),
          sql`${inventoryItems.quantity} <= ${inventoryItems.minThreshold}`
        )
      )
      .orderBy(inventoryItems.quantity)
      .limit(8);
    const filteredSales = await db
      .select()
      .from(sales)
      .where(salesWhere)
      .orderBy(desc(sales.createdAt))
      .limit(250);
    const revenueByDayMap = new Map<string, number>();
    for (const sale of filteredSales) {
      const day = new Date(sale.createdAt).toISOString().slice(0, 10);
      revenueByDayMap.set(
        day,
        (revenueByDayMap.get(day) || 0) + Number(sale.total)
      );
    }
    const revenueByDay = Array.from(revenueByDayMap.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([day, revenue]) => ({ day, revenue }));
    const topServices = await db
      .select({
        name: saleItems.nameSnapshot,
        quantity: sql<string>`coalesce(sum(${saleItems.quantity}), 0)`,
        revenue: sql<string>`coalesce(sum(${saleItems.lineTotal}), 0)`,
      })
      .from(saleItems)
      .innerJoin(sales, eq(saleItems.saleId, sales.id))
      .where(and(orgScope(saleItems, orgId), salesWhere))
      .groupBy(saleItems.nameSnapshot)
      .orderBy(desc(sql`sum(${saleItems.lineTotal})`))
      .limit(5);
    const [activeStaff] = await db
      .select({ count: sql<number>`count(*)` })
      .from(staffProfiles)
      .where(
        and(orgScope(staffProfiles, orgId), eq(staffProfiles.isActive, true))
      );
    const attendanceToday = await db
      .select({ status: attendance.status, count: sql<number>`count(*)` })
      .from(attendance)
      .where(and(orgScope(attendance, orgId), eq(attendance.workDate, today)))
      .groupBy(attendance.status);
    const attendanceSummary = attendanceToday.reduce(
      (summary, item) => ({
        ...summary,
        [item.status]: Number(item.count || 0),
      }),
      { present: 0, absent: 0, leave: 0, half_day: 0 } as Record<string, number>
    );
    const total = Number(rangeMetrics?.total || 0);
    const saleCount = Number(rangeMetrics?.count || 0);
    return {
      range,
      customerCount: Number(customerCount?.count || 0),
      inventoryCount: Number(inventoryCount?.count || 0),
      totalSales: total,
      saleCount,
      averageOrderValue: saleCount ? total / saleCount : 0,
      todayRevenue: Number(todayMetrics?.total || 0),
      weekRevenue: Number(weekMetrics?.total || 0),
      monthRevenue: Number(monthMetrics?.total || 0),
      lowStock: low,
      recentSales: filteredSales.slice(0, 8),
      revenueByDay,
      topServices: topServices.map(item => ({
        ...item,
        quantity: Number(item.quantity),
        revenue: Number(item.revenue),
      })),
      staff: {
        activeCount: Number(activeStaff?.count || 0),
        attendance: attendanceSummary,
      },
    };
  });
