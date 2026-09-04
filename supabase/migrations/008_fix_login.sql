-- Migration: Fix login for users created by create_user RPC
-- Run this in Supabase SQL Editor AFTER migration_enterprise_core.sql.
--
-- Even after the instance_id / provider_id fixes, a freshly created account can
-- still fail to sign in when ANY piece of the auth.users row is inconsistent
-- (NULL token column, missing email identity, wrong provider_id, unconfirmed
-- email, missing email_verified meta, wrong aud/role...).
--
-- This migration ships three admin-only tools (all SECURITY DEFINER, they call
-- is_pos_admin() first):
--   * verify_auth_account(user_id)  -> full health report (JSON)
--   * repair_auth_account(user_id)  -> fixes everything in one transaction
--   * password_matches(user_id, pw) -> bcrypt check (resolves pgcrypto schema)

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ============ 1. VERIFY AUTH ACCOUNT ============
-- Returns a health report so we can see exactly why a login fails.
CREATE OR REPLACE FUNCTION verify_auth_account(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_identity record;
  v_pgc_schema text;
BEGIN
  -- Only admins can run diagnostics
  IF NOT public.is_pos_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  SELECT email, encrypted_password, aud, role, instance_id,
         email_confirmed_at, confirmation_token, recovery_token,
         email_change, email_change_token_new, email_change_token_current,
         raw_user_meta_data
    INTO v_row
    FROM auth.users WHERE id = p_user_id;

  IF v_row IS NULL OR v_row.email IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND',
      'hint', 'No row found in auth.users for this id');
  END IF;

  SELECT provider, provider_id, user_id, identity_data, email
    INTO v_identity
    FROM auth.identities
    WHERE user_id = p_user_id AND provider = 'email'
    ORDER BY created_at LIMIT 1;

  SELECT extnamespace::regnamespace::text INTO v_pgc_schema
    FROM pg_extension WHERE extname = 'pgcrypto';

  RETURN jsonb_build_object(
    'success', true,
    'email', v_row.email,
    'aud', v_row.aud,
    'auth_role', v_row.role,
    'instance_ok', COALESCE(v_row.instance_id, '') = '00000000-0000-0000-0000-000000000000',
    'confirmed', v_row.email_confirmed_at IS NOT NULL,
    'tokens_ok', v_row.confirmation_token IS NOT NULL
                 AND v_row.recovery_token IS NOT NULL
                 AND v_row.email_change IS NOT NULL
                 AND v_row.email_change_token_new IS NOT NULL
                 AND v_row.email_change_token_current IS NOT NULL,
    'email_verified_meta', COALESCE(v_row.raw_user_meta_data->>'email_verified', 'false') = 'true',
    'hash_present', v_row.encrypted_password IS NOT NULL AND v_row.encrypted_password <> '',
    'hash_prefix', left(COALESCE(v_row.encrypted_password, ''), 4),
    'app_profile', EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id),
    'identity_exists', v_identity IS NOT NULL,
    'identity_provider_ok', v_identity IS NULL OR v_identity.provider_id = p_user_id::text,
    'identity_sub_ok', v_identity IS NULL OR COALESCE(v_identity.identity_data->>'sub', '') = p_user_id::text,
    'identity_email_ok', v_identity IS NULL OR lower(COALESCE(v_identity.email, v_identity.identity_data->>'email', '')) = lower(v_row.email),
    'pgcrypto_schema', v_pgc_schema
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', SQLERRM);
END;
$$;

-- ============ 2. REPAIR AUTH ACCOUNT ============
-- Fixes every known login-blocking inconsistency in one transaction, then
-- returns the verify report again so you can confirm everything is green.
CREATE OR REPLACE FUNCTION repair_auth_account(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_i_cols text;
  v_i_vals text;
BEGIN
  -- Only admins can repair accounts
  IF NOT public.is_pos_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = p_user_id;
  IF v_email IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
  END IF;

  -- 1. instance_id: GoTrue looks users up by the default instance UUID; NULL never matches
  UPDATE auth.users SET instance_id = '00000000-0000-0000-0000-000000000000'
    WHERE id = p_user_id AND instance_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000000';

  -- 2. token columns -> '' (GoTrue scans them as strings, NULL breaks login)
  UPDATE auth.users SET
    confirmation_token       = COALESCE(confirmation_token, ''),
    recovery_token           = COALESCE(recovery_token, ''),
    email_change             = COALESCE(email_change, ''),
    email_change_token_new   = COALESCE(email_change_token_new, ''),
    email_change_token_current = COALESCE(email_change_token_current, '')
    WHERE id = p_user_id;

  -- 3. confirm the email
  UPDATE auth.users SET email_confirmed_at = COALESCE(email_confirmed_at, now())
    WHERE id = p_user_id;

  -- 4. aud / role must be 'authenticated'
  UPDATE auth.users SET aud = COALESCE(NULLIF(aud, ''), 'authenticated'),
                        role = COALESCE(NULLIF(role, ''), 'authenticated')
    WHERE id = p_user_id;

  -- 5. mark email as verified in metadata
  UPDATE auth.users SET raw_user_meta_data =
      jsonb_set(COALESCE(raw_user_meta_data, '{}'::jsonb), '{email_verified}', 'true', true)
    WHERE id = p_user_id;

  -- 6. ensure the email identity exists with provider_id = user_id::text and sub = user_id::text
  IF NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = p_user_id AND provider = 'email') THEN
    SELECT string_agg(c.col, ', ' ORDER BY c.ord), string_agg(c.val, ', ' ORDER BY c.ord)
    INTO v_i_cols, v_i_vals
    FROM (
      SELECT cols.ordinal_position AS ord, quote_ident(cols.column_name) AS col,
        CASE cols.column_name
          WHEN 'id' THEN 'gen_random_uuid()'
          WHEN 'provider_id' THEN quote_literal(p_user_id::text)
          WHEN 'user_id' THEN quote_literal(p_user_id)
          WHEN 'identity_data' THEN format('jsonb_build_object(''sub'',%L,''email'',%L)', p_user_id::text, v_email)
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

    IF v_i_cols IS NOT NULL AND v_i_vals IS NOT NULL THEN
      EXECUTE 'INSERT INTO auth.identities (' || v_i_cols || ') VALUES (' || v_i_vals || ')';
    END IF;
  ELSE
    UPDATE auth.identities
    SET provider_id = p_user_id::text,
        email = v_email,
        identity_data = jsonb_build_object('sub', p_user_id::text, 'email', v_email)
    WHERE user_id = p_user_id AND provider = 'email';
  END IF;

  -- Return the post-repair health report
  RETURN public.verify_auth_account(p_user_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', SQLERRM);
END;
$$;

-- ============ 3. PASSWORD MATCH CHECK ============
-- Tests whether a stored bcrypt hash matches a given password. Resolves the
-- pgcrypto schema at runtime so it works on any Supabase project.
CREATE OR REPLACE FUNCTION password_matches(p_user_id uuid, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash text;
  v_pgc_schema text;
  v_ok boolean;
BEGIN
  IF NOT public.is_pos_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  SELECT encrypted_password INTO v_hash FROM auth.users WHERE id = p_user_id;
  IF v_hash IS NULL OR v_hash = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND',
      'hint', 'No encrypted_password stored for this user');
  END IF;

  IF p_password IS NULL OR p_password = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'EMPTY_PASSWORD');
  END IF;

  SELECT extnamespace::regnamespace::text INTO v_pgc_schema
    FROM pg_extension WHERE extname = 'pgcrypto';

  IF v_pgc_schema IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', 'pgcrypto extension is not enabled');
  END IF;

  EXECUTE format('SELECT %I.crypt($1, $2) = $2', v_pgc_schema) INTO v_ok USING p_password, v_hash;

  RETURN jsonb_build_object('success', true, 'matched', COALESCE(v_ok, false),
    'hint', CASE WHEN COALESCE(v_ok, false) THEN 'Password matches the stored hash' ELSE 'Password does NOT match the stored hash' END);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', SQLERRM);
END;
$$;
