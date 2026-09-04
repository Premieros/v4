-- P0 Item 2 (Costing): fix ambiguous branch_id in get_order_margin.
--
-- ROOT CAUSE (found by the new product_costing integration test executing
-- get_order_margin(p_branch_id, ...) against a live Postgres):
--   The query joins public.sales s LEFT JOIN public.inventory_ledger il and
--   filters with `(v_scope IS NULL OR s.branch_id = v_scope)`. Both `sales`
--   and `inventory_ledger` have a `branch_id` column, so PostgreSQL raises:
--     column reference "branch_id" is ambiguous
--   whenever the branch predicate is actually evaluated (v_scope NOT NULL,
--   which is the case for every non-admin caller and for admins scoping to a
--   branch). With v_scope NULL the constant-folder drops the predicate and the
--   call appears to work, which is why unit/mocked coverage never caught it.
--
-- FIX: qualify the predicate column as s.branch_id. Signature is unchanged
-- (uuid, date, date), so this is fully backward compatible with the published
-- frontend (api.costing.getOrderMargin) and existing grants. No overload was
-- removed or added.

CREATE OR REPLACE FUNCTION public.get_order_margin(
  p_branch_id uuid DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
) RETURNS TABLE (
  sale_id        uuid,
  invoice_number text,
  branch_id      uuid,
  sale_date      date,
  total          numeric(14,2),
  discount_amount numeric(14,2),
  cogs           numeric(16,2),
  gross_margin   numeric(16,2)
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
    s.id,
    s.invoice_number,
    s.branch_id,
    s.created_at::date,
    COALESCE(s.total, 0),
    COALESCE(s.discount_amount, 0),
    COALESCE(-SUM(il.total_cost), 0)::numeric(16,2) AS cogs,
    round(COALESCE(s.total, 0) - COALESCE(-SUM(il.total_cost), 0), 2)::numeric(16,2) AS gross_margin
  FROM public.sales s
  LEFT JOIN public.inventory_ledger il
    ON il.reference_id = s.id AND il.entry_type = 'sale' AND il.reference_type = 'sale'
  WHERE (v_scope IS NULL OR s.branch_id = v_scope)
    AND (p_from IS NULL OR s.created_at::date >= p_from)
    AND (p_to IS NULL OR s.created_at::date <= p_to)
  GROUP BY s.id
  ORDER BY s.created_at DESC
  LIMIT 500;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_order_margin(uuid, date, date) TO authenticated;
