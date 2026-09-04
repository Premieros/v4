-- =============================================================
-- Migration: Audit fixes (technical & relationship hardening)
-- Run this in Supabase SQL Editor AFTER migration_branch_products.sql
-- NOTE: This file is safe to re-run. Each function is DROP'd first so it
-- works even when an older deployment defined the function with a different
-- return type (avoids PostgreSQL error 42P13).
--
-- Fixes found by a full project audit:
--   1. Branches can never be deleted when they own a catalog
--      (NOT NULL branch_id + FK ON DELETE SET NULL conflict).
--   2. open_shift rejects admins / branch managers who hold shifts.open.
--   3. get_active_shift always reports 0 cash expenses (dead filter).
--   4. close_shift ignores cash_in / cash_out in drawer reconciliation.
--   5. shift_operations can be written into already-closed shifts.
--   6. product_components RLS lets any authenticated user edit recipes.
--   7. inventory direct INSERT/UPDATE/DELETE bypasses adjust_stock.
--   8. settings INSERT/UPDATE/DELETE open to every branch employee.
--   9. audit_log readable by every branch employee.
--  10. sales DELETE allowed on 'completed' invoices (breaks inventory).
--  11. process_sale trusts client-side prices / totals.
--  12. adjust_stock + process_purchase run without a permission check.
--  13. replace_product_units(): atomic product-unit save (frontend).
-- =============================================================

-- ============ 0. ROLE HELPER ============
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM public.users WHERE users.id = auth.uid();
$$;

-- ============ 1. BRANCH DELETION CONFLICT ============
-- branch_id is NOT NULL on catalog tables but its FK was ON DELETE SET NULL,
-- so deleting a branch that owns products/categories/customers/suppliers
-- always failed with a not-null violation. RESTRICT blocks the delete instead.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname, conrelid::regclass AS tbl
           FROM pg_constraint
           WHERE contype = 'f'
             AND confrelid = 'public.branches'::regclass
             AND conrelid IN ('public.products'::regclass, 'public.categories'::regclass,
                              'public.customers'::regclass, 'public.suppliers'::regclass)
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, c.conname);
  END LOOP;
END $$;

ALTER TABLE public.products   ADD CONSTRAINT products_branch_id_fkey   FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE RESTRICT;
ALTER TABLE public.categories ADD CONSTRAINT categories_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE RESTRICT;
ALTER TABLE public.customers  ADD CONSTRAINT customers_branch_id_fkey  FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE RESTRICT;
ALTER TABLE public.suppliers  ADD CONSTRAINT suppliers_branch_id_fkey  FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE RESTRICT;

-- ============ 2. OPEN SHIFT: allow admins + branch managers ============
DROP FUNCTION IF EXISTS open_shift(uuid, numeric, text);
CREATE OR REPLACE FUNCTION open_shift(p_branch_id uuid, p_opening_amount numeric DEFAULT 0, p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_branch uuid;
  v_shift_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHENTICATED');
  END IF;

  SELECT role, branch_id INTO v_role, v_branch FROM public.users WHERE id = v_uid;
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;

  -- Register operators (cashiers), branch managers and admins open shifts.
  IF NOT is_pos_admin() AND v_role NOT IN ('cashier', 'branch_manager') THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_NOT_ALLOWED',
      'detail', 'Only cashier or branch manager accounts can open a shift');
  END IF;

  IF p_branch_id IS NULL THEN
    IF v_branch IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'NO_BRANCH',
        'detail', 'You have no branch assigned. Ask an admin to set your branch.');
    END IF;
    p_branch_id := v_branch;
  END IF;

  IF NOT is_pos_admin() AND v_branch IS NOT NULL AND v_branch <> p_branch_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  IF EXISTS (SELECT 1 FROM shifts WHERE cashier_id = v_uid AND branch_id = p_branch_id AND status = 'open') THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_ALREADY_OPEN');
  END IF;

  INSERT INTO shifts (branch_id, cashier_id, opening_amount, notes)
  VALUES (p_branch_id, v_uid, COALESCE(p_opening_amount, 0), p_notes)
  RETURNING id INTO v_shift_id;

  INSERT INTO shift_operations (shift_id, operation_type, amount, payment_method, reference_type)
  VALUES (v_shift_id, 'opening', COALESCE(p_opening_amount, 0), 'cash', 'shift_opening');

  RETURN jsonb_build_object('success', true, 'shift_id', v_shift_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', SQLERRM);
END;
$$;

-- ============ 3. GET ACTIVE SHIFT: fix cash-expenses ============
-- DROP first: older deployments created get_active_shift with a different
-- return type, which CREATE OR REPLACE cannot change (42P13).
DROP FUNCTION IF EXISTS get_active_shift(uuid);
CREATE OR REPLACE FUNCTION get_active_shift(p_branch_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_shift record;
  v_cash_sales numeric(14,2);
  v_cash_expenses numeric(14,2);
  v_total_sales numeric(14,2);
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHENTICATED');
  END IF;

  SELECT * INTO v_shift
  FROM shifts
  WHERE cashier_id = v_uid AND status = 'open'
    AND (p_branch_id IS NULL OR branch_id = p_branch_id)
  ORDER BY opened_at DESC LIMIT 1;

  IF v_shift.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'open', false);
  END IF;

  SELECT COALESCE(SUM(amount), 0),
         COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN amount ELSE 0 END), 0)
  INTO v_total_sales, v_cash_sales
  FROM shift_operations
  WHERE shift_id = v_shift.id AND operation_type = 'sale';

  SELECT COALESCE(SUM(amount), 0) INTO v_cash_expenses
  FROM shift_operations
  WHERE shift_id = v_shift.id AND operation_type = 'expense' AND payment_method = 'cash';

  RETURN jsonb_build_object(
    'success', true, 'open', true,
    'shift', jsonb_build_object(
      'id', v_shift.id,
      'branch_id', v_shift.branch_id,
      'cashier_id', v_shift.cashier_id,
      'opened_at', v_shift.opened_at,
      'opening_amount', v_shift.opening_amount,
      'expected', v_shift.opening_amount + v_cash_sales - v_cash_expenses,
      'cash_sales', v_cash_sales,
      'total_sales', v_total_sales,
      'notes', v_shift.notes
    )
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', SQLERRM);
END;
$$;

-- ============ 4. CLOSE SHIFT: reconcile cash_in / cash_out ============
DROP FUNCTION IF EXISTS close_shift(uuid, numeric, text);
CREATE OR REPLACE FUNCTION close_shift(p_shift_id uuid, p_actual_amount numeric, p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_shift record;
  v_expected numeric(14,2);
  v_diff numeric(14,2);
BEGIN
  SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id;
  IF v_shift.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_NOT_FOUND');
  END IF;

  IF v_shift.status = 'closed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_CLOSED');
  END IF;

  IF NOT is_pos_admin()
     AND v_shift.cashier_id <> v_uid
     AND NOT EXISTS (SELECT 1 FROM public.users
                     WHERE id = v_uid AND is_active AND role = 'branch_manager'
                       AND branch_id = v_shift.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_YOUR_SHIFT');
  END IF;

  SELECT COALESCE(v_shift.opening_amount, 0)
       + COALESCE(SUM(CASE WHEN op.operation_type = 'sale'    AND COALESCE(op.payment_method, 'cash') = 'cash' THEN op.amount ELSE 0 END), 0)
       - COALESCE(SUM(CASE WHEN op.operation_type = 'expense' AND COALESCE(op.payment_method, 'cash') = 'cash' THEN op.amount ELSE 0 END), 0)
       - COALESCE(SUM(CASE WHEN op.operation_type = 'refund'  THEN op.amount ELSE 0 END), 0)
       + COALESCE(SUM(CASE WHEN op.operation_type = 'cash_in' THEN op.amount ELSE 0 END), 0)
       - COALESCE(SUM(CASE WHEN op.operation_type = 'cash_out' THEN op.amount ELSE 0 END), 0)
    INTO v_expected
  FROM shift_operations op
  WHERE op.shift_id = p_shift_id;

  v_diff := COALESCE(p_actual_amount, v_expected) - v_expected;

  UPDATE shifts
  SET status = 'closed',
      closed_at = now(),
      expected_amount = v_expected,
      actual_amount = COALESCE(p_actual_amount, v_expected),
      difference = v_diff,
      notes = COALESCE(p_notes, notes)
  WHERE id = p_shift_id;

  RETURN jsonb_build_object('success', true, 'shift_id', p_shift_id,
    'expected', v_expected, 'actual', COALESCE(p_actual_amount, v_expected), 'difference', v_diff);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', SQLERRM);
END;
$$;

-- ============ 5. SHIFT OPERATIONS: only open shifts ============
DROP POLICY IF EXISTS "auth_insert_shift_operations" ON shift_operations;
CREATE POLICY "auth_insert_shift_operations" ON shift_operations FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM shifts s WHERE s.id = shift_operations.shift_id
    AND s.cashier_id = auth.uid() AND s.status = 'open'
  ));

-- ============ 6. PRODUCT COMPONENTS RLS ============
-- Read: any branch staff that can see the manufactured product.
-- Write: admins, branch managers and warehouse managers only.
DROP POLICY IF EXISTS "auth_select_product_components" ON product_components;
CREATE POLICY "auth_select_product_components" ON product_components FOR SELECT TO authenticated
  USING (is_pos_admin() OR EXISTS (
    SELECT 1 FROM products p WHERE p.id = product_components.product_id
    AND (p.branch_id = get_branch_id() OR p.branch_id IS NULL
      OR EXISTS (SELECT 1 FROM branch_products bp WHERE bp.product_id = p.id AND bp.branch_id = get_branch_id() AND bp.is_active))
  ));

DROP POLICY IF EXISTS "auth_insert_product_components" ON product_components;
CREATE POLICY "auth_insert_product_components" ON product_components FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR (get_user_role() IN ('warehouse_manager','branch_manager') AND EXISTS (
    SELECT 1 FROM products p WHERE p.id = product_components.product_id
    AND (p.branch_id = get_branch_id() OR p.branch_id IS NULL
      OR EXISTS (SELECT 1 FROM branch_products bp WHERE bp.product_id = p.id AND bp.branch_id = get_branch_id() AND bp.is_active))
  )));

DROP POLICY IF EXISTS "auth_update_product_components" ON product_components;
CREATE POLICY "auth_update_product_components" ON product_components FOR UPDATE TO authenticated
  USING (is_pos_admin() OR (get_user_role() IN ('warehouse_manager','branch_manager') AND EXISTS (
    SELECT 1 FROM products p WHERE p.id = product_components.product_id
    AND (p.branch_id = get_branch_id() OR p.branch_id IS NULL
      OR EXISTS (SELECT 1 FROM branch_products bp WHERE bp.product_id = p.id AND bp.branch_id = get_branch_id() AND bp.is_active))
  )))
  WITH CHECK (is_pos_admin() OR (get_user_role() IN ('warehouse_manager','branch_manager') AND EXISTS (
    SELECT 1 FROM products p WHERE p.id = product_components.product_id
    AND (p.branch_id = get_branch_id() OR p.branch_id IS NULL
      OR EXISTS (SELECT 1 FROM branch_products bp WHERE bp.product_id = p.id AND bp.branch_id = get_branch_id() AND bp.is_active))
  )));

DROP POLICY IF EXISTS "auth_delete_product_components" ON product_components;
CREATE POLICY "auth_delete_product_components" ON product_components FOR DELETE TO authenticated
  USING (is_pos_admin() OR (get_user_role() IN ('warehouse_manager','branch_manager') AND EXISTS (
    SELECT 1 FROM products p WHERE p.id = product_components.product_id
    AND (p.branch_id = get_branch_id() OR p.branch_id IS NULL
      OR EXISTS (SELECT 1 FROM branch_products bp WHERE bp.product_id = p.id AND bp.branch_id = get_branch_id() AND bp.is_active))
  )));

-- ============ 7. INVENTORY WRITE RLS ============
-- Direct writes must go through the warehouse manager / branch manager
-- (or an admin). Stock movement stays in adjust_stock / process_sale /
-- process_purchase (SECURITY DEFINER, so they are unaffected).
DROP POLICY IF EXISTS "auth_insert_inventory" ON inventory;
CREATE POLICY "auth_insert_inventory" ON inventory FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR (get_user_role() IN ('warehouse_manager','branch_manager') AND EXISTS (
    SELECT 1 FROM warehouses w WHERE w.id = inventory.warehouse_id
    AND (w.branch_id = get_branch_id() OR w.branch_id IS NULL)
  )));

DROP POLICY IF EXISTS "auth_update_inventory" ON inventory;
CREATE POLICY "auth_update_inventory" ON inventory FOR UPDATE TO authenticated
  USING (is_pos_admin() OR (get_user_role() IN ('warehouse_manager','branch_manager') AND EXISTS (
    SELECT 1 FROM warehouses w WHERE w.id = inventory.warehouse_id
    AND (w.branch_id = get_branch_id() OR w.branch_id IS NULL)
  )))
  WITH CHECK (is_pos_admin() OR (get_user_role() IN ('warehouse_manager','branch_manager') AND EXISTS (
    SELECT 1 FROM warehouses w WHERE w.id = inventory.warehouse_id
    AND (w.branch_id = get_branch_id() OR w.branch_id IS NULL)
  )));

DROP POLICY IF EXISTS "auth_delete_inventory" ON inventory;
CREATE POLICY "auth_delete_inventory" ON inventory FOR DELETE TO authenticated
  USING (is_pos_admin() OR (get_user_role() IN ('warehouse_manager','branch_manager') AND EXISTS (
    SELECT 1 FROM warehouses w WHERE w.id = inventory.warehouse_id
    AND (w.branch_id = get_branch_id() OR w.branch_id IS NULL)
  )));

-- ============ 8. SETTINGS WRITE RLS ============
DROP POLICY IF EXISTS "auth_insert_settings" ON settings;
CREATE POLICY "auth_insert_settings" ON settings FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin());

DROP POLICY IF EXISTS "auth_update_settings" ON settings;
CREATE POLICY "auth_update_settings" ON settings FOR UPDATE TO authenticated
  USING (is_pos_admin()) WITH CHECK (is_pos_admin());

DROP POLICY IF EXISTS "auth_delete_settings" ON settings;
CREATE POLICY "auth_delete_settings" ON settings FOR DELETE TO authenticated
  USING (is_pos_admin());

-- ============ 9. AUDIT LOG READ RLS ============
-- audit.view is an admin-only permission; keep the log private.
DROP POLICY IF EXISTS "auth_select_audit_log" ON audit_log;
CREATE POLICY "auth_select_audit_log" ON audit_log FOR SELECT TO authenticated
  USING (is_pos_admin());

-- ============ 10. SALES DELETE RLS ============
-- 'completed' invoices already deducted stock; deleting them directly would
-- desync inventory from the ledger. Only admins may delete them.
DROP POLICY IF EXISTS "auth_delete_sales" ON sales;
CREATE POLICY "auth_delete_sales" ON sales FOR DELETE TO authenticated
  USING (is_pos_admin() OR ((branch_id IS NULL OR branch_id = get_branch_id()) AND status <> 'completed'));

-- ============ 11. PROCESS SALE: authoritative server-side pricing ============
-- Client-supplied unit_price / subtotal / tax / total are ignored and
-- recomputed from the catalog (branch override or products.sale_price) and
-- the settings tax rate. Per-item discount is kept (clamped to the line total).
DROP FUNCTION IF EXISTS process_sale(
  text, uuid, uuid, uuid, uuid,
  numeric, numeric, text, numeric, numeric,
  numeric, numeric, text, text, jsonb
);
DROP FUNCTION IF EXISTS process_sale(
  text, uuid, uuid, uuid, uuid,
  numeric, numeric, text, numeric, numeric,
  numeric, numeric, text, text, jsonb, uuid
);
CREATE OR REPLACE FUNCTION process_sale(
  p_invoice_number text,
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_customer_id uuid,
  p_salesperson_id uuid,
  p_subtotal numeric,
  p_discount_amount numeric,
  p_discount_type text,
  p_tax_amount numeric,
  p_bonus_amount numeric,
  p_total numeric,
  p_paid_amount numeric,
  p_payment_method text,
  p_status text,
  p_items jsonb,
  p_shift_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id uuid;
  v_user_branch uuid;
  v_role text;
  v_shift_id uuid;
  v_item jsonb;
  v_product_id uuid;
  v_quantity numeric(14,4);
  v_unit_price numeric(12,2);
  v_catalog_price numeric(12,2);
  v_price_override numeric(12,2);
  v_discount_amount numeric(14,2);
  v_bonus_quantity numeric(14,4);
  v_item_total numeric(14,2);
  v_subtotal numeric(14,2) := 0;
  v_tax_enabled boolean := false;
  v_tax_rate numeric := 0;
  v_tax numeric(14,2) := 0;
  v_total numeric(14,2) := 0;
  v_comp record;
  v_inv record;
  v_warehouse_ids uuid[];
  v_required numeric(14,4);
  v_available numeric(14,4);
  v_remaining numeric(14,4);
  v_deduct numeric(14,4);
  v_before numeric(14,4);
  v_after numeric(14,4);
  v_cost numeric(12,2);
  v_product_type text;
BEGIN
  BEGIN
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'EMPTY_CART');
    END IF;

    SELECT role, branch_id INTO v_role, v_user_branch FROM public.users WHERE id = auth.uid();

    -- Branch isolation (mirror of RLS on sales)
    IF NOT is_pos_admin() THEN
      IF v_user_branch IS NOT NULL AND v_user_branch <> p_branch_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    -- Shift enforcement for register operators
    IF v_role = 'cashier' AND NOT is_pos_admin() THEN
      IF p_shift_id IS NULL THEN
        SELECT id INTO v_shift_id
        FROM shifts
        WHERE cashier_id = auth.uid() AND branch_id = p_branch_id AND status = 'open'
        ORDER BY opened_at DESC LIMIT 1;
      ELSE
        IF NOT EXISTS (
          SELECT 1 FROM shifts
          WHERE id = p_shift_id AND cashier_id = auth.uid() AND branch_id = p_branch_id AND status = 'open'
        ) THEN
          RETURN jsonb_build_object('success', false, 'error', 'NO_OPEN_SHIFT',
            'detail', 'Open a shift before selling. The sale was not created.');
        END IF;
        v_shift_id := p_shift_id;
      END IF;

      IF v_shift_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_OPEN_SHIFT',
          'detail', 'Open a shift before selling. The sale was not created.');
      END IF;
    END IF;

    -- Stock deduction scope: all active warehouses of the branch
    SELECT array_agg(id) INTO v_warehouse_ids
    FROM warehouses WHERE branch_id = p_branch_id AND is_active = true;

    -- ===== VALIDATION + PRICING PHASE: check every item BEFORE writing =====
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
      IF v_quantity <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUANTITY', 'product_id', v_product_id);
      END IF;

      SELECT product_type INTO v_product_type FROM products WHERE id = v_product_id;
      IF v_product_type IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_FOUND', 'product_id', v_product_id);
      END IF;

      -- Branch product assignment: the product must be assigned & active
      IF NOT EXISTS (
        SELECT 1 FROM branch_products
        WHERE branch_id = p_branch_id AND product_id = v_product_id AND is_active
      ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_ASSIGNED',
          'product_id', v_product_id, 'branch_id', p_branch_id);
      END IF;

      -- Authoritative unit price (branch override > catalog sale price)
      SELECT sale_price INTO v_catalog_price FROM products WHERE id = v_product_id;
      SELECT selling_price INTO v_price_override FROM branch_products
        WHERE branch_id = p_branch_id AND product_id = v_product_id AND is_active;
      v_unit_price := CASE WHEN v_price_override IS NOT NULL AND v_price_override > 0
        THEN v_price_override ELSE COALESCE(v_catalog_price, 0) END;

      -- Item discount (client input) clamped to the line total
      v_discount_amount := GREATEST(COALESCE((v_item->>'discount_amount')::numeric, 0), 0);
      IF v_discount_amount > v_quantity * v_unit_price THEN
        v_discount_amount := v_quantity * v_unit_price;
      END IF;
      v_subtotal := v_subtotal + v_quantity * v_unit_price - v_discount_amount;

      IF v_product_type = 'manufactured' THEN
        IF NOT EXISTS (SELECT 1 FROM product_components WHERE product_id = v_product_id) THEN
          RETURN jsonb_build_object('success', false, 'error', 'NO_RECIPE', 'product_id', v_product_id);
        END IF;
        FOR v_comp IN SELECT component_product_id, quantity FROM product_components WHERE product_id = v_product_id
        LOOP
          v_required := COALESCE(v_comp.quantity, 0) * v_quantity;
          SELECT COALESCE(SUM(quantity), 0) INTO v_available
          FROM inventory
          WHERE product_id = v_comp.component_product_id AND warehouse_id = ANY(v_warehouse_ids);
          IF v_available < v_required THEN
            RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_COMPONENT',
              'product_id', v_product_id, 'component_id', v_comp.component_product_id,
              'required', v_required, 'available', v_available);
          END IF;
        END LOOP;
      ELSE
        SELECT COALESCE(SUM(quantity), 0) INTO v_available
        FROM inventory
        WHERE product_id = v_product_id AND warehouse_id = ANY(v_warehouse_ids);
        IF v_available < v_quantity THEN
          RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_STOCK',
            'product_id', v_product_id, 'required', v_quantity, 'available', v_available);
        END IF;
      END IF;
    END LOOP;

    -- ===== SERVER-SIDE HEADER TOTALS =====
    IF p_discount_amount IS NULL OR p_discount_amount < 0 THEN p_discount_amount := 0; END IF;
    IF p_discount_amount > v_subtotal THEN p_discount_amount := v_subtotal; END IF;
    IF p_paid_amount IS NULL OR p_paid_amount < 0 THEN p_paid_amount := 0; END IF;
    SELECT COALESCE(tax_enabled, false), COALESCE(tax_rate, 0) INTO v_tax_enabled, v_tax_rate
    FROM public.settings LIMIT 1;
    IF v_tax_enabled THEN
      v_tax := ROUND((v_subtotal - p_discount_amount) * v_tax_rate / 100, 2);
    END IF;
    v_total := v_subtotal - p_discount_amount + v_tax;

    -- ===== WRITE PHASE 1: sale header (authoritative totals) =====
    INSERT INTO sales (invoice_number, branch_id, warehouse_id, customer_id, cashier_id, salesperson_id,
      subtotal, discount_amount, discount_type, tax_amount, bonus_amount, total, paid_amount, payment_method, status)
    VALUES (p_invoice_number, p_branch_id, p_warehouse_id, p_customer_id, auth.uid(), p_salesperson_id,
      v_subtotal, p_discount_amount, p_discount_type, v_tax, COALESCE(p_bonus_amount, 0),
      v_total, p_paid_amount, p_payment_method, p_status)
    RETURNING id INTO v_sale_id;

    -- ===== WRITE PHASE 2: items + locked stock deduction + ledger =====
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);

      SELECT sale_price INTO v_catalog_price FROM products WHERE id = v_product_id;
      SELECT selling_price INTO v_price_override FROM branch_products
        WHERE branch_id = p_branch_id AND product_id = v_product_id AND is_active;
      v_unit_price := CASE WHEN v_price_override IS NOT NULL AND v_price_override > 0
        THEN v_price_override ELSE COALESCE(v_catalog_price, 0) END;
      v_discount_amount := GREATEST(COALESCE((v_item->>'discount_amount')::numeric, 0), 0);
      IF v_discount_amount > v_quantity * v_unit_price THEN
        v_discount_amount := v_quantity * v_unit_price;
      END IF;
      v_bonus_quantity := COALESCE((v_item->>'bonus_quantity')::numeric, 0);
      v_item_total := v_quantity * v_unit_price - v_discount_amount;

      INSERT INTO sale_items (sale_id, product_id, unit_name, quantity, unit_price, discount_amount, bonus_quantity, total)
      VALUES (v_sale_id, v_product_id, COALESCE(v_item->>'unit_name', 'piece'),
        v_quantity, v_unit_price, v_discount_amount, v_bonus_quantity, v_item_total);

      SELECT product_type INTO v_product_type FROM products WHERE id = v_product_id;

      IF v_product_type = 'manufactured' THEN
        FOR v_comp IN SELECT component_product_id, quantity FROM product_components WHERE product_id = v_product_id
        LOOP
          v_required := COALESCE(v_comp.quantity, 0) * v_quantity;
          v_remaining := v_required;
          SELECT cost_price INTO v_cost FROM products WHERE id = v_comp.component_product_id;

          FOR v_inv IN SELECT id, warehouse_id, quantity FROM inventory
            WHERE product_id = v_comp.component_product_id AND warehouse_id = ANY(v_warehouse_ids) AND quantity > 0
            ORDER BY quantity DESC
            FOR UPDATE
          LOOP
            IF v_remaining <= 0 THEN EXIT; END IF;
            v_deduct := LEAST(v_inv.quantity, v_remaining);
            v_before := v_inv.quantity;
            v_after := v_inv.quantity - v_deduct;
            UPDATE inventory SET quantity = v_after, updated_at = now() WHERE id = v_inv.id;
            INSERT INTO stock_transactions (product_id, warehouse_id, branch_id, transaction_type,
              component_flow, reference_type, reference_id, quantity, before_quantity, after_quantity, unit_cost, created_by)
            VALUES (v_comp.component_product_id, v_inv.warehouse_id, p_branch_id, 'sale',
              true, 'sale', v_sale_id, -v_deduct, v_before, v_after, v_cost, auth.uid());
            v_remaining := v_remaining - v_deduct;
          END LOOP;

          IF v_remaining > 0 THEN
            RAISE EXCEPTION 'INSUFFICIENT_COMPONENT: product % needs % but only % available',
              v_product_id, v_required, (v_required - v_remaining);
          END IF;
        END LOOP;
      ELSE
        v_remaining := v_quantity;
        SELECT cost_price INTO v_cost FROM products WHERE id = v_product_id;

        FOR v_inv IN SELECT id, warehouse_id, quantity FROM inventory
          WHERE product_id = v_product_id AND warehouse_id = ANY(v_warehouse_ids) AND quantity > 0
          ORDER BY quantity DESC
          FOR UPDATE
        LOOP
          IF v_remaining <= 0 THEN EXIT; END IF;
          v_deduct := LEAST(v_inv.quantity, v_remaining);
          v_before := v_inv.quantity;
          v_after := v_inv.quantity - v_deduct;
          UPDATE inventory SET quantity = v_after, updated_at = now() WHERE id = v_inv.id;
          INSERT INTO stock_transactions (product_id, warehouse_id, branch_id, transaction_type,
            component_flow, reference_type, reference_id, quantity, before_quantity, after_quantity, unit_cost, created_by)
          VALUES (v_product_id, v_inv.warehouse_id, p_branch_id, 'sale',
            false, 'sale', v_sale_id, -v_deduct, v_before, v_after, v_cost, auth.uid());
          v_remaining := v_remaining - v_deduct;
        END LOOP;

        IF v_remaining > 0 THEN
          RAISE EXCEPTION 'INSUFFICIENT_STOCK: product % needs % but only % available',
            v_product_id, v_quantity, (v_quantity - v_remaining);
        END IF;
      END IF;
    END LOOP;

    -- ===== WRITE PHASE 3: log the sale into the active shift =====
    IF v_shift_id IS NOT NULL THEN
      INSERT INTO shift_operations (shift_id, operation_type, amount, payment_method, reference_type, reference_id, created_by)
      VALUES (v_shift_id, 'sale', COALESCE(p_paid_amount, 0), p_payment_method, 'sale', v_sale_id, auth.uid());
    END IF;

    RETURN jsonb_build_object('success', true, 'sale_id', v_sale_id, 'invoice_number', p_invoice_number);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'INSUFFICIENT_COMPONENT%' THEN
      RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_COMPONENT', 'detail', SQLERRM);
    ELSIF SQLERRM LIKE 'INSUFFICIENT_STOCK%' THEN
      RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_STOCK', 'detail', SQLERRM);
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$$;

-- ============ 12. ADJUST STOCK: permission check ============
DROP FUNCTION IF EXISTS adjust_stock(uuid, numeric, text);
CREATE OR REPLACE FUNCTION adjust_stock(
  p_inventory_id uuid,
  p_new_quantity numeric,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv record;
  v_user_branch uuid;
  v_delta numeric(14,4);
BEGIN
  BEGIN
    -- Only admins, branch managers and warehouse managers may adjust stock
    IF NOT is_pos_admin() AND get_user_role() NOT IN ('warehouse_manager','branch_manager') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
        'detail', 'Stock adjustments require the warehouse manager or branch manager role.');
    END IF;

    SELECT i.id, i.product_id, i.warehouse_id, i.quantity, w.branch_id, p.cost_price AS cost
    INTO v_inv
    FROM inventory i
    JOIN warehouses w ON w.id = i.warehouse_id
    JOIN products p ON p.id = i.product_id
    WHERE i.id = p_inventory_id
    FOR UPDATE OF i;

    IF v_inv.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVENTORY_NOT_FOUND');
    END IF;

    -- Branch isolation
    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND v_inv.branch_id IS NOT NULL AND v_user_branch <> v_inv.branch_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    v_delta := p_new_quantity - v_inv.quantity;
    IF v_delta = 0 THEN
      RETURN jsonb_build_object('success', true, 'inventory_id', p_inventory_id, 'no_change', true);
    END IF;

    UPDATE inventory SET quantity = p_new_quantity, updated_at = now() WHERE id = p_inventory_id;
    INSERT INTO stock_transactions (product_id, warehouse_id, branch_id, transaction_type,
      component_flow, reference_type, reference_id, quantity, before_quantity, after_quantity, unit_cost, reason, created_by)
    VALUES (v_inv.product_id, v_inv.warehouse_id, v_inv.branch_id, 'adjustment',
      false, 'adjustment', NULL, v_delta, v_inv.quantity, p_new_quantity, v_inv.cost, p_reason, auth.uid());

    RETURN jsonb_build_object('success', true, 'inventory_id', p_inventory_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$$;

-- ============ 13. PROCESS PURCHASE: permission check ============
DROP FUNCTION IF EXISTS process_purchase(text, uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, text, text, text, jsonb);
CREATE OR REPLACE FUNCTION process_purchase(
  p_invoice_number text,
  p_supplier_id uuid,
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_subtotal numeric,
  p_discount_amount numeric,
  p_tax_amount numeric,
  p_total numeric,
  p_paid_amount numeric,
  p_payment_method text,
  p_status text,
  p_notes text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_purchase_id uuid;
  v_user_branch uuid;
  v_item jsonb;
  v_product_id uuid;
  v_quantity numeric(14,4);
  v_unit_cost numeric(12,2);
  v_inv record;
  v_before numeric(14,4);
  v_after numeric(14,4);
BEGIN
  BEGIN
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'EMPTY_CART');
    END IF;

    -- Only admins, branch managers and warehouse managers create purchases
    IF NOT is_pos_admin() AND get_user_role() NOT IN ('warehouse_manager','branch_manager') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
        'detail', 'Creating purchases requires the purchases.manage permission.');
    END IF;

    -- Branch isolation (mirror of RLS on purchases)
    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND p_branch_id IS NOT NULL AND v_user_branch <> p_branch_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    INSERT INTO purchases (invoice_number, supplier_id, branch_id, warehouse_id, buyer_id,
      subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status, notes)
    VALUES (p_invoice_number, p_supplier_id, p_branch_id, p_warehouse_id, auth.uid(),
      p_subtotal, p_discount_amount, p_tax_amount, p_total, p_paid_amount, p_payment_method, p_status, p_notes)
    RETURNING id INTO v_purchase_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
      v_unit_cost := COALESCE((v_item->>'unit_cost')::numeric, 0);

      INSERT INTO purchase_items (purchase_id, product_id, unit_name, quantity, unit_cost, total)
      VALUES (v_purchase_id, v_product_id, COALESCE(v_item->>'unit_name', 'piece'),
        v_quantity, v_unit_cost, v_quantity * v_unit_cost);

      -- Inventory only when a warehouse is selected (keeps previous optional behavior)
      IF p_warehouse_id IS NOT NULL THEN
        SELECT id, quantity INTO v_inv
        FROM inventory
        WHERE product_id = v_product_id AND warehouse_id = p_warehouse_id
        FOR UPDATE;

        IF v_inv.id IS NULL THEN
          INSERT INTO inventory (product_id, warehouse_id, quantity)
          VALUES (v_product_id, p_warehouse_id, v_quantity)
          RETURNING id, quantity INTO v_inv;
          v_before := 0;
          v_after := v_inv.quantity;
        ELSE
          v_before := v_inv.quantity;
          v_after := v_before + v_quantity;
          UPDATE inventory SET quantity = v_after, updated_at = now() WHERE id = v_inv.id;
        END IF;

        INSERT INTO stock_transactions (product_id, warehouse_id, branch_id, transaction_type,
          component_flow, reference_type, reference_id, quantity, before_quantity, after_quantity, unit_cost, created_by)
        VALUES (v_product_id, p_warehouse_id, p_branch_id, 'purchase',
          false, 'purchase', v_purchase_id, v_quantity, v_before, v_after, v_unit_cost, auth.uid());
      END IF;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'purchase_id', v_purchase_id, 'invoice_number', p_invoice_number);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$$;

-- ============ 14. ATOMIC PRODUCT-UNIT REPLACEMENT ============
-- Used by ProductsPage so delete+insert of product_units runs in one
-- transaction instead of two non-atomic HTTP requests.
DROP FUNCTION IF EXISTS replace_product_units(uuid, jsonb);
CREATE OR REPLACE FUNCTION replace_product_units(p_product_id uuid, p_units jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unit jsonb;
  v_name text;
  v_product_branch uuid;
BEGIN
  BEGIN
    SELECT branch_id INTO v_product_branch FROM public.products WHERE id = p_product_id;
    IF v_product_branch IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_FOUND');
    END IF;

    IF NOT is_pos_admin() AND NOT (
      get_user_role() IN ('warehouse_manager','branch_manager')
      AND (v_product_branch = get_branch_id()
        OR EXISTS (SELECT 1 FROM branch_products WHERE product_id = p_product_id AND branch_id = get_branch_id() AND is_active))
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;

    DELETE FROM public.product_units WHERE product_id = p_product_id;

    IF p_units IS NOT NULL THEN
      FOR v_unit IN SELECT * FROM jsonb_array_elements(p_units)
      LOOP
        v_name := COALESCE(v_unit->>'unit_name', '');
        IF v_name <> '' THEN
          INSERT INTO public.product_units
            (product_id, unit_name, unit_name_en, conversion_factor, sale_price, cost_price, barcode, is_base)
          VALUES (p_product_id, v_name, COALESCE(v_unit->>'unit_name_en', v_name),
            COALESCE((v_unit->>'conversion_factor')::numeric, 1),
            COALESCE((v_unit->>'sale_price')::numeric, 0),
            COALESCE((v_unit->>'cost_price')::numeric, 0),
            NULLIF(v_unit->>'barcode', ''),
            COALESCE((v_unit->>'is_base')::boolean, false));
        END IF;
      END LOOP;
    END IF;

    RETURN jsonb_build_object('success', true);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$$;

-- ============ 15. FULL SHIFTS SYSTEM REBUILD ============
-- The live database can still hold a LEGACY shifts table (created by an older
-- deployment) whose columns do NOT match this project: no opening_amount and
-- no FK to users. That breaks column selects AND PostgREST embeds, regardless
-- of schema-cache reloads. Rebuild the tables from scratch.
--   * Old tables are preserved as shifts_legacy_<ts> / shift_operations_legacy_<ts>
--     (renamed, never dropped) so nothing is permanently lost.
--   * Idempotent: the rename only happens when the current shifts table is
--     missing the canonical opening_amount column, so re-running this file is
--     safe and will not wipe freshly created shift data.
DO $$
DECLARE
  v_ts text := to_char(now(), 'YYYYMMDD_HH24MISS');
  v_c record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'shifts')
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'shifts' AND column_name = 'opening_amount'
     ) THEN
    -- Free the canonical index names (shifts_pkey is schema-wide) before the
    -- rebuilt tables are created, otherwise CREATE TABLE clashes with the
    -- legacy index name. CASCADE also drops any legacy FK that depended on it.
    FOR v_c IN SELECT conname FROM pg_constraint
               WHERE conrelid = 'public.shifts'::regclass AND contype = 'p'
    LOOP
      EXECUTE format('ALTER TABLE public.shifts DROP CONSTRAINT %I CASCADE', v_c.conname);
    END LOOP;
    EXECUTE format('ALTER TABLE public.shifts RENAME TO shifts_legacy_%s', v_ts);

    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'shift_operations') THEN
      FOR v_c IN SELECT conname FROM pg_constraint
                 WHERE conrelid = 'public.shift_operations'::regclass AND contype = 'p'
      LOOP
        EXECUTE format('ALTER TABLE public.shift_operations DROP CONSTRAINT %I CASCADE', v_c.conname);
      END LOOP;
      EXECUTE format('ALTER TABLE public.shift_operations RENAME TO shift_operations_legacy_%s', v_ts);
    END IF;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  cashier_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  opening_amount numeric(14,2) NOT NULL DEFAULT 0,
  expected_amount numeric(14,2) NOT NULL DEFAULT 0,
  actual_amount numeric(14,2),
  difference numeric(14,2) DEFAULT 0,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  notes text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.shift_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  operation_type text NOT NULL CHECK (operation_type IN ('sale', 'refund', 'expense', 'cash_in', 'cash_out', 'opening')),
  amount numeric(14,2) NOT NULL DEFAULT 0,
  payment_method text,
  reference_type text,
  reference_id uuid,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.shift_operations ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_shifts_branch  ON public.shifts(branch_id);
CREATE INDEX IF NOT EXISTS idx_shifts_cashier ON public.shifts(cashier_id);
CREATE INDEX IF NOT EXISTS idx_shifts_status  ON public.shifts(status);
CREATE INDEX IF NOT EXISTS idx_shift_ops_shift ON public.shift_operations(shift_id);

DROP POLICY IF EXISTS "auth_select_shifts" ON public.shifts;
CREATE POLICY "auth_select_shifts" ON public.shifts FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id() OR cashier_id = auth.uid());
DROP POLICY IF EXISTS "auth_insert_shifts" ON public.shifts;
CREATE POLICY "auth_insert_shifts" ON public.shifts FOR INSERT TO authenticated
  WITH CHECK (cashier_id = auth.uid() AND (branch_id = get_branch_id() OR is_pos_admin()));
DROP POLICY IF EXISTS "auth_update_shifts" ON public.shifts;
CREATE POLICY "auth_update_shifts" ON public.shifts FOR UPDATE TO authenticated
  USING (is_pos_admin() OR cashier_id = auth.uid())
  WITH CHECK (is_pos_admin() OR cashier_id = auth.uid());
DROP POLICY IF EXISTS "auth_delete_shifts" ON public.shifts;
CREATE POLICY "auth_delete_shifts" ON public.shifts FOR DELETE TO authenticated
  USING (is_pos_admin());

DROP POLICY IF EXISTS "auth_select_shift_operations" ON public.shift_operations;
CREATE POLICY "auth_select_shift_operations" ON public.shift_operations FOR SELECT TO authenticated
  USING (is_pos_admin() OR EXISTS (
    SELECT 1 FROM shifts s WHERE s.id = shift_operations.shift_id
    AND (s.branch_id = get_branch_id() OR s.cashier_id = auth.uid())
  ));
DROP POLICY IF EXISTS "auth_insert_shift_operations" ON public.shift_operations;
CREATE POLICY "auth_insert_shift_operations" ON public.shift_operations FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM shifts s WHERE s.id = shift_operations.shift_id
    AND s.cashier_id = auth.uid() AND s.status = 'open'
  ));

-- ============ 16. SHIFTS FK GUARANTEE ============
-- Legacy databases created the shifts table before this FK existed, so the
-- PostgREST embed cashier:users!shifts_cashier_id_fkey fails with a
-- "could not find a relationship" error (PGRST200) until the constraint is
-- actually present. Drop any legacy shifts->users FK and re-add the
-- canonical one so the relationship always resolves after schema reload.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'public.shifts'::regclass
             AND contype = 'f'
             AND confrelid = 'public.users'::regclass
  LOOP
    EXECUTE format('ALTER TABLE public.shifts DROP CONSTRAINT %I', r.conname);
  END LOOP;

  ALTER TABLE public.shifts
    ADD CONSTRAINT shifts_cashier_id_fkey
    FOREIGN KEY (cashier_id) REFERENCES public.users(id) ON DELETE CASCADE;
END $$;

-- ============ 17. CORE USER FOREIGN KEYS ============
-- Preserved from the (now consolidated) phase-1 migration so a fresh build
-- always has referential integrity between users and the business tables.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_cashier_id_fkey') THEN
    ALTER TABLE sales ADD CONSTRAINT sales_cashier_id_fkey
      FOREIGN KEY (cashier_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_salesperson_id_fkey') THEN
    ALTER TABLE sales ADD CONSTRAINT sales_salesperson_id_fkey
      FOREIGN KEY (salesperson_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchases_buyer_id_fkey') THEN
    ALTER TABLE purchases ADD CONSTRAINT purchases_buyer_id_fkey
      FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_created_by_fkey') THEN
    ALTER TABLE expenses ADD CONSTRAINT expenses_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_log_user_id_fkey') THEN
    ALTER TABLE audit_log ADD CONSTRAINT audit_log_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============ 18. SETTINGS EXPANSION ============
-- Adds the configurable brand/pos/invoice/receipt/inventory columns to the
-- global settings row and creates a per-branch settings table. Branch
-- settings override the global ones where a value is set (NULL = fall back
-- to the global setting).

ALTER TABLE settings ADD COLUMN IF NOT EXISTS brand_color text;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS pos_default_payment_method text DEFAULT 'cash';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS pos_barcode_autofocus boolean DEFAULT true;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS pos_line_discount boolean DEFAULT true;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS invoice_prefix text DEFAULT 'INV-';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS invoice_next_number bigint DEFAULT 1;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS invoice_decimal_places integer DEFAULT 2;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS receipt_width_mm integer DEFAULT 58;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS receipt_copies integer DEFAULT 1;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS receipt_auto_print boolean DEFAULT true;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS receipt_show_tax boolean DEFAULT true;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS receipt_show_qr boolean DEFAULT true;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS low_stock_threshold numeric(12,2) DEFAULT 5;

CREATE TABLE IF NOT EXISTS branch_settings (
  branch_id uuid PRIMARY KEY REFERENCES branches(id) ON DELETE CASCADE,
  receipt_header text,
  receipt_footer text,
  logo_url text,
  tax_rate numeric(5,2),
  tax_enabled boolean,
  currency text,
  low_stock_threshold numeric(12,2),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE branch_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_branch_settings" ON branch_settings;
CREATE POLICY "auth_select_branch_settings" ON branch_settings FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_write_branch_settings" ON branch_settings;
CREATE POLICY "auth_write_branch_settings" ON branch_settings FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR (is_branch_manager() AND branch_id = get_branch_id()));
DROP POLICY IF EXISTS "auth_write_branch_settings_upd" ON branch_settings;
CREATE POLICY "auth_write_branch_settings_upd" ON branch_settings FOR UPDATE TO authenticated
  USING (is_pos_admin() OR (is_branch_manager() AND branch_id = get_branch_id()))
  WITH CHECK (is_pos_admin() OR (is_branch_manager() AND branch_id = get_branch_id()));
DROP POLICY IF EXISTS "auth_write_branch_settings_del" ON branch_settings;
CREATE POLICY "auth_write_branch_settings_del" ON branch_settings FOR DELETE TO authenticated
  USING (is_pos_admin() OR (is_branch_manager() AND branch_id = get_branch_id()));

-- ============ 19. ROLE-BASED PERMISSIONS + ROLE CLEANUP ============
-- Removes the kitchen / customer_display roles, drops the per-user
-- permissions override (users.permissions) and introduces a DB-backed
-- `roles` table so each role's permissions are editable from Settings.
-- Any user on a removed role is safely demoted to cashier.

-- 19a. Recreate the users.role CHECK without kitchen / customer_display.
-- Demote any user still on a removed role BEFORE re-adding the constraint,
-- otherwise ADD CONSTRAINT would fail on the existing violating rows.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

UPDATE users SET role = 'cashier'
  WHERE role NOT IN ('super_admin', 'owner', 'branch_manager', 'cashier', 'warehouse_manager', 'accountant');

ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('super_admin', 'owner', 'branch_manager', 'cashier', 'warehouse_manager', 'accountant'));

-- 19b. roles table (permission matrix, editable from Settings)
CREATE TABLE IF NOT EXISTS roles (
  role text PRIMARY KEY,
  name_ar text NOT NULL,
  name_en text NOT NULL,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_roles" ON roles;
CREATE POLICY "auth_select_roles" ON roles FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_write_roles" ON roles;
CREATE POLICY "auth_write_roles" ON roles FOR INSERT TO authenticated WITH CHECK (is_pos_admin());
DROP POLICY IF EXISTS "auth_write_roles_upd" ON roles;
CREATE POLICY "auth_write_roles_upd" ON roles FOR UPDATE TO authenticated USING (is_pos_admin()) WITH CHECK (is_pos_admin());
DROP POLICY IF EXISTS "auth_write_roles_del" ON roles;
CREATE POLICY "auth_write_roles_del" ON roles FOR DELETE TO authenticated USING (is_pos_admin());

-- 19c. Seed defaults (ON CONFLICT preserves any edits made from Settings)
INSERT INTO roles (role, name_ar, name_en, permissions) VALUES
  ('super_admin', 'مدير عام', 'Super Admin',
   '["dashboard.view","pos.sell","products.view","products.manage","products.assign","categories.view","categories.manage","components.view","components.manage","purchases.view","purchases.manage","inventory.view","inventory.manage","warehouses.view","warehouses.manage","customers.view","customers.manage","suppliers.view","suppliers.manage","expenses.view","expenses.manage","sales.view","refunds.approve","reports.view","shifts.view","shifts.open","shifts.close","shifts.manage","users.view","users.manage","audit.view","settings.manage","branches.manage"]'::jsonb),
  ('owner', 'مالك', 'Owner',
   '["dashboard.view","pos.sell","products.view","products.manage","products.assign","categories.view","categories.manage","components.view","components.manage","purchases.view","purchases.manage","inventory.view","inventory.manage","warehouses.view","warehouses.manage","customers.view","customers.manage","suppliers.view","suppliers.manage","expenses.view","expenses.manage","sales.view","refunds.approve","reports.view","shifts.view","shifts.open","shifts.close","shifts.manage","users.view","users.manage","audit.view","settings.manage","branches.manage"]'::jsonb),
  ('branch_manager', 'مدير فرع', 'Branch Manager',
   '["dashboard.view","pos.sell","products.view","products.manage","categories.view","categories.manage","components.view","components.manage","purchases.view","purchases.manage","inventory.view","inventory.manage","warehouses.view","warehouses.manage","customers.view","customers.manage","suppliers.view","suppliers.manage","expenses.view","expenses.manage","sales.view","refunds.approve","shifts.view","shifts.open","shifts.close","shifts.manage","reports.view","users.view","users.manage"]'::jsonb),
  ('cashier', 'أمين صندوق', 'Cashier',
   '["dashboard.view","pos.sell","products.view","customers.view","customers.manage","inventory.view","sales.view","shifts.view","shifts.open","shifts.close"]'::jsonb),
  ('warehouse_manager', 'مدير مخازن', 'Warehouse Manager',
   '["dashboard.view","products.view","products.manage","categories.view","categories.manage","components.view","components.manage","inventory.view","inventory.manage","warehouses.view","warehouses.manage","purchases.view","purchases.manage","suppliers.view","suppliers.manage","shifts.view"]'::jsonb),
  ('accountant', 'محاسب', 'Accountant',
   '["dashboard.view","sales.view","purchases.view","expenses.view","expenses.manage","inventory.view","customers.view","suppliers.view","reports.view","shifts.view"]'::jsonb)
ON CONFLICT (role) DO NOTHING;

-- 19d. Drop the per-user permission override column (role-only model)
ALTER TABLE users DROP COLUMN IF EXISTS permissions;

-- ============ 20. REFUNDS ============
-- Tracks partial/full refunds on sales and restocks inventory using the
-- same stock_transactions ledger written by process_sale (transaction_type
-- 'refund'). Refund approvals follow the `refunds.approve` permission from
-- the `roles` table (admins and branch managers by default).

-- 20a. Refund tracking columns (idempotent)
ALTER TABLE sales ADD COLUMN IF NOT EXISTS refunded_amount numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS refunded_quantity numeric(14,4) NOT NULL DEFAULT 0;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS refunded_amount numeric(14,2) NOT NULL DEFAULT 0;

-- 20a.1 Allow 'refund' in the stock_transactions ledger (process_refund restocks
-- via the same table; the original CHECK only allowed sale/purchase/adjustment).
ALTER TABLE stock_transactions DROP CONSTRAINT IF EXISTS stock_transactions_transaction_type_check;
ALTER TABLE stock_transactions ADD CONSTRAINT stock_transactions_transaction_type_check
  CHECK (transaction_type IN ('sale', 'purchase', 'adjustment', 'refund'));

-- 20b. Permission helper: does the current user hold a dotted permission?
DROP FUNCTION IF EXISTS can_permission(text);
CREATE OR REPLACE FUNCTION can_permission(p_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_pos_admin() OR EXISTS (
    SELECT 1 FROM users u
    JOIN roles r ON r.role = u.role
    WHERE u.id = auth.uid() AND r.permissions ? p_permission
  );
$$;

-- 20c. process_refund: full refund when p_items is NULL/empty, partial otherwise.
-- p_items format: [{"sale_item_id": uuid, "quantity": numeric}]
DROP FUNCTION IF EXISTS process_refund(uuid, jsonb, text);
CREATE OR REPLACE FUNCTION process_refund(
  p_sale_id uuid,
  p_items jsonb DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale record;
  v_user_branch uuid;
  v_shift_id uuid;
  v_refund_total numeric(14,2) := 0;
  v_item record;
  v_req jsonb;
  v_item_id uuid;
  v_req_qty numeric(14,4);
  v_already numeric(14,4);
  v_ref_qty numeric(14,4);
  v_item_line_total numeric(14,2);
  v_item_ref_amt numeric(14,2);
  v_all_refunded boolean := true;
  v_product_type text;
  v_comp record;
  v_restore record;
  v_remaining numeric(14,4);
  v_back numeric(14,4);
  v_before numeric(14,4);
  v_after numeric(14,4);
  v_cost numeric(12,2);
  v_warehouse_ids uuid[];
  v_fallback_wh uuid;
BEGIN
  BEGIN
    IF p_sale_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_SALE');
    END IF;

    SELECT id, branch_id, warehouse_id, status, total, paid_amount
      INTO v_sale FROM public.sales WHERE id = p_sale_id;
    IF v_sale.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'SALE_NOT_FOUND');
    END IF;

    IF v_sale.status = 'returned' THEN
      RETURN jsonb_build_object('success', false, 'error', 'ALREADY_RETURNED');
    END IF;

    -- Permission: refunds.approve (admins always pass)
    IF NOT is_pos_admin() AND NOT can_permission('refunds.approve') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
        'detail', 'You need the refunds.approve permission.');
    END IF;

    -- Branch isolation
    SELECT branch_id INTO v_user_branch FROM users WHERE id = auth.uid();
    IF NOT is_pos_admin() AND v_user_branch IS NOT NULL
       AND v_sale.branch_id IS NOT NULL AND v_user_branch <> v_sale.branch_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;

    -- Active shift of the refunding operator (for the drawer log, optional)
    SELECT id INTO v_shift_id FROM shifts
      WHERE cashier_id = auth.uid() AND branch_id = v_sale.branch_id AND status = 'open'
      ORDER BY opened_at DESC LIMIT 1;

    SELECT array_agg(id) INTO v_warehouse_ids
      FROM warehouses WHERE branch_id = v_sale.branch_id AND is_active = true;
    SELECT id INTO v_fallback_wh FROM warehouses
      WHERE branch_id = v_sale.branch_id AND is_active = true ORDER BY created_at LIMIT 1;

    -- ===== VALIDATION PHASE =====
    IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
      FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
      LOOP
        v_item_id := (v_item->>'sale_item_id')::uuid;
        v_req_qty := COALESCE((v_item->>'quantity')::numeric, 0);
        IF v_req_qty <= 0 THEN
          RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUANTITY', 'sale_item_id', v_item_id);
        END IF;
        SELECT id, quantity, refunded_quantity INTO v_item
          FROM sale_items WHERE id = v_item_id AND sale_id = p_sale_id;
        IF v_item.id IS NULL THEN
          RETURN jsonb_build_object('success', false, 'error', 'ITEM_NOT_FOUND', 'sale_item_id', v_item_id);
        END IF;
        v_already := COALESCE(v_item.refunded_quantity, 0);
        IF v_req_qty > v_item.quantity - v_already THEN
          RETURN jsonb_build_object('success', false, 'error', 'REFUND_EXCEEDS_QUANTITY',
            'sale_item_id', v_item_id, 'max', v_item.quantity - v_already);
        END IF;
      END LOOP;
    END IF;

    -- ===== REFUND + RESTOCK PHASE =====
    FOR v_item IN SELECT id, product_id, quantity, unit_price, discount_amount, refunded_quantity
                  FROM sale_items WHERE sale_id = p_sale_id
    LOOP
      IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
        SELECT (v_req->>'quantity')::numeric INTO v_req_qty
        FROM jsonb_array_elements(p_items) v_req
        WHERE (v_req->>'sale_item_id')::uuid = v_item.id;
        v_req_qty := COALESCE(v_req_qty, 0);
      ELSE
        v_req_qty := v_item.quantity - COALESCE(v_item.refunded_quantity, 0);
      END IF;
      IF v_req_qty <= 0 THEN CONTINUE; END IF;

      v_item_line_total := v_item.quantity * v_item.unit_price - v_item.discount_amount;
      IF v_item.quantity > 0 THEN
        v_item_ref_amt := ROUND(v_item_line_total * v_req_qty / v_item.quantity, 2);
      ELSE
        v_item_ref_amt := 0;
      END IF;
      v_refund_total := v_refund_total + v_item_ref_amt;

      UPDATE sale_items
        SET refunded_quantity = COALESCE(refunded_quantity, 0) + v_req_qty,
            refunded_amount = COALESCE(refunded_amount, 0) + v_item_ref_amt
        WHERE id = v_item.id;

      -- Restock
      SELECT product_type INTO v_product_type FROM products WHERE id = v_item.product_id;
      IF v_product_type = 'manufactured' THEN
        FOR v_comp IN SELECT component_product_id, quantity FROM product_components WHERE product_id = v_item.product_id
        LOOP
          SELECT cost_price INTO v_cost FROM products WHERE id = v_comp.component_product_id;
          v_remaining := COALESCE(v_comp.quantity, 0) * v_req_qty;
          FOR v_restore IN SELECT warehouse_id, -quantity AS debited FROM stock_transactions
            WHERE reference_type = 'sale' AND reference_id = p_sale_id
              AND product_id = v_comp.component_product_id AND quantity < 0
            ORDER BY -quantity DESC
          LOOP
            IF v_remaining <= 0 THEN EXIT; END IF;
            v_back := LEAST(COALESCE(v_restore.debited, 0), v_remaining);
            IF v_back <= 0 THEN CONTINUE; END IF;
            UPDATE inventory SET quantity = quantity + v_back, updated_at = now()
              WHERE product_id = v_comp.component_product_id AND warehouse_id = v_restore.warehouse_id;
            SELECT quantity - v_back, quantity INTO v_before, v_after
              FROM inventory WHERE product_id = v_comp.component_product_id AND warehouse_id = v_restore.warehouse_id;
            INSERT INTO stock_transactions (product_id, warehouse_id, branch_id, transaction_type,
              component_flow, reference_type, reference_id, quantity, before_quantity, after_quantity, unit_cost, reason, created_by)
            VALUES (v_comp.component_product_id, v_restore.warehouse_id, v_sale.branch_id, 'refund',
              true, 'refund', p_sale_id, v_back, v_before, v_after, v_cost, p_reason, auth.uid());
            v_remaining := v_remaining - v_back;
          END LOOP;
          IF v_remaining > 0 AND v_fallback_wh IS NOT NULL THEN
            INSERT INTO inventory (product_id, warehouse_id, quantity)
            VALUES (v_comp.component_product_id, v_fallback_wh, v_remaining)
            ON CONFLICT (product_id, warehouse_id) DO UPDATE SET quantity = inventory.quantity + v_remaining;
            INSERT INTO stock_transactions (product_id, warehouse_id, branch_id, transaction_type,
              component_flow, reference_type, reference_id, quantity, before_quantity, after_quantity, unit_cost, reason, created_by)
            VALUES (v_comp.component_product_id, v_fallback_wh, v_sale.branch_id, 'refund',
              true, 'refund', p_sale_id, v_remaining, 0, v_remaining, v_cost, p_reason, auth.uid());
          END IF;
        END LOOP;
      ELSE
        SELECT cost_price INTO v_cost FROM products WHERE id = v_item.product_id;
        v_remaining := v_req_qty;
        FOR v_restore IN SELECT warehouse_id, -quantity AS debited FROM stock_transactions
          WHERE reference_type = 'sale' AND reference_id = p_sale_id
            AND product_id = v_item.product_id AND quantity < 0
          ORDER BY -quantity DESC
        LOOP
          IF v_remaining <= 0 THEN EXIT; END IF;
          v_back := LEAST(COALESCE(v_restore.debited, 0), v_remaining);
          IF v_back <= 0 THEN CONTINUE; END IF;
          UPDATE inventory SET quantity = quantity + v_back, updated_at = now()
            WHERE product_id = v_item.product_id AND warehouse_id = v_restore.warehouse_id;
          SELECT quantity - v_back, quantity INTO v_before, v_after
            FROM inventory WHERE product_id = v_item.product_id AND warehouse_id = v_restore.warehouse_id;
          INSERT INTO stock_transactions (product_id, warehouse_id, branch_id, transaction_type,
            component_flow, reference_type, reference_id, quantity, before_quantity, after_quantity, unit_cost, reason, created_by)
          VALUES (v_item.product_id, v_restore.warehouse_id, v_sale.branch_id, 'refund',
            false, 'refund', p_sale_id, v_back, v_before, v_after, v_cost, p_reason, auth.uid());
          v_remaining := v_remaining - v_back;
        END LOOP;
        IF v_remaining > 0 AND v_fallback_wh IS NOT NULL THEN
          INSERT INTO inventory (product_id, warehouse_id, quantity)
          VALUES (v_item.product_id, v_fallback_wh, v_remaining)
          ON CONFLICT (product_id, warehouse_id) DO UPDATE SET quantity = inventory.quantity + v_remaining;
          INSERT INTO stock_transactions (product_id, warehouse_id, branch_id, transaction_type,
            component_flow, reference_type, reference_id, quantity, before_quantity, after_quantity, unit_cost, reason, created_by)
          VALUES (v_item.product_id, v_fallback_wh, v_sale.branch_id, 'refund',
            false, 'refund', p_sale_id, v_remaining, 0, v_remaining, v_cost, p_reason, auth.uid());
        END IF;
      END IF;
    END LOOP;

    -- Update header: full refund flips the status, otherwise accumulate refunded_amount
    SELECT bool_and(quantity = refunded_quantity) INTO v_all_refunded
      FROM sale_items WHERE sale_id = p_sale_id;
    UPDATE sales SET
      refunded_amount = COALESCE(refunded_amount, 0) + v_refund_total,
      status = CASE WHEN v_all_refunded THEN 'returned' ELSE status END,
      notes = CASE WHEN p_reason IS NOT NULL THEN COALESCE(notes, '') || E'\n' || p_reason ELSE notes END
      WHERE id = p_sale_id;

    -- Log the cash-out into the active shift
    IF v_shift_id IS NOT NULL AND v_refund_total > 0 THEN
      INSERT INTO shift_operations (shift_id, operation_type, amount, payment_method, reference_type, reference_id, created_by)
      VALUES (v_shift_id, 'refund', v_refund_total, 'cash', 'refund', p_sale_id, auth.uid());
    END IF;

    RETURN jsonb_build_object('success', true, 'sale_id', p_sale_id,
      'refunded_amount', v_refund_total, 'fully_refunded', v_all_refunded);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$$;

-- ============ DONE ============
-- Refresh the PostgREST schema cache so the new functions/constraints are
-- immediately available to the API without a manual reload.
NOTIFY pgrst, 'reload schema';
