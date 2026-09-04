-- ============================================================================
-- 078_register_branch.sql
--
-- Production gap-fill (2026-08-16): the production database was migrated to
-- ~077 objects via a mechanism that did NOT record entries past 048 in
-- public.schema_migrations, and `register_branch` (from 055_subscriptions.sql)
-- was never present. This file adds ONLY that one function, verbatim from 055,
-- without re-running the rest of 055 (which would re-INSERT subscription plan
-- rows, UPDATE branch_subscriptions, and DROP/re-create process_sale).
--
-- Additive-only: creates a single function, touches nothing else.
-- ============================================================================

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
