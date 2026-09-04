-- P0 Inventory Lifecycle: fix ambiguous column reference in get_stock_valuation.
--
-- ROOT CAUSE (found by executing the RPC on the local test database, which no
-- integration test had exercised before):
--   The function declares `RETURNS TABLE (... branch_id uuid, ...)`, so
--   `branch_id` exists as a PL/pgSQL output variable in scope. The statement
--     SELECT branch_id INTO v_user_branch FROM public.users ...
--   then fails with:
--     column reference "branch_id" is ambiguous
--     It could refer to either a PL/pgSQL variable or a table column.
--   This path runs for every non-admin (branch-staff) caller, so the valuation
--   page would break for staff even on a DB that has migration 072 applied.
--
-- FIX: qualify the users column (`u.branch_id`). Signature is unchanged
-- (uuid, uuid), so this is fully backward compatible with the published
-- frontend and with any existing grants. No overload was removed or added.

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
    SELECT u.branch_id INTO v_user_branch FROM public.users u WHERE u.id = auth.uid();
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
