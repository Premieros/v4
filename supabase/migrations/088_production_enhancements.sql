-- Migration 088: Production enhancements — recipe versioning + inventory unit production
-- Adds: recipe versioning, production RPCs for inventory_units, yield tracking

-- ======================================================================
-- 1. Recipe versioning
-- ======================================================================
ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.recipes.version IS 'Recipe version number. Increment when formula changes.';
COMMENT ON COLUMN public.recipes.is_active IS 'Only one active version per product at a time.';

-- ======================================================================
-- 2. Production orders for inventory_units
-- ======================================================================
CREATE TABLE IF NOT EXISTS public.inventory_unit_productions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id         uuid NOT NULL REFERENCES public.inventory_units(id) ON DELETE CASCADE,
  branch_id       uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  warehouse_id    uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  quantity        numeric(14,4) NOT NULL DEFAULT 1,
  status          text NOT NULL DEFAULT 'planned'
                    CHECK (status IN ('planned','in_progress','completed','cancelled')),
  total_cost      numeric(12,2) NOT NULL DEFAULT 0,
  planned_at      date,
  started_at      timestamptz,
  completed_at    timestamptz,
  cancelled_at    timestamptz,
  cancel_reason   text,
  notes           text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.inventory_unit_productions
  IS 'Production runs for inventory_units — manufacture from raw materials via recipes.';

CREATE TRIGGER inventory_unit_productions_updated_at
  BEFORE UPDATE ON public.inventory_unit_productions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ======================================================================
-- 3. RLS
-- ======================================================================
ALTER TABLE public.inventory_unit_productions ENABLE ROW LEVEL SECURITY;

CREATE POLICY iup_admin_all ON public.inventory_unit_productions
  FOR ALL USING (is_pos_admin());
CREATE POLICY iup_branch_read ON public.inventory_unit_productions
  FOR SELECT USING (branch_id = public.get_branch_id());

-- ======================================================================
-- 4. Indexes
-- ======================================================================
CREATE INDEX idx_iup_unit ON public.inventory_unit_productions(unit_id);
CREATE INDEX idx_iup_branch ON public.inventory_unit_productions(branch_id);
CREATE INDEX idx_iup_status ON public.inventory_unit_productions(status);
CREATE INDEX idx_recipes_version ON public.recipes(product_id, version);

-- ======================================================================
-- 5. RPC: produce_inventory_unit
--   Deducts raw materials from inventory, creates batch, records entries
-- ======================================================================
CREATE OR REPLACE FUNCTION public.produce_inventory_unit(
  p_unit_id uuid,
  p_quantity numeric,
  p_warehouse_id uuid,
  p_branch_id uuid DEFAULT public.get_branch_id(),
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_production_id uuid;
  v_total_cost numeric := 0;
  v_recipe record;
  v_rm_qty numeric;
  v_rm_cost numeric;
  v_batch_number text;
BEGIN
  -- Validate unit exists and is manufactured
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_units
    WHERE id = p_unit_id AND unit_type = 'manufactured' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Unit % is not a manufactured active inventory unit', p_unit_id;
  END IF;

  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Production quantity must be positive';
  END IF;

  v_production_id := gen_random_uuid();
  v_batch_number := 'PRD-' || to_char(now(), 'YYYYMMDD-HH24MISS');

  -- Process each recipe ingredient
  FOR v_recipe IN
    SELECT iur.raw_material_id, iur.quantity, iur.wastage_percent, rm.name as rm_name
    FROM public.inventory_unit_recipes iur
    JOIN public.raw_materials rm ON rm.id = iur.raw_material_id
    WHERE iur.unit_id = p_unit_id
  LOOP
    -- Calculate required quantity with wastage
    v_rm_qty := p_quantity * v_recipe.quantity * (1 + v_recipe.wastage_percent / 100);

    -- Get cost from raw_materials.default_cost
    SELECT default_cost INTO v_rm_cost
    FROM public.raw_materials WHERE id = v_recipe.raw_material_id;

    v_total_cost := v_total_cost + (v_rm_qty * COALESCE(v_rm_cost, 0));

    -- Deduct from raw_material_inventory (FIFO)
    PERFORM public.deduct_raw_material_inventory(
      v_recipe.raw_material_id, v_rm_qty, p_branch_id, p_warehouse_id
    );

    -- Record in raw_material_inventory movement
    INSERT INTO public.raw_material_batches (
      raw_material_id, branch_id, warehouse_id, batch_number,
      quantity, unit_cost, expiry_date
    ) VALUES (
      v_recipe.raw_material_id, p_branch_id, p_warehouse_id, v_batch_number,
      -v_rm_qty, COALESCE(v_rm_cost, 0), NULL
    );
  END LOOP;

  -- Create inventory_unit batch (output)
  INSERT INTO public.inventory_unit_batches (
    unit_id, branch_id, warehouse_id, batch_number,
    quantity, unit_cost, production_date
  ) VALUES (
    p_unit_id, p_branch_id, p_warehouse_id, v_batch_number,
    p_quantity, CASE WHEN p_quantity > 0 THEN v_total_cost / p_quantity ELSE 0 END,
    CURRENT_DATE
  );

  -- Record entry in ledger
  INSERT INTO public.inventory_unit_entries (
    unit_id, branch_id, warehouse_id, quantity,
    unit_cost, entry_type, reference_type, reference_id, batch_number
  ) VALUES (
    p_unit_id, p_branch_id, p_warehouse_id, p_quantity,
    CASE WHEN p_quantity > 0 THEN v_total_cost / p_quantity ELSE 0 END,
    'production', 'production', v_production_id, v_batch_number
  );

  -- Create production order record
  INSERT INTO public.inventory_unit_productions (
    id, unit_id, branch_id, warehouse_id, quantity,
    status, total_cost, started_at, completed_at, notes, created_by
  ) VALUES (
    v_production_id, p_unit_id, p_branch_id, p_warehouse_id, p_quantity,
    'completed', v_total_cost, now(), now(), p_notes, auth.uid()
  );

  RETURN v_production_id;
END;
$$;

-- ======================================================================
-- 6. RPC: get_production_variance
--   Compare theoretical vs actual consumption
-- ======================================================================
CREATE OR REPLACE FUNCTION public.get_production_variance(
  p_unit_id uuid,
  p_branch_id uuid DEFAULT public.get_branch_id()
)
RETURNS TABLE (
  raw_material_id uuid,
  raw_material_name text,
  theoretical_qty numeric,
  actual_qty numeric,
  variance numeric,
  variance_pct numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH totals AS (
    SELECT
      iur.raw_material_id,
      rm.name as rm_name,
      iur.quantity AS theoretical_per_unit,
      COALESCE(SUM(iue.quantity) FILTER (WHERE iue.entry_type = 'production'), 0) AS produced_units
    FROM public.inventory_unit_recipes iur
    JOIN public.raw_materials rm ON rm.id = iur.raw_material_id
    LEFT JOIN public.inventory_unit_entries iue
      ON iue.unit_id = iur.unit_id AND iue.entry_type = 'production'
    WHERE iur.unit_id = p_unit_id
    GROUP BY iur.raw_material_id, rm.name, iur.quantity
  )
  SELECT
    t.raw_material_id,
    t.rm_name::text,
    (t.theoretical_per_unit * ABS(t.produced_units))::numeric AS theoretical_qty,
    COALESCE(
      (SELECT ABS(SUM(rm_inv.quantity))
       FROM public.raw_material_batches rm_inv
       WHERE rm_inv.raw_material_id = t.raw_material_id
         AND rm_inv.branch_id = p_branch_id
         AND rm_inv.batch_number LIKE 'PRD-%'),
      0
    )::numeric AS actual_qty,
    (COALESCE(
      (SELECT ABS(SUM(rm_inv.quantity))
       FROM public.raw_material_batches rm_inv
       WHERE rm_inv.raw_material_id = t.raw_material_id
         AND rm_inv.branch_id = p_branch_id
         AND rm_inv.batch_number LIKE 'PRD-%'),
      0
    ) - (t.theoretical_per_unit * ABS(t.produced_units)))::numeric AS variance,
    CASE
      WHEN (t.theoretical_per_unit * ABS(t.produced_units)) > 0
      THEN ROUND(
        ((COALESCE(
          (SELECT ABS(SUM(rm_inv.quantity))
           FROM public.raw_material_batches rm_inv
           WHERE rm_inv.raw_material_id = t.raw_material_id
             AND rm_inv.branch_id = p_branch_id
             AND rm_inv.batch_number LIKE 'PRD-%'),
          0
        ) - (t.theoretical_per_unit * ABS(t.produced_units)))
        / (t.theoretical_per_unit * ABS(t.produced_units)) * 100), 2)
      ELSE 0
    END::numeric AS variance_pct
  FROM totals t;
END;
$$;

-- ======================================================================
-- 7. Grants
-- ======================================================================
GRANT SELECT ON public.inventory_unit_productions TO authenticated;
GRANT INSERT, UPDATE ON public.inventory_unit_productions TO authenticated;
GRANT EXECUTE ON FUNCTION public.produce_inventory_unit(uuid, numeric, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_production_variance(uuid, uuid) TO authenticated;
