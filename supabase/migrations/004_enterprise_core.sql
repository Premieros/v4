-- Migration: Enterprise Core - Full branch isolation + enterprise roles + shifts
-- Run this in Supabase SQL Editor AFTER migration_inventory_v2.sql.
-- (The legacy create_user / user_password_delete migrations are consolidated
--  into this file: create_user, delete_user and update_user_password RPCs.)
--
-- WHAT THIS DOES
-- 1. Helper functions: is_pos_admin() now means super_admin/owner and is
--    search_path-safe; new get_branch_id() + is_branch_manager().
-- 2. Role migration: admin->super_admin, manager->branch_manager,
--    salesperson->cashier + a CHECK constraint locking the 8 enterprise roles.
-- 3. branch_id on the catalog tables (products, categories, customers,
--    suppliers) and audit_log; all existing rows are copied to the oldest
--    branch so nothing is lost; columns become NOT NULL + indexed.
-- 4. Full RLS overhaul: every table is branch-scoped. Child tables
--    (sale_items, purchase_items, inventory, product_units) inherit the
--    isolation from their parent (sales, purchases, warehouses, products).
-- 5. Shift system: shifts + shift_operations tables, open_shift / close_shift
--    / get_active_shift RPCs, and process_sale now REQUIRES an open shift for
--    cashiers and logs every paid sale into the shift.
-- 6. User management RPCs updated for the new roles (branch managers can
--    manage staff of their own branch, never super_admin/owner accounts).

-- ============ 1. HELPER FUNCTIONS ============

-- is_pos_admin(): true for super_admin / owner only.
-- SECURITY DEFINER + SET search_path so any caller (including other functions
-- without a search_path) resolves `users` correctly.
CREATE OR REPLACE FUNCTION is_pos_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND users.is_active
    AND users.role IN ('super_admin', 'owner')
  );
$$;

-- get_branch_id(): the branch of the current user (NULL for admin users).
-- SECURITY DEFINER so RLS on `users` cannot hide the row from the policy engine.
CREATE OR REPLACE FUNCTION get_branch_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT branch_id FROM public.users WHERE users.id = auth.uid();
$$;

-- is_branch_manager(): true when the current user is an active branch manager
-- assigned to a branch (used to scope user management to their own branch).
CREATE OR REPLACE FUNCTION is_branch_manager()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND users.is_active
    AND users.role = 'branch_manager'
    AND users.branch_id IS NOT NULL
  );
$$;

-- ============ 2. ROLE MIGRATION ============
-- Map legacy roles to the enterprise role model, then lock the column.
-- Any unknown legacy value falls back to cashier so the CHECK constraint below
-- can never fail because of a stale role name.
UPDATE public.users
SET role = CASE role
  WHEN 'admin'       THEN 'super_admin'
  WHEN 'manager'     THEN 'branch_manager'
  WHEN 'salesperson' THEN 'cashier'
  ELSE 'cashier'
END
WHERE role NOT IN ('super_admin', 'owner', 'branch_manager', 'cashier',
                   'warehouse_manager', 'kitchen', 'accountant', 'customer_display');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
    ALTER TABLE public.users ADD CONSTRAINT users_role_check
      CHECK (role IN ('super_admin', 'owner', 'branch_manager', 'cashier',
                      'warehouse_manager', 'kitchen', 'accountant', 'customer_display'));
  END IF;
END $$;

-- ============ 3. BRANCH COLUMNS ON CATALOG TABLES ============

ALTER TABLE products   ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE customers  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE suppliers  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE audit_log  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id) ON DELETE SET NULL;

-- Backfill: copy every existing row to the oldest branch (or create the
-- primary branch when there are no branches at all), then make the columns
-- NOT NULL so no future row can be created without a branch.
DO $$
DECLARE v_default uuid;
BEGIN
  SELECT id INTO v_default FROM public.branches ORDER BY created_at, id LIMIT 1;

  IF v_default IS NULL THEN
    INSERT INTO public.branches (name) VALUES ('الفرع الرئيسي')
    RETURNING id INTO v_default;
  END IF;

  UPDATE public.products   SET branch_id = v_default WHERE branch_id IS NULL;
  UPDATE public.categories SET branch_id = v_default WHERE branch_id IS NULL;
  UPDATE public.customers  SET branch_id = v_default WHERE branch_id IS NULL;
  UPDATE public.suppliers  SET branch_id = v_default WHERE branch_id IS NULL;
  UPDATE public.audit_log  SET branch_id = v_default WHERE branch_id IS NULL;
END $$;

ALTER TABLE products   ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE categories ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE customers  ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE suppliers  ALTER COLUMN branch_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_products_branch    ON products(branch_id);
CREATE INDEX IF NOT EXISTS idx_categories_branch  ON categories(branch_id);
CREATE INDEX IF NOT EXISTS idx_customers_branch   ON customers(branch_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_branch   ON suppliers(branch_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_branch   ON audit_log(branch_id);
CREATE INDEX IF NOT EXISTS idx_warehouses_branch  ON warehouses(branch_id);
CREATE INDEX IF NOT EXISTS idx_users_branch       ON users(branch_id);

-- ============ 4. FULL RLS OVERHAUL ============

-- ---------- BRANCHES (shared reference: read for all, write for admins) ----------
DROP POLICY IF EXISTS "auth_select_branches" ON branches;
CREATE POLICY "auth_select_branches" ON branches FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_branches" ON branches;
CREATE POLICY "auth_insert_branches" ON branches FOR INSERT TO authenticated WITH CHECK (is_pos_admin());
DROP POLICY IF EXISTS "auth_update_branches" ON branches;
CREATE POLICY "auth_update_branches" ON branches FOR UPDATE TO authenticated USING (is_pos_admin()) WITH CHECK (is_pos_admin());
DROP POLICY IF EXISTS "auth_delete_branches" ON branches;
CREATE POLICY "auth_delete_branches" ON branches FOR DELETE TO authenticated USING (is_pos_admin());

-- ---------- WAREHOUSES ----------
DROP POLICY IF EXISTS "auth_select_warehouses" ON warehouses;
CREATE POLICY "auth_select_warehouses" ON warehouses FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id IS NULL OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_insert_warehouses" ON warehouses;
CREATE POLICY "auth_insert_warehouses" ON warehouses FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR branch_id IS NULL OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_update_warehouses" ON warehouses;
CREATE POLICY "auth_update_warehouses" ON warehouses FOR UPDATE TO authenticated
  USING (is_pos_admin() OR branch_id IS NULL OR branch_id = get_branch_id())
  WITH CHECK (is_pos_admin() OR branch_id IS NULL OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_delete_warehouses" ON warehouses;
CREATE POLICY "auth_delete_warehouses" ON warehouses FOR DELETE TO authenticated
  USING (is_pos_admin() OR branch_id IS NULL OR branch_id = get_branch_id());

-- ---------- CATEGORIES ----------
DROP POLICY IF EXISTS "auth_select_categories" ON categories;
CREATE POLICY "auth_select_categories" ON categories FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_insert_categories" ON categories;
CREATE POLICY "auth_insert_categories" ON categories FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_update_categories" ON categories;
CREATE POLICY "auth_update_categories" ON categories FOR UPDATE TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id())
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_delete_categories" ON categories;
CREATE POLICY "auth_delete_categories" ON categories FOR DELETE TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());

-- ---------- PRODUCTS ----------
DROP POLICY IF EXISTS "auth_select_products" ON products;
CREATE POLICY "auth_select_products" ON products FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_insert_products" ON products;
CREATE POLICY "auth_insert_products" ON products FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_update_products" ON products;
CREATE POLICY "auth_update_products" ON products FOR UPDATE TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id())
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_delete_products" ON products;
CREATE POLICY "auth_delete_products" ON products FOR DELETE TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());

-- ---------- PRODUCT UNITS (isolated via products) ----------
DROP POLICY IF EXISTS "auth_select_product_units" ON product_units;
CREATE POLICY "auth_select_product_units" ON product_units FOR SELECT TO authenticated
  USING (is_pos_admin() OR EXISTS (
    SELECT 1 FROM products p WHERE p.id = product_units.product_id
    AND (p.branch_id = get_branch_id() OR p.branch_id IS NULL)
  ));
DROP POLICY IF EXISTS "auth_insert_product_units" ON product_units;
CREATE POLICY "auth_insert_product_units" ON product_units FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR EXISTS (
    SELECT 1 FROM products p WHERE p.id = product_units.product_id
    AND (p.branch_id = get_branch_id() OR p.branch_id IS NULL)
  ));
DROP POLICY IF EXISTS "auth_update_product_units" ON product_units;
CREATE POLICY "auth_update_product_units" ON product_units FOR UPDATE TO authenticated
  USING (is_pos_admin() OR EXISTS (
    SELECT 1 FROM products p WHERE p.id = product_units.product_id
    AND (p.branch_id = get_branch_id() OR p.branch_id IS NULL)
  ))
  WITH CHECK (is_pos_admin() OR EXISTS (
    SELECT 1 FROM products p WHERE p.id = product_units.product_id
    AND (p.branch_id = get_branch_id() OR p.branch_id IS NULL)
  ));
DROP POLICY IF EXISTS "auth_delete_product_units" ON product_units;
CREATE POLICY "auth_delete_product_units" ON product_units FOR DELETE TO authenticated
  USING (is_pos_admin() OR EXISTS (
    SELECT 1 FROM products p WHERE p.id = product_units.product_id
    AND (p.branch_id = get_branch_id() OR p.branch_id IS NULL)
  ));

-- ---------- INVENTORY (isolated via warehouses) ----------
DROP POLICY IF EXISTS "auth_select_inventory" ON inventory;
CREATE POLICY "auth_select_inventory" ON inventory FOR SELECT TO authenticated
  USING (is_pos_admin() OR EXISTS (
    SELECT 1 FROM warehouses w WHERE w.id = inventory.warehouse_id
    AND (w.branch_id = get_branch_id() OR w.branch_id IS NULL)
  ));
DROP POLICY IF EXISTS "auth_insert_inventory" ON inventory;
CREATE POLICY "auth_insert_inventory" ON inventory FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR EXISTS (
    SELECT 1 FROM warehouses w WHERE w.id = inventory.warehouse_id
    AND (w.branch_id = get_branch_id() OR w.branch_id IS NULL)
  ));
DROP POLICY IF EXISTS "auth_update_inventory" ON inventory;
CREATE POLICY "auth_update_inventory" ON inventory FOR UPDATE TO authenticated
  USING (is_pos_admin() OR EXISTS (
    SELECT 1 FROM warehouses w WHERE w.id = inventory.warehouse_id
    AND (w.branch_id = get_branch_id() OR w.branch_id IS NULL)
  ))
  WITH CHECK (is_pos_admin() OR EXISTS (
    SELECT 1 FROM warehouses w WHERE w.id = inventory.warehouse_id
    AND (w.branch_id = get_branch_id() OR w.branch_id IS NULL)
  ));
DROP POLICY IF EXISTS "auth_delete_inventory" ON inventory;
CREATE POLICY "auth_delete_inventory" ON inventory FOR DELETE TO authenticated
  USING (is_pos_admin() OR EXISTS (
    SELECT 1 FROM warehouses w WHERE w.id = inventory.warehouse_id
    AND (w.branch_id = get_branch_id() OR w.branch_id IS NULL)
  ));

-- ---------- CUSTOMERS ----------
DROP POLICY IF EXISTS "auth_select_customers" ON customers;
CREATE POLICY "auth_select_customers" ON customers FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_insert_customers" ON customers;
CREATE POLICY "auth_insert_customers" ON customers FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_update_customers" ON customers;
CREATE POLICY "auth_update_customers" ON customers FOR UPDATE TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id())
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_delete_customers" ON customers;
CREATE POLICY "auth_delete_customers" ON customers FOR DELETE TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());

-- ---------- SUPPLIERS ----------
DROP POLICY IF EXISTS "auth_select_suppliers" ON suppliers;
CREATE POLICY "auth_select_suppliers" ON suppliers FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_insert_suppliers" ON suppliers;
CREATE POLICY "auth_insert_suppliers" ON suppliers FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_update_suppliers" ON suppliers;
CREATE POLICY "auth_update_suppliers" ON suppliers FOR UPDATE TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id())
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_delete_suppliers" ON suppliers;
CREATE POLICY "auth_delete_suppliers" ON suppliers FOR DELETE TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());

-- ---------- SALES ----------
DROP POLICY IF EXISTS "auth_select_sales" ON sales;
CREATE POLICY "auth_select_sales" ON sales FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id IS NULL OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_insert_sales" ON sales;
CREATE POLICY "auth_insert_sales" ON sales FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR branch_id IS NULL OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_update_sales" ON sales;
CREATE POLICY "auth_update_sales" ON sales FOR UPDATE TO authenticated
  USING (is_pos_admin() OR branch_id IS NULL OR branch_id = get_branch_id())
  WITH CHECK (is_pos_admin() OR branch_id IS NULL OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_delete_sales" ON sales;
CREATE POLICY "auth_delete_sales" ON sales FOR DELETE TO authenticated
  USING (is_pos_admin() OR branch_id IS NULL OR branch_id = get_branch_id());

-- ---------- SALE ITEMS (via sales) ----------
DROP POLICY IF EXISTS "auth_select_sale_items" ON sale_items;
CREATE POLICY "auth_select_sale_items" ON sale_items FOR SELECT TO authenticated
  USING (is_pos_admin() OR EXISTS (
    SELECT 1 FROM sales s WHERE s.id = sale_items.sale_id
    AND (s.branch_id = get_branch_id() OR s.branch_id IS NULL)
  ));
DROP POLICY IF EXISTS "auth_insert_sale_items" ON sale_items;
CREATE POLICY "auth_insert_sale_items" ON sale_items FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR EXISTS (
    SELECT 1 FROM sales s WHERE s.id = sale_items.sale_id
    AND (s.branch_id = get_branch_id() OR s.branch_id IS NULL)
  ));
DROP POLICY IF EXISTS "auth_update_sale_items" ON sale_items;
CREATE POLICY "auth_update_sale_items" ON sale_items FOR UPDATE TO authenticated
  USING (is_pos_admin() OR EXISTS (
    SELECT 1 FROM sales s WHERE s.id = sale_items.sale_id
    AND (s.branch_id = get_branch_id() OR s.branch_id IS NULL)
  ))
  WITH CHECK (is_pos_admin() OR EXISTS (
    SELECT 1 FROM sales s WHERE s.id = sale_items.sale_id
    AND (s.branch_id = get_branch_id() OR s.branch_id IS NULL)
  ));
DROP POLICY IF EXISTS "auth_delete_sale_items" ON sale_items;
CREATE POLICY "auth_delete_sale_items" ON sale_items FOR DELETE TO authenticated
  USING (is_pos_admin() OR EXISTS (
    SELECT 1 FROM sales s WHERE s.id = sale_items.sale_id
    AND (s.branch_id = get_branch_id() OR s.branch_id IS NULL)
  ));

-- ---------- PURCHASES ----------
DROP POLICY IF EXISTS "auth_select_purchases" ON purchases;
CREATE POLICY "auth_select_purchases" ON purchases FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id IS NULL OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_insert_purchases" ON purchases;
CREATE POLICY "auth_insert_purchases" ON purchases FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR branch_id IS NULL OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_update_purchases" ON purchases;
CREATE POLICY "auth_update_purchases" ON purchases FOR UPDATE TO authenticated
  USING (is_pos_admin() OR branch_id IS NULL OR branch_id = get_branch_id())
  WITH CHECK (is_pos_admin() OR branch_id IS NULL OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_delete_purchases" ON purchases;
CREATE POLICY "auth_delete_purchases" ON purchases FOR DELETE TO authenticated
  USING (is_pos_admin() OR branch_id IS NULL OR branch_id = get_branch_id());

-- ---------- PURCHASE ITEMS (via purchases) ----------
DROP POLICY IF EXISTS "auth_select_purchase_items" ON purchase_items;
CREATE POLICY "auth_select_purchase_items" ON purchase_items FOR SELECT TO authenticated
  USING (is_pos_admin() OR EXISTS (
    SELECT 1 FROM purchases p WHERE p.id = purchase_items.purchase_id
    AND (p.branch_id = get_branch_id() OR p.branch_id IS NULL)
  ));
DROP POLICY IF EXISTS "auth_insert_purchase_items" ON purchase_items;
CREATE POLICY "auth_insert_purchase_items" ON purchase_items FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR EXISTS (
    SELECT 1 FROM purchases p WHERE p.id = purchase_items.purchase_id
    AND (p.branch_id = get_branch_id() OR p.branch_id IS NULL)
  ));
DROP POLICY IF EXISTS "auth_update_purchase_items" ON purchase_items;
CREATE POLICY "auth_update_purchase_items" ON purchase_items FOR UPDATE TO authenticated
  USING (is_pos_admin() OR EXISTS (
    SELECT 1 FROM purchases p WHERE p.id = purchase_items.purchase_id
    AND (p.branch_id = get_branch_id() OR p.branch_id IS NULL)
  ))
  WITH CHECK (is_pos_admin() OR EXISTS (
    SELECT 1 FROM purchases p WHERE p.id = purchase_items.purchase_id
    AND (p.branch_id = get_branch_id() OR p.branch_id IS NULL)
  ));
DROP POLICY IF EXISTS "auth_delete_purchase_items" ON purchase_items;
CREATE POLICY "auth_delete_purchase_items" ON purchase_items FOR DELETE TO authenticated
  USING (is_pos_admin() OR EXISTS (
    SELECT 1 FROM purchases p WHERE p.id = purchase_items.purchase_id
    AND (p.branch_id = get_branch_id() OR p.branch_id IS NULL)
  ));

-- ---------- EXPENSES ----------
DROP POLICY IF EXISTS "auth_select_expenses" ON expenses;
CREATE POLICY "auth_select_expenses" ON expenses FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id IS NULL OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_insert_expenses" ON expenses;
CREATE POLICY "auth_insert_expenses" ON expenses FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR branch_id IS NULL OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_update_expenses" ON expenses;
CREATE POLICY "auth_update_expenses" ON expenses FOR UPDATE TO authenticated
  USING (is_pos_admin() OR branch_id IS NULL OR branch_id = get_branch_id())
  WITH CHECK (is_pos_admin() OR branch_id IS NULL OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_delete_expenses" ON expenses;
CREATE POLICY "auth_delete_expenses" ON expenses FOR DELETE TO authenticated
  USING (is_pos_admin() OR branch_id IS NULL OR branch_id = get_branch_id());

-- ---------- STOCK TRANSACTIONS ----------
DROP POLICY IF EXISTS "auth_select_stock_transactions" ON stock_transactions;
CREATE POLICY "auth_select_stock_transactions" ON stock_transactions FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id IS NULL OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_insert_stock_transactions" ON stock_transactions;
CREATE POLICY "auth_insert_stock_transactions" ON stock_transactions FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR branch_id IS NULL OR branch_id = get_branch_id());

-- ---------- USERS (admins see all; branch managers see their branch; self always) ----------
DROP POLICY IF EXISTS "auth_select_users" ON users;
CREATE POLICY "auth_select_users" ON users FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id() OR id = auth.uid());
DROP POLICY IF EXISTS "auth_insert_users" ON users;
CREATE POLICY "auth_insert_users" ON users FOR INSERT TO authenticated
  WITH CHECK (
    (id = auth.uid() AND role = 'cashier' AND branch_id IS NULL)
    OR is_pos_admin()
  );
DROP POLICY IF EXISTS "auth_update_users" ON users;
CREATE POLICY "auth_update_users" ON users FOR UPDATE TO authenticated
  USING (is_pos_admin() OR id = auth.uid()
    OR (is_branch_manager() AND branch_id = get_branch_id() AND role NOT IN ('super_admin', 'owner')))
  WITH CHECK (
    is_pos_admin()
    OR (
      id = auth.uid()
      AND role = (SELECT role FROM public.users WHERE id = auth.uid())
      AND branch_id = (SELECT branch_id FROM public.users WHERE id = auth.uid())
    )
    OR (is_branch_manager() AND branch_id = get_branch_id() AND role NOT IN ('super_admin', 'owner'))
  );
DROP POLICY IF EXISTS "auth_delete_users" ON users;
CREATE POLICY "auth_delete_users" ON users FOR DELETE TO authenticated
  USING (is_pos_admin()
    OR (is_branch_manager() AND branch_id = get_branch_id() AND role NOT IN ('super_admin', 'owner')));

-- ---------- AUDIT LOG (branch-scoped read; admin-only write/delete) ----------
DROP POLICY IF EXISTS "auth_select_audit_log" ON audit_log;
CREATE POLICY "auth_select_audit_log" ON audit_log FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id IS NULL OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_insert_audit_log" ON audit_log;
CREATE POLICY "auth_insert_audit_log" ON audit_log FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR branch_id IS NULL OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_update_audit_log" ON audit_log;
CREATE POLICY "auth_update_audit_log" ON audit_log FOR UPDATE TO authenticated
  USING (is_pos_admin()) WITH CHECK (is_pos_admin());
DROP POLICY IF EXISTS "auth_delete_audit_log" ON audit_log;
CREATE POLICY "auth_delete_audit_log" ON audit_log FOR DELETE TO authenticated
  USING (is_pos_admin());

-- ---------- SETTINGS (store-wide, stays open) ----------
DROP POLICY IF EXISTS "auth_select_settings" ON settings;
CREATE POLICY "auth_select_settings" ON settings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_settings" ON settings;
CREATE POLICY "auth_insert_settings" ON settings FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_settings" ON settings;
CREATE POLICY "auth_update_settings" ON settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_settings" ON settings;
CREATE POLICY "auth_delete_settings" ON settings FOR DELETE TO authenticated USING (true);

-- ============ 5. SHIFT SYSTEM ============

-- A shift is an open/closed cash-drawer session for a cashier at a branch.
CREATE TABLE IF NOT EXISTS shifts (
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
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;

-- Every operation that touches the drawer is recorded here.
CREATE TABLE IF NOT EXISTS shift_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  operation_type text NOT NULL CHECK (operation_type IN ('sale', 'refund', 'expense', 'cash_in', 'cash_out', 'opening')),
  amount numeric(14,2) NOT NULL DEFAULT 0,
  payment_method text,
  reference_type text,
  reference_id uuid,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE shift_operations ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_shifts_branch  ON shifts(branch_id);
CREATE INDEX IF NOT EXISTS idx_shifts_cashier ON shifts(cashier_id);
CREATE INDEX IF NOT EXISTS idx_shifts_status  ON shifts(status);
CREATE INDEX IF NOT EXISTS idx_shift_ops_shift ON shift_operations(shift_id);

-- Shifts RLS
DROP POLICY IF EXISTS "auth_select_shifts" ON shifts;
CREATE POLICY "auth_select_shifts" ON shifts FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id() OR cashier_id = auth.uid());
DROP POLICY IF EXISTS "auth_insert_shifts" ON shifts;
CREATE POLICY "auth_insert_shifts" ON shifts FOR INSERT TO authenticated
  WITH CHECK (cashier_id = auth.uid() AND (branch_id = get_branch_id() OR is_pos_admin()));
DROP POLICY IF EXISTS "auth_update_shifts" ON shifts;
CREATE POLICY "auth_update_shifts" ON shifts FOR UPDATE TO authenticated
  USING (is_pos_admin() OR cashier_id = auth.uid())
  WITH CHECK (is_pos_admin() OR cashier_id = auth.uid());
DROP POLICY IF EXISTS "auth_delete_shifts" ON shifts;
CREATE POLICY "auth_delete_shifts" ON shifts FOR DELETE TO authenticated
  USING (is_pos_admin());

-- Shift operations RLS
DROP POLICY IF EXISTS "auth_select_shift_operations" ON shift_operations;
CREATE POLICY "auth_select_shift_operations" ON shift_operations FOR SELECT TO authenticated
  USING (is_pos_admin() OR EXISTS (
    SELECT 1 FROM shifts s WHERE s.id = shift_operations.shift_id
    AND (s.branch_id = get_branch_id() OR s.cashier_id = auth.uid())
  ));
DROP POLICY IF EXISTS "auth_insert_shift_operations" ON shift_operations;
CREATE POLICY "auth_insert_shift_operations" ON shift_operations FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM shifts s WHERE s.id = shift_operations.shift_id AND s.cashier_id = auth.uid()
  ));

-- ============ 6. SHIFT RPCs ============

-- open_shift: a cashier opens the drawer with an opening float.
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

  -- Only register operators (cashiers) open shifts
  IF v_role NOT IN ('cashier') THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_NOT_ALLOWED',
      'detail', 'Only cashier accounts can open a shift');
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

-- close_shift: computes expected drawer = opening + cash sales - cash expenses - refunds,
-- then records the actual counted amount and the difference.
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

-- get_active_shift: returns the caller's open shift (branch optional).
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
         COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN amount ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN operation_type = 'expense' AND payment_method = 'cash' THEN amount ELSE 0 END), 0)
  INTO v_total_sales, v_cash_sales, v_cash_expenses
  FROM shift_operations
  WHERE shift_id = v_shift.id AND operation_type = 'sale';

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

-- ============ 7. PROCESS SALE (with shift enforcement + logging) ============
-- Adds an optional p_shift_id. Cashiers MUST have an open shift for the sale
-- branch (found automatically when p_shift_id is NULL, so the frontend only
-- needs to pass it when explicitly chosen). Every paid sale is recorded in the
-- shift so the closing report reconciles the drawer.
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
  v_discount_amount numeric(14,2);
  v_bonus_quantity numeric(14,4);
  v_item_total numeric(14,2);
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

    -- ===== VALIDATION PHASE: check every item BEFORE writing anything =====
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

    -- ===== WRITE PHASE 1: sale header =====
    INSERT INTO sales (invoice_number, branch_id, warehouse_id, customer_id, cashier_id, salesperson_id,
      subtotal, discount_amount, discount_type, tax_amount, bonus_amount, total, paid_amount, payment_method, status)
    VALUES (p_invoice_number, p_branch_id, p_warehouse_id, p_customer_id, auth.uid(), p_salesperson_id,
      p_subtotal, p_discount_amount, p_discount_type, p_tax_amount, p_bonus_amount,
      p_total, p_paid_amount, p_payment_method, p_status)
    RETURNING id INTO v_sale_id;

    -- ===== WRITE PHASE 2: items + locked stock deduction + ledger =====
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
      v_unit_price := COALESCE((v_item->>'unit_price')::numeric, 0);
      v_discount_amount := COALESCE((v_item->>'discount_amount')::numeric, 0);
      v_bonus_quantity := COALESCE((v_item->>'bonus_quantity')::numeric, 0);
      v_item_total := COALESCE((v_item->>'total')::numeric, v_quantity * v_unit_price - v_discount_amount);

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

-- ============ 8. USER MANAGEMENT RPCs (enterprise roles) ============

-- protect_last_admin: the last active super_admin/owner can never be removed
-- or demoted (including by themselves).
CREATE OR REPLACE FUNCTION protect_last_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_other_active_admins int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role IN ('super_admin', 'owner') AND OLD.is_active THEN
      SELECT count(*) INTO v_other_active_admins
      FROM public.users
      WHERE role IN ('super_admin', 'owner') AND is_active AND id <> OLD.id;
      IF v_other_active_admins = 0 THEN
        RAISE EXCEPTION 'LAST_ADMIN';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE
  IF OLD.role IN ('super_admin', 'owner') AND OLD.is_active
     AND (NEW.role NOT IN ('super_admin', 'owner') OR NOT NEW.is_active) THEN
    SELECT count(*) INTO v_other_active_admins
    FROM public.users
    WHERE role IN ('super_admin', 'owner') AND is_active AND id <> OLD.id;
    IF v_other_active_admins = 0 THEN
      RAISE EXCEPTION 'LAST_ADMIN';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_last_admin ON users;
CREATE TRIGGER trg_protect_last_admin
BEFORE UPDATE OR DELETE ON users
FOR EACH ROW EXECUTE FUNCTION protect_last_admin();

-- create_user: admins create any user; branch managers can only create staff of
-- their OWN branch with a non-admin role. Creates auth account + app profile
-- atomically (same dynamic-column technique as before).
CREATE OR REPLACE FUNCTION create_user(
  p_email text,
  p_password text,
  p_full_name text DEFAULT NULL,
  p_role text DEFAULT 'cashier',
  p_branch_id uuid DEFAULT NULL,
  p_is_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_role text;
  v_hash text;
  v_email text;
  v_pgc_schema text;
  v_caller_role text;
  v_caller_branch uuid;
  v_u_cols text;
  v_u_vals text;
  v_i_cols text;
  v_i_vals text;
BEGIN
  SELECT role, branch_id INTO v_caller_role, v_caller_branch FROM public.users WHERE id = auth.uid();

  IF is_pos_admin() THEN
    NULL;
  ELSIF v_caller_role = 'branch_manager' AND v_caller_branch IS NOT NULL THEN
    -- branch manager: force their own branch and forbid admin roles
    IF p_branch_id IS NOT NULL AND p_branch_id <> v_caller_branch THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED',
        'detail', 'Branch managers can only create users in their own branch');
    END IF;
    IF p_role IN ('super_admin', 'owner') THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED',
        'detail', 'Only a super admin can create super_admin/owner accounts');
    END IF;
    p_branch_id := v_caller_branch;
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  v_email := lower(btrim(p_email));

  -- Email uniqueness (both auth accounts and app profiles)
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
    RETURN jsonb_build_object('success', false, 'error', 'EMAIL_TAKEN');
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE email = v_email) THEN
    RETURN jsonb_build_object('success', false, 'error', 'EMAIL_TAKEN');
  END IF;

  SELECT extnamespace::regnamespace::text INTO v_pgc_schema
  FROM pg_extension WHERE extname = 'pgcrypto';

  IF v_pgc_schema IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', 'pgcrypto extension is not enabled');
  END IF;

  EXECUTE format('SELECT %I.crypt($1, %I.gen_salt($2, $3))', v_pgc_schema, v_pgc_schema)
    INTO v_hash USING p_password, 'bf', 10;

  v_role := CASE
    WHEN p_role IN ('super_admin', 'owner', 'branch_manager', 'cashier',
                    'warehouse_manager', 'kitchen', 'accountant', 'customer_display') THEN p_role
    ELSE 'cashier'
  END;

  -- A non-admin caller can only create staff accounts inside their own branch
  -- (admin roles were already rejected above).
  IF v_caller_role = 'branch_manager' THEN
    NULL;
  END IF;

  v_user_id := gen_random_uuid();

  SELECT string_agg(c.col, ', ' ORDER BY c.ord), string_agg(c.val, ', ' ORDER BY c.ord)
  INTO v_u_cols, v_u_vals
  FROM (
    SELECT cols.ordinal_position AS ord, quote_ident(cols.column_name) AS col,
      CASE cols.column_name
        WHEN 'instance_id' THEN '''00000000-0000-0000-0000-000000000000'''
        WHEN 'id' THEN quote_literal(v_user_id)
        WHEN 'aud' THEN '''authenticated'''
        WHEN 'role' THEN '''authenticated'''
        WHEN 'email' THEN quote_literal(v_email)
        WHEN 'encrypted_password' THEN quote_literal(v_hash)
        WHEN 'email_confirmed_at' THEN 'now()'
        WHEN 'confirmation_token' THEN ''''''
        WHEN 'recovery_token' THEN ''''''
        WHEN 'email_change' THEN ''''''
        WHEN 'email_change_token_new' THEN ''''''
        WHEN 'email_change_token_current' THEN ''''''
        WHEN 'raw_app_meta_data' THEN format('jsonb_build_object(''provider'',''email'',''providers'',array[''email'']::text[],''email'',%L)', v_email)
        WHEN 'raw_user_meta_data' THEN format('jsonb_build_object(''full_name'',%L,''email'',%L,''email_verified'',true)', p_full_name, v_email)
        WHEN 'created_at' THEN 'now()'
        WHEN 'updated_at' THEN 'now()'
        WHEN 'is_anonymous' THEN 'false'
        WHEN 'is_sso_user' THEN 'false'
      END AS val
    FROM information_schema.columns cols
    WHERE cols.table_schema = 'auth' AND cols.table_name = 'users'
      AND cols.is_generated = 'NEVER'
      AND cols.column_name IN ('instance_id','id','aud','role','email','encrypted_password','email_confirmed_at','confirmation_token','recovery_token','email_change','email_change_token_new','email_change_token_current','raw_app_meta_data','raw_user_meta_data','created_at','updated_at','is_anonymous','is_sso_user')
  ) c;

  IF v_u_cols IS NULL OR v_u_vals IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', 'no insertable columns found for auth.users');
  END IF;

  EXECUTE 'INSERT INTO auth.users (' || v_u_cols || ') VALUES (' || v_u_vals || ')';

  SELECT string_agg(c.col, ', ' ORDER BY c.ord), string_agg(c.val, ', ' ORDER BY c.ord)
  INTO v_i_cols, v_i_vals
  FROM (
    SELECT cols.ordinal_position AS ord, quote_ident(cols.column_name) AS col,
      CASE cols.column_name
        WHEN 'id' THEN 'gen_random_uuid()'
        WHEN 'provider_id' THEN quote_literal(v_user_id::text)
        WHEN 'user_id' THEN quote_literal(v_user_id)
        WHEN 'identity_data' THEN format('jsonb_build_object(''sub'',%L,''email'',%L)', v_user_id::text, v_email)
        WHEN 'provider' THEN '''email'''
        WHEN 'last_sign_in_at' THEN 'now()'
        WHEN 'created_at' THEN 'now()'
        WHEN 'updated_at' THEN 'now()'
        WHEN 'email' THEN quote_literal(v_email)
      END AS val
    FROM information_schema.columns cols
    WHERE cols.table_schema = 'auth' AND cols.table_name = 'identities'
      AND cols.is_generated = 'NEVER'
      AND cols.column_name IN ('id','provider_id','user_id','identity_data','provider','last_sign_in_at','created_at','updated_at','email')
  ) c;

  IF v_i_cols IS NULL OR v_i_vals IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', 'no insertable columns found for auth.identities');
  END IF;

  EXECUTE 'INSERT INTO auth.identities (' || v_i_cols || ') VALUES (' || v_i_vals || ')';

  INSERT INTO public.users (id, email, full_name, role, branch_id, is_active)
  VALUES (v_user_id, v_email, p_full_name, v_role, p_branch_id, p_is_active);

  RETURN jsonb_build_object('success', true, 'user_id', v_user_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', SQLERRM);
END;
$$;

-- update_user_password: super_admin/owner for anyone; branch manager only for
-- non-admin staff of their own branch.
CREATE OR REPLACE FUNCTION update_user_password(p_user_id uuid, p_new_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash text;
  v_pgc_schema text;
  v_caller_role text;
  v_caller_branch uuid;
  v_target_role text;
  v_target_branch uuid;
BEGIN
  IF NOT is_pos_admin() THEN
    SELECT role, branch_id INTO v_caller_role, v_caller_branch FROM public.users WHERE id = auth.uid();
    IF v_caller_role = 'branch_manager' AND v_caller_branch IS NOT NULL THEN
      SELECT role, branch_id INTO v_target_role, v_target_branch FROM public.users WHERE id = p_user_id;
      IF v_target_role IN ('super_admin', 'owner') OR v_target_branch IS DISTINCT FROM v_caller_branch THEN
        RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED',
          'detail', 'Branch managers can only change passwords of staff in their own branch');
      END IF;
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
    END IF;
  END IF;

  IF p_new_password IS NULL OR length(p_new_password) < 6 THEN
    RETURN jsonb_build_object('success', false, 'error', 'WEAK_PASSWORD');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
  END IF;

  SELECT extnamespace::regnamespace::text INTO v_pgc_schema
  FROM pg_extension WHERE extname = 'pgcrypto';

  IF v_pgc_schema IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', 'pgcrypto extension is not enabled');
  END IF;

  EXECUTE format('SELECT %I.crypt($1, %I.gen_salt($2, $3))', v_pgc_schema, v_pgc_schema)
    INTO v_hash USING p_new_password, 'bf', 10;

  UPDATE auth.users
  SET encrypted_password = v_hash, updated_at = now()
  WHERE id = p_user_id;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'sessions') THEN
    DELETE FROM auth.sessions WHERE user_id = p_user_id;
  END IF;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'LAST_ADMIN' THEN
    RETURN jsonb_build_object('success', false, 'error', 'LAST_ADMIN');
  END IF;
  RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', SQLERRM);
END;
$$;

-- delete_user: super_admin/owner for anyone; branch manager only for non-admin
-- staff of their own branch. App profile is deleted first so the last-admin
-- trigger still guards the transaction.
CREATE OR REPLACE FUNCTION delete_user(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  v_caller_branch uuid;
  v_target_role text;
  v_target_branch uuid;
BEGIN
  IF NOT is_pos_admin() THEN
    SELECT role, branch_id INTO v_caller_role, v_caller_branch FROM public.users WHERE id = auth.uid();
    IF v_caller_role = 'branch_manager' AND v_caller_branch IS NOT NULL THEN
      SELECT role, branch_id INTO v_target_role, v_target_branch FROM public.users WHERE id = p_user_id;
      IF v_target_role IN ('super_admin', 'owner') OR v_target_branch IS DISTINCT FROM v_caller_branch THEN
        RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED',
          'detail', 'Branch managers can only delete staff in their own branch');
      END IF;
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
  END IF;

  DELETE FROM public.users WHERE id = p_user_id;

  DELETE FROM auth.users WHERE id = p_user_id;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'LAST_ADMIN' THEN
    RETURN jsonb_build_object('success', false, 'error', 'LAST_ADMIN');
  END IF;
  RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', SQLERRM);
END;
$$;

-- Refresh the PostgREST schema cache so new tables/constraints (shifts, users FKs)
-- are immediately available to the API without a manual reload.
NOTIFY pgrst, 'reload schema';
