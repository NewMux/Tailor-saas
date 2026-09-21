-- Impersonation sessions reuse authSessions (short TTL, see
-- IMPERSONATION_TTL_MS in server/_core/localAuth.ts) rather than a
-- separate table; this column distinguishes them and records which
-- platform staff member started the session.
ALTER TABLE "authSessions" ADD COLUMN IF NOT EXISTS "impersonatedBy" integer;--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "authSessions" ADD CONSTRAINT "authSessions_impersonatedBy_users_id_fk" FOREIGN KEY ("impersonatedBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
