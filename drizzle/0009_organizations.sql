CREATE TYPE "public"."organization_status" AS ENUM('active', 'suspended');--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "organizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(80) NOT NULL,
	"name" varchar(160) NOT NULL,
	"ownerId" integer NOT NULL,
	"status" "organization_status" DEFAULT 'active' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);--> statement-breakpoint

-- Nullable for now: backfilled in 0010, then locked to NOT NULL in 0011 once
-- every existing row has a value. Safe to run against an empty database too.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "organizationId" integer;--> statement-breakpoint
ALTER TABLE "userBusinessRoles" ADD COLUMN IF NOT EXISTS "organizationId" integer;--> statement-breakpoint
ALTER TABLE "customRoles" ADD COLUMN IF NOT EXISTS "organizationId" integer;--> statement-breakpoint
ALTER TABLE "userCustomRoles" ADD COLUMN IF NOT EXISTS "organizationId" integer;--> statement-breakpoint
ALTER TABLE "pendingAccessRequests" ADD COLUMN IF NOT EXISTS "organizationId" integer;--> statement-breakpoint
ALTER TABLE "staffAccessInvites" ADD COLUMN IF NOT EXISTS "organizationId" integer;--> statement-breakpoint
ALTER TABLE "shopSettings" ADD COLUMN IF NOT EXISTS "organizationId" integer;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "organizationId" integer;--> statement-breakpoint
ALTER TABLE "measurementProfiles" ADD COLUMN IF NOT EXISTS "organizationId" integer;--> statement-breakpoint
ALTER TABLE "tailoringOrders" ADD COLUMN IF NOT EXISTS "organizationId" integer;--> statement-breakpoint
ALTER TABLE "inventoryItems" ADD COLUMN IF NOT EXISTS "organizationId" integer;--> statement-breakpoint
ALTER TABLE "stockMovements" ADD COLUMN IF NOT EXISTS "organizationId" integer;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "organizationId" integer;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "organizationId" integer;--> statement-breakpoint
ALTER TABLE "saleItems" ADD COLUMN IF NOT EXISTS "organizationId" integer;--> statement-breakpoint
ALTER TABLE "posSessions" ADD COLUMN IF NOT EXISTS "organizationId" integer;--> statement-breakpoint
ALTER TABLE "posOrders" ADD COLUMN IF NOT EXISTS "organizationId" integer;--> statement-breakpoint
ALTER TABLE "posPayments" ADD COLUMN IF NOT EXISTS "organizationId" integer;--> statement-breakpoint
ALTER TABLE "discountCodes" ADD COLUMN IF NOT EXISTS "organizationId" integer;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "organizationId" integer;--> statement-breakpoint
ALTER TABLE "invoicePayments" ADD COLUMN IF NOT EXISTS "organizationId" integer;--> statement-breakpoint
ALTER TABLE "invoiceDeliveries" ADD COLUMN IF NOT EXISTS "organizationId" integer;--> statement-breakpoint
ALTER TABLE "customerBalanceDeliveries" ADD COLUMN IF NOT EXISTS "organizationId" integer;--> statement-breakpoint
ALTER TABLE "staffProfiles" ADD COLUMN IF NOT EXISTS "organizationId" integer;--> statement-breakpoint
ALTER TABLE "staffDocuments" ADD COLUMN IF NOT EXISTS "organizationId" integer;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN IF NOT EXISTS "organizationId" integer;--> statement-breakpoint
ALTER TABLE "performanceRecords" ADD COLUMN IF NOT EXISTS "organizationId" integer;--> statement-breakpoint
ALTER TABLE "salaryPayouts" ADD COLUMN IF NOT EXISTS "organizationId" integer;--> statement-breakpoint
ALTER TABLE "auditLogs" ADD COLUMN IF NOT EXISTS "organizationId" integer;--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_organizationId_organizations_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "userBusinessRoles" ADD CONSTRAINT "userBusinessRoles_organizationId_organizations_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customRoles" ADD CONSTRAINT "customRoles_organizationId_organizations_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "userCustomRoles" ADD CONSTRAINT "userCustomRoles_organizationId_organizations_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pendingAccessRequests" ADD CONSTRAINT "pendingAccessRequests_organizationId_organizations_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "staffAccessInvites" ADD CONSTRAINT "staffAccessInvites_organizationId_organizations_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shopSettings" ADD CONSTRAINT "shopSettings_organizationId_organizations_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customers" ADD CONSTRAINT "customers_organizationId_organizations_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "measurementProfiles" ADD CONSTRAINT "measurementProfiles_organizationId_organizations_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tailoringOrders" ADD CONSTRAINT "tailoringOrders_organizationId_organizations_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventoryItems" ADD CONSTRAINT "inventoryItems_organizationId_organizations_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stockMovements" ADD CONSTRAINT "stockMovements_organizationId_organizations_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "services" ADD CONSTRAINT "services_organizationId_organizations_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales" ADD CONSTRAINT "sales_organizationId_organizations_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saleItems" ADD CONSTRAINT "saleItems_organizationId_organizations_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "posSessions" ADD CONSTRAINT "posSessions_organizationId_organizations_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "posOrders" ADD CONSTRAINT "posOrders_organizationId_organizations_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "posPayments" ADD CONSTRAINT "posPayments_organizationId_organizations_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discountCodes" ADD CONSTRAINT "discountCodes_organizationId_organizations_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organizationId_organizations_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoicePayments" ADD CONSTRAINT "invoicePayments_organizationId_organizations_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoiceDeliveries" ADD CONSTRAINT "invoiceDeliveries_organizationId_organizations_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customerBalanceDeliveries" ADD CONSTRAINT "customerBalanceDeliveries_organizationId_organizations_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "staffProfiles" ADD CONSTRAINT "staffProfiles_organizationId_organizations_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "staffDocuments" ADD CONSTRAINT "staffDocuments_organizationId_organizations_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attendance" ADD CONSTRAINT "attendance_organizationId_organizations_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "performanceRecords" ADD CONSTRAINT "performanceRecords_organizationId_organizations_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salaryPayouts" ADD CONSTRAINT "salaryPayouts_organizationId_organizations_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auditLogs" ADD CONSTRAINT "auditLogs_organizationId_organizations_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- Invite links gain a real secret token; matching by email alone let anyone
-- who learned an invited address attempt to register against it.
ALTER TABLE "staffAccessInvites" ADD COLUMN IF NOT EXISTS "tokenHash" varchar(128);--> statement-breakpoint
ALTER TABLE "staffAccessInvites" ADD COLUMN IF NOT EXISTS "expiresAt" timestamp;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "staffAccessInvites" ADD CONSTRAINT "staffAccessInvites_tokenHash_unique" UNIQUE("tokenHash");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
