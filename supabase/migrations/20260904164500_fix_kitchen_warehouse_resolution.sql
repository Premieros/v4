-- =============================================================================
-- Fix kitchen warehouse resolution.
--
-- The preceding kitchen delta migration ordered warehouses by an `is_default`
-- column that does not exist in the canonical warehouses schema. PostgreSQL
-- therefore raised at runtime before any kitchen snapshot could be written.
--
-- Keep the current schema minimal: choose the oldest active warehouse in the
-- order branch deterministically instead of adding an otherwise-unused column.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.send_to_kitchen(
  p_order_id uuid,
  p_sent_by uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_branch_id uuid;
  v_status text;
  v_warehouse_id uuid;
  v_sent_items jsonb := '[]'::jsonb;
  v_delta_items jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_all_sent boolean := false;
  v_deduction jsonb;
BEGIN
  BEGIN
    SELECT branch_id, status
    INTO v_branch_id, v_status
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF v_branch_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
    END IF;

    IF v_status NOT IN ('open', 'held') THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'ORDER_NOT_EDITABLE',
        'detail', 'Only open or held orders can be sent to the kitchen.'
      );
    END IF;

    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
    END IF;

    IF NOT public.user_may_access_branch(v_branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;

    IF NOT public.can_permission('pos.sell') THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
    END IF;

    SELECT w.id
    INTO v_warehouse_id
    FROM public.warehouses w
    WHERE w.branch_id = v_branch_id
      AND w.is_active = true
    ORDER BY w.created_at ASC, w.id ASC
    LIMIT 1;

    IF v_warehouse_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'WAREHOUSE_NOT_AVAILABLE');
    END IF;

    CREATE TEMP TABLE IF NOT EXISTS pg_temp.kitchen_send_delta (
      order_item_id uuid PRIMARY KEY,
      existing_send_id uuid,
      product_id uuid,
      delta_quantity numeric(14,4),
      target_quantity numeric(14,4)
    ) ON COMMIT DROP;
    TRUNCATE pg_temp.kitchen_send_delta;

    INSERT INTO pg_temp.kitchen_send_delta(
      order_item_id,
      existing_send_id,
      product_id,
      delta_quantity,
      target_quantity
    )
    SELECT
      oi.id,
      s.id,
      oi.product_id,
      oi.quantity - COALESCE(s.sent_quantity, 0),
      oi.quantity
    FROM public.order_items oi
    LEFT JOIN public.order_kitchen_sends s ON s.order_item_id = oi.id
    WHERE oi.order_id = p_order_id
      AND oi.quantity <> COALESCE(s.sent_quantity, 0);

    IF EXISTS (
      SELECT 1 FROM pg_temp.kitchen_send_delta
      WHERE existing_send_id IS NOT NULL AND delta_quantity < 0
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'SENT_QUANTITY_DECREASE_REQUIRES_VOID'
      );
    END IF;

    SELECT COALESCE(
      jsonb_agg(jsonb_build_object(
        'product_id', product_id,
        'quantity', delta_quantity
      )),
      '[]'::jsonb
    )
    INTO v_delta_items
    FROM pg_temp.kitchen_send_delta
    WHERE delta_quantity > 0;

    SELECT COUNT(*)::integer
    INTO v_count
    FROM pg_temp.kitchen_send_delta
    WHERE delta_quantity > 0;

    IF v_count > 0 THEN
      v_deduction := public.deduct_kitchen_unit_inventory(
        v_branch_id,
        v_warehouse_id,
        v_delta_items,
        p_order_id
      );

      IF COALESCE((v_deduction->>'success')::boolean, false) IS NOT TRUE THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', COALESCE(v_deduction->>'error', 'KITCHEN_UNIT_DEDUCTION_FAILED'),
          'detail', v_deduction->>'detail',
          'deduction', v_deduction
        );
      END IF;

      INSERT INTO public.order_kitchen_sends(
        branch_id,
        order_id,
        order_item_id,
        sent_at,
        sent_by,
        sent_quantity
      )
      SELECT
        v_branch_id,
        p_order_id,
        d.order_item_id,
        now(),
        COALESCE(p_sent_by, auth.uid()),
        d.target_quantity
      FROM pg_temp.kitchen_send_delta d
      WHERE d.delta_quantity > 0
        AND d.existing_send_id IS NULL
      ON CONFLICT (order_item_id) DO UPDATE
      SET sent_at = EXCLUDED.sent_at,
          sent_by = EXCLUDED.sent_by,
          sent_quantity = EXCLUDED.sent_quantity;

      UPDATE public.order_kitchen_sends s
      SET sent_at = now(),
          sent_by = COALESCE(p_sent_by, auth.uid()),
          sent_quantity = d.target_quantity
      FROM pg_temp.kitchen_send_delta d
      WHERE s.id = d.existing_send_id
        AND d.delta_quantity > 0;

      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'send_id', s.id,
        'order_item_id', oi.id,
        'product_id', oi.product_id,
        'product_name', p.name,
        'unit_name', oi.unit_name,
        'quantity', d.delta_quantity,
        'unit_price', oi.unit_price,
        'discount_amount', oi.discount_amount,
        'bonus_quantity', oi.bonus_quantity,
        'total', d.delta_quantity * oi.unit_price,
        'notes', oi.notes
      ) ORDER BY oi.created_at, oi.id), '[]'::jsonb)
      INTO v_sent_items
      FROM pg_temp.kitchen_send_delta d
      JOIN public.order_items oi ON oi.id = d.order_item_id
      JOIN public.order_kitchen_sends s ON s.order_item_id = oi.id
      LEFT JOIN public.products p ON p.id = oi.product_id
      WHERE d.delta_quantity > 0;
    END IF;

    SELECT NOT EXISTS (
      SELECT 1
      FROM public.order_items oi
      LEFT JOIN public.order_kitchen_sends s ON s.order_item_id = oi.id
      WHERE oi.order_id = p_order_id
        AND oi.quantity > COALESCE(s.sent_quantity, 0)
    ) INTO v_all_sent;

    UPDATE public.orders
    SET kitchen_status = CASE WHEN v_all_sent THEN 'sent' ELSE kitchen_status END,
        updated_at = now()
    WHERE id = p_order_id;

    UPDATE public.dining_tables dt
    SET status = 'occupied', updated_at = now()
    FROM public.orders o
    WHERE o.id = p_order_id
      AND o.table_id = dt.id
      AND dt.status = 'vacant';

    RETURN jsonb_build_object(
      'success', true,
      'order_id', p_order_id,
      'sent', v_sent_items,
      'items_sent_count', v_count,
      'all_sent', v_all_sent
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'TRANSACTION_FAILED',
      'detail', SQLERRM
    );
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.send_to_kitchen(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_to_kitchen(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_to_kitchen(uuid, uuid) TO service_role;
