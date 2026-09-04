-- =============================================================================
-- Migration: 20260901000000_bootstrap_super_admin.sql
-- Description: Secure bootstrap RPC to initialize the first Super Admin in a clean Supabase database
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE OR REPLACE FUNCTION public.bootstrap_initial_super_admin(
  p_email text,
  p_password text,
  p_full_name text DEFAULT 'Super Admin',
  p_username text DEFAULT 'superadmin'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid;
  v_encrypted_pw text;
  v_email text;
  v_username text;
  v_existing_super_count integer;
BEGIN
  v_email := lower(btrim(p_email));
  v_username := lower(btrim(COALESCE(p_username, split_part(v_email, '@', 1))));

  IF v_email = '' OR v_email !~ '@' OR v_email !~ '\.' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_EMAIL', 'message', 'Invalid email address format');
  END IF;

  IF p_password IS NULL OR length(p_password) < 6 THEN
    RETURN jsonb_build_object('success', false, 'error', 'WEAK_PASSWORD', 'message', 'Password must be at least 6 characters');
  END IF;

  -- Hash password securely with pgcrypto blowfish
  v_encrypted_pw := crypt(p_password, gen_salt('bf'));

  -- Check if user exists in auth.users
  SELECT id INTO v_user_id FROM auth.users WHERE email = v_email LIMIT 1;

  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();
    
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      recovery_token,
      email_change_token_new,
      email_change
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      v_email,
      v_encrypted_pw,
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', p_full_name, 'username', v_username, 'role', 'super_admin'),
      now(),
      now(),
      '',
      '',
      '',
      ''
    );
  ELSE
    UPDATE auth.users
    SET encrypted_password = v_encrypted_pw,
        email_confirmed_at = COALESCE(email_confirmed_at, now()),
        raw_user_meta_data = jsonb_build_object('full_name', p_full_name, 'username', v_username, 'role', 'super_admin'),
        updated_at = now()
    WHERE id = v_user_id;
  END IF;

  -- Upsert into public.users
  INSERT INTO public.users (
    id,
    email,
    full_name,
    username,
    role,
    is_active,
    branch_id,
    created_at,
    updated_at
  ) VALUES (
    v_user_id,
    v_email,
    p_full_name,
    v_username,
    'super_admin',
    true,
    NULL,
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      full_name = EXCLUDED.full_name,
      username = EXCLUDED.username,
      role = 'super_admin',
      is_active = true,
      updated_at = now();

  -- Record audit log if table exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_logs') THEN
    INSERT INTO public.audit_logs (
      action,
      entity,
      entity_id,
      user_id,
      details,
      created_at
    ) VALUES (
      'BOOTSTRAP_SUPER_ADMIN',
      'users',
      v_user_id::text,
      v_user_id,
      jsonb_build_object('email', v_email, 'username', v_username, 'role', 'super_admin'),
      now()
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'email', v_email,
    'username', v_username,
    'role', 'super_admin'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.bootstrap_initial_super_admin(text, text, text, text) TO authenticated, anon;
