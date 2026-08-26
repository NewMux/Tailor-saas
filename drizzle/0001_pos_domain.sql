CREATE TYPE "public"."discount_type" AS ENUM('percent', 'amount');--> statement-breakpoint
CREATE TYPE "public"."loyalty_transaction_type" AS ENUM('earn', 'redeem', 'adjust', 'refund');--> statement-breakpoint
CREATE TYPE "public"."pos_order_status" AS ENUM('held', 'open', 'paid', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."pos_session_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "discountCodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(80) NOT NULL,
	"type" "discount_type" NOT NULL,
	"value" numeric(12, 3) NOT NULL,
	"maxDiscount" numeric(12, 3),
	"minSubtotal" numeric(12, 3) DEFAULT '0' NOT NULL,
	"usageLimit" integer,
	"usedCount" integer DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"expiresAt" timestamp,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "discountCodes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "loyaltyAccounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"customerId" integer NOT NULL,
	"pointsBalance" numeric(12, 3) DEFAULT '0' NOT NULL,
	"lifetimeEarned" numeric(12, 3) DEFAULT '0' NOT NULL,
	"lifetimeRedeemed" numeric(12, 3) DEFAULT '0' NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "loyaltyAccounts_customerId_unique" UNIQUE("customerId")
);
--> statement-breakpoint
CREATE TABLE "loyaltyTransactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"accountId" integer NOT NULL,
	"customerId" integer NOT NULL,
	"type" "loyalty_transaction_type" NOT NULL,
	"points" numeric(12, 3) NOT NULL,
	"saleId" integer,
	"note" text,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posOrders" (
	"id" serial PRIMARY KEY NOT NULL,
	"orderNumber" varchar(60) NOT NULL,
	"sessionId" integer,
	"customerId" integer,
	"status" "pos_order_status" DEFAULT 'held' NOT NULL,
	"cartJson" jsonb NOT NULL,
	"note" text,
	"createdBy" integer NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"heldAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "posOrders_orderNumber_unique" UNIQUE("orderNumber")
);
--> statement-breakpoint
CREATE TABLE "posPayments" (
	"id" serial PRIMARY KEY NOT NULL,
	"saleId" integer NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount" numeric(12, 3) NOT NULL,
	"reference" varchar(160),
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posSessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"sessionNumber" varchar(60) NOT NULL,
	"status" "pos_session_status" DEFAULT 'open' NOT NULL,
	"openedBy" integer NOT NULL,
	"openingCash" numeric(12, 3) DEFAULT '0' NOT NULL,
	"closingCash" numeric(12, 3),
	"openedAt" timestamp DEFAULT now() NOT NULL,
	"closedAt" timestamp,
	"notes" text,
	CONSTRAINT "posSessions_sessionNumber_unique" UNIQUE("sessionNumber")
);
--> statement-breakpoint
ALTER TABLE "saleItems" ADD COLUMN "lineDiscount" numeric(12, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "paidAmount" numeric(12, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "sessionId" integer;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "discountCodeId" integer;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "discountCodeSnapshot" varchar(80);--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "loyaltyPointsEarned" numeric(12, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "loyaltyPointsRedeemed" numeric(12, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "returnOfSaleId" integer;--> statement-breakpoint
ALTER TABLE "shopSettings" ADD COLUMN "loyaltyEarnRate" numeric(12, 3) DEFAULT '1.000' NOT NULL;--> statement-breakpoint
ALTER TABLE "shopSettings" ADD COLUMN "loyaltyPointValue" numeric(12, 3) DEFAULT '0.100' NOT NULL;