-- Supabase exposes the "public" schema through its Data API to the roles
-- "anon" and "authenticated", and grants them every privilege on every table
-- by default. This app never uses that API (the server connects as the table
-- owner), and 0015 already keeps it harmless with row-level security and no
-- policies. This removes the grants as well, so a policy added by mistake, or
-- a table created without row-level security, still exposes nothing.
--
-- Guarded by role checks: plain Postgres (local development, CI) has no such roles.
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      -- Tables, sequences and functions created later (by the migrating role) start without them too.
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
      EXECUTE format('REVOKE USAGE ON SCHEMA public FROM %I', r);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint

-- Left over from the single-tenant era: no organizationId, not in schema.ts,
-- used by no code. Dropped only when empty, so no data can be lost.
DO $$
DECLARE
  t text;
  has_rows boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['loyaltyTransactions', 'loyaltyAccounts'] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      -- Dynamic SQL: a static reference is planned even when the table is absent.
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I)', t) INTO has_rows;
      IF NOT has_rows THEN
        EXECUTE format('DROP TABLE public.%I', t);
      END IF;
    END IF;
  END LOOP;
END $$;
