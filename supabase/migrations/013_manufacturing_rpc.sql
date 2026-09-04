-- =====================================================================
-- Phase B2: Manufacturing, Warehouse Transfers & Inventory Ledger RPCs
-- =====================================================================
-- Internal FIFO helpers + production/transfer RPCs + rewritten
-- process_purchase / process_sale / process_refund / adjust_stock /
-- adjust_raw_stock, all writing inventory_ledger as the source of truth.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Allow new movement types in the legacy stock_transactions log
-- ---------------------------------------------------------------------
ALTER TABLE public.stock_transactions DROP CONSTRAINT IF EXISTS stock_transactions_transaction_type_check;
ALTER TABLE public.stock_transactions ADD CONSTRAINT stock_transactions_transaction_type_check
  CHECK (transaction_type IN ('sale', 'purchase', 'adjustment', 'refund',
                              'transfer', 'production', 'waste', 'opening'));

-- purchase items must reference exactly one of product or raw material
ALTER TABLE public.purchase_items DROP CONSTRAINT IF EXISTS purchase_items_one_target;
ALTER TABLE public.purchase_items ADD CONSTRAINT purchase_items_one_target
  CHECK (num_nonnulls(product_id, raw_material_id) = 1);

-- ---------------------------------------------------------------------
-- 1. next_document_number: accept any document type
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.next_document_number(p_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_store text;
  v_num   bigint;
BEGIN
  IF p_type IS NULL OR btrim(p_type) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TYPE');
  END IF;

  LOOP
    UPDATE public.document_sequences
       SET next_value = next_value + 1
     WHERE seq_type = p_type
    RETURNING next_value - 1 INTO v_num;
    EXIT WHEN v_num IS NOT NULL;

    -- Counter row missing: create it (first number = 1) and retry.
    INSERT INTO public.document_sequences (seq_type, next_value)
    VALUES (p_type, 2)
    ON CONFLICT (seq_type) DO NOTHING;
  END LOOP;

  SELECT btrim(coalesce(store_name, '')) INTO v_store FROM public.settings LIMIT 1;
  IF v_store IS NULL OR v_store = '' THEN
    v_store := 'POS';
  END IF;

  RETURN jsonb_build_object('success', true, 'number', v_store || '-' || lpad(v_num::text, 5, '0'), 'raw', v_num);
END;
$function$;

-- ---------------------------------------------------------------------
-- 2. Internal helper: add quantity of a finished product
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._product_inv_add(
  p_product_id uuid, p_warehouse_id uuid, p_branch_id uuid, p_qty numeric,
  p_unit_cost numeric DEFAULT 0,
  p_batch_number text DEFAULT NULL,
  p_production_date date DEFAULT NULL,
  p_expiry_date date DEFAULT NULL,
  p_entry_type text DEFAULT 'purchase',
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_reference_number text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_before numeric(14,4);
  v_after numeric(14,4);
  v_batch_no text;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 OR p_warehouse_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_PARAMS');
  END IF;

  v_batch_no := COALESCE(NULLIF(btrim(COALESCE(p_batch_number, '')), ''),
                         'B-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  SELECT COALESCE(quantity, 0) INTO v_before
  FROM public.inventory WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id;
  IF v_before IS NULL THEN v_before := 0; END IF;
  v_after := v_before + p_qty;

  INSERT INTO public.inventory (product_id, warehouse_id, branch_id, quantity, batch_number, production_date, expiry_date, updated_at)
  VALUES (p_product_id, p_warehouse_id, p_branch_id, p_qty, v_batch_no, p_production_date, p_expiry_date, now())
  ON CONFLICT (product_id, warehouse_id)
  DO UPDATE SET quantity = inventory.quantity + EXCLUDED.quantity,
    branch_id = EXCLUDED.branch_id, updated_at = now();

  INSERT INTO public.inventory_batches (product_id, warehouse_id, branch_id, batch_number, quantity, unit_cost, production_date, expiry_date, source_type, source_id)
  VALUES (p_product_id, p_warehouse_id, p_branch_id, v_batch_no, p_qty, COALESCE(p_unit_cost, 0),
          p_production_date, p_expiry_date, COALESCE(p_reference_type, p_entry_type), p_reference_id);

  INSERT INTO public.inventory_ledger (product_id, branch_id, warehouse_id, batch_number, quantity, unit_cost, total_cost, before_qty, after_qty, entry_type, reference_type, reference_id, reference_number, created_by)
  VALUES (p_product_id, p_branch_id, p_warehouse_id, v_batch_no, p_qty, COALESCE(p_unit_cost, 0),
          p_qty * COALESCE(p_unit_cost, 0), v_before, v_after, p_entry_type,
          p_reference_type, p_reference_id, p_reference_number, p_created_by);

  INSERT INTO public.stock_transactions (product_id, warehouse_id, branch_id, transaction_type, component_flow, reference_type, reference_id, quantity, before_quantity, after_quantity, unit_cost, created_by)
  VALUES (p_product_id, p_warehouse_id, p_branch_id, p_entry_type, false,
          COALESCE(p_reference_type, p_entry_type), p_reference_id, p_qty, v_before, v_after,
          COALESCE(p_unit_cost, 0), p_created_by);

  RETURN jsonb_build_object('success', true, 'before_qty', v_before, 'after_qty', v_after, 'batch_number', v_batch_no);
END;
$function$;

-- ---------------------------------------------------------------------
-- 3. Internal helper: remove finished product FIFO (nearest expiry first)
--    p_warehouse_id NULL => consume across all branch warehouses.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._product_inv_remove_fifo(
  p_product_id uuid, p_warehouse_id uuid, p_branch_id uuid, p_qty numeric,
  p_entry_type text DEFAULT 'sale',
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_reference_number text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_remaining numeric(14,4);
  v_batch record;
  v_deduct numeric(14,4);
  v_before numeric(14,4);
  v_after numeric(14,4);
  v_total_cost numeric(14,2) := 0;
  v_total_removed numeric(14,4) := 0;
  v_shortage numeric(14,4) := 0;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RETURN jsonb_build_object('success', true, 'shortage', 0, 'removed', 0, 'total_cost', 0, 'avg_cost', 0);
  END IF;

  v_remaining := p_qty;

  FOR v_batch IN
    SELECT b.id, b.warehouse_id, b.quantity, b.unit_cost, b.batch_number
    FROM public.inventory_batches b
    WHERE b.product_id = p_product_id AND b.quantity > 0 AND b.branch_id = p_branch_id
      AND (p_warehouse_id IS NULL OR b.warehouse_id = p_warehouse_id)
    ORDER BY b.expiry_date NULLS LAST, b.created_at ASC, b.id ASC
    FOR UPDATE
  LOOP
    IF v_remaining <= 0 THEN EXIT; END IF;
    v_deduct := LEAST(v_batch.quantity, v_remaining);

    SELECT COALESCE(quantity, 0) INTO v_before
    FROM public.inventory WHERE product_id = p_product_id AND warehouse_id = v_batch.warehouse_id;
    IF v_before IS NULL THEN v_before := 0; END IF;
    v_after := v_before - v_deduct;
    IF v_after < 0 THEN v_after := 0; END IF;

    UPDATE public.inventory SET quantity = v_after, updated_at = now()
    WHERE product_id = p_product_id AND warehouse_id = v_batch.warehouse_id;
    UPDATE public.inventory_batches SET quantity = quantity - v_deduct WHERE id = v_batch.id;

    INSERT INTO public.inventory_ledger (product_id, branch_id, warehouse_id, batch_number, quantity, unit_cost, total_cost, before_qty, after_qty, entry_type, reference_type, reference_id, reference_number, created_by)
    VALUES (p_product_id, p_branch_id, v_batch.warehouse_id, v_batch.batch_number, -v_deduct,
            v_batch.unit_cost, -v_deduct * v_batch.unit_cost, v_before, v_after, p_entry_type,
            p_reference_type, p_reference_id, p_reference_number, p_created_by);

    INSERT INTO public.stock_transactions (product_id, warehouse_id, branch_id, transaction_type, component_flow, reference_type, reference_id, quantity, before_quantity, after_quantity, unit_cost, created_by)
    VALUES (p_product_id, v_batch.warehouse_id, p_branch_id, p_entry_type, false,
            COALESCE(p_reference_type, p_entry_type), p_reference_id, -v_deduct, v_before, v_after,
            v_batch.unit_cost, p_created_by);

    v_total_cost := v_total_cost + v_deduct * v_batch.unit_cost;
    v_total_removed := v_total_removed + v_deduct;
    v_remaining := v_remaining - v_deduct;
  END LOOP;

  v_shortage := v_remaining;

  RETURN jsonb_build_object('success', true, 'shortage', v_shortage, 'removed', v_total_removed,
    'total_cost', v_total_cost,
    'avg_cost', CASE WHEN v_total_removed > 0 THEN round(v_total_cost / v_total_removed, 2) ELSE 0 END);
END;
$function$;

-- ---------------------------------------------------------------------
-- 4. Internal helper: add raw material quantity (branch-scoped, weighted avg)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._raw_add(
  p_raw_material_id uuid, p_branch_id uuid, p_qty numeric,
  p_unit_cost numeric DEFAULT 0,
  p_batch_number text DEFAULT NULL,
  p_production_date date DEFAULT NULL,
  p_expiry_date date DEFAULT NULL,
  p_entry_type text DEFAULT 'purchase',
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_reference_number text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_inv record;
  v_new_qty numeric(14,4);
  v_new_avg numeric(12,2);
  v_before numeric(14,4) := 0;
  v_after numeric(14,4);
  v_batch_no text;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_PARAMS');
  END IF;

  v_batch_no := COALESCE(NULLIF(btrim(COALESCE(p_batch_number, '')), ''),
                         'RB-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  SELECT * INTO v_inv
  FROM public.raw_material_inventory
  WHERE raw_material_id = p_raw_material_id AND branch_id = p_branch_id
  FOR UPDATE;

  IF v_inv.id IS NULL THEN
    v_before := 0;
    v_after := p_qty;
    v_new_avg := COALESCE(p_unit_cost, 0);
    INSERT INTO public.raw_material_inventory (raw_material_id, branch_id, quantity, avg_cost)
    VALUES (p_raw_material_id, p_branch_id, p_qty, v_new_avg);
  ELSE
    v_before := v_inv.quantity;
    v_after := v_before + p_qty;
    v_new_avg := CASE WHEN v_after > 0
      THEN round((v_inv.quantity * v_inv.avg_cost + p_qty * COALESCE(p_unit_cost, 0)) / v_after, 2)
      ELSE COALESCE(p_unit_cost, 0) END;
    UPDATE public.raw_material_inventory
    SET quantity = v_after, avg_cost = v_new_avg, updated_at = now()
    WHERE id = v_inv.id;
  END IF;

  INSERT INTO public.raw_material_batches (raw_material_id, branch_id, batch_number, quantity, unit_cost, production_date, expiry_date, source_type, source_id)
  VALUES (p_raw_material_id, p_branch_id, v_batch_no, p_qty, COALESCE(p_unit_cost, 0),
          p_production_date, p_expiry_date, COALESCE(p_reference_type, p_entry_type), p_reference_id);

  INSERT INTO public.inventory_ledger (raw_material_id, branch_id, batch_number, quantity, unit_cost, total_cost, before_qty, after_qty, entry_type, reference_type, reference_id, reference_number, created_by)
  VALUES (p_raw_material_id, p_branch_id, v_batch_no, p_qty, COALESCE(p_unit_cost, 0),
          p_qty * COALESCE(p_unit_cost, 0), v_before, v_after, p_entry_type,
          p_reference_type, p_reference_id, p_reference_number, p_created_by);

  RETURN jsonb_build_object('success', true, 'before_qty', v_before, 'after_qty', v_after,
    'avg_cost', v_new_avg, 'batch_number', v_batch_no);
END;
$function$;

-- ---------------------------------------------------------------------
-- 5. Internal helper: remove raw material FIFO (nearest expiry first)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._raw_remove_fifo(
  p_raw_material_id uuid, p_branch_id uuid, p_qty numeric,
  p_entry_type text DEFAULT 'production',
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_reference_number text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_remaining numeric(14,4);
  v_batch record;
  v_deduct numeric(14,4);
  v_before numeric(14,4);
  v_after numeric(14,4);
  v_avg_val numeric(14,2) := 0;
  v_total_cost numeric(14,2) := 0;
  v_total_removed numeric(14,4) := 0;
  v_shortage numeric(14,4) := 0;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RETURN jsonb_build_object('success', true, 'shortage', 0, 'removed', 0, 'total_cost', 0, 'avg_cost', 0);
  END IF;

  v_remaining := p_qty;

  SELECT COALESCE(quantity, 0) INTO v_before
  FROM public.raw_material_inventory
  WHERE raw_material_id = p_raw_material_id AND branch_id = p_branch_id;
  IF v_before IS NULL THEN v_before := 0; END IF;
  v_after := v_before;

  FOR v_batch IN
    SELECT b.id, b.quantity, b.unit_cost, b.batch_number
    FROM public.raw_material_batches b
    WHERE b.raw_material_id = p_raw_material_id AND b.branch_id = p_branch_id AND b.quantity > 0
    ORDER BY b.expiry_date NULLS LAST, b.created_at ASC, b.id ASC
    FOR UPDATE
  LOOP
    IF v_remaining <= 0 THEN EXIT; END IF;
    v_deduct := LEAST(v_batch.quantity, v_remaining);

    UPDATE public.raw_material_batches SET quantity = quantity - v_deduct WHERE id = v_batch.id;

    v_after := v_after - v_deduct;
    INSERT INTO public.inventory_ledger (raw_material_id, branch_id, batch_number, quantity, unit_cost, total_cost, before_qty, after_qty, entry_type, reference_type, reference_id, reference_number, created_by)
    VALUES (p_raw_material_id, p_branch_id, v_batch.batch_number, -v_deduct, v_batch.unit_cost,
            -v_deduct * v_batch.unit_cost, v_after + v_deduct, v_after, p_entry_type,
            p_reference_type, p_reference_id, p_reference_number, p_created_by);

    v_total_cost := v_total_cost + v_deduct * v_batch.unit_cost;
    v_total_removed := v_total_removed + v_deduct;
    v_remaining := v_remaining - v_deduct;
  END LOOP;

  v_shortage := v_remaining;

  SELECT COALESCE(SUM(b.quantity), 0), COALESCE(SUM(b.quantity * b.unit_cost), 0)
  INTO v_after, v_avg_val
  FROM public.raw_material_batches b
  WHERE b.raw_material_id = p_raw_material_id AND b.branch_id = p_branch_id;

  UPDATE public.raw_material_inventory
  SET quantity = v_after,
      avg_cost = CASE WHEN v_after > 0 THEN round(v_avg_val / v_after, 2) ELSE 0 END,
      updated_at = now()
  WHERE raw_material_id = p_raw_material_id AND branch_id = p_branch_id;

  RETURN jsonb_build_object('success', true, 'shortage', v_shortage, 'removed', v_total_removed,
    'total_cost', v_total_cost,
    'avg_cost', CASE WHEN v_total_removed > 0 THEN round(v_total_cost / v_total_removed, 2) ELSE 0 END);
END;
$function$;

-- ---------------------------------------------------------------------
-- 6. Internal helper: move finished product between warehouses (FIFO)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._product_inv_move(
  p_product_id uuid, p_from_wh uuid, p_to_wh uuid, p_branch_id uuid, p_qty numeric,
  p_reference_type text DEFAULT 'transfer',
  p_reference_id uuid DEFAULT NULL,
  p_reference_number text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_to_branch uuid;
  v_remaining numeric(14,4);
  v_batch record;
  v_deduct numeric(14,4);
  v_before numeric(14,4);
  v_after numeric(14,4);
  v_shortage numeric(14,4) := 0;
BEGIN
  SELECT COALESCE(branch_id, p_branch_id) INTO v_to_branch FROM public.warehouses WHERE id = p_to_wh;

  v_remaining := p_qty;

  FOR v_batch IN
    SELECT b.id, b.warehouse_id, b.quantity, b.unit_cost, b.batch_number, b.production_date, b.expiry_date
    FROM public.inventory_batches b
    WHERE b.product_id = p_product_id AND b.quantity > 0 AND b.warehouse_id = p_from_wh
    ORDER BY b.expiry_date NULLS LAST, b.created_at ASC, b.id ASC
    FOR UPDATE
  LOOP
    IF v_remaining <= 0 THEN EXIT; END IF;
    v_deduct := LEAST(v_batch.quantity, v_remaining);

    SELECT COALESCE(quantity, 0) INTO v_before
    FROM public.inventory WHERE product_id = p_product_id AND warehouse_id = p_from_wh;
    IF v_before IS NULL THEN v_before := 0; END IF;
    v_after := v_before - v_deduct;
    IF v_after < 0 THEN v_after := 0; END IF;
    UPDATE public.inventory SET quantity = v_after, updated_at = now()
    WHERE product_id = p_product_id AND warehouse_id = p_from_wh;
    UPDATE public.inventory_batches SET quantity = quantity - v_deduct WHERE id = v_batch.id;

    INSERT INTO public.inventory_ledger (product_id, branch_id, warehouse_id, batch_number, quantity, unit_cost, total_cost, before_qty, after_qty, entry_type, reference_type, reference_id, reference_number, created_by)
    VALUES (p_product_id, p_branch_id, p_from_wh, v_batch.batch_number, -v_deduct, v_batch.unit_cost,
            -v_deduct * v_batch.unit_cost, v_before, v_after, 'transfer',
            p_reference_type, p_reference_id, p_reference_number, p_created_by);

    INSERT INTO public.stock_transactions (product_id, warehouse_id, branch_id, transaction_type, component_flow, reference_type, reference_id, quantity, before_quantity, after_quantity, unit_cost, created_by)
    VALUES (p_product_id, p_from_wh, p_branch_id, 'transfer', false,
            p_reference_type, p_reference_id, -v_deduct, v_before, v_after, v_batch.unit_cost, p_created_by);

    PERFORM public._product_inv_add(p_product_id, p_to_wh, COALESCE(v_to_branch, p_branch_id),
      v_deduct, v_batch.unit_cost, v_batch.batch_number, v_batch.production_date, v_batch.expiry_date,
      'transfer', p_reference_type, p_reference_id, p_reference_number, p_created_by);

    v_remaining := v_remaining - v_deduct;
  END LOOP;

  v_shortage := v_remaining;

  RETURN jsonb_build_object('success', true, 'shortage', v_shortage, 'moved', p_qty - v_remaining);
END;
$function$;

-- =====================================================================
-- PRODUCTION ORDERS
-- =====================================================================

CREATE OR REPLACE FUNCTION public.create_production_order(
  p_product_id uuid, p_branch_id uuid, p_warehouse_id uuid, p_quantity numeric,
  p_batch_number text DEFAULT NULL, p_planned_at date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id uuid;
  v_number text;
  v_batch text;
  v_user_branch uuid;
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND NOT can_permission('production.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
        'detail', 'Creating production orders requires the production.manage permission.');
    END IF;

    IF p_quantity IS NULL OR p_quantity <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUANTITY');
    END IF;

    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND p_branch_id <> v_user_branch THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_product_id AND branch_id = p_branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_IN_BRANCH', 'product_id', p_product_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM recipes WHERE product_id = p_product_id AND branch_id = p_branch_id AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'NO_RECIPE', 'product_id', p_product_id);
    END IF;

    IF p_warehouse_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM warehouses WHERE id = p_warehouse_id AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'WAREHOUSE_NOT_FOUND');
    END IF;

    v_number := (public.next_document_number('production_order')->>'number')::text;
    v_batch := COALESCE(NULLIF(btrim(COALESCE(p_batch_number, '')), ''),
                        'B-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

    INSERT INTO public.production_orders (order_number, product_id, branch_id, warehouse_id, quantity, batch_number, planned_at, notes, created_by)
    VALUES (v_number, p_product_id, p_branch_id, p_warehouse_id, p_quantity, v_batch, p_planned_at, p_notes, auth.uid())
    RETURNING id INTO v_order_id;

    RETURN jsonb_build_object('success', true, 'order_id', v_order_id, 'order_number', v_number, 'batch_number', v_batch);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.start_production_order(p_order_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND NOT can_permission('production.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;

    SELECT status INTO v_status FROM public.production_orders WHERE id = p_order_id;
    IF v_status IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
    END IF;
    IF v_status <> 'planned' THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'status', v_status);
    END IF;

    UPDATE public.production_orders SET status = 'in_progress' WHERE id = p_order_id;
    RETURN jsonb_build_object('success', true, 'order_id', p_order_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_production_order(
  p_order_id uuid, p_waste jsonb DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_order record;
  v_recipe_id uuid;
  v_recipe_yield numeric(14,4);
  v_factor numeric(14,4);
  v_item record;
  v_waste_item jsonb;
  v_req numeric(14,4);
  v_res jsonb;
  v_short numeric(14,4);
  v_cost numeric(14,2) := 0;
  v_unit_cost numeric(12,2) := 0;
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND NOT can_permission('production.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;

    SELECT * INTO v_order FROM public.production_orders WHERE id = p_order_id FOR UPDATE;
    IF v_order.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
    END IF;
    IF v_order.status NOT IN ('planned', 'in_progress') THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'status', v_order.status);
    END IF;
    IF v_order.warehouse_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'WAREHOUSE_REQUIRED',
        'detail', 'Assign an output warehouse to the production order before completing it.');
    END IF;

    SELECT id, yield_quantity INTO v_recipe_id, v_recipe_yield
    FROM public.recipes
    WHERE product_id = v_order.product_id AND branch_id = v_order.branch_id AND is_active
    ORDER BY updated_at DESC LIMIT 1;
    IF v_recipe_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'NO_RECIPE', 'product_id', v_order.product_id);
    END IF;

    v_recipe_yield := COALESCE(v_recipe_yield, 1);
    v_factor := v_order.quantity / v_recipe_yield;

    -- Consume raw materials (FIFO by nearest expiry)
    FOR v_item IN SELECT * FROM public.recipe_items WHERE recipe_id = v_recipe_id
    LOOP
      v_req := COALESCE(v_item.quantity, 0) * v_factor;
      IF v_req <= 0 THEN CONTINUE; END IF;

      v_res := public._raw_remove_fifo(v_item.raw_material_id, v_order.branch_id, v_req,
        'production', 'production_order', v_order.id, v_order.order_number, auth.uid());
      v_short := (v_res->>'shortage')::numeric;
      IF v_short > 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_RAW',
          'raw_material_id', v_item.raw_material_id, 'required', v_req,
          'available', v_req - v_short,
          'detail', 'Not enough raw material to complete production. The order was not completed.');
      END IF;
      v_cost := v_cost + (v_res->>'total_cost')::numeric;
    END LOOP;

    -- Record waste (extra raw material consumed beyond the recipe)
    IF p_waste IS NOT NULL AND jsonb_array_length(p_waste) > 0 THEN
      FOR v_waste_item IN SELECT * FROM jsonb_array_elements(p_waste)
      LOOP
        v_req := COALESCE((v_waste_item->>'quantity')::numeric, 0);
        IF v_req <= 0 THEN CONTINUE; END IF;
        v_res := public._raw_remove_fifo((v_waste_item->>'raw_material_id')::uuid, v_order.branch_id, v_req,
          'waste', 'production_order', v_order.id, v_order.order_number, auth.uid());
        v_cost := v_cost + (v_res->>'total_cost')::numeric;
        INSERT INTO public.production_waste (order_id, branch_id, raw_material_id, quantity, reason)
        VALUES (v_order.id, v_order.branch_id, (v_waste_item->>'raw_material_id')::uuid, v_req,
                COALESCE(v_waste_item->>'reason', 'إنتاج'));
      END LOOP;
    END IF;

    -- Produce output as a new batch
    v_unit_cost := CASE WHEN v_order.quantity > 0 THEN round(v_cost / v_order.quantity, 2) ELSE 0 END;
    v_res := public._product_inv_add(v_order.product_id, v_order.warehouse_id, v_order.branch_id,
      v_order.quantity, v_unit_cost, v_order.batch_number, CURRENT_DATE, NULL,
      'production', 'production_order', v_order.id, v_order.order_number, auth.uid());
    IF NOT (v_res->>'success')::boolean THEN
      RETURN v_res;
    END IF;

    UPDATE public.production_orders
    SET status = 'completed', total_cost = v_cost, completed_at = now()
    WHERE id = v_order.id;

    RETURN jsonb_build_object('success', true, 'order_id', v_order.id, 'order_number', v_order.order_number,
      'total_cost', v_cost, 'unit_cost', v_unit_cost);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_production_order(p_order_id uuid, p_reason text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND NOT can_permission('production.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;

    SELECT status INTO v_status FROM public.production_orders WHERE id = p_order_id;
    IF v_status IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
    END IF;
    IF v_status NOT IN ('planned', 'in_progress') THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'status', v_status);
    END IF;

    UPDATE public.production_orders
    SET status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason
    WHERE id = p_order_id;

    RETURN jsonb_build_object('success', true, 'order_id', p_order_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- =====================================================================
-- WAREHOUSE TRANSFERS
-- =====================================================================

CREATE OR REPLACE FUNCTION public.create_warehouse_transfer(
  p_from_warehouse_id uuid, p_to_warehouse_id uuid, p_branch_id uuid,
  p_items jsonb, p_reason text DEFAULT NULL, p_notes text DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_transfer_id uuid;
  v_number text;
  v_item jsonb;
  v_product_id uuid;
  v_qty numeric(14,4);
  v_user_branch uuid;
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND NOT can_permission('inventory.transfers') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
        'detail', 'Creating transfers requires the inventory.transfers permission.');
    END IF;

    IF p_from_warehouse_id IS NULL OR p_to_warehouse_id IS NULL OR p_from_warehouse_id = p_to_warehouse_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_WAREHOUSES');
    END IF;
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'EMPTY_CART');
    END IF;

    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND p_branch_id <> v_user_branch THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM warehouses WHERE id = p_from_warehouse_id AND is_active)
       OR NOT EXISTS (SELECT 1 FROM warehouses WHERE id = p_to_warehouse_id AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'WAREHOUSE_NOT_FOUND');
    END IF;

    v_number := (public.next_document_number('transfer')->>'number')::text;

    INSERT INTO public.warehouse_transfers (transfer_number, from_warehouse_id, to_warehouse_id, branch_id, reason, notes, requested_by)
    VALUES (v_number, p_from_warehouse_id, p_to_warehouse_id, p_branch_id, p_reason, p_notes, auth.uid())
    RETURNING id INTO v_transfer_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_qty := COALESCE((v_item->>'quantity')::numeric, 0);
      IF v_product_id IS NULL OR v_qty <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_ITEM', 'item', v_item);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM products WHERE id = v_product_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_FOUND', 'product_id', v_product_id);
      END IF;
      INSERT INTO public.warehouse_transfer_items (transfer_id, product_id, quantity, unit_cost)
      VALUES (v_transfer_id, v_product_id, v_qty, COALESCE((v_item->>'unit_cost')::numeric, 0));
    END LOOP;

    RETURN jsonb_build_object('success', true, 'transfer_id', v_transfer_id, 'transfer_number', v_number);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.approve_warehouse_transfer(p_transfer_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_transfer record;
  v_item record;
  v_avail numeric(14,4);
  v_res jsonb;
  v_short numeric(14,4);
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND NOT can_permission('inventory.transfers.approve') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
        'detail', 'Approving transfers requires the inventory.transfers.approve permission.');
    END IF;

    SELECT * INTO v_transfer FROM public.warehouse_transfers WHERE id = p_transfer_id FOR UPDATE;
    IF v_transfer.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'TRANSFER_NOT_FOUND');
    END IF;
    IF v_transfer.status <> 'pending' THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'status', v_transfer.status);
    END IF;

    -- Validate availability for all items before moving anything
    FOR v_item IN SELECT * FROM public.warehouse_transfer_items WHERE transfer_id = p_transfer_id
    LOOP
      SELECT COALESCE(SUM(quantity), 0) INTO v_avail
      FROM public.inventory_batches
      WHERE product_id = v_item.product_id AND warehouse_id = v_transfer.from_warehouse_id;
      IF v_avail < v_item.quantity THEN
        RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_STOCK',
          'product_id', v_item.product_id, 'required', v_item.quantity, 'available', v_avail);
      END IF;
    END LOOP;

    FOR v_item IN SELECT * FROM public.warehouse_transfer_items WHERE transfer_id = p_transfer_id
    LOOP
      v_res := public._product_inv_move(v_item.product_id, v_transfer.from_warehouse_id,
        v_transfer.to_warehouse_id, v_transfer.branch_id, v_item.quantity,
        'warehouse_transfer', v_transfer.id, v_transfer.transfer_number, auth.uid());
      v_short := (v_res->>'shortage')::numeric;
      IF v_short > 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_STOCK',
          'product_id', v_item.product_id, 'shortage', v_short);
      END IF;
    END LOOP;

    UPDATE public.warehouse_transfers
    SET status = 'approved', approved_by = auth.uid(), approved_at = now()
    WHERE id = p_transfer_id;

    RETURN jsonb_build_object('success', true, 'transfer_id', p_transfer_id, 'transfer_number', v_transfer.transfer_number);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reject_warehouse_transfer(p_transfer_id uuid, p_reason text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND NOT can_permission('inventory.transfers.approve') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;

    SELECT status INTO v_status FROM public.warehouse_transfers WHERE id = p_transfer_id;
    IF v_status IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'TRANSFER_NOT_FOUND');
    END IF;
    IF v_status <> 'pending' THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'status', v_status);
    END IF;

    UPDATE public.warehouse_transfers
    SET status = 'rejected', approved_by = auth.uid(), approved_at = now(), rejection_reason = p_reason
    WHERE id = p_transfer_id;

    RETURN jsonb_build_object('success', true, 'transfer_id', p_transfer_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- =====================================================================
-- PURCHASES (rewritten: products + raw materials, batches, avg cost)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.process_purchase(p_invoice_number text, p_supplier_id uuid, p_branch_id uuid, p_warehouse_id uuid, p_subtotal numeric, p_discount_amount numeric, p_tax_amount numeric, p_total numeric, p_paid_amount numeric, p_payment_method text, p_status text, p_notes text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_purchase_id uuid;
  v_user_branch uuid;
  v_item jsonb;
  v_product_id uuid;
  v_raw_id uuid;
  v_quantity numeric(14,4);
  v_unit_cost numeric(12,2);
  v_res jsonb;
  v_unit_name text;
  v_stock numeric(14,4);
  v_stock_val numeric(14,2);
  v_new_cost numeric(12,2);
BEGIN
  BEGIN
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'EMPTY_CART');
    END IF;

    -- Only admins, branch managers and warehouse managers create purchases
    IF NOT is_pos_admin() AND get_user_role() NOT IN ('warehouse_manager','branch_manager') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
        'detail', 'Creating purchases requires the purchases.manage permission.');
    END IF;

    -- Branch isolation (mirror of RLS on purchases)
    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND p_branch_id IS NOT NULL AND v_user_branch <> p_branch_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    -- Validate items before writing
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_raw_id := (v_item->>'raw_material_id')::uuid;
      v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
      IF (v_product_id IS NULL) = (v_raw_id IS NULL) THEN
        RETURN jsonb_build_object('success', false, 'error', 'ITEM_MISSING_TYPE');
      END IF;
      IF v_quantity <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUANTITY');
      END IF;
      IF v_product_id IS NOT NULL AND p_warehouse_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'WAREHOUSE_REQUIRED',
          'detail', 'Select a warehouse to receive product items.');
      END IF;
    END LOOP;

    INSERT INTO purchases (invoice_number, supplier_id, branch_id, warehouse_id, buyer_id,
      subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status, notes)
    VALUES (p_invoice_number, p_supplier_id, p_branch_id, p_warehouse_id, auth.uid(),
      p_subtotal, p_discount_amount, p_tax_amount, p_total, p_paid_amount, p_payment_method, p_status, p_notes)
    RETURNING id INTO v_purchase_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_raw_id := (v_item->>'raw_material_id')::uuid;
      v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
      v_unit_cost := COALESCE((v_item->>'unit_cost')::numeric, 0);

      IF v_product_id IS NOT NULL THEN
        INSERT INTO purchase_items (purchase_id, product_id, unit_name, quantity, unit_cost, total)
        VALUES (v_purchase_id, v_product_id, COALESCE(v_item->>'unit_name', 'piece'),
          v_quantity, v_unit_cost, v_quantity * v_unit_cost);

        v_res := public._product_inv_add(v_product_id, p_warehouse_id, p_branch_id, v_quantity,
          v_unit_cost, v_item->>'batch_number',
          (v_item->>'production_date')::date, (v_item->>'expiry_date')::date,
          'purchase', 'purchase', v_purchase_id, p_invoice_number, auth.uid());
        IF NOT (v_res->>'success')::boolean THEN
          RETURN v_res;
        END IF;

        -- Weighted-average cost on the product master
        SELECT COALESCE(SUM(b.quantity), 0), COALESCE(SUM(b.quantity * b.unit_cost), 0)
        INTO v_stock, v_stock_val
        FROM public.inventory_batches b WHERE b.product_id = v_product_id;
        v_new_cost := CASE WHEN v_stock > 0 THEN round(v_stock_val / v_stock, 2) ELSE v_unit_cost END;
        UPDATE public.products SET cost_price = v_new_cost, updated_at = now() WHERE id = v_product_id;
      ELSE
        SELECT COALESCE(u.symbol, u.name, 'وحدة') INTO v_unit_name
        FROM public.raw_materials rm LEFT JOIN public.units u ON u.id = rm.unit_id
        WHERE rm.id = v_raw_id;

        INSERT INTO purchase_items (purchase_id, raw_material_id, unit_name, quantity, unit_cost, total)
        VALUES (v_purchase_id, v_raw_id, COALESCE(NULLIF(v_item->>'unit_name', ''), v_unit_name),
          v_quantity, v_unit_cost, v_quantity * v_unit_cost);

        v_res := public._raw_add(v_raw_id, p_branch_id, v_quantity, v_unit_cost,
          v_item->>'batch_number', (v_item->>'production_date')::date, (v_item->>'expiry_date')::date,
          'purchase', 'purchase', v_purchase_id, p_invoice_number, auth.uid());
        IF NOT (v_res->>'success')::boolean THEN
          RETURN v_res;
        END IF;
      END IF;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'purchase_id', v_purchase_id, 'invoice_number', p_invoice_number);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- =====================================================================
-- SALES (rewritten: FIFO by nearest expiry, no component consumption)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.process_sale(p_invoice_number text, p_branch_id uuid, p_warehouse_id uuid, p_customer_id uuid, p_salesperson_id uuid, p_subtotal numeric, p_discount_amount numeric, p_discount_type text, p_tax_amount numeric, p_bonus_amount numeric, p_total numeric, p_paid_amount numeric, p_payment_method text, p_status text, p_items jsonb, p_shift_id uuid DEFAULT NULL::uuid)
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
BEGIN
  BEGIN
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'EMPTY_CART');
    END IF;

    SELECT role, branch_id INTO v_role, v_user_branch FROM public.users WHERE id = auth.uid();

    -- Branch isolation (mirror of RLS on sales)
    IF NOT is_pos_admin() THEN
      IF v_user_branch IS NOT NULL AND v_user_branch <> p_branch_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
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
    END LOOP;

    -- ===== WRITE PHASE 1: sale header =====
    INSERT INTO sales (invoice_number, branch_id, warehouse_id, customer_id, cashier_id, salesperson_id,
      subtotal, discount_amount, discount_type, tax_amount, bonus_amount, total, paid_amount, payment_method, status)
    VALUES (p_invoice_number, p_branch_id, p_warehouse_id, p_customer_id, auth.uid(), p_salesperson_id,
      p_subtotal, p_discount_amount, p_discount_type, p_tax_amount, p_bonus_amount,
      p_total, p_paid_amount, p_payment_method, p_status)
    RETURNING id INTO v_sale_id;

    -- ===== WRITE PHASE 2: items + FIFO stock deduction + ledger =====
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
      v_unit_price := COALESCE((v_item->>'unit_price')::numeric, 0);
      v_discount_amount := COALESCE((v_item->>'discount_amount')::numeric, 0);
      v_bonus_quantity := COALESCE((v_item->>'bonus_quantity')::numeric, 0);
      v_item_total := COALESCE((v_item->>'total')::numeric, v_quantity * v_unit_price - v_discount_amount);

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
    END LOOP;

    -- ===== WRITE PHASE 3: log the sale into the active shift =====
    IF v_shift_id IS NOT NULL THEN
      INSERT INTO shift_operations (shift_id, operation_type, amount, payment_method, reference_type, reference_id, created_by)
      VALUES (v_shift_id, 'sale', COALESCE(p_paid_amount, 0), p_payment_method, 'sale', v_sale_id, auth.uid());
    END IF;

    RETURN jsonb_build_object('success', true, 'sale_id', v_sale_id, 'invoice_number', p_invoice_number);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'INSUFFICIENT_STOCK%' THEN
      RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_STOCK', 'detail', SQLERRM);
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- =====================================================================
-- REFUNDS (rewritten: restore stock to original warehouses as new batch)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.process_refund(p_sale_id uuid, p_items jsonb DEFAULT NULL::jsonb, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sale record;
  v_user_branch uuid;
  v_shift_id uuid;
  v_refund_total numeric(14,2) := 0;
  v_item record;
  v_req jsonb;
  v_item_id uuid;
  v_req_qty numeric(14,4);
  v_already numeric(14,4);
  v_ref_qty numeric(14,4);
  v_item_line_total numeric(14,2);
  v_item_ref_amt numeric(14,2);
  v_all_refunded boolean := true;
  v_remaining numeric(14,4);
  v_back numeric(14,4);
  v_ld record;
  v_res jsonb;
  v_fallback_wh uuid;
  v_last_cost numeric(12,2);
BEGIN
  BEGIN
    IF p_sale_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_SALE');
    END IF;

    SELECT id, branch_id, warehouse_id, status, total, paid_amount
      INTO v_sale FROM public.sales WHERE id = p_sale_id;
    IF v_sale.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'SALE_NOT_FOUND');
    END IF;

    IF v_sale.status = 'returned' THEN
      RETURN jsonb_build_object('success', false, 'error', 'ALREADY_RETURNED');
    END IF;

    -- Permission: refunds.approve (admins always pass)
    IF NOT is_pos_admin() AND NOT can_permission('refunds.approve') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
        'detail', 'You need the refunds.approve permission.');
    END IF;

    -- Branch isolation
    SELECT branch_id INTO v_user_branch FROM users WHERE id = auth.uid();
    IF NOT is_pos_admin() AND v_user_branch IS NOT NULL
       AND v_sale.branch_id IS NOT NULL AND v_user_branch <> v_sale.branch_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;

    -- Active shift of the refunding operator (for the drawer log, optional)
    SELECT id INTO v_shift_id FROM shifts
      WHERE cashier_id = auth.uid() AND branch_id = v_sale.branch_id AND status = 'open'
      ORDER BY opened_at DESC LIMIT 1;

    SELECT id INTO v_fallback_wh FROM warehouses
      WHERE branch_id = v_sale.branch_id AND is_active = true ORDER BY created_at LIMIT 1;

    -- ===== VALIDATION PHASE =====
    IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
      FOR v_req IN SELECT * FROM jsonb_array_elements(p_items)
      LOOP
        v_item_id := (v_req->>'sale_item_id')::uuid;
        v_req_qty := COALESCE((v_req->>'quantity')::numeric, 0);
        IF v_req_qty <= 0 THEN
          RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUANTITY', 'sale_item_id', v_item_id);
        END IF;
        SELECT id, quantity, refunded_quantity INTO v_item
          FROM sale_items WHERE id = v_item_id AND sale_id = p_sale_id;
        IF v_item.id IS NULL THEN
          RETURN jsonb_build_object('success', false, 'error', 'ITEM_NOT_FOUND', 'sale_item_id', v_item_id);
        END IF;
        v_already := COALESCE(v_item.refunded_quantity, 0);
        IF v_req_qty > v_item.quantity - v_already THEN
          RETURN jsonb_build_object('success', false, 'error', 'REFUND_EXCEEDS_QUANTITY',
            'sale_item_id', v_item_id, 'max', v_item.quantity - v_already);
        END IF;
      END LOOP;
    END IF;

    -- ===== REFUND + RESTOCK PHASE =====
    FOR v_item IN SELECT id, product_id, quantity, unit_price, discount_amount, refunded_quantity
                  FROM sale_items WHERE sale_id = p_sale_id
    LOOP
      IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
        v_req_qty := 0;
        SELECT (req->>'quantity')::numeric INTO v_req_qty
        FROM jsonb_array_elements(p_items) req
        WHERE (req->>'sale_item_id')::uuid = v_item.id;
        v_req_qty := COALESCE(v_req_qty, 0);
      ELSE
        v_req_qty := v_item.quantity - COALESCE(v_item.refunded_quantity, 0);
      END IF;
      IF v_req_qty <= 0 THEN CONTINUE; END IF;

      v_item_line_total := v_item.quantity * v_item.unit_price - v_item.discount_amount;
      IF v_item.quantity > 0 THEN
        v_item_ref_amt := ROUND(v_item_line_total * v_req_qty / v_item.quantity, 2);
      ELSE
        v_item_ref_amt := 0;
      END IF;
      v_refund_total := v_refund_total + v_item_ref_amt;

      UPDATE sale_items
        SET refunded_quantity = COALESCE(refunded_quantity, 0) + v_req_qty,
            refunded_amount = COALESCE(refunded_amount, 0) + v_item_ref_amt
        WHERE id = v_item.id;

      -- Restore stock to the warehouses the sale deducted from (FIFO restore as new batch)
      v_remaining := v_req_qty;
      SELECT COALESCE(l.unit_cost, p.cost_price, 0) INTO v_last_cost
      FROM products p LEFT JOIN inventory_ledger l
        ON l.product_id = p.id AND l.quantity < 0 AND l.reference_type = 'sale'
           AND l.reference_id = p_sale_id
      WHERE p.id = v_item.product_id
      ORDER BY l.id DESC NULLS LAST LIMIT 1;

      FOR v_ld IN
        SELECT l.warehouse_id, l.batch_number, l.unit_cost, -l.quantity AS debited
        FROM inventory_ledger l
        WHERE l.product_id = v_item.product_id AND l.reference_type = 'sale'
          AND l.reference_id = p_sale_id AND l.quantity < 0
        ORDER BY l.id ASC
      LOOP
        IF v_remaining <= 0 THEN EXIT; END IF;
        v_back := LEAST(COALESCE(v_ld.debited, 0), v_remaining);
        IF v_back <= 0 OR v_ld.warehouse_id IS NULL THEN CONTINUE; END IF;
        v_res := public._product_inv_add(v_item.product_id, v_ld.warehouse_id, v_sale.branch_id, v_back,
          COALESCE(v_ld.unit_cost, v_last_cost),
          'R-' || COALESCE(v_ld.batch_number, 'RETURN'), NULL, NULL,
          'refund', 'refund', p_sale_id, NULL, auth.uid());
        IF NOT (v_res->>'success')::boolean THEN
          RETURN v_res;
        END IF;
        v_remaining := v_remaining - v_back;
      END LOOP;

      IF v_remaining > 0 AND v_fallback_wh IS NOT NULL THEN
        v_res := public._product_inv_add(v_item.product_id, v_fallback_wh, v_sale.branch_id, v_remaining,
          v_last_cost, 'R-RETURN', NULL, NULL, 'refund', 'refund', p_sale_id, NULL, auth.uid());
        IF NOT (v_res->>'success')::boolean THEN
          RETURN v_res;
        END IF;
      END IF;
    END LOOP;

    -- Update header: full refund flips the status, otherwise accumulate refunded_amount
    SELECT bool_and(quantity = refunded_quantity) INTO v_all_refunded
      FROM sale_items WHERE sale_id = p_sale_id;
    UPDATE sales SET
      refunded_amount = COALESCE(refunded_amount, 0) + v_refund_total,
      status = CASE WHEN v_all_refunded THEN 'returned' ELSE status END,
      notes = CASE WHEN p_reason IS NOT NULL THEN COALESCE(notes, '') || E'\n' || p_reason ELSE notes END
      WHERE id = p_sale_id;

    -- Log the cash-out into the active shift
    IF v_shift_id IS NOT NULL AND v_refund_total > 0 THEN
      INSERT INTO shift_operations (shift_id, operation_type, amount, payment_method, reference_type, reference_id, created_by)
      VALUES (v_shift_id, 'refund', v_refund_total, 'cash', 'refund', p_sale_id, auth.uid());
    END IF;

    RETURN jsonb_build_object('success', true, 'sale_id', p_sale_id,
      'refunded_amount', v_refund_total, 'fully_refunded', v_all_refunded);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- =====================================================================
-- STOCK ADJUSTMENTS (rewritten with ledger) + new adjust_raw_stock
-- =====================================================================
CREATE OR REPLACE FUNCTION public.adjust_stock(p_inventory_id uuid, p_new_quantity numeric, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inv record;
  v_user_branch uuid;
  v_delta numeric(14,4);
  v_res jsonb;
BEGIN
  BEGIN
    -- Only admins, branch managers and warehouse managers may adjust stock
    IF NOT is_pos_admin() AND get_user_role() NOT IN ('warehouse_manager','branch_manager') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
        'detail', 'Stock adjustments require the warehouse manager or branch manager role.');
    END IF;

    SELECT i.id, i.product_id, i.warehouse_id, i.quantity, i.branch_id, p.cost_price AS cost
    INTO v_inv
    FROM inventory i
    JOIN products p ON p.id = i.product_id
    WHERE i.id = p_inventory_id
    FOR UPDATE OF i;

    IF v_inv.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVENTORY_NOT_FOUND');
    END IF;

    -- Branch isolation
    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND v_inv.branch_id IS NOT NULL AND v_user_branch <> v_inv.branch_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    v_delta := p_new_quantity - v_inv.quantity;
    IF v_delta = 0 THEN
      RETURN jsonb_build_object('success', true, 'inventory_id', p_inventory_id, 'no_change', true);
    END IF;

    IF v_delta > 0 THEN
      v_res := public._product_inv_add(v_inv.product_id, v_inv.warehouse_id, v_inv.branch_id, v_delta,
        COALESCE(v_inv.cost, 0), 'ADJ', NULL, NULL,
        'adjustment', 'adjustment', NULL, p_reason, auth.uid());
    ELSE
      v_res := public._product_inv_remove_fifo(v_inv.product_id, v_inv.warehouse_id, v_inv.branch_id, -v_delta,
        'adjustment', 'adjustment', NULL, p_reason, auth.uid());
    END IF;

    IF NOT (v_res->>'success')::boolean THEN
      RETURN v_res;
    END IF;

    RETURN jsonb_build_object('success', true, 'inventory_id', p_inventory_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.adjust_raw_stock(p_raw_material_id uuid, p_branch_id uuid, p_new_quantity numeric, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cur numeric(14,4);
  v_delta numeric(14,4);
  v_user_branch uuid;
  v_res jsonb;
  v_cost numeric(12,2);
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND get_user_role() NOT IN ('warehouse_manager','branch_manager') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
        'detail', 'Raw material adjustments require the warehouse manager or branch manager role.');
    END IF;

    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND p_branch_id <> v_user_branch THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    SELECT COALESCE(quantity, 0), COALESCE(avg_cost, 0)
    INTO v_cur, v_cost
    FROM public.raw_material_inventory
    WHERE raw_material_id = p_raw_material_id AND branch_id = p_branch_id;
    IF v_cur IS NULL THEN v_cur := 0; END IF;

    v_delta := p_new_quantity - v_cur;
    IF v_delta = 0 THEN
      RETURN jsonb_build_object('success', true, 'raw_material_id', p_raw_material_id, 'no_change', true);
    END IF;

    IF v_delta > 0 THEN
      v_res := public._raw_add(p_raw_material_id, p_branch_id, v_delta, v_cost,
        'ADJ', NULL, NULL, 'adjustment', 'adjustment', NULL, p_reason, auth.uid());
    ELSE
      v_res := public._raw_remove_fifo(p_raw_material_id, p_branch_id, -v_delta,
        'adjustment', 'adjustment', NULL, p_reason, auth.uid());
    END IF;

    IF NOT (v_res->>'success')::boolean THEN
      RETURN v_res;
    END IF;

    RETURN jsonb_build_object('success', true, 'raw_material_id', p_raw_material_id, 'quantity', p_new_quantity);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;
