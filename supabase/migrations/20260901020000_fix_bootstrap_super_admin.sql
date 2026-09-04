-- =============================================================================
-- Migration: 20260901020000_fix_bootstrap_super_admin.sql
-- Description: Robust bootstrap RPC to initialize the initial Super Admin
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
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user_id uuid;
  v_encrypted_pw text;
  v_email text;
  v_username text;
  v_existing_super_count integer;
  v_default_branch uuid;
BEGIN
  -- Set session flag to permit user/role creation without existing admin
  PERFORM set_config('app.register_branch', 'on', true);

  v_email := lower(btrim(p_email));
  v_username := lower(btrim(COALESCE(p_username, split_part(v_email, '@', 1))));

  IF v_email = '' OR v_email !~ '@' OR v_email !~ '\.' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_EMAIL',
      'message', 'Please provide a valid email address.'
    );
  END IF;

  IF length(p_password) < 6 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'PASSWORD_TOO_SHORT',
      'message', 'Password must be at least 6 characters.'
    );
  END IF;

  -- Find default branch
  SELECT id INTO v_default_branch
  FROM public.branches
  ORDER BY created_at ASC
  LIMIT 1;

  -- Check if super_admin users already exist
  SELECT count(*) INTO v_existing_super_count
  FROM public.users
  WHERE role = 'super_admin';

  -- Find or generate user_id in auth.users
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = v_email;

  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();
    v_encrypted_pw := extensions.crypt(p_password, extensions.gen_salt('bf'));

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
      email_change,
      email_change_token_new,
      recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      v_email,
      v_encrypted_pw,
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', p_full_name, 'username', v_username),
      now(),
      now(),
      '',
      '',
      '',
      ''
    );
  ELSE
    -- If user already exists in auth.users, update their password and confirmed status
    v_encrypted_pw := extensions.crypt(p_password, extensions.gen_salt('bf'));
    UPDATE auth.users
    SET encrypted_password = v_encrypted_pw,
        email_confirmed_at = COALESCE(email_confirmed_at, now()),
        updated_at = now()
    WHERE id = v_user_id;
  END IF;

  -- Ensure record in public.users exists and has role 'super_admin'
  INSERT INTO public.users (
    id,
    email,
    full_name,
    username,
    role,
    is_active,
    branch_id,
    created_at
  ) VALUES (
    v_user_id,
    v_email,
    p_full_name,
    v_username,
    'super_admin',
    true,
    v_default_branch,
    now()
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      full_name = EXCLUDED.full_name,
      username = EXCLUDED.username,
      role = 'super_admin',
      is_active = true,
      branch_id = COALESCE(public.users.branch_id, v_default_branch);

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'email', v_email,
    'role', 'super_admin',
    'message', 'Initial Super Admin initialized successfully.'
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', 'BOOTSTRAP_FAILED',
    'message', SQLERRM
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_initial_super_admin(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bootstrap_initial_super_admin(text, text, text, text) TO anon, authenticated, service_role;
