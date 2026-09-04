-- Migration 089: Waste Center — independent waste tracking
-- Tables: waste_entries, waste_categories
-- RPCs: create_waste_entry, approve_waste, get_waste_report

-- ======================================================================
-- 1. Waste categories (lookup)
-- ======================================================================
CREATE TABLE IF NOT EXISTS public.waste_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  name_en     text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.waste_categories (name, name_en) VALUES
  ('هالك مraw', 'Raw Material Waste'),
  ('هالك منتج', 'Finished Goods Waste'),
  ('هالك إنتاج', 'Production Waste'),
  ('منتهي الصلاحية', 'Expired'),
  ('تالف', 'Damaged')
ON CONFLICT (name) DO NOTHING;

-- ======================================================================
-- 2. Waste entries
-- ======================================================================
CREATE TABLE IF NOT EXISTS public.waste_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id         uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  waste_category_id uuid NOT NULL REFERENCES public.waste_categories(id),
  waste_type        text NOT NULL
                      CHECK (waste_type IN ('raw_material','finished_good','production','expired','damaged')),
  raw_material_id   uuid REFERENCES public.raw_materials(id) ON DELETE SET NULL,
  inventory_unit_id uuid REFERENCES public.inventory_units(id) ON DELETE SET NULL,
  product_id        uuid REFERENCES public.products(id) ON DELETE SET NULL,
  quantity          numeric(14,4) NOT NULL DEFAULT 1,
  unit_cost         numeric(12,2) NOT NULL DEFAULT 0,
  total_cost        numeric(14,2) GENERATED ALWAYS AS (quantity * unit_cost) STORED,
  reason            text,
  warehouse_id      uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
  employee_id       uuid,
  approved_by       uuid,
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','approved','rejected')),
  approved_at       timestamptz,
  rejection_reason  text,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.waste_entries IS 'Independent waste tracking for raw materials, finished goods, and production waste.';

CREATE TRIGGER waste_entries_updated_at
  BEFORE UPDATE ON public.waste_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ======================================================================
-- 3. RLS
-- ======================================================================
ALTER TABLE public.waste_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waste_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY wc_admin_all ON public.waste_categories
  FOR ALL USING (is_pos_admin());
CREATE POLICY wc_select ON public.waste_categories
  FOR SELECT USING (true);

CREATE POLICY we_admin_all ON public.waste_entries
  FOR ALL USING (is_pos_admin());
CREATE POLICY we_branch_read ON public.waste_entries
  FOR SELECT USING (branch_id = public.get_branch_id());

-- ======================================================================
-- 4. Indexes
-- ======================================================================
CREATE INDEX idx_waste_entries_branch ON public.waste_entries(branch_id);
CREATE INDEX idx_waste_entries_type ON public.waste_entries(waste_type);
CREATE INDEX idx_waste_entries_status ON public.waste_entries(status);
CREATE INDEX idx_waste_entries_date ON public.waste_entries(created_at);
CREATE INDEX idx_waste_entries_category ON public.waste_entries(waste_category_id);

-- ======================================================================
-- 5. RPC: create_waste_entry
-- ======================================================================
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
  v_id uuid;
BEGIN
  IF p_waste_type NOT IN ('raw_material','finished_good','production','expired','damaged') THEN
    RAISE EXCEPTION 'Invalid waste_type: %', p_waste_type;
  END IF;

  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Waste quantity must be positive';
  END IF;

  v_id := gen_random_uuid();

  INSERT INTO public.waste_entries (
    id, branch_id, waste_category_id, waste_type,
    raw_material_id, inventory_unit_id, product_id,
    quantity, unit_cost, reason, warehouse_id,
    employee_id, created_by, status
  ) VALUES (
    v_id, p_branch_id, p_waste_category_id, p_waste_type,
    p_raw_material_id, p_inventory_unit_id, p_product_id,
    p_quantity, p_unit_cost, p_reason, p_warehouse_id,
    p_employee_id, auth.uid(), 'pending'
  );

  -- Audit log
  INSERT INTO public.audit_log(user_id, action, entity, entity_id, details)
  VALUES (auth.uid(), 'create', 'waste_entry', v_id,
    jsonb_build_object('waste_type', p_waste_type, 'quantity', p_quantity, 'total_cost', p_quantity * p_unit_cost));

  RETURN v_id;
END;
$$;

-- ======================================================================
-- 6. RPC: approve_waste
-- ======================================================================
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
  v_entry record;
BEGIN
  SELECT * INTO v_entry FROM public.waste_entries WHERE id = p_waste_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Waste entry % not found', p_waste_id;
  END IF;

  IF v_entry.status != 'pending' THEN
    RAISE EXCEPTION 'Waste entry % is not pending (current status: %)', p_waste_id, v_entry.status;
  END IF;

  IF p_approve THEN
    UPDATE public.waste_entries
    SET status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now()
    WHERE id = p_waste_id;

    INSERT INTO public.audit_log(user_id, action, entity, entity_id, details)
    VALUES (auth.uid(), 'approve', 'waste_entry', p_waste_id, jsonb_build_object('status', 'approved'));
  ELSE
    UPDATE public.waste_entries
    SET status = 'rejected', rejection_reason = p_rejection_reason, approved_by = auth.uid(),
        approved_at = now(), updated_at = now()
    WHERE id = p_waste_id;

    INSERT INTO public.audit_log(user_id, action, entity, entity_id, details)
    VALUES (auth.uid(), 'reject', 'waste_entry', p_waste_id,
      jsonb_build_object('status', 'rejected', 'reason', p_rejection_reason));
  END IF;
END;
$$;

-- ======================================================================
-- 7. RPC: get_waste_report
-- ======================================================================
CREATE OR REPLACE FUNCTION public.get_waste_report(
  p_branch_id uuid DEFAULT public.get_branch_id(),
  p_from_date date DEFAULT (CURRENT_DATE - INTERVAL '30 days'),
  p_to_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  waste_category text,
  waste_type text,
  total_quantity numeric,
  total_cost numeric,
  entry_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    wc.name AS waste_category,
    we.waste_type,
    SUM(we.quantity) AS total_quantity,
    SUM(we.total_cost) AS total_cost,
    COUNT(*)::bigint AS entry_count
  FROM public.waste_entries we
  JOIN public.waste_categories wc ON wc.id = we.waste_category_id
  WHERE we.branch_id = p_branch_id
    AND we.status = 'approved'
    AND we.created_at >= p_from_date
    AND we.created_at < (p_to_date + INTERVAL '1 day')
  GROUP BY wc.name, we.waste_type
  ORDER BY SUM(we.total_cost) DESC;
END;
$$;

-- ======================================================================
-- 8. Grants
-- ======================================================================
GRANT SELECT ON public.waste_categories TO authenticated;
GRANT SELECT ON public.waste_entries TO authenticated;
GRANT INSERT, UPDATE ON public.waste_entries TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_waste_entry(uuid, uuid, text, numeric, numeric, text, uuid, uuid, uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_waste(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_waste_report(uuid, date, date) TO authenticated;
