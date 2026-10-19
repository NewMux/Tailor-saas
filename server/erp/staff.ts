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
import { MAX_STAFF_DOCUMENT_BASE64_LENGTH } from "@shared/const";
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
import { isStorageConfigured, storageGetSignedUrl, storagePut } from "../storage";
import { tenantProcedure, router } from "../_core/trpc";
import { assertOwned, orgScope } from "../_core/tenantDb";
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
export const staffRouter = router({
  documents: router({
    list: tenantProcedure
      .input(z.object({ staffProfileId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        await access(ctx.user.id, ctx.organizationId, payrollRoles);
        return (await dbOrThrow())
          .select()
          .from(staffDocuments)
          .where(
            and(
              eq(staffDocuments.staffProfileId, input.staffProfileId),
              orgScope(staffDocuments, ctx.organizationId)
            )
          )
          .orderBy(desc(staffDocuments.uploadedAt))
          .limit(100);
      }),
    download: tenantProcedure
      .input(z.object({ documentId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await access(ctx.user.id, ctx.organizationId, payrollRoles);
        const document = (
          await (
            await dbOrThrow()
          )
            .select()
            .from(staffDocuments)
            .where(
              and(
                eq(staffDocuments.id, input.documentId),
                orgScope(staffDocuments, ctx.organizationId)
              )
            )
            .limit(1)
        )[0];
        if (!document)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Staff document not found.",
          });
        await audit(
          ctx.user.id,
          ctx.organizationId,
          "STAFF_DOCUMENT_VIEWED",
          "staffDocument",
          document.id
        );
        return {
          url: await storageGetSignedUrl(document.storageKey),
          fileName: document.fileName,
          contentType: document.contentType,
        };
      }),
    upload: tenantProcedure
      .input(
        z
          .object({
            staffProfileId: z.number().int().positive(),
            label: z.string().trim().min(2).max(120),
            fileName: z.string().trim().min(1).max(255),
            contentType: z.string().trim().min(1).max(120),
            dataBase64: z.string().min(1).max(MAX_STAFF_DOCUMENT_BASE64_LENGTH, "Documents must be 3 MB or smaller."),
          })
          .superRefine((value, ctx) => {
            const extension = value.fileName
              .toLowerCase()
              .slice(value.fileName.lastIndexOf("."));
            if (
              !staffDocumentMimeTypes.has(value.contentType) ||
              !staffDocumentExtensions.has(extension)
            )
              ctx.addIssue({
                code: "custom",
                path: ["fileName"],
                message:
                  "Upload a PDF, PNG, JPG, WEBP, DOC, or DOCX staff document.",
              });
          })
      )
      .mutation(async ({ ctx, input }) => {
        await access(ctx.user.id, ctx.organizationId, payrollRoles);
        if (!isStorageConfigured())
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Document storage is not set up on this server yet.",
          });
        const profile = (
          await (
            await dbOrThrow()
          )
            .select({ id: staffProfiles.id })
            .from(staffProfiles)
            .where(
              and(
                eq(staffProfiles.id, input.staffProfileId),
                orgScope(staffProfiles, ctx.organizationId)
              )
            )
            .limit(1)
        )[0];
        if (!profile)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Staff profile not found.",
          });
        const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
        const stored = await storagePut(
          `org/${ctx.organizationId}/staff/${input.staffProfileId}/${Date.now()}-${safeName}`,
          Buffer.from(input.dataBase64, "base64"),
          input.contentType
        );
        const result = await (
          await dbOrThrow()
        )
          .insert(staffDocuments)
          .values({
            organizationId: ctx.organizationId,
            staffProfileId: input.staffProfileId,
            label: input.label,
            fileName: input.fileName,
            contentType: input.contentType,
            storageKey: stored.key,
            storageUrl: stored.url,
            uploadedBy: ctx.user.id,
          })
          .returning({ id: staffDocuments.id });
        const documentId = id(result);
        await audit(
          ctx.user.id,
          ctx.organizationId,
          "STAFF_DOCUMENT_UPLOADED",
          "staffDocument",
          documentId,
          { staffProfileId: input.staffProfileId, label: input.label }
        );
        return { id: documentId, url: stored.url };
      }),
  }),
  list: tenantProcedure.query(async ({ ctx }) => {
    await access(ctx.user.id, ctx.organizationId, staffDirectoryRoles);
    const rows = await (await dbOrThrow())
      .select()
      .from(staffProfiles)
      .where(
        and(
          orgScope(staffProfiles, ctx.organizationId),
          eq(staffProfiles.isActive, true)
        )
      )
      .orderBy(staffProfiles.name);
    // Pay is for payroll and admins; everyone else gets the directory (pickers).
    if (await hasAccess(ctx.user.id, ctx.organizationId, payrollRoles)) return rows;
    // Typed as full rows so the payroll screens keep their types; the screens
    // that non-payroll roles can reach only read these directory fields.
    return rows.map(({ id, userId, name, phone, jobTitle, isActive }) => ({
      id,
      userId,
      name,
      phone,
      jobTitle,
      isActive,
    })) as unknown as typeof rows;
  }),
  linkAccess: tenantProcedure
    .input(
      z.object({
        staffProfileId: z.number().int().positive(),
        userId: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, adminRoles);
      const db = await dbOrThrow();
      const profile = (
        await db
          .select()
          .from(staffProfiles)
          .where(
            and(
              eq(staffProfiles.id, input.staffProfileId),
              orgScope(staffProfiles, ctx.organizationId)
            )
          )
          .limit(1)
      )[0];
      if (!profile)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Staff profile not found.",
        });
      const user = (
        await db
          .select({ id: users.id })
          .from(users)
          .where(
            and(eq(users.id, input.userId), orgScope(users, ctx.organizationId))
          )
          .limit(1)
      )[0];
      if (!user)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "ERP access account not found.",
        });
      const existing = (
        await db
          .select({ id: staffProfiles.id })
          .from(staffProfiles)
          .where(
            and(
              eq(staffProfiles.userId, input.userId),
              orgScope(staffProfiles, ctx.organizationId)
            )
          )
          .limit(1)
      )[0];
      if (existing && existing.id !== input.staffProfileId)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This ERP account is already linked to another payroll profile.",
        });
      await db
        .update(staffProfiles)
        .set({ userId: input.userId, updatedAt: new Date() })
        .where(
          and(
            eq(staffProfiles.id, input.staffProfileId),
            orgScope(staffProfiles, ctx.organizationId)
          )
        );
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "STAFF_ACCESS_LINKED",
        "staffProfile",
        input.staffProfileId,
        { userId: input.userId }
      );
      return { success: true };
    }),
  unlinkAccess: tenantProcedure
    .input(z.object({ staffProfileId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, adminRoles);
      const db = await dbOrThrow();
      await db
        .update(staffProfiles)
        .set({ userId: null, updatedAt: new Date() })
        .where(
          and(
            eq(staffProfiles.id, input.staffProfileId),
            orgScope(staffProfiles, ctx.organizationId)
          )
        );
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "STAFF_ACCESS_UNLINKED",
        "staffProfile",
        input.staffProfileId
      );
      return { success: true };
    }),
  create: tenantProcedure
    .input(
      z.object({
        name: z.string().min(2),
        phone: z.string(),
        jobTitle: z.string().min(2),
        baseSalary: z.number().min(0),
        commissionRate: z.number().min(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, payrollRoles);
      const result = await (
        await dbOrThrow()
      )
        .insert(staffProfiles)
        .values({
          ...input,
          organizationId: ctx.organizationId,
          phone: input.phone || null,
          baseSalary: three(input.baseSalary),
          commissionRate: three(input.commissionRate),
        })
        .returning({ id: staffProfiles.id });
      const staffId = id(result);
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "STAFF_CREATED",
        "staffProfile",
        staffId
      );
      return { id: staffId };
    }),
  remove: tenantProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, payrollRoles);
      const db = await dbOrThrow();
      const profile = (
        await db
          .select({ id: staffProfiles.id, name: staffProfiles.name })
          .from(staffProfiles)
          .where(
            and(
              eq(staffProfiles.id, input.id),
              orgScope(staffProfiles, ctx.organizationId)
            )
          )
          .limit(1)
      )[0];
      if (!profile)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Staff profile not found.",
        });
      await db
        .update(staffProfiles)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          and(
            eq(staffProfiles.id, input.id),
            orgScope(staffProfiles, ctx.organizationId)
          )
        );
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "STAFF_ARCHIVED",
        "staffProfile",
        input.id,
        {
          name: profile.name,
        }
      );
      return { success: true, id: input.id, name: profile.name };
    }),
  recordAttendance: tenantProcedure
    .input(
      z.object({
        staffProfileId: z.number().int(),
        workDate: z.string(),
        status: z.enum(["present", "absent", "leave", "half_day"]),
        absenceReason: z
          .enum(["sick", "unexcused", "personal", "other"])
          .optional(),
        absenceDetails: z.string().max(1000).optional(),
        absenceDocumentId: z.number().int().positive().optional(),
        notes: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, payrollRoles);
      const db = await dbOrThrow();
      const profile = (
        await db
          .select()
          .from(staffProfiles)
          .where(
            and(
              eq(staffProfiles.id, input.staffProfileId),
              orgScope(staffProfiles, ctx.organizationId)
            )
          )
          .limit(1)
      )[0];
      if (!profile)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Staff profile not found.",
        });
      await assertOwned(staffDocuments, input.absenceDocumentId, ctx.organizationId, "Document");
      const payPeriod = input.workDate.slice(0, 7);
      const absenceDeduction = absenceDeductionFor(
        Number(profile.baseSalary),
        input.status,
        payPeriod
      );
      await db.insert(attendance).values({
        organizationId: ctx.organizationId,
        staffProfileId: input.staffProfileId,
        workDate: new Date(input.workDate),
        status: input.status,
        absenceReason:
          input.status === "present" ? null : input.absenceReason || null,
        absenceDetails:
          input.status === "present"
            ? null
            : input.absenceDetails?.trim() || null,
        absenceDocumentId:
          input.status === "present" ? null : input.absenceDocumentId || null,
        absenceDeduction: three(absenceDeduction),
        notes: input.notes || null,
        recordedBy: ctx.user.id,
      });
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "ATTENDANCE_RECORDED",
        "attendance",
        input.staffProfileId,
        { status: input.status, absenceDeduction }
      );
      return { success: true, absenceDeduction };
    }),
  attendanceHistory: tenantProcedure.query(async ({ ctx }) => {
    await access(ctx.user.id, ctx.organizationId, payrollRoles);
    return (await dbOrThrow())
      .select()
      .from(attendance)
      .where(orgScope(attendance, ctx.organizationId))
      .orderBy(desc(attendance.workDate))
      .limit(100);
  }),
  performance: tenantProcedure.query(async ({ ctx }) => {
    await access(ctx.user.id, ctx.organizationId, payrollRoles);
    return (await dbOrThrow())
      .select()
      .from(performanceRecords)
      .where(orgScope(performanceRecords, ctx.organizationId))
      .orderBy(desc(performanceRecords.workDate))
      .limit(100);
  }),
  addPerformance: tenantProcedure
    .input(
      z.object({
        staffProfileId: z.number().int(),
        workDate: z.string(),
        metric: z.string().min(2),
        units: z.number().min(0),
        commissionEarned: z.number().min(0),
        notes: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, payrollRoles);
      await assertOwned(staffProfiles, input.staffProfileId, ctx.organizationId, "Staff profile");
      await (await dbOrThrow()).insert(performanceRecords).values({
        ...input,
        organizationId: ctx.organizationId,
        workDate: new Date(input.workDate),
        units: three(input.units),
        commissionEarned: three(input.commissionEarned),
        notes: input.notes || null,
        recordedBy: ctx.user.id,
      });
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "PERFORMANCE_RECORDED",
        "performanceRecord",
        input.staffProfileId
      );
      return { success: true };
    }),
  payouts: tenantProcedure.query(async ({ ctx }) => {
    await access(ctx.user.id, ctx.organizationId, payrollRoles);
    return (await dbOrThrow())
      .select()
      .from(salaryPayouts)
      .where(orgScope(salaryPayouts, ctx.organizationId))
      .orderBy(desc(salaryPayouts.paidAt))
      .limit(100);
  }),
  removePayout: tenantProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, payrollRoles);
      const db = await dbOrThrow();
      const payout = (
        await db
          .select({
            id: salaryPayouts.id,
            payslipNumber: salaryPayouts.payslipNumber,
          })
          .from(salaryPayouts)
          .where(
            and(
              eq(salaryPayouts.id, input.id),
              orgScope(salaryPayouts, ctx.organizationId)
            )
          )
          .limit(1)
      )[0];
      if (!payout)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Payslip record not found.",
        });
      await db
        .delete(salaryPayouts)
        .where(
          and(
            eq(salaryPayouts.id, input.id),
            orgScope(salaryPayouts, ctx.organizationId)
          )
        );
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "SALARY_PAYOUT_DELETED",
        "salaryPayout",
        input.id,
        { payslipNumber: payout.payslipNumber }
      );
      return { success: true, payslipNumber: payout.payslipNumber };
    }),
  calculate: tenantProcedure
    .input(
      z.object({
        staffProfileId: z.number().int().positive(),
        payPeriod: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a valid pay period."),
        allowances: z.number().min(0).max(1000000).default(0),
        overtime: z.number().min(0).max(1000000).default(0),
        deductions: z.number().min(0).max(1000000).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, payrollRoles);
      const db = await dbOrThrow();
      const staff = (
        await db
          .select()
          .from(staffProfiles)
          .where(
            and(
              eq(staffProfiles.id, input.staffProfileId),
              orgScope(staffProfiles, ctx.organizationId)
            )
          )
          .limit(1)
      )[0];
      if (!staff)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Staff profile not found.",
        });
      const { start, end } = getMonthBounds(input.payPeriod);
      const rows = await db
        .select()
        .from(performanceRecords)
        .where(
          and(
            orgScope(performanceRecords, ctx.organizationId),
            eq(performanceRecords.staffProfileId, staff.id),
            gte(performanceRecords.workDate, start),
            lte(performanceRecords.workDate, end)
          )
        );
      const attendanceRows = await db
        .select()
        .from(attendance)
        .where(
          and(
            orgScope(attendance, ctx.organizationId),
            eq(attendance.staffProfileId, staff.id),
            gte(attendance.workDate, start),
            lte(attendance.workDate, end)
          )
        );
      const performanceBonus = rows.reduce(
        (sum, row) => sum + Number(row.commissionEarned),
        0
      );
      const baseSalary = Number(staff.baseSalary);
      const absenceDeduction = attendanceRows.reduce(
        (sum, row) =>
          sum +
          (Number(row.absenceDeduction) ||
            absenceDeductionFor(baseSalary, row.status, input.payPeriod)),
        0
      );
      const totalDeductions = input.deductions + absenceDeduction;
      const grossSalary =
        baseSalary + input.allowances + input.overtime + performanceBonus;
      const netSalary = grossSalary - totalDeductions;
      return {
        staffProfileId: staff.id,
        staffName: staff.name,
        payPeriod: input.payPeriod,
        baseSalary,
        allowances: input.allowances,
        overtime: input.overtime,
        performanceBonus,
        manualDeductions: input.deductions,
        absenceDeduction,
        deductions: totalDeductions,
        absenceCount: attendanceRows.filter(row => row.status === "absent")
          .length,
        halfDayCount: attendanceRows.filter(row => row.status === "half_day")
          .length,
        grossSalary,
        netSalary,
      };
    }),
  createPayout: tenantProcedure
    .input(
      z.object({
        staffProfileId: z.number().int().positive(),
        payPeriod: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a valid pay period."),
        amount: z.number().positive().max(1000000).optional(),
        allowances: z.number().min(0).max(1000000).default(0),
        overtime: z.number().min(0).max(1000000).default(0),
        performanceBonus: z.number().min(0).max(1000000).optional(),
        deductions: z.number().min(0).max(1000000).default(0),
        deductionDetails: z.string().max(2000).optional(),
        notes: z.string().max(2000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await access(ctx.user.id, ctx.organizationId, payrollRoles);
      const db = await dbOrThrow();
      const staff = (
        await db
          .select()
          .from(staffProfiles)
          .where(
            and(
              eq(staffProfiles.id, input.staffProfileId),
              orgScope(staffProfiles, ctx.organizationId)
            )
          )
          .limit(1)
      )[0];
      if (!staff)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Staff profile not found.",
        });
      const { start, end } = getMonthBounds(input.payPeriod);
      const rows = await db
        .select()
        .from(performanceRecords)
        .where(
          and(
            orgScope(performanceRecords, ctx.organizationId),
            eq(performanceRecords.staffProfileId, staff.id),
            gte(performanceRecords.workDate, start),
            lte(performanceRecords.workDate, end)
          )
        );
      const attendanceRows = await db
        .select()
        .from(attendance)
        .where(
          and(
            orgScope(attendance, ctx.organizationId),
            eq(attendance.staffProfileId, staff.id),
            gte(attendance.workDate, start),
            lte(attendance.workDate, end)
          )
        );
      const performanceBonus =
        input.performanceBonus ??
        rows.reduce((sum, row) => sum + Number(row.commissionEarned), 0);
      const baseSalary = Number(staff.baseSalary);
      const absenceDeduction = attendanceRows.reduce(
        (sum, row) =>
          sum +
          (Number(row.absenceDeduction) ||
            absenceDeductionFor(baseSalary, row.status, input.payPeriod)),
        0
      );
      const totalDeductions = input.deductions + absenceDeduction;
      const grossSalary =
        baseSalary + input.allowances + input.overtime + performanceBonus;
      const finalAmount = input.amount ?? grossSalary - totalDeductions;
      if (finalAmount <= 0)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The calculated net salary must be greater than zero.",
        });
      const payslipNumber = `PS-${input.payPeriod.replace("-", "")}-${staff.id}-${Date.now()}`;
      const deductionDetails =
        [
          input.deductionDetails?.trim(),
          absenceDeduction > 0
            ? `Automatic absence deduction: ${three(absenceDeduction)}`
            : "",
        ]
          .filter(Boolean)
          .join(" · ") || null;
      const result = await db
        .insert(salaryPayouts)
        .values({
          organizationId: ctx.organizationId,
          staffProfileId: staff.id,
          payPeriod: input.payPeriod,
          payslipNumber,
          baseSalary: staff.baseSalary,
          allowances: three(input.allowances),
          overtime: three(input.overtime),
          performanceBonus: three(performanceBonus),
          deductions: three(totalDeductions),
          deductionDetails,
          netSalary: three(finalAmount),
          notes: input.notes.trim() || null,
          approvedBy: ctx.user.id,
        })
        .returning({ id: salaryPayouts.id });
      const payoutId = id(result);
      await audit(
        ctx.user.id,
        ctx.organizationId,
        "SALARY_PAYOUT_CREATED",
        "salaryPayout",
        payoutId,
        {
          staffProfileId: staff.id,
          payPeriod: input.payPeriod,
          finalAmount: three(finalAmount),
          deductions: three(totalDeductions),
          absenceDeduction: three(absenceDeduction),
          payslipNumber,
        }
      );
      return {
        id: payoutId,
        netSalary: finalAmount,
        payslipNumber,
        absenceDeduction,
        deductions: totalDeductions,
      };
    }),
});
