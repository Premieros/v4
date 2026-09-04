-- ============================================================================
-- 055. Subscriptions: 14-day trial + paid plans (Basic / Standard / Enterprise)
-- ----------------------------------------------------------------------------
-- Adds the subscription layer that gates selling per branch:
--
--   1. subscription_plans        – the three paid tiers (EGP, monthly & yearly).
--   2. branch_subscriptions      – one subscription row per branch (PK=branch_id);
--      status: trial → active / past_due / cancelled / expired.
--   3. subscription_status()     – effective status of a branch (trial window /
--      billing period aware). SECURITY DEFINER so anon/authenticated can query.
--   4. subscription_expired()    – boolean helper used by the sale guard.
--   5. register_branch(...)      – anon self-service signup: creates branch +
--      main warehouse + branch_settings + owner auth account (email confirmed)
--      + a 14-day trial subscription, atomically. Reuses create_user(), which
--      gains an app.register_branch GUC bypass mirroring app.login_guard_bypass.
--   6. activate_subscription()   – admin-only: start/cancel a plan.
--   7. process_sale()            – returns SUBSCRIPTION_EXPIRED before any write
--      when the branch subscription is not active/live-trial. super_admin only
--      is exempt (owners manage plans, they do not bypass the gate).
--
-- Backfill: every existing branch gets an active trial starting now, so nothing
-- already deployed is locked out.
--
-- Additive + idempotent (safe to re-run; the migration runner also gates it by
-- checksum). create_user() and guard_user_role_changes() are re-created with the
-- register_branch bypass; process_sale() is re-created with the gate on top of
-- the exact 047 body.
-- ============================================================================

-- ============ 1. SUBSCRIPTION PLANS ============
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id text PRIMARY KEY,
  name_ar text NOT NULL,
  name_en text NOT NULL,
  monthly_price_egp numeric(10,2) NOT NULL,
  yearly_price_egp numeric(10,2) NOT NULL,
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.subscription_plans (id, name_ar, name_en, monthly_price_egp, yearly_price_egp, features)
VALUES
  ('basic',      'الأساسية', 'Basic',      299, 2990,
    '["Users: 2","Warehouses: 1","Inventory & sales"]'::jsonb),
  ('standard',   'القياسية', 'Standard',   599, 5990,
    '["Users: 5","Warehouses: 3","Accounting & reports"]'::jsonb),
  ('enterprise', 'المتقدمة', 'Enterprise', 999, 9990,
    '["Users: unlimited","Multi-branch","Full suite + priority support"]'::jsonb)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plans_read_all" ON public.subscription_plans;
CREATE POLICY "plans_read_all" ON public.subscription_plans FOR SELECT TO anon, authenticated
  USING (true);

GRANT SELECT ON public.subscription_plans TO anon, authenticated, service_role;

-- ============ 2. BRANCH SUBSCRIPTIONS ============
CREATE TABLE IF NOT EXISTS public.branch_subscriptions (
  branch_id uuid PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
  plan_id text REFERENCES public.subscription_plans(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'trial',
  trial_starts_at timestamptz NOT NULL DEFAULT now(),
  trial_ends_at timestamptz,
  current_period_starts_at timestamptz,
  current_period_ends_at timestamptz,
  cancel_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT branch_subscriptions_status_check
    CHECK (status IN ('trial', 'active', 'past_due', 'cancelled', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_branch_subscriptions_status ON public.branch_subscriptions (status);

ALTER TABLE public.branch_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "subs_select_own" ON public.branch_subscriptions;
CREATE POLICY "subs_select_own" ON public.branch_subscriptions FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());

DROP POLICY IF EXISTS "subs_admin_insert" ON public.branch_subscriptions;
CREATE POLICY "subs_admin_insert" ON public.branch_subscriptions FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin());

DROP POLICY IF EXISTS "subs_admin_update" ON public.branch_subscriptions;
CREATE POLICY "subs_admin_update" ON public.branch_subscriptions FOR UPDATE TO authenticated
  USING (is_pos_admin()) WITH CHECK (is_pos_admin());

DROP POLICY IF EXISTS "subs_admin_delete" ON public.branch_subscriptions;
CREATE POLICY "subs_admin_delete" ON public.branch_subscriptions FOR DELETE TO authenticated
  USING (is_pos_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.branch_subscriptions TO authenticated, service_role;

-- ============ 3. BACKFILL: existing branches start an active trial ============
INSERT INTO public.branch_subscriptions (branch_id, status, trial_starts_at, trial_ends_at)
SELECT b.id, 'trial', now(), now() + interval '14 days'
FROM public.branches b
WHERE NOT EXISTS (SELECT 1 FROM public.branch_subscriptions s WHERE s.branch_id = b.id);

-- ============ 4. STATUS HELPERS ============
CREATE OR REPLACE FUNCTION public.subscription_status(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.branch_subscriptions%ROWTYPE;
  v_status text;
  v_expired boolean;
BEGIN
  SELECT * INTO v_row FROM public.branch_subscriptions WHERE branch_id = p_branch_id;

  IF v_row.branch_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'none', 'plan_id', NULL,
      'expired', true, 'trial_ends_at', NULL, 'current_period_ends_at', NULL
    );
  END IF;

  v_status := v_row.status;
  v_expired := false;

  IF v_status IN ('trial', 'active', 'past_due') THEN
    IF v_status = 'trial' THEN
      IF v_row.trial_ends_at IS NOT NULL AND v_row.trial_ends_at <= now() THEN
        v_status := 'expired';
        v_expired := true;
      END IF;
    ELSE
      IF v_row.current_period_ends_at IS NOT NULL AND v_row.current_period_ends_at <= now() THEN
        v_status := 'expired';
        v_expired := true;
      END IF;
    END IF;
  ELSE
    v_expired := true;
  END IF;

  RETURN jsonb_build_object(
    'branch_id', p_branch_id,
    'status', v_status,
    'plan_id', v_row.plan_id,
    'expired', v_expired,
    'trial_ends_at', v_row.trial_ends_at,
    'current_period_ends_at', v_row.current_period_ends_at,
    'cancelled_at', v_row.cancelled_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.subscription_expired(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (public.subscription_status(p_branch_id)->>'expired')::boolean;
$$;

GRANT EXECUTE ON FUNCTION public.subscription_status(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.subscription_expired(uuid) TO anon, authenticated, service_role;

-- ============ 5. ACTIVATE / CANCEL PLAN (admin only) ============
CREATE OR REPLACE FUNCTION public.activate_subscription(
  p_branch_id uuid,
  p_plan_id text,
  p_billing_period text DEFAULT 'monthly',
  p_activate boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.subscription_plans%ROWTYPE;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_price numeric(10,2);
BEGIN
  IF NOT is_pos_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  IF p_branch_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_NOT_FOUND');
  END IF;

  IF NOT p_activate THEN
    UPDATE public.branch_subscriptions
    SET status = 'cancelled',
        cancel_at = now(),
        cancelled_at = now(),
        updated_at = now()
    WHERE branch_id = p_branch_id;
    RETURN jsonb_build_object('success', true, 'branch_id', p_branch_id, 'status', 'cancelled');
  END IF;

  SELECT * INTO v_plan FROM public.subscription_plans WHERE id = p_plan_id AND is_active;
  IF v_plan.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'PLAN_NOT_FOUND');
  END IF;

  v_period_start := now();
  IF p_billing_period = 'yearly' THEN
    v_period_end := v_period_start + interval '1 year';
    v_price := v_plan.yearly_price_egp;
  ELSE
    v_period_end := v_period_start + interval '1 month';
    v_price := v_plan.monthly_price_egp;
  END IF;

  INSERT INTO public.branch_subscriptions (
    branch_id, plan_id, status,
    trial_starts_at, trial_ends_at,
    current_period_starts_at, current_period_ends_at,
    cancel_at, cancelled_at, updated_at
  ) VALUES (
    p_branch_id, v_plan.id, 'active',
    NULL, NULL,
    v_period_start, v_period_end,
    NULL, NULL, now()
  )
  ON CONFLICT (branch_id) DO UPDATE SET
    plan_id = EXCLUDED.plan_id,
    status = 'active',
    trial_starts_at = NULL,
    trial_ends_at = NULL,
    current_period_starts_at = EXCLUDED.current_period_starts_at,
    current_period_ends_at = EXCLUDED.current_period_ends_at,
    cancel_at = NULL,
    cancelled_at = NULL,
    updated_at = now();

  RETURN jsonb_build_object('success', true, 'branch_id', p_branch_id, 'status', 'active',
    'plan_id', v_plan.id, 'price_egp', v_price);
END;
$$;

GRANT EXECUTE ON FUNCTION public.activate_subscription(uuid, text, text, boolean) TO authenticated, service_role;

-- ============ 6. create_user: register_branch GUC bypass ============
-- Mirrors the app.login_guard_bypass pattern so the anon self-service RPC can
-- provision the owner account while everything else stays admin/branch-manager.
CREATE OR REPLACE FUNCTION public.create_user(
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

  IF current_setting('app.register_branch', true) = 'on' THEN
    NULL; -- trusted caller: register_branch (SECURITY DEFINER) pre-validates
  ELSIF is_pos_admin() THEN
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

-- ============ 7. guard_user_role_changes: register_branch bypass ============
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
  v_register boolean;
BEGIN
  SELECT role, branch_id INTO v_caller_role, v_caller_branch
  FROM public.users WHERE id = auth.uid();

  v_bypass := COALESCE(current_setting('app.login_guard_bypass', true), '') = 'on';
  v_register := COALESCE(current_setting('app.register_branch', true), '') = 'on';

  -- Self-service registration: register_branch (SECURITY DEFINER) owns the whole
  -- user row (owner account for the freshly created branch).
  IF v_register THEN
    RETURN NEW;
  END IF;

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

-- ============ 8. register_branch: anon self-service signup ============
CREATE OR REPLACE FUNCTION public.register_branch(
  p_store_name text,
  p_owner_name text,
  p_email text,
  p_password text,
  p_store_name_en text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_currency text DEFAULT 'EGP'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
  v_warehouse_id uuid;
  v_user_id uuid;
  v_email text;
  v_global_tax numeric(5,2);
  v_global_tax_enabled boolean;
  v_global_currency text;
  v_res jsonb;
BEGIN
  BEGIN
    v_email := lower(btrim(p_email));
    IF v_email = '' OR v_email !~ '@' OR v_email !~ '.' THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_EMAIL');
    END IF;
    IF p_password IS NULL OR length(p_password) < 6 THEN
      RETURN jsonb_build_object('success', false, 'error', 'WEAK_PASSWORD');
    END IF;
    IF btrim(coalesce(p_store_name, '')) = '' THEN
      RETURN jsonb_build_object('success', false, 'error', 'MISSING_STORE_NAME');
    END IF;

    IF EXISTS (SELECT 1 FROM auth.users WHERE email = v_email)
       OR EXISTS (SELECT 1 FROM public.users WHERE email = v_email) THEN
      RETURN jsonb_build_object('success', false, 'error', 'EMAIL_TAKEN');
    END IF;

    INSERT INTO public.branches (name, name_en, address, phone, is_active)
    VALUES (p_store_name, p_store_name_en, p_address, p_phone, true)
    RETURNING id INTO v_branch_id;

    INSERT INTO public.warehouses (name, branch_id, is_active)
    VALUES (p_store_name || ' - Main', v_branch_id, true)
    RETURNING id INTO v_warehouse_id;

    SELECT COALESCE(tax_rate, 15), COALESCE(tax_enabled, true), COALESCE(currency, 'EGP')
    INTO v_global_tax, v_global_tax_enabled, v_global_currency
    FROM public.settings ORDER BY id LIMIT 1;

    INSERT INTO public.branch_settings (branch_id, tax_rate, tax_enabled, currency, low_stock_threshold)
    VALUES (v_branch_id, v_global_tax, v_global_tax_enabled,
      COALESCE(NULLIF(btrim(p_currency), ''), v_global_currency), 10);

    INSERT INTO public.branch_subscriptions (branch_id, status, trial_starts_at, trial_ends_at)
    VALUES (v_branch_id, 'trial', now(), now() + interval '14 days');

    -- Provision the owner auth account (email confirmed) inside the same
    -- transaction. register_branch owns the whole row, so the guard bypasses.
    PERFORM set_config('app.register_branch', 'on', true);
    v_res := public.create_user(v_email, p_password, p_owner_name, 'owner', v_branch_id, true, NULL);
    PERFORM set_config('app.register_branch', 'off', true);

    IF NOT COALESCE((v_res->>'success')::boolean, false) THEN
      RAISE EXCEPTION 'USER_CREATE_FAILED: %', coalesce(v_res->>'error', 'UNKNOWN');
    END IF;
    v_user_id := (v_res->>'user_id')::uuid;

    RETURN jsonb_build_object('success', true,
      'branch_id', v_branch_id, 'warehouse_id', v_warehouse_id,
      'user_id', v_user_id, 'trial_days', 14);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'REGISTRATION_FAILED', 'detail', SQLERRM);
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_branch(text, text, text, text, text, text, text, text)
  TO anon, authenticated, service_role;

-- ============ 9. process_sale: subscription gate on the exact 047 body ============
-- The 19-arg overload from 038/045 is dropped first (matching 047); the single
-- 20-arg implementation below keeps the same call shape plus p_guest_count.
DROP FUNCTION IF EXISTS public.process_sale(
  text, uuid, uuid, uuid, uuid, numeric, numeric, text, numeric, numeric,
  numeric, numeric, text, text, jsonb, uuid, text, uuid, uuid);

CREATE OR REPLACE FUNCTION public.process_sale(p_invoice_number text, p_branch_id uuid, p_warehouse_id uuid, p_customer_id uuid, p_salesperson_id uuid, p_subtotal numeric, p_discount_amount numeric, p_discount_type text, p_tax_amount numeric, p_bonus_amount numeric, p_total numeric, p_paid_amount numeric, p_payment_method text, p_status text, p_items jsonb, p_shift_id uuid DEFAULT NULL::uuid, p_order_type text DEFAULT 'takeaway', p_table_id uuid DEFAULT NULL::uuid, p_order_id uuid DEFAULT NULL::uuid, p_guest_count integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sale_id uuid;
  v_user_branch uuid;
  v_role text;
  v_shift_id uuid;
  v_item jsonb;
  v_product_id uuid;
  v_quantity numeric(14,4);
  v_unit_price numeric(12,2);
  v_discount_amount numeric(14,2);
  v_bonus_quantity numeric(14,4);
  v_item_total numeric(14,2);
  v_warehouse_ids uuid[];
  v_available numeric(14,4);
  v_res jsonb;
  v_short numeric(14,4);
  v_cogs_total numeric(14,2) := 0;
  v_subtotal numeric(14,2) := 0;
  v_discount numeric(14,2);
  v_tax numeric(14,2) := 0;
  v_tax_enabled boolean;
  v_tax_rate numeric(14,2);
  v_total numeric(14,2);
  v_paid numeric(14,2);
  v_ar numeric(14,2);
  v_lines jsonb := '[]'::jsonb;
  v_dr numeric(14,2) := 0;
  v_cr numeric(14,2) := 0;
  v_diff numeric(14,2);
  v_balance_account text;
  v_order_table uuid;
BEGIN
  BEGIN
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'EMPTY_CART');
    END IF;

    -- Subscription gate: only super_admin may sell on an expired / non-active
    -- subscription. Owners manage plans from the console but do not bypass.
    IF NOT EXISTS (
      SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'super_admin'
    ) AND public.subscription_expired(p_branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'SUBSCRIPTION_EXPIRED',
        'subscription', public.subscription_status(p_branch_id));
    END IF;

    SELECT role, branch_id INTO v_role, v_user_branch FROM public.users WHERE id = auth.uid();

    -- Branch isolation (mirror of RLS on sales)
    IF NOT is_pos_admin() THEN
      IF v_user_branch IS NOT NULL AND v_user_branch <> p_branch_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    -- Origin table must belong to the sale branch
    IF p_table_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.dining_tables WHERE id = p_table_id AND branch_id = p_branch_id
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'TABLE_NOT_IN_BRANCH', 'table_id', p_table_id);
    END IF;

    -- Shift enforcement for register operators
    IF v_role = 'cashier' AND NOT is_pos_admin() THEN
      IF p_shift_id IS NULL THEN
        SELECT id INTO v_shift_id
        FROM shifts
        WHERE cashier_id = auth.uid() AND branch_id = p_branch_id AND status = 'open'
        ORDER BY opened_at DESC LIMIT 1;
      ELSE
        IF NOT EXISTS (
          SELECT 1 FROM shifts
          WHERE id = p_shift_id AND cashier_id = auth.uid() AND branch_id = p_branch_id AND status = 'open'
        ) THEN
          RETURN jsonb_build_object('success', false, 'error', 'NO_OPEN_SHIFT',
            'detail', 'Open a shift before selling. The sale was not created.');
        END IF;
        v_shift_id := p_shift_id;
      END IF;

      IF v_shift_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_OPEN_SHIFT',
          'detail', 'Open a shift before selling. The sale was not created.');
      END IF;
    END IF;

    -- ===== VALIDATE the linked order BEFORE any writes =====
    -- FOUND (not the table value) is what matters: a held takeaway/delivery
    -- order legitimately has table_id = NULL and must still be payable. Any
    -- RETURN here is safe because nothing has been written yet.
    IF p_order_id IS NOT NULL THEN
      SELECT table_id INTO v_order_table
      FROM public.orders
      WHERE id = p_order_id AND branch_id = p_branch_id AND status IN ('open', 'held');

      IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND',
          'detail', 'The order must exist, belong to this branch, and be open or held. No sale was created.');
      END IF;
    END IF;

    -- Stock deduction scope: all active warehouses of the branch
    SELECT array_agg(id) INTO v_warehouse_ids
    FROM warehouses WHERE branch_id = p_branch_id AND is_active = true;

    -- ===== VALIDATION PHASE: check every item BEFORE writing anything =====
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
      IF v_quantity <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUANTITY', 'product_id', v_product_id);
      END IF;

      IF NOT EXISTS (SELECT 1 FROM products WHERE id = v_product_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_FOUND', 'product_id', v_product_id);
      END IF;

      -- Branch ownership: the product must belong to the sale branch
      IF NOT EXISTS (
        SELECT 1 FROM products WHERE id = v_product_id AND branch_id = p_branch_id
      ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_IN_BRANCH',
          'product_id', v_product_id, 'branch_id', p_branch_id);
      END IF;

      SELECT COALESCE(SUM(quantity), 0) INTO v_available
      FROM inventory_batches
      WHERE product_id = v_product_id AND warehouse_id = ANY(v_warehouse_ids);
      IF v_available < v_quantity THEN
        RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_STOCK',
          'product_id', v_product_id, 'required', v_quantity, 'available', v_available);
      END IF;

      -- Accumulate the authoritative subtotal (catalog price, clamped discount)
      SELECT COALESCE(sale_price, 0) INTO v_unit_price FROM products WHERE id = v_product_id;
      v_discount_amount := GREATEST(COALESCE((v_item->>'discount_amount')::numeric, 0), 0);
      IF v_discount_amount > v_quantity * v_unit_price THEN
        v_discount_amount := v_quantity * v_unit_price;
      END IF;
      v_subtotal := v_subtotal + ROUND(v_quantity * v_unit_price - v_discount_amount, 2);
    END LOOP;

    -- ===== SERVER-SIDE HEADER TOTALS (computed from authoritative prices) =====
    v_discount := GREATEST(COALESCE(p_discount_amount, 0), 0);
    IF v_discount > v_subtotal THEN v_discount := v_subtotal; END IF;
    SELECT COALESCE(tax_enabled, false), COALESCE(tax_rate, 0) INTO v_tax_enabled, v_tax_rate
    FROM public.settings LIMIT 1;
    IF v_tax_enabled THEN
      v_tax := ROUND((v_subtotal - v_discount) * v_tax_rate / 100, 2);
    END IF;
    v_total := ROUND(v_subtotal - v_discount + v_tax, 2);
    v_paid := ROUND(GREATEST(COALESCE(p_paid_amount, 0), 0), 2);
    v_ar := ROUND(GREATEST(v_total - v_paid, 0), 2);

    -- ===== WRITE PHASE 1: sale header (authoritative totals) =====
    INSERT INTO sales (invoice_number, branch_id, warehouse_id, customer_id, cashier_id, salesperson_id,
      subtotal, discount_amount, discount_type, tax_amount, bonus_amount, total, paid_amount, payment_method, status, order_type, table_id, guest_count)
    VALUES (p_invoice_number, p_branch_id, p_warehouse_id, p_customer_id, auth.uid(), p_salesperson_id,
      v_subtotal, v_discount, p_discount_type, v_tax, COALESCE(p_bonus_amount, 0),
      v_total, v_paid, p_payment_method, p_status, COALESCE(p_order_type, 'takeaway'), p_table_id, p_guest_count)
    RETURNING id INTO v_sale_id;

    -- ===== WRITE PHASE 2: items + FIFO stock deduction + ledger =====
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
      v_discount_amount := GREATEST(COALESCE((v_item->>'discount_amount')::numeric, 0), 0);

      SELECT sale_price INTO v_unit_price FROM products WHERE id = v_product_id;
      v_unit_price := COALESCE(v_unit_price, 0);
      IF v_discount_amount > v_quantity * v_unit_price THEN
        v_discount_amount := v_quantity * v_unit_price;
      END IF;
      v_bonus_quantity := COALESCE((v_item->>'bonus_quantity')::numeric, 0);
      v_item_total := ROUND(v_quantity * v_unit_price - v_discount_amount, 2);

      INSERT INTO sale_items (sale_id, product_id, unit_name, quantity, unit_price, discount_amount, bonus_quantity, total)
      VALUES (v_sale_id, v_product_id, COALESCE(v_item->>'unit_name', 'piece'),
        v_quantity, v_unit_price, v_discount_amount, v_bonus_quantity, v_item_total);

      v_res := public._product_inv_remove_fifo(v_product_id, NULL, p_branch_id, v_quantity,
        'sale', 'sale', v_sale_id, p_invoice_number, auth.uid());
      v_short := (v_res->>'shortage')::numeric;
      IF v_short > 0 THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: product % needs % but only % available',
          v_product_id, v_quantity, (v_quantity - v_short);
      END IF;
      v_cogs_total := v_cogs_total + COALESCE((v_res->>'total_cost')::numeric, 0);
    END LOOP;

    -- ===== WRITE PHASE 2b: settle the linked order + free tables atomically =====
    -- H4: only free a table when NO other open/held order still references it.
    -- H3: a direct dine-in sale (no linked order) frees its origin table here,
    --     inside the sale transaction, instead of client-side afterwards.
    IF p_order_id IS NOT NULL THEN
      UPDATE public.orders SET status = 'completed', completed_at = now(), updated_at = now()
      WHERE id = p_order_id;
      -- NULL table (held takeaway/delivery) has no table to free.
      IF v_order_table IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.orders
        WHERE table_id = v_order_table AND status IN ('open', 'held') AND id <> p_order_id
      ) THEN
        UPDATE public.dining_tables SET status = 'vacant', updated_at = now()
        WHERE id = v_order_table;
      END IF;
    ELSIF p_table_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.orders
      WHERE table_id = p_table_id AND status IN ('open', 'held')
    ) THEN
      UPDATE public.dining_tables SET status = 'vacant', updated_at = now()
      WHERE id = p_table_id;
    END IF;

    -- ===== WRITE PHASE 3: log the sale into the active shift =====
    IF v_shift_id IS NOT NULL THEN
      INSERT INTO shift_operations (shift_id, operation_type, amount, payment_method, reference_type, reference_id, created_by)
      VALUES (v_shift_id, 'sale', v_paid, p_payment_method, 'sale', v_sale_id, auth.uid());
    END IF;

    -- ===== WRITE PHASE 4: post the sales + COGS journal entry =====
    IF v_paid > 0 THEN
      v_balance_account := CASE WHEN COALESCE(p_payment_method, 'cash') = 'cash' THEN 'cash' ELSE 'bank' END;
      v_lines := v_lines || jsonb_build_object('account_key', v_balance_account,
        'debit', v_paid, 'credit', 0, 'note', p_invoice_number);
      v_dr := v_dr + v_paid;
    END IF;
    IF v_ar > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'ar',
        'debit', v_ar, 'credit', 0, 'customer_id', p_customer_id, 'note', p_invoice_number);
      v_dr := v_dr + v_ar;
    END IF;
    IF v_discount > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'discount_given', 'debit', v_discount, 'credit', 0);
      v_dr := v_dr + v_discount;
    END IF;
    IF v_subtotal > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'revenue', 'debit', 0, 'credit', v_subtotal);
      v_cr := v_cr + v_subtotal;
    END IF;
    IF v_tax > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'vat_payable', 'debit', 0, 'credit', v_tax);
      v_cr := v_cr + v_tax;
    END IF;
    IF v_cogs_total > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'cogs', 'debit', v_cogs_total, 'credit', 0);
      v_lines := v_lines || jsonb_build_object('account_key', 'inventory_fg', 'debit', 0, 'credit', v_cogs_total);
      v_dr := v_dr + v_cogs_total;
      v_cr := v_cr + v_cogs_total;
    END IF;

    -- Balance any rounding/frontend discrepancy on the discount account so a
    -- posted entry is always balanced (normally the difference is zero).
    v_diff := round(v_dr - v_cr, 2);
    IF v_diff <> 0 THEN
      IF v_diff > 0 THEN
        v_lines := v_lines || jsonb_build_object('account_key', 'discount_given', 'debit', 0, 'credit', v_diff);
      ELSE
        v_lines := v_lines || jsonb_build_object('account_key', 'discount_given', 'debit', -v_diff, 'credit', 0);
      END IF;
    END IF;

    PERFORM public._post_journal_entry(p_branch_id, 'sale', v_sale_id, p_invoice_number,
      'فاتورة مبيعات ' || p_invoice_number, v_lines);

    RETURN jsonb_build_object('success', true, 'sale_id', v_sale_id, 'invoice_number', p_invoice_number,
      'cogs', v_cogs_total);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'INSUFFICIENT_STOCK%' THEN
      RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_STOCK', 'detail', SQLERRM);
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.process_sale(text, uuid, uuid, uuid, uuid, numeric, numeric, text, numeric, numeric, numeric, numeric, text, text, jsonb, uuid, text, uuid, uuid, integer) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
