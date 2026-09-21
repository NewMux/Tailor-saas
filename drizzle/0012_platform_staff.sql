-- Platform-level operator staff (Tafsell's own team), deliberately separate
-- from both users.role (a legacy global flag every self-serve org owner
-- already carries) and the per-organization businessRoleEnum. A row here is
-- the only thing that should ever gate a cross-tenant route.
CREATE TYPE "public"."platform_staff_role" AS ENUM('support', 'superadmin');--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "platformStaff" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"role" "platform_staff_role" DEFAULT 'support' NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"grantedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "platformStaff_userId_unique" UNIQUE("userId")
);--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "platformStaff" ADD CONSTRAINT "platformStaff_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
