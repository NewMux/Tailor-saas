ALTER TABLE "shopSettings" ADD COLUMN IF NOT EXISTS "vatEnabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "shopSettings" ADD COLUMN IF NOT EXISTS "vatRate" numeric(5,3) NOT NULL DEFAULT '10.000';
ALTER TABLE "shopSettings" ADD COLUMN IF NOT EXISTS "vatNumber" varchar(80);

ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "vatRate" numeric(5,3) NOT NULL DEFAULT '0';
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "vatAmount" numeric(12,3) NOT NULL DEFAULT '0';
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "returnMode" varchar(20);
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "returnReason" text;

ALTER TABLE "tailoringOrders" ADD COLUMN IF NOT EXISTS "customerSuppliedFabric" boolean NOT NULL DEFAULT false;
ALTER TABLE "tailoringOrders" ADD COLUMN IF NOT EXISTS "fabricNotes" text;

CREATE TABLE IF NOT EXISTS "customerBalanceDeliveries" (
  "id" serial PRIMARY KEY NOT NULL,
  "customerId" integer NOT NULL,
  "channel" "invoice_delivery_channel" NOT NULL,
  "recipient" varchar(320),
  "status" "invoice_delivery_status" NOT NULL DEFAULT 'prepared',
  "message" text,
  "error" text,
  "createdBy" integer NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "customerBalanceDeliveries_customerId_idx" ON "customerBalanceDeliveries" ("customerId");
CREATE INDEX IF NOT EXISTS "customerBalanceDeliveries_createdAt_idx" ON "customerBalanceDeliveries" ("createdAt");
