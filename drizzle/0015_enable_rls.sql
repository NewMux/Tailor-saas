-- Supabase exposes the "public" schema over its REST/GraphQL Data API to
-- anyone holding the project's publishable (anon) key. This app never uses
-- that API: the server talks to Postgres directly as the table owner, which
-- bypasses row-level security. Turning RLS on with no policies therefore
-- changes nothing for the app while denying every Data API request, so a
-- leaked anon key cannot read or write tenant data.
--
-- Harmless on plain Postgres (local docker-compose, CI): the owner role the
-- app connects as is unaffected by non-forced RLS.
--
-- Every table added by a later migration must also ENABLE ROW LEVEL SECURITY;
-- server/rls.test.ts fails if one is missed.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
--> statement-breakpoint

-- Pin the trigger function's search_path (Supabase security advisor
-- "function_search_path_mutable"); it only calls pg_catalog's now().
ALTER FUNCTION public.set_updated_at() SET search_path = '';
