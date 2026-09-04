-- ============================================================================
-- CI stub: minimal Supabase-like environment for a plain Postgres container
-- ----------------------------------------------------------------------------
-- Applied ONLY by the CI verification job BEFORE supabase/migrations/*.sql.
-- It reproduces the pieces of a real Supabase project that the migrations
-- depend on but that a stock Postgres image does not ship with:
--
--   1. roles anon / authenticated / service_role (referenced by RLS policies)
--   2. extensions schema (pgcrypto is installed there by 007_fix_login)
--   3. auth schema with users / identities / sessions tables carrying exactly
--      the columns the dynamic auth DML reads via information_schema
--   4. auth.uid() / auth.jwt() so SECURITY DEFINER functions resolve at runtime
--   5. Session-user impersonation for RLS integration tests: auth.uid()/auth.jwt()
--      read the transaction-scoped GUCs app.user_id / app.jwt, so a test can
--      `SELECT set_config('app.user_id', $1, true)` and then SET ROLE
--      authenticated to exercise RLS as that user. With no GUC set they fall
--      back to NULL / '{}' (the old behaviour).
--
-- Never apply this file to a real Supabase database: the auth schema there is
-- managed by GoTrue and must not be overridden.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END $$;

GRANT anon TO postgres, authenticated;
GRANT authenticated TO postgres;
GRANT service_role TO postgres;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;

-- RLS policies execute auth.uid() under the querying role, so every API role
-- needs USAGE on the auth schema (EXECUTE on the functions is PUBLIC-default).
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  instance_id uuid,
  aud text,
  role text,
  email text UNIQUE,
  encrypted_password text,
  email_confirmed_at timestamptz,
  confirmation_token text,
  recovery_token text,
  email_change text,
  email_change_token_new text,
  email_change_token_current text,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  is_anonymous boolean,
  is_sso_user boolean
);

CREATE TABLE IF NOT EXISTS auth.identities (
  id uuid PRIMARY KEY,
  provider_id text,
  user_id uuid REFERENCES auth.users(id),
  identity_data jsonb,
  provider text,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  email text
);

CREATE TABLE IF NOT EXISTS auth.sessions (
  id uuid PRIMARY KEY,
  user_id uuid,
  created_at timestamptz
);

-- Identity of the current request. Plain Postgres has no JWT, so the test
-- harness impersonates a user by setting app.user_id inside its transaction.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE AS $fn$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$fn$;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
  LANGUAGE sql STABLE AS $fn$
  SELECT COALESCE(NULLIF(current_setting('app.jwt', true), '')::jsonb, '{}'::jsonb)
$fn$;

-- Marker used by integration tests to detect this CI stub (as opposed to a
-- real Supabase GoTrue backend, where auth.uid() ignores the GUC and RLS
-- impersonation cannot work). Never present on a real project.
CREATE OR REPLACE FUNCTION auth.is_ci_stub() RETURNS boolean
  LANGUAGE sql STABLE AS $fn$ SELECT true $fn$;
