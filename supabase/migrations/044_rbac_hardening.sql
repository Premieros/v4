-- ============================================================================
-- 044. RBAC hardening
-- ----------------------------------------------------------------------------
-- Closes the permission leaks found by the RBAC audit. All changes are
-- additive/idempotent and preserve every legitimate RPC flow (the guarded
-- functions stay SECURITY DEFINER, so internal callers are unaffected).
--
--   1. _post_journal_entry  -> revoke PUBLIC EXECUTE. It was directly
--      callable by ANY authenticated user to post forged journal entries to
--      any branch (all internal callers are SECURITY DEFINER and keep working).
--   2. log_audit_action     -> revoke PUBLIC EXECUTE. Any authenticated user
--      could write audit_log rows for any branch.
--   3. Reconciliation RPCs (add_statement_line / match_bank_line /
--      complete_bank_reconciliation) -> enforce the same role + branch guard
--      that create_bank_reconciliation already had.
--   4. get_audit_trail      -> branch + audit.view guard (previously any
--      authenticated user could read any branch's audit trail).
--   5. RLS write policies on the core catalog/party/warehouse/expense/
--      inventory tables now require the matching `*.manage` permission
--      (view-only roles like cashier can no longer write directly).
--   6. product_units / product_components (previously OPEN with USING(true))
--      are write-gated by products.manage / components.manage.
--   7. shifts / shift_operations direct writes are admin-only; cashier shift
--      lifecycle goes exclusively through open_shift / close_shift /
--      process_sale (SECURITY DEFINER), closing drawer-tampering via RLS.
--   8. Sale discounts require pos.discount (BEFORE INSERT trigger on sales).
--   9. record_login_failure no longer extends an in-force lock (prevents a
--      trivial 5-minute relock DoS).
--  10. Branch managers cannot mint roles that carry admin-only permissions
--      (settings.manage / branches.manage / audit.view).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. _post_journal_entry: internal-only (REVOKE PUBLIC EXECUTE)
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._post_journal_entry(uuid, text, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. log_audit_action: internal-only (REVOKE PUBLIC EXECUTE)
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.log_audit_action(uuid, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Reconciliation RPCs: role + branch guard (mirror create_bank_reconciliation)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_statement_line(
  p_reconciliation_id uuid,
  p_statement_date date,
  p_description text,
  p_amount numeric,
  p_reference text DEFAULT NULL::text
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_recon record;
  v_line_id uuid;
  v_user_branch uuid;
BEGIN
  BEGIN
    IF p_amount IS NULL OR p_amount = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_AMOUNT');
    END IF;

    SELECT id, branch_id, status INTO v_recon
    FROM public.bank_reconciliations WHERE id = p_reconciliation_id;
    IF v_recon.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'RECONCILIATION_NOT_FOUND');
    END IF;
    IF v_recon.status <> 'open' THEN
      RETURN jsonb_build_object('success', false, 'error', 'RECONCILIATION_CLOSED', 'status', v_recon.status);
    END IF;

    IF NOT is_pos_admin() THEN
      IF get_user_role() NOT IN ('accountant', 'branch_manager') THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
          'detail', 'Reconciliation requires the accountant or branch manager role.');
      END IF;
      SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND v_recon.branch_id <> v_user_branch THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    INSERT INTO public.bank_statement_lines (reconciliation_id, statement_date, description, reference, amount)
    VALUES (p_reconciliation_id, p_statement_date, p_description, p_reference, round(p_amount, 2))
    RETURNING id INTO v_line_id;

    RETURN jsonb_build_object('success', true, 'line_id', v_line_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.match_bank_line(
  p_line_id uuid,
  p_journal_entry_id uuid
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_line record;
  v_account uuid;
  v_matched boolean;
  v_entry_amount numeric(14,2);
  v_line_amount numeric(14,2);
  v_user_branch uuid;
BEGIN
  BEGIN
    SELECT l.id, l.reconciliation_id, l.amount, r.status, r.treasury_account_id, r.branch_id
      INTO v_line
    FROM public.bank_statement_lines l
    JOIN public.bank_reconciliations r ON r.id = l.reconciliation_id
    WHERE l.id = p_line_id;
    IF v_line.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'LINE_NOT_FOUND');
    END IF;
    IF v_line.status <> 'open' THEN
      RETURN jsonb_build_object('success', false, 'error', 'RECONCILIATION_CLOSED');
    END IF;

    IF NOT is_pos_admin() THEN
      IF get_user_role() NOT IN ('accountant', 'branch_manager') THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
          'detail', 'Reconciliation requires the accountant or branch manager role.');
      END IF;
      SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND v_line.branch_id <> v_user_branch THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    SELECT t.account_id INTO v_account
    FROM public.treasury_accounts t WHERE t.id = v_line.treasury_account_id;

    -- The journal entry must affect this bank account in the same branch
    SELECT EXISTS (
      SELECT 1 FROM public.journal_entry_lines jl
      JOIN public.journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.journal_entry_id = p_journal_entry_id
        AND jl.account_id = v_account
        AND je.branch_id = v_line.branch_id
    ) INTO v_matched;

    IF NOT v_matched THEN
      RETURN jsonb_build_object('success', false, 'error', 'ENTRY_NOT_ON_ACCOUNT',
        'detail', 'The journal entry does not post to this bank account in this branch.');
    END IF;

    -- The entry's net effect on the account must equal the statement line amount
    SELECT round(SUM(jl.debit - jl.credit), 2)
    INTO v_entry_amount
    FROM public.journal_entry_lines jl
    WHERE jl.journal_entry_id = p_journal_entry_id AND jl.account_id = v_account;

    v_line_amount := round(v_line.amount, 2);
    IF round(COALESCE(v_entry_amount, 0), 2) <> v_line_amount THEN
      RETURN jsonb_build_object('success', false, 'error', 'AMOUNT_MISMATCH',
        'entry_amount', round(COALESCE(v_entry_amount, 0), 2), 'statement_amount', v_line_amount,
        'detail', 'The journal entry effect on the bank account must equal the statement line amount.');
    END IF;

    UPDATE public.bank_statement_lines
      SET matched_journal_entry_id = p_journal_entry_id
      WHERE id = p_line_id;

    RETURN jsonb_build_object('success', true, 'line_id', p_line_id, 'journal_entry_id', p_journal_entry_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_bank_reconciliation(p_reconciliation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_recon record;
  v_total numeric(14,2);
  v_matched_total numeric(14,2);
  v_unmatched numeric(14,2);
  v_user_branch uuid;
BEGIN
  BEGIN
    SELECT id, branch_id, status, statement_balance, book_balance, difference
      INTO v_recon
    FROM public.bank_reconciliations WHERE id = p_reconciliation_id;
    IF v_recon.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'RECONCILIATION_NOT_FOUND');
    END IF;
    IF v_recon.status = 'completed' THEN
      RETURN jsonb_build_object('success', false, 'error', 'ALREADY_COMPLETED');
    END IF;
    IF v_recon.status = 'cancelled' THEN
      RETURN jsonb_build_object('success', false, 'error', 'RECONCILIATION_CANCELLED');
    END IF;

    IF NOT is_pos_admin() THEN
      IF get_user_role() NOT IN ('accountant', 'branch_manager') THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
          'detail', 'Reconciliation requires the accountant or branch manager role.');
      END IF;
      SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND v_recon.branch_id <> v_user_branch THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    SELECT COALESCE(SUM(amount), 0),
           COALESCE(SUM(CASE WHEN matched_journal_entry_id IS NOT NULL THEN amount ELSE 0 END), 0)
    INTO v_total, v_matched_total
    FROM public.bank_statement_lines WHERE reconciliation_id = p_reconciliation_id;

    v_total := round(v_total, 2);
    v_unmatched := round(COALESCE(v_recon.difference, 0) - v_total, 2);

    IF round(v_unmatched, 2) <> 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'RECON_OUT_OF_BALANCE',
        'difference', round(v_recon.difference, 2), 'statement_lines', v_total,
        'outstanding', v_unmatched,
        'detail', 'The statement lines must explain the full difference between the statement and book balances.');
    END IF;

    UPDATE public.bank_reconciliations
      SET status = 'completed', closed_at = now()
      WHERE id = p_reconciliation_id;

    RETURN jsonb_build_object('success', true, 'reconciliation_id', p_reconciliation_id,
      'difference', round(v_recon.difference, 2), 'statement_lines_total', v_total,
      'matched_total', round(v_matched_total, 2));
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. get_audit_trail: branch + audit.view guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_audit_trail(
  p_branch_id uuid,
  p_action text DEFAULT NULL,
  p_entity text DEFAULT NULL,
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL,
  p_limit integer DEFAULT 200
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE AS $function$
SELECT COALESCE(jsonb_agg(row ORDER BY row.created_at DESC), '[]'::jsonb)
FROM (
  SELECT a.id, a.created_at, a.action, a.entity, a.entity_id, a.details,
         a.branch_id, a.user_id, u.full_name AS user_name,
         COALESCE(a.user_email, u.email) AS user_email
  FROM public.audit_log a
  LEFT JOIN public.users u ON u.id = a.user_id
  WHERE a.branch_id = p_branch_id
    AND (is_pos_admin() OR (can_permission('audit.view') AND a.branch_id = get_branch_id()))
    AND (p_action IS NULL OR a.action = p_action)
    AND (p_entity IS NULL OR a.entity = p_entity)
    AND (p_from_date IS NULL OR a.created_at::date >= p_from_date)
    AND (p_to_date IS NULL OR a.created_at::date <= p_to_date)
  ORDER BY a.created_at DESC
  LIMIT p_limit
) row;
$function$;

-- ---------------------------------------------------------------------------
-- 5. RLS write gating: `*.manage` + own branch (SELECT stays branch-scoped)
-- ---------------------------------------------------------------------------

-- products (products.manage)
DROP POLICY IF EXISTS "auth_insert_products" ON public.products;
CREATE POLICY "auth_insert_products" ON public.products FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR (can_permission('products.manage') AND branch_id = get_branch_id()));
DROP POLICY IF EXISTS "auth_update_products" ON public.products;
CREATE POLICY "auth_update_products" ON public.products FOR UPDATE TO authenticated
  USING (is_pos_admin() OR (can_permission('products.manage') AND branch_id = get_branch_id()))
  WITH CHECK (is_pos_admin() OR (can_permission('products.manage') AND branch_id = get_branch_id()));
DROP POLICY IF EXISTS "auth_delete_products" ON public.products;
CREATE POLICY "auth_delete_products" ON public.products FOR DELETE TO authenticated
  USING (is_pos_admin() OR (can_permission('products.manage') AND branch_id = get_branch_id()));

-- categories (categories.manage)
DROP POLICY IF EXISTS "auth_insert_categories" ON public.categories;
CREATE POLICY "auth_insert_categories" ON public.categories FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR (can_permission('categories.manage') AND branch_id = get_branch_id()));
DROP POLICY IF EXISTS "auth_update_categories" ON public.categories;
CREATE POLICY "auth_update_categories" ON public.categories FOR UPDATE TO authenticated
  USING (is_pos_admin() OR (can_permission('categories.manage') AND branch_id = get_branch_id()))
  WITH CHECK (is_pos_admin() OR (can_permission('categories.manage') AND branch_id = get_branch_id()));
DROP POLICY IF EXISTS "auth_delete_categories" ON public.categories;
CREATE POLICY "auth_delete_categories" ON public.categories FOR DELETE TO authenticated
  USING (is_pos_admin() OR (can_permission('categories.manage') AND branch_id = get_branch_id()));

-- customers (customers.manage; cashier holds this by default)
DROP POLICY IF EXISTS "auth_insert_customers" ON public.customers;
CREATE POLICY "auth_insert_customers" ON public.customers FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR (can_permission('customers.manage') AND branch_id = get_branch_id()));
DROP POLICY IF EXISTS "auth_update_customers" ON public.customers;
CREATE POLICY "auth_update_customers" ON public.customers FOR UPDATE TO authenticated
  USING (is_pos_admin() OR (can_permission('customers.manage') AND branch_id = get_branch_id()))
  WITH CHECK (is_pos_admin() OR (can_permission('customers.manage') AND branch_id = get_branch_id()));
DROP POLICY IF EXISTS "auth_delete_customers" ON public.customers;
CREATE POLICY "auth_delete_customers" ON public.customers FOR DELETE TO authenticated
  USING (is_pos_admin() OR (can_permission('customers.manage') AND branch_id = get_branch_id()));

-- suppliers (suppliers.manage)
DROP POLICY IF EXISTS "auth_insert_suppliers" ON public.suppliers;
CREATE POLICY "auth_insert_suppliers" ON public.suppliers FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR (can_permission('suppliers.manage') AND branch_id = get_branch_id()));
DROP POLICY IF EXISTS "auth_update_suppliers" ON public.suppliers;
CREATE POLICY "auth_update_suppliers" ON public.suppliers FOR UPDATE TO authenticated
  USING (is_pos_admin() OR (can_permission('suppliers.manage') AND branch_id = get_branch_id()))
  WITH CHECK (is_pos_admin() OR (can_permission('suppliers.manage') AND branch_id = get_branch_id()));
DROP POLICY IF EXISTS "auth_delete_suppliers" ON public.suppliers;
CREATE POLICY "auth_delete_suppliers" ON public.suppliers FOR DELETE TO authenticated
  USING (is_pos_admin() OR (can_permission('suppliers.manage') AND branch_id = get_branch_id()));

-- warehouses (warehouses.manage; NULL branch stays manageable)
DROP POLICY IF EXISTS "auth_insert_warehouses" ON public.warehouses;
CREATE POLICY "auth_insert_warehouses" ON public.warehouses FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR (can_permission('warehouses.manage') AND (branch_id IS NULL OR branch_id = get_branch_id())));
DROP POLICY IF EXISTS "auth_update_warehouses" ON public.warehouses;
CREATE POLICY "auth_update_warehouses" ON public.warehouses FOR UPDATE TO authenticated
  USING (is_pos_admin() OR (can_permission('warehouses.manage') AND (branch_id IS NULL OR branch_id = get_branch_id())))
  WITH CHECK (is_pos_admin() OR (can_permission('warehouses.manage') AND (branch_id IS NULL OR branch_id = get_branch_id())));
DROP POLICY IF EXISTS "auth_delete_warehouses" ON public.warehouses;
CREATE POLICY "auth_delete_warehouses" ON public.warehouses FOR DELETE TO authenticated
  USING (is_pos_admin() OR (can_permission('warehouses.manage') AND (branch_id IS NULL OR branch_id = get_branch_id())));

-- expenses (expenses.manage)
DROP POLICY IF EXISTS "auth_insert_expenses" ON public.expenses;
CREATE POLICY "auth_insert_expenses" ON public.expenses FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR (can_permission('expenses.manage') AND branch_id = get_branch_id()));
DROP POLICY IF EXISTS "auth_update_expenses" ON public.expenses;
CREATE POLICY "auth_update_expenses" ON public.expenses FOR UPDATE TO authenticated
  USING (is_pos_admin() OR (can_permission('expenses.manage') AND branch_id = get_branch_id()))
  WITH CHECK (is_pos_admin() OR (can_permission('expenses.manage') AND branch_id = get_branch_id()));
DROP POLICY IF EXISTS "auth_delete_expenses" ON public.expenses;
CREATE POLICY "auth_delete_expenses" ON public.expenses FOR DELETE TO authenticated
  USING (is_pos_admin() OR (can_permission('expenses.manage') AND branch_id = get_branch_id()));

-- inventory (inventory.manage)
DROP POLICY IF EXISTS "auth_insert_inventory" ON public.inventory;
CREATE POLICY "auth_insert_inventory" ON public.inventory FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR (can_permission('inventory.manage') AND branch_id = get_branch_id()));
DROP POLICY IF EXISTS "auth_update_inventory" ON public.inventory;
CREATE POLICY "auth_update_inventory" ON public.inventory FOR UPDATE TO authenticated
  USING (is_pos_admin() OR (can_permission('inventory.manage') AND branch_id = get_branch_id()))
  WITH CHECK (is_pos_admin() OR (can_permission('inventory.manage') AND branch_id = get_branch_id()));
DROP POLICY IF EXISTS "auth_delete_inventory" ON public.inventory;
CREATE POLICY "auth_delete_inventory" ON public.inventory FOR DELETE TO authenticated
  USING (is_pos_admin() OR (can_permission('inventory.manage') AND branch_id = get_branch_id()));

-- production_orders (production.manage)
DROP POLICY IF EXISTS "production_orders_write" ON public.production_orders;
CREATE POLICY "production_orders_write" ON public.production_orders FOR ALL TO authenticated
  USING (is_pos_admin() OR (can_permission('production.manage') AND branch_id = get_branch_id()))
  WITH CHECK (is_pos_admin() OR (can_permission('production.manage') AND branch_id = get_branch_id()));

-- ---------------------------------------------------------------------------
-- 6. product_units / product_components: write-gated (were OPEN: USING(true))
-- ---------------------------------------------------------------------------

-- product_units (products.manage, branch via product)
DROP POLICY IF EXISTS "auth_insert_product_units" ON public.product_units;
CREATE POLICY "auth_insert_product_units" ON public.product_units FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR (can_permission('products.manage') AND EXISTS (
    SELECT 1 FROM public.products p WHERE p.id = product_units.product_id
    AND (p.branch_id = get_branch_id() OR p.branch_id IS NULL)
  )));
DROP POLICY IF EXISTS "auth_update_product_units" ON public.product_units;
CREATE POLICY "auth_update_product_units" ON public.product_units FOR UPDATE TO authenticated
  USING (is_pos_admin() OR (can_permission('products.manage') AND EXISTS (
    SELECT 1 FROM public.products p WHERE p.id = product_units.product_id
    AND (p.branch_id = get_branch_id() OR p.branch_id IS NULL)
  )))
  WITH CHECK (is_pos_admin() OR (can_permission('products.manage') AND EXISTS (
    SELECT 1 FROM public.products p WHERE p.id = product_units.product_id
    AND (p.branch_id = get_branch_id() OR p.branch_id IS NULL)
  )));
DROP POLICY IF EXISTS "auth_delete_product_units" ON public.product_units;
CREATE POLICY "auth_delete_product_units" ON public.product_units FOR DELETE TO authenticated
  USING (is_pos_admin() OR (can_permission('products.manage') AND EXISTS (
    SELECT 1 FROM public.products p WHERE p.id = product_units.product_id
    AND (p.branch_id = get_branch_id() OR p.branch_id IS NULL)
  )));

-- product_components (components.manage, branch via product)
DROP POLICY IF EXISTS "auth_insert_product_components" ON public.product_components;
CREATE POLICY "auth_insert_product_components" ON public.product_components FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR (can_permission('components.manage') AND EXISTS (
    SELECT 1 FROM public.products p WHERE p.id = product_components.product_id AND p.branch_id = get_branch_id()
  )));
DROP POLICY IF EXISTS "auth_update_product_components" ON public.product_components;
CREATE POLICY "auth_update_product_components" ON public.product_components FOR UPDATE TO authenticated
  USING (is_pos_admin() OR (can_permission('components.manage') AND EXISTS (
    SELECT 1 FROM public.products p WHERE p.id = product_components.product_id AND p.branch_id = get_branch_id()
  )))
  WITH CHECK (is_pos_admin() OR (can_permission('components.manage') AND EXISTS (
    SELECT 1 FROM public.products p WHERE p.id = product_components.product_id AND p.branch_id = get_branch_id()
  )));
DROP POLICY IF EXISTS "auth_delete_product_components" ON public.product_components;
CREATE POLICY "auth_delete_product_components" ON public.product_components FOR DELETE TO authenticated
  USING (is_pos_admin() OR (can_permission('components.manage') AND EXISTS (
    SELECT 1 FROM public.products p WHERE p.id = product_components.product_id AND p.branch_id = get_branch_id()
  )));

-- ---------------------------------------------------------------------------
-- 7. shifts / shift_operations: direct writes are admin-only
--    (cashier lifecycle goes through the SECURITY DEFINER RPCs)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "auth_insert_shifts" ON public.shifts;
CREATE POLICY "auth_insert_shifts" ON public.shifts FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin());
DROP POLICY IF EXISTS "auth_update_shifts" ON public.shifts;
CREATE POLICY "auth_update_shifts" ON public.shifts FOR UPDATE TO authenticated
  USING (is_pos_admin()) WITH CHECK (is_pos_admin());
DROP POLICY IF EXISTS "auth_delete_shifts" ON public.shifts;
CREATE POLICY "auth_delete_shifts" ON public.shifts FOR DELETE TO authenticated
  USING (is_pos_admin());
DROP POLICY IF EXISTS "auth_insert_shift_operations" ON public.shift_operations;
CREATE POLICY "auth_insert_shift_operations" ON public.shift_operations FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin());

-- ---------------------------------------------------------------------------
-- 8. Sale discounts require pos.discount
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_sale_discount()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $fn$
BEGIN
  IF NEW.discount_amount > 0 AND NOT is_pos_admin() AND NOT can_permission('pos.discount') THEN
    RAISE EXCEPTION 'DISCOUNT_NOT_ALLOWED';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_sales_discount_guard ON public.sales;
CREATE TRIGGER trg_sales_discount_guard
BEFORE INSERT ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.guard_sale_discount();

-- ---------------------------------------------------------------------------
-- 9. record_login_failure: do not extend an in-force lock
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_login_failure(p_username text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.users%ROWTYPE;
  v_new_attempts int;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE username = lower(btrim(p_username));
  IF v_user.id IS NULL THEN
    RETURN jsonb_build_object('success', true);
  END IF;

  -- Already locked for the current window: do not extend / re-lock (anti-DoS).
  IF v_user.is_locked AND v_user.lock_until IS NOT NULL AND v_user.lock_until > now() THEN
    RETURN jsonb_build_object('success', true);
  END IF;

  v_new_attempts := v_user.failed_attempts + 1;
  IF v_new_attempts >= 5 THEN
    UPDATE public.users
    SET failed_attempts = v_new_attempts, is_locked = true, lock_until = now() + interval '5 minutes'
    WHERE id = v_user.id;
  ELSE
    UPDATE public.users SET failed_attempts = v_new_attempts WHERE id = v_user.id;
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- 10. Branch managers cannot mint roles with admin-only permissions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_role_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $fn$
DECLARE
  v_caller_role text;
  v_perm text;
BEGIN
  SELECT role INTO v_caller_role FROM public.users WHERE id = auth.uid();
  IF v_caller_role = 'branch_manager' THEN
    FOR v_perm IN SELECT jsonb_array_elements_text(COALESCE(NEW.permissions, '[]'::jsonb))
    LOOP
      IF v_perm IN ('settings.manage', 'branches.manage', 'audit.view') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: branch managers cannot grant %', v_perm;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_roles_permission_guard ON public.roles;
CREATE TRIGGER trg_roles_permission_guard
BEFORE INSERT OR UPDATE ON public.roles
FOR EACH ROW EXECUTE FUNCTION public.guard_role_permissions();

NOTIFY pgrst, 'reload schema';
