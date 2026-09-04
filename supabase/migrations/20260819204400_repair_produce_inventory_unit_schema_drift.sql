-- Repair migration: restore the canonical production-unit RPC after remote schema drift.
-- raw_material_batches is branch-scoped and does not have warehouse_id.

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

  FOR v_recipe IN
    SELECT iur.raw_material_id, iur.quantity, iur.wastage_percent
    FROM public.inventory_unit_recipes iur
    JOIN public.raw_materials rm ON rm.id = iur.raw_material_id
    WHERE iur.unit_id = p_unit_id
  LOOP
    v_rm_qty := p_quantity * v_recipe.quantity * (1 + v_recipe.wastage_percent / 100);

    SELECT default_cost INTO v_rm_cost
    FROM public.raw_materials
    WHERE id = v_recipe.raw_material_id;

    v_total_cost := v_total_cost + (v_rm_qty * COALESCE(v_rm_cost, 0));

    PERFORM public.deduct_raw_material_inventory(
      v_recipe.raw_material_id, v_rm_qty, p_branch_id, p_warehouse_id
    );

    INSERT INTO public.raw_material_batches (
      raw_material_id, branch_id, batch_number,
      quantity, unit_cost, expiry_date, source_type, source_id
    ) VALUES (
      v_recipe.raw_material_id, p_branch_id, v_batch_number,
      0, COALESCE(v_rm_cost, 0), NULL, 'production_consumption', v_production_id
    );
  END LOOP;

  INSERT INTO public.inventory_unit_batches (
    unit_id, branch_id, warehouse_id, batch_number,
    quantity, unit_cost, production_date
  ) VALUES (
    p_unit_id, p_branch_id, p_warehouse_id, v_batch_number,
    p_quantity,
    CASE WHEN p_quantity > 0 THEN v_total_cost / p_quantity ELSE 0 END,
    CURRENT_DATE
  );

  INSERT INTO public.inventory_unit_entries (
    unit_id, branch_id, warehouse_id, quantity,
    unit_cost, entry_type, reference_type, reference_id, batch_number
  ) VALUES (
    p_unit_id, p_branch_id, p_warehouse_id, p_quantity,
    CASE WHEN p_quantity > 0 THEN v_total_cost / p_quantity ELSE 0 END,
    'production', 'production', v_production_id, v_batch_number
  );

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

GRANT EXECUTE ON FUNCTION public.produce_inventory_unit(uuid, numeric, uuid, uuid, text) TO authenticated;
