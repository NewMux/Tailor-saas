CREATE TYPE "public"."access_request_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."attendance_status" AS ENUM('present', 'absent', 'leave', 'half_day');--> statement-breakpoint
CREATE TYPE "public"."business_role" AS ENUM('admin', 'sales', 'tailor', 'inventory', 'payroll');--> statement-breakpoint
CREATE TYPE "public"."inventory_category" AS ENUM('fabric', 'lining', 'buttons', 'thread', 'accessory', 'other');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('paid', 'partial', 'unpaid', 'void');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'benefitpay', 'bank_transfer', 'credit_card');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('paid', 'partial', 'unpaid');--> statement-breakpoint
CREATE TYPE "public"."sale_source" AS ENUM('counter', 'manual', 'tailoring');--> statement-breakpoint
CREATE TYPE "public"."service_category" AS ENUM('tailoring', 'fabric', 'alteration', 'accessory', 'other');--> statement-breakpoint
CREATE TYPE "public"."stock_movement_type" AS ENUM('opening', 'adjustment', 'sale', 'return', 'purchase');--> statement-breakpoint
CREATE TYPE "public"."tailoring_order_status" AS ENUM('draft', 'confirmed', 'cutting', 'stitching', 'fitting', 'ready', 'handed_over', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "attendance" (
	"id" serial PRIMARY KEY NOT NULL,
	"staffProfileId" integer NOT NULL,
	"workDate" date NOT NULL,
	"status" "attendance_status" NOT NULL,
	"notes" text,
	"recordedBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auditLogs" (
	"id" serial PRIMARY KEY NOT NULL,
	"actorId" integer NOT NULL,
	"action" varchar(100) NOT NULL,
	"entityType" varchar(80) NOT NULL,
	"entityId" integer,
	"detailsJson" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customRoles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" varchar(320),
	"permissionsJson" jsonb NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "customRoles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(160) NOT NULL,
	"phone" varchar(50) NOT NULL,
	"email" varchar(320),
	"address" text,
	"notes" text,
	"preferredContact" varchar(40),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventoryItems" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(60) NOT NULL,
	"name" varchar(160) NOT NULL,
	"category" "inventory_category" NOT NULL,
	"color" varchar(60),
	"widthInches" numeric(10, 2),
	"unit" varchar(40) DEFAULT 'Meters' NOT NULL,
	"quantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"minThreshold" numeric(12, 3) DEFAULT '0' NOT NULL,
	"costPerUnit" numeric(12, 3) DEFAULT '0' NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "inventoryItems_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"saleId" integer NOT NULL,
	"invoiceNumber" varchar(60) NOT NULL,
	"status" "invoice_status" NOT NULL,
	"issuedAt" timestamp DEFAULT now() NOT NULL,
	"dueDate" date,
	"notes" text,
	CONSTRAINT "invoices_saleId_unique" UNIQUE("saleId"),
	CONSTRAINT "invoices_invoiceNumber_unique" UNIQUE("invoiceNumber")
);
--> statement-breakpoint
CREATE TABLE "measurementProfiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"customerId" integer NOT NULL,
	"version" integer NOT NULL,
	"measurementsJson" jsonb NOT NULL,
	"fitPreference" varchar(100),
	"collarStyle" varchar(100),
	"pocketStyle" varchar(100),
	"notes" text,
	"effectiveDate" date NOT NULL,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pendingAccessRequests" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"status" "access_request_status" DEFAULT 'pending' NOT NULL,
	"requestedAt" timestamp DEFAULT now() NOT NULL,
	"reviewedAt" timestamp,
	"reviewedBy" integer,
	"note" varchar(500),
	CONSTRAINT "pendingAccessRequests_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "performanceRecords" (
	"id" serial PRIMARY KEY NOT NULL,
	"staffProfileId" integer NOT NULL,
	"workDate" date NOT NULL,
	"metric" varchar(120) NOT NULL,
	"units" numeric(12, 3) NOT NULL,
	"commissionEarned" numeric(12, 3) DEFAULT '0' NOT NULL,
	"notes" text,
	"recordedBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salaryPayouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"staffProfileId" integer NOT NULL,
	"payPeriod" varchar(20) NOT NULL,
	"baseSalary" numeric(12, 3) NOT NULL,
	"performanceBonus" numeric(12, 3) DEFAULT '0' NOT NULL,
	"deductions" numeric(12, 3) DEFAULT '0' NOT NULL,
	"netSalary" numeric(12, 3) NOT NULL,
	"notes" text,
	"approvedBy" integer NOT NULL,
	"paidAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saleItems" (
	"id" serial PRIMARY KEY NOT NULL,
	"saleId" integer NOT NULL,
	"serviceId" integer,
	"inventoryItemId" integer,
	"nameSnapshot" varchar(160) NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unitPrice" numeric(12, 3) NOT NULL,
	"total" numeric(12, 3) NOT NULL,
	"assignedTailorId" integer,
	"measurementProfileId" integer
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" serial PRIMARY KEY NOT NULL,
	"saleNumber" varchar(60) NOT NULL,
	"customerId" integer,
	"customerNameSnapshot" varchar(160) NOT NULL,
	"customerPhoneSnapshot" varchar(50),
	"subtotal" numeric(12, 3) NOT NULL,
	"discount" numeric(12, 3) DEFAULT '0' NOT NULL,
	"total" numeric(12, 3) NOT NULL,
	"paymentMethod" "payment_method" NOT NULL,
	"paymentStatus" "payment_status" DEFAULT 'paid' NOT NULL,
	"source" "sale_source" DEFAULT 'counter' NOT NULL,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sales_saleNumber_unique" UNIQUE("saleNumber")
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" serial PRIMARY KEY NOT NULL,
	"sku" varchar(60) NOT NULL,
	"name" varchar(160) NOT NULL,
	"category" "service_category" NOT NULL,
	"description" text,
	"unitPrice" numeric(12, 3) NOT NULL,
	"inventoryItemId" integer,
	"defaultFabricMeters" numeric(12, 3),
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "services_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "shopSettings" (
	"id" serial PRIMARY KEY NOT NULL,
	"shopName" varchar(160) NOT NULL,
	"arabicShopName" varchar(160),
	"crNumber" varchar(80),
	"currency" varchar(8) DEFAULT 'BHD' NOT NULL,
	"phone" varchar(50),
	"email" varchar(320),
	"address" text,
	"invoicePrefix" varchar(16) DEFAULT 'INV' NOT NULL,
	"updatedBy" integer,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staffAccessInvites" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(160) NOT NULL,
	"email" varchar(320) NOT NULL,
	"customRoleId" integer NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"invitedBy" integer NOT NULL,
	"invitedAt" timestamp DEFAULT now() NOT NULL,
	"acceptedByUserId" integer,
	"acceptedAt" timestamp,
	CONSTRAINT "staffAccessInvites_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "staffProfiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer,
	"name" varchar(160) NOT NULL,
	"phone" varchar(50),
	"jobTitle" varchar(100) NOT NULL,
	"baseSalary" numeric(12, 3) NOT NULL,
	"commissionRate" numeric(8, 3) DEFAULT '0' NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stockMovements" (
	"id" serial PRIMARY KEY NOT NULL,
	"inventoryItemId" integer NOT NULL,
	"movementType" "stock_movement_type" NOT NULL,
	"quantityChange" numeric(12, 3) NOT NULL,
	"quantityBefore" numeric(12, 3) NOT NULL,
	"quantityAfter" numeric(12, 3) NOT NULL,
	"referenceType" varchar(40),
	"referenceId" integer,
	"notes" text,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tailoringOrders" (
	"id" serial PRIMARY KEY NOT NULL,
	"orderNumber" varchar(60) NOT NULL,
	"customerId" integer NOT NULL,
	"measurementProfileId" integer,
	"assignedTailorId" integer,
	"garmentType" varchar(80) DEFAULT 'Thoub' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"status" "tailoring_order_status" DEFAULT 'draft' NOT NULL,
	"dueDate" date,
	"price" numeric(12, 3) DEFAULT '0' NOT NULL,
	"notes" text,
	"productionNotes" text,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tailoringOrders_orderNumber_unique" UNIQUE("orderNumber")
);
--> statement-breakpoint
CREATE TABLE "userBusinessRoles" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"role" "business_role" DEFAULT 'sales' NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "userBusinessRoles_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "userCustomRoles" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"customRoleId" integer NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"updatedBy" integer NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "userCustomRoles_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(320) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON "users" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON "userBusinessRoles" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON "customRoles" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON "userCustomRoles" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON "shopSettings" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON "customers" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON "tailoringOrders" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON "inventoryItems" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON "services" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON "staffProfiles" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
