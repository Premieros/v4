-- ============================================================================
-- 069. Resume-order kitchen sending stays incremental across update_order
-- ----------------------------------------------------------------------------
-- ERP-01 item 4: "previously sent items must not be duplicated to KDS, newly
-- added items must be sent." The authoritative send boundary is 048's
-- order_kitchen_sends (order_item_id UNIQUE) + send_to_kitchen, both correct.
--
-- The bug lived in update_order (046): it rewrote the item lines with
--
--     DELETE FROM public.order_items WHERE order_id = p_order_id;
--
-- then re-inserted every line with a brand-new id. Because order_kitchen_sends
-- references order_item_id ON DELETE CASCADE, any re-persist of an order that
-- had already been sent to the kitchen (e.g. Hold after Send Kitchen, then
-- resume + Send again) silently deleted the send rows and re-sent everything,
-- duplicating kitchen tickets for already-sent items.
--
-- Fix (additive, same signature): update_order now preserves the identity of
-- an existing line when product_id / unit_name / unit_price / discount_amount
-- / bonus_quantity match. Matched lines keep their order_item_id (only
-- quantity/total/notes refresh in place), so their kitchen-send rows survive.
-- Genuinely new lines are inserted (unsent) and vanished lines are deleted
-- (their send rows cascade away). Result:
--
--   * previously sent items are never re-sent on resume/hold/retry;
--   * newly added items send exactly once;
--   * a same-cart re-persist is a no-op for the kitchen (items_sent_count 0).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_order(
  p_order_id uuid,
  p_order_type text DEFAULT 'dine_in',
  p_table_id uuid DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL,
  p_guest_count integer DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_subtotal numeric DEFAULT 0,
  p_discount_amount numeric DEFAULT 0,
  p_discount_type text DEFAULT 'amount',
  p_tax_amount numeric DEFAULT 0,
  p_total numeric DEFAULT 0,
  p_status text DEFAULT 'held'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_branch_id uuid;
  v_old_table uuid;
  v_old_status text;
  v_user_branch uuid;
  v_item jsonb;
  v_product_id uuid;
  v_quantity numeric(14,4);
  v_matched_id uuid;
BEGIN
  BEGIN
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'EMPTY_CART');
    END IF;

    IF p_status NOT IN ('open', 'held') THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS');
    END IF;

    SELECT branch_id, table_id, status INTO v_branch_id, v_old_table, v_old_status
    FROM public.orders WHERE id = p_order_id;
    IF v_branch_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
    END IF;
    IF v_old_status NOT IN ('open', 'held') THEN
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_EDITABLE',
        'detail', 'Only open or held orders can be edited.');
    END IF;

    SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
    IF NOT is_pos_admin() AND COALESCE(v_user_branch, '00000000-0000-0000-0000-000000000000'::uuid) <> v_branch_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;

    -- New table must belong to the order branch and be active.
    IF p_table_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.dining_tables WHERE id = p_table_id AND branch_id = v_branch_id AND is_active
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'TABLE_NOT_IN_BRANCH', 'table_id', p_table_id);
    END IF;

    -- Validate every line before writing anything.
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
      IF v_quantity <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUANTITY', 'product_id', v_product_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_product_id AND branch_id = v_branch_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_IN_BRANCH', 'product_id', v_product_id);
      END IF;
    END LOOP;

    UPDATE public.orders SET
      order_type = COALESCE(p_order_type, order_type),
      table_id = p_table_id,
      customer_id = p_customer_id,
      guest_count = p_guest_count,
      notes = p_notes,
      subtotal = COALESCE(p_subtotal, 0),
      discount_amount = COALESCE(p_discount_amount, 0),
      discount_type = COALESCE(p_discount_type, 'amount'),
      tax_amount = COALESCE(p_tax_amount, 0),
      total = COALESCE(p_total, 0),
      status = p_status,
      updated_at = now()
    WHERE id = p_order_id;

    -- Replace the item lines while PRESERVING the identity of existing lines.
    -- A line keeps its order_item_id when product/unit/price/discount/bonus
    -- match (quantity/total/notes refresh in place), so per-item kitchen-send
    -- state keyed on order_item_id survives re-persists of a sent order.
    CREATE TEMP TABLE IF NOT EXISTS _upd_matched (order_item_id uuid) ON COMMIT DROP;
    TRUNCATE _upd_matched;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := COALESCE((v_item->>'quantity')::numeric, 1);

      v_matched_id := NULL;
      SELECT oi.id INTO v_matched_id
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
        AND oi.product_id = v_product_id
        AND oi.unit_name = COALESCE(v_item->>'unit_name', 'piece')
        AND oi.unit_price = COALESCE((v_item->>'unit_price')::numeric, oi.unit_price)
        AND oi.discount_amount = COALESCE((v_item->>'discount_amount')::numeric, oi.discount_amount)
        AND oi.bonus_quantity = COALESCE((v_item->>'bonus_quantity')::numeric, oi.bonus_quantity)
        AND NOT EXISTS (
          SELECT 1 FROM _upd_matched m WHERE m.order_item_id = oi.id
        )
      LIMIT 1;

      IF v_matched_id IS NOT NULL THEN
        UPDATE public.order_items SET
          quantity = v_quantity,
          total = COALESCE((v_item->>'total')::numeric, 0),
          notes = NULLIF(v_item->>'notes', '')
        WHERE id = v_matched_id;
        INSERT INTO _upd_matched (order_item_id) VALUES (v_matched_id);
      ELSE
        INSERT INTO public.order_items (order_id, product_id, unit_name, quantity, unit_price,
          discount_amount, bonus_quantity, total, notes)
        VALUES (p_order_id, v_product_id,
          COALESCE(v_item->>'unit_name', 'piece'),
          v_quantity,
          COALESCE((v_item->>'unit_price')::numeric, 0),
          COALESCE((v_item->>'discount_amount')::numeric, 0),
          COALESCE((v_item->>'bonus_quantity')::numeric, 0),
          COALESCE((v_item->>'total')::numeric, 0),
          NULLIF(v_item->>'notes', ''))
        RETURNING id INTO v_matched_id;
        -- Protect the brand-new line from the deletion sweep below.
        INSERT INTO _upd_matched (order_item_id) VALUES (v_matched_id);
      END IF;
    END LOOP;

    -- Remove lines that vanished from the cart (their send rows cascade away).
    DELETE FROM public.order_items oi
    WHERE oi.order_id = p_order_id
      AND NOT EXISTS (
        SELECT 1 FROM _upd_matched m WHERE m.order_item_id = oi.id
      );

    -- Occupancy reconciliation: free the OLD table only when the order moved
    -- away/detached AND no other open/held order still references it.
    IF v_old_table IS NOT NULL AND v_old_table IS DISTINCT FROM p_table_id AND NOT EXISTS (
      SELECT 1 FROM public.orders
      WHERE table_id = v_old_table AND status IN ('open', 'held') AND id <> p_order_id
    ) THEN
      UPDATE public.dining_tables SET status = 'vacant', updated_at = now() WHERE id = v_old_table;
    END IF;

    -- Occupy the (new) table for dine-in orders.
    IF p_table_id IS NOT NULL THEN
      UPDATE public.dining_tables SET status = 'occupied', updated_at = now() WHERE id = p_table_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'order_id', p_order_id, 'status', p_status);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;
