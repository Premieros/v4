-- =============================================================================
-- Operational authorization + multi-branch + approvals + warehouse-aware waste
--
-- Contract:
--   Permission = WHAT the user may do.
--   user_branch_access = WHERE the user may do it.
--   Only super_admin has implicit cross-branch/full-action access.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Action-level permissions and Captain/Cashier templates
-- -----------------------------------------------------------------------------
INSERT INTO public.roles (role, name_ar, name_en, permissions, scope, is_active)
VALUES (
  'captain',
  'كابتن أوردر',
  'Order Captain',
  '["dashboard.view","pos.sell","pos.order.create","pos.order.edit","pos.order.hold","pos.order.send_kitchen","floor_plan.view","products.view","customers.view"]'::jsonb,
  'global',
  true
)
ON CONFLICT (role) DO NOTHING;

-- Managers/owners are templates only. Runtime authorization still comes from
-- the DB permission map; they are not implicit administrators.
UPDATE public.roles
SET permissions = permissions || '[
  "pos.order.create","pos.order.edit","pos.order.hold","pos.order.send_kitchen",
  "pos.order.cancel","pos.payment.collect",
  "pos.approve.discount","pos.approve.reprint","pos.approve.cancel","pos.approve.void",
  "waste.view","waste.create","waste.approve"
]'::jsonb,
updated_at = now()
WHERE role IN ('owner','branch_manager');

-- Cashier is settlement-only: can collect/close payment and operate shifts, but
-- does not create/edit/hold/send orders by default.
UPDATE public.roles
SET permissions = (
  SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
  FROM jsonb_array_elements(permissions) value
  WHERE value #>> '{}' NOT IN (
    'pos.order.create','pos.order.edit','pos.order.hold','pos.order.send_kitchen','pos.order.cancel'
  )
) || '["pos.payment.collect"]'::jsonb,
updated_at = now()
WHERE role = 'cashier';

UPDATE public.roles
SET permissions = permissions || '["waste.view","waste.create"]'::jsonb,
updated_at = now()
WHERE role IN ('warehouse_manager','production_manager');

-- -----------------------------------------------------------------------------
-- 2. Explicit multi-branch access only
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_may_access_branch(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_platform_admin()
    OR (
      p_branch_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.user_branch_access uba
        WHERE uba.user_id = auth.uid()
          AND uba.branch_id = p_branch_id
      )
    );
$$;

REVOKE ALL ON FUNCTION public.user_may_access_branch(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_may_access_branch(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_user_branch_access(p_user_id uuid)
RETURNS TABLE (
  branch_id uuid,
  branch_name text,
  branch_name_en text,
  organization_id uuid,
  is_active boolean,
  grant_source text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id, b.name, b.name_en, b.organization_id, b.is_active, 'explicit'::text
  FROM public.user_branch_access uba
  JOIN public.branches b ON b.id = uba.branch_id
  WHERE uba.user_id = p_user_id
    AND (
      p_user_id = auth.uid()
      OR public.is_platform_admin()
      OR (
        public.can_permission('users.manage')
        AND public.user_may_access_branch(b.id)
      )
    )
  ORDER BY b.name;
$$;

REVOKE ALL ON FUNCTION public.get_user_branch_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_branch_access(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_user_to_branch(p_user_id uuid, p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id AND is_active) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_NOT_FOUND');
  END IF;
  IF NOT public.is_platform_admin() AND (
    NOT public.can_permission('users.manage')
    OR NOT public.user_may_access_branch(p_branch_id)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  INSERT INTO public.user_branch_access(user_id, branch_id)
  VALUES (p_user_id, p_branch_id)
  ON CONFLICT (user_id, branch_id) DO NOTHING;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_user_from_branch(p_user_id uuid, p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT public.is_platform_admin() AND (
    NOT public.can_permission('users.manage')
    OR NOT public.user_may_access_branch(p_branch_id)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  DELETE FROM public.user_branch_access
  WHERE user_id = p_user_id AND branch_id = p_branch_id;

  -- users.branch_id is only a preferred/default branch. Keep it valid when the
  -- removed branch happened to be the current default.
  UPDATE public.users u
  SET branch_id = (
    SELECT uba.branch_id
    FROM public.user_branch_access uba
    WHERE uba.user_id = p_user_id
    ORDER BY uba.created_at, uba.branch_id
    LIMIT 1
  )
  WHERE u.id = p_user_id AND u.branch_id = p_branch_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_user_branch_access(p_user_id uuid, p_branch_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[] := COALESCE(p_branch_ids, ARRAY[]::uuid[]);
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_ids) id
    WHERE NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = id AND b.is_active)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_NOT_FOUND');
  END IF;

  IF NOT public.is_platform_admin() THEN
    IF NOT public.can_permission('users.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
    END IF;
    -- Caller may neither add nor remove a branch they cannot manage.
    IF EXISTS (
      SELECT 1 FROM unnest(v_ids) id
      WHERE NOT public.user_may_access_branch(id)
    ) OR EXISTS (
      SELECT 1 FROM public.user_branch_access uba
      WHERE uba.user_id = p_user_id
        AND NOT public.user_may_access_branch(uba.branch_id)
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
    END IF;
  END IF;

  DELETE FROM public.user_branch_access WHERE user_id = p_user_id;
  INSERT INTO public.user_branch_access(user_id, branch_id)
  SELECT p_user_id, id FROM unnest(v_ids) id
  ON CONFLICT (user_id, branch_id) DO NOTHING;

  UPDATE public.users u
  SET branch_id = CASE
    WHEN u.branch_id = ANY(v_ids) THEN u.branch_id
    ELSE (SELECT id FROM unnest(v_ids) id LIMIT 1)
  END
  WHERE u.id = p_user_id;

  RETURN jsonb_build_object('success', true, 'branch_count', cardinality(v_ids));
END;
$$;

REVOKE ALL ON FUNCTION public.assign_user_to_branch(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_user_from_branch(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_user_branch_access(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_user_to_branch(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_user_from_branch(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_branch_access(uuid, uuid[]) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. POS approval requests: central, permission-controlled approval queue
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pos_approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  order_number text,
  cashier_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  cashier_name text,
  request_type text NOT NULL CHECK (request_type IN ('discount','reprint','cancel','void')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  amount numeric(14,2),
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  approved_by_name text,
  response_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_pos_approvals_branch_status
  ON public.pos_approval_requests(branch_id, status, created_at DESC);

ALTER TABLE public.pos_approval_requests ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_approve_pos_request(p_request_type text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE p_request_type
    WHEN 'discount' THEN public.can_permission('pos.approve.discount')
    WHEN 'reprint'  THEN public.can_permission('pos.approve.reprint')
    WHEN 'cancel'   THEN public.can_permission('pos.approve.cancel')
    WHEN 'void'     THEN public.can_permission('pos.approve.void')
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION public.can_approve_pos_request(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_approve_pos_request(text) TO authenticated;

DROP POLICY IF EXISTS pos_approval_select ON public.pos_approval_requests;
CREATE POLICY pos_approval_select ON public.pos_approval_requests
FOR SELECT TO authenticated
USING (
  public.user_may_access_branch(branch_id)
  AND (
    cashier_id = auth.uid()
    OR public.can_approve_pos_request(request_type)
    OR public.is_platform_admin()
  )
);

DROP POLICY IF EXISTS pos_approval_insert ON public.pos_approval_requests;
CREATE POLICY pos_approval_insert ON public.pos_approval_requests
FOR INSERT TO authenticated
WITH CHECK (
  public.user_may_access_branch(branch_id)
  AND cashier_id = auth.uid()
  AND public.can_permission('pos.sell')
  AND status = 'pending'
);

DROP POLICY IF EXISTS pos_approval_update ON public.pos_approval_requests;
CREATE POLICY pos_approval_update ON public.pos_approval_requests
FOR UPDATE TO authenticated
USING (
  public.user_may_access_branch(branch_id)
  AND public.can_approve_pos_request(request_type)
)
WITH CHECK (
  public.user_may_access_branch(branch_id)
  AND public.can_approve_pos_request(request_type)
);

GRANT SELECT, INSERT, UPDATE ON public.pos_approval_requests TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_pos_approval_response()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'APPROVAL_ALREADY_RESPONDED';
  END IF;
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.cashier_id IS DISTINCT FROM OLD.cashier_id
     OR NEW.request_type IS DISTINCT FROM OLD.request_type
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.metadata IS DISTINCT FROM OLD.metadata THEN
    RAISE EXCEPTION 'APPROVAL_REQUEST_IMMUTABLE';
  END IF;
  IF NEW.status NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'INVALID_APPROVAL_RESPONSE';
  END IF;
  IF NOT public.can_approve_pos_request(OLD.request_type)
     OR NOT public.user_may_access_branch(OLD.branch_id) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  SELECT COALESCE(full_name, username, email) INTO v_name
  FROM public.users WHERE id = auth.uid();
  NEW.approved_by := auth.uid();
  NEW.approved_by_name := COALESCE(v_name, 'Approver');
  NEW.responded_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pos_approval_response ON public.pos_approval_requests;
CREATE TRIGGER trg_pos_approval_response
BEFORE UPDATE ON public.pos_approval_requests
FOR EACH ROW EXECUTE FUNCTION public.guard_pos_approval_response();

REVOKE ALL ON FUNCTION public.guard_pos_approval_response() FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Raw-material batches become warehouse-aware while preserving the existing
--    branch aggregate raw_material_inventory for compatibility.
-- -----------------------------------------------------------------------------
ALTER TABLE public.raw_material_batches
  ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE RESTRICT;

UPDATE public.raw_material_batches b
SET warehouse_id = COALESCE(
  (
    SELECT p.warehouse_id
    FROM public.purchases p
    WHERE p.id = b.source_id
      AND p.branch_id = b.branch_id
      AND p.warehouse_id IS NOT NULL
    LIMIT 1
  ),
  (
    SELECT w.id
    FROM public.warehouses w
    WHERE w.branch_id = b.branch_id AND w.is_active
    ORDER BY w.is_default DESC NULLS LAST, w.created_at, w.id
    LIMIT 1
  )
)
WHERE b.warehouse_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_raw_batches_warehouse
  ON public.raw_material_batches(raw_material_id, branch_id, warehouse_id, expiry_date, created_at);

CREATE OR REPLACE FUNCTION public.resolve_raw_batch_warehouse()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.warehouse_id IS NULL AND NEW.source_id IS NOT NULL THEN
    SELECT p.warehouse_id INTO NEW.warehouse_id
    FROM public.purchases p
    WHERE p.id = NEW.source_id AND p.branch_id = NEW.branch_id;
  END IF;

  IF NEW.warehouse_id IS NULL THEN
    SELECT w.id INTO NEW.warehouse_id
    FROM public.warehouses w
    WHERE w.branch_id = NEW.branch_id AND w.is_active
    ORDER BY w.is_default DESC NULLS LAST, w.created_at, w.id
    LIMIT 1;
  END IF;

  IF NEW.warehouse_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.warehouses w
    WHERE w.id = NEW.warehouse_id AND w.branch_id = NEW.branch_id AND w.is_active
  ) THEN
    RAISE EXCEPTION 'WAREHOUSE_NOT_IN_BRANCH';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_raw_batch_resolve_warehouse ON public.raw_material_batches;
CREATE TRIGGER trg_raw_batch_resolve_warehouse
BEFORE INSERT OR UPDATE OF warehouse_id, branch_id, source_id
ON public.raw_material_batches
FOR EACH ROW EXECUTE FUNCTION public.resolve_raw_batch_warehouse();

-- Warehouse-specific raw-material FIFO used by Waste Center.
CREATE OR REPLACE FUNCTION public._raw_remove_fifo_from_warehouse(
  p_raw_material_id uuid,
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_qty numeric,
  p_entry_type text DEFAULT 'waste',
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_reference_number text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_remaining numeric(14,4) := COALESCE(p_qty, 0);
  v_batch record;
  v_take numeric(14,4);
  v_before numeric(14,4);
  v_after numeric(14,4);
  v_total_cost numeric(18,4) := 0;
  v_removed numeric(14,4) := 0;
  v_total_qty numeric(14,4);
  v_total_value numeric(18,4);
BEGIN
  IF v_remaining <= 0 THEN
    RETURN jsonb_build_object('success', true, 'shortage', 0, 'removed', 0, 'total_cost', 0);
  END IF;

  SELECT COALESCE(quantity, 0) INTO v_before
  FROM public.raw_material_inventory
  WHERE raw_material_id = p_raw_material_id AND branch_id = p_branch_id
  FOR UPDATE;
  v_before := COALESCE(v_before, 0);

  FOR v_batch IN
    SELECT b.id, b.quantity, b.unit_cost, b.batch_number
    FROM public.raw_material_batches b
    WHERE b.raw_material_id = p_raw_material_id
      AND b.branch_id = p_branch_id
      AND b.warehouse_id = p_warehouse_id
      AND b.quantity > 0
    ORDER BY b.expiry_date NULLS LAST, b.created_at, b.id
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_remaining, v_batch.quantity);
    UPDATE public.raw_material_batches
    SET quantity = quantity - v_take
    WHERE id = v_batch.id;

    v_removed := v_removed + v_take;
    v_remaining := v_remaining - v_take;
    v_total_cost := v_total_cost + v_take * COALESCE(v_batch.unit_cost, 0);

    INSERT INTO public.inventory_ledger(
      raw_material_id, branch_id, warehouse_id, batch_number, quantity,
      unit_cost, total_cost, before_qty, after_qty, entry_type,
      reference_type, reference_id, reference_number, created_by
    ) VALUES (
      p_raw_material_id, p_branch_id, p_warehouse_id, v_batch.batch_number, -v_take,
      v_batch.unit_cost, -(v_take * COALESCE(v_batch.unit_cost, 0)),
      v_before - (v_removed - v_take), GREATEST(v_before - v_removed, 0),
      p_entry_type, p_reference_type, p_reference_id, p_reference_number, p_created_by
    );
  END LOOP;

  SELECT COALESCE(SUM(quantity), 0), COALESCE(SUM(quantity * unit_cost), 0)
  INTO v_total_qty, v_total_value
  FROM public.raw_material_batches
  WHERE raw_material_id = p_raw_material_id AND branch_id = p_branch_id;

  UPDATE public.raw_material_inventory
  SET quantity = v_total_qty,
      avg_cost = CASE WHEN v_total_qty > 0 THEN round(v_total_value / v_total_qty, 2) ELSE 0 END,
      updated_at = now()
  WHERE raw_material_id = p_raw_material_id AND branch_id = p_branch_id;

  RETURN jsonb_build_object(
    'success', true,
    'shortage', v_remaining,
    'removed', v_removed,
    'total_cost', v_total_cost
  );
END;
$$;

-- Warehouse-specific inventory-unit FIFO used by Waste Center.
CREATE OR REPLACE FUNCTION public._inventory_unit_remove_fifo(
  p_unit_id uuid,
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_qty numeric,
  p_entry_type text DEFAULT 'waste',
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_reference_number text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_remaining numeric(14,4) := COALESCE(p_qty, 0);
  v_batch record;
  v_take numeric(14,4);
  v_removed numeric(14,4) := 0;
  v_total_cost numeric(18,4) := 0;
BEGIN
  IF v_remaining <= 0 THEN
    RETURN jsonb_build_object('success', true, 'shortage', 0, 'removed', 0, 'total_cost', 0);
  END IF;

  FOR v_batch IN
    SELECT id, quantity, unit_cost, batch_number
    FROM public.inventory_unit_batches
    WHERE unit_id = p_unit_id
      AND branch_id = p_branch_id
      AND warehouse_id = p_warehouse_id
      AND quantity > 0
    ORDER BY expiry_date NULLS LAST, created_at, id
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_remaining, v_batch.quantity);
    UPDATE public.inventory_unit_batches
    SET quantity = quantity - v_take
    WHERE id = v_batch.id;

    INSERT INTO public.inventory_unit_entries(
      unit_id, branch_id, warehouse_id, quantity, unit_cost, entry_type,
      reference_type, reference_id, reference_number, batch_number, created_by
    ) VALUES (
      p_unit_id, p_branch_id, p_warehouse_id, -v_take, v_batch.unit_cost,
      p_entry_type, p_reference_type, p_reference_id, p_reference_number,
      v_batch.batch_number, p_created_by
    );

    v_removed := v_removed + v_take;
    v_remaining := v_remaining - v_take;
    v_total_cost := v_total_cost + v_take * COALESCE(v_batch.unit_cost, 0);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'shortage', v_remaining,
    'removed', v_removed,
    'total_cost', v_total_cost
  );
END;
$$;

REVOKE ALL ON FUNCTION public._raw_remove_fifo_from_warehouse(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._inventory_unit_remove_fifo(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid) FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Waste Center: request first, deduct exactly once on approval
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS we_admin_all ON public.waste_entries;
DROP POLICY IF EXISTS we_branch_read ON public.waste_entries;
DROP POLICY IF EXISTS waste_entries_select ON public.waste_entries;
CREATE POLICY waste_entries_select ON public.waste_entries
FOR SELECT TO authenticated
USING (
  public.user_may_access_branch(branch_id)
  AND (
    public.can_permission('waste.view')
    OR created_by = auth.uid()
  )
);

REVOKE INSERT, UPDATE, DELETE ON public.waste_entries FROM authenticated;

CREATE OR REPLACE FUNCTION public.create_waste_entry(
  p_branch_id uuid,
  p_waste_category_id uuid,
  p_waste_type text,
  p_quantity numeric,
  p_unit_cost numeric,
  p_reason text DEFAULT NULL,
  p_raw_material_id uuid DEFAULT NULL,
  p_inventory_unit_id uuid DEFAULT NULL,
  p_product_id uuid DEFAULT NULL,
  p_warehouse_id uuid DEFAULT NULL,
  p_employee_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT public.user_may_access_branch(p_branch_id) THEN RAISE EXCEPTION 'BRANCH_MISMATCH'; END IF;
  IF NOT public.can_permission('waste.create') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'INVALID_QUANTITY'; END IF;
  IF p_waste_type NOT IN ('raw_material','finished_good','production','expired','damaged') THEN
    RAISE EXCEPTION 'INVALID_WASTE_TYPE';
  END IF;
  IF num_nonnulls(p_raw_material_id, p_inventory_unit_id, p_product_id) <> 1 THEN
    RAISE EXCEPTION 'WASTE_TARGET_REQUIRED';
  END IF;
  IF p_warehouse_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.warehouses w
    WHERE w.id = p_warehouse_id AND w.branch_id = p_branch_id AND w.is_active
  ) THEN
    RAISE EXCEPTION 'WAREHOUSE_NOT_IN_BRANCH';
  END IF;
  IF p_product_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.products p WHERE p.id = p_product_id AND p.branch_id = p_branch_id
  ) THEN RAISE EXCEPTION 'PRODUCT_NOT_IN_BRANCH'; END IF;
  IF p_raw_material_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.raw_materials r
    WHERE r.id = p_raw_material_id AND (r.branch_id = p_branch_id OR r.branch_id IS NULL)
  ) THEN RAISE EXCEPTION 'RAW_MATERIAL_NOT_IN_BRANCH'; END IF;
  IF p_inventory_unit_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.inventory_units u
    WHERE u.id = p_inventory_unit_id AND u.branch_id = p_branch_id
  ) THEN RAISE EXCEPTION 'INVENTORY_UNIT_NOT_IN_BRANCH'; END IF;

  INSERT INTO public.waste_entries(
    id, branch_id, waste_category_id, waste_type,
    raw_material_id, inventory_unit_id, product_id,
    quantity, unit_cost, reason, warehouse_id,
    employee_id, created_by, status
  ) VALUES (
    v_id, p_branch_id, p_waste_category_id, p_waste_type,
    p_raw_material_id, p_inventory_unit_id, p_product_id,
    p_quantity, COALESCE(p_unit_cost,0), p_reason, p_warehouse_id,
    p_employee_id, auth.uid(), 'pending'
  );

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_waste(
  p_waste_id uuid,
  p_approve boolean,
  p_rejection_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry public.waste_entries%ROWTYPE;
  v_res jsonb;
BEGIN
  BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

    SELECT * INTO v_entry
    FROM public.waste_entries
    WHERE id = p_waste_id
    FOR UPDATE;

    IF v_entry.id IS NULL THEN RAISE EXCEPTION 'WASTE_NOT_FOUND'; END IF;
    IF v_entry.status <> 'pending' THEN RAISE EXCEPTION 'WASTE_ALREADY_RESPONDED'; END IF;
    IF NOT public.user_may_access_branch(v_entry.branch_id) THEN RAISE EXCEPTION 'BRANCH_MISMATCH'; END IF;
    IF NOT public.can_permission('waste.approve') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
    IF v_entry.warehouse_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.warehouses w
      WHERE w.id = v_entry.warehouse_id AND w.branch_id = v_entry.branch_id AND w.is_active
    ) THEN RAISE EXCEPTION 'WAREHOUSE_NOT_IN_BRANCH'; END IF;

    IF NOT p_approve THEN
      UPDATE public.waste_entries
      SET status = 'rejected',
          rejection_reason = p_rejection_reason,
          approved_by = auth.uid(),
          approved_at = now(),
          updated_at = now()
      WHERE id = p_waste_id;
      RETURN;
    END IF;

    IF v_entry.product_id IS NOT NULL THEN
      v_res := public._product_inv_remove_fifo(
        v_entry.product_id, v_entry.warehouse_id, v_entry.branch_id, v_entry.quantity,
        'waste', 'waste', v_entry.id, 'WASTE-' || v_entry.id::text, auth.uid()
      );
    ELSIF v_entry.raw_material_id IS NOT NULL THEN
      v_res := public._raw_remove_fifo_from_warehouse(
        v_entry.raw_material_id, v_entry.branch_id, v_entry.warehouse_id, v_entry.quantity,
        'waste', 'waste', v_entry.id, 'WASTE-' || v_entry.id::text, auth.uid()
      );
    ELSIF v_entry.inventory_unit_id IS NOT NULL THEN
      v_res := public._inventory_unit_remove_fifo(
        v_entry.inventory_unit_id, v_entry.branch_id, v_entry.warehouse_id, v_entry.quantity,
        'waste', 'waste', v_entry.id, 'WASTE-' || v_entry.id::text, auth.uid()
      );
    ELSE
      RAISE EXCEPTION 'WASTE_TARGET_REQUIRED';
    END IF;

    IF COALESCE((v_res->>'success')::boolean, false) IS NOT TRUE
       OR COALESCE((v_res->>'shortage')::numeric, 0) > 0 THEN
      RAISE EXCEPTION 'INSUFFICIENT_WAREHOUSE_STOCK';
    END IF;

    UPDATE public.waste_entries
    SET status = 'approved',
        approved_by = auth.uid(),
        approved_at = now(),
        updated_at = now()
    WHERE id = p_waste_id;
  EXCEPTION WHEN OTHERS THEN
    -- The exception block is intentionally inside the function. PostgreSQL
    -- rolls back all mutations performed since BEGIN before re-raising, so a
    -- shortage can never leave a partially deducted waste transaction.
    RAISE;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.create_waste_entry(uuid,uuid,text,numeric,numeric,text,uuid,uuid,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_waste(uuid,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_waste_entry(uuid,uuid,text,numeric,numeric,text,uuid,uuid,uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_waste(uuid,boolean,text) TO authenticated;
