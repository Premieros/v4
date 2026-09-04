-- P0 Inventory Lifecycle: Stock Valuation.
-- Additive-only. Reports the on-hand quantity and cost value of finished-goods
-- inventory per product/warehouse using the weighted-average batch unit cost,
-- plus a grand total. Branch-scoped like the other reporting functions: admins
-- may pass NULL p_branch_id to scan all branches; branch staff are locked to
-- their own branch.

CREATE OR REPLACE FUNCTION public.get_stock_valuation(
  p_branch_id uuid DEFAULT NULL,
  p_warehouse_id uuid DEFAULT NULL
) RETURNS TABLE (
  product_id uuid,
  product_name text,
  barcode text,
  sku text,
  warehouse_id uuid,
  warehouse_name text,
  branch_id uuid,
  quantity numeric(14,4),
  unit_cost numeric(12,2),
  total_value numeric(16,2)
) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' STABLE
AS $function$
DECLARE
  v_user_branch uuid;
  v_scope uuid;
BEGIN
  IF NOT is_pos_admin() THEN
    SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
    v_scope := v_user_branch;
  ELSE
    v_scope := p_branch_id;
  END IF;

  RETURN QUERY
  WITH val AS (
    SELECT
      b.product_id,
      b.warehouse_id,
      b.branch_id,
      COALESCE(SUM(b.quantity), 0)::numeric(14,4) AS quantity,
      COALESCE(round(SUM(b.quantity * b.unit_cost) / NULLIF(SUM(b.quantity), 0), 2), 0)::numeric(12,2) AS unit_cost
    FROM public.inventory_batches b
    WHERE (v_scope IS NULL OR b.branch_id = v_scope)
      AND (p_warehouse_id IS NULL OR b.warehouse_id = p_warehouse_id)
    GROUP BY b.product_id, b.warehouse_id, b.branch_id
  )
  SELECT
    v.product_id,
    COALESCE(NULLIF(btrim(p.name), ''), 'Product') AS product_name,
    p.barcode,
    p.sku,
    v.warehouse_id,
    w.name AS warehouse_name,
    v.branch_id,
    v.quantity,
    v.unit_cost,
    round(v.quantity * v.unit_cost, 2)::numeric(16,2) AS total_value
  FROM val v
  JOIN public.products p ON p.id = v.product_id
  LEFT JOIN public.warehouses w ON w.id = v.warehouse_id
  WHERE v.quantity > 0
  ORDER BY v.branch_id ASC, p.name ASC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_stock_valuation(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- get_stock_valuation_summary: per-branch and grand totals.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_stock_valuation_summary(
  p_branch_id uuid DEFAULT NULL,
  p_warehouse_id uuid DEFAULT NULL
) RETURNS TABLE (
  branch_id uuid,
  branch_name text,
  total_quantity numeric(14,4),
  total_value numeric(16,2),
  item_count bigint
) LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE
AS $function$
  SELECT
    v.branch_id,
    br.name AS branch_name,
    COALESCE(SUM(v.quantity), 0)::numeric(14,4),
    COALESCE(SUM(v.total_value), 0)::numeric(16,2),
    COUNT(*)::bigint
  FROM public.get_stock_valuation(p_branch_id, p_warehouse_id) v
  LEFT JOIN public.branches br ON br.id = v.branch_id
  GROUP BY v.branch_id, br.name
  ORDER BY br.name ASC;
$function$;

GRANT EXECUTE ON FUNCTION public.get_stock_valuation_summary(uuid, uuid) TO authenticated;
