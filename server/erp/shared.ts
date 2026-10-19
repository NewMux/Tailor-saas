import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditLogs,
  customRoles,
  userBusinessRoles,
  userCustomRoles,
  type BusinessRole,
} from "../../drizzle/schema";
import { orgScope, dbOrThrow } from "../_core/tenantDb";
import { currentImpersonator } from "../_core/requestContext";
import { resolveAccess } from "../_core/access";
export {
  adminRoles,
  salesRoles,
  catalogRoles,
  inventoryRoles,
  payrollRoles,
  tailoringRoles,
  staffDirectoryRoles,
  dashboardRoles,
  customerReadRoles,
  customerWriteRoles,
  measurementWriteRoles,
  customPermissionValues,
  customRoleCanAccess,
  resolveAccess,
  hasAccess,
  type CustomPermission,
} from "../_core/access";
export { dbOrThrow };

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const staffDocumentMimeTypes = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
export const staffDocumentExtensions = new Set([
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".doc",
  ".docx",
]);
export const three = (value: number) => value.toFixed(3);
export const getMonthBounds = (payPeriod: string) => {
  const start = new Date(`${payPeriod}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end: new Date(end.getTime() - 1) };
};
export const absenceDeductionFor = (
  baseSalary: number,
  status: string,
  payPeriod: string
) => {
  const [year, month] = payPeriod.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const daily = baseSalary / daysInMonth;
  return status === "absent" ? daily : status === "half_day" ? daily / 2 : 0;
};
export const id = (result: unknown) => {
  const row = Array.isArray(result) ? result[0] : result;
  return Number((row as { id?: number })?.id || 0);
};
const dashboardRange = z.enum(["today", "7d", "30d", "90d", "all", "custom"]);
export const getDashboardRangeStart = (
  range: z.infer<typeof dashboardRange>,
  now = new Date()
) => {
  const start = new Date(now);
  if (range === "all") return null;
  if (range === "today") {
    start.setHours(0, 0, 0, 0);
    return start;
  }
  if (range === "7d") start.setDate(start.getDate() - 6);
  if (range === "30d") start.setDate(start.getDate() - 29);
  if (range === "90d") start.setDate(start.getDate() - 89);
  start.setHours(0, 0, 0, 0);
  return start;
};
export const getCustomDashboardRange = (
  startDate: string,
  endDate: string
) => ({
  start: new Date(`${startDate}T00:00:00.000Z`),
  end: new Date(`${endDate}T23:59:59.999Z`),
});
export const dashboardInput = z
  .object({
    range: dashboardRange,
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.range === "custom" && (!value.startDate || !value.endDate))
      ctx.addIssue({
        code: "custom",
        message: "Choose both a start and end date for a custom period.",
      });
    if (
      value.range === "custom" &&
      value.startDate &&
      value.endDate &&
      value.startDate > value.endDate
    )
      ctx.addIssue({
        code: "custom",
        message:
          "The custom period end date must be on or after its start date.",
      });
  });
export const salesSource = z.enum(["counter", "manual", "tailoring"]);
export const salesHistoryInput = z
  .object({
    search: z.string().max(160).optional(),
    source: salesSource.optional(),
    paymentStatus: z.enum(["paid", "partial", "unpaid"]).optional(),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.startDate && value.endDate && value.startDate > value.endDate)
      ctx.addIssue({
        code: "custom",
        message: "The end date must be on or after the start date.",
      });
  });
export const invoiceListInput = z
  .object({
    search: z.string().max(160).optional(),
    status: z.enum(["paid", "partial", "unpaid"]).optional(),
    source: salesSource.optional(),
    paymentMethod: z
      .enum(["cash", "benefitpay", "bank_transfer", "credit_card"])
      .optional(),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.startDate && value.endDate && value.startDate > value.endDate)
      ctx.addIssue({
        code: "custom",
        message: "The end date must be on or after the start date.",
      });
  });
export const invoicePaymentInput = z.object({
  invoiceId: z.number().int().positive(),
  amount: z.number().positive().max(1000000),
  paymentMethod: z.enum(["cash", "benefitpay", "bank_transfer", "credit_card"]),
  reference: z.string().trim().max(160).optional(),
});
export const invoiceDeleteInput = z.object({
  invoiceId: z.number().int().positive(),
});
export const manualSaleInput = z
  .object({
    customerId: z.number().int().positive().optional(),
    customerName: z.string().trim().min(2).max(160),
    customerPhone: z.string().trim().max(50),
    description: z.string().trim().min(2).max(160),
    quantity: z.number().positive().max(999),
    unitPrice: z.number().positive().max(1000000),
    discount: z.number().min(0).max(1000000),
    paymentMethod: z.enum([
      "cash",
      "benefitpay",
      "bank_transfer",
      "credit_card",
    ]),
    paymentStatus: z.enum(["paid", "partial", "unpaid"]),
    notes: z.string().max(2000),
  })
  .superRefine((value, ctx) => {
    if (value.discount > value.quantity * value.unitPrice)
      ctx.addIssue({
        code: "custom",
        path: ["discount"],
        message: "Discount cannot exceed the sale subtotal.",
      });
  });
export const monthInput = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a valid report month."),
});
export const getMonthWindow = (month: string) => {
  const [year, monthIndex] = month.split("-").map(Number);
  return {
    start: new Date(Date.UTC(year, monthIndex - 1, 1)),
    end: new Date(Date.UTC(year, monthIndex, 0, 23, 59, 59, 999)),
  };
};
/** Verifies the caller may perform an action within their own organization; see resolveAccess. */
export async function access(
  userId: number,
  organizationId: number,
  allowed: BusinessRole[]
) {
  return (await resolveAccess(userId, organizationId, allowed)).label;
}
export async function audit(
  userId: number,
  organizationId: number,
  action: string,
  entityType: string,
  entityId?: number,
  details?: unknown
) {
  const db = await dbOrThrow();
  await db.insert(auditLogs).values({
    organizationId,
    actorId: userId,
    impersonatedBy: currentImpersonator(),
    action,
    entityType,
    entityId,
    detailsJson: details ? JSON.stringify(details) : null,
  });
}
export const customerInput = z.object({
  name: z.string().min(2).max(160),
  phone: z.string().min(4).max(50),
  email: z.string().email().or(z.literal("")),
  address: z.string().max(1000),
  notes: z.string().max(3000),
  preferredContact: z.string().max(40),
});
export const tailoringOrderStatuses = [
  "draft",
  "confirmed",
  "cutting",
  "stitching",
  "fitting",
  "ready",
  "handed_over",
  "cancelled",
] as const;
export const tailoringStatus = z.enum(tailoringOrderStatuses);
export const tailoringListInput = z.object({
  search: z.string().max(160).optional(),
});
export const tailoringRelationError = (
  customerId: number,
  measurementCustomerId: number | null | undefined,
  tailorActive: boolean | null | undefined
) => {
  if (measurementCustomerId !== customerId) return "measurement" as const;
  if (tailorActive === false) return "tailor" as const;
  return null;
};
export const tailoringOrderInput = z.object({
  customerId: z.number().int().positive(),
  measurementProfileId: z.number().int().positive().optional(),
  assignedTailorId: z.number().int().positive().optional(),
  garmentType: z.string().min(2).max(80),
  quantity: z.number().int().min(1).max(20),
  dueDate: z.string().optional(),
  price: z.number().min(0),
  customerSuppliedFabric: z.boolean().default(false),
  fabricNotes: z.string().max(2000).optional(),
  notes: z.string().max(3000),
  productionNotes: z.string().max(3000),
});
