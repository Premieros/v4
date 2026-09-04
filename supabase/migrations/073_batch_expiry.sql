-- P0 Inventory Lifecycle: Lot/Batch + Expiry.
-- Additive-only. Adds an RPC to open a batch manually (e.g. opening stock or a
-- supplier batch not tied to a purchase) and an expiry-alert query that lists
-- batches expiring within a horizon (including already-expired ones).

-- ---------------------------------------------------------------------------
-- add_inventory_batch: open a finished-goods batch with production/expiry dates.
-- Delegates to the canonical _product_inv_add so inventory + batches + ledger +
-- stock_transactions stay consistent. Branch-scoped.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_inventory_batch(
  p_product_id uuid,
  p_warehouse_id uuid,
  p_branch_id uuid,
  p_quantity numeric,
  p_unit_cost numeric DEFAULT 0,
  p_batch_number text DEFAULT NULL,
  p_production_date date DEFAULT NULL,
  p_expiry_date date DEFAULT NULL,
  p_source_type text DEFAULT 'opening',
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_res jsonb;
  v_user_branch uuid;
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND NOT can_permission('inventory.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
        'detail', 'Opening a batch requires the inventory.manage permission.');
    END IF;
    IF p_product_id IS NULL OR p_warehouse_id IS NULL OR p_branch_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'MISSING_PARAMS');
    END IF;
    IF p_quantity IS NULL OR p_quantity <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUANTITY');
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

    v_res := public._product_inv_add(
      p_product_id, p_warehouse_id, p_branch_id, p_quantity, p_unit_cost,
      p_batch_number, p_production_date, p_expiry_date,
      'opening', 'batch', NULL, NULL, auth.uid());

    IF NOT (v_res->>'success')::boolean THEN
      RETURN jsonb_build_object('success', false, 'error', v_res->>'error');
    END IF;

    RETURN jsonb_build_object('success', true, 'batch_number', v_res->>'batch_number');
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.add_inventory_batch(uuid, uuid, uuid, numeric, numeric, text, date, date, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- get_expiring_batches(p_branch_id, p_warehouse_id, p_horizon_days)
-- Lists batches expiring within the horizon (or already expired). Branch-scoped.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_expiring_batches(
  p_branch_id uuid DEFAULT NULL,
  p_warehouse_id uuid DEFAULT NULL,
  p_horizon_days integer DEFAULT 90
) RETURNS TABLE (
  batch_id uuid,
  batch_number text,
  product_id uuid,
  product_name text,
  barcode text,
  warehouse_id uuid,
  warehouse_name text,
  branch_id uuid,
  quantity numeric(14,4),
  unit_cost numeric(12,2),
  production_date date,
  expiry_date date,
  days_to_expiry bigint,
  status text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' STABLE
AS $function$
DECLARE
  v_user_branch uuid;
  v_scope uuid;
  v_horizon integer;
BEGIN
  IF NOT is_pos_admin() THEN
    SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
    v_scope := v_user_branch;
  ELSE
    v_scope := p_branch_id;
  END IF;
  v_horizon := COALESCE(p_horizon_days, 90);
  IF v_horizon < 0 THEN v_horizon := 0; END IF;

  RETURN QUERY
  SELECT
    b.id AS batch_id,
    COALESCE(NULLIF(btrim(b.batch_number), ''), '-') AS batch_number,
    b.product_id,
    COALESCE(NULLIF(btrim(p.name), ''), 'Product') AS product_name,
    p.barcode,
    b.warehouse_id,
    w.name AS warehouse_name,
    b.branch_id,
    b.quantity,
    b.unit_cost,
    b.production_date,
    b.expiry_date,
    CASE WHEN b.expiry_date IS NULL THEN NULL
         ELSE (b.expiry_date - CURRENT_DATE)::bigint END AS days_to_expiry,
    CASE
      WHEN b.expiry_date IS NULL THEN 'none'
      WHEN b.expiry_date < CURRENT_DATE THEN 'expired'
      WHEN b.expiry_date <= CURRENT_DATE + (v_horizon || ' days')::interval THEN 'expiring'
      ELSE 'ok'
    END AS status
  FROM public.inventory_batches b
  JOIN public.products p ON p.id = b.product_id
  LEFT JOIN public.warehouses w ON w.id = b.warehouse_id
  WHERE b.quantity > 0
    AND (v_scope IS NULL OR b.branch_id = v_scope)
    AND (p_warehouse_id IS NULL OR b.warehouse_id = p_warehouse_id)
    AND (b.expiry_date IS NULL
         OR b.expiry_date <= CURRENT_DATE + (v_horizon || ' days')::interval)
  ORDER BY b.expiry_date ASC NULLS LAST, b.branch_id ASC, p.name ASC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_expiring_batches(uuid, uuid, integer) TO authenticated;
