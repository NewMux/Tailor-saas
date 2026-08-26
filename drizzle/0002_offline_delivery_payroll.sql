CREATE TYPE "public"."invoice_delivery_channel" AS ENUM('email', 'whatsapp', 'share');--> statement-breakpoint
CREATE TYPE "public"."invoice_delivery_status" AS ENUM('prepared', 'sent', 'failed');--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "clientReference" varchar(120);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_client_reference_unique" ON "sales" ("clientReference") WHERE "clientReference" IS NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoiceDeliveries" (
  "id" serial PRIMARY KEY NOT NULL,
  "invoiceId" integer NOT NULL,
  "channel" "invoice_delivery_channel" NOT NULL,
  "recipient" varchar(320),
  "status" "invoice_delivery_status" DEFAULT 'prepared' NOT NULL,
  "message" text,
  "error" text,
  "createdBy" integer NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "salaryPayouts" ADD COLUMN IF NOT EXISTS "payslipNumber" varchar(60);--> statement-breakpoint
ALTER TABLE "salaryPayouts" ADD COLUMN IF NOT EXISTS "allowances" numeric(12, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "salaryPayouts" ADD COLUMN IF NOT EXISTS "overtime" numeric(12, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "salaryPayouts" ADD COLUMN IF NOT EXISTS "deductionDetails" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "salary_payslip_number_unique" ON "salaryPayouts" ("payslipNumber") WHERE "payslipNumber" IS NOT NULL;--> statement-breakpoint
