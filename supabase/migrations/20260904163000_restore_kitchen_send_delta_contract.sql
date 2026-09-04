-- =============================================================================
-- Restore the authoritative kitchen-send contract on top of inventory_units.
--
-- Goals:
--   * Send only the unsent quantity delta for each order item.
--   * Deduct inventory_units exactly once at Send to Kitchen.
--   * Keep order_kitchen_sends as the durable idempotency boundary.
--   * Preserve the JSON contract consumed by POS/KDS.
--   * Use branch-access checks rather than role-name branch bypasses.
--
-- Additive only: no historical migration is edited.
-- =============================================================================

ALTER TABLE public.order_kitchen_sends
  ADD COLUMN IF NOT EXISTS sent_quantity numeric(14,4) NOT NULL DEFAULT 0;

-- Existing snapshots pre-date sent_quantity; treat their current line quantity
-- as already sent so an upgrade cannot resend or rededuct historical lines.
UPDATE public.order_kitchen_sends s
SET sent_quantity = oi.quantity
FROM public.order_items oi
WHERE oi.id = s.order_item_id
  AND s.sent_quantity = 0;

-- Branch-aware RLS that respects explicit multi-branch grants.
DROP POLICY IF EXISTS "auth_select_order_kitchen_sends" ON public.order_kitchen_sends;
CREATE POLICY "auth_select_order_kitchen_sends"
  ON public.order_kitchen_sends FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS "auth_write_order_kitchen_sends" ON public.order_kitchen_sends;
CREATE POLICY "auth_write_order_kitchen_sends"
  ON public.order_kitchen_sends FOR INSERT TO authenticated
  WITH CHECK (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS "auth_write_order_kitchen_sends_upd" ON public.order_kitchen_sends;
CREATE POLICY "auth_write_order_kitchen_sends_upd"
  ON public.order_kitchen_sends FOR UPDATE TO authenticated
  USING (public.user_may_access_branch(branch_id))
  WITH CHECK (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS "auth_write_order_kitchen_sends_del" ON public.order_kitchen_sends;
CREATE POLICY "auth_write_order_kitchen_sends_del"
  ON public.order_kitchen_sends FOR DELETE TO authenticated
  USING (public.user_may_access_branch(branch_id));

-- Kitchen-specific FIFO deduction. This deliberately does not reuse
-- deduct_sale_unit_inventory because kitchen send and payment are distinct
-- accounting boundaries and must have different ledger references.
CREATE OR REPLACE FUNCTION public.deduct_kitchen_unit_inventory(
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_items jsonb,
  p_order_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_item jsonb;
  v_product_id uuid;
  v_quantity numeric(14,4);
  v_link record;
  v_batch record;
  v_need numeric(14,4);
  v_take numeric(14,4);
  v_available numeric(14,4);
  v_total_cost numeric(18,4) := 0;
  v_units jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  IF p_warehouse_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.warehouses w
    WHERE w.id = p_warehouse_id
      AND w.branch_id = p_branch_id
      AND w.is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'WAREHOUSE_NOT_AVAILABLE');
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'units_deducted', '[]'::jsonb,
      'total_cost', 0
    );
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.kitchen_unit_need (
    unit_id uuid PRIMARY KEY,
    unit_name text,
    unit_type text,
    required_qty numeric(14,4) NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.kitchen_unit_need;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := NULLIF(v_item->>'product_id', '')::uuid;
    v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);

    IF v_product_id IS NULL OR v_quantity <= 0 THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'INVALID_QUANTITY',
        'product_id', v_product_id
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = v_product_id
        AND p.branch_id = p_branch_id
        AND p.is_active = true
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'PRODUCT_NOT_IN_BRANCH',
        'product_id', v_product_id
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.product_unit_links pul
      JOIN public.inventory_units iu ON iu.id = pul.unit_id
      WHERE pul.product_id = v_product_id
        AND iu.branch_id = p_branch_id
        AND iu.is_active = true
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'PRODUCT_UNITS_NOT_CONFIGURED',
        'product_id', v_product_id
      );
    END IF;

    FOR v_link IN
      SELECT pul.unit_id, pul.quantity, iu.name AS unit_name, iu.unit_type
      FROM public.product_unit_links pul
      JOIN public.inventory_units iu ON iu.id = pul.unit_id
      WHERE pul.product_id = v_product_id
        AND iu.branch_id = p_branch_id
        AND iu.is_active = true
    LOOP
      INSERT INTO pg_temp.kitchen_unit_need(unit_id, unit_name, unit_type, required_qty)
      VALUES (v_link.unit_id, v_link.unit_name, v_link.unit_type, v_quantity * v_link.quantity)
      ON CONFLICT (unit_id) DO UPDATE
      SET required_qty = pg_temp.kitchen_unit_need.required_qty + EXCLUDED.required_qty;
    END LOOP;
  END LOOP;

  -- Validate the whole delta before mutating any batch.
  FOR v_link IN SELECT * FROM pg_temp.kitchen_unit_need ORDER BY unit_id
  LOOP
    SELECT COALESCE(SUM(quantity), 0)
    INTO v_available
    FROM public.inventory_unit_batches
    WHERE unit_id = v_link.unit_id
      AND branch_id = p_branch_id
      AND warehouse_id = p_warehouse_id;

    IF v_available < v_link.required_qty THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'INSUFFICIENT_UNIT_STOCK',
        'unit_id', v_link.unit_id,
        'required', v_link.required_qty,
        'available', v_available
      );
    END IF;
  END LOOP;

  FOR v_link IN SELECT * FROM pg_temp.kitchen_unit_need ORDER BY unit_id
  LOOP
    v_need := v_link.required_qty;

    FOR v_batch IN
      SELECT id, quantity, unit_cost, batch_number
      FROM public.inventory_unit_batches
      WHERE unit_id = v_link.unit_id
        AND branch_id = p_branch_id
        AND warehouse_id = p_warehouse_id
        AND quantity > 0
      ORDER BY created_at ASC, id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_need <= 0;
      v_take := LEAST(v_need, v_batch.quantity);

      UPDATE public.inventory_unit_batches
      SET quantity = quantity - v_take
      WHERE id = v_batch.id;

      INSERT INTO public.inventory_unit_entries(
        unit_id,
        branch_id,
        warehouse_id,
        quantity,
        unit_cost,
        entry_type,
        reference_type,
        reference_id,
        reference_number,
        batch_number,
        created_by
      ) VALUES (
        v_link.unit_id,
        p_branch_id,
        p_warehouse_id,
        -v_take,
        v_batch.unit_cost,
        'kitchen_send',
        'order',
        p_order_id,
        'KITCHEN-' || p_order_id::text,
        v_batch.batch_number,
        auth.uid()
      );

      v_need := v_need - v_take;
      v_total_cost := v_total_cost + (v_take * COALESCE(v_batch.unit_cost, 0));
    END LOOP;

    v_units := v_units || jsonb_build_object(
      'unit_id', v_link.unit_id,
      'unit_name', v_link.unit_name,
      'unit_type', v_link.unit_type,
      'quantity', v_link.required_qty
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'units_deducted', v_units,
    'total_cost', v_total_cost
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', 'KITCHEN_UNIT_DEDUCTION_FAILED',
    'detail', SQLERRM
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.deduct_kitchen_unit_inventory(uuid, uuid, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deduct_kitchen_unit_inventory(uuid, uuid, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_kitchen_unit_inventory(uuid, uuid, jsonb, uuid) TO service_role;

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
    -- Serialize all sends for one order. This makes the delta calculation safe
    -- even when two clients press Send at nearly the same time.
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

    -- A POS user needs the actual sell permission; role labels are not used as
    -- an action authorization shortcut here.
    IF NOT public.can_permission('pos.sell') THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
    END IF;

    SELECT w.id
    INTO v_warehouse_id
    FROM public.warehouses w
    WHERE w.branch_id = v_branch_id
      AND w.is_active = true
    ORDER BY w.is_default DESC NULLS LAST, w.created_at ASC, w.id ASC
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

    -- Quantity reduction of a line already sent to kitchen is not a normal edit:
    -- it must go through the controlled cancel/void path so stock/waste policy is
    -- explicit and auditable.
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

      -- Only after inventory deduction succeeds do we advance the durable send
      -- boundary. A failed stock validation therefore cannot mark anything sent.
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
