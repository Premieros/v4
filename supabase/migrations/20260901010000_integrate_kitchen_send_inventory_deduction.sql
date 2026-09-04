-- 20260901010000_integrate_kitchen_send_inventory_deduction.sql
-- Integrates atomic inventory deduction into send_to_kitchen and ensures
-- idempotent, single-deduction kitchen consumption with full UI ticket data returned.

CREATE OR REPLACE FUNCTION public.send_to_kitchen(
  p_order_id uuid,
  p_sent_by uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_branch_id uuid;
  v_status text;
  v_user_branch uuid;
  v_sent_items jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_all_sent boolean := false;
BEGIN
  BEGIN
    SELECT branch_id, status INTO v_branch_id, v_status
    FROM public.orders WHERE id = p_order_id;
    IF v_branch_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
    END IF;
    IF v_status NOT IN ('open', 'held') THEN
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_EDITABLE',
        'detail', 'Only open or held orders can be sent to the kitchen.');
    END IF;

    SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
    IF NOT is_pos_admin() AND COALESCE(v_user_branch, '00000000-0000-0000-0000-000000000000'::uuid) <> v_branch_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;

    -- Snapshot ONLY lines without an existing send row.
    CREATE TEMP TABLE IF NOT EXISTS _kns (order_item_id uuid, send_id uuid) ON COMMIT DROP;
    TRUNCATE _kns;

    WITH newly_sent AS (
      INSERT INTO public.order_kitchen_sends (branch_id, order_id, order_item_id, sent_by)
      SELECT v_branch_id, p_order_id, oi.id, COALESCE(p_sent_by, auth.uid())
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
        AND NOT EXISTS (
          SELECT 1 FROM public.order_kitchen_sends s
          WHERE s.order_item_id = oi.id
        )
      ON CONFLICT (order_item_id) DO NOTHING
      RETURNING id, order_item_id
    )
    INSERT INTO _kns (order_item_id, send_id)
    SELECT order_item_id, id FROM newly_sent;

    SELECT COUNT(*) INTO v_count FROM _kns;

    IF v_count > 0 THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'send_id', k.send_id,
        'order_item_id', k.order_item_id,
        'product_id', oi.product_id,
        'product_name', p.name,
        'unit_name', oi.unit_name,
        'quantity', oi.quantity,
        'unit_price', oi.unit_price,
        'discount_amount', oi.discount_amount,
        'bonus_quantity', oi.bonus_quantity,
        'total', oi.total,
        'notes', oi.notes
      ) ORDER BY oi.created_at), '[]'::jsonb)
      INTO v_sent_items
      FROM _kns k
      JOIN public.order_items oi ON oi.id = k.order_item_id
      LEFT JOIN public.products p ON p.id = oi.product_id;

      -- Execute atomic inventory deduction for the order
      PERFORM public.consume_order_kitchen_inventory(p_order_id, p_sent_by);
    END IF;

    SELECT NOT EXISTS (
      SELECT 1 FROM public.order_items oi
      WHERE oi.order_id = p_order_id
        AND NOT EXISTS (
          SELECT 1 FROM public.order_kitchen_sends s
          WHERE s.order_item_id = oi.id
        )
    ) INTO v_all_sent;

    RETURN jsonb_build_object('success', true,
      'order_id', p_order_id,
      'sent', v_sent_items,
      'items_sent_count', v_count,
      'all_sent', v_all_sent);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.send_to_kitchen(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_to_kitchen(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_to_kitchen(uuid, uuid) TO service_role;
