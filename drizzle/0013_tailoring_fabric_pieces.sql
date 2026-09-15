-- Per-piece fabric selection on tailoring orders. Each garment piece can now
-- carry its own fabric, meters used, and quoted price, instead of one fabric
-- link and one price for the whole order. Existing orders keep their single
-- price/fabricNotes on tailoringOrders untouched; they simply have no rows in
-- tailoringOrderPieces (the production board still reads fine without them).
ALTER TABLE "tailoringOrders" ADD COLUMN "includeMeasurementsOnInvoice" boolean DEFAULT false NOT NULL;--> statement-breakpoint

CREATE TABLE "tailoringOrderPieces" (
  "id" serial PRIMARY KEY NOT NULL,
  "organizationId" integer NOT NULL,
  "tailoringOrderId" integer NOT NULL,
  "pieceNumber" integer NOT NULL,
  "inventoryItemId" integer,
  "fabricNameSnapshot" varchar(160),
  "metersUsed" numeric(12, 3),
  "quotedPrice" numeric(12, 3) NOT NULL,
  "saleItemId" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "tailoringOrderPieces" ADD CONSTRAINT "tailoringOrderPieces_organizationId_organizations_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tailoringOrderPieces" ADD CONSTRAINT "tailoringOrderPieces_tailoringOrderId_tailoringOrders_id_fk" FOREIGN KEY ("tailoringOrderId") REFERENCES "public"."tailoringOrders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tailoringOrderPieces_order_idx" ON "tailoringOrderPieces" ("tailoringOrderId");
