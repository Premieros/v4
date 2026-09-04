-- Consolidated bug-fix migration (080). Fixes four issues discovered by
-- integration testing and codebase audit:
--
-- 1. get_low_stock_alerts (071): ambiguous branch_id (P0, same as 076/079)
--    RETURNS TABLE includes branch_id, making the
--    `SELECT branch_id INTO v_user_branch FROM public.users` ambiguous for
--    every non-admin caller.
-- 2. get_expiring_batches (073): identical ambiguous branch_id (P0).
-- 3. get_audit_trail (044): no GRANT EXECUTE TO authenticated — the audit
--    trail page is broken for every non-superuser (P1).
-- 4. send_to_kitchen / set_order_status (048): granted to anon, allowing
--    anonymous callers to bypass branch isolation (P2 security hardening).

-- -------------------------------------------------------------------
-- 1. Fix get_low_stock_alerts — qualify u.branch_id
-- -------------------------------------------------------------------
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
  IF NOT is_pos_admin() THEN
    SELECT u.branch_id INTO v_user_branch FROM public.users u WHERE u.id = auth.uid();
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
    COALESCE(p.reorder_point, 0)::numeric(14,4) AS reorder_point,
    COALESCE(p.low_stock_threshold, 0)::numeric(14,4) AS low_stock_threshold,
    GREATEST(0, COALESCE(NULLIF(p.reorder_point, 0), p.low_stock_threshold::numeric(14,4), 0) - COALESCE(s.quantity, 0)) AS shortage_qty,
    CASE
      WHEN COALESCE(s.quantity, 0) <= 0 THEN 'out'
      WHEN COALESCE(s.quantity, 0) < COALESCE(NULLIF(p.reorder_point, 0), p.low_stock_threshold::numeric(14,4), 0) THEN 'low'
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

-- -------------------------------------------------------------------
-- 2. Fix get_expiring_batches — qualify u.branch_id
-- -------------------------------------------------------------------
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
    SELECT u.branch_id INTO v_user_branch FROM public.users u WHERE u.id = auth.uid();
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

-- -------------------------------------------------------------------
-- 3. Grant get_audit_trail to authenticated (missing since 044)
-- -------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.get_audit_trail(uuid, text, text, date, date, integer) TO authenticated;

-- -------------------------------------------------------------------
-- 4. Revoke anon from kitchen/order-status RPCs (security hardening)
-- -------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.send_to_kitchen(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_order_status(uuid, text, text) FROM anon;
