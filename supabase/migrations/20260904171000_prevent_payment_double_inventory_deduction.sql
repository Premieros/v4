-- =============================================================================
-- Prevent payment from deducting inventory a second time after Kitchen Send.
--
-- Kitchen Send is the authoritative consumption boundary for quantities sent to
-- the kitchen. process_sale must still deduct direct/non-kitchen quantities,
-- but only the residual quantity that has not already been consumed.
--
-- This migration patches the current process_sale definition additively instead
-- of copying the full function, so later security/accounting fixes remain intact.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sale_inventory_items_after_kitchen(
  p_order_id uuid,
  p_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Direct sales have no kitchen order boundary, so all quantities are due for
  -- sale-time deduction.
  IF p_order_id IS NULL THEN
    RETURN p_items;
  END IF;

  WITH sale_qty AS (
    SELECT
      (item->>'product_id')::uuid AS product_id,
      SUM(COALESCE((item->>'quantity')::numeric, 0)) AS quantity
    FROM jsonb_array_elements(p_items) AS item
    WHERE NULLIF(item->>'product_id', '') IS NOT NULL
    GROUP BY (item->>'product_id')::uuid
  ),
  kitchen_qty AS (
    SELECT
      oi.product_id,
      SUM(LEAST(oi.quantity, COALESCE(s.sent_quantity, 0))) AS quantity
    FROM public.order_items oi
    LEFT JOIN public.order_kitchen_sends s ON s.order_item_id = oi.id
    WHERE oi.order_id = p_order_id
      AND oi.product_id IS NOT NULL
    GROUP BY oi.product_id
  ),
  residual AS (
    SELECT
      sq.product_id,
      GREATEST(sq.quantity - COALESCE(kq.quantity, 0), 0) AS quantity
    FROM sale_qty sq
    LEFT JOIN kitchen_qty kq ON kq.product_id = sq.product_id
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'product_id', product_id,
        'quantity', quantity
      )
      ORDER BY product_id
    ) FILTER (WHERE quantity > 0),
    '[]'::jsonb
  )
  INTO v_result
  FROM residual;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.sale_inventory_items_after_kitchen(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sale_inventory_items_after_kitchen(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sale_inventory_items_after_kitchen(uuid, jsonb) TO service_role;

DO $do$
DECLARE
  v_src text;
  v_old text;
  v_marker text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'process_sale'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_invoice_number text, p_branch_id uuid, p_warehouse_id uuid, p_customer_id uuid, p_salesperson_id uuid, p_subtotal numeric, p_discount_amount numeric, p_discount_type text, p_tax_amount numeric, p_bonus_amount numeric, p_total numeric, p_paid_amount numeric, p_payment_method text, p_status text, p_items jsonb, p_shift_id uuid, p_order_type text, p_table_id uuid, p_order_id uuid, p_guest_count integer';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'process_sale target signature not found';
  END IF;

  -- This is the per-line unit deduction introduced by
  -- 20260819120300_route_process_sale_through_unit_inventory.sql.
  v_old := $old$      v_res := public.deduct_sale_unit_inventory(
        p_branch_id,
        p_warehouse_id,
        jsonb_build_array(v_item),
        v_sale_id,
        p_invoice_number
      );
      IF COALESCE((v_res->>'success')::boolean, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'UNIT_SALE_DEDUCTION_FAILED: %', COALESCE(v_res->>'detail', v_res->>'error', 'unknown');
      END IF;
      v_cogs_total := v_cogs_total + COALESCE((v_res->>'total_cost')::numeric, 0);
$old$;

  IF position(v_old IN v_src) = 0 THEN
    RAISE EXCEPTION 'process_sale unit deduction block changed; refusing unsafe automatic patch';
  END IF;

  -- Remove the per-line deduction. Sale items are still inserted line-by-line;
  -- inventory is deducted once for the residual aggregate immediately after.
  v_src := replace(v_src, v_old, '');

  v_marker := $marker$    -- ===== WRITE PHASE 2b: settle the validated open/held order =====
$marker$;

  IF position(v_marker IN v_src) = 0 THEN
    RAISE EXCEPTION 'process_sale settlement marker changed; refusing unsafe automatic patch';
  END IF;

  v_new := $new$    -- ===== WRITE PHASE 2a: deduct ONLY inventory not already sent to kitchen =====
    v_res := public.deduct_sale_unit_inventory(
      p_branch_id,
      p_warehouse_id,
      public.sale_inventory_items_after_kitchen(p_order_id, p_items),
      v_sale_id,
      p_invoice_number
    );
    IF COALESCE((v_res->>'success')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'UNIT_SALE_DEDUCTION_FAILED: %', COALESCE(v_res->>'detail', v_res->>'error', 'unknown');
    END IF;

    -- Residual quantities contribute their sale-time cost.
    v_cogs_total := COALESCE((v_res->>'total_cost')::numeric, 0);

    -- Quantities already consumed at Kitchen Send still belong to this sale's
    -- COGS even though they must not be deducted again at payment.
    IF p_order_id IS NOT NULL THEN
      SELECT v_cogs_total + COALESCE(SUM((-e.quantity) * COALESCE(e.unit_cost, 0)), 0)
      INTO v_cogs_total
      FROM public.inventory_unit_entries e
      WHERE e.reference_type = 'order'
        AND e.reference_id = p_order_id
        AND e.entry_type = 'kitchen_send'
        AND e.quantity < 0;
    END IF;

$new$;

  v_src := replace(v_src, v_marker, v_new || v_marker);
  EXECUTE v_src;

  -- Fail migration if either invariant is not visible in the final function.
  SELECT pg_get_functiondef(p.oid)
  INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'process_sale'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_invoice_number text, p_branch_id uuid, p_warehouse_id uuid, p_customer_id uuid, p_salesperson_id uuid, p_subtotal numeric, p_discount_amount numeric, p_discount_type text, p_tax_amount numeric, p_bonus_amount numeric, p_total numeric, p_paid_amount numeric, p_payment_method text, p_status text, p_items jsonb, p_shift_id uuid, p_order_type text, p_table_id uuid, p_order_id uuid, p_guest_count integer';

  IF position('sale_inventory_items_after_kitchen(p_order_id, p_items)' IN v_src) = 0 THEN
    RAISE EXCEPTION 'process_sale residual kitchen guard was not installed';
  END IF;

  IF position('jsonb_build_array(v_item)' IN v_src) > 0
     AND position('deduct_sale_unit_inventory' IN v_src) > 0 THEN
    RAISE EXCEPTION 'legacy per-item sale deduction still remains';
  END IF;
END
$do$;
