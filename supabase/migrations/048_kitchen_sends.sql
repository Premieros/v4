-- ============================================================================
-- 048. Per-item kitchen tracking: order_kitchen_sends + send_to_kitchen RPC
-- ----------------------------------------------------------------------------
-- The POS "Send Kitchen" button must be idempotent: sending the same order
-- twice (or re-holding a sent order) must never duplicate kitchen tickets or
-- re-send lines that the kitchen already received. The orders/order_items rows
-- are written by create_order (037/046) and update_order (046), which we must
-- not touch, so per-item kitchen state lives in a NEW snapshot table:
--
--   * order_kitchen_sends - one row per order_item that has been sent to the
--                           kitchen (branch_id is denormalized so RLS mirrors
--                           the orders policies without a join; order_item_id
--                           is UNIQUE so a line can only ever be sent once).
--   * send_to_kitchen     - SECURITY DEFINER RPC: snapshots ONLY the items not
--                           yet sent and returns those rows (with the joined
--                           product info) for the client to print the ticket.
--                           A re-send is a no-op: no rows, no duplicates.
--
-- Because update_order rewrites order_items via DELETE + re-insert (new line
-- ids) and order_kitchen_sends cascades on order_items, a line that is edited
-- and re-held simply becomes a new line and is sent once. This matches the
-- current "hold reprints the whole ticket" behavior and never duplicates.
--
-- Defensive hardening (H4 follow-up): set_order_status is the one status RPC
-- with no transition guard; it could resurrect a completed/cancelled order.
-- 048 forbids open/held transitions out of a closed order.
--
-- Table privileges come automatically from 032 ALTER DEFAULT PRIVILEGES; RLS
-- is the security boundary. Additive migration.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- order_kitchen_sends
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_kitchen_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL UNIQUE REFERENCES public.order_items(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  sent_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_order_kitchen_sends_order
  ON public.order_kitchen_sends (order_id);
CREATE INDEX IF NOT EXISTS idx_order_kitchen_sends_branch
  ON public.order_kitchen_sends (branch_id);

ALTER TABLE public.order_kitchen_sends ENABLE ROW LEVEL SECURITY;

-- Same isolation model as orders (admin-or-own-branch), denormalized.
DROP POLICY IF EXISTS "auth_select_order_kitchen_sends" ON public.order_kitchen_sends;
CREATE POLICY "auth_select_order_kitchen_sends" ON public.order_kitchen_sends FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_write_order_kitchen_sends" ON public.order_kitchen_sends;
CREATE POLICY "auth_write_order_kitchen_sends" ON public.order_kitchen_sends FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_write_order_kitchen_sends_upd" ON public.order_kitchen_sends;
CREATE POLICY "auth_write_order_kitchen_sends_upd" ON public.order_kitchen_sends FOR UPDATE TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id())
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_write_order_kitchen_sends_del" ON public.order_kitchen_sends;
CREATE POLICY "auth_write_order_kitchen_sends_del" ON public.order_kitchen_sends FOR DELETE TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());

-- ---------------------------------------------------------------------------
-- send_to_kitchen: snapshot only the unsent lines, return them for printing
-- ---------------------------------------------------------------------------
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

    -- Snapshot ONLY lines without an existing send row. ON CONFLICT DO NOTHING
    -- makes even a concurrent double-send safe (no duplicate rows ever).
    -- IF NOT EXISTS + TRUNCATE lets repeated calls share one transaction.
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

GRANT EXECUTE ON FUNCTION public.send_to_kitchen(uuid, uuid) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- H4 hardening: set_order_status must not reopen a closed order
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
  v_status text;
  v_user_branch uuid;
BEGIN
  BEGIN
    IF p_status NOT IN ('open', 'held', 'completed', 'cancelled') THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS');
    END IF;

    SELECT branch_id, table_id, status INTO v_branch_id, v_table_id, v_status
    FROM public.orders WHERE id = p_order_id;
    IF v_branch_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
    END IF;

    -- A settled/cancelled order is terminal: reopening it after a sale has
    -- posted would desync stock and accounting (H4).
    IF v_status IN ('completed', 'cancelled') AND p_status IN ('open', 'held') THEN
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_CLOSED',
        'detail', 'Completed or cancelled orders cannot be reopened.');
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

GRANT EXECUTE ON FUNCTION public.set_order_status(uuid, text, text) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Realtime: order_items + order_kitchen_sends join the publication so the POS
-- badge/tabs/cards update live when a line is sent or a ticket printed.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  pub_exists boolean;
  tbl text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) INTO pub_exists;

  IF pub_exists THEN
    FOREACH tbl IN ARRAY ARRAY['public.order_items', 'public.order_kitchen_sends'] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables pt
        WHERE pt.pubname = 'supabase_realtime'
          AND pt.schemaname || '.' || pt.tablename = tbl
      ) THEN
        EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE ' || tbl;
      END IF;
    END LOOP;
  END IF;
END $$;
