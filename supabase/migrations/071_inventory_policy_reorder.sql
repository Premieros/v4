-- P0 Inventory Lifecycle: Min/Max + Reorder Point + Low Stock Alerts.
-- Additive-only. Adds the ordering policy columns to products and exposes a
-- branch-scoped low-stock alert query used by the Inventory and Reports UI.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS min_stock numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_stock numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reorder_point numeric(14,4) NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- get_low_stock_alerts(p_branch_id, p_warehouse_id)
-- Returns every product whose on-hand quantity is below its reorder point (or
-- low_stock_threshold when reorder_point is 0). Admins may omit p_branch_id to
-- scan all branches; non-admin users are always forced to their own branch.
-- Rows: product_id, product_name, barcode, sku, warehouse_id, warehouse_name,
--       quantity, min_stock, max_stock, reorder_point, low_stock_threshold,
--       shortage_qty, status ('out' | 'low' | 'ok')
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_low_stock_alerts(
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
  min_stock numeric(14,4),
  max_stock numeric(14,4),
  reorder_point numeric(14,4),
  low_stock_threshold numeric(14,4),
  shortage_qty numeric(14,4),
  status text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' STABLE
AS $function$
DECLARE
  v_user_branch uuid;
  v_scope uuid;
BEGIN
  -- Admins can scope freely; branch staff are locked to their own branch.
  IF NOT is_pos_admin() THEN
    SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
    v_scope := v_user_branch;
  ELSE
    v_scope := p_branch_id;
  END IF;

  RETURN QUERY
  SELECT
    p.id AS product_id,
    COALESCE(NULLIF(btrim(p.name), ''), 'Product') AS product_name,
    p.barcode,
    p.sku,
    s.warehouse_id,
    w.name AS warehouse_name,
    COALESCE(s.branch_id, v_scope) AS branch_id,
    COALESCE(s.quantity, 0) AS quantity,
    COALESCE(p.min_stock, 0) AS min_stock,
    COALESCE(p.max_stock, 0) AS max_stock,
    COALESCE(p.reorder_point, 0) AS reorder_point,
    COALESCE(p.low_stock_threshold, 0) AS low_stock_threshold,
    GREATEST(0, COALESCE(NULLIF(p.reorder_point, 0), p.low_stock_threshold, 0) - COALESCE(s.quantity, 0)) AS shortage_qty,
    CASE
      WHEN COALESCE(s.quantity, 0) <= 0 THEN 'out'
      WHEN COALESCE(s.quantity, 0) < COALESCE(NULLIF(p.reorder_point, 0), p.low_stock_threshold, 0) THEN 'low'
      ELSE 'ok'
    END AS status
  FROM public.products p
  LEFT JOIN LATERAL (
    SELECT
      i.warehouse_id,
      i.branch_id,
      COALESCE(SUM(i.quantity), 0)::numeric(14,4) AS quantity
    FROM public.inventory i
    WHERE i.product_id = p.id
      AND (v_scope IS NULL OR i.branch_id = v_scope)
      AND (p_warehouse_id IS NULL OR i.warehouse_id = p_warehouse_id)
    GROUP BY i.warehouse_id, i.branch_id
  ) s ON true
  LEFT JOIN public.warehouses w ON w.id = s.warehouse_id
  WHERE p.is_active = true
    AND (s.warehouse_id IS NOT NULL OR (p_warehouse_id IS NULL AND v_scope IS NOT NULL)
         OR (p_warehouse_id IS NULL AND v_scope IS NULL AND p.branch_id IS NULL))
  ORDER BY status ASC, branch_id ASC, p.name ASC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_low_stock_alerts(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- get_low_stock_summary(p_branch_id, p_warehouse_id): counts for dashboards.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_low_stock_summary(
  p_branch_id uuid DEFAULT NULL,
  p_warehouse_id uuid DEFAULT NULL
) RETURNS TABLE (out_count bigint, low_count bigint, ok_count bigint)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE
AS $function$
  SELECT
    COUNT(*) FILTER (WHERE status = 'out')::bigint,
    COUNT(*) FILTER (WHERE status = 'low')::bigint,
    COUNT(*) FILTER (WHERE status = 'ok')::bigint
  FROM public.get_low_stock_alerts(p_branch_id, p_warehouse_id);
$function$;

GRANT EXECUTE ON FUNCTION public.get_low_stock_summary(uuid, uuid) TO authenticated;
