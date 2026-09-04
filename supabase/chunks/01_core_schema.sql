-- PART: 01_core_schema.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==========================================
-- 001_combined_setup.sql
-- ==========================================
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

-- ==========================================
-- 002_product_components.sql
-- ==========================================
-- Migration: Product Components (BOM - Bill of Materials)
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS product_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  component_product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity numeric(14,4) NOT NULL DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  UNIQUE (product_id, component_product_id)
);
ALTER TABLE product_components ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_product_components" ON product_components;
CREATE POLICY "auth_select_product_components" ON product_components FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_product_components" ON product_components;
CREATE POLICY "auth_insert_product_components" ON product_components FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_product_components" ON product_components;
CREATE POLICY "auth_update_product_components" ON product_components FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_product_components" ON product_components;
CREATE POLICY "auth_delete_product_components" ON product_components FOR DELETE TO authenticated USING (true);

-- ==========================================
-- 003_inventory_v2.sql
-- ==========================================
-- Migration: Inventory v2 - Dual Inventory (Ready Products + Manufactured with BOM)
-- Run this in Supabase SQL Editor AFTER combined_setup.sql + migration_components.sql

-- ============ 1. PRODUCT TYPE ============
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_type text NOT NULL DEFAULT 'ready';

-- Backfill: any product that already has a recipe is a manufactured product
UPDATE products SET product_type = 'manufactured'
WHERE product_type = 'ready'
  AND EXISTS (SELECT 1 FROM product_components pc WHERE pc.product_id = products.id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_product_type_check') THEN
    ALTER TABLE products ADD CONSTRAINT products_product_type_check
      CHECK (product_type IN ('ready', 'manufactured'));
  END IF;
END $$;

-- ============ 2. STOCK TRANSACTIONS LEDGER ============
-- Every inventory movement is logged here (negative quantity = deduction)
CREATE TABLE IF NOT EXISTS stock_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  transaction_type text NOT NULL DEFAULT 'sale' CHECK (transaction_type IN ('sale', 'purchase', 'adjustment')),
  component_flow boolean NOT NULL DEFAULT false,
  reference_type text NOT NULL,
  reference_id uuid,
  quantity numeric(14,4) NOT NULL,
  before_quantity numeric(14,4) NOT NULL DEFAULT 0,
  after_quantity numeric(14,4) NOT NULL DEFAULT 0,
  unit_cost numeric(12,2),
  reason text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE stock_transactions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_stock_tx_product ON stock_transactions(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_tx_created ON stock_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_stock_tx_branch ON stock_transactions(branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_tx_reference ON stock_transactions(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_stock_tx_component ON stock_transactions(component_flow);

DROP POLICY IF EXISTS "auth_select_stock_transactions" ON stock_transactions;
CREATE POLICY "auth_select_stock_transactions" ON stock_transactions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_stock_transactions" ON stock_transactions;
CREATE POLICY "auth_insert_stock_transactions" ON stock_transactions FOR INSERT TO authenticated WITH CHECK (true);

-- ============ 3. PROCESS SALE (single atomic transaction) ============
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
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id uuid;
  v_user_branch uuid;
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

    -- Branch isolation (mirror of RLS on sales)
    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND v_user_branch <> p_branch_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
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
        -- No recipe => cannot sell
        IF NOT EXISTS (SELECT 1 FROM product_components WHERE product_id = v_product_id) THEN
          RETURN jsonb_build_object('success', false, 'error', 'NO_RECIPE', 'product_id', v_product_id);
        END IF;
        -- Verify ALL components available
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

-- ============ 4. PROCESS PURCHASE (single atomic transaction) ============
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

-- ============ 5. ADJUST STOCK (single atomic transaction) ============
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

-- ==========================================
-- 004_enterprise_core.sql
-- ==========================================
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

-- ==========================================
-- 005_sales_user_fks.sql
-- ==========================================
-- ============================================================================
-- Sales -> users foreign keys (cashier / salesperson)
-- ----------------------------------------------------------------------------
-- On the live database these two constraints existed (the frontend embeds
-- users!fk_sales_cashier, created by renaming sales_cashier_id_fkey in
-- fk_cleanup), but no tracked migration creates them. This file makes a fresh
-- build match the live state before fk_cleanup runs its renames.
-- Additive + idempotent: guarded, creates nothing that already exists.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_cashier_id_fkey' AND conrelid = 'public.sales'::regclass
  ) THEN
    ALTER TABLE public.sales
      ADD CONSTRAINT sales_cashier_id_fkey
      FOREIGN KEY (cashier_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_salesperson_id_fkey' AND conrelid = 'public.sales'::regclass
  ) THEN
    ALTER TABLE public.sales
      ADD CONSTRAINT sales_salesperson_id_fkey
      FOREIGN KEY (salesperson_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ==========================================
-- 006_fk_cleanup.sql
-- ==========================================
-- =============================================================
-- Migration: FK naming cleanup + inventory branch_id
--
--   1. Renames the default Postgres FK names to explicit, readable
--      names so PostgREST embed hints are stable and self-documenting.
--   2. Adds branch_id to inventory (NOT NULL, backfilled from the
--      row's warehouse branch) and rewrites inventory RLS to the
--      clean single pattern: is_pos_admin() OR branch_id = get_branch_id()
--
-- The renamed FKs must be matched in the frontend embed hints:
--   src/pages/ReportsPage.tsx:132,176  users!sales_cashier_id_fkey
--     ->  users!fk_sales_cashier
-- =============================================================

BEGIN;

-- ---------- 1. RENAME FOREIGN KEY CONSTRAINTS ----------
ALTER TABLE public.products    RENAME CONSTRAINT products_branch_id_fkey      TO fk_products_branch;
ALTER TABLE public.sales       RENAME CONSTRAINT sales_branch_id_fkey         TO fk_sales_branch;
ALTER TABLE public.sales       RENAME CONSTRAINT sales_cashier_id_fkey        TO fk_sales_cashier;
ALTER TABLE public.sales       RENAME CONSTRAINT sales_salesperson_id_fkey    TO fk_sales_salesperson;
ALTER TABLE public.sale_items  RENAME CONSTRAINT sale_items_product_id_fkey   TO fk_sale_item_product;
ALTER TABLE public.inventory   RENAME CONSTRAINT inventory_product_id_fkey    TO fk_stock_product;
ALTER TABLE public.purchases   RENAME CONSTRAINT purchases_supplier_id_fkey   TO fk_purchase_supplier;

-- ---------- 2. INVENTORY branch_id (NOT NULL, backfilled from warehouse) ----------
ALTER TABLE public.inventory ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE RESTRICT;

UPDATE public.inventory i
SET branch_id = w.branch_id
FROM public.warehouses w
WHERE w.id = i.warehouse_id AND i.branch_id IS NULL;

-- Safety: never leave a stock row without a branch (the warehouse must belong
-- to a branch). Failing here rolls the whole migration back.
ALTER TABLE public.inventory ALTER COLUMN branch_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_branch ON public.inventory(branch_id);

-- ---------- 3. INVENTORY RLS (clean single pattern via inventory.branch_id) ----------
DROP POLICY IF EXISTS "auth_select_inventory" ON public.inventory;
DROP POLICY IF EXISTS "auth_insert_inventory" ON public.inventory;
DROP POLICY IF EXISTS "auth_update_inventory" ON public.inventory;
DROP POLICY IF EXISTS "auth_delete_inventory" ON public.inventory;

CREATE POLICY "auth_select_inventory" ON public.inventory FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());
CREATE POLICY "auth_insert_inventory" ON public.inventory FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id());
CREATE POLICY "auth_update_inventory" ON public.inventory FOR UPDATE TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id())
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id());
CREATE POLICY "auth_delete_inventory" ON public.inventory FOR DELETE TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());

COMMIT;

-- Refresh the PostgREST schema cache so the renamed FKs / new column are live
NOTIFY pgrst, 'reload schema';

-- ==========================================
-- 007_pin_login.sql
-- ==========================================
-- Migration: Username + 4-digit PIN login
-- Run this in the Supabase SQL Editor AFTER migration_enterprise_core.sql.
--
-- Adds:
--   1. `public.users.username` column (lowercase, unique).
--   2. Backfill: existing accounts get a username from their email prefix.
--   3. `get_login_email(username)` — anon-callable lookup used by the login page.
--   4. `create_user` now accepts `p_username`.
--   5. `update_user_password` now accepts 4-digit PINs.

-- ============ 1. USERNAME COLUMN ============
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS username text;

-- Refresh the PostgREST schema cache immediately so the new column is usable
-- right away even if a later statement below fails (also repeated at the end).
NOTIFY pgrst, 'reload schema';

-- Backfill existing accounts from their email prefix (deduplicated).
WITH numbered AS (
  SELECT id, lower(split_part(email, '@', 1)) AS base,
         row_number() OVER (PARTITION BY lower(split_part(email, '@', 1)) ORDER BY created_at) AS rn
  FROM public.users
  WHERE username IS NULL OR btrim(username) = ''
)
UPDATE public.users u
SET username = CASE WHEN n.rn = 1 THEN n.base ELSE n.base || '_' || n.rn END
FROM numbered n
WHERE u.id = n.id;

-- Sanitize every username to the allowed charset so the unique index / CHECK
-- constraint below can NEVER fail on existing data (e.g. '+' or Arabic letters
-- in an email prefix would otherwise abort this script before the final reload).
WITH cleaned AS (
  SELECT id,
         regexp_replace(
           regexp_replace(lower(btrim(COALESCE(username, ''))), '[^a-z0-9._-]', '_', 'g'),
           '^[._-]+', '', 'g'
         ) AS clean
  FROM public.users
)
UPDATE public.users u
SET username = CASE WHEN c.clean = '' THEN 'user' || replace(u.id::text, '-', '') ELSE c.clean END
FROM cleaned c
WHERE u.id = c.id;

-- Final dedup after sanitization (very rare: 'a.b' and 'a_b' both become 'a_b').
WITH dup AS (
  SELECT id, row_number() OVER (PARTITION BY username ORDER BY created_at) AS rn
  FROM public.users
  WHERE username IS NOT NULL
)
UPDATE public.users u
SET username = u.username || '_' || d.rn
FROM dup d
WHERE u.id = d.id AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS users_username_uniq_idx ON public.users (username);

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_username_format_check;
ALTER TABLE public.users ADD CONSTRAINT users_username_format_check
  CHECK (username IS NULL OR username ~ '^[a-z0-9][a-z0-9._-]*$');

-- ============ 2. LOGIN LOOKUP (anon-callable) ============
-- Returns the email for a username so the client can call
-- auth.signInWithPassword(email, pin). SECURITY DEFINER bypasses RLS.
CREATE OR REPLACE FUNCTION get_login_email(p_username text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE username = lower(btrim(p_username));
  IF v_user.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;
  IF NOT v_user.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_INACTIVE');
  END IF;
  RETURN jsonb_build_object('success', true, 'email', v_user.email);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_login_email(text) TO anon, authenticated;

-- ============ 3. create_user: add p_username ============
CREATE OR REPLACE FUNCTION create_user(
  p_email text,
  p_password text,
  p_full_name text DEFAULT NULL,
  p_role text DEFAULT 'cashier',
  p_branch_id uuid DEFAULT NULL,
  p_is_active boolean DEFAULT true,
  p_username text DEFAULT NULL
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
  v_username text;
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

  -- Username: default to email prefix, sanitized, must be unique
  v_username := regexp_replace(
    regexp_replace(lower(btrim(coalesce(NULLIF(p_username, ''), split_part(v_email, '@', 1)))), '[^a-z0-9._-]', '_', 'g'),
    '^[._-]+', '', 'g'
  );
  IF v_username = '' THEN
    v_username := 'user' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE username = v_username) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USERNAME_TAKEN');
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

  INSERT INTO public.users (id, email, username, full_name, role, branch_id, is_active)
  VALUES (v_user_id, v_email, v_username, p_full_name, v_role, p_branch_id, p_is_active);

  RETURN jsonb_build_object('success', true, 'user_id', v_user_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', SQLERRM);
END;
$$;

-- ============ 4. update_user_password: allow 4-digit PINs ============
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
          'detail', 'Branch managers can only change PINs of staff in their own branch');
      END IF;
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
    END IF;
  END IF;

  IF p_new_password IS NULL OR char_length(p_new_password) < 4 THEN
    RETURN jsonb_build_object('success', false, 'error', 'WEAK_PASSWORD');
  END IF;
  IF char_length(p_new_password) = 4 AND p_new_password !~ '^[0-9]{4}$' THEN
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

-- Refresh the PostgREST schema cache.
NOTIFY pgrst, 'reload schema';

-- ==========================================
-- 008_fix_login.sql
-- ==========================================
-- Migration: Fix login for users created by create_user RPC
-- Run this in Supabase SQL Editor AFTER migration_enterprise_core.sql.
--
-- Even after the instance_id / provider_id fixes, a freshly created account can
-- still fail to sign in when ANY piece of the auth.users row is inconsistent
-- (NULL token column, missing email identity, wrong provider_id, unconfirmed
-- email, missing email_verified meta, wrong aud/role...).
--
-- This migration ships three admin-only tools (all SECURITY DEFINER, they call
-- is_pos_admin() first):
--   * verify_auth_account(user_id)  -> full health report (JSON)
--   * repair_auth_account(user_id)  -> fixes everything in one transaction
--   * password_matches(user_id, pw) -> bcrypt check (resolves pgcrypto schema)

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ============ 1. VERIFY AUTH ACCOUNT ============
-- Returns a health report so we can see exactly why a login fails.
CREATE OR REPLACE FUNCTION verify_auth_account(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_identity record;
  v_pgc_schema text;
BEGIN
  -- Only admins can run diagnostics
  IF NOT public.is_pos_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  SELECT email, encrypted_password, aud, role, instance_id,
         email_confirmed_at, confirmation_token, recovery_token,
         email_change, email_change_token_new, email_change_token_current,
         raw_user_meta_data
    INTO v_row
    FROM auth.users WHERE id = p_user_id;

  IF v_row IS NULL OR v_row.email IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND',
      'hint', 'No row found in auth.users for this id');
  END IF;

  SELECT provider, provider_id, user_id, identity_data, email
    INTO v_identity
    FROM auth.identities
    WHERE user_id = p_user_id AND provider = 'email'
    ORDER BY created_at LIMIT 1;

  SELECT extnamespace::regnamespace::text INTO v_pgc_schema
    FROM pg_extension WHERE extname = 'pgcrypto';

  RETURN jsonb_build_object(
    'success', true,
    'email', v_row.email,
    'aud', v_row.aud,
    'auth_role', v_row.role,
    'instance_ok', COALESCE(v_row.instance_id, '') = '00000000-0000-0000-0000-000000000000',
    'confirmed', v_row.email_confirmed_at IS NOT NULL,
    'tokens_ok', v_row.confirmation_token IS NOT NULL
                 AND v_row.recovery_token IS NOT NULL
                 AND v_row.email_change IS NOT NULL
                 AND v_row.email_change_token_new IS NOT NULL
                 AND v_row.email_change_token_current IS NOT NULL,
    'email_verified_meta', COALESCE(v_row.raw_user_meta_data->>'email_verified', 'false') = 'true',
    'hash_present', v_row.encrypted_password IS NOT NULL AND v_row.encrypted_password <> '',
    'hash_prefix', left(COALESCE(v_row.encrypted_password, ''), 4),
    'app_profile', EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id),
    'identity_exists', v_identity IS NOT NULL,
    'identity_provider_ok', v_identity IS NULL OR v_identity.provider_id = p_user_id::text,
    'identity_sub_ok', v_identity IS NULL OR COALESCE(v_identity.identity_data->>'sub', '') = p_user_id::text,
    'identity_email_ok', v_identity IS NULL OR lower(COALESCE(v_identity.email, v_identity.identity_data->>'email', '')) = lower(v_row.email),
    'pgcrypto_schema', v_pgc_schema
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', SQLERRM);
END;
$$;

-- ============ 2. REPAIR AUTH ACCOUNT ============
-- Fixes every known login-blocking inconsistency in one transaction, then
-- returns the verify report again so you can confirm everything is green.
CREATE OR REPLACE FUNCTION repair_auth_account(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_i_cols text;
  v_i_vals text;
BEGIN
  -- Only admins can repair accounts
  IF NOT public.is_pos_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = p_user_id;
  IF v_email IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
  END IF;

  -- 1. instance_id: GoTrue looks users up by the default instance UUID; NULL never matches
  UPDATE auth.users SET instance_id = '00000000-0000-0000-0000-000000000000'
    WHERE id = p_user_id AND instance_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000000';

  -- 2. token columns -> '' (GoTrue scans them as strings, NULL breaks login)
  UPDATE auth.users SET
    confirmation_token       = COALESCE(confirmation_token, ''),
    recovery_token           = COALESCE(recovery_token, ''),
    email_change             = COALESCE(email_change, ''),
    email_change_token_new   = COALESCE(email_change_token_new, ''),
    email_change_token_current = COALESCE(email_change_token_current, '')
    WHERE id = p_user_id;

  -- 3. confirm the email
  UPDATE auth.users SET email_confirmed_at = COALESCE(email_confirmed_at, now())
    WHERE id = p_user_id;

  -- 4. aud / role must be 'authenticated'
  UPDATE auth.users SET aud = COALESCE(NULLIF(aud, ''), 'authenticated'),
                        role = COALESCE(NULLIF(role, ''), 'authenticated')
    WHERE id = p_user_id;

  -- 5. mark email as verified in metadata
  UPDATE auth.users SET raw_user_meta_data =
      jsonb_set(COALESCE(raw_user_meta_data, '{}'::jsonb), '{email_verified}', 'true', true)
    WHERE id = p_user_id;

  -- 6. ensure the email identity exists with provider_id = user_id::text and sub = user_id::text
  IF NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = p_user_id AND provider = 'email') THEN
    SELECT string_agg(c.col, ', ' ORDER BY c.ord), string_agg(c.val, ', ' ORDER BY c.ord)
    INTO v_i_cols, v_i_vals
    FROM (
      SELECT cols.ordinal_position AS ord, quote_ident(cols.column_name) AS col,
        CASE cols.column_name
          WHEN 'id' THEN 'gen_random_uuid()'
          WHEN 'provider_id' THEN quote_literal(p_user_id::text)
          WHEN 'user_id' THEN quote_literal(p_user_id)
          WHEN 'identity_data' THEN format('jsonb_build_object(''sub'',%L,''email'',%L)', p_user_id::text, v_email)
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

    IF v_i_cols IS NOT NULL AND v_i_vals IS NOT NULL THEN
      EXECUTE 'INSERT INTO auth.identities (' || v_i_cols || ') VALUES (' || v_i_vals || ')';
    END IF;
  ELSE
    UPDATE auth.identities
    SET provider_id = p_user_id::text,
        email = v_email,
        identity_data = jsonb_build_object('sub', p_user_id::text, 'email', v_email)
    WHERE user_id = p_user_id AND provider = 'email';
  END IF;

  -- Return the post-repair health report
  RETURN public.verify_auth_account(p_user_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', SQLERRM);
END;
$$;

-- ============ 3. PASSWORD MATCH CHECK ============
-- Tests whether a stored bcrypt hash matches a given password. Resolves the
-- pgcrypto schema at runtime so it works on any Supabase project.
CREATE OR REPLACE FUNCTION password_matches(p_user_id uuid, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash text;
  v_pgc_schema text;
  v_ok boolean;
BEGIN
  IF NOT public.is_pos_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  SELECT encrypted_password INTO v_hash FROM auth.users WHERE id = p_user_id;
  IF v_hash IS NULL OR v_hash = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND',
      'hint', 'No encrypted_password stored for this user');
  END IF;

  IF p_password IS NULL OR p_password = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'EMPTY_PASSWORD');
  END IF;

  SELECT extnamespace::regnamespace::text INTO v_pgc_schema
    FROM pg_extension WHERE extname = 'pgcrypto';

  IF v_pgc_schema IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', 'pgcrypto extension is not enabled');
  END IF;

  EXECUTE format('SELECT %I.crypt($1, $2) = $2', v_pgc_schema) INTO v_ok USING p_password, v_hash;

  RETURN jsonb_build_object('success', true, 'matched', COALESCE(v_ok, false),
    'hint', CASE WHEN COALESCE(v_ok, false) THEN 'Password matches the stored hash' ELSE 'Password does NOT match the stored hash' END);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', SQLERRM);
END;
$$;

-- ==========================================
-- 009_roles.sql
-- ==========================================
-- ============================================================================
-- Roles table + role helpers (get_user_role / can_permission)
-- ----------------------------------------------------------------------------
-- The `roles` permission matrix and the two helper functions it backs were
-- defined by the legacy migration_audit_fixes.sql (now archived in legacy/).
-- The live D-series and manufacturing/accounting RPCs depend on all three, so
-- a fresh build must create them too. This file is additive and idempotent:
--   * roles table + RLS, seeded with the six base roles (ON CONFLICT DO NOTHING
--     preserves any edits made from Settings);
--   * get_user_role()  - the role of the current user;
--   * can_permission() - permission lookup in the roles matrix.
-- production_manager is inserted later by 010_manufacturing_schema.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.roles (
  role text PRIMARY KEY,
  name_ar text NOT NULL,
  name_en text NOT NULL,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_roles" ON public.roles;
CREATE POLICY "auth_select_roles" ON public.roles FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_write_roles" ON public.roles;
CREATE POLICY "auth_write_roles" ON public.roles FOR INSERT TO authenticated WITH CHECK (is_pos_admin());
DROP POLICY IF EXISTS "auth_write_roles_upd" ON public.roles;
CREATE POLICY "auth_write_roles_upd" ON public.roles FOR UPDATE TO authenticated USING (is_pos_admin()) WITH CHECK (is_pos_admin());
DROP POLICY IF EXISTS "auth_write_roles_del" ON public.roles;
CREATE POLICY "auth_write_roles_del" ON public.roles FOR DELETE TO authenticated USING (is_pos_admin());

INSERT INTO public.roles (role, name_ar, name_en, permissions) VALUES
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

-- Role of the current user (NULL for anonymous / unknown).
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $fn$
  SELECT role FROM public.users WHERE users.id = auth.uid();
$fn$;

-- Does the current user hold a dotted permission? Admins always pass.
CREATE OR REPLACE FUNCTION public.can_permission(p_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT is_pos_admin() OR EXISTS (
    SELECT 1 FROM public.users u
    JOIN public.roles r ON r.role = u.role
    WHERE u.id = auth.uid() AND r.permissions ? p_permission
  );
$fn$;

-- ==========================================
-- 010_document_serials.sql
-- ==========================================
-- Migration: Sequential document serials (invoices & purchase invoices)
-- Run this in the Supabase SQL Editor AFTER migration_pin_login.sql (or any setup).
--
-- Adds:
--   1. `document_sequences` — atomic counters per document type (`sale`, `purchase`).
--   2. `next_document_number(p_type)` — returns `<store_name>-<NNNNN>` serial that
--      increments atomically (never duplicated, even under concurrency).
--
-- The POS / Purchases pages call this RPC just before creating a document, so the
-- number shown on the invoice, the receipt and in the lists is the store name + a
-- continuous sequential number (e.g. "Premier-00001").

-- ============ 1. SEQUENCE COUNTERS ============
CREATE TABLE IF NOT EXISTS public.document_sequences (
  seq_type   text PRIMARY KEY,
  next_value bigint NOT NULL DEFAULT 1
);

-- Seed the two default counters (no-op if they already exist).
INSERT INTO public.document_sequences (seq_type, next_value)
VALUES ('sale', 1), ('purchase', 1)
ON CONFLICT (seq_type) DO NOTHING;

-- ============ 2. ATOMIC SERIAL GENERATOR ============
-- SECURITY DEFINER so `authenticated` callers can use the counter without direct
-- table access. Allocates the next number atomically (row UPDATE ... RETURNING),
-- so concurrent calls never collide. Falls back to a robust upsert if a counter
-- row is missing for a given type.
CREATE OR REPLACE FUNCTION public.next_document_number(p_type text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store text;
  v_num   bigint;
BEGIN
  IF p_type NOT IN ('sale', 'purchase') THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TYPE');
  END IF;

  LOOP
    UPDATE public.document_sequences
       SET next_value = next_value + 1
     WHERE seq_type = p_type
    RETURNING next_value - 1 INTO v_num;
    EXIT WHEN v_num IS NOT NULL;

    -- Counter row missing: create it (first number = 1) and retry.
    INSERT INTO public.document_sequences (seq_type, next_value)
    VALUES (p_type, 2)
    ON CONFLICT (seq_type) DO NOTHING;
  END LOOP;

  SELECT btrim(coalesce(store_name, '')) INTO v_store FROM public.settings LIMIT 1;
  IF v_store IS NULL OR v_store = '' THEN
    v_store := 'POS';
  END IF;

  RETURN jsonb_build_object('success', true, 'number', v_store || '-' || lpad(v_num::text, 5, '0'), 'raw', v_num);
END;
$$;

REVOKE ALL ON FUNCTION public.next_document_number(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.next_document_number(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.next_document_number(text) TO authenticated;

-- Refresh the PostgREST schema cache so the new RPC is callable immediately.
NOTIFY pgrst, 'reload schema';

-- ==========================================
-- 011_manufacturing_schema.sql
-- ==========================================
-- =====================================================================
-- Phase B1: Manufacturing, Warehouses, Batches & Inventory Ledger schema
-- =====================================================================
-- Adds: units, raw_materials, raw_material_inventory, raw_material_batches,
--       recipes, recipe_items, production_orders, production_waste,
--       warehouse_transfers, warehouse_transfer_items, inventory_batches,
--       inventory_ledger, batch columns on inventory, warehouses.warehouse_type,
--       document sequences for production_order/transfer, production_manager role.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Shared updated_at trigger function
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 2. Units of measure (global master data)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.units (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL UNIQUE,
  symbol      text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.units IS 'وحدات القياس (قطعة، كيلو، لتر، كرتونة ...)';

INSERT INTO public.units (code, name, symbol) VALUES
  ('PCS', 'قطعة', 'قطعة'),
  ('UNIT', 'وحدة', 'وحدة'),
  ('KG', 'كيلوغرام', 'كجم'),
  ('GM', 'جرام', 'جم'),
  ('LITR', 'لتر', 'لتر'),
  ('ML', 'ملليلتر', 'مل'),
  ('BOX', 'صندوق', 'صندوق'),
  ('CARTON', 'كرتونة', 'كرتونة'),
  ('PACK', 'كيس', 'كيس'),
  ('BAG', 'شنطة', 'شنطة'),
  ('BOTTLE', 'زجاجة', 'زجاجة'),
  ('CAN', 'علبة', 'علبة'),
  ('JAR', 'برطمان', 'برطمان'),
  ('CUP', 'كوب', 'كوب'),
  ('PLATE', 'طبق', 'طبق'),
  ('TRAY', 'صينية', 'صينية'),
  ('DOZEN', 'دستة', 'دستة'),
  ('CASE', 'دربكة', 'دربكة'),
  ('ROLL', 'لفة', 'لفة'),
  ('TIN', 'تنكة', 'تنكة'),
  ('BUNDLE', 'حزمة', 'حزمة'),
  ('PORTION', 'حصة', 'حصة')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "units_select" ON public.units
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "units_write" ON public.units
  FOR ALL TO authenticated USING (is_pos_admin()) WITH CHECK (is_pos_admin());

-- ---------------------------------------------------------------------
-- 3. Raw materials (global master data) + branch-scoped stock
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.raw_materials (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE,
  name          text NOT NULL,
  unit_id       uuid REFERENCES public.units(id) ON DELETE SET NULL,
  category      text,
  min_stock     numeric(14,4) NOT NULL DEFAULT 0,
  default_cost  numeric(12,2) NOT NULL DEFAULT 0,
  description   text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.raw_materials IS 'المواد الخام (مخزون المواد)';

CREATE INDEX IF NOT EXISTS idx_raw_materials_name ON public.raw_materials (name);
CREATE INDEX IF NOT EXISTS idx_raw_materials_active ON public.raw_materials (is_active);

ALTER TABLE public.raw_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "raw_materials_select" ON public.raw_materials
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "raw_materials_write" ON public.raw_materials
  FOR ALL TO authenticated USING (is_pos_admin()) WITH CHECK (is_pos_admin());

CREATE TRIGGER trg_raw_materials_updated BEFORE UPDATE ON public.raw_materials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------
-- 4. Raw material inventory (aggregate per branch) + batches (lots)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.raw_material_inventory (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_material_id   uuid NOT NULL REFERENCES public.raw_materials(id) ON DELETE CASCADE,
  branch_id         uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  quantity          numeric(14,4) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  avg_cost          numeric(12,2) NOT NULL DEFAULT 0,
  min_stock         numeric(14,4) NOT NULL DEFAULT 0,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (raw_material_id, branch_id)
);
COMMENT ON TABLE public.raw_material_inventory IS 'رصيد المواد الخام لكل فرع (رصيد إجمالي + متوسط التكلفة)';

CREATE INDEX IF NOT EXISTS idx_raw_inv_branch ON public.raw_material_inventory (branch_id);

ALTER TABLE public.raw_material_inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "raw_material_inventory_select" ON public.raw_material_inventory
  FOR SELECT TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id());
CREATE POLICY "raw_material_inventory_write" ON public.raw_material_inventory
  FOR ALL TO authenticated USING (is_pos_admin()) WITH CHECK (is_pos_admin());

CREATE TABLE IF NOT EXISTS public.raw_material_batches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_material_id   uuid NOT NULL REFERENCES public.raw_materials(id) ON DELETE CASCADE,
  branch_id         uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  batch_number      text,
  quantity          numeric(14,4) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit_cost         numeric(12,2) NOT NULL DEFAULT 0,
  production_date   date,
  expiry_date       date,
  source_type       text NOT NULL DEFAULT 'purchase',
  source_id         uuid,
  created_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.raw_material_batches IS 'دفعات المواد الخام (الاستهلاك بأقرب تاريخ انتهاء أولاً FIFO)';

CREATE INDEX IF NOT EXISTS idx_raw_batches_material ON public.raw_material_batches (raw_material_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_raw_batches_expiry ON public.raw_material_batches (raw_material_id, expiry_date);

ALTER TABLE public.raw_material_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "raw_material_batches_select" ON public.raw_material_batches
  FOR SELECT TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id());
CREATE POLICY "raw_material_batches_write" ON public.raw_material_batches
  FOR ALL TO authenticated USING (is_pos_admin()) WITH CHECK (is_pos_admin());

-- ---------------------------------------------------------------------
-- 5. Recipes (product -> raw materials)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recipes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  branch_id       uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  name            text,
  yield_quantity  numeric(14,4) NOT NULL DEFAULT 1 CHECK (yield_quantity > 0),
  notes           text,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, branch_id)
);
COMMENT ON TABLE public.recipes IS 'الوصفات: ربط المنتج المصنّع بمكوناته من المواد الخام';

ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recipes_select" ON public.recipes
  FOR SELECT TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id());
CREATE POLICY "recipes_write" ON public.recipes
  FOR ALL TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id())
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id());

CREATE TRIGGER trg_recipes_updated BEFORE UPDATE ON public.recipes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.recipe_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id         uuid NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  raw_material_id   uuid NOT NULL REFERENCES public.raw_materials(id),
  quantity          numeric(14,4) NOT NULL CHECK (quantity > 0),
  wastage_percent   numeric(5,2) NOT NULL DEFAULT 0 CHECK (wastage_percent >= 0),
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.recipe_items IS 'مكونات الوصفة (كمية من مادة خام لكل وصفة)';

ALTER TABLE public.recipe_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recipe_items_select" ON public.recipe_items
  FOR SELECT TO authenticated USING (
    is_pos_admin() OR EXISTS (
      SELECT 1 FROM public.recipes r
      WHERE r.id = recipe_items.recipe_id AND r.branch_id = get_branch_id()
    )
  );
CREATE POLICY "recipe_items_write" ON public.recipe_items
  FOR ALL TO authenticated USING (is_pos_admin()) WITH CHECK (is_pos_admin());

-- ---------------------------------------------------------------------
-- 6. Production orders + waste
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.production_orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number      text NOT NULL UNIQUE,
  product_id        uuid NOT NULL REFERENCES public.products(id),
  branch_id         uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  warehouse_id      uuid REFERENCES public.warehouses(id),
  quantity          numeric(14,4) NOT NULL CHECK (quantity > 0),
  batch_number      text,
  status            text NOT NULL DEFAULT 'planned'
                    CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled')),
  total_cost        numeric(12,2) NOT NULL DEFAULT 0,
  planned_at        date DEFAULT CURRENT_DATE,
  completed_at      timestamptz,
  cancelled_at      timestamptz,
  cancel_reason     text,
  notes             text,
  created_by        uuid REFERENCES public.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.production_orders IS 'أوامر الإنتاج (تصنيع منتج من المواد الخام عبر الوصفة)';

CREATE INDEX IF NOT EXISTS idx_production_orders_status ON public.production_orders (status, branch_id);
CREATE INDEX IF NOT EXISTS idx_production_orders_product ON public.production_orders (product_id);

ALTER TABLE public.production_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "production_orders_select" ON public.production_orders
  FOR SELECT TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id());
CREATE POLICY "production_orders_write" ON public.production_orders
  FOR ALL TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id())
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id());

CREATE TRIGGER trg_production_orders_updated BEFORE UPDATE ON public.production_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.production_waste (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid NOT NULL REFERENCES public.production_orders(id) ON DELETE CASCADE,
  branch_id         uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  raw_material_id   uuid REFERENCES public.raw_materials(id),
  product_id        uuid REFERENCES public.products(id),
  quantity          numeric(14,4) NOT NULL CHECK (quantity >= 0),
  reason            text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (raw_material_id IS NOT NULL OR product_id IS NOT NULL)
);
COMMENT ON TABLE public.production_waste IS 'هالك الإنتاج (مواد خام أو منتجات تالفة)';

ALTER TABLE public.production_waste ENABLE ROW LEVEL SECURITY;

CREATE POLICY "production_waste_select" ON public.production_waste
  FOR SELECT TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id());
CREATE POLICY "production_waste_write" ON public.production_waste
  FOR ALL TO authenticated USING (is_pos_admin()) WITH CHECK (is_pos_admin());

-- ---------------------------------------------------------------------
-- 7. Warehouse transfers (finished goods between warehouses)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.warehouse_transfers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_number     text NOT NULL UNIQUE,
  from_warehouse_id   uuid NOT NULL REFERENCES public.warehouses(id),
  to_warehouse_id     uuid NOT NULL REFERENCES public.warehouses(id),
  branch_id           uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'rejected')),
  reason              text,
  notes               text,
  requested_by        uuid REFERENCES public.users(id),
  requested_at        timestamptz NOT NULL DEFAULT now(),
  approved_by         uuid REFERENCES public.users(id),
  approved_at         timestamptz,
  rejection_reason    text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (from_warehouse_id <> to_warehouse_id)
);
COMMENT ON TABLE public.warehouse_transfers IS 'التحويلات بين المخازن (بضاعة جاهزة)';

CREATE INDEX IF NOT EXISTS idx_warehouse_transfers_status ON public.warehouse_transfers (status, branch_id);

ALTER TABLE public.warehouse_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "warehouse_transfers_select" ON public.warehouse_transfers
  FOR SELECT TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id());
CREATE POLICY "warehouse_transfers_write" ON public.warehouse_transfers
  FOR ALL TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id())
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id());

CREATE TRIGGER trg_warehouse_transfers_updated BEFORE UPDATE ON public.warehouse_transfers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.warehouse_transfer_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id     uuid NOT NULL REFERENCES public.warehouse_transfers(id) ON DELETE CASCADE,
  product_id      uuid REFERENCES public.products(id),
  quantity        numeric(14,4) NOT NULL CHECK (quantity > 0),
  unit_cost       numeric(12,2) NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (product_id IS NOT NULL)
);
COMMENT ON TABLE public.warehouse_transfer_items IS 'منتجات التحويل';

ALTER TABLE public.warehouse_transfer_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "warehouse_transfer_items_select" ON public.warehouse_transfer_items
  FOR SELECT TO authenticated USING (
    is_pos_admin() OR EXISTS (
      SELECT 1 FROM public.warehouse_transfers wt
      WHERE wt.id = warehouse_transfer_items.transfer_id AND wt.branch_id = get_branch_id()
    )
  );
CREATE POLICY "warehouse_transfer_items_write" ON public.warehouse_transfer_items
  FOR ALL TO authenticated USING (is_pos_admin()) WITH CHECK (is_pos_admin());

-- ---------------------------------------------------------------------
-- 8. Finished-goods batches (expiry-aware FIFO for sales)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_batches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  warehouse_id      uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  branch_id         uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  batch_number      text,
  quantity          numeric(14,4) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit_cost         numeric(12,2) NOT NULL DEFAULT 0,
  production_date   date,
  expiry_date       date,
  source_type       text NOT NULL DEFAULT 'purchase',
  source_id         uuid,
  created_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.inventory_batches IS 'دفعات البضاعة الجاهزة (البيع بأقرب تاريخ انتهاء أولاً FIFO)';

CREATE INDEX IF NOT EXISTS idx_inventory_batches_product ON public.inventory_batches (product_id, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventory_batches_expiry ON public.inventory_batches (product_id, expiry_date);

ALTER TABLE public.inventory_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_batches_select" ON public.inventory_batches
  FOR SELECT TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id());
CREATE POLICY "inventory_batches_write" ON public.inventory_batches
  FOR ALL TO authenticated USING (is_pos_admin()) WITH CHECK (is_pos_admin());

-- ---------------------------------------------------------------------
-- 9. Inventory ledger (single source of truth for all movements)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_ledger (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id        uuid REFERENCES public.products(id) ON DELETE CASCADE,
  raw_material_id   uuid REFERENCES public.raw_materials(id) ON DELETE CASCADE,
  branch_id         uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  warehouse_id      uuid REFERENCES public.warehouses(id),
  batch_number      text,
  quantity          numeric(14,4) NOT NULL,
  unit_cost         numeric(12,2) NOT NULL DEFAULT 0,
  total_cost        numeric(14,2) NOT NULL DEFAULT 0,
  before_qty        numeric(14,4),
  after_qty         numeric(14,4),
  entry_type        text NOT NULL,
  reference_type    text,
  reference_id      uuid,
  reference_number  text,
  created_by        uuid REFERENCES public.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((product_id IS NOT NULL) <> (raw_material_id IS NOT NULL))
);
COMMENT ON TABLE public.inventory_ledger IS 'دفتر المخزون: كل حركة كمية سواء منتجات أو مواد خام';

CREATE INDEX IF NOT EXISTS idx_inventory_ledger_product ON public.inventory_ledger (product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_raw ON public.inventory_ledger (raw_material_id);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_branch ON public.inventory_ledger (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_reference ON public.inventory_ledger (reference_type, reference_id);

ALTER TABLE public.inventory_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_ledger_select" ON public.inventory_ledger
  FOR SELECT TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id());
CREATE POLICY "inventory_ledger_write" ON public.inventory_ledger
  FOR ALL TO authenticated USING (is_pos_admin()) WITH CHECK (is_pos_admin());

-- ---------------------------------------------------------------------
-- 10. Extend existing tables
-- ---------------------------------------------------------------------
ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS batch_number text,
  ADD COLUMN IF NOT EXISTS production_date date,
  ADD COLUMN IF NOT EXISTS expiry_date date;

ALTER TABLE public.warehouses
  ADD COLUMN IF NOT EXISTS warehouse_type text NOT NULL DEFAULT 'general'
  CHECK (warehouse_type IN ('general', 'raw', 'finished'));

ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS raw_material_id uuid REFERENCES public.raw_materials(id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_raw ON public.purchase_items (raw_material_id);

-- ---------------------------------------------------------------------
-- 11. Document sequences for new documents
-- ---------------------------------------------------------------------
INSERT INTO public.document_sequences (seq_type, next_value) VALUES
  ('production_order', 1),
  ('transfer', 1)
ON CONFLICT (seq_type) DO NOTHING;

-- ---------------------------------------------------------------------
-- 12. Backfill inventory_batches from existing inventory rows
--     (opening batches keep product.cost_price so FIFO invariant holds)
-- ---------------------------------------------------------------------
INSERT INTO public.inventory_batches (product_id, warehouse_id, branch_id, batch_number, quantity, unit_cost, source_type)
SELECT i.product_id, i.warehouse_id, i.branch_id, 'OPENING', i.quantity, COALESCE(p.cost_price, 0), 'opening'
FROM public.inventory i
JOIN public.products p ON p.id = i.product_id
WHERE i.quantity > 0;

INSERT INTO public.inventory_ledger (product_id, branch_id, warehouse_id, quantity, unit_cost, total_cost,
  before_qty, after_qty, entry_type, reference_type, reference_number)
SELECT i.product_id, i.branch_id, i.warehouse_id, i.quantity, COALESCE(p.cost_price, 0),
  i.quantity * COALESCE(p.cost_price, 0), 0, i.quantity, 'opening', 'opening', 'OPENING'
FROM public.inventory i
JOIN public.products p ON p.id = i.product_id
WHERE i.quantity > 0;

-- ---------------------------------------------------------------------
-- 13. production_manager role
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_role_check' AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users ADD CONSTRAINT users_role_check
      CHECK (role IN ('super_admin', 'owner', 'branch_manager', 'cashier',
                      'warehouse_manager', 'accountant', 'production_manager'));
  ELSE
    ALTER TABLE public.users DROP CONSTRAINT users_role_check;
    ALTER TABLE public.users ADD CONSTRAINT users_role_check
      CHECK (role IN ('super_admin', 'owner', 'branch_manager', 'cashier',
                      'warehouse_manager', 'accountant', 'production_manager'));
  END IF;
END $$;

INSERT INTO public.roles (role, name_ar, name_en, permissions, updated_at)
VALUES (
  'production_manager', 'مدير إنتاج', 'Production Manager',
  '[
    "dashboard.view", "products.view", "products.manage", "categories.view", "categories.manage",
    "raw_materials.view", "raw_materials.manage", "recipes.view", "recipes.manage",
    "production.view", "production.manage", "production.waste",
    "inventory.view", "inventory.manage", "warehouses.view", "warehouses.manage",
    "inventory.transfers", "inventory.transfers.approve",
    "purchases.view", "purchases.manage", "suppliers.view", "suppliers.manage",
    "inventory.ledger.view", "shifts.view"
  ]'::jsonb,
  now()
)
ON CONFLICT (role) DO UPDATE SET
  name_ar = EXCLUDED.name_ar, name_en = EXCLUDED.name_en,
  permissions = EXCLUDED.permissions, updated_at = now();

-- ---------------------------------------------------------------------
-- 14. create_user: allow production_manager (and drop stale role names)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_user(p_email text, p_password text, p_full_name text DEFAULT NULL::text, p_role text DEFAULT 'cashier'::text, p_branch_id uuid DEFAULT NULL::uuid, p_is_active boolean DEFAULT true, p_username text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_role text;
  v_hash text;
  v_email text;
  v_username text;
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

  -- Username: default to email prefix, sanitized, must be unique
  v_username := regexp_replace(
    regexp_replace(lower(btrim(coalesce(NULLIF(p_username, ''), split_part(v_email, '@', 1)))), '[^a-z0-9._-]', '_', 'g'),
    '^[._-]+', '', 'g'
  );
  IF v_username = '' THEN
    v_username := 'user' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE username = v_username) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USERNAME_TAKEN');
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
                    'warehouse_manager', 'accountant', 'production_manager') THEN p_role
    ELSE 'cashier'
  END;

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

  INSERT INTO public.users (id, email, username, full_name, role, branch_id, is_active)
  VALUES (v_user_id, v_email, v_username, p_full_name, v_role, p_branch_id, p_is_active);

  RETURN jsonb_build_object('success', true, 'user_id', v_user_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', SQLERRM);
END;
$function$;

-- ==========================================
-- 012_sales_refund_columns.sql
-- ==========================================
-- ============================================================================
-- Refund tracking columns on sales / sale_items
-- ----------------------------------------------------------------------------
-- process_refund (defined later in manufacturing_rpc) and the receivable
-- checks in accounting_rpc / d1_foundation read sales.refunded_amount and
-- sale_items.refunded_quantity / refunded_amount. On the live database these
-- columns were added by the legacy audit_fixes migration; this file recreates
-- them for a fresh build. Additive + idempotent.
-- ============================================================================

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS refunded_amount numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS refunded_quantity numeric(14,4) NOT NULL DEFAULT 0;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS refunded_amount numeric(14,2) NOT NULL DEFAULT 0;

-- ==========================================
-- 013_manufacturing_rpc.sql
-- ==========================================
-- =====================================================================
-- Phase B2: Manufacturing, Warehouse Transfers & Inventory Ledger RPCs
-- =====================================================================
-- Internal FIFO helpers + production/transfer RPCs + rewritten
-- process_purchase / process_sale / process_refund / adjust_stock /
-- adjust_raw_stock, all writing inventory_ledger as the source of truth.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Allow new movement types in the legacy stock_transactions log
-- ---------------------------------------------------------------------
ALTER TABLE public.stock_transactions DROP CONSTRAINT IF EXISTS stock_transactions_transaction_type_check;
ALTER TABLE public.stock_transactions ADD CONSTRAINT stock_transactions_transaction_type_check
  CHECK (transaction_type IN ('sale', 'purchase', 'adjustment', 'refund',
                              'transfer', 'production', 'waste', 'opening'));

-- purchase items must reference exactly one of product or raw material
ALTER TABLE public.purchase_items DROP CONSTRAINT IF EXISTS purchase_items_one_target;
ALTER TABLE public.purchase_items ADD CONSTRAINT purchase_items_one_target
  CHECK (num_nonnulls(product_id, raw_material_id) = 1);

-- ---------------------------------------------------------------------
-- 1. next_document_number: accept any document type
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.next_document_number(p_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_store text;
  v_num   bigint;
BEGIN
  IF p_type IS NULL OR btrim(p_type) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TYPE');
  END IF;

  LOOP
    UPDATE public.document_sequences
       SET next_value = next_value + 1
     WHERE seq_type = p_type
    RETURNING next_value - 1 INTO v_num;
    EXIT WHEN v_num IS NOT NULL;

    -- Counter row missing: create it (first number = 1) and retry.
    INSERT INTO public.document_sequences (seq_type, next_value)
    VALUES (p_type, 2)
    ON CONFLICT (seq_type) DO NOTHING;
  END LOOP;

  SELECT btrim(coalesce(store_name, '')) INTO v_store FROM public.settings LIMIT 1;
  IF v_store IS NULL OR v_store = '' THEN
    v_store := 'POS';
  END IF;

  RETURN jsonb_build_object('success', true, 'number', v_store || '-' || lpad(v_num::text, 5, '0'), 'raw', v_num);
END;
$function$;

-- ---------------------------------------------------------------------
-- 2. Internal helper: add quantity of a finished product
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._product_inv_add(
  p_product_id uuid, p_warehouse_id uuid, p_branch_id uuid, p_qty numeric,
  p_unit_cost numeric DEFAULT 0,
  p_batch_number text DEFAULT NULL,
  p_production_date date DEFAULT NULL,
  p_expiry_date date DEFAULT NULL,
  p_entry_type text DEFAULT 'purchase',
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_reference_number text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_before numeric(14,4);
  v_after numeric(14,4);
  v_batch_no text;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 OR p_warehouse_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_PARAMS');
  END IF;

  v_batch_no := COALESCE(NULLIF(btrim(COALESCE(p_batch_number, '')), ''),
                         'B-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  SELECT COALESCE(quantity, 0) INTO v_before
  FROM public.inventory WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id;
  IF v_before IS NULL THEN v_before := 0; END IF;
  v_after := v_before + p_qty;

  INSERT INTO public.inventory (product_id, warehouse_id, branch_id, quantity, batch_number, production_date, expiry_date, updated_at)
  VALUES (p_product_id, p_warehouse_id, p_branch_id, p_qty, v_batch_no, p_production_date, p_expiry_date, now())
  ON CONFLICT (product_id, warehouse_id)
  DO UPDATE SET quantity = inventory.quantity + EXCLUDED.quantity,
    branch_id = EXCLUDED.branch_id, updated_at = now();

  INSERT INTO public.inventory_batches (product_id, warehouse_id, branch_id, batch_number, quantity, unit_cost, production_date, expiry_date, source_type, source_id)
  VALUES (p_product_id, p_warehouse_id, p_branch_id, v_batch_no, p_qty, COALESCE(p_unit_cost, 0),
          p_production_date, p_expiry_date, COALESCE(p_reference_type, p_entry_type), p_reference_id);

  INSERT INTO public.inventory_ledger (product_id, branch_id, warehouse_id, batch_number, quantity, unit_cost, total_cost, before_qty, after_qty, entry_type, reference_type, reference_id, reference_number, created_by)
  VALUES (p_product_id, p_branch_id, p_warehouse_id, v_batch_no, p_qty, COALESCE(p_unit_cost, 0),
          p_qty * COALESCE(p_unit_cost, 0), v_before, v_after, p_entry_type,
          p_reference_type, p_reference_id, p_reference_number, p_created_by);

  INSERT INTO public.stock_transactions (product_id, warehouse_id, branch_id, transaction_type, component_flow, reference_type, reference_id, quantity, before_quantity, after_quantity, unit_cost, created_by)
  VALUES (p_product_id, p_warehouse_id, p_branch_id, p_entry_type, false,
          COALESCE(p_reference_type, p_entry_type), p_reference_id, p_qty, v_before, v_after,
          COALESCE(p_unit_cost, 0), p_created_by);

  RETURN jsonb_build_object('success', true, 'before_qty', v_before, 'after_qty', v_after, 'batch_number', v_batch_no);
END;
$function$;

-- ---------------------------------------------------------------------
-- 3. Internal helper: remove finished product FIFO (nearest expiry first)
--    p_warehouse_id NULL => consume across all branch warehouses.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._product_inv_remove_fifo(
  p_product_id uuid, p_warehouse_id uuid, p_branch_id uuid, p_qty numeric,
  p_entry_type text DEFAULT 'sale',
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_reference_number text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_remaining numeric(14,4);
  v_batch record;
  v_deduct numeric(14,4);
  v_before numeric(14,4);
  v_after numeric(14,4);
  v_total_cost numeric(14,2) := 0;
  v_total_removed numeric(14,4) := 0;
  v_shortage numeric(14,4) := 0;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RETURN jsonb_build_object('success', true, 'shortage', 0, 'removed', 0, 'total_cost', 0, 'avg_cost', 0);
  END IF;

  v_remaining := p_qty;

  FOR v_batch IN
    SELECT b.id, b.warehouse_id, b.quantity, b.unit_cost, b.batch_number
    FROM public.inventory_batches b
    WHERE b.product_id = p_product_id AND b.quantity > 0 AND b.branch_id = p_branch_id
      AND (p_warehouse_id IS NULL OR b.warehouse_id = p_warehouse_id)
    ORDER BY b.expiry_date NULLS LAST, b.created_at ASC, b.id ASC
    FOR UPDATE
  LOOP
    IF v_remaining <= 0 THEN EXIT; END IF;
    v_deduct := LEAST(v_batch.quantity, v_remaining);

    SELECT COALESCE(quantity, 0) INTO v_before
    FROM public.inventory WHERE product_id = p_product_id AND warehouse_id = v_batch.warehouse_id;
    IF v_before IS NULL THEN v_before := 0; END IF;
    v_after := v_before - v_deduct;
    IF v_after < 0 THEN v_after := 0; END IF;

    UPDATE public.inventory SET quantity = v_after, updated_at = now()
    WHERE product_id = p_product_id AND warehouse_id = v_batch.warehouse_id;
    UPDATE public.inventory_batches SET quantity = quantity - v_deduct WHERE id = v_batch.id;

    INSERT INTO public.inventory_ledger (product_id, branch_id, warehouse_id, batch_number, quantity, unit_cost, total_cost, before_qty, after_qty, entry_type, reference_type, reference_id, reference_number, created_by)
    VALUES (p_product_id, p_branch_id, v_batch.warehouse_id, v_batch.batch_number, -v_deduct,
            v_batch.unit_cost, -v_deduct * v_batch.unit_cost, v_before, v_after, p_entry_type,
            p_reference_type, p_reference_id, p_reference_number, p_created_by);

    INSERT INTO public.stock_transactions (product_id, warehouse_id, branch_id, transaction_type, component_flow, reference_type, reference_id, quantity, before_quantity, after_quantity, unit_cost, created_by)
    VALUES (p_product_id, v_batch.warehouse_id, p_branch_id, p_entry_type, false,
            COALESCE(p_reference_type, p_entry_type), p_reference_id, -v_deduct, v_before, v_after,
            v_batch.unit_cost, p_created_by);

    v_total_cost := v_total_cost + v_deduct * v_batch.unit_cost;
    v_total_removed := v_total_removed + v_deduct;
    v_remaining := v_remaining - v_deduct;
  END LOOP;

  v_shortage := v_remaining;

  RETURN jsonb_build_object('success', true, 'shortage', v_shortage, 'removed', v_total_removed,
    'total_cost', v_total_cost,
    'avg_cost', CASE WHEN v_total_removed > 0 THEN round(v_total_cost / v_total_removed, 2) ELSE 0 END);
END;
$function$;

-- ---------------------------------------------------------------------
-- 4. Internal helper: add raw material quantity (branch-scoped, weighted avg)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._raw_add(
  p_raw_material_id uuid, p_branch_id uuid, p_qty numeric,
  p_unit_cost numeric DEFAULT 0,
  p_batch_number text DEFAULT NULL,
  p_production_date date DEFAULT NULL,
  p_expiry_date date DEFAULT NULL,
  p_entry_type text DEFAULT 'purchase',
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_reference_number text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_inv record;
  v_new_qty numeric(14,4);
  v_new_avg numeric(12,2);
  v_before numeric(14,4) := 0;
  v_after numeric(14,4);
  v_batch_no text;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_PARAMS');
  END IF;

  v_batch_no := COALESCE(NULLIF(btrim(COALESCE(p_batch_number, '')), ''),
                         'RB-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  SELECT * INTO v_inv
  FROM public.raw_material_inventory
  WHERE raw_material_id = p_raw_material_id AND branch_id = p_branch_id
  FOR UPDATE;

  IF v_inv.id IS NULL THEN
    v_before := 0;
    v_after := p_qty;
    v_new_avg := COALESCE(p_unit_cost, 0);
    INSERT INTO public.raw_material_inventory (raw_material_id, branch_id, quantity, avg_cost)
    VALUES (p_raw_material_id, p_branch_id, p_qty, v_new_avg);
  ELSE
    v_before := v_inv.quantity;
    v_after := v_before + p_qty;
    v_new_avg := CASE WHEN v_after > 0
      THEN round((v_inv.quantity * v_inv.avg_cost + p_qty * COALESCE(p_unit_cost, 0)) / v_after, 2)
      ELSE COALESCE(p_unit_cost, 0) END;
    UPDATE public.raw_material_inventory
    SET quantity = v_after, avg_cost = v_new_avg, updated_at = now()
    WHERE id = v_inv.id;
  END IF;

  INSERT INTO public.raw_material_batches (raw_material_id, branch_id, batch_number, quantity, unit_cost, production_date, expiry_date, source_type, source_id)
  VALUES (p_raw_material_id, p_branch_id, v_batch_no, p_qty, COALESCE(p_unit_cost, 0),
          p_production_date, p_expiry_date, COALESCE(p_reference_type, p_entry_type), p_reference_id);

  INSERT INTO public.inventory_ledger (raw_material_id, branch_id, batch_number, quantity, unit_cost, total_cost, before_qty, after_qty, entry_type, reference_type, reference_id, reference_number, created_by)
  VALUES (p_raw_material_id, p_branch_id, v_batch_no, p_qty, COALESCE(p_unit_cost, 0),
          p_qty * COALESCE(p_unit_cost, 0), v_before, v_after, p_entry_type,
          p_reference_type, p_reference_id, p_reference_number, p_created_by);

  RETURN jsonb_build_object('success', true, 'before_qty', v_before, 'after_qty', v_after,
    'avg_cost', v_new_avg, 'batch_number', v_batch_no);
END;
$function$;

-- ---------------------------------------------------------------------
-- 5. Internal helper: remove raw material FIFO (nearest expiry first)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._raw_remove_fifo(
  p_raw_material_id uuid, p_branch_id uuid, p_qty numeric,
  p_entry_type text DEFAULT 'production',
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_reference_number text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_remaining numeric(14,4);
  v_batch record;
  v_deduct numeric(14,4);
  v_before numeric(14,4);
  v_after numeric(14,4);
  v_avg_val numeric(14,2) := 0;
  v_total_cost numeric(14,2) := 0;
  v_total_removed numeric(14,4) := 0;
  v_shortage numeric(14,4) := 0;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RETURN jsonb_build_object('success', true, 'shortage', 0, 'removed', 0, 'total_cost', 0, 'avg_cost', 0);
  END IF;

  v_remaining := p_qty;

  SELECT COALESCE(quantity, 0) INTO v_before
  FROM public.raw_material_inventory
  WHERE raw_material_id = p_raw_material_id AND branch_id = p_branch_id;
  IF v_before IS NULL THEN v_before := 0; END IF;
  v_after := v_before;

  FOR v_batch IN
    SELECT b.id, b.quantity, b.unit_cost, b.batch_number
    FROM public.raw_material_batches b
    WHERE b.raw_material_id = p_raw_material_id AND b.branch_id = p_branch_id AND b.quantity > 0
    ORDER BY b.expiry_date NULLS LAST, b.created_at ASC, b.id ASC
    FOR UPDATE
  LOOP
    IF v_remaining <= 0 THEN EXIT; END IF;
    v_deduct := LEAST(v_batch.quantity, v_remaining);

    UPDATE public.raw_material_batches SET quantity = quantity - v_deduct WHERE id = v_batch.id;

    v_after := v_after - v_deduct;
    INSERT INTO public.inventory_ledger (raw_material_id, branch_id, batch_number, quantity, unit_cost, total_cost, before_qty, after_qty, entry_type, reference_type, reference_id, reference_number, created_by)
    VALUES (p_raw_material_id, p_branch_id, v_batch.batch_number, -v_deduct, v_batch.unit_cost,
            -v_deduct * v_batch.unit_cost, v_after + v_deduct, v_after, p_entry_type,
            p_reference_type, p_reference_id, p_reference_number, p_created_by);

    v_total_cost := v_total_cost + v_deduct * v_batch.unit_cost;
    v_total_removed := v_total_removed + v_deduct;
    v_remaining := v_remaining - v_deduct;
  END LOOP;

  v_shortage := v_remaining;

  SELECT COALESCE(SUM(b.quantity), 0), COALESCE(SUM(b.quantity * b.unit_cost), 0)
  INTO v_after, v_avg_val
  FROM public.raw_material_batches b
  WHERE b.raw_material_id = p_raw_material_id AND b.branch_id = p_branch_id;

  UPDATE public.raw_material_inventory
  SET quantity = v_after,
      avg_cost = CASE WHEN v_after > 0 THEN round(v_avg_val / v_after, 2) ELSE 0 END,
      updated_at = now()
  WHERE raw_material_id = p_raw_material_id AND branch_id = p_branch_id;

  RETURN jsonb_build_object('success', true, 'shortage', v_shortage, 'removed', v_total_removed,
    'total_cost', v_total_cost,
    'avg_cost', CASE WHEN v_total_removed > 0 THEN round(v_total_cost / v_total_removed, 2) ELSE 0 END);
END;
$function$;

-- ---------------------------------------------------------------------
-- 6. Internal helper: move finished product between warehouses (FIFO)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._product_inv_move(
  p_product_id uuid, p_from_wh uuid, p_to_wh uuid, p_branch_id uuid, p_qty numeric,
  p_reference_type text DEFAULT 'transfer',
  p_reference_id uuid DEFAULT NULL,
  p_reference_number text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_to_branch uuid;
  v_remaining numeric(14,4);
  v_batch record;
  v_deduct numeric(14,4);
  v_before numeric(14,4);
  v_after numeric(14,4);
  v_shortage numeric(14,4) := 0;
BEGIN
  SELECT COALESCE(branch_id, p_branch_id) INTO v_to_branch FROM public.warehouses WHERE id = p_to_wh;

  v_remaining := p_qty;

  FOR v_batch IN
    SELECT b.id, b.warehouse_id, b.quantity, b.unit_cost, b.batch_number, b.production_date, b.expiry_date
    FROM public.inventory_batches b
    WHERE b.product_id = p_product_id AND b.quantity > 0 AND b.warehouse_id = p_from_wh
    ORDER BY b.expiry_date NULLS LAST, b.created_at ASC, b.id ASC
    FOR UPDATE
  LOOP
    IF v_remaining <= 0 THEN EXIT; END IF;
    v_deduct := LEAST(v_batch.quantity, v_remaining);

    SELECT COALESCE(quantity, 0) INTO v_before
    FROM public.inventory WHERE product_id = p_product_id AND warehouse_id = p_from_wh;
    IF v_before IS NULL THEN v_before := 0; END IF;
    v_after := v_before - v_deduct;
    IF v_after < 0 THEN v_after := 0; END IF;
    UPDATE public.inventory SET quantity = v_after, updated_at = now()
    WHERE product_id = p_product_id AND warehouse_id = p_from_wh;
    UPDATE public.inventory_batches SET quantity = quantity - v_deduct WHERE id = v_batch.id;

    INSERT INTO public.inventory_ledger (product_id, branch_id, warehouse_id, batch_number, quantity, unit_cost, total_cost, before_qty, after_qty, entry_type, reference_type, reference_id, reference_number, created_by)
    VALUES (p_product_id, p_branch_id, p_from_wh, v_batch.batch_number, -v_deduct, v_batch.unit_cost,
            -v_deduct * v_batch.unit_cost, v_before, v_after, 'transfer',
            p_reference_type, p_reference_id, p_reference_number, p_created_by);

    INSERT INTO public.stock_transactions (product_id, warehouse_id, branch_id, transaction_type, component_flow, reference_type, reference_id, quantity, before_quantity, after_quantity, unit_cost, created_by)
    VALUES (p_product_id, p_from_wh, p_branch_id, 'transfer', false,
            p_reference_type, p_reference_id, -v_deduct, v_before, v_after, v_batch.unit_cost, p_created_by);

    PERFORM public._product_inv_add(p_product_id, p_to_wh, COALESCE(v_to_branch, p_branch_id),
      v_deduct, v_batch.unit_cost, v_batch.batch_number, v_batch.production_date, v_batch.expiry_date,
      'transfer', p_reference_type, p_reference_id, p_reference_number, p_created_by);

    v_remaining := v_remaining - v_deduct;
  END LOOP;

  v_shortage := v_remaining;

  RETURN jsonb_build_object('success', true, 'shortage', v_shortage, 'moved', p_qty - v_remaining);
END;
$function$;

-- =====================================================================
-- PRODUCTION ORDERS
-- =====================================================================

CREATE OR REPLACE FUNCTION public.create_production_order(
  p_product_id uuid, p_branch_id uuid, p_warehouse_id uuid, p_quantity numeric,
  p_batch_number text DEFAULT NULL, p_planned_at date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id uuid;
  v_number text;
  v_batch text;
  v_user_branch uuid;
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND NOT can_permission('production.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
        'detail', 'Creating production orders requires the production.manage permission.');
    END IF;

    IF p_quantity IS NULL OR p_quantity <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUANTITY');
    END IF;

    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND p_branch_id <> v_user_branch THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_product_id AND branch_id = p_branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_IN_BRANCH', 'product_id', p_product_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM recipes WHERE product_id = p_product_id AND branch_id = p_branch_id AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'NO_RECIPE', 'product_id', p_product_id);
    END IF;

    IF p_warehouse_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM warehouses WHERE id = p_warehouse_id AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'WAREHOUSE_NOT_FOUND');
    END IF;

    v_number := (public.next_document_number('production_order')->>'number')::text;
    v_batch := COALESCE(NULLIF(btrim(COALESCE(p_batch_number, '')), ''),
                        'B-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

    INSERT INTO public.production_orders (order_number, product_id, branch_id, warehouse_id, quantity, batch_number, planned_at, notes, created_by)
    VALUES (v_number, p_product_id, p_branch_id, p_warehouse_id, p_quantity, v_batch, p_planned_at, p_notes, auth.uid())
    RETURNING id INTO v_order_id;

    RETURN jsonb_build_object('success', true, 'order_id', v_order_id, 'order_number', v_number, 'batch_number', v_batch);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.start_production_order(p_order_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND NOT can_permission('production.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;

    SELECT status INTO v_status FROM public.production_orders WHERE id = p_order_id;
    IF v_status IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
    END IF;
    IF v_status <> 'planned' THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'status', v_status);
    END IF;

    UPDATE public.production_orders SET status = 'in_progress' WHERE id = p_order_id;
    RETURN jsonb_build_object('success', true, 'order_id', p_order_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_production_order(
  p_order_id uuid, p_waste jsonb DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_order record;
  v_recipe_id uuid;
  v_recipe_yield numeric(14,4);
  v_factor numeric(14,4);
  v_item record;
  v_waste_item jsonb;
  v_req numeric(14,4);
  v_res jsonb;
  v_short numeric(14,4);
  v_cost numeric(14,2) := 0;
  v_unit_cost numeric(12,2) := 0;
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND NOT can_permission('production.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;

    SELECT * INTO v_order FROM public.production_orders WHERE id = p_order_id FOR UPDATE;
    IF v_order.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
    END IF;
    IF v_order.status NOT IN ('planned', 'in_progress') THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'status', v_order.status);
    END IF;
    IF v_order.warehouse_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'WAREHOUSE_REQUIRED',
        'detail', 'Assign an output warehouse to the production order before completing it.');
    END IF;

    SELECT id, yield_quantity INTO v_recipe_id, v_recipe_yield
    FROM public.recipes
    WHERE product_id = v_order.product_id AND branch_id = v_order.branch_id AND is_active
    ORDER BY updated_at DESC LIMIT 1;
    IF v_recipe_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'NO_RECIPE', 'product_id', v_order.product_id);
    END IF;

    v_recipe_yield := COALESCE(v_recipe_yield, 1);
    v_factor := v_order.quantity / v_recipe_yield;

    -- Consume raw materials (FIFO by nearest expiry)
    FOR v_item IN SELECT * FROM public.recipe_items WHERE recipe_id = v_recipe_id
    LOOP
      v_req := COALESCE(v_item.quantity, 0) * v_factor;
      IF v_req <= 0 THEN CONTINUE; END IF;

      v_res := public._raw_remove_fifo(v_item.raw_material_id, v_order.branch_id, v_req,
        'production', 'production_order', v_order.id, v_order.order_number, auth.uid());
      v_short := (v_res->>'shortage')::numeric;
      IF v_short > 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_RAW',
          'raw_material_id', v_item.raw_material_id, 'required', v_req,
          'available', v_req - v_short,
          'detail', 'Not enough raw material to complete production. The order was not completed.');
      END IF;
      v_cost := v_cost + (v_res->>'total_cost')::numeric;
    END LOOP;

    -- Record waste (extra raw material consumed beyond the recipe)
    IF p_waste IS NOT NULL AND jsonb_array_length(p_waste) > 0 THEN
      FOR v_waste_item IN SELECT * FROM jsonb_array_elements(p_waste)
      LOOP
        v_req := COALESCE((v_waste_item->>'quantity')::numeric, 0);
        IF v_req <= 0 THEN CONTINUE; END IF;
        v_res := public._raw_remove_fifo((v_waste_item->>'raw_material_id')::uuid, v_order.branch_id, v_req,
          'waste', 'production_order', v_order.id, v_order.order_number, auth.uid());
        v_cost := v_cost + (v_res->>'total_cost')::numeric;
        INSERT INTO public.production_waste (order_id, branch_id, raw_material_id, quantity, reason)
        VALUES (v_order.id, v_order.branch_id, (v_waste_item->>'raw_material_id')::uuid, v_req,
                COALESCE(v_waste_item->>'reason', 'إنتاج'));
      END LOOP;
    END IF;

    -- Produce output as a new batch
    v_unit_cost := CASE WHEN v_order.quantity > 0 THEN round(v_cost / v_order.quantity, 2) ELSE 0 END;
    v_res := public._product_inv_add(v_order.product_id, v_order.warehouse_id, v_order.branch_id,
      v_order.quantity, v_unit_cost, v_order.batch_number, CURRENT_DATE, NULL,
      'production', 'production_order', v_order.id, v_order.order_number, auth.uid());
    IF NOT (v_res->>'success')::boolean THEN
      RETURN v_res;
    END IF;

    UPDATE public.production_orders
    SET status = 'completed', total_cost = v_cost, completed_at = now()
    WHERE id = v_order.id;

    RETURN jsonb_build_object('success', true, 'order_id', v_order.id, 'order_number', v_order.order_number,
      'total_cost', v_cost, 'unit_cost', v_unit_cost);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_production_order(p_order_id uuid, p_reason text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND NOT can_permission('production.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;

    SELECT status INTO v_status FROM public.production_orders WHERE id = p_order_id;
    IF v_status IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
    END IF;
    IF v_status NOT IN ('planned', 'in_progress') THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'status', v_status);
    END IF;

    UPDATE public.production_orders
    SET status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason
    WHERE id = p_order_id;

    RETURN jsonb_build_object('success', true, 'order_id', p_order_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- =====================================================================
-- WAREHOUSE TRANSFERS
-- =====================================================================

CREATE OR REPLACE FUNCTION public.create_warehouse_transfer(
  p_from_warehouse_id uuid, p_to_warehouse_id uuid, p_branch_id uuid,
  p_items jsonb, p_reason text DEFAULT NULL, p_notes text DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_transfer_id uuid;
  v_number text;
  v_item jsonb;
  v_product_id uuid;
  v_qty numeric(14,4);
  v_user_branch uuid;
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND NOT can_permission('inventory.transfers') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
        'detail', 'Creating transfers requires the inventory.transfers permission.');
    END IF;

    IF p_from_warehouse_id IS NULL OR p_to_warehouse_id IS NULL OR p_from_warehouse_id = p_to_warehouse_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_WAREHOUSES');
    END IF;
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'EMPTY_CART');
    END IF;

    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND p_branch_id <> v_user_branch THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM warehouses WHERE id = p_from_warehouse_id AND is_active)
       OR NOT EXISTS (SELECT 1 FROM warehouses WHERE id = p_to_warehouse_id AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'WAREHOUSE_NOT_FOUND');
    END IF;

    v_number := (public.next_document_number('transfer')->>'number')::text;

    INSERT INTO public.warehouse_transfers (transfer_number, from_warehouse_id, to_warehouse_id, branch_id, reason, notes, requested_by)
    VALUES (v_number, p_from_warehouse_id, p_to_warehouse_id, p_branch_id, p_reason, p_notes, auth.uid())
    RETURNING id INTO v_transfer_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_qty := COALESCE((v_item->>'quantity')::numeric, 0);
      IF v_product_id IS NULL OR v_qty <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_ITEM', 'item', v_item);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM products WHERE id = v_product_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_FOUND', 'product_id', v_product_id);
      END IF;
      INSERT INTO public.warehouse_transfer_items (transfer_id, product_id, quantity, unit_cost)
      VALUES (v_transfer_id, v_product_id, v_qty, COALESCE((v_item->>'unit_cost')::numeric, 0));
    END LOOP;

    RETURN jsonb_build_object('success', true, 'transfer_id', v_transfer_id, 'transfer_number', v_number);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.approve_warehouse_transfer(p_transfer_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_transfer record;
  v_item record;
  v_avail numeric(14,4);
  v_res jsonb;
  v_short numeric(14,4);
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND NOT can_permission('inventory.transfers.approve') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
        'detail', 'Approving transfers requires the inventory.transfers.approve permission.');
    END IF;

    SELECT * INTO v_transfer FROM public.warehouse_transfers WHERE id = p_transfer_id FOR UPDATE;
    IF v_transfer.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'TRANSFER_NOT_FOUND');
    END IF;
    IF v_transfer.status <> 'pending' THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'status', v_transfer.status);
    END IF;

    -- Validate availability for all items before moving anything
    FOR v_item IN SELECT * FROM public.warehouse_transfer_items WHERE transfer_id = p_transfer_id
    LOOP
      SELECT COALESCE(SUM(quantity), 0) INTO v_avail
      FROM public.inventory_batches
      WHERE product_id = v_item.product_id AND warehouse_id = v_transfer.from_warehouse_id;
      IF v_avail < v_item.quantity THEN
        RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_STOCK',
          'product_id', v_item.product_id, 'required', v_item.quantity, 'available', v_avail);
      END IF;
    END LOOP;

    FOR v_item IN SELECT * FROM public.warehouse_transfer_items WHERE transfer_id = p_transfer_id
    LOOP
      v_res := public._product_inv_move(v_item.product_id, v_transfer.from_warehouse_id,
        v_transfer.to_warehouse_id, v_transfer.branch_id, v_item.quantity,
        'warehouse_transfer', v_transfer.id, v_transfer.transfer_number, auth.uid());
      v_short := (v_res->>'shortage')::numeric;
      IF v_short > 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_STOCK',
          'product_id', v_item.product_id, 'shortage', v_short);
      END IF;
    END LOOP;

    UPDATE public.warehouse_transfers
    SET status = 'approved', approved_by = auth.uid(), approved_at = now()
    WHERE id = p_transfer_id;

    RETURN jsonb_build_object('success', true, 'transfer_id', p_transfer_id, 'transfer_number', v_transfer.transfer_number);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reject_warehouse_transfer(p_transfer_id uuid, p_reason text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND NOT can_permission('inventory.transfers.approve') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;

    SELECT status INTO v_status FROM public.warehouse_transfers WHERE id = p_transfer_id;
    IF v_status IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'TRANSFER_NOT_FOUND');
    END IF;
    IF v_status <> 'pending' THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'status', v_status);
    END IF;

    UPDATE public.warehouse_transfers
    SET status = 'rejected', approved_by = auth.uid(), approved_at = now(), rejection_reason = p_reason
    WHERE id = p_transfer_id;

    RETURN jsonb_build_object('success', true, 'transfer_id', p_transfer_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- =====================================================================
-- PURCHASES (rewritten: products + raw materials, batches, avg cost)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.process_purchase(p_invoice_number text, p_supplier_id uuid, p_branch_id uuid, p_warehouse_id uuid, p_subtotal numeric, p_discount_amount numeric, p_tax_amount numeric, p_total numeric, p_paid_amount numeric, p_payment_method text, p_status text, p_notes text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_purchase_id uuid;
  v_user_branch uuid;
  v_item jsonb;
  v_product_id uuid;
  v_raw_id uuid;
  v_quantity numeric(14,4);
  v_unit_cost numeric(12,2);
  v_res jsonb;
  v_unit_name text;
  v_stock numeric(14,4);
  v_stock_val numeric(14,2);
  v_new_cost numeric(12,2);
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

    -- Validate items before writing
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_raw_id := (v_item->>'raw_material_id')::uuid;
      v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
      IF (v_product_id IS NULL) = (v_raw_id IS NULL) THEN
        RETURN jsonb_build_object('success', false, 'error', 'ITEM_MISSING_TYPE');
      END IF;
      IF v_quantity <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUANTITY');
      END IF;
      IF v_product_id IS NOT NULL AND p_warehouse_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'WAREHOUSE_REQUIRED',
          'detail', 'Select a warehouse to receive product items.');
      END IF;
    END LOOP;

    INSERT INTO purchases (invoice_number, supplier_id, branch_id, warehouse_id, buyer_id,
      subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status, notes)
    VALUES (p_invoice_number, p_supplier_id, p_branch_id, p_warehouse_id, auth.uid(),
      p_subtotal, p_discount_amount, p_tax_amount, p_total, p_paid_amount, p_payment_method, p_status, p_notes)
    RETURNING id INTO v_purchase_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_raw_id := (v_item->>'raw_material_id')::uuid;
      v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
      v_unit_cost := COALESCE((v_item->>'unit_cost')::numeric, 0);

      IF v_product_id IS NOT NULL THEN
        INSERT INTO purchase_items (purchase_id, product_id, unit_name, quantity, unit_cost, total)
        VALUES (v_purchase_id, v_product_id, COALESCE(v_item->>'unit_name', 'piece'),
          v_quantity, v_unit_cost, v_quantity * v_unit_cost);

        v_res := public._product_inv_add(v_product_id, p_warehouse_id, p_branch_id, v_quantity,
          v_unit_cost, v_item->>'batch_number',
          (v_item->>'production_date')::date, (v_item->>'expiry_date')::date,
          'purchase', 'purchase', v_purchase_id, p_invoice_number, auth.uid());
        IF NOT (v_res->>'success')::boolean THEN
          RETURN v_res;
        END IF;

        -- Weighted-average cost on the product master
        SELECT COALESCE(SUM(b.quantity), 0), COALESCE(SUM(b.quantity * b.unit_cost), 0)
        INTO v_stock, v_stock_val
        FROM public.inventory_batches b WHERE b.product_id = v_product_id;
        v_new_cost := CASE WHEN v_stock > 0 THEN round(v_stock_val / v_stock, 2) ELSE v_unit_cost END;
        UPDATE public.products SET cost_price = v_new_cost, updated_at = now() WHERE id = v_product_id;
      ELSE
        SELECT COALESCE(u.symbol, u.name, 'وحدة') INTO v_unit_name
        FROM public.raw_materials rm LEFT JOIN public.units u ON u.id = rm.unit_id
        WHERE rm.id = v_raw_id;

        INSERT INTO purchase_items (purchase_id, raw_material_id, unit_name, quantity, unit_cost, total)
        VALUES (v_purchase_id, v_raw_id, COALESCE(NULLIF(v_item->>'unit_name', ''), v_unit_name),
          v_quantity, v_unit_cost, v_quantity * v_unit_cost);

        v_res := public._raw_add(v_raw_id, p_branch_id, v_quantity, v_unit_cost,
          v_item->>'batch_number', (v_item->>'production_date')::date, (v_item->>'expiry_date')::date,
          'purchase', 'purchase', v_purchase_id, p_invoice_number, auth.uid());
        IF NOT (v_res->>'success')::boolean THEN
          RETURN v_res;
        END IF;
      END IF;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'purchase_id', v_purchase_id, 'invoice_number', p_invoice_number);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- =====================================================================
-- SALES (rewritten: FIFO by nearest expiry, no component consumption)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.process_sale(p_invoice_number text, p_branch_id uuid, p_warehouse_id uuid, p_customer_id uuid, p_salesperson_id uuid, p_subtotal numeric, p_discount_amount numeric, p_discount_type text, p_tax_amount numeric, p_bonus_amount numeric, p_total numeric, p_paid_amount numeric, p_payment_method text, p_status text, p_items jsonb, p_shift_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_warehouse_ids uuid[];
  v_available numeric(14,4);
  v_res jsonb;
  v_short numeric(14,4);
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

      IF NOT EXISTS (SELECT 1 FROM products WHERE id = v_product_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_FOUND', 'product_id', v_product_id);
      END IF;

      -- Branch ownership: the product must belong to the sale branch
      IF NOT EXISTS (
        SELECT 1 FROM products WHERE id = v_product_id AND branch_id = p_branch_id
      ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_IN_BRANCH',
          'product_id', v_product_id, 'branch_id', p_branch_id);
      END IF;

      SELECT COALESCE(SUM(quantity), 0) INTO v_available
      FROM inventory_batches
      WHERE product_id = v_product_id AND warehouse_id = ANY(v_warehouse_ids);
      IF v_available < v_quantity THEN
        RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_STOCK',
          'product_id', v_product_id, 'required', v_quantity, 'available', v_available);
      END IF;
    END LOOP;

    -- ===== WRITE PHASE 1: sale header =====
    INSERT INTO sales (invoice_number, branch_id, warehouse_id, customer_id, cashier_id, salesperson_id,
      subtotal, discount_amount, discount_type, tax_amount, bonus_amount, total, paid_amount, payment_method, status)
    VALUES (p_invoice_number, p_branch_id, p_warehouse_id, p_customer_id, auth.uid(), p_salesperson_id,
      p_subtotal, p_discount_amount, p_discount_type, p_tax_amount, p_bonus_amount,
      p_total, p_paid_amount, p_payment_method, p_status)
    RETURNING id INTO v_sale_id;

    -- ===== WRITE PHASE 2: items + FIFO stock deduction + ledger =====
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

      v_res := public._product_inv_remove_fifo(v_product_id, NULL, p_branch_id, v_quantity,
        'sale', 'sale', v_sale_id, p_invoice_number, auth.uid());
      v_short := (v_res->>'shortage')::numeric;
      IF v_short > 0 THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: product % needs % but only % available',
          v_product_id, v_quantity, (v_quantity - v_short);
      END IF;
    END LOOP;

    -- ===== WRITE PHASE 3: log the sale into the active shift =====
    IF v_shift_id IS NOT NULL THEN
      INSERT INTO shift_operations (shift_id, operation_type, amount, payment_method, reference_type, reference_id, created_by)
      VALUES (v_shift_id, 'sale', COALESCE(p_paid_amount, 0), p_payment_method, 'sale', v_sale_id, auth.uid());
    END IF;

    RETURN jsonb_build_object('success', true, 'sale_id', v_sale_id, 'invoice_number', p_invoice_number);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'INSUFFICIENT_STOCK%' THEN
      RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_STOCK', 'detail', SQLERRM);
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- =====================================================================
-- REFUNDS (rewritten: restore stock to original warehouses as new batch)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.process_refund(p_sale_id uuid, p_items jsonb DEFAULT NULL::jsonb, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_remaining numeric(14,4);
  v_back numeric(14,4);
  v_ld record;
  v_res jsonb;
  v_fallback_wh uuid;
  v_last_cost numeric(12,2);
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

    SELECT id INTO v_fallback_wh FROM warehouses
      WHERE branch_id = v_sale.branch_id AND is_active = true ORDER BY created_at LIMIT 1;

    -- ===== VALIDATION PHASE =====
    IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
      FOR v_req IN SELECT * FROM jsonb_array_elements(p_items)
      LOOP
        v_item_id := (v_req->>'sale_item_id')::uuid;
        v_req_qty := COALESCE((v_req->>'quantity')::numeric, 0);
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
        v_req_qty := 0;
        SELECT (req->>'quantity')::numeric INTO v_req_qty
        FROM jsonb_array_elements(p_items) req
        WHERE (req->>'sale_item_id')::uuid = v_item.id;
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

      -- Restore stock to the warehouses the sale deducted from (FIFO restore as new batch)
      v_remaining := v_req_qty;
      SELECT COALESCE(l.unit_cost, p.cost_price, 0) INTO v_last_cost
      FROM products p LEFT JOIN inventory_ledger l
        ON l.product_id = p.id AND l.quantity < 0 AND l.reference_type = 'sale'
           AND l.reference_id = p_sale_id
      WHERE p.id = v_item.product_id
      ORDER BY l.id DESC NULLS LAST LIMIT 1;

      FOR v_ld IN
        SELECT l.warehouse_id, l.batch_number, l.unit_cost, -l.quantity AS debited
        FROM inventory_ledger l
        WHERE l.product_id = v_item.product_id AND l.reference_type = 'sale'
          AND l.reference_id = p_sale_id AND l.quantity < 0
        ORDER BY l.id ASC
      LOOP
        IF v_remaining <= 0 THEN EXIT; END IF;
        v_back := LEAST(COALESCE(v_ld.debited, 0), v_remaining);
        IF v_back <= 0 OR v_ld.warehouse_id IS NULL THEN CONTINUE; END IF;
        v_res := public._product_inv_add(v_item.product_id, v_ld.warehouse_id, v_sale.branch_id, v_back,
          COALESCE(v_ld.unit_cost, v_last_cost),
          'R-' || COALESCE(v_ld.batch_number, 'RETURN'), NULL, NULL,
          'refund', 'refund', p_sale_id, NULL, auth.uid());
        IF NOT (v_res->>'success')::boolean THEN
          RETURN v_res;
        END IF;
        v_remaining := v_remaining - v_back;
      END LOOP;

      IF v_remaining > 0 AND v_fallback_wh IS NOT NULL THEN
        v_res := public._product_inv_add(v_item.product_id, v_fallback_wh, v_sale.branch_id, v_remaining,
          v_last_cost, 'R-RETURN', NULL, NULL, 'refund', 'refund', p_sale_id, NULL, auth.uid());
        IF NOT (v_res->>'success')::boolean THEN
          RETURN v_res;
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
$function$;

-- =====================================================================
-- STOCK ADJUSTMENTS (rewritten with ledger) + new adjust_raw_stock
-- =====================================================================
CREATE OR REPLACE FUNCTION public.adjust_stock(p_inventory_id uuid, p_new_quantity numeric, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inv record;
  v_user_branch uuid;
  v_delta numeric(14,4);
  v_res jsonb;
BEGIN
  BEGIN
    -- Only admins, branch managers and warehouse managers may adjust stock
    IF NOT is_pos_admin() AND get_user_role() NOT IN ('warehouse_manager','branch_manager') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
        'detail', 'Stock adjustments require the warehouse manager or branch manager role.');
    END IF;

    SELECT i.id, i.product_id, i.warehouse_id, i.quantity, i.branch_id, p.cost_price AS cost
    INTO v_inv
    FROM inventory i
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

    IF v_delta > 0 THEN
      v_res := public._product_inv_add(v_inv.product_id, v_inv.warehouse_id, v_inv.branch_id, v_delta,
        COALESCE(v_inv.cost, 0), 'ADJ', NULL, NULL,
        'adjustment', 'adjustment', NULL, p_reason, auth.uid());
    ELSE
      v_res := public._product_inv_remove_fifo(v_inv.product_id, v_inv.warehouse_id, v_inv.branch_id, -v_delta,
        'adjustment', 'adjustment', NULL, p_reason, auth.uid());
    END IF;

    IF NOT (v_res->>'success')::boolean THEN
      RETURN v_res;
    END IF;

    RETURN jsonb_build_object('success', true, 'inventory_id', p_inventory_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.adjust_raw_stock(p_raw_material_id uuid, p_branch_id uuid, p_new_quantity numeric, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cur numeric(14,4);
  v_delta numeric(14,4);
  v_user_branch uuid;
  v_res jsonb;
  v_cost numeric(12,2);
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND get_user_role() NOT IN ('warehouse_manager','branch_manager') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
        'detail', 'Raw material adjustments require the warehouse manager or branch manager role.');
    END IF;

    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND p_branch_id <> v_user_branch THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    SELECT COALESCE(quantity, 0), COALESCE(avg_cost, 0)
    INTO v_cur, v_cost
    FROM public.raw_material_inventory
    WHERE raw_material_id = p_raw_material_id AND branch_id = p_branch_id;
    IF v_cur IS NULL THEN v_cur := 0; END IF;

    v_delta := p_new_quantity - v_cur;
    IF v_delta = 0 THEN
      RETURN jsonb_build_object('success', true, 'raw_material_id', p_raw_material_id, 'no_change', true);
    END IF;

    IF v_delta > 0 THEN
      v_res := public._raw_add(p_raw_material_id, p_branch_id, v_delta, v_cost,
        'ADJ', NULL, NULL, 'adjustment', 'adjustment', NULL, p_reason, auth.uid());
    ELSE
      v_res := public._raw_remove_fifo(p_raw_material_id, p_branch_id, -v_delta,
        'adjustment', 'adjustment', NULL, p_reason, auth.uid());
    END IF;

    IF NOT (v_res->>'success')::boolean THEN
      RETURN v_res;
    END IF;

    RETURN jsonb_build_object('success', true, 'raw_material_id', p_raw_material_id, 'quantity', p_new_quantity);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ==========================================
-- 014_manufacturing_policies.sql
-- ==========================================
-- =====================================================================
-- Phase B3: relax write policies for permission-gated roles
-- =====================================================================
-- The B1 schema locked writes on master data to is_pos_admin() only, but
-- production_manager (and other roles) hold manage permissions via the
-- `roles` table. Relax policies so those roles can manage master data
-- through the frontend, consistent with the can_permission() checks used
-- by the SECURITY DEFINER RPCs.
-- =====================================================================

DROP POLICY IF EXISTS raw_materials_write ON public.raw_materials;
CREATE POLICY raw_materials_write ON public.raw_materials
  FOR ALL TO authenticated
  USING (can_permission('raw_materials.manage'))
  WITH CHECK (can_permission('raw_materials.manage'));

DROP POLICY IF EXISTS raw_material_inventory_write ON public.raw_material_inventory;
CREATE POLICY raw_material_inventory_write ON public.raw_material_inventory
  FOR ALL TO authenticated
  USING (is_pos_admin() OR (can_permission('raw_materials.manage') AND branch_id = get_branch_id()))
  WITH CHECK (is_pos_admin() OR (can_permission('raw_materials.manage') AND branch_id = get_branch_id()));

DROP POLICY IF EXISTS raw_material_batches_write ON public.raw_material_batches;
CREATE POLICY raw_material_batches_write ON public.raw_material_batches
  FOR ALL TO authenticated
  USING (is_pos_admin() OR (can_permission('raw_materials.manage') AND branch_id = get_branch_id()))
  WITH CHECK (is_pos_admin() OR (can_permission('raw_materials.manage') AND branch_id = get_branch_id()));

DROP POLICY IF EXISTS recipes_write ON public.recipes;
CREATE POLICY recipes_write ON public.recipes
  FOR ALL TO authenticated
  USING (is_pos_admin() OR (can_permission('recipes.manage') AND branch_id = get_branch_id()))
  WITH CHECK (is_pos_admin() OR (can_permission('recipes.manage') AND branch_id = get_branch_id()));

DROP POLICY IF EXISTS recipe_items_write ON public.recipe_items;
CREATE POLICY recipe_items_write ON public.recipe_items
  FOR ALL TO authenticated
  USING (
    is_pos_admin() OR (
      can_permission('recipes.manage') AND EXISTS (
        SELECT 1 FROM public.recipes r
        WHERE r.id = recipe_items.recipe_id AND r.branch_id = get_branch_id()
      )
    )
  )
  WITH CHECK (
    is_pos_admin() OR (
      can_permission('recipes.manage') AND EXISTS (
        SELECT 1 FROM public.recipes r
        WHERE r.id = recipe_items.recipe_id AND r.branch_id = get_branch_id()
      )
    )
  );

-- ==========================================
-- 015_accounting_schema.sql
-- ==========================================
-- =====================================================================
-- Phase C1: Chart of Accounts + Journal Entries schema
-- =====================================================================
-- Adds: chart_of_accounts, journal_entries, journal_entry_lines,
--       customer_payments. Auto-seeds a standard chart of accounts per
--       branch (system accounts are locked; others editable). Journal
--       entries are immutable (audit trail) and branch-scoped.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Chart of accounts (one chart per branch, seeded automatically)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chart_of_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id     uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  code          text NOT NULL,
  name          text NOT NULL,
  name_en       text,
  account_type  text NOT NULL
                CHECK (account_type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  is_system     boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, code)
);
COMMENT ON TABLE public.chart_of_accounts IS 'شجرة الحسابات المستقلة لكل فرع (يتم تلقائياً إنشاء حسابات نظام عند إنشاء الفرع)';

CREATE INDEX IF NOT EXISTS idx_coa_branch ON public.chart_of_accounts (branch_id, account_type);

-- System account codes used by auto-posting (resolved by code within a branch).
-- These must never be deleted and their code/type must never change.
CREATE OR REPLACE FUNCTION public.protect_system_accounts()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.is_system THEN
    RAISE EXCEPTION 'SYSTEM_ACCOUNT_PROTECTED: % (%)', OLD.code, OLD.name;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_system THEN
    IF NEW.code IS DISTINCT FROM OLD.code OR NEW.account_type IS DISTINCT FROM OLD.account_type THEN
      RAISE EXCEPTION 'SYSTEM_ACCOUNT_PROTECTED: % (%)', OLD.code, OLD.name;
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    NEW.name := btrim(NEW.name);
    IF NEW.name = '' THEN
      RAISE EXCEPTION 'ACCOUNT_NAME_REQUIRED';
    END IF;
    NEW.code := upper(btrim(NEW.code));
    IF NEW.code = '' THEN
      RAISE EXCEPTION 'ACCOUNT_CODE_REQUIRED';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_system_accounts ON public.chart_of_accounts;
CREATE TRIGGER trg_protect_system_accounts
  BEFORE INSERT OR UPDATE OR DELETE ON public.chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION public.protect_system_accounts();

CREATE TRIGGER trg_coa_updated BEFORE UPDATE ON public.chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coa_select" ON public.chart_of_accounts
  FOR SELECT TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id());
CREATE POLICY "coa_insert" ON public.chart_of_accounts
  FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR (can_permission('accounts.manage') AND branch_id = get_branch_id()));
CREATE POLICY "coa_update" ON public.chart_of_accounts
  FOR UPDATE TO authenticated
  USING (is_pos_admin() OR (can_permission('accounts.manage') AND branch_id = get_branch_id()))
  WITH CHECK (is_pos_admin() OR (can_permission('accounts.manage') AND branch_id = get_branch_id()));
CREATE POLICY "coa_delete" ON public.chart_of_accounts
  FOR DELETE TO authenticated
  USING (is_pos_admin() OR (can_permission('accounts.manage') AND branch_id = get_branch_id()));

-- ---------------------------------------------------------------------
-- 2. Standard chart seed (called for every branch + on new branch insert)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_chart_of_accounts(p_branch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.chart_of_accounts (branch_id, code, name, name_en, account_type, is_system)
  SELECT p_branch_id, c.code, c.name, c.name_en, c.account_type, c.is_system
  FROM (VALUES
    ('1000','النقدية بالخزينة','Cash on Hand','asset',true),
    ('1010','البنك','Bank','asset',true),
    ('1100','العملاء (ذمم مدينة)','Accounts Receivable','asset',true),
    ('1200','المخزون (بضاعة جاهزة)','Finished Goods Inventory','asset',true),
    ('1210','مخزون المواد الخام','Raw Materials Inventory','asset',false),
    ('1500','الأصول الثابتة','Fixed Assets','asset',false),
    ('2000','الموردون (ذمم دائنة)','Accounts Payable','liability',true),
    ('2100','ضريبة القيمة المضافة المستحقة','VAT Payable','liability',true),
    ('2300','القروض','Loans','liability',false),
    ('3000','رأس المال','Capital','equity',false),
    ('3100','الأرباح المحتجزة','Retained Earnings','equity',false),
    ('4000','إيرادات المبيعات','Sales Revenue','income',true),
    ('4100','خصم مسموح به','Discount Given','income',true),
    ('4200','إيرادات أخرى','Other Income','income',false),
    ('5000','تكلفة البضاعة المباعة','Cost of Goods Sold','expense',true),
    ('5100','مصاريف تشغيلية','Operating Expenses','expense',false),
    ('5200','أجور ورواتب','Salaries & Wages','expense',false),
    ('5300','إيجار','Rent','expense',false),
    ('5400','مرافق','Utilities','expense',false),
    ('5900','مصاريف أخرى','Other Expenses','expense',false)
  ) AS c(code, name, name_en, account_type, is_system)
  ON CONFLICT (branch_id, code) DO UPDATE SET
    name = EXCLUDED.name,
    name_en = EXCLUDED.name_en,
    account_type = EXCLUDED.account_type,
    is_system = COALESCE(public.chart_of_accounts.is_system, EXCLUDED.is_system),
    updated_at = now();
END;
$function$;

-- Seed every existing branch now and every future branch automatically.
SELECT public.ensure_chart_of_accounts(id) FROM public.branches;

CREATE OR REPLACE FUNCTION public.seed_chart_for_new_branch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.ensure_chart_of_accounts(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_chart_on_branch_insert ON public.branches;
CREATE TRIGGER trg_seed_chart_on_branch_insert
  AFTER INSERT ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.seed_chart_for_new_branch();

-- ---------------------------------------------------------------------
-- 3. Journal entries (immutable audit trail)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.journal_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_number      text NOT NULL UNIQUE,
  branch_id         uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  entry_date        date NOT NULL DEFAULT CURRENT_DATE,
  reference_type    text,
  reference_id      uuid,
  reference_number  text,
  description       text,
  created_by        uuid REFERENCES public.users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.journal_entries IS 'قيود اليومية (كل قيد مدين = دائن تلقائياً)';

CREATE INDEX IF NOT EXISTS idx_journal_branch_date ON public.journal_entries (branch_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_journal_reference ON public.journal_entries (reference_type, reference_id);

ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "journal_entries_select" ON public.journal_entries
  FOR SELECT TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id());
CREATE POLICY "journal_entries_insert" ON public.journal_entries
  FOR INSERT TO authenticated WITH CHECK (is_pos_admin());
-- No UPDATE / DELETE policies: posted entries are immutable.

CREATE TABLE IF NOT EXISTS public.journal_entry_lines (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  journal_entry_id  uuid NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  account_id        uuid NOT NULL REFERENCES public.chart_of_accounts(id),
  debit             numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit            numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  customer_id       uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  supplier_id       uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((debit > 0) <> (credit > 0))
);
COMMENT ON TABLE public.journal_entry_lines IS 'أطراف قيد اليومية (مدين أو دائن لكل حساب)';

CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON public.journal_entry_lines (journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON public.journal_entry_lines (account_id, created_at);

ALTER TABLE public.journal_entry_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "journal_entry_lines_select" ON public.journal_entry_lines
  FOR SELECT TO authenticated USING (
    is_pos_admin() OR EXISTS (
      SELECT 1 FROM public.journal_entries je
      WHERE je.id = journal_entry_lines.journal_entry_id AND je.branch_id = get_branch_id()
    )
  );
CREATE POLICY "journal_entry_lines_insert" ON public.journal_entry_lines
  FOR INSERT TO authenticated WITH CHECK (is_pos_admin());
-- No UPDATE / DELETE policies.

-- ---------------------------------------------------------------------
-- 4. Customer payments (AR collections)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  branch_id         uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  amount            numeric(14,2) NOT NULL CHECK (amount > 0),
  payment_method    text NOT NULL DEFAULT 'cash',
  sale_id           uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  reference_number  text,
  notes             text,
  created_by        uuid REFERENCES public.users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.customer_payments IS 'سندات القبض (تحصيل من العملاء مقابل ذمم مدينة)';

CREATE INDEX IF NOT EXISTS idx_customer_payments_customer ON public.customer_payments (customer_id, created_at);

ALTER TABLE public.customer_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customer_payments_select" ON public.customer_payments
  FOR SELECT TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id());
CREATE POLICY "customer_payments_insert" ON public.customer_payments
  FOR INSERT TO authenticated WITH CHECK (is_pos_admin());

-- ---------------------------------------------------------------------
-- 5. Document sequence for journal entries
-- ---------------------------------------------------------------------
INSERT INTO public.document_sequences (seq_type, next_value) VALUES ('journal', 1)
ON CONFLICT (seq_type) DO NOTHING;

-- ==========================================
-- 016_accounting_rpc.sql
-- ==========================================
-- =====================================================================
-- Phase C2: Auto-posting (sales + COGS) and financial report RPCs
-- =====================================================================
-- Adds: _post_journal_entry internal helper, process_sale updated to post
--       its journal entry in the same transaction, receive_payment for AR
--       collections, and read-only report RPCs (trial balance, general
--       ledger, income statement, balance sheet, AR aging) + opening
--       balance seed.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Internal helper: post a balanced journal entry by account code
--    p_lines = [{"account_code","debit","credit","customer_id","supplier_id","note"}]
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._post_journal_entry(
  p_branch_id uuid,
  p_reference_type text,
  p_reference_id uuid,
  p_reference_number text,
  p_description text,
  p_lines jsonb
) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_entry_id uuid;
  v_entry_no text;
  v_line jsonb;
  v_account uuid;
  v_debit numeric(14,2);
  v_credit numeric(14,2);
  v_total_debit numeric(14,2) := 0;
  v_total_credit numeric(14,2) := 0;
BEGIN
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'JOURNAL_EMPTY_LINES';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_total_debit := v_total_debit + COALESCE((v_line->>'debit')::numeric, 0);
    v_total_credit := v_total_credit + COALESCE((v_line->>'credit')::numeric, 0);
  END LOOP;

  IF round(v_total_debit, 2) <> round(v_total_credit, 2) THEN
    RAISE EXCEPTION 'JOURNAL_UNBALANCED: debit % <> credit %',
      round(v_total_debit, 2), round(v_total_credit, 2);
  END IF;

  v_entry_no := (public.next_document_number('journal')->>'number')::text;

  INSERT INTO public.journal_entries
    (entry_number, branch_id, entry_date, reference_type, reference_id, reference_number, description, created_by)
  VALUES (v_entry_no, p_branch_id, CURRENT_DATE, p_reference_type, p_reference_id,
          p_reference_number, p_description, auth.uid())
  RETURNING id INTO v_entry_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_debit := COALESCE((v_line->>'debit')::numeric, 0);
    v_credit := COALESCE((v_line->>'credit')::numeric, 0);
    IF v_debit <= 0 AND v_credit <= 0 THEN CONTINUE; END IF;

    SELECT id INTO v_account
    FROM public.chart_of_accounts
    WHERE branch_id = p_branch_id AND code = btrim((v_line->>'account_code')::text);
    IF v_account IS NULL THEN
      RAISE EXCEPTION 'ACCOUNT_NOT_FOUND: %', v_line->>'account_code';
    END IF;

    INSERT INTO public.journal_entry_lines
      (journal_entry_id, account_id, debit, credit, customer_id, supplier_id, note)
    VALUES (v_entry_id, v_account, v_debit, v_credit,
            (v_line->>'customer_id')::uuid, (v_line->>'supplier_id')::uuid, v_line->>'note');
  END LOOP;

  RETURN v_entry_id;
END;
$function$;

-- ---------------------------------------------------------------------
-- 2. process_sale: rewritten to ALSO post the sales + COGS journal entry
--    (revenue / discount / VAT / cash|AR on the credit side balance,
--     COGS vs inventory on the stock side) inside the same transaction.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_sale(p_invoice_number text, p_branch_id uuid, p_warehouse_id uuid, p_customer_id uuid, p_salesperson_id uuid, p_subtotal numeric, p_discount_amount numeric, p_discount_type text, p_tax_amount numeric, p_bonus_amount numeric, p_total numeric, p_paid_amount numeric, p_payment_method text, p_status text, p_items jsonb, p_shift_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_warehouse_ids uuid[];
  v_available numeric(14,4);
  v_res jsonb;
  v_short numeric(14,4);
  v_cogs_total numeric(14,2) := 0;
  v_paid numeric(14,2);
  v_ar numeric(14,2);
  v_lines jsonb := '[]'::jsonb;
  v_dr numeric(14,2) := 0;
  v_cr numeric(14,2) := 0;
  v_diff numeric(14,2);
  v_balance_account text;
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

      IF NOT EXISTS (SELECT 1 FROM products WHERE id = v_product_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_FOUND', 'product_id', v_product_id);
      END IF;

      -- Branch ownership: the product must belong to the sale branch
      IF NOT EXISTS (
        SELECT 1 FROM products WHERE id = v_product_id AND branch_id = p_branch_id
      ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_IN_BRANCH',
          'product_id', v_product_id, 'branch_id', p_branch_id);
      END IF;

      SELECT COALESCE(SUM(quantity), 0) INTO v_available
      FROM inventory_batches
      WHERE product_id = v_product_id AND warehouse_id = ANY(v_warehouse_ids);
      IF v_available < v_quantity THEN
        RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_STOCK',
          'product_id', v_product_id, 'required', v_quantity, 'available', v_available);
      END IF;
    END LOOP;

    -- ===== WRITE PHASE 1: sale header =====
    INSERT INTO sales (invoice_number, branch_id, warehouse_id, customer_id, cashier_id, salesperson_id,
      subtotal, discount_amount, discount_type, tax_amount, bonus_amount, total, paid_amount, payment_method, status)
    VALUES (p_invoice_number, p_branch_id, p_warehouse_id, p_customer_id, auth.uid(), p_salesperson_id,
      p_subtotal, p_discount_amount, p_discount_type, p_tax_amount, p_bonus_amount,
      p_total, p_paid_amount, p_payment_method, p_status)
    RETURNING id INTO v_sale_id;

    -- ===== WRITE PHASE 2: items + FIFO stock deduction + ledger =====
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

      v_res := public._product_inv_remove_fifo(v_product_id, NULL, p_branch_id, v_quantity,
        'sale', 'sale', v_sale_id, p_invoice_number, auth.uid());
      v_short := (v_res->>'shortage')::numeric;
      IF v_short > 0 THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: product % needs % but only % available',
          v_product_id, v_quantity, (v_quantity - v_short);
      END IF;
      v_cogs_total := v_cogs_total + COALESCE((v_res->>'total_cost')::numeric, 0);
    END LOOP;

    -- ===== WRITE PHASE 3: log the sale into the active shift =====
    IF v_shift_id IS NOT NULL THEN
      INSERT INTO shift_operations (shift_id, operation_type, amount, payment_method, reference_type, reference_id, created_by)
      VALUES (v_shift_id, 'sale', COALESCE(p_paid_amount, 0), p_payment_method, 'sale', v_sale_id, auth.uid());
    END IF;

    -- ===== WRITE PHASE 4: post the sales + COGS journal entry =====
    v_paid := round(COALESCE(p_paid_amount, 0), 2);
    v_ar := round(GREATEST(COALESCE(p_total, 0) - v_paid, 0), 2);

    IF v_paid > 0 THEN
      v_balance_account := CASE WHEN COALESCE(p_payment_method, 'cash') = 'cash' THEN '1000' ELSE '1010' END;
      v_lines := v_lines || jsonb_build_object('account_code', v_balance_account,
        'debit', v_paid, 'credit', 0, 'note', p_invoice_number);
      v_dr := v_dr + v_paid;
    END IF;
    IF v_ar > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_code', '1100',
        'debit', v_ar, 'credit', 0, 'customer_id', p_customer_id, 'note', p_invoice_number);
      v_dr := v_dr + v_ar;
    END IF;
    IF COALESCE(p_discount_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_code', '4100', 'debit', p_discount_amount, 'credit', 0);
      v_dr := v_dr + p_discount_amount;
    END IF;
    IF COALESCE(p_subtotal, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_code', '4000', 'debit', 0, 'credit', p_subtotal);
      v_cr := v_cr + p_subtotal;
    END IF;
    IF COALESCE(p_tax_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_code', '2100', 'debit', 0, 'credit', p_tax_amount);
      v_cr := v_cr + p_tax_amount;
    END IF;
    IF v_cogs_total > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_code', '5000', 'debit', v_cogs_total, 'credit', 0);
      v_lines := v_lines || jsonb_build_object('account_code', '1200', 'debit', 0, 'credit', v_cogs_total);
      v_dr := v_dr + v_cogs_total;
      v_cr := v_cr + v_cogs_total;
    END IF;

    -- Balance any rounding/frontend discrepancy on the discount account so a
    -- posted entry is always balanced (normally the difference is zero).
    v_diff := round(v_dr - v_cr, 2);
    IF v_diff <> 0 THEN
      IF v_diff > 0 THEN
        v_lines := v_lines || jsonb_build_object('account_code', '4100', 'debit', 0, 'credit', v_diff);
      ELSE
        v_lines := v_lines || jsonb_build_object('account_code', '4100', 'debit', -v_diff, 'credit', 0);
      END IF;
    END IF;

    PERFORM public._post_journal_entry(p_branch_id, 'sale', v_sale_id, p_invoice_number,
      'فاتورة مبيعات ' || p_invoice_number, v_lines);

    RETURN jsonb_build_object('success', true, 'sale_id', v_sale_id, 'invoice_number', p_invoice_number,
      'cogs', v_cogs_total);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'INSUFFICIENT_STOCK%' THEN
      RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_STOCK', 'detail', SQLERRM);
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------
-- 3. Opening balance seed: current stock value -> capital (per branch)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_opening_balances(p_branch_id uuid)
RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_finished numeric(14,2);
  v_raw numeric(14,2);
  v_lines jsonb := '[]'::jsonb;
  v_total numeric(14,2) := 0;
BEGIN
  BEGIN
    IF NOT is_pos_admin() THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.journal_entries
      WHERE branch_id = p_branch_id AND reference_type = 'opening'
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'OPENING_ALREADY_EXISTS');
    END IF;

    SELECT COALESCE(SUM(b.quantity * b.unit_cost), 0) INTO v_finished
    FROM public.inventory_batches b WHERE b.branch_id = p_branch_id;

    SELECT COALESCE(SUM(b.quantity * b.unit_cost), 0) INTO v_raw
    FROM public.raw_material_batches b WHERE b.branch_id = p_branch_id;

    v_total := round(v_finished + v_raw, 2);
    IF v_total <= 0 THEN
      RETURN jsonb_build_object('success', true, 'skipped', true, 'total', 0);
    END IF;

    IF v_finished > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_code', '1200', 'debit', round(v_finished, 2), 'credit', 0, 'note', 'رصيد افتتاحي للمخزون');
    END IF;
    IF v_raw > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_code', '1210', 'debit', round(v_raw, 2), 'credit', 0, 'note', 'رصيد افتتاحي للمواد الخام');
    END IF;
    v_lines := v_lines || jsonb_build_object('account_code', '3000', 'debit', 0, 'credit', v_total, 'note', 'رصيد افتتاحي');

    PERFORM public._post_journal_entry(p_branch_id, 'opening', NULL, 'OPENING',
      'رصيد افتتاحي للمخزون', v_lines);

    RETURN jsonb_build_object('success', true, 'total', v_total, 'finished', v_finished, 'raw', v_raw);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------
-- 4. receive_payment: collect AR, optionally against a specific invoice
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.receive_payment(
  p_customer_id uuid, p_branch_id uuid, p_amount numeric,
  p_payment_method text DEFAULT 'cash', p_sale_id uuid DEFAULT NULL, p_notes text DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_payment_id uuid;
  v_number text;
  v_user_branch uuid;
  v_remaining numeric(14,2);
  v_sale record;
  v_applied numeric(14,2);
  v_open numeric(14,2);
  v_total_open numeric(14,2);
  v_payment_account text;
  v_lines jsonb := '[]'::jsonb;
BEGIN
  BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_AMOUNT');
    END IF;

    IF NOT is_pos_admin() AND get_user_role() NOT IN ('accountant', 'branch_manager', 'cashier') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;

    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND p_branch_id <> v_user_branch THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_customer_id AND branch_id = p_branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'CUSTOMER_NOT_FOUND');
    END IF;

    -- Payments must be backed by open receivable (no free-floating credits).
    SELECT COALESCE(SUM(s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0)), 0)
    INTO v_total_open
    FROM public.sales s
    WHERE s.customer_id = p_customer_id AND s.branch_id = p_branch_id AND s.status <> 'returned';

    IF p_sale_id IS NULL THEN
      IF round(p_amount, 2) > round(v_total_open, 2) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_EXCEEDS_AR',
          'open', round(v_total_open, 2), 'detail', 'The payment exceeds the customer open balance.');
      END IF;
    ELSE
      SELECT total, COALESCE(paid_amount, 0), COALESCE(refunded_amount, 0) INTO v_sale
      FROM public.sales WHERE id = p_sale_id AND customer_id = p_customer_id AND branch_id = p_branch_id
        AND status <> 'returned' FOR UPDATE;
      IF v_sale.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'SALE_NOT_FOUND',
          'detail', 'No open invoice found for this customer with that id.');
      END IF;
      IF round(p_amount, 2) > round(v_sale.total - v_sale.paid_amount - v_sale.refunded_amount, 2) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_EXCEEDS_INVOICE',
          'open', round(v_sale.total - v_sale.paid_amount - v_sale.refunded_amount, 2));
      END IF;
    END IF;

    v_number := (public.next_document_number('payment')->>'number')::text;

    INSERT INTO public.customer_payments (customer_id, branch_id, amount, payment_method, sale_id, reference_number, notes, created_by)
    VALUES (p_customer_id, p_branch_id, p_amount, p_payment_method, p_sale_id, v_number, p_notes, auth.uid())
    RETURNING id INTO v_payment_id;

    -- Apply payment against invoices (specific or oldest open first)
    v_remaining := round(p_amount, 2);

    IF p_sale_id IS NOT NULL THEN
      v_open := round(v_sale.total - v_sale.paid_amount - v_sale.refunded_amount, 2);
      v_applied := LEAST(v_remaining, v_open);
      UPDATE public.sales SET paid_amount = COALESCE(paid_amount, 0) + v_applied
      WHERE id = p_sale_id;
      v_remaining := round(v_remaining - v_applied, 2);
    ELSIF v_remaining > 0 THEN
      FOR v_sale IN
        SELECT id, total, paid_amount, refunded_amount FROM public.sales
        WHERE customer_id = p_customer_id AND branch_id = p_branch_id AND status <> 'returned'
          AND (total - COALESCE(paid_amount, 0) - COALESCE(refunded_amount, 0)) > 0
        ORDER BY created_at ASC
        FOR UPDATE
      LOOP
        IF v_remaining <= 0 THEN EXIT; END IF;
        v_open := round(v_sale.total - COALESCE(v_sale.paid_amount, 0) - COALESCE(v_sale.refunded_amount, 0), 2);
        v_applied := LEAST(v_remaining, v_open);
        UPDATE public.sales SET paid_amount = COALESCE(paid_amount, 0) + v_applied
        WHERE id = v_sale.id;
        v_remaining := round(v_remaining - v_applied, 2);
      END LOOP;
    END IF;

    -- Post the collection journal entry
    v_payment_account := CASE WHEN COALESCE(p_payment_method, 'cash') = 'cash' THEN '1000' ELSE '1010' END;
    v_lines := v_lines || jsonb_build_object('account_code', v_payment_account,
      'debit', round(p_amount, 2), 'credit', 0, 'note', v_number);
    v_lines := v_lines || jsonb_build_object('account_code', '1100',
      'debit', 0, 'credit', round(p_amount, 2), 'customer_id', p_customer_id, 'note', v_number);

    PERFORM public._post_journal_entry(p_branch_id, 'payment', v_payment_id, v_number,
      'سند قبض ' || v_number, v_lines);

    RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id, 'reference_number', v_number,
      'unapplied', v_remaining);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------
-- 5. Reports
-- ---------------------------------------------------------------------

-- Trial balance: every account with total debit, total credit, net balance
CREATE OR REPLACE FUNCTION public.get_trial_balance(p_branch_id uuid, p_to_date date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE AS $function$
SELECT COALESCE(jsonb_agg(row ORDER BY row.code), '[]'::jsonb)
FROM (
  SELECT a.code, a.name, a.name_en, a.account_type,
         COALESCE(SUM(l.debit), 0) AS debit,
         COALESCE(SUM(l.credit), 0) AS credit,
         round(COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0), 2) AS balance
  FROM public.chart_of_accounts a
  LEFT JOIN public.journal_entry_lines l ON l.account_id = a.id
  LEFT JOIN public.journal_entries j ON j.id = l.journal_entry_id
    AND j.branch_id = p_branch_id AND j.entry_date <= p_to_date
  WHERE a.branch_id = p_branch_id AND a.is_active
  GROUP BY a.code, a.name, a.name_en, a.account_type
  HAVING COALESCE(SUM(l.debit), 0) <> 0 OR COALESCE(SUM(l.credit), 0) <> 0
) row;
$function$;

-- General ledger: all lines of one account with running balance
CREATE OR REPLACE FUNCTION public.get_general_ledger(
  p_branch_id uuid, p_account_id uuid,
  p_from_date date DEFAULT NULL, p_to_date date DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE AS $function$
SELECT COALESCE(jsonb_agg(row ORDER BY row.entry_date, row.entry_number, row.line_id), '[]'::jsonb)
FROM (
  SELECT l.id AS line_id, j.entry_date, j.entry_number, j.description, j.reference_number,
         l.debit, l.credit,
         round(SUM(
           CASE WHEN a.account_type IN ('asset', 'expense') THEN l.debit - l.credit
                ELSE l.credit - l.debit END
         ) OVER (ORDER BY j.entry_date, j.entry_number, l.id), 2) AS balance
  FROM public.journal_entry_lines l
  JOIN public.journal_entries j ON j.id = l.journal_entry_id
  JOIN public.chart_of_accounts a ON a.id = l.account_id
  WHERE l.account_id = p_account_id AND j.branch_id = p_branch_id
    AND (p_from_date IS NULL OR j.entry_date >= p_from_date)
    AND (p_to_date IS NULL OR j.entry_date <= p_to_date)
) row;
$function$;

-- Income statement (single period)
CREATE OR REPLACE FUNCTION public.get_income_statement(
  p_branch_id uuid, p_from_date date, p_to_date date DEFAULT CURRENT_DATE
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE AS $function$
SELECT jsonb_build_object(
  'revenue',      round(COALESCE(SUM(CASE WHEN a.code IN ('4000','4200') THEN l.credit - l.debit ELSE 0 END), 0), 2),
  'discount',     round(COALESCE(SUM(CASE WHEN a.code = '4100' THEN l.debit - l.credit ELSE 0 END), 0), 2),
  'net_revenue',  round(COALESCE(SUM(CASE WHEN a.code IN ('4000','4200') THEN l.credit - l.debit ELSE 0 END), 0)
                  - COALESCE(SUM(CASE WHEN a.code = '4100' THEN l.debit - l.credit ELSE 0 END), 0), 2),
  'cogs',         round(COALESCE(SUM(CASE WHEN a.code = '5000' THEN l.debit - l.credit ELSE 0 END), 0), 2),
  'gross_profit', round(
                  COALESCE(SUM(CASE WHEN a.code IN ('4000','4200') THEN l.credit - l.debit ELSE 0 END), 0)
                  - COALESCE(SUM(CASE WHEN a.code = '4100' THEN l.debit - l.credit ELSE 0 END), 0)
                  - COALESCE(SUM(CASE WHEN a.code = '5000' THEN l.debit - l.credit ELSE 0 END), 0), 2),
  'expenses',     round(COALESCE(SUM(CASE WHEN a.account_type = 'expense' AND a.code <> '5000' THEN l.debit - l.credit ELSE 0 END), 0), 2),
  'net_income',   round(
                  COALESCE(SUM(CASE WHEN a.code IN ('4000','4200') THEN l.credit - l.debit ELSE 0 END), 0)
                  - COALESCE(SUM(CASE WHEN a.code = '4100' THEN l.debit - l.credit ELSE 0 END), 0)
                  - COALESCE(SUM(CASE WHEN a.code = '5000' THEN l.debit - l.credit ELSE 0 END), 0)
                  - COALESCE(SUM(CASE WHEN a.account_type = 'expense' AND a.code <> '5000' THEN l.debit - l.credit ELSE 0 END), 0), 2)
)
FROM public.journal_entry_lines l
JOIN public.journal_entries j ON j.id = l.journal_entry_id
JOIN public.chart_of_accounts a ON a.id = l.account_id
WHERE j.branch_id = p_branch_id
  AND j.entry_date >= p_from_date AND j.entry_date <= p_to_date;
$function$;

-- Balance sheet as of a date
CREATE OR REPLACE FUNCTION public.get_balance_sheet(p_branch_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE AS $function$
WITH bal AS (
  SELECT a.account_type, a.code,
         COALESCE(SUM(l.debit), 0) AS debit,
         COALESCE(SUM(l.credit), 0) AS credit
  FROM public.chart_of_accounts a
  LEFT JOIN public.journal_entry_lines l ON l.account_id = a.id
  LEFT JOIN public.journal_entries j ON j.id = l.journal_entry_id
    AND j.branch_id = p_branch_id AND j.entry_date <= p_as_of
  WHERE a.branch_id = p_branch_id AND a.is_active
  GROUP BY a.account_type, a.code
), summary AS (
  SELECT
    round(COALESCE(SUM(CASE WHEN account_type = 'asset' THEN debit - credit ELSE 0 END), 0), 2) AS assets,
    round(COALESCE(SUM(CASE WHEN account_type = 'liability' THEN credit - debit ELSE 0 END), 0), 2) AS liabilities,
    round(COALESCE(SUM(CASE WHEN code = '3000' THEN credit - debit ELSE 0 END), 0), 2) AS capital,
    round(COALESCE(SUM(CASE WHEN code = '3100' THEN credit - debit ELSE 0 END), 0), 2) AS retained,
    round(COALESCE(SUM(CASE WHEN account_type = 'income' THEN credit - debit ELSE 0 END), 0)
         - COALESCE(SUM(CASE WHEN account_type = 'expense' THEN debit - credit ELSE 0 END), 0), 2) AS net_income
  FROM bal
)
SELECT jsonb_build_object(
  'assets', assets,
  'liabilities', liabilities,
  'capital', capital,
  'retained', retained,
  'net_income', net_income,
  'equity', round(capital + retained + net_income, 2),
  'balanced', round(assets - (liabilities + capital + retained + net_income), 2) = 0
)
FROM summary;
$function$;

-- AR aging: open receivable per customer in 30-day buckets
CREATE OR REPLACE FUNCTION public.get_ar_aging(p_branch_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE AS $function$
SELECT COALESCE(jsonb_agg(row ORDER BY row.open_amount DESC), '[]'::jsonb)
FROM (
  SELECT c.id AS customer_id, c.name, c.phone,
         sum(s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0)) AS open_amount,
         round(sum(CASE WHEN (p_as_of - s.created_at::date) <= 30 THEN s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0) ELSE 0 END), 2) AS bucket_0_30,
         round(sum(CASE WHEN (p_as_of - s.created_at::date) BETWEEN 31 AND 60 THEN s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0) ELSE 0 END), 2) AS bucket_31_60,
         round(sum(CASE WHEN (p_as_of - s.created_at::date) BETWEEN 61 AND 90 THEN s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0) ELSE 0 END), 2) AS bucket_61_90,
         round(sum(CASE WHEN (p_as_of - s.created_at::date) > 90 THEN s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0) ELSE 0 END), 2) AS bucket_90_plus
  FROM public.sales s
  JOIN public.customers c ON c.id = s.customer_id
  WHERE s.branch_id = p_branch_id AND s.status <> 'returned'
    AND (s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0)) > 0
  GROUP BY c.id, c.name, c.phone
) row;
$function$;

-- ==========================================
-- 017_accounting_permissions.sql
-- ==========================================
-- Add Phase C permission keys to DB `roles` rows (source of truth for
-- DB-side can_permission() checks and the frontend RolesContext map).
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['accounts.view', 'accounts.manage', 'reports.financial']::text[] LOOP
    UPDATE public.roles
    SET permissions = permissions || to_jsonb(r)
    WHERE role IN ('branch_manager', 'accountant')
      AND NOT (permissions ? r);
  END LOOP;
END $$;

-- ==========================================
-- 018_accounting_fixes.sql
-- ==========================================
-- =====================================================================
-- Phase C fixes
-- =====================================================================
-- 1. products.updated_at: process_purchase's weighted-cost update writes
--    products.updated_at but the column never existed (latent B2 bug that
--    broke any product-line purchase). Add the column + timestamp trigger.
-- 2. receive_payment redefinition: reject payments that exceed the open
--    receivable (no free-floating AR credits).
-- =====================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_products_updated ON public.products;
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();



CREATE OR REPLACE FUNCTION public.receive_payment(
  p_customer_id uuid, p_branch_id uuid, p_amount numeric,
  p_payment_method text DEFAULT 'cash', p_sale_id uuid DEFAULT NULL, p_notes text DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_payment_id uuid;
  v_number text;
  v_user_branch uuid;
  v_remaining numeric(14,2);
  v_sale record;
  v_applied numeric(14,2);
  v_open numeric(14,2);
  v_total_open numeric(14,2);
  v_payment_account text;
  v_lines jsonb := '[]'::jsonb;
BEGIN
  BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_AMOUNT');
    END IF;

    IF NOT is_pos_admin() AND get_user_role() NOT IN ('accountant', 'branch_manager', 'cashier') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;

    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND p_branch_id <> v_user_branch THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_customer_id AND branch_id = p_branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'CUSTOMER_NOT_FOUND');
    END IF;

    -- Payments must be backed by open receivable (no free-floating credits).
    SELECT COALESCE(SUM(s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0)), 0)
    INTO v_total_open
    FROM public.sales s
    WHERE s.customer_id = p_customer_id AND s.branch_id = p_branch_id AND s.status <> 'returned';

    IF p_sale_id IS NULL THEN
      IF round(p_amount, 2) > round(v_total_open, 2) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_EXCEEDS_AR',
          'open', round(v_total_open, 2), 'detail', 'The payment exceeds the customer open balance.');
      END IF;
    ELSE
      SELECT total, COALESCE(paid_amount, 0), COALESCE(refunded_amount, 0) INTO v_sale
      FROM public.sales WHERE id = p_sale_id AND customer_id = p_customer_id AND branch_id = p_branch_id
        AND status <> 'returned' FOR UPDATE;
      IF v_sale.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'SALE_NOT_FOUND',
          'detail', 'No open invoice found for this customer with that id.');
      END IF;
      IF round(p_amount, 2) > round(v_sale.total - v_sale.paid_amount - v_sale.refunded_amount, 2) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_EXCEEDS_INVOICE',
          'open', round(v_sale.total - v_sale.paid_amount - v_sale.refunded_amount, 2));
      END IF;
    END IF;

    v_number := (public.next_document_number('payment')->>'number')::text;

    INSERT INTO public.customer_payments (customer_id, branch_id, amount, payment_method, sale_id, reference_number, notes, created_by)
    VALUES (p_customer_id, p_branch_id, p_amount, p_payment_method, p_sale_id, v_number, p_notes, auth.uid())
    RETURNING id INTO v_payment_id;

    -- Apply payment against invoices (specific or oldest open first)
    v_remaining := round(p_amount, 2);

    IF p_sale_id IS NOT NULL THEN
      v_open := round(v_sale.total - v_sale.paid_amount - v_sale.refunded_amount, 2);
      v_applied := LEAST(v_remaining, v_open);
      UPDATE public.sales SET paid_amount = COALESCE(paid_amount, 0) + v_applied
      WHERE id = p_sale_id;
      v_remaining := round(v_remaining - v_applied, 2);
    ELSIF v_remaining > 0 THEN
      FOR v_sale IN
        SELECT id, total, paid_amount, refunded_amount FROM public.sales
        WHERE customer_id = p_customer_id AND branch_id = p_branch_id AND status <> 'returned'
          AND (total - COALESCE(paid_amount, 0) - COALESCE(refunded_amount, 0)) > 0
        ORDER BY created_at ASC
        FOR UPDATE
      LOOP
        IF v_remaining <= 0 THEN EXIT; END IF;
        v_open := round(v_sale.total - COALESCE(v_sale.paid_amount, 0) - COALESCE(v_sale.refunded_amount, 0), 2);
        v_applied := LEAST(v_remaining, v_open);
        UPDATE public.sales SET paid_amount = COALESCE(paid_amount, 0) + v_applied
        WHERE id = v_sale.id;
        v_remaining := round(v_remaining - v_applied, 2);
      END LOOP;
    END IF;

    -- Post the collection journal entry
    v_payment_account := CASE WHEN COALESCE(p_payment_method, 'cash') = 'cash' THEN '1000' ELSE '1010' END;
    v_lines := v_lines || jsonb_build_object('account_code', v_payment_account,
      'debit', round(p_amount, 2), 'credit', 0, 'note', v_number);
    v_lines := v_lines || jsonb_build_object('account_code', '1100',
      'debit', 0, 'credit', round(p_amount, 2), 'customer_id', p_customer_id, 'note', v_number);

    PERFORM public._post_journal_entry(p_branch_id, 'payment', v_payment_id, v_number,
      'سند قبض ' || v_number, v_lines);

    RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id, 'reference_number', v_number,
      'unapplied', v_remaining);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------
-- 5. Reports
-- ---------------------------------------------------------------------

-- Trial balance: every account with total debit, total credit, net balance

-- ==========================================
-- 019_d1_foundation.sql
-- ==========================================
-- =====================================================================
-- Phase D1: Foundation - account_mappings + idempotent posting + keys
-- =====================================================================
-- Adds:
--   1. Extended chart seed (WIP, accumulated depreciation, input VAT,
--      purchase discount, stock variance, depreciation & bank charges).
--   2. account_mappings (semantic key -> account per branch) seeded for
--      every branch + auto-seeded on new branches.
--   3. resolve_account_key helper.
--   4. _post_journal_entry rewritten to accept account_key (with
--      account_code fallback) and to be idempotent per (type, reference).
--   5. process_sale / receive_payment / seed_opening_balances rewritten
--      to post via semantic keys instead of hard-coded codes.
--   6. Income statement + balance sheet resolved via account_mappings.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Extended standard chart seed (existing accounts unchanged)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_chart_of_accounts(p_branch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.chart_of_accounts (branch_id, code, name, name_en, account_type, is_system)
  SELECT p_branch_id, c.code, c.name, c.name_en, c.account_type, c.is_system
  FROM (VALUES
    ('1000','النقدية بالخزينة','Cash on Hand','asset',true),
    ('1010','البنك','Bank','asset',true),
    ('1100','العملاء (ذمم مدينة)','Accounts Receivable','asset',true),
    ('1200','المخزون (بضاعة جاهزة)','Finished Goods Inventory','asset',true),
    ('1210','مخزون المواد الخام','Raw Materials Inventory','asset',false),
    ('1300','مصنع تحت التشغيل','Work In Progress','asset',true),
    ('1500','الأصول الثابتة','Fixed Assets','asset',false),
    ('1520','مجمع إهلاك الأصول الثابتة','Accumulated Depreciation','asset',true),
    ('2000','الموردون (ذمم دائنة)','Accounts Payable','liability',true),
    ('2100','ضريبة القيمة المضافة المستحقة','VAT Payable','liability',true),
    ('2110','ضريبة القيمة المضافة (مشتريات)','Input VAT','liability',true),
    ('2300','القروض','Loans','liability',false),
    ('3000','رأس المال','Capital','equity',false),
    ('3100','الأرباح المحتجزة','Retained Earnings','equity',false),
    ('4000','إيرادات المبيعات','Sales Revenue','income',true),
    ('4100','خصم مسموح به','Discount Given','income',true),
    ('4110','خصم مكتسب','Purchase Discount','income',true),
    ('4200','إيرادات أخرى','Other Income','income',false),
    ('5000','تكلفة البضاعة المباعة','Cost of Goods Sold','expense',true),
    ('5100','مصاريف تشغيلية','Operating Expenses','expense',false),
    ('5200','أجور ورواتب','Salaries & Wages','expense',false),
    ('5300','إيجار','Rent','expense',false),
    ('5400','مرافق','Utilities','expense',false),
    ('5500','فروق جرد المخزون','Stock Variance','expense',true),
    ('5600','مصاريف الإهلاك','Depreciation Expense','expense',true),
    ('5700','مصاريف البنك','Bank Charges','expense',true),
    ('5900','مصاريف أخرى','Other Expenses','expense',false)
  ) AS c(code, name, name_en, account_type, is_system)
  ON CONFLICT (branch_id, code) DO UPDATE SET
    name = EXCLUDED.name,
    name_en = EXCLUDED.name_en,
    account_type = EXCLUDED.account_type,
    is_system = COALESCE(public.chart_of_accounts.is_system, EXCLUDED.is_system),
    updated_at = now();
END;
$function$;

-- Apply the extended chart to every existing branch.
SELECT public.ensure_chart_of_accounts(id) FROM public.branches;

-- ---------------------------------------------------------------------
-- 2. account_mappings: semantic key -> account per branch
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_mappings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id     uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  semantic_key  text NOT NULL,
  account_id    uuid NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, semantic_key)
);
COMMENT ON TABLE public.account_mappings IS 'الربط الدلالي للحسابات: مفتاح (نقدية، بنك، مبيعات...) إلى حساب لكل فرع';

CREATE INDEX IF NOT EXISTS idx_account_mappings_branch ON public.account_mappings (branch_id);

ALTER TABLE public.account_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "account_mappings_select" ON public.account_mappings
  FOR SELECT TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id());
CREATE POLICY "account_mappings_insert" ON public.account_mappings
  FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR (can_permission('accounts.manage') AND branch_id = get_branch_id()));
CREATE POLICY "account_mappings_update" ON public.account_mappings
  FOR UPDATE TO authenticated
  USING (is_pos_admin() OR (can_permission('accounts.manage') AND branch_id = get_branch_id()))
  WITH CHECK (is_pos_admin() OR (can_permission('accounts.manage') AND branch_id = get_branch_id()));
CREATE POLICY "account_mappings_delete" ON public.account_mappings
  FOR DELETE TO authenticated
  USING (is_pos_admin() OR (can_permission('accounts.manage') AND branch_id = get_branch_id()));

CREATE TRIGGER trg_account_mappings_updated BEFORE UPDATE ON public.account_mappings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------
-- 3. Seed mappings per branch (guarantees the chart exists first)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_account_mappings(p_branch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.ensure_chart_of_accounts(p_branch_id);

  INSERT INTO public.account_mappings (branch_id, semantic_key, account_id)
  SELECT p_branch_id, m.semantic_key, a.id
  FROM (VALUES
    ('cash','1000'),('bank','1010'),('ar','1100'),('ap','2000'),
    ('inventory_fg','1200'),('inventory_rm','1210'),('wip','1300'),
    ('fixed_assets','1500'),('accumulated_depreciation','1520'),
    ('vat_payable','2100'),('vat_receivable','2110'),
    ('capital','3000'),('retained','3100'),
    ('revenue','4000'),('discount_given','4100'),('discount_received','4110'),
    ('other_income','4200'),
    ('cogs','5000'),('expense_default','5100'),('expense_operating','5100'),
    ('stock_variance','5500'),('depreciation_expense','5600'),('bank_charges','5700')
  ) AS m(semantic_key, code)
  JOIN public.chart_of_accounts a ON a.branch_id = p_branch_id AND a.code = m.code
  ON CONFLICT (branch_id, semantic_key) DO UPDATE SET
    account_id = EXCLUDED.account_id,
    updated_at = now();
END;
$function$;

SELECT public.seed_account_mappings(id) FROM public.branches;

-- Auto-seed mappings for future branches (chart trigger fires first by name).
CREATE OR REPLACE FUNCTION public.seed_mappings_for_new_branch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.seed_account_mappings(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_mappings_on_branch_insert ON public.branches;
CREATE TRIGGER trg_seed_mappings_on_branch_insert
  AFTER INSERT ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.seed_mappings_for_new_branch();

-- ---------------------------------------------------------------------
-- 4. resolve_account_key: key first, code fallback
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_account_key(
  p_branch_id uuid, p_key text, p_fallback_code text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_account uuid;
BEGIN
  IF p_key IS NOT NULL THEN
    SELECT account_id INTO v_account
    FROM public.account_mappings
    WHERE branch_id = p_branch_id AND semantic_key = btrim(p_key);
    IF v_account IS NOT NULL THEN
      RETURN v_account;
    END IF;
  END IF;

  IF p_fallback_code IS NOT NULL THEN
    SELECT id INTO v_account
    FROM public.chart_of_accounts
    WHERE branch_id = p_branch_id AND code = upper(btrim(p_fallback_code));
    IF v_account IS NOT NULL THEN
      RETURN v_account;
    END IF;
  END IF;

  RETURN NULL;
END;
$function$;

-- ---------------------------------------------------------------------
-- 5. _post_journal_entry: account_key support + idempotency guard
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._post_journal_entry(
  p_branch_id uuid,
  p_reference_type text,
  p_reference_id uuid,
  p_reference_number text,
  p_description text,
  p_lines jsonb
) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_entry_id uuid;
  v_entry_no text;
  v_line jsonb;
  v_account uuid;
  v_debit numeric(14,2);
  v_credit numeric(14,2);
  v_total_debit numeric(14,2) := 0;
  v_total_credit numeric(14,2) := 0;
BEGIN
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'JOURNAL_EMPTY_LINES';
  END IF;

  -- Idempotency: never post a second entry for the same reference.
  IF p_reference_id IS NOT NULL THEN
    SELECT id INTO v_entry_id
    FROM public.journal_entries
    WHERE reference_type = p_reference_type AND reference_id = p_reference_id;
    IF v_entry_id IS NOT NULL THEN
      RETURN v_entry_id;
    END IF;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_total_debit := v_total_debit + COALESCE((v_line->>'debit')::numeric, 0);
    v_total_credit := v_total_credit + COALESCE((v_line->>'credit')::numeric, 0);
  END LOOP;

  IF round(v_total_debit, 2) <> round(v_total_credit, 2) THEN
    RAISE EXCEPTION 'JOURNAL_UNBALANCED: debit % <> credit %',
      round(v_total_debit, 2), round(v_total_credit, 2);
  END IF;

  v_entry_no := (public.next_document_number('journal')->>'number')::text;

  INSERT INTO public.journal_entries
    (entry_number, branch_id, entry_date, reference_type, reference_id, reference_number, description, created_by)
  VALUES (v_entry_no, p_branch_id, CURRENT_DATE, p_reference_type, p_reference_id,
          p_reference_number, p_description, auth.uid())
  RETURNING id INTO v_entry_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_debit := COALESCE((v_line->>'debit')::numeric, 0);
    v_credit := COALESCE((v_line->>'credit')::numeric, 0);
    IF v_debit <= 0 AND v_credit <= 0 THEN CONTINUE; END IF;

    IF v_line ? 'account_key' THEN
      v_account := public.resolve_account_key(p_branch_id, v_line->>'account_key', v_line->>'account_code');
    ELSE
      SELECT id INTO v_account
      FROM public.chart_of_accounts
      WHERE branch_id = p_branch_id AND code = upper(btrim((v_line->>'account_code')::text));
    END IF;
    IF v_account IS NULL THEN
      RAISE EXCEPTION 'ACCOUNT_NOT_FOUND: %', COALESCE(v_line->>'account_key', v_line->>'account_code');
    END IF;

    INSERT INTO public.journal_entry_lines
      (journal_entry_id, account_id, debit, credit, customer_id, supplier_id, note)
    VALUES (v_entry_id, v_account, v_debit, v_credit,
            (v_line->>'customer_id')::uuid, (v_line->>'supplier_id')::uuid, v_line->>'note');
  END LOOP;

  RETURN v_entry_id;
END;
$function$;

-- One journal entry per (reference_type, reference_id).
CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_reference
  ON public.journal_entries (reference_type, reference_id)
  WHERE reference_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 6. process_sale: post via semantic keys
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_sale(p_invoice_number text, p_branch_id uuid, p_warehouse_id uuid, p_customer_id uuid, p_salesperson_id uuid, p_subtotal numeric, p_discount_amount numeric, p_discount_type text, p_tax_amount numeric, p_bonus_amount numeric, p_total numeric, p_paid_amount numeric, p_payment_method text, p_status text, p_items jsonb, p_shift_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_warehouse_ids uuid[];
  v_available numeric(14,4);
  v_res jsonb;
  v_short numeric(14,4);
  v_cogs_total numeric(14,2) := 0;
  v_paid numeric(14,2);
  v_ar numeric(14,2);
  v_lines jsonb := '[]'::jsonb;
  v_dr numeric(14,2) := 0;
  v_cr numeric(14,2) := 0;
  v_diff numeric(14,2);
  v_balance_account text;
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

      IF NOT EXISTS (SELECT 1 FROM products WHERE id = v_product_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_FOUND', 'product_id', v_product_id);
      END IF;

      -- Branch ownership: the product must belong to the sale branch
      IF NOT EXISTS (
        SELECT 1 FROM products WHERE id = v_product_id AND branch_id = p_branch_id
      ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_IN_BRANCH',
          'product_id', v_product_id, 'branch_id', p_branch_id);
      END IF;

      SELECT COALESCE(SUM(quantity), 0) INTO v_available
      FROM inventory_batches
      WHERE product_id = v_product_id AND warehouse_id = ANY(v_warehouse_ids);
      IF v_available < v_quantity THEN
        RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_STOCK',
          'product_id', v_product_id, 'required', v_quantity, 'available', v_available);
      END IF;
    END LOOP;

    -- ===== WRITE PHASE 1: sale header =====
    INSERT INTO sales (invoice_number, branch_id, warehouse_id, customer_id, cashier_id, salesperson_id,
      subtotal, discount_amount, discount_type, tax_amount, bonus_amount, total, paid_amount, payment_method, status)
    VALUES (p_invoice_number, p_branch_id, p_warehouse_id, p_customer_id, auth.uid(), p_salesperson_id,
      p_subtotal, p_discount_amount, p_discount_type, p_tax_amount, p_bonus_amount,
      p_total, p_paid_amount, p_payment_method, p_status)
    RETURNING id INTO v_sale_id;

    -- ===== WRITE PHASE 2: items + FIFO stock deduction + ledger =====
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

      v_res := public._product_inv_remove_fifo(v_product_id, NULL, p_branch_id, v_quantity,
        'sale', 'sale', v_sale_id, p_invoice_number, auth.uid());
      v_short := (v_res->>'shortage')::numeric;
      IF v_short > 0 THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: product % needs % but only % available',
          v_product_id, v_quantity, (v_quantity - v_short);
      END IF;
      v_cogs_total := v_cogs_total + COALESCE((v_res->>'total_cost')::numeric, 0);
    END LOOP;

    -- ===== WRITE PHASE 3: log the sale into the active shift =====
    IF v_shift_id IS NOT NULL THEN
      INSERT INTO shift_operations (shift_id, operation_type, amount, payment_method, reference_type, reference_id, created_by)
      VALUES (v_shift_id, 'sale', COALESCE(p_paid_amount, 0), p_payment_method, 'sale', v_sale_id, auth.uid());
    END IF;

    -- ===== WRITE PHASE 4: post the sales + COGS journal entry =====
    v_paid := round(COALESCE(p_paid_amount, 0), 2);
    v_ar := round(GREATEST(COALESCE(p_total, 0) - v_paid, 0), 2);

    IF v_paid > 0 THEN
      v_balance_account := CASE WHEN COALESCE(p_payment_method, 'cash') = 'cash' THEN 'cash' ELSE 'bank' END;
      v_lines := v_lines || jsonb_build_object('account_key', v_balance_account,
        'debit', v_paid, 'credit', 0, 'note', p_invoice_number);
      v_dr := v_dr + v_paid;
    END IF;
    IF v_ar > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'ar',
        'debit', v_ar, 'credit', 0, 'customer_id', p_customer_id, 'note', p_invoice_number);
      v_dr := v_dr + v_ar;
    END IF;
    IF COALESCE(p_discount_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'discount_given', 'debit', p_discount_amount, 'credit', 0);
      v_dr := v_dr + p_discount_amount;
    END IF;
    IF COALESCE(p_subtotal, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'revenue', 'debit', 0, 'credit', p_subtotal);
      v_cr := v_cr + p_subtotal;
    END IF;
    IF COALESCE(p_tax_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'vat_payable', 'debit', 0, 'credit', p_tax_amount);
      v_cr := v_cr + p_tax_amount;
    END IF;
    IF v_cogs_total > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'cogs', 'debit', v_cogs_total, 'credit', 0);
      v_lines := v_lines || jsonb_build_object('account_key', 'inventory_fg', 'debit', 0, 'credit', v_cogs_total);
      v_dr := v_dr + v_cogs_total;
      v_cr := v_cr + v_cogs_total;
    END IF;

    -- Balance any rounding/frontend discrepancy on the discount account so a
    -- posted entry is always balanced (normally the difference is zero).
    v_diff := round(v_dr - v_cr, 2);
    IF v_diff <> 0 THEN
      IF v_diff > 0 THEN
        v_lines := v_lines || jsonb_build_object('account_key', 'discount_given', 'debit', 0, 'credit', v_diff);
      ELSE
        v_lines := v_lines || jsonb_build_object('account_key', 'discount_given', 'debit', -v_diff, 'credit', 0);
      END IF;
    END IF;

    PERFORM public._post_journal_entry(p_branch_id, 'sale', v_sale_id, p_invoice_number,
      'فاتورة مبيعات ' || p_invoice_number, v_lines);

    RETURN jsonb_build_object('success', true, 'sale_id', v_sale_id, 'invoice_number', p_invoice_number,
      'cogs', v_cogs_total);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'INSUFFICIENT_STOCK%' THEN
      RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_STOCK', 'detail', SQLERRM);
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------
-- 7. seed_opening_balances: post via semantic keys
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_opening_balances(p_branch_id uuid)
RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_finished numeric(14,2);
  v_raw numeric(14,2);
  v_lines jsonb := '[]'::jsonb;
  v_total numeric(14,2) := 0;
BEGIN
  BEGIN
    IF NOT is_pos_admin() THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.journal_entries
      WHERE branch_id = p_branch_id AND reference_type = 'opening'
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'OPENING_ALREADY_EXISTS');
    END IF;

    SELECT COALESCE(SUM(b.quantity * b.unit_cost), 0) INTO v_finished
    FROM public.inventory_batches b WHERE b.branch_id = p_branch_id;

    SELECT COALESCE(SUM(b.quantity * b.unit_cost), 0) INTO v_raw
    FROM public.raw_material_batches b WHERE b.branch_id = p_branch_id;

    v_total := round(v_finished + v_raw, 2);
    IF v_total <= 0 THEN
      RETURN jsonb_build_object('success', true, 'skipped', true, 'total', 0);
    END IF;

    IF v_finished > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'inventory_fg', 'debit', round(v_finished, 2), 'credit', 0, 'note', 'رصيد افتتاحي للمخزون');
    END IF;
    IF v_raw > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'inventory_rm', 'debit', round(v_raw, 2), 'credit', 0, 'note', 'رصيد افتتاحي للمواد الخام');
    END IF;
    v_lines := v_lines || jsonb_build_object('account_key', 'capital', 'debit', 0, 'credit', v_total, 'note', 'رصيد افتتاحي');

    PERFORM public._post_journal_entry(p_branch_id, 'opening', NULL, 'OPENING',
      'رصيد افتتاحي للمخزون', v_lines);

    RETURN jsonb_build_object('success', true, 'total', v_total, 'finished', v_finished, 'raw', v_raw);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------
-- 8. receive_payment: post via semantic keys
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.receive_payment(
  p_customer_id uuid, p_branch_id uuid, p_amount numeric,
  p_payment_method text DEFAULT 'cash', p_sale_id uuid DEFAULT NULL, p_notes text DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_payment_id uuid;
  v_number text;
  v_user_branch uuid;
  v_remaining numeric(14,2);
  v_sale record;
  v_applied numeric(14,2);
  v_open numeric(14,2);
  v_total_open numeric(14,2);
  v_payment_account text;
  v_lines jsonb := '[]'::jsonb;
BEGIN
  BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_AMOUNT');
    END IF;

    IF NOT is_pos_admin() AND get_user_role() NOT IN ('accountant', 'branch_manager', 'cashier') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;

    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND p_branch_id <> v_user_branch THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_customer_id AND branch_id = p_branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'CUSTOMER_NOT_FOUND');
    END IF;

    -- Payments must be backed by open receivable (no free-floating credits).
    SELECT COALESCE(SUM(s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0)), 0)
    INTO v_total_open
    FROM public.sales s
    WHERE s.customer_id = p_customer_id AND s.branch_id = p_branch_id AND s.status <> 'returned';

    IF p_sale_id IS NULL THEN
      IF round(p_amount, 2) > round(v_total_open, 2) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_EXCEEDS_AR',
          'open', round(v_total_open, 2), 'detail', 'The payment exceeds the customer open balance.');
      END IF;
    ELSE
      SELECT total, COALESCE(paid_amount, 0), COALESCE(refunded_amount, 0) INTO v_sale
      FROM public.sales WHERE id = p_sale_id AND customer_id = p_customer_id AND branch_id = p_branch_id
        AND status <> 'returned' FOR UPDATE;
      IF v_sale.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'SALE_NOT_FOUND',
          'detail', 'No open invoice found for this customer with that id.');
      END IF;
      IF round(p_amount, 2) > round(v_sale.total - v_sale.paid_amount - v_sale.refunded_amount, 2) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_EXCEEDS_INVOICE',
          'open', round(v_sale.total - v_sale.paid_amount - v_sale.refunded_amount, 2));
      END IF;
    END IF;

    v_number := (public.next_document_number('payment')->>'number')::text;

    INSERT INTO public.customer_payments (customer_id, branch_id, amount, payment_method, sale_id, reference_number, notes, created_by)
    VALUES (p_customer_id, p_branch_id, p_amount, p_payment_method, p_sale_id, v_number, p_notes, auth.uid())
    RETURNING id INTO v_payment_id;

    -- Apply payment against invoices (specific or oldest open first)
    v_remaining := round(p_amount, 2);

    IF p_sale_id IS NOT NULL THEN
      v_open := round(v_sale.total - v_sale.paid_amount - v_sale.refunded_amount, 2);
      v_applied := LEAST(v_remaining, v_open);
      UPDATE public.sales SET paid_amount = COALESCE(paid_amount, 0) + v_applied
      WHERE id = p_sale_id;
      v_remaining := round(v_remaining - v_applied, 2);
    ELSIF v_remaining > 0 THEN
      FOR v_sale IN
        SELECT id, total, paid_amount, refunded_amount FROM public.sales
        WHERE customer_id = p_customer_id AND branch_id = p_branch_id AND status <> 'returned'
          AND (total - COALESCE(paid_amount, 0) - COALESCE(refunded_amount, 0)) > 0
        ORDER BY created_at ASC
        FOR UPDATE
      LOOP
        IF v_remaining <= 0 THEN EXIT; END IF;
        v_open := round(v_sale.total - COALESCE(v_sale.paid_amount, 0) - COALESCE(v_sale.refunded_amount, 0), 2);
        v_applied := LEAST(v_remaining, v_open);
        UPDATE public.sales SET paid_amount = COALESCE(paid_amount, 0) + v_applied
        WHERE id = v_sale.id;
        v_remaining := round(v_remaining - v_applied, 2);
      END LOOP;
    END IF;

    -- Post the collection journal entry
    v_payment_account := CASE WHEN COALESCE(p_payment_method, 'cash') = 'cash' THEN 'cash' ELSE 'bank' END;
    v_lines := v_lines || jsonb_build_object('account_key', v_payment_account,
      'debit', round(p_amount, 2), 'credit', 0, 'note', v_number);
    v_lines := v_lines || jsonb_build_object('account_key', 'ar',
      'debit', 0, 'credit', round(p_amount, 2), 'customer_id', p_customer_id, 'note', v_number);

    PERFORM public._post_journal_entry(p_branch_id, 'payment', v_payment_id, v_number,
      'سند قبض ' || v_number, v_lines);

    RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id, 'reference_number', v_number,
      'unapplied', v_remaining);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------
-- 9. Income statement + balance sheet resolved via account_mappings
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_income_statement(
  p_branch_id uuid, p_from_date date, p_to_date date DEFAULT CURRENT_DATE
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE AS $function$
WITH cfg AS (
  SELECT
    (SELECT account_id FROM public.account_mappings WHERE branch_id = p_branch_id AND semantic_key = 'revenue')        AS revenue_id,
    (SELECT account_id FROM public.account_mappings WHERE branch_id = p_branch_id AND semantic_key = 'other_income')   AS other_income_id,
    (SELECT account_id FROM public.account_mappings WHERE branch_id = p_branch_id AND semantic_key = 'discount_given') AS discount_id,
    (SELECT account_id FROM public.account_mappings WHERE branch_id = p_branch_id AND semantic_key = 'cogs')           AS cogs_id
), agg AS (
  SELECT a.account_type, a.id AS account_id,
         COALESCE(SUM(l.debit), 0) AS debit,
         COALESCE(SUM(l.credit), 0) AS credit
  FROM public.journal_entry_lines l
  JOIN public.journal_entries j ON j.id = l.journal_entry_id
  JOIN public.chart_of_accounts a ON a.id = l.account_id
  WHERE j.branch_id = p_branch_id
    AND j.entry_date >= p_from_date AND j.entry_date <= p_to_date
  GROUP BY a.account_type, a.id
)
SELECT jsonb_build_object(
  'revenue',      round(COALESCE((SELECT SUM(credit - debit) FROM agg, cfg WHERE account_id IN (cfg.revenue_id, cfg.other_income_id)), 0), 2),
  'discount',     round(COALESCE((SELECT SUM(debit - credit) FROM agg, cfg WHERE account_id = cfg.discount_id), 0), 2),
  'net_revenue',  round(
                    COALESCE((SELECT SUM(credit - debit) FROM agg, cfg WHERE account_id IN (cfg.revenue_id, cfg.other_income_id)), 0)
                    - COALESCE((SELECT SUM(debit - credit) FROM agg, cfg WHERE account_id = cfg.discount_id), 0), 2),
  'cogs',         round(COALESCE((SELECT SUM(debit - credit) FROM agg, cfg WHERE account_id = cfg.cogs_id), 0), 2),
  'gross_profit', round(
                    COALESCE((SELECT SUM(credit - debit) FROM agg, cfg WHERE account_id IN (cfg.revenue_id, cfg.other_income_id)), 0)
                    - COALESCE((SELECT SUM(debit - credit) FROM agg, cfg WHERE account_id = cfg.discount_id), 0)
                    - COALESCE((SELECT SUM(debit - credit) FROM agg, cfg WHERE account_id = cfg.cogs_id), 0), 2),
  'expenses',     round(COALESCE((SELECT SUM(debit - credit) FROM agg, cfg WHERE account_type = 'expense' AND account_id <> COALESCE(cfg.cogs_id, '00000000-0000-0000-0000-000000000000')), 0), 2),
  'net_income',   round(
                    COALESCE((SELECT SUM(credit - debit) FROM agg, cfg WHERE account_id IN (cfg.revenue_id, cfg.other_income_id)), 0)
                    - COALESCE((SELECT SUM(debit - credit) FROM agg, cfg WHERE account_id = cfg.discount_id), 0)
                    - COALESCE((SELECT SUM(debit - credit) FROM agg, cfg WHERE account_id = cfg.cogs_id), 0)
                    - COALESCE((SELECT SUM(debit - credit) FROM agg, cfg WHERE account_type = 'expense' AND account_id <> COALESCE(cfg.cogs_id, '00000000-0000-0000-0000-000000000000')), 0), 2)
)
FROM cfg;
$function$;

CREATE OR REPLACE FUNCTION public.get_balance_sheet(p_branch_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE AS $function$
WITH cfg AS (
  SELECT
    (SELECT account_id FROM public.account_mappings WHERE branch_id = p_branch_id AND semantic_key = 'capital')  AS capital_id,
    (SELECT account_id FROM public.account_mappings WHERE branch_id = p_branch_id AND semantic_key = 'retained') AS retained_id
), bal AS (
  SELECT a.account_type, a.id AS account_id,
         COALESCE(SUM(l.debit), 0) AS debit,
         COALESCE(SUM(l.credit), 0) AS credit
  FROM public.chart_of_accounts a
  LEFT JOIN public.journal_entry_lines l ON l.account_id = a.id
  LEFT JOIN public.journal_entries j ON j.id = l.journal_entry_id
    AND j.branch_id = p_branch_id AND j.entry_date <= p_as_of
  WHERE a.branch_id = p_branch_id AND a.is_active
  GROUP BY a.account_type, a.id
), summary AS (
  SELECT
    round(COALESCE((SELECT SUM(debit - credit) FROM bal, cfg WHERE account_type = 'asset'), 0), 2) AS assets,
    round(COALESCE((SELECT SUM(credit - debit) FROM bal, cfg WHERE account_type = 'liability'), 0), 2) AS liabilities,
    round(COALESCE((SELECT SUM(credit - debit) FROM bal, cfg WHERE account_id = cfg.capital_id), 0), 2) AS capital,
    round(COALESCE((SELECT SUM(credit - debit) FROM bal, cfg WHERE account_id = cfg.retained_id), 0), 2) AS retained,
    round(COALESCE((SELECT SUM(credit - debit) FROM bal, cfg WHERE account_type = 'income'), 0)
         - COALESCE((SELECT SUM(debit - credit) FROM bal, cfg WHERE account_type = 'expense'), 0), 2) AS net_income
  FROM cfg
)
SELECT jsonb_build_object(
  'assets', assets,
  'liabilities', liabilities,
  'capital', capital,
  'retained', retained,
  'net_income', net_income,
  'equity', round(capital + retained + net_income, 2),
  'balanced', round(assets - (liabilities + capital + retained + net_income), 2) = 0
)
FROM summary;
$function$;

-- ---------------------------------------------------------------------
-- Reload the PostgREST schema cache.
-- ---------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- ==========================================
-- 020_d2_rpc.sql
-- ==========================================
-- =====================================================================
-- Phase D2: Complete the ledger - post purchases, refunds, expenses,
--           production (WIP) and stock variances
-- =====================================================================
-- Rewrites the live RPCs (keeping their stock logic verbatim) and adds
-- journal posting via semantic keys:
--   1. process_purchase      -> inventory_fg/inventory_rm + input VAT +
--                               discount received + cash/bank + AP
--   2. process_refund        -> prorated reversal of the sale entry
--   3. process_expense (new) -> expense account + input VAT + cash/bank
--   4. complete_production_order -> WIP consumption + finished goods
--   5. adjust_stock / adjust_raw_stock -> inventory vs stock variance
-- All posting is skipped for non-completed documents and idempotent per
-- reference; expenses/postings never weaken existing RLS.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. expenses: account linkage + tax columns (kept nullable so existing
--    pages/rows keep working; posting happens through process_expense)
-- ---------------------------------------------------------------------
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.chart_of_accounts(id),
  ADD COLUMN IF NOT EXISTS tax_amount numeric(14,2) NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------
-- 1. process_purchase: keep stock logic, add full posting
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_purchase(p_invoice_number text, p_supplier_id uuid, p_branch_id uuid, p_warehouse_id uuid, p_subtotal numeric, p_discount_amount numeric, p_tax_amount numeric, p_total numeric, p_paid_amount numeric, p_payment_method text, p_status text, p_notes text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_purchase_id uuid;
  v_user_branch uuid;
  v_item jsonb;
  v_product_id uuid;
  v_raw_id uuid;
  v_quantity numeric(14,4);
  v_unit_cost numeric(12,2);
  v_res jsonb;
  v_unit_name text;
  v_stock numeric(14,4);
  v_stock_val numeric(14,2);
  v_new_cost numeric(12,2);
  v_goods_fg numeric(14,2) := 0;
  v_goods_rm numeric(14,2) := 0;
  v_paid numeric(14,2);
  v_ap numeric(14,2);
  v_lines jsonb := '[]'::jsonb;
  v_dr numeric(14,2) := 0;
  v_cr numeric(14,2) := 0;
  v_diff numeric(14,2);
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

    -- Validate items before writing
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_raw_id := (v_item->>'raw_material_id')::uuid;
      v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
      IF (v_product_id IS NULL) = (v_raw_id IS NULL) THEN
        RETURN jsonb_build_object('success', false, 'error', 'ITEM_MISSING_TYPE');
      END IF;
      IF v_quantity <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUANTITY');
      END IF;
      IF v_product_id IS NOT NULL AND p_warehouse_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'WAREHOUSE_REQUIRED',
          'detail', 'Select a warehouse to receive product items.');
      END IF;
    END LOOP;

    INSERT INTO purchases (invoice_number, supplier_id, branch_id, warehouse_id, buyer_id,
      subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status, notes)
    VALUES (p_invoice_number, p_supplier_id, p_branch_id, p_warehouse_id, auth.uid(),
      p_subtotal, p_discount_amount, p_tax_amount, p_total, p_paid_amount, p_payment_method, p_status, p_notes)
    RETURNING id INTO v_purchase_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_raw_id := (v_item->>'raw_material_id')::uuid;
      v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
      v_unit_cost := COALESCE((v_item->>'unit_cost')::numeric, 0);

      IF v_product_id IS NOT NULL THEN
        INSERT INTO purchase_items (purchase_id, product_id, unit_name, quantity, unit_cost, total)
        VALUES (v_purchase_id, v_product_id, COALESCE(v_item->>'unit_name', 'piece'),
          v_quantity, v_unit_cost, v_quantity * v_unit_cost);

        v_res := public._product_inv_add(v_product_id, p_warehouse_id, p_branch_id, v_quantity,
          v_unit_cost, v_item->>'batch_number',
          (v_item->>'production_date')::date, (v_item->>'expiry_date')::date,
          'purchase', 'purchase', v_purchase_id, p_invoice_number, auth.uid());
        IF NOT (v_res->>'success')::boolean THEN
          RETURN v_res;
        END IF;

        -- Weighted-average cost on the product master
        SELECT COALESCE(SUM(b.quantity), 0), COALESCE(SUM(b.quantity * b.unit_cost), 0)
        INTO v_stock, v_stock_val
        FROM public.inventory_batches b WHERE b.product_id = v_product_id;
        v_new_cost := CASE WHEN v_stock > 0 THEN round(v_stock_val / v_stock, 2) ELSE v_unit_cost END;
        UPDATE public.products SET cost_price = v_new_cost, updated_at = now() WHERE id = v_product_id;

        v_goods_fg := round(v_goods_fg + v_quantity * v_unit_cost, 2);
      ELSE
        SELECT COALESCE(u.symbol, u.name, 'وحدة') INTO v_unit_name
        FROM public.raw_materials rm LEFT JOIN public.units u ON u.id = rm.unit_id
        WHERE rm.id = v_raw_id;

        INSERT INTO purchase_items (purchase_id, raw_material_id, unit_name, quantity, unit_cost, total)
        VALUES (v_purchase_id, v_raw_id, COALESCE(NULLIF(v_item->>'unit_name', ''), v_unit_name),
          v_quantity, v_unit_cost, v_quantity * v_unit_cost);

        v_res := public._raw_add(v_raw_id, p_branch_id, v_quantity, v_unit_cost,
          v_item->>'batch_number', (v_item->>'production_date')::date, (v_item->>'expiry_date')::date,
          'purchase', 'purchase', v_purchase_id, p_invoice_number, auth.uid());
        IF NOT (v_res->>'success')::boolean THEN
          RETURN v_res;
        END IF;

        v_goods_rm := round(v_goods_rm + v_quantity * v_unit_cost, 2);
      END IF;
    END LOOP;

    -- ===== LEDGER POSTING (completed purchases only) =====
    IF COALESCE(p_status, 'completed') = 'completed' THEN
      v_paid := round(COALESCE(p_paid_amount, 0), 2);
      v_ap := round(COALESCE(p_total, 0) - v_paid, 2);

      IF v_goods_fg > 0 THEN
        v_lines := v_lines || jsonb_build_object('account_key', 'inventory_fg', 'debit', v_goods_fg, 'credit', 0, 'note', p_invoice_number);
        v_dr := v_dr + v_goods_fg;
      END IF;
      IF v_goods_rm > 0 THEN
        v_lines := v_lines || jsonb_build_object('account_key', 'inventory_rm', 'debit', v_goods_rm, 'credit', 0, 'note', p_invoice_number);
        v_dr := v_dr + v_goods_rm;
      END IF;
      IF COALESCE(p_tax_amount, 0) > 0 THEN
        v_lines := v_lines || jsonb_build_object('account_key', 'vat_receivable', 'debit', p_tax_amount, 'credit', 0);
        v_dr := v_dr + p_tax_amount;
      END IF;
      IF COALESCE(p_discount_amount, 0) > 0 THEN
        v_lines := v_lines || jsonb_build_object('account_key', 'discount_received', 'debit', 0, 'credit', p_discount_amount);
        v_cr := v_cr + p_discount_amount;
      END IF;
      IF v_paid > 0 THEN
        v_lines := v_lines || jsonb_build_object('account_key', CASE WHEN COALESCE(p_payment_method, 'cash') = 'cash' THEN 'cash' ELSE 'bank' END,
          'debit', 0, 'credit', v_paid, 'note', p_invoice_number);
        v_cr := v_cr + v_paid;
      END IF;
      IF v_ap > 0 THEN
        v_lines := v_lines || jsonb_build_object('account_key', 'ap', 'debit', 0, 'credit', v_ap,
          'supplier_id', p_supplier_id, 'note', p_invoice_number);
        v_cr := v_cr + v_ap;
      END IF;

      v_diff := round(v_dr - v_cr, 2);
      IF v_diff <> 0 THEN
        IF v_diff > 0 THEN
          v_lines := v_lines || jsonb_build_object('account_key', 'discount_received', 'debit', 0, 'credit', v_diff);
        ELSE
          v_lines := v_lines || jsonb_build_object('account_key', 'discount_received', 'debit', -v_diff, 'credit', 0);
        END IF;
      END IF;

      PERFORM public._post_journal_entry(p_branch_id, 'purchase', v_purchase_id, p_invoice_number,
        'فاتورة شراء ' || p_invoice_number, v_lines);
    END IF;

    RETURN jsonb_build_object('success', true, 'purchase_id', v_purchase_id, 'invoice_number', p_invoice_number);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------
-- 2. process_refund: keep restock logic, add prorated reversal posting
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_refund(p_sale_id uuid, p_items jsonb DEFAULT NULL::jsonb, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_remaining numeric(14,4);
  v_back numeric(14,4);
  v_ld record;
  v_res jsonb;
  v_fallback_wh uuid;
  v_last_cost numeric(12,2);
  v_sale_entry uuid;
  v_revenue numeric(14,2);
  v_discount numeric(14,2);
  v_vat numeric(14,2);
  v_cogs numeric(14,2);
  v_ratio numeric(14,6);
  v_revenue_r numeric(14,2);
  v_discount_r numeric(14,2);
  v_vat_r numeric(14,2);
  v_cogs_r numeric(14,2);
  v_cash_r numeric(14,2);
  v_ar_r numeric(14,2);
  v_paid_code text;
  v_credit_key text;
  v_lines jsonb := '[]'::jsonb;
  v_dr numeric(14,2) := 0;
  v_cr numeric(14,2) := 0;
  v_diff numeric(14,2);
BEGIN
  BEGIN
    IF p_sale_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_SALE');
    END IF;

    SELECT id, branch_id, warehouse_id, status, total, paid_amount, customer_id, invoice_number
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

    SELECT id INTO v_fallback_wh FROM warehouses
      WHERE branch_id = v_sale.branch_id AND is_active = true ORDER BY created_at LIMIT 1;

    -- ===== VALIDATION PHASE =====
    IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
      FOR v_req IN SELECT * FROM jsonb_array_elements(p_items)
      LOOP
        v_item_id := (v_req->>'sale_item_id')::uuid;
        v_req_qty := COALESCE((v_req->>'quantity')::numeric, 0);
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
        v_req_qty := 0;
        SELECT (req->>'quantity')::numeric INTO v_req_qty
        FROM jsonb_array_elements(p_items) req
        WHERE (req->>'sale_item_id')::uuid = v_item.id;
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

      -- Restore stock to the warehouses the sale deducted from (FIFO restore as new batch)
      v_remaining := v_req_qty;
      SELECT COALESCE(l.unit_cost, p.cost_price, 0) INTO v_last_cost
      FROM products p LEFT JOIN inventory_ledger l
        ON l.product_id = p.id AND l.quantity < 0 AND l.reference_type = 'sale'
           AND l.reference_id = p_sale_id
      WHERE p.id = v_item.product_id
      ORDER BY l.id DESC NULLS LAST LIMIT 1;

      FOR v_ld IN
        SELECT l.warehouse_id, l.batch_number, l.unit_cost, -l.quantity AS debited
        FROM inventory_ledger l
        WHERE l.product_id = v_item.product_id AND l.reference_type = 'sale'
          AND l.reference_id = p_sale_id AND l.quantity < 0
        ORDER BY l.id ASC
      LOOP
        IF v_remaining <= 0 THEN EXIT; END IF;
        v_back := LEAST(COALESCE(v_ld.debited, 0), v_remaining);
        IF v_back <= 0 OR v_ld.warehouse_id IS NULL THEN CONTINUE; END IF;
        v_res := public._product_inv_add(v_item.product_id, v_ld.warehouse_id, v_sale.branch_id, v_back,
          COALESCE(v_ld.unit_cost, v_last_cost),
          'R-' || COALESCE(v_ld.batch_number, 'RETURN'), NULL, NULL,
          'refund', 'refund', p_sale_id, NULL, auth.uid());
        IF NOT (v_res->>'success')::boolean THEN
          RETURN v_res;
        END IF;
        v_remaining := v_remaining - v_back;
      END LOOP;

      IF v_remaining > 0 AND v_fallback_wh IS NOT NULL THEN
        v_res := public._product_inv_add(v_item.product_id, v_fallback_wh, v_sale.branch_id, v_remaining,
          v_last_cost, 'R-RETURN', NULL, NULL, 'refund', 'refund', p_sale_id, NULL, auth.uid());
        IF NOT (v_res->>'success')::boolean THEN
          RETURN v_res;
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

    -- ===== LEDGER POSTING: prorated reversal of the original sale =====
    IF v_refund_total > 0 THEN
      SELECT id INTO v_sale_entry
      FROM public.journal_entries
      WHERE branch_id = v_sale.branch_id AND reference_type = 'sale' AND reference_id = p_sale_id;

      IF v_sale_entry IS NOT NULL THEN
        SELECT
          round(COALESCE(SUM(CASE WHEN a.id IN (m.revenue_id, m.other_income_id) THEN l.credit - l.debit ELSE 0 END), 0), 2),
          round(COALESCE(SUM(CASE WHEN a.id = m.discount_id THEN l.debit - l.credit ELSE 0 END), 0), 2),
          round(COALESCE(SUM(CASE WHEN a.id = m.vat_id THEN l.credit - l.debit ELSE 0 END), 0), 2),
          round(COALESCE(SUM(CASE WHEN a.id = m.cogs_id THEN l.debit - l.credit ELSE 0 END), 0), 2)
        INTO v_revenue, v_discount, v_vat, v_cogs
        FROM public.journal_entry_lines l
        JOIN public.chart_of_accounts a ON a.id = l.account_id
        CROSS JOIN (
          SELECT
            (SELECT public.resolve_account_key(v_sale.branch_id, 'revenue')) AS revenue_id,
            (SELECT public.resolve_account_key(v_sale.branch_id, 'other_income')) AS other_income_id,
            (SELECT public.resolve_account_key(v_sale.branch_id, 'discount_given')) AS discount_id,
            (SELECT public.resolve_account_key(v_sale.branch_id, 'vat_payable')) AS vat_id,
            (SELECT public.resolve_account_key(v_sale.branch_id, 'cogs')) AS cogs_id
        ) m
        WHERE l.journal_entry_id = v_sale_entry;

        v_ratio := round(v_refund_total / GREATEST(COALESCE(v_sale.total, 0), 1), 6);
        v_revenue_r := round(v_revenue * v_ratio, 2);
        v_discount_r := round(v_discount * v_ratio, 2);
        v_vat_r := round(v_vat * v_ratio, 2);
        v_cogs_r := round(v_cogs * v_ratio, 2);

        -- Credit the account the original collection used (cash/bank/AR)
        SELECT a.code INTO v_paid_code
        FROM public.journal_entry_lines l
        JOIN public.chart_of_accounts a ON a.id = l.account_id
        WHERE l.journal_entry_id = v_sale_entry AND l.debit > 0
          AND a.code IN ('1000', '1010', '1100')
        ORDER BY CASE a.code WHEN '1000' THEN 1 WHEN '1010' THEN 2 ELSE 3 END
        LIMIT 1;

        IF v_paid_code = '1100' THEN
          v_credit_key := 'ar';
          v_ar_r := round(v_refund_total, 2);
          v_cash_r := 0;
        ELSE
          v_credit_key := CASE WHEN v_paid_code = '1010' THEN 'bank' ELSE 'cash' END;
          v_cash_r := round(LEAST(v_refund_total, COALESCE(v_sale.paid_amount, 0)), 2);
          v_ar_r := round(v_refund_total - v_cash_r, 2);
        END IF;

        IF v_revenue_r > 0 THEN
          v_lines := v_lines || jsonb_build_object('account_key', 'revenue', 'debit', v_revenue_r, 'credit', 0);
          v_dr := v_dr + v_revenue_r;
        END IF;
        IF v_discount_r > 0 THEN
          v_lines := v_lines || jsonb_build_object('account_key', 'discount_given', 'debit', 0, 'credit', v_discount_r);
          v_cr := v_cr + v_discount_r;
        END IF;
        IF v_vat_r > 0 THEN
          v_lines := v_lines || jsonb_build_object('account_key', 'vat_payable', 'debit', v_vat_r, 'credit', 0);
          v_dr := v_dr + v_vat_r;
        END IF;
        IF v_cogs_r > 0 THEN
          v_lines := v_lines || jsonb_build_object('account_key', 'inventory_fg', 'debit', v_cogs_r, 'credit', 0);
          v_lines := v_lines || jsonb_build_object('account_key', 'cogs', 'debit', 0, 'credit', v_cogs_r);
          v_dr := v_dr + v_cogs_r;
          v_cr := v_cr + v_cogs_r;
        END IF;
        IF v_cash_r > 0 THEN
          v_lines := v_lines || jsonb_build_object('account_key', v_credit_key, 'debit', 0, 'credit', v_cash_r, 'note', 'مرتجع ' || v_sale.invoice_number);
          v_cr := v_cr + v_cash_r;
        END IF;
        IF v_ar_r > 0 THEN
          v_lines := v_lines || jsonb_build_object('account_key', 'ar', 'debit', 0, 'credit', v_ar_r,
            'customer_id', v_sale.customer_id, 'note', 'مرتجع ' || v_sale.invoice_number);
          v_cr := v_cr + v_ar_r;
        END IF;

        v_diff := round(v_dr - v_cr, 2);
        IF v_diff <> 0 THEN
          IF v_diff > 0 THEN
            v_lines := v_lines || jsonb_build_object('account_key', 'discount_given', 'debit', 0, 'credit', v_diff);
          ELSE
            v_lines := v_lines || jsonb_build_object('account_key', 'discount_given', 'debit', -v_diff, 'credit', 0);
          END IF;
        END IF;

        PERFORM public._post_journal_entry(v_sale.branch_id, 'refund', NULL, v_sale.invoice_number,
          'مرتجع فاتورة ' || v_sale.invoice_number, v_lines);
      END IF;
    END IF;

    RETURN jsonb_build_object('success', true, 'sale_id', p_sale_id,
      'refunded_amount', v_refund_total, 'fully_refunded', v_all_refunded);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------
-- 3. process_expense: post an expense with optional VAT
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_expense(
  p_branch_id uuid,
  p_category text,
  p_description text,
  p_amount numeric,
  p_tax_amount numeric DEFAULT 0,
  p_payment_method text DEFAULT 'cash',
  p_account_id uuid DEFAULT NULL,
  p_expense_date date DEFAULT CURRENT_DATE,
  p_notes text DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_expense_id uuid;
  v_user_branch uuid;
  v_account uuid;
  v_total numeric(14,2);
  v_lines jsonb := '[]'::jsonb;
  v_dr numeric(14,2) := 0;
  v_cr numeric(14,2) := 0;
  v_diff numeric(14,2);
BEGIN
  BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_AMOUNT');
    END IF;

    IF NOT is_pos_admin() AND NOT can_permission('expenses.manage')
       AND get_user_role() NOT IN ('branch_manager', 'accountant') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
        'detail', 'Creating expenses requires the expenses.manage permission.');
    END IF;

    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND p_branch_id <> v_user_branch THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    -- Resolve the expense account (explicit, or the default mapping)
    IF p_account_id IS NOT NULL THEN
      SELECT id INTO v_account
      FROM public.chart_of_accounts
      WHERE id = p_account_id AND branch_id = p_branch_id AND is_active;
      IF v_account IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'ACCOUNT_NOT_FOUND', 'detail', 'Expense account not found in this branch.');
      END IF;
    ELSE
      v_account := public.resolve_account_key(p_branch_id, 'expense_default');
      IF v_account IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'ACCOUNT_NOT_FOUND', 'detail', 'No default expense account mapped.');
      END IF;
    END IF;

    INSERT INTO public.expenses (category, description, amount, tax_amount, branch_id, payment_method,
      expense_date, notes, created_by, account_id)
    VALUES (p_category, p_description, p_amount, COALESCE(p_tax_amount, 0), p_branch_id,
      p_payment_method, p_expense_date, p_notes, auth.uid(), v_account)
    RETURNING id INTO v_expense_id;

    v_total := round(p_amount + COALESCE(p_tax_amount, 0), 2);

    v_lines := v_lines || jsonb_build_object('account_code', (SELECT code FROM public.chart_of_accounts WHERE id = v_account),
      'debit', round(p_amount, 2), 'credit', 0, 'note', COALESCE(p_description, p_category));
    v_dr := v_dr + round(p_amount, 2);
    IF COALESCE(p_tax_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'vat_receivable', 'debit', p_tax_amount, 'credit', 0);
      v_dr := v_dr + p_tax_amount;
    END IF;
    IF v_total > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', CASE WHEN COALESCE(p_payment_method, 'cash') = 'cash' THEN 'cash' ELSE 'bank' END,
        'debit', 0, 'credit', v_total, 'note', COALESCE(p_description, p_category));
      v_cr := v_cr + v_total;
    END IF;

    v_diff := round(v_dr - v_cr, 2);
    IF v_diff <> 0 THEN
      IF v_diff > 0 THEN
        v_lines := v_lines || jsonb_build_object('account_code', (SELECT code FROM public.chart_of_accounts WHERE id = v_account), 'debit', 0, 'credit', v_diff);
      ELSE
        v_lines := v_lines || jsonb_build_object('account_code', (SELECT code FROM public.chart_of_accounts WHERE id = v_account), 'debit', -v_diff, 'credit', 0);
      END IF;
    END IF;

    PERFORM public._post_journal_entry(p_branch_id, 'expense', v_expense_id, NULL,
      'مصروف ' || COALESCE(p_category, 'مصروفات'), v_lines);

    RETURN jsonb_build_object('success', true, 'expense_id', v_expense_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------
-- 4. complete_production_order: keep stock logic, add WIP posting
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_production_order(p_order_id uuid, p_waste jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order record;
  v_recipe_id uuid;
  v_recipe_yield numeric(14,4);
  v_factor numeric(14,4);
  v_item record;
  v_waste_item jsonb;
  v_req numeric(14,4);
  v_res jsonb;
  v_short numeric(14,4);
  v_cost numeric(14,2) := 0;
  v_unit_cost numeric(12,2) := 0;
  v_lines jsonb := '[]'::jsonb;
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND NOT can_permission('production.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;

    SELECT * INTO v_order FROM public.production_orders WHERE id = p_order_id FOR UPDATE;
    IF v_order.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
    END IF;
    IF v_order.status NOT IN ('planned', 'in_progress') THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'status', v_order.status);
    END IF;
    IF v_order.warehouse_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'WAREHOUSE_REQUIRED',
        'detail', 'Assign an output warehouse to the production order before completing it.');
    END IF;

    SELECT id, yield_quantity INTO v_recipe_id, v_recipe_yield
    FROM public.recipes
    WHERE product_id = v_order.product_id AND branch_id = v_order.branch_id AND is_active
    ORDER BY updated_at DESC LIMIT 1;
    IF v_recipe_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'NO_RECIPE', 'product_id', v_order.product_id);
    END IF;

    v_recipe_yield := COALESCE(v_recipe_yield, 1);
    v_factor := v_order.quantity / v_recipe_yield;

    -- Consume raw materials (FIFO by nearest expiry)
    FOR v_item IN SELECT * FROM public.recipe_items WHERE recipe_id = v_recipe_id
    LOOP
      v_req := COALESCE(v_item.quantity, 0) * v_factor;
      IF v_req <= 0 THEN CONTINUE; END IF;

      v_res := public._raw_remove_fifo(v_item.raw_material_id, v_order.branch_id, v_req,
        'production', 'production_order', v_order.id, v_order.order_number, auth.uid());
      v_short := (v_res->>'shortage')::numeric;
      IF v_short > 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_RAW',
          'raw_material_id', v_item.raw_material_id, 'required', v_req,
          'available', v_req - v_short,
          'detail', 'Not enough raw material to complete production. The order was not completed.');
      END IF;
      v_cost := v_cost + (v_res->>'total_cost')::numeric;
    END LOOP;

    -- Record waste (extra raw material consumed beyond the recipe)
    IF p_waste IS NOT NULL AND jsonb_array_length(p_waste) > 0 THEN
      FOR v_waste_item IN SELECT * FROM jsonb_array_elements(p_waste)
      LOOP
        v_req := COALESCE((v_waste_item->>'quantity')::numeric, 0);
        IF v_req <= 0 THEN CONTINUE; END IF;
        v_res := public._raw_remove_fifo((v_waste_item->>'raw_material_id')::uuid, v_order.branch_id, v_req,
          'waste', 'production_order', v_order.id, v_order.order_number, auth.uid());
        v_cost := v_cost + (v_res->>'total_cost')::numeric;
        INSERT INTO public.production_waste (order_id, branch_id, raw_material_id, quantity, reason)
        VALUES (v_order.id, v_order.branch_id, (v_waste_item->>'raw_material_id')::uuid, v_req,
                COALESCE(v_waste_item->>'reason', 'إنتاج'));
      END LOOP;
    END IF;

    -- Produce output as a new batch
    v_unit_cost := CASE WHEN v_order.quantity > 0 THEN round(v_cost / v_order.quantity, 2) ELSE 0 END;
    v_res := public._product_inv_add(v_order.product_id, v_order.warehouse_id, v_order.branch_id,
      v_order.quantity, v_unit_cost, v_order.batch_number, CURRENT_DATE, NULL,
      'production', 'production_order', v_order.id, v_order.order_number, auth.uid());
    IF NOT (v_res->>'success')::boolean THEN
      RETURN v_res;
    END IF;

    UPDATE public.production_orders
    SET status = 'completed', total_cost = v_cost, completed_at = now()
    WHERE id = v_order.id;

    -- ===== LEDGER POSTING: raw consumed into WIP, output to finished goods =====
    IF v_cost > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'wip', 'debit', v_cost, 'credit', 0, 'note', v_order.order_number);
      v_lines := v_lines || jsonb_build_object('account_key', 'inventory_rm', 'debit', 0, 'credit', v_cost, 'note', v_order.order_number);
      v_lines := v_lines || jsonb_build_object('account_key', 'inventory_fg', 'debit', v_cost, 'credit', 0, 'note', v_order.order_number);
      v_lines := v_lines || jsonb_build_object('account_key', 'wip', 'debit', 0, 'credit', v_cost, 'note', v_order.order_number);
      PERFORM public._post_journal_entry(v_order.branch_id, 'production', v_order.id, v_order.order_number,
        'إنتاج ' || v_order.order_number, v_lines);
    END IF;

    RETURN jsonb_build_object('success', true, 'order_id', v_order.id, 'order_number', v_order.order_number,
      'total_cost', v_cost, 'unit_cost', v_unit_cost);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------
-- 5. adjust_stock: post inventory variance against the stock variance a/c
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adjust_stock(p_inventory_id uuid, p_new_quantity numeric, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inv record;
  v_user_branch uuid;
  v_delta numeric(14,4);
  v_res jsonb;
  v_value numeric(14,2);
  v_lines jsonb := '[]'::jsonb;
BEGIN
  BEGIN
    -- Only admins, branch managers and warehouse managers may adjust stock
    IF NOT is_pos_admin() AND get_user_role() NOT IN ('warehouse_manager','branch_manager') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
        'detail', 'Stock adjustments require the warehouse manager or branch manager role.');
    END IF;

    SELECT i.id, i.product_id, i.warehouse_id, i.quantity, i.branch_id, p.cost_price AS cost
    INTO v_inv
    FROM inventory i
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

    IF v_delta > 0 THEN
      v_res := public._product_inv_add(v_inv.product_id, v_inv.warehouse_id, v_inv.branch_id, v_delta,
        COALESCE(v_inv.cost, 0), 'ADJ', NULL, NULL,
        'adjustment', 'adjustment', NULL, p_reason, auth.uid());
      v_value := round(v_delta * COALESCE(v_inv.cost, 0), 2);
    ELSE
      v_res := public._product_inv_remove_fifo(v_inv.product_id, v_inv.warehouse_id, v_inv.branch_id, -v_delta,
        'adjustment', 'adjustment', NULL, p_reason, auth.uid());
      v_value := round(COALESCE((v_res->>'total_cost')::numeric, 0), 2);
    END IF;

    IF NOT (v_res->>'success')::boolean THEN
      RETURN v_res;
    END IF;

    -- ===== LEDGER POSTING =====
    IF v_value > 0 THEN
      IF v_delta > 0 THEN
        v_lines := v_lines || jsonb_build_object('account_key', 'inventory_fg', 'debit', v_value, 'credit', 0, 'note', COALESCE(p_reason, 'جرد'));
        v_lines := v_lines || jsonb_build_object('account_key', 'stock_variance', 'debit', 0, 'credit', v_value, 'note', COALESCE(p_reason, 'جرد'));
      ELSE
        v_lines := v_lines || jsonb_build_object('account_key', 'inventory_fg', 'debit', 0, 'credit', v_value, 'note', COALESCE(p_reason, 'جرد'));
        v_lines := v_lines || jsonb_build_object('account_key', 'stock_variance', 'debit', v_value, 'credit', 0, 'note', COALESCE(p_reason, 'جرد'));
      END IF;
      PERFORM public._post_journal_entry(v_inv.branch_id, 'adjustment', NULL, NULL,
        'تسوية مخزون ' || COALESCE(p_reason, ''), v_lines);
    END IF;

    RETURN jsonb_build_object('success', true, 'inventory_id', p_inventory_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------
-- 6. adjust_raw_stock: post raw variance against the stock variance a/c
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adjust_raw_stock(p_raw_material_id uuid, p_branch_id uuid, p_new_quantity numeric, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cur numeric(14,4);
  v_delta numeric(14,4);
  v_user_branch uuid;
  v_res jsonb;
  v_cost numeric(12,2);
  v_value numeric(14,2);
  v_lines jsonb := '[]'::jsonb;
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND get_user_role() NOT IN ('warehouse_manager','branch_manager') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
        'detail', 'Raw material adjustments require the warehouse manager or branch manager role.');
    END IF;

    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND p_branch_id <> v_user_branch THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    SELECT COALESCE(quantity, 0), COALESCE(avg_cost, 0)
    INTO v_cur, v_cost
    FROM public.raw_material_inventory
    WHERE raw_material_id = p_raw_material_id AND branch_id = p_branch_id;
    IF v_cur IS NULL THEN v_cur := 0; END IF;

    v_delta := p_new_quantity - v_cur;
    IF v_delta = 0 THEN
      RETURN jsonb_build_object('success', true, 'raw_material_id', p_raw_material_id, 'no_change', true);
    END IF;

    IF v_delta > 0 THEN
      v_res := public._raw_add(p_raw_material_id, p_branch_id, v_delta, v_cost,
        'ADJ', NULL, NULL, 'adjustment', 'adjustment', NULL, p_reason, auth.uid());
      v_value := round(v_delta * COALESCE(v_cost, 0), 2);
    ELSE
      v_res := public._raw_remove_fifo(p_raw_material_id, p_branch_id, -v_delta,
        'adjustment', 'adjustment', NULL, p_reason, auth.uid());
      v_value := round(COALESCE((v_res->>'total_cost')::numeric, 0), 2);
    END IF;

    IF NOT (v_res->>'success')::boolean THEN
      RETURN v_res;
    END IF;

    -- ===== LEDGER POSTING =====
    IF v_value > 0 THEN
      IF v_delta > 0 THEN
        v_lines := v_lines || jsonb_build_object('account_key', 'inventory_rm', 'debit', v_value, 'credit', 0, 'note', COALESCE(p_reason, 'جرد'));
        v_lines := v_lines || jsonb_build_object('account_key', 'stock_variance', 'debit', 0, 'credit', v_value, 'note', COALESCE(p_reason, 'جرد'));
      ELSE
        v_lines := v_lines || jsonb_build_object('account_key', 'inventory_rm', 'debit', 0, 'credit', v_value, 'note', COALESCE(p_reason, 'جرد'));
        v_lines := v_lines || jsonb_build_object('account_key', 'stock_variance', 'debit', v_value, 'credit', 0, 'note', COALESCE(p_reason, 'جرد'));
      END IF;
      PERFORM public._post_journal_entry(p_branch_id, 'adjustment', NULL, NULL,
        'تسوية خامات ' || COALESCE(p_reason, ''), v_lines);
    END IF;

    RETURN jsonb_build_object('success', true, 'raw_material_id', p_raw_material_id, 'quantity', p_new_quantity);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------
-- Reload the PostgREST schema cache.
-- ---------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- ==========================================
-- 021_d3_ap.sql
-- ==========================================
-- =====================================================================
-- Phase D3: Accounts payable - supplier payments + purchase returns
-- =====================================================================
-- Adds the AP side of the ledger, mirroring the AR module (Phase C/T0):
--   1. supplier_payments      -> receipts of payments made to suppliers
--   2. pay_supplier (new)     -> cash/bank out, AP in (idempotent per
--                                payment reference, applied to open invoices)
--   3. process_purchase_return (new) -> reverse goods + VAT, remove stock,
--                                adjust discount received, cash/AP back
-- All posting goes through _post_journal_entry with semantic keys and is
-- idempotent; existing RLS is never weakened.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Purchase return tracking columns (mirror of sale_items/sales)
-- ---------------------------------------------------------------------
ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS returned_quantity numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS returned_amount numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS returned_amount numeric(14,2) NOT NULL DEFAULT 0;

-- Allow the new movement type in the legacy stock_transactions log
ALTER TABLE public.stock_transactions DROP CONSTRAINT IF EXISTS stock_transactions_transaction_type_check;
ALTER TABLE public.stock_transactions ADD CONSTRAINT stock_transactions_transaction_type_check
  CHECK (transaction_type IN ('sale', 'purchase', 'adjustment', 'refund',
                              'transfer', 'production', 'waste', 'opening',
                              'purchase_return'));

-- ---------------------------------------------------------------------
-- 1. supplier_payments table (mirror of customer_payments)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.supplier_payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id       uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  branch_id         uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  amount            numeric(14,2) NOT NULL CHECK (amount > 0),
  payment_method    text NOT NULL DEFAULT 'cash',
  purchase_id       uuid REFERENCES public.purchases(id) ON DELETE SET NULL,
  reference_number  text,
  notes             text,
  created_by        uuid REFERENCES public.users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.supplier_payments IS 'سندات الدفع (دفع للموردين مقابل ذمم دائنة)';

CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON public.supplier_payments (supplier_id, created_at);

ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "supplier_payments_select" ON public.supplier_payments;
CREATE POLICY "supplier_payments_select" ON public.supplier_payments
  FOR SELECT TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "supplier_payments_insert" ON public.supplier_payments;
CREATE POLICY "supplier_payments_insert" ON public.supplier_payments
  FOR INSERT TO authenticated WITH CHECK (is_pos_admin());

INSERT INTO public.document_sequences (seq_type, next_value) VALUES ('supplier_payment', 1)
ON CONFLICT (seq_type) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. pay_supplier: pay open invoices, post cash/bank vs AP
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pay_supplier(
  p_supplier_id uuid,
  p_branch_id uuid,
  p_amount numeric,
  p_payment_method text DEFAULT 'cash',
  p_purchase_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_payment_id uuid;
  v_number text;
  v_user_branch uuid;
  v_remaining numeric(14,2);
  v_purchase record;
  v_applied numeric(14,2);
  v_open numeric(14,2);
  v_total_open numeric(14,2);
  v_payment_account text;
  v_lines jsonb := '[]'::jsonb;
BEGIN
  BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_AMOUNT');
    END IF;

    IF NOT is_pos_admin() AND get_user_role() NOT IN ('accountant', 'branch_manager') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
        'detail', 'Supplier payments require the accountant or branch manager role.');
    END IF;

    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND p_branch_id <> v_user_branch THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM suppliers WHERE id = p_supplier_id AND branch_id = p_branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'SUPPLIER_NOT_FOUND');
    END IF;

    -- Payments must be backed by open payable (no free-floating debits).
    SELECT COALESCE(SUM(s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.returned_amount, 0)), 0)
    INTO v_total_open
    FROM public.purchases s
    WHERE s.supplier_id = p_supplier_id AND s.branch_id = p_branch_id AND s.status = 'completed';

    IF p_purchase_id IS NULL THEN
      IF round(p_amount, 2) > round(v_total_open, 2) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_EXCEEDS_AP',
          'open', round(v_total_open, 2), 'detail', 'The payment exceeds the supplier open balance.');
      END IF;
    ELSE
      SELECT total, COALESCE(paid_amount, 0), COALESCE(returned_amount, 0) INTO v_purchase
      FROM public.purchases WHERE id = p_purchase_id AND supplier_id = p_supplier_id AND branch_id = p_branch_id
        AND status = 'completed' FOR UPDATE;
      IF v_purchase.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'PURCHASE_NOT_FOUND',
          'detail', 'No completed invoice found for this supplier with that id.');
      END IF;
      IF round(p_amount, 2) > round(v_purchase.total - v_purchase.paid_amount - v_purchase.returned_amount, 2) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_EXCEEDS_INVOICE',
          'open', round(v_purchase.total - v_purchase.paid_amount - v_purchase.returned_amount, 2));
      END IF;
    END IF;

    v_number := (public.next_document_number('supplier_payment')->>'number')::text;

    INSERT INTO public.supplier_payments (supplier_id, branch_id, amount, payment_method, purchase_id, reference_number, notes, created_by)
    VALUES (p_supplier_id, p_branch_id, p_amount, p_payment_method, p_purchase_id, v_number, p_notes, auth.uid())
    RETURNING id INTO v_payment_id;

    -- Apply payment against invoices (specific or oldest open first)
    v_remaining := round(p_amount, 2);

    IF p_purchase_id IS NOT NULL THEN
      v_open := round(v_purchase.total - v_purchase.paid_amount - v_purchase.returned_amount, 2);
      v_applied := LEAST(v_remaining, v_open);
      UPDATE public.purchases SET paid_amount = COALESCE(paid_amount, 0) + v_applied
      WHERE id = p_purchase_id;
      v_remaining := round(v_remaining - v_applied, 2);
    ELSIF v_remaining > 0 THEN
      FOR v_purchase IN
        SELECT id, total, paid_amount, returned_amount FROM public.purchases
        WHERE supplier_id = p_supplier_id AND branch_id = p_branch_id AND status = 'completed'
          AND (total - COALESCE(paid_amount, 0) - COALESCE(returned_amount, 0)) > 0
        ORDER BY created_at ASC
        FOR UPDATE
      LOOP
        IF v_remaining <= 0 THEN EXIT; END IF;
        v_open := round(v_purchase.total - COALESCE(v_purchase.paid_amount, 0) - COALESCE(v_purchase.returned_amount, 0), 2);
        v_applied := LEAST(v_remaining, v_open);
        UPDATE public.purchases SET paid_amount = COALESCE(paid_amount, 0) + v_applied
        WHERE id = v_purchase.id;
        v_remaining := round(v_remaining - v_applied, 2);
      END LOOP;
    END IF;

    -- Post the payment journal entry (AP debit, cash/bank credit)
    v_payment_account := CASE WHEN COALESCE(p_payment_method, 'cash') = 'cash' THEN 'cash' ELSE 'bank' END;
    v_lines := v_lines || jsonb_build_object('account_key', 'ap',
      'debit', round(p_amount, 2), 'credit', 0, 'supplier_id', p_supplier_id, 'note', v_number);
    v_lines := v_lines || jsonb_build_object('account_key', v_payment_account,
      'debit', 0, 'credit', round(p_amount, 2), 'note', v_number);

    PERFORM public._post_journal_entry(p_branch_id, 'supplier_payment', v_payment_id, v_number,
      'سند دفع ' || v_number, v_lines);

    RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id, 'reference_number', v_number,
      'unapplied', v_remaining);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------
-- 3. process_purchase_return: return goods to the supplier
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_purchase_return(
  p_purchase_id uuid,
  p_items jsonb DEFAULT NULL::jsonb,
  p_reason text DEFAULT NULL::text
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_purchase record;
  v_user_branch uuid;
  v_return_total numeric(14,2) := 0;
  v_item record;
  v_req jsonb;
  v_item_id uuid;
  v_req_qty numeric(14,4);
  v_already numeric(14,4);
  v_ret_qty numeric(14,4);
  v_item_line_total numeric(14,2);
  v_item_ret_amt numeric(14,2);
  v_all_returned boolean := true;
  v_remaining numeric(14,4);
  v_res jsonb;
  v_purchase_entry uuid;
  v_fg numeric(14,2);
  v_rm numeric(14,2);
  v_vat numeric(14,2);
  v_discount numeric(14,2);
  v_paid_cash numeric(14,2);
  v_paid_bank numeric(14,2);
  v_ap numeric(14,2);
  v_ratio numeric(14,6);
  v_fg_r numeric(14,2);
  v_rm_r numeric(14,2);
  v_vat_r numeric(14,2);
  v_discount_r numeric(14,2);
  v_paid_r numeric(14,2);
  v_ap_r numeric(14,2);
  v_dr numeric(14,2) := 0;
  v_cr numeric(14,2) := 0;
  v_diff numeric(14,2);
  v_credit_key text;
  v_lines jsonb := '[]'::jsonb;
BEGIN
  BEGIN
    IF p_purchase_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_PURCHASE');
    END IF;

    SELECT id, branch_id, warehouse_id, status, total, paid_amount, supplier_id, invoice_number
      INTO v_purchase FROM public.purchases WHERE id = p_purchase_id;
    IF v_purchase.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'PURCHASE_NOT_FOUND');
    END IF;

    IF v_purchase.status = 'returned' THEN
      RETURN jsonb_build_object('success', false, 'error', 'ALREADY_RETURNED');
    END IF;
    IF v_purchase.status <> 'completed' THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS',
        'status', v_purchase.status, 'detail', 'Only completed purchases can be returned.');
    END IF;

    IF NOT is_pos_admin() AND get_user_role() NOT IN ('warehouse_manager','branch_manager') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
        'detail', 'Purchase returns require the purchases.manage permission.');
    END IF;

    SELECT branch_id INTO v_user_branch FROM users WHERE id = auth.uid();
    IF NOT is_pos_admin() AND v_user_branch IS NOT NULL
       AND v_purchase.branch_id IS NOT NULL AND v_user_branch <> v_purchase.branch_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;

    -- ===== VALIDATION PHASE =====
    IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
      FOR v_req IN SELECT * FROM jsonb_array_elements(p_items)
      LOOP
        v_item_id := (v_req->>'purchase_item_id')::uuid;
        v_req_qty := COALESCE((v_req->>'quantity')::numeric, 0);
        IF v_req_qty <= 0 THEN
          RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUANTITY', 'purchase_item_id', v_item_id);
        END IF;
        SELECT id, quantity, returned_quantity INTO v_item
          FROM purchase_items WHERE id = v_item_id AND purchase_id = p_purchase_id;
        IF v_item.id IS NULL THEN
          RETURN jsonb_build_object('success', false, 'error', 'ITEM_NOT_FOUND', 'purchase_item_id', v_item_id);
        END IF;
        v_already := COALESCE(v_item.returned_quantity, 0);
        IF v_req_qty > v_item.quantity - v_already THEN
          RETURN jsonb_build_object('success', false, 'error', 'RETURN_EXCEEDS_QUANTITY',
            'purchase_item_id', v_item_id, 'max', v_item.quantity - v_already);
        END IF;
      END LOOP;
    END IF;

    -- ===== RETURN + RESTOCK-OUT PHASE =====
    FOR v_item IN SELECT id, product_id, raw_material_id, quantity, unit_cost, returned_quantity
                  FROM purchase_items WHERE purchase_id = p_purchase_id
    LOOP
      IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
        v_req_qty := 0;
        SELECT (req->>'quantity')::numeric INTO v_req_qty
        FROM jsonb_array_elements(p_items) req
        WHERE (req->>'purchase_item_id')::uuid = v_item.id;
        v_req_qty := COALESCE(v_req_qty, 0);
      ELSE
        v_req_qty := v_item.quantity - COALESCE(v_item.returned_quantity, 0);
      END IF;
      IF v_req_qty <= 0 THEN CONTINUE; END IF;

      v_item_line_total := v_item.quantity * v_item.unit_cost;
      IF v_item.quantity > 0 THEN
        v_item_ret_amt := ROUND(v_item_line_total * v_req_qty / v_item.quantity, 2);
      ELSE
        v_item_ret_amt := 0;
      END IF;
      v_return_total := v_return_total + v_item_ret_amt;

      UPDATE purchase_items
        SET returned_quantity = COALESCE(returned_quantity, 0) + v_req_qty,
            returned_amount = COALESCE(returned_amount, 0) + v_item_ret_amt
        WHERE id = v_item.id;

      -- Return the goods to the supplier (remove from the receiving warehouse)
      v_remaining := v_req_qty;
      IF v_item.product_id IS NOT NULL THEN
        v_res := public._product_inv_remove_fifo(v_item.product_id, v_purchase.warehouse_id,
          v_purchase.branch_id, v_remaining, 'purchase_return', 'purchase_return',
          p_purchase_id, v_purchase.invoice_number, auth.uid());
        IF NOT (v_res->>'success')::boolean THEN
          RETURN v_res;
        END IF;
      ELSIF v_item.raw_material_id IS NOT NULL THEN
        v_res := public._raw_remove_fifo(v_item.raw_material_id, v_purchase.branch_id,
          v_remaining, 'purchase_return', 'purchase_return', p_purchase_id,
          v_purchase.invoice_number, auth.uid());
        IF NOT (v_res->>'success')::boolean THEN
          RETURN v_res;
        END IF;
      END IF;
    END LOOP;

    -- Update header: full return flips the status, otherwise accumulate returned_amount
    SELECT bool_and(quantity = returned_quantity) INTO v_all_returned
      FROM purchase_items WHERE purchase_id = p_purchase_id;
    UPDATE purchases SET
      returned_amount = COALESCE(returned_amount, 0) + v_return_total,
      status = CASE WHEN v_all_returned THEN 'returned' ELSE status END,
      notes = CASE WHEN p_reason IS NOT NULL THEN COALESCE(notes, '') || E'\n' || p_reason ELSE notes END
      WHERE id = p_purchase_id;

    -- ===== LEDGER POSTING: prorated reversal of the purchase entry =====
    IF v_return_total > 0 THEN
      SELECT id INTO v_purchase_entry
      FROM public.journal_entries
      WHERE branch_id = v_purchase.branch_id AND reference_type = 'purchase' AND reference_id = p_purchase_id;

      IF v_purchase_entry IS NOT NULL THEN
        SELECT
          round(COALESCE(SUM(CASE WHEN a.id = m.fg_id THEN l.debit - l.credit ELSE 0 END), 0), 2),
          round(COALESCE(SUM(CASE WHEN a.id = m.rm_id THEN l.debit - l.credit ELSE 0 END), 0), 2),
          round(COALESCE(SUM(CASE WHEN a.id = m.vat_id THEN l.debit - l.credit ELSE 0 END), 0), 2),
          round(COALESCE(SUM(CASE WHEN a.id = m.disc_id THEN l.credit - l.debit ELSE 0 END), 0), 2),
          round(COALESCE(SUM(CASE WHEN a.id = m.cash_id THEN l.credit - l.debit ELSE 0 END), 0), 2),
          round(COALESCE(SUM(CASE WHEN a.id = m.bank_id THEN l.credit - l.debit ELSE 0 END), 0), 2),
          round(COALESCE(SUM(CASE WHEN a.id = m.ap_id THEN l.credit - l.debit ELSE 0 END), 0), 2)
        INTO v_fg, v_rm, v_vat, v_discount, v_paid_cash, v_paid_bank, v_ap
        FROM public.journal_entry_lines l
        JOIN public.chart_of_accounts a ON a.id = l.account_id
        CROSS JOIN (
          SELECT
            (SELECT public.resolve_account_key(v_purchase.branch_id, 'inventory_fg')) AS fg_id,
            (SELECT public.resolve_account_key(v_purchase.branch_id, 'inventory_rm')) AS rm_id,
            (SELECT public.resolve_account_key(v_purchase.branch_id, 'vat_receivable')) AS vat_id,
            (SELECT public.resolve_account_key(v_purchase.branch_id, 'discount_received')) AS disc_id,
            (SELECT public.resolve_account_key(v_purchase.branch_id, 'cash')) AS cash_id,
            (SELECT public.resolve_account_key(v_purchase.branch_id, 'bank')) AS bank_id,
            (SELECT public.resolve_account_key(v_purchase.branch_id, 'ap')) AS ap_id
        ) m
        WHERE l.journal_entry_id = v_purchase_entry;

        v_ratio := round(v_return_total / GREATEST(COALESCE(v_purchase.total, 0), 1), 6);
        v_fg_r := round(COALESCE(v_fg, 0) * v_ratio, 2);
        v_rm_r := round(COALESCE(v_rm, 0) * v_ratio, 2);
        v_vat_r := round(COALESCE(v_vat, 0) * v_ratio, 2);
        v_discount_r := round(COALESCE(v_discount, 0) * v_ratio, 2);
        v_paid_r := round((COALESCE(v_paid_cash, 0) + COALESCE(v_paid_bank, 0)) * v_ratio, 2);
        v_ap_r := round(COALESCE(v_ap, 0) * v_ratio, 2);

        v_credit_key := CASE WHEN COALESCE(v_paid_cash, 0) >= COALESCE(v_paid_bank, 0) THEN 'cash' ELSE 'bank' END;

        IF v_fg_r > 0 THEN
          v_lines := v_lines || jsonb_build_object('account_key', 'inventory_fg', 'debit', 0, 'credit', v_fg_r);
          v_cr := v_cr + v_fg_r;
        END IF;
        IF v_rm_r > 0 THEN
          v_lines := v_lines || jsonb_build_object('account_key', 'inventory_rm', 'debit', 0, 'credit', v_rm_r);
          v_cr := v_cr + v_rm_r;
        END IF;
        IF v_vat_r > 0 THEN
          v_lines := v_lines || jsonb_build_object('account_key', 'vat_receivable', 'debit', 0, 'credit', v_vat_r);
          v_cr := v_cr + v_vat_r;
        END IF;
        IF v_discount_r > 0 THEN
          v_lines := v_lines || jsonb_build_object('account_key', 'discount_received', 'debit', v_discount_r, 'credit', 0);
          v_dr := v_dr + v_discount_r;
        END IF;
        IF v_paid_r > 0 THEN
          v_lines := v_lines || jsonb_build_object('account_key', v_credit_key, 'debit', v_paid_r, 'credit', 0,
            'note', 'مرتجع ' || v_purchase.invoice_number);
          v_dr := v_dr + v_paid_r;
        END IF;
        IF v_ap_r > 0 THEN
          v_lines := v_lines || jsonb_build_object('account_key', 'ap', 'debit', v_ap_r, 'credit', 0,
            'supplier_id', v_purchase.supplier_id, 'note', 'مرتجع ' || v_purchase.invoice_number);
          v_dr := v_dr + v_ap_r;
        END IF;

        v_diff := round(v_dr - v_cr, 2);
        IF v_diff <> 0 THEN
          IF v_diff > 0 THEN
            v_lines := v_lines || jsonb_build_object('account_key', 'discount_received', 'debit', 0, 'credit', v_diff);
          ELSE
            v_lines := v_lines || jsonb_build_object('account_key', 'discount_received', 'debit', -v_diff, 'credit', 0);
          END IF;
        END IF;

        PERFORM public._post_journal_entry(v_purchase.branch_id, 'purchase_return', NULL, v_purchase.invoice_number,
          'مرتجع فاتورة شراء ' || v_purchase.invoice_number, v_lines);
      END IF;
    END IF;

    RETURN jsonb_build_object('success', true, 'purchase_id', p_purchase_id,
      'returned_amount', v_return_total, 'fully_returned', v_all_returned);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------
-- Reload the PostgREST schema cache.
-- ---------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- ==========================================
-- 022_d4_treasury.sql
-- ==========================================
-- =====================================================================
-- Phase D4: Treasury - cash/bank accounts, transfers & deposits
-- =====================================================================
-- Full treasury module over the chart of accounts:
--   1. treasury_accounts      -> named cash drawers / bank accounts per
--                                branch, each linked to a chart account
--   2. treasury_transactions  -> audit log of every movement
--   3. process_transfer       -> between two treasury accounts
--   4. process_treasury_deposit    -> owner funds entering a treasury account
--   5. process_treasury_withdrawal -> owner funds leaving a treasury account
--   6. get_treasury_balances  -> ledger balance per treasury account
-- All movements post through _post_journal_entry (idempotent per reference)
-- and never weaken existing RLS.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. treasury_accounts
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.treasury_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id       uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  account_id      uuid NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE CASCADE,
  account_type    text NOT NULL DEFAULT 'cash' CHECK (account_type IN ('cash', 'bank')),
  account_name    text NOT NULL,
  account_number  text,
  is_active       boolean NOT NULL DEFAULT true,
  opening_balance numeric(14,2) NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, account_id)
);
COMMENT ON TABLE public.treasury_accounts IS 'حسابات الخزينة (درج نقدية / حساب بنكي) لكل فرع، مرتبطة بشجرة الحسابات';

CREATE INDEX IF NOT EXISTS idx_treasury_accounts_branch ON public.treasury_accounts (branch_id, is_active);

ALTER TABLE public.treasury_accounts ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_treasury_accounts_updated BEFORE UPDATE ON public.treasury_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP POLICY IF EXISTS "treasury_accounts_select" ON public.treasury_accounts;
CREATE POLICY "treasury_accounts_select" ON public.treasury_accounts
  FOR SELECT TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "treasury_accounts_insert" ON public.treasury_accounts;
CREATE POLICY "treasury_accounts_insert" ON public.treasury_accounts
  FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR (can_permission('accounts.manage') AND branch_id = get_branch_id()));
DROP POLICY IF EXISTS "treasury_accounts_update" ON public.treasury_accounts;
CREATE POLICY "treasury_accounts_update" ON public.treasury_accounts
  FOR UPDATE TO authenticated
  USING (is_pos_admin() OR (can_permission('accounts.manage') AND branch_id = get_branch_id()))
  WITH CHECK (is_pos_admin() OR (can_permission('accounts.manage') AND branch_id = get_branch_id()));
DROP POLICY IF EXISTS "treasury_accounts_delete" ON public.treasury_accounts;
CREATE POLICY "treasury_accounts_delete" ON public.treasury_accounts
  FOR DELETE TO authenticated
  USING (is_pos_admin() OR (can_permission('accounts.manage') AND branch_id = get_branch_id()));

-- Seed one cash + one bank account per branch from the mapped accounts
CREATE OR REPLACE FUNCTION public.seed_treasury_accounts(p_branch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.treasury_accounts (branch_id, account_id, account_type, account_name)
  SELECT p_branch_id, m.account_id, m.semantic_key, a.name
  FROM public.account_mappings m
  JOIN public.chart_of_accounts a ON a.id = m.account_id
  WHERE m.branch_id = p_branch_id AND m.semantic_key IN ('cash', 'bank')
  ON CONFLICT (branch_id, account_id) DO NOTHING;
END;
$function$;

SELECT public.seed_treasury_accounts(id) FROM public.branches;

-- ---------------------------------------------------------------------
-- 2. treasury_transactions (movement audit log)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.treasury_transactions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id         uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  transaction_type  text NOT NULL CHECK (transaction_type IN ('transfer', 'deposit', 'withdrawal')),
  from_account_id   uuid REFERENCES public.treasury_accounts(id),
  to_account_id     uuid REFERENCES public.treasury_accounts(id),
  amount            numeric(14,2) NOT NULL CHECK (amount > 0),
  reference_number  text,
  notes             text,
  created_by        uuid REFERENCES public.users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.treasury_transactions IS 'حركات الخزينة (تحويل / إيداع / سحب)';

CREATE INDEX IF NOT EXISTS idx_treasury_transactions_branch ON public.treasury_transactions (branch_id, created_at DESC);

ALTER TABLE public.treasury_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "treasury_transactions_select" ON public.treasury_transactions;
CREATE POLICY "treasury_transactions_select" ON public.treasury_transactions
  FOR SELECT TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "treasury_transactions_insert" ON public.treasury_transactions;
CREATE POLICY "treasury_transactions_insert" ON public.treasury_transactions
  FOR INSERT TO authenticated WITH CHECK (is_pos_admin());

INSERT INTO public.document_sequences (seq_type, next_value) VALUES ('treasury', 1)
ON CONFLICT (seq_type) DO NOTHING;

-- ---------------------------------------------------------------------
-- 3. Shared validation for treasury RPCs
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._treasury_guard(p_branch_id uuid, p_account_id uuid, p_amount numeric)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_account record;
  v_user_branch uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_AMOUNT');
  END IF;

  IF NOT is_pos_admin() AND get_user_role() NOT IN ('accountant', 'branch_manager') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_ALLOWED',
      'detail', 'Treasury operations require the accountant or branch manager role.');
  END IF;

  IF NOT is_pos_admin() THEN
    SELECT branch_id INTO v_user_branch FROM users WHERE id = auth.uid();
    IF v_user_branch IS NOT NULL AND p_branch_id <> v_user_branch THEN
      RETURN jsonb_build_object('ok', false, 'error', 'BRANCH_MISMATCH');
    END IF;
  END IF;

  IF p_account_id IS NOT NULL THEN
    SELECT id, account_id, account_type, is_active INTO v_account
    FROM public.treasury_accounts
    WHERE id = p_account_id AND branch_id = p_branch_id;
    IF v_account.id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'TREASURY_ACCOUNT_NOT_FOUND');
    END IF;
    IF NOT v_account.is_active THEN
      RETURN jsonb_build_object('ok', false, 'error', 'TREASURY_ACCOUNT_INACTIVE');
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- ---------------------------------------------------------------------
-- 4. process_transfer: move money between two treasury accounts
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_transfer(
  p_branch_id uuid,
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount numeric,
  p_notes text DEFAULT NULL::text
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_guard jsonb;
  v_from record;
  v_to record;
  v_number text;
  v_tx_id uuid;
  v_lines jsonb := '[]'::jsonb;
BEGIN
  BEGIN
    v_guard := public._treasury_guard(p_branch_id, p_from_account_id, p_amount);
    IF NOT (v_guard->>'ok')::boolean THEN
      RETURN v_guard;
    END IF;
    v_guard := public._treasury_guard(p_branch_id, p_to_account_id, p_amount);
    IF NOT (v_guard->>'ok')::boolean THEN
      RETURN v_guard;
    END IF;

    IF p_from_account_id = p_to_account_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'SAME_ACCOUNT');
    END IF;

    SELECT id, account_id, account_type, account_name INTO v_from
    FROM public.treasury_accounts WHERE id = p_from_account_id;
    SELECT id, account_id, account_type, account_name INTO v_to
    FROM public.treasury_accounts WHERE id = p_to_account_id;

    v_number := (public.next_document_number('treasury')->>'number')::text;

    INSERT INTO public.treasury_transactions (branch_id, transaction_type, from_account_id, to_account_id, amount, reference_number, notes, created_by)
    VALUES (p_branch_id, 'transfer', p_from_account_id, p_to_account_id, p_amount, v_number, p_notes, auth.uid())
    RETURNING id INTO v_tx_id;

    v_lines := v_lines || jsonb_build_object('account_code', (SELECT code FROM public.chart_of_accounts WHERE id = v_to.account_id),
      'debit', round(p_amount, 2), 'credit', 0, 'note', 'تحويل ' || v_number);
    v_lines := v_lines || jsonb_build_object('account_code', (SELECT code FROM public.chart_of_accounts WHERE id = v_from.account_id),
      'debit', 0, 'credit', round(p_amount, 2), 'note', 'تحويل ' || v_number);

    PERFORM public._post_journal_entry(p_branch_id, 'transfer', v_tx_id, v_number,
      'تحويل خزينة ' || v_number, v_lines);

    RETURN jsonb_build_object('success', true, 'transaction_id', v_tx_id, 'reference_number', v_number);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------
-- 5. process_treasury_deposit: owner funds into a treasury account
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_treasury_deposit(
  p_branch_id uuid,
  p_account_id uuid,
  p_amount numeric,
  p_notes text DEFAULT NULL::text
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_guard jsonb;
  v_account record;
  v_number text;
  v_tx_id uuid;
  v_lines jsonb := '[]'::jsonb;
BEGIN
  BEGIN
    v_guard := public._treasury_guard(p_branch_id, p_account_id, p_amount);
    IF NOT (v_guard->>'ok')::boolean THEN
      RETURN v_guard;
    END IF;

    SELECT id, account_id INTO v_account FROM public.treasury_accounts WHERE id = p_account_id;

    v_number := (public.next_document_number('treasury')->>'number')::text;

    INSERT INTO public.treasury_transactions (branch_id, transaction_type, to_account_id, amount, reference_number, notes, created_by)
    VALUES (p_branch_id, 'deposit', p_account_id, p_amount, v_number, p_notes, auth.uid())
    RETURNING id INTO v_tx_id;

    v_lines := v_lines || jsonb_build_object('account_code', (SELECT code FROM public.chart_of_accounts WHERE id = v_account.account_id),
      'debit', round(p_amount, 2), 'credit', 0, 'note', 'إيداع ' || v_number);
    v_lines := v_lines || jsonb_build_object('account_key', 'capital',
      'debit', 0, 'credit', round(p_amount, 2), 'note', 'إيداع ' || v_number);

    PERFORM public._post_journal_entry(p_branch_id, 'treasury_deposit', v_tx_id, v_number,
      'إيداع خزينة ' || v_number, v_lines);

    RETURN jsonb_build_object('success', true, 'transaction_id', v_tx_id, 'reference_number', v_number);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------
-- 6. process_treasury_withdrawal: owner funds out of a treasury account
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_treasury_withdrawal(
  p_branch_id uuid,
  p_account_id uuid,
  p_amount numeric,
  p_notes text DEFAULT NULL::text
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_guard jsonb;
  v_account record;
  v_number text;
  v_tx_id uuid;
  v_lines jsonb := '[]'::jsonb;
BEGIN
  BEGIN
    v_guard := public._treasury_guard(p_branch_id, p_account_id, p_amount);
    IF NOT (v_guard->>'ok')::boolean THEN
      RETURN v_guard;
    END IF;

    SELECT id, account_id INTO v_account FROM public.treasury_accounts WHERE id = p_account_id;

    v_number := (public.next_document_number('treasury')->>'number')::text;

    INSERT INTO public.treasury_transactions (branch_id, transaction_type, from_account_id, amount, reference_number, notes, created_by)
    VALUES (p_branch_id, 'withdrawal', p_account_id, p_amount, v_number, p_notes, auth.uid())
    RETURNING id INTO v_tx_id;

    v_lines := v_lines || jsonb_build_object('account_key', 'capital',
      'debit', round(p_amount, 2), 'credit', 0, 'note', 'سحب ' || v_number);
    v_lines := v_lines || jsonb_build_object('account_code', (SELECT code FROM public.chart_of_accounts WHERE id = v_account.account_id),
      'debit', 0, 'credit', round(p_amount, 2), 'note', 'سحب ' || v_number);

    PERFORM public._post_journal_entry(p_branch_id, 'treasury_withdrawal', v_tx_id, v_number,
      'سحب خزينة ' || v_number, v_lines);

    RETURN jsonb_build_object('success', true, 'transaction_id', v_tx_id, 'reference_number', v_number);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------
-- 7. get_treasury_balances: ledger balance per treasury account
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_treasury_balances(p_branch_id uuid)
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE
AS $function$
SELECT COALESCE(jsonb_agg(s.jb ORDER BY s.jb->>'account_type', s.jb->>'account_name'), '[]'::jsonb)
FROM (
  SELECT jsonb_build_object(
    'id', t.id,
    'account_type', t.account_type,
    'account_name', t.account_name,
    'account_number', t.account_number,
    'code', a.code,
    'is_active', t.is_active,
    'opening_balance', round(COALESCE(t.opening_balance, 0), 2),
    'balance', round(COALESCE(SUM(l.debit - l.credit), 0), 2)
  ) AS jb
  FROM public.treasury_accounts t
  JOIN public.chart_of_accounts a ON a.id = t.account_id
  LEFT JOIN public.journal_entry_lines l ON l.account_id = a.id
  WHERE t.branch_id = p_branch_id
  GROUP BY t.id, t.account_type, t.account_name, t.account_number, a.code, t.is_active, t.opening_balance
) s;
$function$;

-- ---------------------------------------------------------------------
-- Reload the PostgREST schema cache.
-- ---------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- ==========================================
-- 023_d5_reconciliation.sql
-- ==========================================
-- =====================================================================
-- Phase D5: Bank reconciliation
-- =====================================================================
-- Reconciling treasury bank accounts against the bank statement:
--   1. bank_reconciliations  -> header (statement date, balances, status)
--   2. bank_statement_lines  -> statement entries, optionally matched to
--                               a posted journal entry
--   3. create_bank_reconciliation -> opens a reconciliation and computes
--                               book balance + difference
--   4. add_statement_line / match_bank_line -> build the statement side
--   5. complete_bank_reconciliation -> validates the difference is fully
--                               explained, then closes the reconciliation
--   6. get_bank_reconciliation -> header + lines + book candidates
-- No posting happens here (bank charges etc. are expense transactions);
-- RLS is never weakened.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. bank_reconciliations
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bank_reconciliations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id            uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  treasury_account_id  uuid NOT NULL REFERENCES public.treasury_accounts(id) ON DELETE CASCADE,
  statement_date       date NOT NULL,
  statement_balance    numeric(14,2) NOT NULL,
  book_balance         numeric(14,2) NOT NULL DEFAULT 0,
  difference           numeric(14,2) NOT NULL DEFAULT 0,
  status               text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'cancelled')),
  created_by           uuid REFERENCES public.users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  closed_at            timestamptz
);
COMMENT ON TABLE public.bank_reconciliations IS 'تسويات بنكية: مطابقة كشف البنك مع الدفتر لكل حساب بنكي';

CREATE INDEX IF NOT EXISTS idx_bank_recon_branch ON public.bank_reconciliations (branch_id, statement_date DESC);

ALTER TABLE public.bank_reconciliations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bank_reconciliations_select" ON public.bank_reconciliations;
CREATE POLICY "bank_reconciliations_select" ON public.bank_reconciliations
  FOR SELECT TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "bank_reconciliations_insert" ON public.bank_reconciliations;
CREATE POLICY "bank_reconciliations_insert" ON public.bank_reconciliations
  FOR INSERT TO authenticated WITH CHECK (is_pos_admin());
DROP POLICY IF EXISTS "bank_reconciliations_update" ON public.bank_reconciliations;
CREATE POLICY "bank_reconciliations_update" ON public.bank_reconciliations
  FOR UPDATE TO authenticated USING (is_pos_admin()) WITH CHECK (is_pos_admin());

-- ---------------------------------------------------------------------
-- 2. bank_statement_lines
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bank_statement_lines (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id       uuid NOT NULL REFERENCES public.bank_reconciliations(id) ON DELETE CASCADE,
  statement_date          date NOT NULL,
  description             text,
  reference               text,
  amount                  numeric(14,2) NOT NULL,
  matched_journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.bank_statement_lines IS 'بنود كشف الحساب البنكي (إيداع موجب / سحب سالب) مع ربط اختياري بقيد دفتر';

CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_recon ON public.bank_statement_lines (reconciliation_id);

ALTER TABLE public.bank_statement_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bank_statement_lines_select" ON public.bank_statement_lines;
CREATE POLICY "bank_statement_lines_select" ON public.bank_statement_lines
  FOR SELECT TO authenticated USING (
    is_pos_admin() OR EXISTS (
      SELECT 1 FROM public.bank_reconciliations r
      WHERE r.id = bank_statement_lines.reconciliation_id AND r.branch_id = get_branch_id()
    )
  );
DROP POLICY IF EXISTS "bank_statement_lines_insert" ON public.bank_statement_lines;
CREATE POLICY "bank_statement_lines_insert" ON public.bank_statement_lines
  FOR INSERT TO authenticated WITH CHECK (is_pos_admin());
DROP POLICY IF EXISTS "bank_statement_lines_update" ON public.bank_statement_lines;
CREATE POLICY "bank_statement_lines_update" ON public.bank_statement_lines
  FOR UPDATE TO authenticated USING (is_pos_admin()) WITH CHECK (is_pos_admin());

-- ---------------------------------------------------------------------
-- 3. create_bank_reconciliation
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_bank_reconciliation(
  p_branch_id uuid,
  p_treasury_account_id uuid,
  p_statement_date date,
  p_statement_balance numeric
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_account record;
  v_user_branch uuid;
  v_book numeric(14,2);
  v_diff numeric(14,2);
  v_recon_id uuid;
BEGIN
  BEGIN
    IF p_statement_balance IS NULL OR p_statement_date IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_INPUT');
    END IF;

    IF NOT is_pos_admin() AND get_user_role() NOT IN ('accountant', 'branch_manager') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
        'detail', 'Reconciliation requires the accountant or branch manager role.');
    END IF;

    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND p_branch_id <> v_user_branch THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    SELECT t.id, t.account_id, t.is_active INTO v_account
    FROM public.treasury_accounts t
    WHERE t.id = p_treasury_account_id AND t.branch_id = p_branch_id;
    IF v_account.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'TREASURY_ACCOUNT_NOT_FOUND');
    END IF;
    IF NOT v_account.is_active THEN
      RETURN jsonb_build_object('success', false, 'error', 'TREASURY_ACCOUNT_INACTIVE');
    END IF;

    -- Book balance of the underlying chart account up to the statement date
    SELECT COALESCE(SUM(jl.debit - jl.credit), 0)
    INTO v_book
    FROM public.journal_entry_lines jl
    JOIN public.journal_entries je ON je.id = jl.journal_entry_id
    WHERE jl.account_id = v_account.account_id
      AND je.branch_id = p_branch_id
      AND je.entry_date <= p_statement_date;

    v_book := round(v_book, 2);
    v_diff := round(p_statement_balance - v_book, 2);

    INSERT INTO public.bank_reconciliations (branch_id, treasury_account_id, statement_date,
      statement_balance, book_balance, difference, created_by)
    VALUES (p_branch_id, p_treasury_account_id, p_statement_date,
      round(p_statement_balance, 2), v_book, v_diff, auth.uid())
    RETURNING id INTO v_recon_id;

    RETURN jsonb_build_object('success', true, 'reconciliation_id', v_recon_id,
      'statement_date', p_statement_date, 'statement_balance', round(p_statement_balance, 2),
      'book_balance', v_book, 'difference', v_diff);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------
-- 4. add_statement_line
-- ---------------------------------------------------------------------
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

    INSERT INTO public.bank_statement_lines (reconciliation_id, statement_date, description, reference, amount)
    VALUES (p_reconciliation_id, p_statement_date, p_description, p_reference, round(p_amount, 2))
    RETURNING id INTO v_line_id;

    RETURN jsonb_build_object('success', true, 'line_id', v_line_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------
-- 5. match_bank_line
-- ---------------------------------------------------------------------
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
BEGIN
  BEGIN
    SELECT l.id, l.reconciliation_id, l.amount, r.status, r.treasury_account_id
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

    SELECT t.account_id INTO v_account
    FROM public.treasury_accounts t WHERE t.id = v_line.treasury_account_id;

    -- The journal entry must affect this bank account in the same branch
    SELECT EXISTS (
      SELECT 1 FROM public.journal_entry_lines jl
      JOIN public.journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.journal_entry_id = p_journal_entry_id
        AND jl.account_id = v_account
        AND je.branch_id = (SELECT branch_id FROM public.bank_reconciliations WHERE id = v_line.reconciliation_id)
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

-- ---------------------------------------------------------------------
-- 6. complete_bank_reconciliation
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_bank_reconciliation(p_reconciliation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_recon record;
  v_total numeric(14,2);
  v_matched_total numeric(14,2);
  v_unmatched numeric(14,2);
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

-- ---------------------------------------------------------------------
-- 7. get_bank_reconciliation
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_bank_reconciliation(p_reconciliation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_header jsonb;
  v_lines jsonb;
  v_candidates jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', r.id, 'branch_id', r.branch_id, 'treasury_account_id', r.treasury_account_id,
    'statement_date', r.statement_date, 'statement_balance', r.statement_balance,
    'book_balance', r.book_balance, 'difference', r.difference, 'status', r.status,
    'closed_at', r.closed_at, 'account_name', t.account_name, 'code', a.code
  )
  INTO v_header
  FROM public.bank_reconciliations r
  JOIN public.treasury_accounts t ON t.id = r.treasury_account_id
  JOIN public.chart_of_accounts a ON a.id = t.account_id
  WHERE r.id = p_reconciliation_id;

  IF v_header IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'RECONCILIATION_NOT_FOUND');
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'id', l.id, 'statement_date', l.statement_date, 'description', l.description,
    'reference', l.reference, 'amount', l.amount, 'matched_journal_entry_id', l.matched_journal_entry_id
  ) ORDER BY l.statement_date, l.id)
  INTO v_lines
  FROM public.bank_statement_lines l
  WHERE l.reconciliation_id = p_reconciliation_id;

  -- Book candidates: posted journal entries touching this bank account
  SELECT jsonb_agg(s.candidate ORDER BY s.candidate->>'entry_date', s.candidate->>'id')
  INTO v_candidates
  FROM (
    SELECT jsonb_build_object(
      'id', je.id, 'entry_number', je.entry_number, 'entry_date', je.entry_date,
      'reference_type', je.reference_type, 'reference_number', je.reference_number,
      'description', je.description,
      'amount', round(COALESCE(SUM(CASE WHEN jl.account_id = a.id THEN jl.debit - jl.credit ELSE 0 END), 0), 2)
    ) AS candidate
    FROM public.journal_entries je
    JOIN public.journal_entry_lines jl ON jl.journal_entry_id = je.id
    JOIN public.bank_reconciliations r ON r.id = p_reconciliation_id
    JOIN public.treasury_accounts t ON t.id = r.treasury_account_id
    JOIN public.chart_of_accounts a ON a.id = t.account_id
    WHERE je.branch_id = r.branch_id
      AND je.entry_date <= r.statement_date
      AND jl.account_id = a.id
    GROUP BY je.id, je.entry_number, je.entry_date, je.reference_type, je.reference_number, je.description
  ) s;

  RETURN jsonb_build_object('success', true, 'header', v_header,
    'statement_lines', COALESCE(v_lines, '[]'::jsonb), 'book_candidates', COALESCE(v_candidates, '[]'::jsonb));
END;
$function$;

-- ---------------------------------------------------------------------
-- Reload the PostgREST schema cache.
-- ---------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- ==========================================
-- 024_d6_aging.sql
-- ==========================================
-- =====================================================================
-- Phase D6: Open AR/AP aging + journal listing with reference numbers
-- =====================================================================
-- Report surface for the credit-control and audit screens:
--   1. get_ap_aging          -> AP mirror of the existing get_ar_aging
--   2. get_open_invoices     -> invoice-level open AR / AP detail
--   3. get_aging_summary     -> single-row AR + AP totals per bucket
--   4. get_journals          -> posted journal entries with their lines,
--                               entry numbers and source references
-- All are read-only (STABLE, SECURITY DEFINER), branch-scoped, and rely
-- on the existing posted-ledger numbers (no double counting).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. AP aging: open payable per supplier in 30-day buckets
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_ap_aging(p_branch_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE AS $function$
SELECT COALESCE(jsonb_agg(row ORDER BY row.open_amount DESC), '[]'::jsonb)
FROM (
  SELECT s.id AS supplier_id, s.name, s.phone,
         sum(p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0)) AS open_amount,
         round(sum(CASE WHEN (p_as_of - p.created_at::date) <= 30 THEN p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0) ELSE 0 END), 2) AS bucket_0_30,
         round(sum(CASE WHEN (p_as_of - p.created_at::date) BETWEEN 31 AND 60 THEN p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0) ELSE 0 END), 2) AS bucket_31_60,
         round(sum(CASE WHEN (p_as_of - p.created_at::date) BETWEEN 61 AND 90 THEN p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0) ELSE 0 END), 2) AS bucket_61_90,
         round(sum(CASE WHEN (p_as_of - p.created_at::date) > 90 THEN p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0) ELSE 0 END), 2) AS bucket_90_plus
  FROM public.purchases p
  JOIN public.suppliers s ON s.id = p.supplier_id
  WHERE p.branch_id = p_branch_id AND p.status = 'completed'
    AND (p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0)) > 0
  GROUP BY s.id, s.name, s.phone
) row;
$function$;

COMMENT ON FUNCTION public.get_ap_aging(uuid, date) IS 'ذمم دائنة مفتوحة لكل مورد حسب العمر الزمني';

-- ---------------------------------------------------------------------
-- 2. Open invoices: invoice-level AR / AP detail with overdue days
--    p_side = 'ar' -> sales invoices, 'ap' -> purchase invoices
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_open_invoices(
  p_branch_id uuid,
  p_side text DEFAULT 'ar',
  p_as_of date DEFAULT CURRENT_DATE
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE AS $function$
SELECT CASE
  WHEN COALESCE(p_side, 'ar') = 'ap' THEN (
    SELECT COALESCE(jsonb_agg(row ORDER BY row.invoice_date, row.invoice_number), '[]'::jsonb)
    FROM (
      SELECT p.id AS invoice_id, p.invoice_number, p.supplier_id AS party_id,
             sup.name AS party_name, sup.phone AS party_phone,
             p.created_at::date AS invoice_date,
             (p.created_at::date + 30) AS due_date,
             GREATEST(p_as_of - p.created_at::date, 0) AS days_overdue,
             round(p.total, 2) AS invoice_total,
             round(COALESCE(p.paid_amount, 0), 2) AS paid,
             round(COALESCE(p.returned_amount, 0), 2) AS returned,
             round(p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0), 2) AS open_amount
      FROM public.purchases p
      JOIN public.suppliers sup ON sup.id = p.supplier_id
      WHERE p.branch_id = p_branch_id AND p.status = 'completed'
        AND (p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0)) > 0
    ) row
  ) ELSE (
    SELECT COALESCE(jsonb_agg(row ORDER BY row.invoice_date, row.invoice_number), '[]'::jsonb)
    FROM (
      SELECT s.id AS invoice_id, s.invoice_number, s.customer_id AS party_id,
             c.name AS party_name, c.phone AS party_phone,
             s.created_at::date AS invoice_date,
             (s.created_at::date + 30) AS due_date,
             GREATEST(p_as_of - s.created_at::date, 0) AS days_overdue,
             round(s.total, 2) AS invoice_total,
             round(COALESCE(s.paid_amount, 0), 2) AS paid,
             round(COALESCE(s.refunded_amount, 0), 2) AS returned,
             round(s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0), 2) AS open_amount
      FROM public.sales s
      JOIN public.customers c ON c.id = s.customer_id
      WHERE s.branch_id = p_branch_id AND s.status <> 'returned'
        AND (s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0)) > 0
    ) row
  ) END;
$function$;

COMMENT ON FUNCTION public.get_open_invoices(uuid, text, date) IS 'فواتير مفتوحة بالتفصيل (AR أو AP) مع أيام التأخير';

-- ---------------------------------------------------------------------
-- 3. Aging summary: single object with AR/AP totals per bucket
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_aging_summary(p_branch_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE AS $function$
WITH ar AS (
  SELECT
    round(sum(s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0)), 2) AS open_total,
    round(sum(CASE WHEN (p_as_of - s.created_at::date) <= 30 THEN s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0) ELSE 0 END), 2) AS bucket_0_30,
    round(sum(CASE WHEN (p_as_of - s.created_at::date) BETWEEN 31 AND 60 THEN s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0) ELSE 0 END), 2) AS bucket_31_60,
    round(sum(CASE WHEN (p_as_of - s.created_at::date) BETWEEN 61 AND 90 THEN s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0) ELSE 0 END), 2) AS bucket_61_90,
    round(sum(CASE WHEN (p_as_of - s.created_at::date) > 90 THEN s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0) ELSE 0 END), 2) AS bucket_90_plus
  FROM public.sales s
  WHERE s.branch_id = p_branch_id AND s.status <> 'returned'
    AND (s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0)) > 0
), ap AS (
  SELECT
    round(sum(p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0)), 2) AS open_total,
    round(sum(CASE WHEN (p_as_of - p.created_at::date) <= 30 THEN p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0) ELSE 0 END), 2) AS bucket_0_30,
    round(sum(CASE WHEN (p_as_of - p.created_at::date) BETWEEN 31 AND 60 THEN p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0) ELSE 0 END), 2) AS bucket_31_60,
    round(sum(CASE WHEN (p_as_of - p.created_at::date) BETWEEN 61 AND 90 THEN p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0) ELSE 0 END), 2) AS bucket_61_90,
    round(sum(CASE WHEN (p_as_of - p.created_at::date) > 90 THEN p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0) ELSE 0 END), 2) AS bucket_90_plus
  FROM public.purchases p
  WHERE p.branch_id = p_branch_id AND p.status = 'completed'
    AND (p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0)) > 0
)
SELECT jsonb_build_object(
  'as_of', p_as_of,
  'ar_open', round(COALESCE((SELECT open_total FROM ar), 0), 2),
  'ap_open', round(COALESCE((SELECT open_total FROM ap), 0), 2),
  'ar', jsonb_build_object('0_30', COALESCE((SELECT bucket_0_30 FROM ar), 0),
                           '31_60', COALESCE((SELECT bucket_31_60 FROM ar), 0),
                           '61_90', COALESCE((SELECT bucket_61_90 FROM ar), 0),
                           '90_plus', COALESCE((SELECT bucket_90_plus FROM ar), 0)),
  'ap', jsonb_build_object('0_30', COALESCE((SELECT bucket_0_30 FROM ap), 0),
                           '31_60', COALESCE((SELECT bucket_31_60 FROM ap), 0),
                           '61_90', COALESCE((SELECT bucket_61_90 FROM ap), 0),
                           '90_plus', COALESCE((SELECT bucket_90_plus FROM ap), 0))
);
$function$;

COMMENT ON FUNCTION public.get_aging_summary(uuid, date) IS 'ملخص إجمالي الذمم المدينة/الدائنة حسب العمر';

-- ---------------------------------------------------------------------
-- 4. Journals: posted entries with lines, entry numbers and references
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_journals(
  p_branch_id uuid,
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_search text DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE AS $function$
SELECT COALESCE(jsonb_agg(e ORDER BY e.entry_date, e.entry_number), '[]'::jsonb)
FROM (
  SELECT j.id, j.entry_number, j.entry_date, j.reference_type, j.reference_id,
         j.reference_number, j.description, j.created_at,
         round(COALESCE(SUM(l.debit), 0), 2) AS debit_total,
         round(COALESCE(SUM(l.credit), 0), 2) AS credit_total,
         (SELECT COALESCE(jsonb_agg(line ORDER BY line.id), '[]'::jsonb)
          FROM (
            SELECT l.id, a.code, a.name AS account_name, a.account_type,
                   round(l.debit, 2) AS debit, round(l.credit, 2) AS credit,
                   l.note, l.customer_id, l.supplier_id
            FROM public.journal_entry_lines l
            JOIN public.chart_of_accounts a ON a.id = l.account_id
            WHERE l.journal_entry_id = j.id
          ) line) AS lines
  FROM public.journal_entries j
  LEFT JOIN public.journal_entry_lines l ON l.journal_entry_id = j.id
  WHERE j.branch_id = p_branch_id
    AND (p_from_date IS NULL OR j.entry_date >= p_from_date)
    AND (p_to_date IS NULL OR j.entry_date <= p_to_date)
    AND (p_reference_type IS NULL OR j.reference_type = p_reference_type)
    AND (p_search IS NULL OR j.entry_number ILIKE '%' || p_search || '%'
                            OR j.reference_number ILIKE '%' || p_search || '%')
  GROUP BY j.id
) e;
$function$;

COMMENT ON FUNCTION public.get_journals(uuid, date, date, text, text) IS 'قائمة قيود اليومية مع الأرقام والمراجع';

-- ---------------------------------------------------------------------
-- 5. Journal detail: one entry with its lines (for the entry screen)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_journal_entry(p_journal_entry_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE AS $function$
SELECT jsonb_build_object(
  'entry', jsonb_build_object(
    'id', j.id, 'entry_number', j.entry_number, 'entry_date', j.entry_date,
    'reference_type', j.reference_type, 'reference_id', j.reference_id,
    'reference_number', j.reference_number, 'description', j.description,
    'created_at', j.created_at, 'created_by', j.created_by
  ),
  'lines', (SELECT COALESCE(jsonb_agg(line ORDER BY line.id), '[]'::jsonb)
            FROM (
              SELECT l.id, a.id AS account_id, a.code, a.name AS account_name,
                     a.account_type, round(l.debit, 2) AS debit, round(l.credit, 2) AS credit,
                     l.note, l.customer_id, l.supplier_id
              FROM public.journal_entry_lines l
              JOIN public.chart_of_accounts a ON a.id = l.account_id
              WHERE l.journal_entry_id = j.id
            ) line)
)
FROM public.journal_entries j
WHERE j.id = p_journal_entry_id;
$function$;

COMMENT ON FUNCTION public.get_journal_entry(uuid) IS 'تفاصيل قيد يومية واحد مع أطرافه';

-- ==========================================
-- 025_d7_trial_balance.sql
-- ==========================================
-- =====================================================================
-- Phase D7: Trial balance hardening + balance sheet fix
-- =====================================================================
-- Two fixes to the Phase C report functions:
--   1. get_trial_balance / get_balance_sheet joined journal_entry_lines
--      to journal_entries with the branch/date filter inside the LEFT JOIN
--      condition. Lines belonging to other branches' entries were therefore
--      still summed (the join produced a NULL journal but kept the line).
--      Both are rewritten to filter lines through their entries first.
--   2. get_trial_balance keeps its existing array shape (used by the
--      frontend) and a new get_trial_balance_summary adds totals and a
--      balanced flag.
-- All functions stay read-only, STABLE, SECURITY DEFINER.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Trial balance (array shape preserved; branch filter hardened)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_trial_balance(p_branch_id uuid, p_to_date date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE AS $function$
SELECT COALESCE(jsonb_agg(row ORDER BY row.code), '[]'::jsonb)
FROM (
  SELECT a.code, a.name, a.name_en, a.account_type,
         round(COALESCE(SUM(l.debit), 0), 2) AS debit,
         round(COALESCE(SUM(l.credit), 0), 2) AS credit,
         round(COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0), 2) AS balance
  FROM public.chart_of_accounts a
  LEFT JOIN (
    SELECT l.account_id, l.debit, l.credit
    FROM public.journal_entry_lines l
    JOIN public.journal_entries j ON j.id = l.journal_entry_id
    WHERE j.branch_id = p_branch_id AND j.entry_date <= p_to_date
  ) l ON l.account_id = a.id
  WHERE a.branch_id = p_branch_id AND a.is_active
  GROUP BY a.code, a.name, a.name_en, a.account_type
  HAVING COALESCE(SUM(l.debit), 0) <> 0 OR COALESCE(SUM(l.credit), 0) <> 0
) row;
$function$;

COMMENT ON FUNCTION public.get_trial_balance(uuid, date) IS 'ميزان المراجعة (كل حساب مع إجمالي مدين/دائن والرصيد)';

-- ---------------------------------------------------------------------
-- 2. Trial balance summary: totals + balanced flag
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_trial_balance_summary(p_branch_id uuid, p_to_date date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE AS $function$
WITH rows AS (
  SELECT COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
  FROM public.chart_of_accounts a
  LEFT JOIN (
    SELECT l.account_id, l.debit, l.credit
    FROM public.journal_entry_lines l
    JOIN public.journal_entries j ON j.id = l.journal_entry_id
    WHERE j.branch_id = p_branch_id AND j.entry_date <= p_to_date
  ) l ON l.account_id = a.id
  WHERE a.branch_id = p_branch_id AND a.is_active
    AND (COALESCE(l.debit, 0) <> 0 OR COALESCE(l.credit, 0) <> 0)
)
SELECT jsonb_build_object(
  'to_date', p_to_date,
  'total_debit', round(COALESCE((SELECT SUM(debit) FROM rows), 0), 2),
  'total_credit', round(COALESCE((SELECT SUM(credit) FROM rows), 0), 2),
  'balanced', round(COALESCE((SELECT SUM(debit) FROM rows), 0), 2)
              = round(COALESCE((SELECT SUM(credit) FROM rows), 0), 2)
);
$function$;

COMMENT ON FUNCTION public.get_trial_balance_summary(uuid, date) IS 'ملخص ميزان المراجعة (إجماليات وعلامة التوازن)';

-- ---------------------------------------------------------------------
-- 3. Balance sheet (branch filter hardened)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_balance_sheet(p_branch_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE AS $function$
WITH bal AS (
  SELECT a.account_type, a.code,
         COALESCE(SUM(l.debit), 0) AS debit,
         COALESCE(SUM(l.credit), 0) AS credit
  FROM public.chart_of_accounts a
  LEFT JOIN (
    SELECT l.account_id, l.debit, l.credit
    FROM public.journal_entry_lines l
    JOIN public.journal_entries j ON j.id = l.journal_entry_id
    WHERE j.branch_id = p_branch_id AND j.entry_date <= p_as_of
  ) l ON l.account_id = a.id
  WHERE a.branch_id = p_branch_id AND a.is_active
  GROUP BY a.account_type, a.code
), summary AS (
  SELECT
    round(COALESCE(SUM(CASE WHEN account_type = 'asset' THEN debit - credit ELSE 0 END), 0), 2) AS assets,
    round(COALESCE(SUM(CASE WHEN account_type = 'liability' THEN credit - debit ELSE 0 END), 0), 2) AS liabilities,
    round(COALESCE(SUM(CASE WHEN code = '3000' THEN credit - debit ELSE 0 END), 0), 2) AS capital,
    round(COALESCE(SUM(CASE WHEN code = '3100' THEN credit - debit ELSE 0 END), 0), 2) AS retained,
    round(COALESCE(SUM(CASE WHEN account_type = 'income' THEN credit - debit ELSE 0 END), 0)
         - COALESCE(SUM(CASE WHEN account_type = 'expense' THEN debit - credit ELSE 0 END), 0), 2) AS net_income
  FROM bal
)
SELECT jsonb_build_object(
  'assets', assets,
  'liabilities', liabilities,
  'capital', capital,
  'retained', retained,
  'net_income', net_income,
  'equity', round(capital + retained + net_income, 2),
  'balanced', round(assets - (liabilities + capital + retained + net_income), 2) = 0
)
FROM summary;
$function$;

COMMENT ON FUNCTION public.get_balance_sheet(uuid, date) IS 'الميزانية العمومية في تاريخ محدد';

-- ==========================================
-- 026_d8_audit.sql
-- ==========================================
-- =====================================================================
-- Phase D8: Audit trail + manual journal entry
-- =====================================================================
-- Accounting audit trail on top of the existing branch-scoped audit_log:
--   1. log_audit_action     -> generic, secure insert into audit_log
--   2. _post_journal_entry  -> now also records a 'journal_post' entry for
--                              every posted journal (one hook, all postings)
--   3. post_manual_journal  -> manual/adjustment entries (accountant+) that
--                              go through _post_journal_entry and are audited
--   4. get_audit_trail      -> filterable read of the accounting trail
-- No RLS is weakened; audit writes happen inside SECURITY DEFINER RPCs that
-- already enforce role/branch authorization.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. log_audit_action helper
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_audit_action(
  p_branch_id uuid,
  p_action text,
  p_entity text DEFAULT NULL,
  p_entity_id uuid DEFAULT NULL,
  p_details jsonb DEFAULT NULL
) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.audit_log (user_id, user_email, branch_id, action, entity, entity_id, details)
  VALUES (
    auth.uid(),
    (SELECT email FROM public.users WHERE id = auth.uid()),
    p_branch_id,
    p_action, p_entity, p_entity_id, p_details
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

-- ---------------------------------------------------------------------
-- 2. _post_journal_entry: same behaviour + audit record on new postings
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._post_journal_entry(
  p_branch_id uuid,
  p_reference_type text,
  p_reference_id uuid,
  p_reference_number text,
  p_description text,
  p_lines jsonb
) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_entry_id uuid;
  v_entry_no text;
  v_line jsonb;
  v_account uuid;
  v_debit numeric(14,2);
  v_credit numeric(14,2);
  v_total_debit numeric(14,2) := 0;
  v_total_credit numeric(14,2) := 0;
BEGIN
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'JOURNAL_EMPTY_LINES';
  END IF;

  -- Idempotency: never post a second entry for the same reference.
  IF p_reference_id IS NOT NULL THEN
    SELECT id INTO v_entry_id
    FROM public.journal_entries
    WHERE reference_type = p_reference_type AND reference_id = p_reference_id;
    IF v_entry_id IS NOT NULL THEN
      RETURN v_entry_id;
    END IF;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_total_debit := v_total_debit + COALESCE((v_line->>'debit')::numeric, 0);
    v_total_credit := v_total_credit + COALESCE((v_line->>'credit')::numeric, 0);
  END LOOP;

  IF round(v_total_debit, 2) <> round(v_total_credit, 2) THEN
    RAISE EXCEPTION 'JOURNAL_UNBALANCED: debit % <> credit %',
      round(v_total_debit, 2), round(v_total_credit, 2);
  END IF;

  v_entry_no := (public.next_document_number('journal')->>'number')::text;

  INSERT INTO public.journal_entries
    (entry_number, branch_id, entry_date, reference_type, reference_id, reference_number, description, created_by)
  VALUES (v_entry_no, p_branch_id, CURRENT_DATE, p_reference_type, p_reference_id,
          p_reference_number, p_description, auth.uid())
  RETURNING id INTO v_entry_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_debit := COALESCE((v_line->>'debit')::numeric, 0);
    v_credit := COALESCE((v_line->>'credit')::numeric, 0);
    IF v_debit <= 0 AND v_credit <= 0 THEN CONTINUE; END IF;

    IF v_line ? 'account_key' THEN
      v_account := public.resolve_account_key(p_branch_id, v_line->>'account_key', v_line->>'account_code');
    ELSE
      SELECT id INTO v_account
      FROM public.chart_of_accounts
      WHERE branch_id = p_branch_id AND code = upper(btrim((v_line->>'account_code')::text));
    END IF;
    IF v_account IS NULL THEN
      RAISE EXCEPTION 'ACCOUNT_NOT_FOUND: %', COALESCE(v_line->>'account_key', v_line->>'account_code');
    END IF;

    INSERT INTO public.journal_entry_lines
      (journal_entry_id, account_id, debit, credit, customer_id, supplier_id, note)
    VALUES (v_entry_id, v_account, v_debit, v_credit,
            (v_line->>'customer_id')::uuid, (v_line->>'supplier_id')::uuid, v_line->>'note');
  END LOOP;

  PERFORM public.log_audit_action(p_branch_id, 'journal_post', 'journal_entry', v_entry_id,
    jsonb_build_object('entry_number', v_entry_no, 'reference_type', p_reference_type,
                       'reference_number', p_reference_number,
                       'debit_total', round(v_total_debit, 2), 'credit_total', round(v_total_credit, 2)));

  RETURN v_entry_id;
END;
$function$;

-- ---------------------------------------------------------------------
-- 3. post_manual_journal: accountant + manual adjustment entries
--    p_lines = [{"account_key"|"account_code", "debit", "credit",
--                 "note", "customer_id", "supplier_id"}]
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_manual_journal(
  p_branch_id uuid,
  p_description text,
  p_lines jsonb
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user_branch uuid;
  v_entry_id uuid;
  v_line jsonb;
  v_debit numeric(14,2) := 0;
  v_credit numeric(14,2) := 0;
BEGIN
  BEGIN
    IF p_branch_id IS NULL OR p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_INPUT',
        'detail', 'Branch and at least one line are required.');
    END IF;

    IF NOT is_pos_admin() AND get_user_role() NOT IN ('accountant', 'branch_manager') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
        'detail', 'Manual journal entries require the accountant or branch manager role.');
    END IF;

    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND p_branch_id <> v_user_branch THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
      v_debit := v_debit + COALESCE((v_line->>'debit')::numeric, 0);
      v_credit := v_credit + COALESCE((v_line->>'credit')::numeric, 0);
    END LOOP;
    IF round(v_debit, 2) <> round(v_credit, 2) THEN
      RETURN jsonb_build_object('success', false, 'error', 'JOURNAL_UNBALANCED',
        'debit', round(v_debit, 2), 'credit', round(v_credit, 2));
    END IF;

    -- Manual entries are distinct actions: a fresh reference id per posting.
    v_entry_id := public._post_journal_entry(p_branch_id, 'manual', gen_random_uuid(), NULL,
      p_description, p_lines);

    PERFORM public.log_audit_action(p_branch_id, 'manual_journal', 'journal_entry', v_entry_id,
      jsonb_build_object('description', p_description, 'lines', p_lines));

    RETURN jsonb_build_object('success', true, 'entry_id', v_entry_id,
      'entry_number', (SELECT entry_number FROM public.journal_entries WHERE id = v_entry_id));
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------
-- 4. get_audit_trail: filterable audit reads for the branch
-- ---------------------------------------------------------------------
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
    AND (p_action IS NULL OR a.action = p_action)
    AND (p_entity IS NULL OR a.entity = p_entity)
    AND (p_from_date IS NULL OR a.created_at::date >= p_from_date)
    AND (p_to_date IS NULL OR a.created_at::date <= p_to_date)
  ORDER BY a.created_at DESC
  LIMIT p_limit
) row;
$function$;

COMMENT ON FUNCTION public.log_audit_action(uuid, text, text, uuid, jsonb) IS 'تسجيل حدث في سجل التدقيق';
COMMENT ON FUNCTION public.get_audit_trail(uuid, text, text, date, date, integer) IS 'قراءة سجل التدقيق مع الفلاتر';

-- ==========================================
-- 027_d9_reporting.sql
-- ==========================================
-- =====================================================================
-- Phase D9: Report queries + schema hardening
-- =====================================================================
-- 1. Missing report indexes (all idempotent CREATE INDEX IF NOT EXISTS)
-- 2. get_cash_flow      -> treasury inflow / outflow / net per account
-- 3. get_party_statement-> chronological AR / AP statement per party with
--                          opening balance and running balance
-- No RLS changes; the new functions are read-only STABLE helpers.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Indexes used by the aging / statement / ledger report queries
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_purchases_branch_created ON public.purchases (branch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON public.sales (customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_branch_created ON public.sales (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_payments_branch ON public.customer_payments (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_branch ON public.supplier_payments (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bank_reconciliations_branch ON public.bank_reconciliations (branch_id, status);
CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_recon ON public.bank_statement_lines (reconciliation_id);
CREATE INDEX IF NOT EXISTS idx_expenses_branch_date ON public.expenses (branch_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_journal_lines_party ON public.journal_entry_lines (customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_journal_lines_supplier ON public.journal_entry_lines (supplier_id, created_at);

-- ---------------------------------------------------------------------
-- 2. Cash flow: treasury movements per account for a period
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_cash_flow(
  p_branch_id uuid,
  p_from_date date,
  p_to_date date DEFAULT CURRENT_DATE
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE AS $function$
SELECT COALESCE(jsonb_agg(row ORDER BY row.account_name), '[]'::jsonb)
FROM (
  SELECT t.id AS treasury_account_id, t.account_name, t.account_type, a.code,
         round(COALESCE(SUM(CASE WHEN tx.to_account_id = t.id THEN tx.amount ELSE 0 END), 0), 2) AS inflow,
         round(COALESCE(SUM(CASE WHEN tx.from_account_id = t.id THEN tx.amount ELSE 0 END), 0), 2) AS outflow,
         round(COALESCE(SUM(CASE WHEN tx.to_account_id = t.id THEN tx.amount ELSE -tx.amount END), 0), 2) AS net
  FROM public.treasury_accounts t
  JOIN public.chart_of_accounts a ON a.id = t.account_id
  LEFT JOIN public.treasury_transactions tx
    ON (tx.to_account_id = t.id OR tx.from_account_id = t.id)
   AND tx.branch_id = p_branch_id
   AND tx.created_at::date >= p_from_date AND tx.created_at::date <= p_to_date
  WHERE t.branch_id = p_branch_id AND t.is_active
  GROUP BY t.id, t.account_name, t.account_type, a.code
  HAVING COALESCE(SUM(CASE WHEN tx.to_account_id = t.id THEN tx.amount ELSE -tx.amount END), 0) <> 0
) row;
$function$;

COMMENT ON FUNCTION public.get_cash_flow(uuid, date, date) IS 'التدفقات النقدية (داخل/خارج/صافي) لكل حساب خزينة';

-- ---------------------------------------------------------------------
-- 3. Party statement: chronological AR ('ar') / AP ('ap') movements with
--    opening balance and running balance from the posted ledger
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_party_statement(
  p_branch_id uuid,
  p_side text,
  p_party_id uuid,
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE AS $function$
WITH lines AS (
  SELECT jl.id AS line_id, jl.debit, jl.credit, j.entry_date, j.entry_number,
         j.reference_type, j.reference_number, j.description
  FROM public.journal_entry_lines jl
  JOIN public.journal_entries j ON j.id = jl.journal_entry_id
  WHERE j.branch_id = p_branch_id
    AND (CASE WHEN p_side = 'ap' THEN jl.supplier_id ELSE jl.customer_id END) = p_party_id
    AND (p_to_date IS NULL OR j.entry_date <= p_to_date)
), run AS (
  SELECT line_id, entry_date, entry_number, reference_type, reference_number, description,
         round(debit, 2) AS debit, round(credit, 2) AS credit,
         round(SUM(CASE WHEN p_side = 'ap' THEN credit - debit ELSE debit - credit END)
               OVER (ORDER BY entry_date, entry_number, line_id), 2) AS balance
  FROM lines
)
SELECT jsonb_build_object(
  'party_id', p_party_id, 'side', p_side,
  'opening', round(COALESCE((SELECT SUM(CASE WHEN p_side = 'ap' THEN credit - debit ELSE debit - credit END)
                             FROM lines WHERE p_from_date IS NOT NULL AND entry_date < p_from_date), 0), 2),
  'rows', (SELECT COALESCE(jsonb_agg(r ORDER BY r.entry_date, r.entry_number), '[]'::jsonb)
           FROM (SELECT line_id, entry_date, entry_number, reference_type, reference_number,
                        description, debit, credit, balance
                 FROM run WHERE p_from_date IS NULL OR entry_date >= p_from_date) r)
);
$function$;

COMMENT ON FUNCTION public.get_party_statement(uuid, text, uuid, date, date) IS 'كشف حساب عميل/مورد مع الرصيد الافتتاحي والجاري';

-- ==========================================
-- 028_d10_security.sql
-- ==========================================
-- Migration: D10 Security hardening
-- Fixes found in the full system audit:
--   1. Privilege escalation: users UPDATE/INSERT policies let any branch
--      manager (or staff) promote ANY account in their branch to
--      super_admin/owner by editing public.users directly (the UsersPage uses
--      a direct table update, and RLS only scopes to the branch, not the
--      role value). Confirmed live.
--   2. trg_protect_last_admin was defined but never attached to users in the
--      live database, so "the last admin cannot be removed" was NOT enforced.
--   3. document_sequences has RLS disabled -> anon/authenticated could read
--      the counters directly via PostgREST.

-- ================================================================
-- 1. guard_user_role_changes: DB-level guard on public.users
--    Enforces (independent of RLS, since RLS cannot inspect NEW values):
--     - Only active super_admin/owner can create or modify admin accounts.
--     - No user may change their OWN role / branch_id / is_active unless
--       they are an admin.
--     - Branch managers can only create/update staff of their own branch.
-- ================================================================
CREATE OR REPLACE FUNCTION public.guard_user_role_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_caller_role text;
  v_caller_branch uuid;
BEGIN
  SELECT role, branch_id INTO v_caller_role, v_caller_branch
  FROM public.users WHERE id = auth.uid();

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  -- Only admins may create or modify admin accounts.
  IF NEW.role IN ('super_admin', 'owner') AND v_caller_role NOT IN ('super_admin', 'owner') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: only an admin can assign admin roles';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Only admins may modify existing admin accounts.
    IF OLD.role IN ('super_admin', 'owner') AND v_caller_role NOT IN ('super_admin', 'owner') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: only an admin can modify admin accounts';
    END IF;

    -- No self-demotion / self-deactivation / self-branch-change for non-admins.
    IF NEW.id = auth.uid() AND v_caller_role NOT IN ('super_admin', 'owner') THEN
      IF NEW.role IS DISTINCT FROM OLD.role
         OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
         OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: users cannot change their own role/branch/status';
      END IF;
    END IF;
  END IF;

  -- Branch managers may only manage staff of their own branch.
  IF v_caller_role = 'branch_manager' THEN
    IF NEW.branch_id IS DISTINCT FROM v_caller_branch THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: branch managers can only manage their own branch';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_users_role_guard ON public.users;
CREATE TRIGGER trg_users_role_guard
BEFORE INSERT OR UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.guard_user_role_changes();

-- ================================================================
-- 2. protect_last_admin: fix the live definition (it still checked the
--    legacy role 'admin' instead of 'super_admin'/'owner', so the last-admin
--    protection was a silent no-op) and (re-)attach the trigger, which was
--    missing from the live database entirely.
-- ================================================================
CREATE OR REPLACE FUNCTION public.protect_last_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
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
$function$;

DROP TRIGGER IF EXISTS trg_protect_last_admin ON public.users;
CREATE TRIGGER trg_protect_last_admin
BEFORE UPDATE OR DELETE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.protect_last_admin();

-- ================================================================
-- 3. Lock down document_sequences: RLS on, authenticated read-only.
--    Writes happen exclusively through SECURITY DEFINER RPCs which run as
--    the table owner and bypass RLS, so nothing else is affected.
-- ================================================================
ALTER TABLE public.document_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_sequences_select ON public.document_sequences;
CREATE POLICY document_sequences_select ON public.document_sequences
  FOR SELECT TO authenticated USING (true);

-- Reject any direct write attempt from the client (there is no policy for
-- INSERT/UPDATE/DELETE, and anon gets nothing).
REVOKE INSERT, UPDATE, DELETE ON public.document_sequences FROM anon, authenticated;
GRANT SELECT ON public.document_sequences TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ==========================================
-- 029_d11_report_rls.sql
-- ==========================================
-- Migration: D11 Reporting-RPC security hardening
-- Confirmed live during the full system audit:
--   1. Every public function granted EXECUTE to PUBLIC + anon. Because the
--      reporting functions are SECURITY DEFINER, any caller (including an
--      unauthenticated request using the public anon key, and any user of any
--      branch) could read ANY branch's financial data by passing an arbitrary
--      p_branch_id. Proven live: anon and a BRANCH_B cashier both retrieved
--      BRANCH_A journals / trial balance.
--   2. The read-only reporting functions also bypass RLS, so passing another
--      branch's id leaked that branch's rows regardless of the caller.

-- ================================================================
-- 1. Restrict EXECUTE to authenticated/service_role only.
--    anon keeps exactly one function: get_login_email (the PIN-login flow
--    resolves username -> email before the user authenticates).
-- ================================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.get_login_email(text) TO anon;

-- ================================================================
-- 2. Convert the read-only reporting functions to SECURITY INVOKER.
--    They then run under the caller's grants + RLS, so branch isolation is
--    enforced by the policies themselves regardless of the p_branch_id that
--    the client passes (a user can only ever see their own branch; admins
--    still see everything).
-- ================================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND p.proname IN (
        'get_journals', 'get_journal_entry', 'get_general_ledger',
        'get_income_statement', 'get_balance_sheet', 'get_trial_balance',
        'get_trial_balance_summary', 'get_cash_flow', 'get_aging_summary',
        'get_ar_aging', 'get_ap_aging', 'get_open_invoices',
        'get_party_statement', 'get_treasury_balances',
        'get_bank_reconciliation', 'get_audit_trail'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SECURITY INVOKER', r.sig);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- ==========================================
-- 030_d12_perf_indexes.sql
-- ==========================================
-- Migration: D12 Performance - index coverage
-- Audit finding: several FK / filter columns used by common join and report
-- queries had no index (seq scans as data grows). The only exact-duplicate
-- index (idx_journal_reference, a non-unique copy of uq_journal_reference)
-- is dropped to save write overhead.

DROP INDEX IF EXISTS public.idx_journal_reference;

CREATE INDEX IF NOT EXISTS idx_sale_items_product              ON public.sale_items (product_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_product          ON public.purchase_items (product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_batches_branch        ON public.inventory_batches (branch_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_branch_date           ON public.audit_log (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user                  ON public.audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_matched    ON public.bank_statement_lines (matched_journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_treasury_transactions_from      ON public.treasury_transactions (from_account_id);
CREATE INDEX IF NOT EXISTS idx_treasury_transactions_to        ON public.treasury_transactions (to_account_id);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_product        ON public.inventory_ledger (product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_raw            ON public.inventory_ledger (raw_material_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_transfer_items_product ON public.warehouse_transfer_items (product_id);
CREATE INDEX IF NOT EXISTS idx_production_waste_product        ON public.production_waste (product_id);

