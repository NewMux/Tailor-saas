-- Creates exactly one "default" organization from the existing single-tenant
-- data (if any) and backfills it onto every existing row. On a brand new
-- database with no users yet, this is a no-op: future signups create their
-- own organizations via the registration flow instead.
INSERT INTO "organizations" ("slug", "name", "ownerId", "status")
SELECT
	'default',
	COALESCE((SELECT "shopName" FROM "shopSettings" LIMIT 1), 'Default Organization'),
	COALESCE(
		(SELECT "id" FROM "users" WHERE "role" = 'admin' ORDER BY "createdAt" ASC LIMIT 1),
		(SELECT "id" FROM "users" ORDER BY "createdAt" ASC LIMIT 1)
	),
	'active'
WHERE EXISTS (SELECT 1 FROM "users")
  AND NOT EXISTS (SELECT 1 FROM "organizations");--> statement-breakpoint

DO $$
DECLARE
	default_org_id integer;
BEGIN
	SELECT "id" INTO default_org_id FROM "organizations" WHERE "slug" = 'default' LIMIT 1;
	IF default_org_id IS NOT NULL THEN
		UPDATE "users" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
		UPDATE "userBusinessRoles" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
		UPDATE "customRoles" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
		UPDATE "userCustomRoles" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
		UPDATE "pendingAccessRequests" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
		UPDATE "staffAccessInvites" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
		UPDATE "shopSettings" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
		UPDATE "customers" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
		UPDATE "measurementProfiles" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
		UPDATE "tailoringOrders" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
		UPDATE "inventoryItems" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
		UPDATE "stockMovements" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
		UPDATE "services" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
		UPDATE "sales" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
		UPDATE "saleItems" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
		UPDATE "posSessions" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
		UPDATE "posOrders" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
		UPDATE "posPayments" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
		UPDATE "discountCodes" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
		UPDATE "invoices" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
		UPDATE "invoicePayments" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
		UPDATE "invoiceDeliveries" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
		UPDATE "customerBalanceDeliveries" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
		UPDATE "staffProfiles" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
		UPDATE "staffDocuments" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
		UPDATE "attendance" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
		UPDATE "performanceRecords" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
		UPDATE "salaryPayouts" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
		UPDATE "auditLogs" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
	END IF;
END $$;
