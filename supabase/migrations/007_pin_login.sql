-- Migration: Username + 4-digit PIN login
-- Run this in the Supabase SQL Editor AFTER migration_enterprise_core.sql.
--
-- Adds:
--   1. `public.users.username` column (lowercase, unique).
--   2. Backfill: existing accounts get a username from their email prefix.
--   3. `get_login_email(username)` — anon-callable lookup used by the login page.
--   4. `create_user` now accepts `p_username`.
--   5. `update_user_password` now accepts 4-digit PINs.

-- ============ 1. USERNAME COLUMN ============
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS username text;

-- Refresh the PostgREST schema cache immediately so the new column is usable
-- right away even if a later statement below fails (also repeated at the end).
NOTIFY pgrst, 'reload schema';

-- Backfill existing accounts from their email prefix (deduplicated).
WITH numbered AS (
  SELECT id, lower(split_part(email, '@', 1)) AS base,
         row_number() OVER (PARTITION BY lower(split_part(email, '@', 1)) ORDER BY created_at) AS rn
  FROM public.users
  WHERE username IS NULL OR btrim(username) = ''
)
UPDATE public.users u
SET username = CASE WHEN n.rn = 1 THEN n.base ELSE n.base || '_' || n.rn END
FROM numbered n
WHERE u.id = n.id;

-- Sanitize every username to the allowed charset so the unique index / CHECK
-- constraint below can NEVER fail on existing data (e.g. '+' or Arabic letters
-- in an email prefix would otherwise abort this script before the final reload).
WITH cleaned AS (
  SELECT id,
         regexp_replace(
           regexp_replace(lower(btrim(COALESCE(username, ''))), '[^a-z0-9._-]', '_', 'g'),
           '^[._-]+', '', 'g'
         ) AS clean
  FROM public.users
)
UPDATE public.users u
SET username = CASE WHEN c.clean = '' THEN 'user' || replace(u.id::text, '-', '') ELSE c.clean END
FROM cleaned c
WHERE u.id = c.id;

-- Final dedup after sanitization (very rare: 'a.b' and 'a_b' both become 'a_b').
WITH dup AS (
  SELECT id, row_number() OVER (PARTITION BY username ORDER BY created_at) AS rn
  FROM public.users
  WHERE username IS NOT NULL
)
UPDATE public.users u
SET username = u.username || '_' || d.rn
FROM dup d
WHERE u.id = d.id AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS users_username_uniq_idx ON public.users (username);

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_username_format_check;
ALTER TABLE public.users ADD CONSTRAINT users_username_format_check
  CHECK (username IS NULL OR username ~ '^[a-z0-9][a-z0-9._-]*$');

-- ============ 2. LOGIN LOOKUP (anon-callable) ============
-- Returns the email for a username so the client can call
-- auth.signInWithPassword(email, pin). SECURITY DEFINER bypasses RLS.
CREATE OR REPLACE FUNCTION get_login_email(p_username text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE username = lower(btrim(p_username));
  IF v_user.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;
  IF NOT v_user.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_INACTIVE');
  END IF;
  RETURN jsonb_build_object('success', true, 'email', v_user.email);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_login_email(text) TO anon, authenticated;

-- ============ 3. create_user: add p_username ============
CREATE OR REPLACE FUNCTION create_user(
  p_email text,
  p_password text,
  p_full_name text DEFAULT NULL,
  p_role text DEFAULT 'cashier',
  p_branch_id uuid DEFAULT NULL,
  p_is_active boolean DEFAULT true,
  p_username text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_role text;
  v_hash text;
  v_email text;
  v_username text;
  v_pgc_schema text;
  v_caller_role text;
  v_caller_branch uuid;
  v_u_cols text;
  v_u_vals text;
  v_i_cols text;
  v_i_vals text;
BEGIN
  SELECT role, branch_id INTO v_caller_role, v_caller_branch FROM public.users WHERE id = auth.uid();

  IF is_pos_admin() THEN
    NULL;
  ELSIF v_caller_role = 'branch_manager' AND v_caller_branch IS NOT NULL THEN
    -- branch manager: force their own branch and forbid admin roles
    IF p_branch_id IS NOT NULL AND p_branch_id <> v_caller_branch THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED',
        'detail', 'Branch managers can only create users in their own branch');
    END IF;
    IF p_role IN ('super_admin', 'owner') THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED',
        'detail', 'Only a super admin can create super_admin/owner accounts');
    END IF;
    p_branch_id := v_caller_branch;
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  v_email := lower(btrim(p_email));

  -- Email uniqueness (both auth accounts and app profiles)
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
    RETURN jsonb_build_object('success', false, 'error', 'EMAIL_TAKEN');
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE email = v_email) THEN
    RETURN jsonb_build_object('success', false, 'error', 'EMAIL_TAKEN');
  END IF;

  -- Username: default to email prefix, sanitized, must be unique
  v_username := regexp_replace(
    regexp_replace(lower(btrim(coalesce(NULLIF(p_username, ''), split_part(v_email, '@', 1)))), '[^a-z0-9._-]', '_', 'g'),
    '^[._-]+', '', 'g'
  );
  IF v_username = '' THEN
    v_username := 'user' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE username = v_username) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USERNAME_TAKEN');
  END IF;

  SELECT extnamespace::regnamespace::text INTO v_pgc_schema
  FROM pg_extension WHERE extname = 'pgcrypto';

  IF v_pgc_schema IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', 'pgcrypto extension is not enabled');
  END IF;

  EXECUTE format('SELECT %I.crypt($1, %I.gen_salt($2, $3))', v_pgc_schema, v_pgc_schema)
    INTO v_hash USING p_password, 'bf', 10;

  v_role := CASE
    WHEN p_role IN ('super_admin', 'owner', 'branch_manager', 'cashier',
                    'warehouse_manager', 'kitchen', 'accountant', 'customer_display') THEN p_role
    ELSE 'cashier'
  END;

  v_user_id := gen_random_uuid();

  SELECT string_agg(c.col, ', ' ORDER BY c.ord), string_agg(c.val, ', ' ORDER BY c.ord)
  INTO v_u_cols, v_u_vals
  FROM (
    SELECT cols.ordinal_position AS ord, quote_ident(cols.column_name) AS col,
      CASE cols.column_name
        WHEN 'instance_id' THEN '''00000000-0000-0000-0000-000000000000'''
        WHEN 'id' THEN quote_literal(v_user_id)
        WHEN 'aud' THEN '''authenticated'''
        WHEN 'role' THEN '''authenticated'''
        WHEN 'email' THEN quote_literal(v_email)
        WHEN 'encrypted_password' THEN quote_literal(v_hash)
        WHEN 'email_confirmed_at' THEN 'now()'
        WHEN 'confirmation_token' THEN ''''''
        WHEN 'recovery_token' THEN ''''''
        WHEN 'email_change' THEN ''''''
        WHEN 'email_change_token_new' THEN ''''''
        WHEN 'email_change_token_current' THEN ''''''
        WHEN 'raw_app_meta_data' THEN format('jsonb_build_object(''provider'',''email'',''providers'',array[''email'']::text[],''email'',%L)', v_email)
        WHEN 'raw_user_meta_data' THEN format('jsonb_build_object(''full_name'',%L,''email'',%L,''email_verified'',true)', p_full_name, v_email)
        WHEN 'created_at' THEN 'now()'
        WHEN 'updated_at' THEN 'now()'
        WHEN 'is_anonymous' THEN 'false'
        WHEN 'is_sso_user' THEN 'false'
      END AS val
    FROM information_schema.columns cols
    WHERE cols.table_schema = 'auth' AND cols.table_name = 'users'
      AND cols.is_generated = 'NEVER'
      AND cols.column_name IN ('instance_id','id','aud','role','email','encrypted_password','email_confirmed_at','confirmation_token','recovery_token','email_change','email_change_token_new','email_change_token_current','raw_app_meta_data','raw_user_meta_data','created_at','updated_at','is_anonymous','is_sso_user')
  ) c;

  IF v_u_cols IS NULL OR v_u_vals IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', 'no insertable columns found for auth.users');
  END IF;

  EXECUTE 'INSERT INTO auth.users (' || v_u_cols || ') VALUES (' || v_u_vals || ')';

  SELECT string_agg(c.col, ', ' ORDER BY c.ord), string_agg(c.val, ', ' ORDER BY c.ord)
  INTO v_i_cols, v_i_vals
  FROM (
    SELECT cols.ordinal_position AS ord, quote_ident(cols.column_name) AS col,
      CASE cols.column_name
        WHEN 'id' THEN 'gen_random_uuid()'
        WHEN 'provider_id' THEN quote_literal(v_user_id::text)
        WHEN 'user_id' THEN quote_literal(v_user_id)
        WHEN 'identity_data' THEN format('jsonb_build_object(''sub'',%L,''email'',%L)', v_user_id::text, v_email)
        WHEN 'provider' THEN '''email'''
        WHEN 'last_sign_in_at' THEN 'now()'
        WHEN 'created_at' THEN 'now()'
        WHEN 'updated_at' THEN 'now()'
        WHEN 'email' THEN quote_literal(v_email)
      END AS val
    FROM information_schema.columns cols
    WHERE cols.table_schema = 'auth' AND cols.table_name = 'identities'
      AND cols.is_generated = 'NEVER'
      AND cols.column_name IN ('id','provider_id','user_id','identity_data','provider','last_sign_in_at','created_at','updated_at','email')
  ) c;

  IF v_i_cols IS NULL OR v_i_vals IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', 'no insertable columns found for auth.identities');
  END IF;

  EXECUTE 'INSERT INTO auth.identities (' || v_i_cols || ') VALUES (' || v_i_vals || ')';

  INSERT INTO public.users (id, email, username, full_name, role, branch_id, is_active)
  VALUES (v_user_id, v_email, v_username, p_full_name, v_role, p_branch_id, p_is_active);

  RETURN jsonb_build_object('success', true, 'user_id', v_user_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', SQLERRM);
END;
$$;

-- ============ 4. update_user_password: allow 4-digit PINs ============
CREATE OR REPLACE FUNCTION update_user_password(p_user_id uuid, p_new_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash text;
  v_pgc_schema text;
  v_caller_role text;
  v_caller_branch uuid;
  v_target_role text;
  v_target_branch uuid;
BEGIN
  IF NOT is_pos_admin() THEN
    SELECT role, branch_id INTO v_caller_role, v_caller_branch FROM public.users WHERE id = auth.uid();
    IF v_caller_role = 'branch_manager' AND v_caller_branch IS NOT NULL THEN
      SELECT role, branch_id INTO v_target_role, v_target_branch FROM public.users WHERE id = p_user_id;
      IF v_target_role IN ('super_admin', 'owner') OR v_target_branch IS DISTINCT FROM v_caller_branch THEN
        RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED',
          'detail', 'Branch managers can only change PINs of staff in their own branch');
      END IF;
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
    END IF;
  END IF;

  IF p_new_password IS NULL OR char_length(p_new_password) < 4 THEN
    RETURN jsonb_build_object('success', false, 'error', 'WEAK_PASSWORD');
  END IF;
  IF char_length(p_new_password) = 4 AND p_new_password !~ '^[0-9]{4}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'WEAK_PASSWORD');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
  END IF;

  SELECT extnamespace::regnamespace::text INTO v_pgc_schema
  FROM pg_extension WHERE extname = 'pgcrypto';

  IF v_pgc_schema IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', 'pgcrypto extension is not enabled');
  END IF;

  EXECUTE format('SELECT %I.crypt($1, %I.gen_salt($2, $3))', v_pgc_schema, v_pgc_schema)
    INTO v_hash USING p_new_password, 'bf', 10;

  UPDATE auth.users
  SET encrypted_password = v_hash, updated_at = now()
  WHERE id = p_user_id;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'sessions') THEN
    DELETE FROM auth.sessions WHERE user_id = p_user_id;
  END IF;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'LAST_ADMIN' THEN
    RETURN jsonb_build_object('success', false, 'error', 'LAST_ADMIN');
  END IF;
  RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', SQLERRM);
END;
$$;

-- Refresh the PostgREST schema cache.
NOTIFY pgrst, 'reload schema';
