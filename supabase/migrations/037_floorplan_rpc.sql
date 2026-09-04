-- ============================================================================
-- 037. Floor-plan / open-order RPCs (SECURITY DEFINER)
-- ----------------------------------------------------------------------------
-- Hold/recall + table-occupancy need transactional writes that must not be
-- reachable through plain RLS table writes (e.g. freeing a table, flipping an
-- order to completed). These RPCs re-validate the caller's branch exactly like
-- the RLS policies (admin, or own-branch only) and run atomically.
--
--   * create_order      - persist a held cart as an open order; occupies the
--                         chosen table (dine-in).
--   * set_order_status  - open | held | completed | cancelled; completed /
--                         cancelled free the table.
--   * set_table_status  - vacant | occupied | reserved | closed.
-- Additive. All three are idempotent-safe (return success for valid targets).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- create_order: save the current cart as an open/held order
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_order(
  p_branch_id uuid,
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
  p_cashier_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id uuid;
  v_number jsonb;
  v_user_branch uuid;
  v_item jsonb;
  v_product_id uuid;
  v_quantity numeric(14,4);
BEGIN
  BEGIN
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'EMPTY_CART');
    END IF;

    SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
    IF NOT is_pos_admin() AND COALESCE(v_user_branch, '00000000-0000-0000-0000-000000000000'::uuid) <> p_branch_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;

    -- A dine-in order must point at a table in the same branch.
    IF p_table_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.dining_tables WHERE id = p_table_id AND branch_id = p_branch_id AND is_active
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
      IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_product_id AND branch_id = p_branch_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_IN_BRANCH', 'product_id', v_product_id);
      END IF;
    END LOOP;

    v_number := public.next_document_number('order');
    IF NOT (v_number->>'success')::boolean THEN
      RETURN jsonb_build_object('success', false, 'error', 'NUMBERING_FAILED', 'detail', v_number->>'error');
    END IF;

    INSERT INTO public.orders (order_number, branch_id, order_type, status, table_id, customer_id,
      cashier_id, guest_count, notes, subtotal, discount_amount, discount_type, tax_amount, total)
    VALUES (v_number->>'number', p_branch_id, COALESCE(p_order_type, 'dine_in'), 'open', p_table_id,
      p_customer_id, COALESCE(p_cashier_id, auth.uid()), p_guest_count, p_notes,
      COALESCE(p_subtotal, 0), COALESCE(p_discount_amount, 0), COALESCE(p_discount_type, 'amount'),
      COALESCE(p_tax_amount, 0), COALESCE(p_total, 0))
    RETURNING id INTO v_order_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      INSERT INTO public.order_items (order_id, product_id, unit_name, quantity, unit_price,
        discount_amount, bonus_quantity, total, notes)
      VALUES (v_order_id, (v_item->>'product_id')::uuid,
        COALESCE(v_item->>'unit_name', 'piece'),
        COALESCE((v_item->>'quantity')::numeric, 1),
        COALESCE((v_item->>'unit_price')::numeric, 0),
        COALESCE((v_item->>'discount_amount')::numeric, 0),
        COALESCE((v_item->>'bonus_quantity')::numeric, 0),
        COALESCE((v_item->>'total')::numeric, 0),
        NULLIF(v_item->>'notes', ''));
    END LOOP;

    IF p_table_id IS NOT NULL THEN
      UPDATE public.dining_tables SET status = 'occupied', updated_at = now() WHERE id = p_table_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'order_id', v_order_id, 'order_number', v_number->>'number');
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------------
-- set_order_status: open | held | completed | cancelled
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_order_status(p_order_id uuid, p_status text, p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_branch_id uuid;
  v_table_id uuid;
  v_user_branch uuid;
BEGIN
  BEGIN
    IF p_status NOT IN ('open', 'held', 'completed', 'cancelled') THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS');
    END IF;

    SELECT branch_id, table_id INTO v_branch_id, v_table_id
    FROM public.orders WHERE id = p_order_id;
    IF v_branch_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
    END IF;

    SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
    IF NOT is_pos_admin() AND COALESCE(v_user_branch, '00000000-0000-0000-0000-000000000000'::uuid) <> v_branch_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;

    UPDATE public.orders SET status = p_status, updated_at = now(),
      completed_at = CASE WHEN p_status IN ('completed', 'cancelled') THEN now() ELSE NULL END,
      notes = COALESCE(p_notes, notes)
    WHERE id = p_order_id;

    -- Occupied table while open; freed once the order is done.
    IF v_table_id IS NOT NULL THEN
      UPDATE public.dining_tables SET status =
        CASE WHEN p_status IN ('completed', 'cancelled') THEN 'vacant' ELSE 'occupied' END,
        updated_at = now()
      WHERE id = v_table_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'order_id', p_order_id, 'status', p_status);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------------
-- set_table_status: vacant | occupied | reserved | closed
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_table_status(p_table_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_branch_id uuid;
  v_user_branch uuid;
BEGIN
  BEGIN
    IF p_status NOT IN ('vacant', 'occupied', 'reserved', 'closed') THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS');
    END IF;

    SELECT branch_id INTO v_branch_id FROM public.dining_tables WHERE id = p_table_id;
    IF v_branch_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'TABLE_NOT_FOUND');
    END IF;

    SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
    IF NOT is_pos_admin() AND COALESCE(v_user_branch, '00000000-0000-0000-0000-000000000000'::uuid) <> v_branch_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;

    UPDATE public.dining_tables SET status = p_status, updated_at = now() WHERE id = p_table_id;
    RETURN jsonb_build_object('success', true, 'table_id', p_table_id, 'status', p_status);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;
