-- Locks organizationId to NOT NULL now that every row has been backfilled
-- (0010), and replaces global-unique business keys with per-organization
-- composite uniques so two shops can each use the same order/sale/invoice
-- numbering without colliding.
ALTER TABLE "users" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "userBusinessRoles" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "customRoles" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "userCustomRoles" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pendingAccessRequests" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "staffAccessInvites" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shopSettings" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "measurementProfiles" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tailoringOrders" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "inventoryItems" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "stockMovements" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "saleItems" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "posSessions" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "posOrders" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "posPayments" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "discountCodes" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invoicePayments" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invoiceDeliveries" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "customerBalanceDeliveries" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "staffProfiles" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "staffDocuments" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "performanceRecords" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "salaryPayouts" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "auditLogs" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint

-- Drop the old single-column unique constraints/indexes.
ALTER TABLE "customRoles" DROP CONSTRAINT IF EXISTS "customRoles_name_unique";--> statement-breakpoint
ALTER TABLE "inventoryItems" DROP CONSTRAINT IF EXISTS "inventoryItems_code_unique";--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_invoiceNumber_unique";--> statement-breakpoint
ALTER TABLE "sales" DROP CONSTRAINT IF EXISTS "sales_saleNumber_unique";--> statement-breakpoint
ALTER TABLE "services" DROP CONSTRAINT IF EXISTS "services_sku_unique";--> statement-breakpoint
ALTER TABLE "tailoringOrders" DROP CONSTRAINT IF EXISTS "tailoringOrders_orderNumber_unique";--> statement-breakpoint
ALTER TABLE "discountCodes" DROP CONSTRAINT IF EXISTS "discountCodes_code_unique";--> statement-breakpoint
ALTER TABLE "posOrders" DROP CONSTRAINT IF EXISTS "posOrders_orderNumber_unique";--> statement-breakpoint
ALTER TABLE "posSessions" DROP CONSTRAINT IF EXISTS "posSessions_sessionNumber_unique";--> statement-breakpoint
ALTER TABLE "staffAccessInvites" DROP CONSTRAINT IF EXISTS "staffAccessInvites_email_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "sales_client_reference_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "salary_payslip_number_unique";--> statement-breakpoint

-- Composite per-organization uniques.
CREATE UNIQUE INDEX IF NOT EXISTS "customRoles_org_name_unique" ON "customRoles" ("organizationId", "name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventoryItems_org_code_unique" ON "inventoryItems" ("organizationId", "code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_org_invoiceNumber_unique" ON "invoices" ("organizationId", "invoiceNumber");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_org_saleNumber_unique" ON "sales" ("organizationId", "saleNumber");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "services_org_sku_unique" ON "services" ("organizationId", "sku");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tailoringOrders_org_orderNumber_unique" ON "tailoringOrders" ("organizationId", "orderNumber");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "discountCodes_org_code_unique" ON "discountCodes" ("organizationId", "code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "posOrders_org_orderNumber_unique" ON "posOrders" ("organizationId", "orderNumber");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "posSessions_org_sessionNumber_unique" ON "posSessions" ("organizationId", "sessionNumber");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_org_clientReference_unique" ON "sales" ("organizationId", "clientReference") WHERE "clientReference" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "salaryPayouts_org_payslipNumber_unique" ON "salaryPayouts" ("organizationId", "payslipNumber") WHERE "payslipNumber" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "staffAccessInvites_org_email_unique" ON "staffAccessInvites" ("organizationId", "email");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shopSettings_organizationId_unique" ON "shopSettings" ("organizationId");--> statement-breakpoint

-- Pre-existing gap: users.email had no DB-level unique constraint at all
-- (only an app-level check), which was racy under concurrent registration.
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_lower_unique" ON "users" (lower("email")) WHERE "email" IS NOT NULL;--> statement-breakpoint

-- Per-table lookup indexes; every business query gains an organizationId
-- predicate, so it must stay index-backed.
CREATE INDEX IF NOT EXISTS "userBusinessRoles_organizationId_idx" ON "userBusinessRoles" ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customRoles_organizationId_idx" ON "customRoles" ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "userCustomRoles_organizationId_idx" ON "userCustomRoles" ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pendingAccessRequests_organizationId_idx" ON "pendingAccessRequests" ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staffAccessInvites_organizationId_idx" ON "staffAccessInvites" ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customers_organizationId_idx" ON "customers" ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "measurementProfiles_organizationId_idx" ON "measurementProfiles" ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tailoringOrders_organizationId_idx" ON "tailoringOrders" ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tailoringOrders_org_status_idx" ON "tailoringOrders" ("organizationId", "status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventoryItems_organizationId_idx" ON "inventoryItems" ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stockMovements_organizationId_idx" ON "stockMovements" ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "services_organizationId_idx" ON "services" ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_organizationId_idx" ON "sales" ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_org_createdAt_idx" ON "sales" ("organizationId", "createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saleItems_organizationId_idx" ON "saleItems" ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "posSessions_organizationId_idx" ON "posSessions" ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "posOrders_organizationId_idx" ON "posOrders" ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "posPayments_organizationId_idx" ON "posPayments" ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discountCodes_organizationId_idx" ON "discountCodes" ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_organizationId_idx" ON "invoices" ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoicePayments_organizationId_idx" ON "invoicePayments" ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoiceDeliveries_organizationId_idx" ON "invoiceDeliveries" ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customerBalanceDeliveries_organizationId_idx" ON "customerBalanceDeliveries" ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staffProfiles_organizationId_idx" ON "staffProfiles" ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staffDocuments_organizationId_idx" ON "staffDocuments" ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attendance_organizationId_idx" ON "attendance" ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "performanceRecords_organizationId_idx" ON "performanceRecords" ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salaryPayouts_organizationId_idx" ON "salaryPayouts" ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auditLogs_organizationId_idx" ON "auditLogs" ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auditLogs_org_createdAt_idx" ON "auditLogs" ("organizationId", "createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_organizationId_idx" ON "users" ("organizationId");
