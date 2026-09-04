-- POS System - Complete Setup Script
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard

-- ============ BRANCHES ============
CREATE TABLE IF NOT EXISTS branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  name_en text,
  address text,
  phone text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_branches" ON branches;
CREATE POLICY "auth_select_branches" ON branches FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_branches" ON branches;
CREATE POLICY "auth_insert_branches" ON branches FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_branches" ON branches;
CREATE POLICY "auth_update_branches" ON branches FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_branches" ON branches;
CREATE POLICY "auth_delete_branches" ON branches FOR DELETE TO authenticated USING (true);

-- ============ WAREHOUSES ============
CREATE TABLE IF NOT EXISTS warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  address text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_warehouses" ON warehouses;
CREATE POLICY "auth_select_warehouses" ON warehouses FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_warehouses" ON warehouses;
CREATE POLICY "auth_insert_warehouses" ON warehouses FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_warehouses" ON warehouses;
CREATE POLICY "auth_update_warehouses" ON warehouses FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_warehouses" ON warehouses;
CREATE POLICY "auth_delete_warehouses" ON warehouses FOR DELETE TO authenticated USING (true);

-- ============ CATEGORIES ============
CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  name_en text,
  description text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_categories" ON categories;
CREATE POLICY "auth_select_categories" ON categories FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_categories" ON categories;
CREATE POLICY "auth_insert_categories" ON categories FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_categories" ON categories;
CREATE POLICY "auth_update_categories" ON categories FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_categories" ON categories;
CREATE POLICY "auth_delete_categories" ON categories FOR DELETE TO authenticated USING (true);

-- ============ PRODUCTS ============
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  name_en text,
  barcode text,
  sku text,
  category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  description text,
  cost_price numeric(12,2) NOT NULL DEFAULT 0,
  sale_price numeric(12,2) NOT NULL DEFAULT 0,
  wholesale_price numeric(12,2) NOT NULL DEFAULT 0,
  image_url text,
  is_active boolean NOT NULL DEFAULT true,
  low_stock_threshold integer NOT NULL DEFAULT 5,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_products" ON products;
CREATE POLICY "auth_select_products" ON products FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_products" ON products;
CREATE POLICY "auth_insert_products" ON products FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_products" ON products;
CREATE POLICY "auth_update_products" ON products FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_products" ON products;
CREATE POLICY "auth_delete_products" ON products FOR DELETE TO authenticated USING (true);

-- ============ PRODUCT UNITS ============
CREATE TABLE IF NOT EXISTS product_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit_name text NOT NULL,
  unit_name_en text,
  conversion_factor numeric(12,4) NOT NULL DEFAULT 1,
  sale_price numeric(12,2) NOT NULL DEFAULT 0,
  cost_price numeric(12,2) NOT NULL DEFAULT 0,
  barcode text,
  is_base boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE product_units ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_product_units" ON product_units;
CREATE POLICY "auth_select_product_units" ON product_units FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_product_units" ON product_units;
CREATE POLICY "auth_insert_product_units" ON product_units FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_product_units" ON product_units;
CREATE POLICY "auth_update_product_units" ON product_units FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_product_units" ON product_units;
CREATE POLICY "auth_delete_product_units" ON product_units FOR DELETE TO authenticated USING (true);

-- ============ INVENTORY ============
CREATE TABLE IF NOT EXISTS inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  quantity numeric(14,4) NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (product_id, warehouse_id)
);
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_inventory" ON inventory;
CREATE POLICY "auth_select_inventory" ON inventory FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_inventory" ON inventory;
CREATE POLICY "auth_insert_inventory" ON inventory FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_inventory" ON inventory;
CREATE POLICY "auth_update_inventory" ON inventory FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_inventory" ON inventory;
CREATE POLICY "auth_delete_inventory" ON inventory FOR DELETE TO authenticated USING (true);

-- ============ CUSTOMERS ============
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  name_en text,
  phone text,
  email text,
  address text,
  tax_number text,
  balance numeric(12,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_customers" ON customers;
CREATE POLICY "auth_select_customers" ON customers FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_customers" ON customers;
CREATE POLICY "auth_insert_customers" ON customers FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_customers" ON customers;
CREATE POLICY "auth_update_customers" ON customers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_customers" ON customers;
CREATE POLICY "auth_delete_customers" ON customers FOR DELETE TO authenticated USING (true);

-- ============ SUPPLIERS ============
CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  name_en text,
  phone text,
  email text,
  address text,
  tax_number text,
  balance numeric(12,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_suppliers" ON suppliers;
CREATE POLICY "auth_select_suppliers" ON suppliers FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_suppliers" ON suppliers;
CREATE POLICY "auth_insert_suppliers" ON suppliers FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_suppliers" ON suppliers;
CREATE POLICY "auth_update_suppliers" ON suppliers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_suppliers" ON suppliers;
CREATE POLICY "auth_delete_suppliers" ON suppliers FOR DELETE TO authenticated USING (true);

-- ============ SALES ============
CREATE TABLE IF NOT EXISTS sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  cashier_id uuid,
  salesperson_id uuid,
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  discount_type text DEFAULT 'amount',
  tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  bonus_amount numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  payment_method text DEFAULT 'cash',
  status text DEFAULT 'completed',
  notes text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_sales" ON sales;
CREATE POLICY "auth_select_sales" ON sales FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_sales" ON sales;
CREATE POLICY "auth_insert_sales" ON sales FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_sales" ON sales;
CREATE POLICY "auth_update_sales" ON sales FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_sales" ON sales;
CREATE POLICY "auth_delete_sales" ON sales FOR DELETE TO authenticated USING (true);

-- ============ SALE ITEMS ============
CREATE TABLE IF NOT EXISTS sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  unit_name text NOT NULL DEFAULT 'piece',
  quantity numeric(14,4) NOT NULL DEFAULT 1,
  unit_price numeric(12,2) NOT NULL DEFAULT 0,
  discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  bonus_quantity numeric(14,4) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_sale_items" ON sale_items;
CREATE POLICY "auth_select_sale_items" ON sale_items FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_sale_items" ON sale_items;
CREATE POLICY "auth_insert_sale_items" ON sale_items FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_sale_items" ON sale_items;
CREATE POLICY "auth_update_sale_items" ON sale_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_sale_items" ON sale_items;
CREATE POLICY "auth_delete_sale_items" ON sale_items FOR DELETE TO authenticated USING (true);

-- ============ PURCHASES ============
CREATE TABLE IF NOT EXISTS purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  buyer_id uuid,
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  payment_method text DEFAULT 'cash',
  status text DEFAULT 'completed',
  notes text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_purchases" ON purchases;
CREATE POLICY "auth_select_purchases" ON purchases FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_purchases" ON purchases;
CREATE POLICY "auth_insert_purchases" ON purchases FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_purchases" ON purchases;
CREATE POLICY "auth_update_purchases" ON purchases FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_purchases" ON purchases;
CREATE POLICY "auth_delete_purchases" ON purchases FOR DELETE TO authenticated USING (true);

-- ============ PURCHASE ITEMS ============
CREATE TABLE IF NOT EXISTS purchase_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  unit_name text NOT NULL DEFAULT 'piece',
  quantity numeric(14,4) NOT NULL DEFAULT 1,
  unit_cost numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE purchase_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_purchase_items" ON purchase_items;
CREATE POLICY "auth_select_purchase_items" ON purchase_items FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_purchase_items" ON purchase_items;
CREATE POLICY "auth_insert_purchase_items" ON purchase_items FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_purchase_items" ON purchase_items;
CREATE POLICY "auth_update_purchase_items" ON purchase_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_purchase_items" ON purchase_items;
CREATE POLICY "auth_delete_purchase_items" ON purchase_items FOR DELETE TO authenticated USING (true);

-- ============ EXPENSES ============
CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text,
  description text,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  payment_method text DEFAULT 'cash',
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_by uuid,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_expenses" ON expenses;
CREATE POLICY "auth_select_expenses" ON expenses FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_expenses" ON expenses;
CREATE POLICY "auth_insert_expenses" ON expenses FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_expenses" ON expenses;
CREATE POLICY "auth_update_expenses" ON expenses FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_expenses" ON expenses;
CREATE POLICY "auth_delete_expenses" ON expenses FOR DELETE TO authenticated USING (true);

-- ============ USERS (app profiles) ============
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT auth.uid(),
  email text NOT NULL,
  full_name text,
  role text NOT NULL DEFAULT 'cashier',
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_users" ON users;
CREATE POLICY "auth_select_users" ON users FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_users" ON users;
CREATE POLICY "auth_insert_users" ON users FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_users" ON users;
CREATE POLICY "auth_update_users" ON users FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_users" ON users;
CREATE POLICY "auth_delete_users" ON users FOR DELETE TO authenticated USING (true);

-- ============ AUDIT LOG ============
CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  user_email text,
  action text NOT NULL,
  entity text,
  entity_id uuid,
  details jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_audit_log" ON audit_log;
CREATE POLICY "auth_select_audit_log" ON audit_log FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_audit_log" ON audit_log;
CREATE POLICY "auth_insert_audit_log" ON audit_log FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_audit_log" ON audit_log;
CREATE POLICY "auth_update_audit_log" ON audit_log FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_audit_log" ON audit_log;
CREATE POLICY "auth_delete_audit_log" ON audit_log FOR DELETE TO authenticated USING (true);

-- ============ SETTINGS ============
CREATE TABLE IF NOT EXISTS settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_name text NOT NULL DEFAULT 'My Store',
  store_name_en text,
  store_address text,
  store_phone text,
  currency text NOT NULL DEFAULT 'SAR',
  tax_rate numeric(5,2) NOT NULL DEFAULT 15,
  tax_enabled boolean NOT NULL DEFAULT true,
  receipt_footer text,
  receipt_header text,
  logo_url text,
  language text DEFAULT 'ar',
  theme text DEFAULT 'light',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_settings" ON settings;
CREATE POLICY "auth_select_settings" ON settings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_settings" ON settings;
CREATE POLICY "auth_insert_settings" ON settings FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_settings" ON settings;
CREATE POLICY "auth_update_settings" ON settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_settings" ON settings;
CREATE POLICY "auth_delete_settings" ON settings FOR DELETE TO authenticated USING (true);

-- ============ INDEXES ============
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_warehouse ON inventory(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_sales_branch ON sales(branch_id);
CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);

-- ============ SEED SETTINGS ============
INSERT INTO settings (store_name, store_name_en, store_address, store_phone, currency, tax_rate, tax_enabled, receipt_header, receipt_footer, language, theme)
SELECT 'متجري', 'My Store', '', '', 'SAR', 15, true, 'أهلاً وسهلاً', 'شكراً لزيارتكم', 'ar', 'light'
WHERE NOT EXISTS (SELECT 1 FROM settings);

-- ============ HELPER FUNCTION ============
-- NOTE: is_pos_admin() is redefined by migration_enterprise_core.sql to mean
-- super_admin / owner. The base definition below is superseded but harmless;
-- always run migration_enterprise_core.sql after this file.
CREATE OR REPLACE FUNCTION is_pos_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.is_active
    AND users.role IN ('super_admin', 'owner')
  );
$$;

-- ============ BRANCH ISOLATION POLICIES ============
DROP POLICY IF EXISTS "auth_select_sales" ON sales;
CREATE POLICY "auth_select_sales" ON sales FOR SELECT
  TO authenticated USING (is_pos_admin() OR branch_id IS NULL OR branch_id = (
    SELECT users.branch_id FROM users WHERE users.id = auth.uid()
  ));

DROP POLICY IF EXISTS "auth_insert_sales" ON sales;
CREATE POLICY "auth_insert_sales" ON sales FOR INSERT
  TO authenticated WITH CHECK (is_pos_admin() OR branch_id IS NULL OR branch_id = (
    SELECT users.branch_id FROM users WHERE users.id = auth.uid()
  ));

DROP POLICY IF EXISTS "auth_update_sales" ON sales;
CREATE POLICY "auth_update_sales" ON sales FOR UPDATE
  TO authenticated USING (is_pos_admin() OR branch_id IS NULL OR branch_id = (
    SELECT users.branch_id FROM users WHERE users.id = auth.uid()
  )) WITH CHECK (is_pos_admin() OR branch_id IS NULL OR branch_id = (
    SELECT users.branch_id FROM users WHERE users.id = auth.uid()
  ));

DROP POLICY IF EXISTS "auth_delete_sales" ON sales;
CREATE POLICY "auth_delete_sales" ON sales FOR DELETE
  TO authenticated USING (is_pos_admin() OR branch_id IS NULL OR branch_id = (
    SELECT users.branch_id FROM users WHERE users.id = auth.uid()
  ));

DROP POLICY IF EXISTS "auth_select_purchases" ON purchases;
CREATE POLICY "auth_select_purchases" ON purchases FOR SELECT
  TO authenticated USING (is_pos_admin() OR branch_id IS NULL OR branch_id = (
    SELECT users.branch_id FROM users WHERE users.id = auth.uid()
  ));

DROP POLICY IF EXISTS "auth_insert_purchases" ON purchases;
CREATE POLICY "auth_insert_purchases" ON purchases FOR INSERT
  TO authenticated WITH CHECK (is_pos_admin() OR branch_id IS NULL OR branch_id = (
    SELECT users.branch_id FROM users WHERE users.id = auth.uid()
  ));

DROP POLICY IF EXISTS "auth_update_purchases" ON purchases;
CREATE POLICY "auth_update_purchases" ON purchases FOR UPDATE
  TO authenticated USING (is_pos_admin() OR branch_id IS NULL OR branch_id = (
    SELECT users.branch_id FROM users WHERE users.id = auth.uid()
  )) WITH CHECK (is_pos_admin() OR branch_id IS NULL OR branch_id = (
    SELECT users.branch_id FROM users WHERE users.id = auth.uid()
  ));

DROP POLICY IF EXISTS "auth_delete_purchases" ON purchases;
CREATE POLICY "auth_delete_purchases" ON purchases FOR DELETE
  TO authenticated USING (is_pos_admin() OR branch_id IS NULL OR branch_id = (
    SELECT users.branch_id FROM users WHERE users.id = auth.uid()
  ));

DROP POLICY IF EXISTS "auth_select_expenses" ON expenses;
CREATE POLICY "auth_select_expenses" ON expenses FOR SELECT
  TO authenticated USING (is_pos_admin() OR branch_id IS NULL OR branch_id = (
    SELECT users.branch_id FROM users WHERE users.id = auth.uid()
  ));

DROP POLICY IF EXISTS "auth_insert_expenses" ON expenses;
CREATE POLICY "auth_insert_expenses" ON expenses FOR INSERT
  TO authenticated WITH CHECK (is_pos_admin() OR branch_id IS NULL OR branch_id = (
    SELECT users.branch_id FROM users WHERE users.id = auth.uid()
  ));

DROP POLICY IF EXISTS "auth_update_expenses" ON expenses;
CREATE POLICY "auth_update_expenses" ON expenses FOR UPDATE
  TO authenticated USING (is_pos_admin() OR branch_id IS NULL OR branch_id = (
    SELECT users.branch_id FROM users WHERE users.id = auth.uid()
  )) WITH CHECK (is_pos_admin() OR branch_id IS NULL OR branch_id = (
    SELECT users.branch_id FROM users WHERE users.id = auth.uid()
  ));

DROP POLICY IF EXISTS "auth_delete_expenses" ON expenses;
CREATE POLICY "auth_delete_expenses" ON expenses FOR DELETE
  TO authenticated USING (is_pos_admin() OR branch_id IS NULL OR branch_id = (
    SELECT users.branch_id FROM users WHERE users.id = auth.uid()
  ));
