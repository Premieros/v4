-- =============================================================================
-- POS action authorization: Captain creates/edits/sends; Cashier settles/pays.
-- No role-name authorization shortcuts. Every action requires BOTH a DB
-- permission and explicit branch access (except super_admin implicit access).
-- =============================================================================

-- Small migration-only helper: patch the current function body without copying
-- large RPCs and accidentally losing later lifecycle/accounting fixes.
CREATE OR REPLACE FUNCTION public._migration_replace_function_source(
  p_name text,
  p_identity_args text,
  p_old text,
  p_new text
) RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_src text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = p_name
    AND pg_get_function_identity_arguments(p.oid) = p_identity_args;

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'target function not found: %(%)', p_name, p_identity_args;
  END IF;
  IF position(p_old IN v_src) = 0 THEN
    RAISE EXCEPTION 'authorization marker changed for %; refusing unsafe patch', p_name;
  END IF;

  v_src := replace(v_src, p_old, p_new);
  EXECUTE v_src;
END;
$$;

-- create_order: explicit branch grant + create permission.
SELECT public._migration_replace_function_source(
  'create_order',
  'p_branch_id uuid, p_order_type text, p_table_id uuid, p_customer_id uuid, p_guest_count integer, p_notes text, p_items jsonb, p_subtotal numeric, p_discount_amount numeric, p_discount_type text, p_tax_amount numeric, p_total numeric, p_cashier_id uuid',
  $old$    SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
    IF NOT is_pos_admin() AND COALESCE(v_user_branch, '00000000-0000-0000-0000-000000000000'::uuid) <> p_branch_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;
$old$,
  $new$    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
    END IF;
    IF NOT public.user_may_access_branch(p_branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;
    IF NOT public.can_permission('pos.order.create') THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
    END IF;
$new$
);

-- update_order: explicit branch grant + edit permission.
SELECT public._migration_replace_function_source(
  'update_order',
  'p_order_id uuid, p_order_type text, p_table_id uuid, p_customer_id uuid, p_guest_count integer, p_notes text, p_items jsonb, p_subtotal numeric, p_discount_amount numeric, p_discount_type text, p_tax_amount numeric, p_total numeric, p_status text',
  $old$    SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
    IF NOT is_pos_admin() AND COALESCE(v_user_branch, '00000000-0000-0000-0000-000000000000'::uuid) <> v_branch_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;
$old$,
  $new$    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
    END IF;
    IF NOT public.user_may_access_branch(v_branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;
    IF NOT public.can_permission('pos.order.edit') THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
    END IF;
$new$
);

-- set_order_status: action permission depends on the requested transition.
SELECT public._migration_replace_function_source(
  'set_order_status',
  'p_order_id uuid, p_status text, p_notes text',
  $old$    SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
    IF NOT is_pos_admin() AND COALESCE(v_user_branch, '00000000-0000-0000-0000-000000000000'::uuid) <> v_branch_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;
$old$,
  $new$    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
    END IF;
    IF NOT public.user_may_access_branch(v_branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;
    IF (p_status IN ('open','held') AND NOT public.can_permission('pos.order.hold'))
       OR (p_status = 'cancelled' AND NOT public.can_permission('pos.order.cancel'))
       OR (p_status = 'completed' AND NOT public.can_permission('pos.payment.collect')) THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
    END IF;
$new$
);

-- set_table_status: branch + floor-plan permission.
SELECT public._migration_replace_function_source(
  'set_table_status',
  'p_table_id uuid, p_status text',
  $old$    SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
    IF NOT is_pos_admin() AND COALESCE(v_user_branch, '00000000-0000-0000-0000-000000000000'::uuid) <> v_branch_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;
$old$,
  $new$    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
    END IF;
    IF NOT public.user_may_access_branch(v_branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;
    IF NOT public.can_permission('floor_plan.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
    END IF;
$new$
);

-- send_to_kitchen already has branch-aware authorization; make the action
-- permission specific instead of the broad POS access permission.
SELECT public._migration_replace_function_source(
  'send_to_kitchen',
  'p_order_id uuid, p_sent_by uuid',
  $old$    IF NOT public.can_permission('pos.sell') THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
    END IF;
$old$,
  $new$    IF NOT public.can_permission('pos.order.send_kitchen') THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
    END IF;
$new$
);

-- process_sale: replace the old users.branch_id authorization boundary with
-- explicit multi-branch access and a payment/settlement permission.
SELECT public._migration_replace_function_source(
  'process_sale',
  'p_invoice_number text, p_branch_id uuid, p_warehouse_id uuid, p_customer_id uuid, p_salesperson_id uuid, p_subtotal numeric, p_discount_amount numeric, p_discount_type text, p_tax_amount numeric, p_bonus_amount numeric, p_total numeric, p_paid_amount numeric, p_payment_method text, p_status text, p_items jsonb, p_shift_id uuid, p_order_type text, p_table_id uuid, p_order_id uuid, p_guest_count integer',
  $old$    SELECT role, branch_id INTO v_role, v_user_branch FROM public.users WHERE id = auth.uid();

    -- Branch isolation (mirror of RLS on sales)
    IF NOT is_pos_admin() THEN
      IF v_user_branch IS NOT NULL AND v_user_branch <> p_branch_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;
$old$,
  $new$    SELECT role, branch_id INTO v_role, v_user_branch FROM public.users WHERE id = auth.uid();

    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
    END IF;
    IF NOT public.user_may_access_branch(p_branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;
    IF NOT public.can_permission('pos.payment.collect') THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
    END IF;
$new$
);

-- Defense in depth: no authenticated code path may insert a sale without the
-- settlement permission and branch access, even if a future RPC is added.
CREATE OR REPLACE FUNCTION public.guard_sale_settlement_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF NOT public.user_may_access_branch(NEW.branch_id) THEN
      RAISE EXCEPTION 'BRANCH_MISMATCH';
    END IF;
    IF NOT public.can_permission('pos.payment.collect') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_settlement_authorization ON public.sales;
CREATE TRIGGER trg_sales_settlement_authorization
BEFORE INSERT ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.guard_sale_settlement_insert();

REVOKE ALL ON FUNCTION public.guard_sale_settlement_insert() FROM PUBLIC, anon, authenticated;

DROP FUNCTION public._migration_replace_function_source(text,text,text,text);
