-- Atomic unit-only sale deduction.
-- Raw materials are consumed only by manufacturing; sales consume inventory units.

CREATE OR REPLACE FUNCTION public.deduct_sale_unit_inventory(
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_items jsonb,
  p_reference_id uuid DEFAULT NULL,
  p_reference_number text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_item jsonb;
  v_product_id uuid;
  v_quantity numeric(14,4);
  v_link record;
  v_batch record;
  v_need numeric(14,4);
  v_take numeric(14,4);
  v_available numeric(14,4);
  v_total_cost numeric(18,4) := 0;
  v_units jsonb := '[]'::jsonb;
  v_user_branch uuid;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('success', true, 'units_deducted', '[]'::jsonb, 'errors', '[]'::jsonb);
  END IF;

  SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
  IF NOT is_pos_admin() AND v_user_branch IS NOT NULL AND v_user_branch <> p_branch_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.sale_unit_need (
    unit_id uuid PRIMARY KEY,
    unit_name text,
    unit_type text,
    required_qty numeric(14,4) NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.sale_unit_need;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
    IF v_quantity <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUANTITY', 'product_id', v_product_id);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = v_product_id AND p.branch_id = p_branch_id AND p.is_active = true
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_IN_BRANCH', 'product_id', v_product_id);
    END IF;

    FOR v_link IN
      SELECT pul.unit_id, pul.quantity, iu.name AS unit_name, iu.unit_type
      FROM public.product_unit_links pul
      JOIN public.inventory_units iu ON iu.id = pul.unit_id
      WHERE pul.product_id = v_product_id
        AND iu.branch_id = p_branch_id
        AND iu.is_active = true
    LOOP
      INSERT INTO pg_temp.sale_unit_need(unit_id, unit_name, unit_type, required_qty)
      VALUES (v_link.unit_id, v_link.unit_name, v_link.unit_type, v_quantity * v_link.quantity)
      ON CONFLICT (unit_id) DO UPDATE
      SET required_qty = pg_temp.sale_unit_need.required_qty + EXCLUDED.required_qty;
    END LOOP;
  END LOOP;

  FOR v_link IN SELECT * FROM pg_temp.sale_unit_need ORDER BY unit_id
  LOOP
    SELECT COALESCE(SUM(quantity), 0) INTO v_available
    FROM public.inventory_unit_batches
    WHERE unit_id = v_link.unit_id
      AND branch_id = p_branch_id
      AND warehouse_id = p_warehouse_id;

    IF v_available < v_link.required_qty THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'INSUFFICIENT_UNIT_STOCK',
        'unit_id', v_link.unit_id,
        'required', v_link.required_qty,
        'available', v_available
      );
    END IF;
  END LOOP;

  FOR v_link IN SELECT * FROM pg_temp.sale_unit_need ORDER BY unit_id
  LOOP
    v_need := v_link.required_qty;
    FOR v_batch IN
      SELECT id, quantity, unit_cost, batch_number
      FROM public.inventory_unit_batches
      WHERE unit_id = v_link.unit_id
        AND branch_id = p_branch_id
        AND warehouse_id = p_warehouse_id
        AND quantity > 0
      ORDER BY created_at ASC, id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_need <= 0;
      v_take := LEAST(v_need, v_batch.quantity);
      UPDATE public.inventory_unit_batches
      SET quantity = quantity - v_take
      WHERE id = v_batch.id;

      INSERT INTO public.inventory_unit_entries(
        unit_id, branch_id, warehouse_id, quantity, unit_cost,
        entry_type, reference_type, reference_id, reference_number,
        batch_number, created_by
      ) VALUES (
        v_link.unit_id, p_branch_id, p_warehouse_id, -v_take, v_batch.unit_cost,
        'sale', 'sale', p_reference_id, p_reference_number,
        v_batch.batch_number, auth.uid()
      );

      v_need := v_need - v_take;
      v_total_cost := v_total_cost + (v_take * COALESCE(v_batch.unit_cost, 0));
    END LOOP;

    v_units := v_units || jsonb_build_object(
      'unit_id', v_link.unit_id,
      'unit_name', v_link.unit_name,
      'unit_type', v_link.unit_type,
      'quantity', v_link.required_qty
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'units_deducted', v_units,
    'raw_materials_deducted', '[]'::jsonb,
    'total_cost', v_total_cost,
    'errors', '[]'::jsonb
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'UNIT_SALE_DEDUCTION_FAILED', 'detail', SQLERRM);
END;
$function$;

REVOKE ALL ON FUNCTION public.deduct_sale_unit_inventory(uuid, uuid, jsonb, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deduct_sale_unit_inventory(uuid, uuid, jsonb, uuid, text) TO authenticated;
