-- A staff member who joins through an invite gets a base business-role row so
-- the access checks can find them; the owner-assigned custom role then decides
-- what they may do. The row is marked as a placeholder so that removing the
-- custom role leaves them with no access instead of silently falling back to
-- the base role's full rights.
ALTER TABLE "userBusinessRoles" ADD COLUMN IF NOT EXISTS "isPlaceholder" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- Session tokens were written to the request logs until this release (see
-- server/_core/logger.ts). Sign everyone out once so no logged token stays valid.
DELETE FROM "authSessions";
