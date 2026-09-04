-- P0 Inventory Lifecycle: Stock Count workflow.
-- Additive-only. Completes the slice from 061_inventory_stock_counts.sql by
-- adding the lifecycle RPCs (create/submit/approve/reject/add-item/update/remove)
-- and making apply_stock_count batch-aware (inventory_batches + inventory_ledger
-- + stock_transactions stay consistent with the legacy `inventory` quantity).
--
-- All state transitions go through SECURITY DEFINER RPCs that enforce the
-- permission and branch-isolation rules; direct table writes remain governed by
-- the RLS policies already created in 061.

ALTER TABLE public.stock_counts ADD COLUMN IF NOT EXISTS count_number text;
ALTER TABLE public.stock_counts ADD COLUMN IF NOT EXISTS rejection_reason text;
CREATE INDEX IF NOT EXISTS idx_stock_counts_number ON public.stock_counts(count_number);

INSERT INTO public.document_sequences (seq_type, next_value) VALUES ('stock_count', 1)
ON CONFLICT (seq_type) DO NOTHING;

-- ---------------------------------------------------------------------------
-- create_stock_count: create a draft count with optional pre-seeded items.
-- system_quantity and unit_cost are computed server-side so clients never
-- supply their own stock truth.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_stock_count(
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_count_type text,
  p_notes text DEFAULT NULL,
  p_items jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_count_id uuid;
  v_number text;
  v_item jsonb;
  v_product_id uuid;
  v_system_qty numeric(14,4);
  v_unit_cost numeric(12,2);
  v_user_branch uuid;
  v_rows integer := 0;
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND NOT can_permission('inventory.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
        'detail', 'Creating stock counts requires the inventory.manage permission.');
    END IF;
    IF p_branch_id IS NULL OR p_warehouse_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'MISSING_BRANCH_WAREHOUSE');
    END IF;
    IF p_count_type IS NULL OR p_count_type NOT IN ('full', 'partial', 'cycle') THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_COUNT_TYPE');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id = p_warehouse_id AND branch_id = p_branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'WAREHOUSE_NOT_IN_BRANCH');
    END IF;
    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND v_user_branch <> p_branch_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    v_number := (public.next_document_number('stock_count')->>'number')::text;

    INSERT INTO public.stock_counts (count_number, branch_id, warehouse_id, status, count_type, notes, created_by)
    VALUES (v_number, p_branch_id, p_warehouse_id, 'draft', p_count_type, p_notes, auth.uid())
    RETURNING id INTO v_count_id;

    IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
      FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
      LOOP
        v_product_id := (v_item->>'product_id')::uuid;
        IF v_product_id IS NULL THEN
          RETURN jsonb_build_object('success', false, 'error', 'INVALID_ITEM', 'item', v_item);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_product_id) THEN
          RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_FOUND', 'product_id', v_product_id);
        END IF;

        SELECT COALESCE(i.quantity, 0), COALESCE(p.cost_price, 0)
        INTO v_system_qty, v_unit_cost
        FROM public.products p
        LEFT JOIN public.inventory i
          ON i.product_id = p.id AND i.warehouse_id = p_warehouse_id
        WHERE p.id = v_product_id;

        -- Prefer the weighted-average batch cost when batches exist.
        SELECT COALESCE(round(SUM(quantity * unit_cost) / NULLIF(SUM(quantity), 0), 2), 0)
        INTO v_unit_cost
        FROM public.inventory_batches b
        WHERE b.product_id = v_product_id AND b.warehouse_id = p_warehouse_id AND b.quantity > 0;
        IF v_unit_cost IS NULL THEN v_unit_cost := 0; END IF;

        INSERT INTO public.stock_count_items (stock_count_id, product_id, system_quantity, counted_quantity, unit_cost, reason)
        VALUES (v_count_id, v_product_id, COALESCE(v_system_qty, 0),
          COALESCE(NULLIF((v_item->>'counted_quantity')::text, ''), v_system_qty)::numeric,
          v_unit_cost, NULLIF((v_item->>'reason')::text, ''));
        v_rows := v_rows + 1;
      END LOOP;
    END IF;

    RETURN jsonb_build_object('success', true, 'stock_count_id', v_count_id,
      'count_number', v_number, 'items_added', v_rows);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_stock_count(uuid, uuid, text, text, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- add_stock_count_item: add/edit an item on a draft count (upsert by product).
-- The client may only supply counted_quantity and reason; system_quantity and
-- unit_cost are computed here.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_stock_count_item(
  p_stock_count_id uuid,
  p_product_id uuid,
  p_counted_quantity numeric DEFAULT NULL,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_count record;
  v_system_qty numeric(14,4);
  v_unit_cost numeric(12,2);
  v_user_branch uuid;
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND NOT can_permission('inventory.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;
    SELECT * INTO v_count FROM public.stock_counts WHERE id = p_stock_count_id FOR UPDATE;
    IF v_count.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'COUNT_NOT_FOUND');
    END IF;
    IF v_count.status <> 'draft' THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_DRAFT', 'status', v_count.status);
    END IF;
    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND v_user_branch <> v_count.branch_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_FOUND');
    END IF;

    SELECT COALESCE(i.quantity, 0) INTO v_system_qty
    FROM public.products p
    LEFT JOIN public.inventory i
      ON i.product_id = p.id AND i.warehouse_id = v_count.warehouse_id
    WHERE p.id = p_product_id;
    IF v_system_qty IS NULL THEN v_system_qty := 0; END IF;

    v_unit_cost := COALESCE((SELECT cost_price FROM public.products WHERE id = p_product_id), 0);
    SELECT COALESCE(round(SUM(quantity * unit_cost) / NULLIF(SUM(quantity), 0), 2), 0)
    INTO v_unit_cost
    FROM public.inventory_batches b
    WHERE b.product_id = p_product_id AND b.warehouse_id = v_count.warehouse_id AND b.quantity > 0;
    IF v_unit_cost IS NULL THEN v_unit_cost := 0; END IF;

    INSERT INTO public.stock_count_items (stock_count_id, product_id, system_quantity, counted_quantity, unit_cost, reason)
    VALUES (p_stock_count_id, p_product_id, v_system_qty,
      COALESCE(p_counted_quantity, v_system_qty), v_unit_cost, p_reason)
    ON CONFLICT (stock_count_id, product_id) DO UPDATE
      SET counted_quantity = EXCLUDED.counted_quantity,
          unit_cost = EXCLUDED.unit_cost,
          reason = EXCLUDED.reason;

    RETURN jsonb_build_object('success', true);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.add_stock_count_item(uuid, uuid, numeric, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- update_stock_count_item: edit counted_quantity / reason of a draft item.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_stock_count_item(
  p_stock_count_id uuid,
  p_product_id uuid,
  p_counted_quantity numeric,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_count record;
  v_user_branch uuid;
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND NOT can_permission('inventory.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;
    SELECT * INTO v_count FROM public.stock_counts WHERE id = p_stock_count_id FOR UPDATE;
    IF v_count.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'COUNT_NOT_FOUND');
    END IF;
    IF v_count.status <> 'draft' THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_DRAFT', 'status', v_count.status);
    END IF;
    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND v_user_branch <> v_count.branch_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    UPDATE public.stock_count_items
    SET counted_quantity = p_counted_quantity, reason = p_reason
    WHERE stock_count_id = p_stock_count_id AND product_id = p_product_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'ITEM_NOT_FOUND');
    END IF;
    RETURN jsonb_build_object('success', true);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.update_stock_count_item(uuid, uuid, numeric, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- remove_stock_count_item: remove an item from a draft count.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_stock_count_item(
  p_stock_count_id uuid,
  p_product_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_count record;
  v_user_branch uuid;
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND NOT can_permission('inventory.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;
    SELECT * INTO v_count FROM public.stock_counts WHERE id = p_stock_count_id FOR UPDATE;
    IF v_count.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'COUNT_NOT_FOUND');
    END IF;
    IF v_count.status <> 'draft' THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_DRAFT', 'status', v_count.status);
    END IF;
    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND v_user_branch <> v_count.branch_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    DELETE FROM public.stock_count_items
    WHERE stock_count_id = p_stock_count_id AND product_id = p_product_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'ITEM_NOT_FOUND');
    END IF;
    RETURN jsonb_build_object('success', true);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.remove_stock_count_item(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- submit_stock_count: draft -> submitted. A count needs at least one item.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_stock_count(p_stock_count_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_count record;
  v_items integer;
  v_user_branch uuid;
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND NOT can_permission('inventory.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;
    SELECT * INTO v_count FROM public.stock_counts WHERE id = p_stock_count_id FOR UPDATE;
    IF v_count.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'COUNT_NOT_FOUND');
    END IF;
    IF v_count.status <> 'draft' THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'status', v_count.status);
    END IF;
    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND v_user_branch <> v_count.branch_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    SELECT COUNT(*) INTO v_items FROM public.stock_count_items WHERE stock_count_id = p_stock_count_id;
    IF v_items = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'EMPTY_COUNT');
    END IF;

    UPDATE public.stock_counts
    SET status = 'submitted', submitted_by = auth.uid(), submitted_at = now()
    WHERE id = p_stock_count_id;

    RETURN jsonb_build_object('success', true, 'stock_count_id', p_stock_count_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.submit_stock_count(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- approve_stock_count: submitted -> approved.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_stock_count(p_stock_count_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_count record;
  v_user_branch uuid;
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND NOT can_permission('inventory.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
        'detail', 'Approving stock counts requires the inventory.manage permission.');
    END IF;
    SELECT * INTO v_count FROM public.stock_counts WHERE id = p_stock_count_id FOR UPDATE;
    IF v_count.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'COUNT_NOT_FOUND');
    END IF;
    IF v_count.status <> 'submitted' THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'status', v_count.status);
    END IF;
    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND v_user_branch <> v_count.branch_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    UPDATE public.stock_counts
    SET status = 'approved', approved_by = auth.uid(), approved_at = now(), rejection_reason = NULL
    WHERE id = p_stock_count_id;

    RETURN jsonb_build_object('success', true, 'stock_count_id', p_stock_count_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.approve_stock_count(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- reject_stock_count: submitted -> rejected.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_stock_count(
  p_stock_count_id uuid,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_count record;
  v_user_branch uuid;
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND NOT can_permission('inventory.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;
    SELECT * INTO v_count FROM public.stock_counts WHERE id = p_stock_count_id FOR UPDATE;
    IF v_count.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'COUNT_NOT_FOUND');
    END IF;
    IF v_count.status <> 'submitted' THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'status', v_count.status);
    END IF;
    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND v_user_branch <> v_count.branch_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    UPDATE public.stock_counts
    SET status = 'rejected', approved_by = auth.uid(), approved_at = now(), rejection_reason = p_reason
    WHERE id = p_stock_count_id;

    RETURN jsonb_build_object('success', true, 'stock_count_id', p_stock_count_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.reject_stock_count(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- apply_stock_count (replaced): approved -> applied.
-- Batch-aware: applies each variance against the CURRENT inventory quantity via
-- the canonical _product_inv_add / _product_inv_remove_fifo helpers so
-- inventory, inventory_batches, inventory_ledger and stock_transactions stay in
-- sync. Returns an error instead of silently breaking the batch invariant.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_stock_count(p_stock_count_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_count stock_counts%ROWTYPE;
  v_item stock_count_items%ROWTYPE;
  v_current numeric(14,4);
  v_variance numeric(14,4);
  v_user_branch uuid;
  v_applied integer := 0;
  v_res jsonb;
  v_shortage numeric(14,4);
BEGIN
  BEGIN
    SELECT * INTO v_count FROM public.stock_counts WHERE id = p_stock_count_id FOR UPDATE;
    IF v_count.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'COUNT_NOT_FOUND');
    END IF;
    IF v_count.status <> 'approved' THEN
      RETURN jsonb_build_object('success', false, 'error', 'COUNT_NOT_APPROVED', 'status', v_count.status);
    END IF;

    IF NOT is_pos_admin() AND NOT can_permission('inventory.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
        'detail', 'Applying stock counts requires the inventory.manage permission.');
    END IF;
    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND v_user_branch <> v_count.branch_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    FOR v_item IN
      SELECT * FROM public.stock_count_items
      WHERE stock_count_id = p_stock_count_id
      ORDER BY id
      FOR UPDATE
    LOOP
      SELECT COALESCE(quantity, 0) INTO v_current
      FROM public.inventory
      WHERE product_id = v_item.product_id AND warehouse_id = v_count.warehouse_id;
      IF v_current IS NULL THEN v_current := 0; END IF;

      v_variance := v_item.counted_quantity - v_current;

      IF v_variance > 0 THEN
        v_res := public._product_inv_add(
          v_item.product_id, v_count.warehouse_id, v_count.branch_id, v_variance,
          v_item.unit_cost, NULL, NULL, NULL, 'adjustment', 'stock_count',
          v_count.id, v_count.count_number, auth.uid());
        IF NOT (v_res->>'success')::boolean THEN
          RETURN jsonb_build_object('success', false, 'error', 'ADJUST_FAILED',
            'product_id', v_item.product_id, 'detail', v_res->>'error');
        END IF;
      ELSIF v_variance < 0 THEN
        v_res := public._product_inv_remove_fifo(
          v_item.product_id, v_count.warehouse_id, v_count.branch_id, -v_variance,
          'adjustment', 'stock_count', v_count.id, v_count.count_number, auth.uid());
        v_shortage := COALESCE((v_res->>'shortage')::numeric, 0);
        IF v_shortage > 0 THEN
          RETURN jsonb_build_object('success', false, 'error', 'STOCK_COUNT_SHORTAGE',
            'product_id', v_item.product_id, 'shortage', v_shortage);
        END IF;
      END IF;

      v_applied := v_applied + 1;
    END LOOP;

    UPDATE public.stock_counts
    SET status = 'applied', applied_at = now()
    WHERE id = p_stock_count_id;

    RETURN jsonb_build_object('success', true, 'items_applied', v_applied);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.apply_stock_count(uuid) TO authenticated;
