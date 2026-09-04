-- ============================================================================
-- 032. Table/sequence privileges for authenticated + service_role
-- ----------------------------------------------------------------------------
-- A real Supabase project grants its API roles access to every table in the
-- `public` schema (via ALTER DEFAULT PRIVILEGES set up at project creation).
-- A plain-Postgres fresh build does not: the canonical migrations create the
-- tables but `authenticated` had no privileges, so RLS could never be
-- exercised (permission denied fires before any policy). This file closes
-- that gap so the fresh build behaves exactly like live Supabase.
--
-- RLS stays the security boundary: `authenticated` receives DML privileges but
-- every table's policies still filter rows by branch/role.
--
-- Additive + idempotent. Safe on live (the grants already exist there).
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Object privileges for tables created by the canonical migrations in the future.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated, service_role;

-- 028_d10_security deliberately restricts document_sequences to SELECT-only;
-- preserve that intent (the bulk grant above re-opens it otherwise).
REVOKE INSERT, UPDATE, DELETE ON public.document_sequences FROM authenticated;
