-- ============================================================================
-- 20260821000000_branch_management_phase2.sql
--
-- Phase 2: Branch Management
--   1. create_organization_branch()  – atomic branch + warehouse + settings + subscription
--   2. update_branch()               – update branch metadata (organization_id immutable)
--   3. deactivate_branch()           – soft-disable; no data deletion
--   4. assert_branch_active()        – trigger guard: blocks new transactions on disabled branches
--   5. Updated RLS on branches       – org-aware policies with legacy fallback
--   6. Backfill organization_id for CI fixture branches
--
-- Security:
--   - All RPCs are SECURITY DEFINER with SET search_path = public
--   - Every RPC explicitly verifies caller's org membership
--   - organization_id is NEVER accepted as an update parameter
--   - Branch deactivation is soft-only; historical data is preserved
-- ============================================================================

-- ============ 1. create_organization_branch ============

CREATE OR REPLACE FUNCTION public.create_organization_branch(
  p_organization_id uuid,
  p_name text,
  p_name_en text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_phone text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
  v_warehouse_id uuid;
  v_global_tax numeric(5,2);
  v_global_tax_enabled boolean;
  v_global_currency text;
BEGIN
  -- Verify caller has org access
  IF NOT public.user_can_access_organization(p_organization_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN');
  END IF;

  -- Verify caller is owner/admin of the org (or super_admin)
  IF NOT public.is_pos_admin() AND NOT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = p_organization_id
      AND user_id = auth.uid()
      AND membership_role IN ('owner', 'admin')
      AND is_active
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_ORG_ADMIN');
  END IF;

  IF btrim(coalesce(p_name, '')) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'MISSING_BRANCH_NAME');
  END IF;

  -- Create branch (organization_id is set here, never updated later)
  INSERT INTO public.branches (name, name_en, address, phone, is_active, organization_id)
  VALUES (p_name, p_name_en, p_address, p_phone, true, p_organization_id)
  RETURNING id INTO v_branch_id;

  -- Create main warehouse
  INSERT INTO public.warehouses (name, branch_id, is_active)
  VALUES (p_name || ' - Main', v_branch_id, true)
  RETURNING id INTO v_warehouse_id;

  -- Inherit global settings defaults
  SELECT COALESCE(tax_rate, 15), COALESCE(tax_enabled, true), COALESCE(currency, 'EGP')
  INTO v_global_tax, v_global_tax_enabled, v_global_currency
  FROM public.settings ORDER BY id LIMIT 1;

  INSERT INTO public.branch_settings (branch_id, tax_rate, tax_enabled, currency, low_stock_threshold)
  VALUES (v_branch_id, v_global_tax, v_global_tax_enabled, v_global_currency, 10);

  -- Create trial subscription
  INSERT INTO public.branch_subscriptions (branch_id, status, trial_starts_at, trial_ends_at)
  VALUES (v_branch_id, 'trial', now(), now() + interval '14 days');

  RETURN jsonb_build_object(
    'success', true,
    'branch_id', v_branch_id,
    'warehouse_id', v_warehouse_id
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'BRANCH_CREATE_FAILED', 'detail', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_organization_branch(uuid, text, text, text, text)
  TO authenticated;

-- ============ 2. update_branch ============

CREATE OR REPLACE FUNCTION public.update_branch(
  p_branch_id uuid,
  p_name text DEFAULT NULL,
  p_name_en text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_is_active boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT organization_id INTO v_org_id FROM public.branches WHERE id = p_branch_id;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_NOT_FOUND');
  END IF;

  IF NOT public.user_can_access_organization(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN');
  END IF;

  -- organization_id is NEVER updated through this RPC
  UPDATE public.branches SET
    name      = COALESCE(p_name, name),
    name_en   = COALESCE(p_name_en, name_en),
    address   = COALESCE(p_address, address),
    phone     = COALESCE(p_phone, phone),
    is_active = COALESCE(p_is_active, is_active)
  WHERE id = p_branch_id;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'BRANCH_UPDATE_FAILED', 'detail', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_branch(uuid, text, text, text, text, boolean)
  TO authenticated;

-- ============ 3. deactivate_branch ============

CREATE OR REPLACE FUNCTION public.deactivate_branch(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT organization_id INTO v_org_id FROM public.branches WHERE id = p_branch_id;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_NOT_FOUND');
  END IF;

  IF NOT public.user_can_access_organization(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN');
  END IF;

  -- Soft-disable only; no data is deleted; history and reports preserved
  UPDATE public.branches SET is_active = false WHERE id = p_branch_id;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'BRANCH_DEACTIVATE_FAILED', 'detail', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.deactivate_branch(uuid) TO authenticated;

-- ============ 4. assert_branch_active trigger guard ============
-- Blocks new operational transactions (sales, purchases, shifts) on deactivated
-- branches. Historical data is never modified or deleted.

CREATE OR REPLACE FUNCTION public.assert_branch_active()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.branches
    WHERE id = NEW.branch_id AND is_active = false
  ) THEN
    RAISE EXCEPTION 'BRANCH_INACTIVE: Cannot create transactions in a deactivated branch';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_branch_active_guard_sales ON public.sales;
CREATE TRIGGER trg_branch_active_guard_sales
  BEFORE INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.assert_branch_active();

DROP TRIGGER IF EXISTS trg_branch_active_guard_purchases ON public.purchases;
CREATE TRIGGER trg_branch_active_guard_purchases
  BEFORE INSERT ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.assert_branch_active();

DROP TRIGGER IF EXISTS trg_branch_active_guard_shifts ON public.shifts;
CREATE TRIGGER trg_branch_active_guard_shifts
  BEFORE INSERT ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.assert_branch_active();

-- ============ 5. Updated RLS on branches ============
-- Org-aware policies with legacy fallback for branches without organization_id.
--
-- NOTE: policies use is_platform_admin() (super_admin only) NOT is_pos_admin(),
-- because is_pos_admin() includes org owners. In the multi-tenant model an
-- owner of org A must NOT see/manage org B's branches.
-- SELECT: platform admins see all; org members see their org's branches;
--         legacy branches (org_id IS NULL) visible to branch owner via get_branch_id().
-- INSERT: platform-admin-only (creation happens through RPCs).
-- UPDATE: platform admins OR org members for their org; legacy fallback via id.
-- DELETE: platform-admin-only.

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
      AND users.is_active
      AND users.role = 'super_admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;

DROP POLICY IF EXISTS auth_select_branches ON public.branches;
CREATE POLICY auth_select_branches ON public.branches
  FOR SELECT TO authenticated
  USING (
    public.is_platform_admin()
    OR organization_id IN (SELECT public.user_organization_ids())
    OR (organization_id IS NULL AND id = public.get_branch_id())
  );

DROP POLICY IF EXISTS auth_insert_branches ON public.branches;
CREATE POLICY auth_insert_branches ON public.branches
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS auth_update_branches ON public.branches;
CREATE POLICY auth_update_branches ON public.branches
  FOR UPDATE TO authenticated
  USING (
    public.is_platform_admin()
    OR organization_id IN (SELECT public.user_organization_ids())
    OR (organization_id IS NULL AND id = public.get_branch_id())
  )
  WITH CHECK (
    public.is_platform_admin()
    OR organization_id IN (SELECT public.user_organization_ids())
    OR (organization_id IS NULL AND id = public.get_branch_id())
  );

DROP POLICY IF EXISTS auth_delete_branches ON public.branches;
CREATE POLICY auth_delete_branches ON public.branches
  FOR DELETE TO authenticated
  USING (public.is_platform_admin());

-- ============ 6. Prevent organization_id change via direct UPDATE ============
-- Guard against moving a branch to another tenant via a direct UPDATE statement.
-- RPCs set organization_id at creation time; UPDATE path never touches it.

CREATE OR REPLACE FUNCTION public.guard_branch_org_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.organization_id IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'ORG_CHANGE_FORBIDDEN: organization_id is immutable after creation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_branch_org ON public.branches;
CREATE TRIGGER trg_guard_branch_org
  BEFORE UPDATE ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.guard_branch_org_immutable();
