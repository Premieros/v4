-- ============================================================================
-- 046. update_order RPC + table-occupancy guards
-- ----------------------------------------------------------------------------
-- Fixes audit findings:
--
--   C2  Re-holding a resumed order created a duplicate order. The frontend now
--       routes to update_order when an orderId exists. This RPC rewrites the
--       existing order's items/totals/table/type atomically instead of
--       inserting a second order.
--   H2  No occupancy guard: create_order could open a second order on a table
--       that already has an open/held order; set_table_status could free a
--       table that still has open/held orders. Guards added below.
--   H4  process_sale/set_order_status freed a table purely by the settled
--       order's table_id without checking other open orders on it. update_order
--       reconciles occupancy by re-checking other open/held orders, and the
--       set_table_status guard prevents forced freeing.
--   M4  delete_table could delete a dining table with live open/held orders
--       (FK ON DELETE SET NULL silently detached them). A BEFORE DELETE guard
--       trigger now blocks it.
--
-- All RPCs mirror the branch validation of the floor-plan RPCs (037).
-- Additive migration.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- update_order: rewrite the items + totals of an existing open/held order
-- ---------------------------------------------------------------------------
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

    -- Replace the item lines (same shape create_order writes).
    DELETE FROM public.order_items WHERE order_id = p_order_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      INSERT INTO public.order_items (order_id, product_id, unit_name, quantity, unit_price,
        discount_amount, bonus_quantity, total, notes)
      VALUES (p_order_id, (v_item->>'product_id')::uuid,
        COALESCE(v_item->>'unit_name', 'piece'),
        COALESCE((v_item->>'quantity')::numeric, 1),
        COALESCE((v_item->>'unit_price')::numeric, 0),
        COALESCE((v_item->>'discount_amount')::numeric, 0),
        COALESCE((v_item->>'bonus_quantity')::numeric, 0),
        COALESCE((v_item->>'total')::numeric, 0),
        NULLIF(v_item->>'notes', ''));
    END LOOP;

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

-- update_order is a client-facing RPC (called by the POS frontend), so it
-- keeps its default EXECUTE grant to `authenticated` like the other floor-plan
-- RPCs. Only guard_table_delete below is internal and gets revoked.

-- ---------------------------------------------------------------------------
-- H2: create_order must not open a second order on an occupied table.
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

    -- Occupancy guard: a table that already has an open/held order cannot take
    -- a second order (H2). The one path that legitimately bypasses this is a
    -- manager resuming the SAME order, which routes to update_order instead.
    IF p_table_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.orders
      WHERE table_id = p_table_id AND status IN ('open', 'held')
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'TABLE_BUSY',
        'detail', 'This table already has an open order.');
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
-- H2: set_table_status must not free/reserve/close a table with open orders.
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

    -- Occupancy guard: a table with open/held orders may only be marked
    -- occupied (the status create_order/update_order set). Freeing it here
    -- would desync dining_tables.status from orders.table_id.
    IF EXISTS (
      SELECT 1 FROM public.orders
      WHERE table_id = p_table_id AND status IN ('open', 'held')
    ) AND p_status <> 'occupied' THEN
      RETURN jsonb_build_object('success', false, 'error', 'TABLE_HAS_OPEN_ORDERS',
        'detail', 'Settle or cancel the open order before changing this table.');
    END IF;

    UPDATE public.dining_tables SET status = p_status, updated_at = now() WHERE id = p_table_id;
    RETURN jsonb_build_object('success', true, 'table_id', p_table_id, 'status', p_status);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------------
-- M4: block deleting a dining table that still has open/held orders.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_table_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE table_id = OLD.id AND status IN ('open', 'held')
  ) THEN
    RAISE EXCEPTION 'Cannot delete a table with open orders.';
  END IF;
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS trg_dining_tables_delete_guard ON public.dining_tables;
CREATE TRIGGER trg_dining_tables_delete_guard
  BEFORE DELETE ON public.dining_tables
  FOR EACH ROW EXECUTE FUNCTION public.guard_table_delete();

REVOKE ALL ON FUNCTION public.guard_table_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_table_delete() FROM postgres;
