-- ============================================================================
-- 043. User & Role Management
-- ----------------------------------------------------------------------------
-- Backing schema for the User & Role Management feature. Additive + idempotent
-- (safe to re-run; the migration runner also gates it by checksum).
--
--   1. roles: `scope` (global/branch) + `branch_id` + descriptions + active
--      flag; branch managers can create/manage roles scoped to their own
--      branch. System/global roles stay admin-managed only.
--   2. users: phone / is_locked / failed_attempts / lock_until / last_login_at;
--      the fixed-role CHECK is dropped so custom roles work. Role validity is
--      enforced by the (updated) role-guard trigger instead.
--   3. guard_user_role_changes: validates assigned roles exist and are
--      assignable in the caller's scope; blocks self-lock tampering; keeps the
--      existing admin/BM safeguards intact.
--   4. login_as_log + login_as_user / return_from_login_as RPCs.
--   5. Login lockout: record_login_failure / record_login_success + a locked
--      check in get_login_email.
--   6. audit_log: ip / device columns.
--   7. Seeds the two legacy role values (kitchen / customer_display) that exist
--      in users but were never in the roles matrix, and appends the new action
--      permissions to the default role matrix.
-- ============================================================================

-- ============ 1. ROLES: SCOPE + BRANCH ============
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'global';
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE;
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS description_ar text;
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS description_en text;
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roles_scope_check') THEN
    ALTER TABLE public.roles ADD CONSTRAINT roles_scope_check CHECK (scope IN ('global', 'branch'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_roles_branch ON public.roles (branch_id);

-- Seed the two legacy role values referenced by users.role that were never in
-- the matrix (kept so the role-guard trigger never rejects existing accounts).
INSERT INTO public.roles (role, name_ar, name_en, permissions, scope) VALUES
  ('kitchen', 'المطبخ', 'Kitchen', '["dashboard.view"]'::jsonb, 'global'),
  ('customer_display', 'شاشة العملاء', 'Customer Display', '[]'::jsonb, 'global')
ON CONFLICT (role) DO NOTHING;

-- ============ 2. ROLES: RLS (admins all; BMs their own branch) ============
DROP POLICY IF EXISTS "auth_select_roles" ON public.roles;
CREATE POLICY "auth_select_roles" ON public.roles FOR SELECT TO authenticated
  USING (is_pos_admin() OR scope = 'global' OR branch_id = get_branch_id());

DROP POLICY IF EXISTS "auth_write_roles" ON public.roles;
CREATE POLICY "auth_write_roles" ON public.roles FOR INSERT TO authenticated
  WITH CHECK (
    is_pos_admin()
    OR (is_branch_manager() AND scope = 'branch' AND branch_id = get_branch_id())
  );

DROP POLICY IF EXISTS "auth_write_roles_upd" ON public.roles;
CREATE POLICY "auth_write_roles_upd" ON public.roles FOR UPDATE TO authenticated
  USING (
    is_pos_admin()
    OR (is_branch_manager() AND scope = 'branch' AND branch_id = get_branch_id())
  )
  WITH CHECK (
    is_pos_admin()
    OR (is_branch_manager() AND scope = 'branch' AND branch_id = get_branch_id())
  );

DROP POLICY IF EXISTS "auth_write_roles_del" ON public.roles;
CREATE POLICY "auth_write_roles_del" ON public.roles FOR DELETE TO authenticated
  USING (
    is_pos_admin()
    OR (is_branch_manager() AND scope = 'branch' AND branch_id = get_branch_id())
  );

-- ============ 3. USERS: EXTRA COLUMNS, DROP FIXED-ROLE CHECK ============
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS failed_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS lock_until timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;

-- ============ 4. AUDIT LOG: IP / DEVICE ============
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS ip text;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS device text;

-- ============ 5. ROLE-GUARD TRIGGER (custom roles + lockout safety) ============
-- Keeps every existing safeguard (admins only manage admins, no self
-- role/branch/status changes, BMs scoped to their branch) and adds:
--   * assigned roles must exist in the roles matrix;
--   * BMs may only assign global roles or roles of their own branch;
--   * nobody may clear their own lock / login counters (except the lockout RPC,
--     signalled via the app.login_guard_bypass GUC);
--   * unknown callers may only self-register a fresh cashier row or update
--     lockout counters (anon-callable record_login_failure).
CREATE OR REPLACE FUNCTION public.guard_user_role_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_caller_role text;
  v_caller_branch uuid;
  v_bypass boolean;
BEGIN
  SELECT role, branch_id INTO v_caller_role, v_caller_branch
  FROM public.users WHERE id = auth.uid();

  v_bypass := COALESCE(current_setting('app.login_guard_bypass', true), '') = 'on';

  -- Assigned role must exist in the matrix.
  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE role = NEW.role) THEN
    RAISE EXCEPTION 'UNKNOWN_ROLE';
  END IF;

  -- Unknown / anonymous caller (e.g. anon lockout RPC, or self-registration).
  IF v_caller_role IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      -- Self-registration: fresh basic cashier profile owned by the caller
      -- (RLS already enforces this exact shape).
      IF NEW.id = auth.uid() AND NEW.role = 'cashier' AND NEW.branch_id IS NULL THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'PERMISSION_DENIED';
    END IF;
    -- UPDATE: only lockout counters may change (record_login_failure as anon).
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.role IS DISTINCT FROM OLD.role
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.is_active IS DISTINCT FROM OLD.is_active
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.username IS DISTINCT FROM OLD.username
       OR NEW.full_name IS DISTINCT FROM OLD.full_name
       OR NEW.phone IS DISTINCT FROM OLD.phone THEN
      RAISE EXCEPTION 'PERMISSION_DENIED';
    END IF;
    RETURN NEW;
  END IF;

  -- Only admins may create or modify admin accounts.
  IF NEW.role IN ('super_admin', 'owner') AND v_caller_role NOT IN ('super_admin', 'owner') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: only an admin can assign admin roles';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Only admins may modify existing admin accounts.
    IF OLD.role IN ('super_admin', 'owner') AND v_caller_role NOT IN ('super_admin', 'owner') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: only an admin can modify admin accounts';
    END IF;

    -- No self-demotion / self-deactivation / self-branch-change for non-admins.
    IF NEW.id = auth.uid() AND v_caller_role NOT IN ('super_admin', 'owner') THEN
      IF NEW.role IS DISTINCT FROM OLD.role
         OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
         OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: users cannot change their own role/branch/status';
      END IF;

      -- Lockout fields are system-managed (only the lockout RPC may touch them).
      IF NOT v_bypass THEN
        IF NEW.is_locked IS DISTINCT FROM OLD.is_locked
           OR NEW.failed_attempts IS DISTINCT FROM OLD.failed_attempts
           OR NEW.lock_until IS DISTINCT FROM OLD.lock_until THEN
          RAISE EXCEPTION 'PERMISSION_DENIED: users cannot modify their own lock state';
        END IF;
      END IF;
    END IF;
  END IF;

  -- Branch managers may only manage staff of their own branch.
  IF v_caller_role = 'branch_manager' THEN
    IF NEW.branch_id IS DISTINCT FROM v_caller_branch THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: branch managers can only manage their own branch';
    END IF;
    -- Assigned role must be a global role or a role of this branch.
    IF NOT EXISTS (
      SELECT 1 FROM public.roles
      WHERE role = NEW.role AND is_active AND (scope = 'global' OR branch_id = v_caller_branch)
    ) THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: role is not assignable in this branch';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_users_role_guard ON public.users;
CREATE TRIGGER trg_users_role_guard
BEFORE INSERT OR UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.guard_user_role_changes();

-- ============ 6. LOGIN AS (LOGIN_AS_LOG + RPCs) ============
CREATE TABLE IF NOT EXISTS public.login_as_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  admin_email text,
  admin_branch_id uuid,
  target_user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  target_branch_id uuid,
  reason text,
  ip text,
  device text,
  login_at timestamptz NOT NULL DEFAULT now(),
  logout_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_as_log_login ON public.login_as_log (login_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_as_log_target ON public.login_as_log (target_user_id);

ALTER TABLE public.login_as_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "login_as_log_select_admin" ON public.login_as_log;
CREATE POLICY "login_as_log_select_admin" ON public.login_as_log
  FOR SELECT TO authenticated USING (is_pos_admin());
DROP POLICY IF EXISTS "login_as_log_insert_admin" ON public.login_as_log;
CREATE POLICY "login_as_log_insert_admin" ON public.login_as_log
  FOR INSERT TO authenticated WITH CHECK (is_pos_admin());
DROP POLICY IF EXISTS "login_as_log_update_admin" ON public.login_as_log;
CREATE POLICY "login_as_log_update_admin" ON public.login_as_log
  FOR UPDATE TO authenticated USING (is_pos_admin()) WITH CHECK (is_pos_admin());

GRANT SELECT, INSERT, UPDATE ON public.login_as_log TO authenticated;

-- Start impersonating a user. Super admin / owner only. The caller's GoTrue
-- session stays active (the app swaps the resolved profile); RLS stays scoped
-- to the admin, who already sees every branch, so no privilege is widened.
-- The log row is the authoritative audit record for the impersonation.
CREATE OR REPLACE FUNCTION public.login_as_user(
  p_target_user_id uuid,
  p_reason text DEFAULT NULL,
  p_ip text DEFAULT NULL,
  p_device text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin public.users%ROWTYPE;
  v_target public.users%ROWTYPE;
  v_log_id uuid;
BEGIN
  SELECT * INTO v_admin FROM public.users WHERE id = auth.uid();
  IF v_admin.id IS NULL OR NOT v_admin.is_active OR v_admin.role NOT IN ('super_admin', 'owner') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  SELECT * INTO v_target FROM public.users WHERE id = p_target_user_id;
  IF v_target.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;
  IF NOT v_target.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_INACTIVE');
  END IF;
  IF v_target.id = v_admin.id THEN
    RETURN jsonb_build_object('success', false, 'error', 'CANNOT_IMPERSONATE_SELF');
  END IF;
  IF v_target.role IN ('super_admin', 'owner') THEN
    RETURN jsonb_build_object('success', false, 'error', 'CANNOT_IMPERSONATE_ADMIN');
  END IF;

  INSERT INTO public.login_as_log (
    admin_user_id, admin_email, admin_branch_id, target_user_id, target_branch_id,
    reason, ip, device
  ) VALUES (
    v_admin.id, v_admin.email, v_admin.branch_id, v_target.id, v_target.branch_id,
    p_reason, p_ip, p_device
  )
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object(
    'success', true,
    'log_id', v_log_id,
    'target', jsonb_build_object(
      'id', v_target.id,
      'email', v_target.email,
      'username', v_target.username,
      'full_name', v_target.full_name,
      'role', v_target.role,
      'branch_id', v_target.branch_id,
      'phone', v_target.phone,
      'is_active', v_target.is_active,
      'is_locked', v_target.is_locked
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.login_as_user(uuid, text, text, text) TO authenticated;

-- End an impersonation (logs logout_at). Only the same admin can close it.
CREATE OR REPLACE FUNCTION public.return_from_login_as(p_log_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated int;
BEGIN
  UPDATE public.login_as_log
  SET logout_at = now()
  WHERE id = p_log_id AND admin_user_id = auth.uid() AND logout_at IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.return_from_login_as(uuid) TO authenticated;

-- ============ 7. LOGIN LOCKOUT RPCs ============
-- Client calls this on a failed sign-in (anon session). Increments the failure
-- counter and locks the account after 5 consecutive failures for 5 minutes.
CREATE OR REPLACE FUNCTION public.record_login_failure(p_username text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.users%ROWTYPE;
  v_new_attempts int;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE username = lower(btrim(p_username));
  IF v_user.id IS NULL THEN
    RETURN jsonb_build_object('success', true);
  END IF;

  v_new_attempts := v_user.failed_attempts + 1;
  IF v_new_attempts >= 5 THEN
    UPDATE public.users
    SET failed_attempts = v_new_attempts, is_locked = true, lock_until = now() + interval '5 minutes'
    WHERE id = v_user.id;
  ELSE
    UPDATE public.users SET failed_attempts = v_new_attempts WHERE id = v_user.id;
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_login_failure(text) TO anon, authenticated;

-- Client calls this on a successful sign-in. Resets the counter/lock and
-- records last_login_at. Uses the app.login_guard_bypass GUC so the role-guard
-- trigger lets the lockout fields change without opening self-unlock.
CREATE OR REPLACE FUNCTION public.record_login_success(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id AND NOT is_pos_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  PERFORM set_config('app.login_guard_bypass', 'on', true);

  UPDATE public.users
  SET failed_attempts = 0, is_locked = false, lock_until = NULL, last_login_at = now()
  WHERE id = p_user_id;

  PERFORM set_config('app.login_guard_bypass', 'off', true);

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_login_success(uuid) TO authenticated;

-- get_login_email: reject locked accounts before returning the email.
CREATE OR REPLACE FUNCTION public.get_login_email(p_username text)
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
  IF v_user.is_locked AND (v_user.lock_until IS NULL OR v_user.lock_until > now()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_LOCKED');
  END IF;
  -- Auto-clear an expired lock so the locked flag never goes stale.
  IF v_user.is_locked AND v_user.lock_until IS NOT NULL AND v_user.lock_until <= now() THEN
    UPDATE public.users SET is_locked = false, failed_attempts = 0, lock_until = NULL WHERE id = v_user.id;
  END IF;
  RETURN jsonb_build_object('success', true, 'email', v_user.email);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_login_email(text) TO anon, authenticated;

-- ============ 8. create_user: CUSTOM-ROLE AWARE ============
-- The role is validated against the roles matrix (instead of a hardcoded
-- whitelist) so admins can assign custom roles and branch managers can assign
-- any global role or a role scoped to their own branch. Everything else (email/
-- username uniqueness, auth.users + auth.identities creation, PIN hashing) is
-- unchanged from 007/011.
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

  -- Custom-role aware: the assigned role must exist in the matrix and be
  -- assignable by the caller (BM: global or own-branch roles only).
  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE role = p_role) THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ROLE');
  END IF;
  IF v_caller_role = 'branch_manager' AND NOT EXISTS (
    SELECT 1 FROM public.roles
    WHERE role = p_role AND (scope = 'global' OR branch_id = v_caller_branch)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED',
      'detail', 'Role not assignable in this branch');
  END IF;
  v_role := p_role;

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

GRANT EXECUTE ON FUNCTION public.create_user(text, text, text, text, uuid, boolean, text) TO authenticated;

-- ============ 9. DEFAULT ROLE MATRIX: NEW ACTION PERMISSIONS ============
-- Appends the granular action permissions (print / export / import / POS
-- discount / change price / reprint) to the DB matrix so the features work out
-- of the box. Idempotent: dedupes and never strips existing permissions.
DO $$
DECLARE
  v_key text;
  v_perms jsonb;
BEGIN
  -- { role -> permissions to ensure }
  FOR v_key, v_perms IN
    SELECT kv.key, kv.value
    FROM jsonb_each(jsonb_build_object(
      'cashier', '["pos.reprint","sales.print","customers.print","products.print"]'::jsonb,
      'warehouse_manager', '["products.print","products.export","products.import","purchases.print","suppliers.print"]'::jsonb,
      'accountant', '["sales.print","sales.export","reports.print","reports.export","expenses.print","purchases.print","customers.print","customers.export","suppliers.print"]'::jsonb,
      'production_manager', '["products.print","products.export","products.import","purchases.print","suppliers.print"]'::jsonb,
      'branch_manager', '["pos.discount","pos.change_price","pos.reprint","products.print","products.export","products.import","purchases.print","sales.print","sales.export","reports.print","reports.export","customers.print","customers.export","suppliers.print","expenses.print"]'::jsonb,
      'super_admin', '["pos.discount","pos.change_price","pos.reprint","products.print","products.export","products.import","purchases.print","sales.print","sales.export","reports.print","reports.export","customers.print","customers.export","suppliers.print","expenses.print"]'::jsonb,
      'owner', '["pos.discount","pos.change_price","pos.reprint","products.print","products.export","products.import","purchases.print","sales.print","sales.export","reports.print","reports.export","customers.print","customers.export","suppliers.print","expenses.print"]'::jsonb
    )) AS kv
  LOOP
    UPDATE public.roles
    SET permissions = (
      SELECT COALESCE(jsonb_agg(DISTINCT elem), '[]'::jsonb)
      FROM jsonb_array_elements_text(permissions || v_perms) AS t(elem)
    )
    WHERE role = v_key AND v_perms IS NOT NULL;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
