-- PART: 02_pos_features_and_kds.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==========================================
-- 031_process_sale_pricing.sql
-- ==========================================
-- ============================================================================
-- D13. Hardening fix: authoritative pricing in process_sale
-- ----------------------------------------------------------------------------
-- The live D1 version trusted client-supplied unit_price / totals, so a
-- tampered payload could book a sale at any price. This migration replaces
-- process_sale with the SAME live implementation (inventory_batches +
-- _product_inv_remove_fifo + products.branch_id model) but recomputes every
-- money figure server-side:
--
--   * unit_price  <- products.sale_price (authoritative catalog price)
--   * item total  <- qty * unit_price - discount (discount clamped)
--   * header      <- subtotal / discount / tax (from settings) / total recomputed
--   * paid        <- clamped >= 0, AR = total - paid
--
-- The frontend already sends product.sale_price and the same formulas, so
-- honest clients see identical numbers; only forged prices are rejected.
-- Additive-only: CREATE OR REPLACE FUNCTION, no data/DDL destructive changes.
-- ============================================================================

-- The inventory_v2-era overload (without p_shift_id) is superseded: the
-- frontend always passes p_shift_id and no code calls the old signature.
-- Keeping it would make every 15-argument call ambiguous, so it is dropped.
DROP FUNCTION IF EXISTS public.process_sale(text, uuid, uuid, uuid, uuid, numeric, numeric, text, numeric, numeric, numeric, numeric, text, text, jsonb);

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
  v_subtotal numeric(14,2) := 0;
  v_discount numeric(14,2);
  v_tax numeric(14,2) := 0;
  v_tax_enabled boolean;
  v_tax_rate numeric(14,2);
  v_total numeric(14,2);
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

      -- Accumulate the authoritative subtotal (catalog price, clamped discount)
      SELECT COALESCE(sale_price, 0) INTO v_unit_price FROM products WHERE id = v_product_id;
      v_discount_amount := GREATEST(COALESCE((v_item->>'discount_amount')::numeric, 0), 0);
      IF v_discount_amount > v_quantity * v_unit_price THEN
        v_discount_amount := v_quantity * v_unit_price;
      END IF;
      v_subtotal := v_subtotal + ROUND(v_quantity * v_unit_price - v_discount_amount, 2);
    END LOOP;

    -- ===== SERVER-SIDE HEADER TOTALS (computed from authoritative prices) =====
    v_discount := GREATEST(COALESCE(p_discount_amount, 0), 0);
    IF v_discount > v_subtotal THEN v_discount := v_subtotal; END IF;
    SELECT COALESCE(tax_enabled, false), COALESCE(tax_rate, 0) INTO v_tax_enabled, v_tax_rate
    FROM public.settings LIMIT 1;
    IF v_tax_enabled THEN
      v_tax := ROUND((v_subtotal - v_discount) * v_tax_rate / 100, 2);
    END IF;
    v_total := ROUND(v_subtotal - v_discount + v_tax, 2);
    v_paid := ROUND(GREATEST(COALESCE(p_paid_amount, 0), 0), 2);
    v_ar := ROUND(GREATEST(v_total - v_paid, 0), 2);

    -- ===== WRITE PHASE 1: sale header (authoritative totals) =====
    INSERT INTO sales (invoice_number, branch_id, warehouse_id, customer_id, cashier_id, salesperson_id,
      subtotal, discount_amount, discount_type, tax_amount, bonus_amount, total, paid_amount, payment_method, status)
    VALUES (p_invoice_number, p_branch_id, p_warehouse_id, p_customer_id, auth.uid(), p_salesperson_id,
      v_subtotal, v_discount, p_discount_type, v_tax, COALESCE(p_bonus_amount, 0),
      v_total, v_paid, p_payment_method, p_status)
    RETURNING id INTO v_sale_id;

    -- ===== WRITE PHASE 2: items + FIFO stock deduction + ledger =====
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
      v_discount_amount := GREATEST(COALESCE((v_item->>'discount_amount')::numeric, 0), 0);

      SELECT sale_price INTO v_unit_price FROM products WHERE id = v_product_id;
      v_unit_price := COALESCE(v_unit_price, 0);
      IF v_discount_amount > v_quantity * v_unit_price THEN
        v_discount_amount := v_quantity * v_unit_price;
      END IF;
      v_bonus_quantity := COALESCE((v_item->>'bonus_quantity')::numeric, 0);
      v_item_total := ROUND(v_quantity * v_unit_price - v_discount_amount, 2);

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
      VALUES (v_shift_id, 'sale', v_paid, p_payment_method, 'sale', v_sale_id, auth.uid());
    END IF;

    -- ===== WRITE PHASE 4: post the sales + COGS journal entry =====
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
    IF v_discount > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'discount_given', 'debit', v_discount, 'credit', 0);
      v_dr := v_dr + v_discount;
    END IF;
    IF v_subtotal > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'revenue', 'debit', 0, 'credit', v_subtotal);
      v_cr := v_cr + v_subtotal;
    END IF;
    IF v_tax > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'vat_payable', 'debit', 0, 'credit', v_tax);
      v_cr := v_cr + v_tax;
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

-- ==========================================
-- 032_db_grants.sql
-- ==========================================
-- ============================================================================
-- 032. Table/sequence privileges for authenticated + service_role
-- ----------------------------------------------------------------------------
-- A real Supabase project grants its API roles access to every table in the
-- `public` schema (via ALTER DEFAULT PRIVILEGES set up at project creation).
-- A plain-Postgres fresh build does not: the canonical migrations create the
-- tables but `authenticated` had no privileges, so RLS could never be
-- exercised (permission denied fires before any policy). This file closes
-- that gap so the fresh build behaves exactly like live Supabase.
--
-- RLS stays the security boundary: `authenticated` receives DML privileges but
-- every table's policies still filter rows by branch/role.
--
-- Additive + idempotent. Safe on live (the grants already exist there).
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Object privileges for tables created by the canonical migrations in the future.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated, service_role;

-- 028_d10_security deliberately restricts document_sequences to SELECT-only;
-- preserve that intent (the bulk grant above re-opens it otherwise).
REVOKE INSERT, UPDATE, DELETE ON public.document_sequences FROM authenticated;

-- ==========================================
-- 033_perf_indexes.sql
-- ==========================================
-- ============================================================
-- 033_perf_indexes.sql
-- Phase 1 audit: FK columns used on hot query paths that lack a
-- leading index. Additive only — all CREATE INDEX IF NOT EXISTS.
-- (Skipped low-value audit flags such as *_created_by lookups.)
-- ============================================================

-- Catalog / BOM lookups
CREATE INDEX IF NOT EXISTS idx_product_components_component ON public.product_components (component_product_id);
CREATE INDEX IF NOT EXISTS idx_product_units_product        ON public.product_units (product_id);

-- Recipes / production
CREATE INDEX IF NOT EXISTS idx_recipe_items_recipe          ON public.recipe_items (recipe_id);
CREATE INDEX IF NOT EXISTS idx_recipe_items_raw             ON public.recipe_items (raw_material_id);
CREATE INDEX IF NOT EXISTS idx_production_waste_order       ON public.production_waste (order_id);
CREATE INDEX IF NOT EXISTS idx_production_orders_branch     ON public.production_orders (branch_id);

-- Warehouses / transfers
CREATE INDEX IF NOT EXISTS idx_inventory_batches_warehouse  ON public.inventory_batches (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_transactions_warehouse ON public.stock_transactions (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_transfer_items_tx  ON public.warehouse_transfer_items (transfer_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_transfers_from     ON public.warehouse_transfers (from_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_transfers_to       ON public.warehouse_transfers (to_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_transfers_branch   ON public.warehouse_transfers (branch_id);

-- Sales / purchases filters
CREATE INDEX IF NOT EXISTS idx_sales_cashier                ON public.sales (cashier_id);
CREATE INDEX IF NOT EXISTS idx_sales_salesperson            ON public.sales (salesperson_id);
CREATE INDEX IF NOT EXISTS idx_sales_warehouse              ON public.sales (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_purchases_warehouse          ON public.purchases (warehouse_id);

-- Accounting joins
CREATE INDEX IF NOT EXISTS idx_account_mappings_account     ON public.account_mappings (account_id);
CREATE INDEX IF NOT EXISTS idx_expenses_account             ON public.expenses (account_id);
CREATE INDEX IF NOT EXISTS idx_treasury_accounts_coa        ON public.treasury_accounts (account_id);

-- ==========================================
-- 034_branch_settings.sql
-- ==========================================
-- ============================================================================
-- 034. Per-branch settings table
-- ----------------------------------------------------------------------------
-- The Settings page overrides the global settings row per branch (NULL column
-- = fall back to the global value). This table previously existed only in the
-- archived legacy migration (supabase/legacy/migration_audit_fixes.sql, never
-- applied on fresh builds), so a canonical fresh build had NO branch_settings
-- table and SettingsContext (supabase.from('branch_settings')) failed at
-- runtime. This restores it in the canonical chain.
--
-- Isolation model (matches the app's permission gate on /settings):
--   * SELECT: admins see every branch; staff see only their own branch.
--   * INSERT/UPDATE/DELETE: admins, or a user holding 'settings.manage' for
--     their OWN branch (can_permission is SECURITY DEFINER + STABLE).
-- Additive + idempotent. Table-level privileges come automatically from the
-- ALTER DEFAULT PRIVILEGES set in 032_db_grants.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.branch_settings (
  branch_id uuid PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
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

ALTER TABLE public.branch_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_branch_settings" ON public.branch_settings;
CREATE POLICY "auth_select_branch_settings" ON public.branch_settings FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());

DROP POLICY IF EXISTS "auth_write_branch_settings" ON public.branch_settings;
CREATE POLICY "auth_write_branch_settings" ON public.branch_settings FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR (can_permission('settings.manage') AND branch_id = get_branch_id()));

DROP POLICY IF EXISTS "auth_write_branch_settings_upd" ON public.branch_settings;
CREATE POLICY "auth_write_branch_settings_upd" ON public.branch_settings FOR UPDATE TO authenticated
  USING (is_pos_admin() OR (can_permission('settings.manage') AND branch_id = get_branch_id()))
  WITH CHECK (is_pos_admin() OR (can_permission('settings.manage') AND branch_id = get_branch_id()));

DROP POLICY IF EXISTS "auth_write_branch_settings_del" ON public.branch_settings;
CREATE POLICY "auth_write_branch_settings_del" ON public.branch_settings FOR DELETE TO authenticated
  USING (is_pos_admin() OR (can_permission('settings.manage') AND branch_id = get_branch_id()));

-- ==========================================
-- 035_settings_rls.sql
-- ==========================================
-- ============================================================================
-- 035. Settings expansion + tighten global settings RLS
-- ----------------------------------------------------------------------------
-- 1) The frontend Settings type reads 13 more columns than the canonical 001
--    table created (brand/pos/invoice/receipt/inventory). Those columns lived
--    only in the archived legacy migration, so a canonical fresh build returned
--    NULL/undefined for pos_default_payment_method, invoice_next_number,
--    receipt_width_mm, low_stock_threshold, etc. and the POS/receipt/invoice
--    features silently misbehaved. Add them (idempotent) here.
--
-- 2) settings RLS from 001 was open for EVERY DML command to ANY authenticated
--    user (USING true / WITH CHECK true), so any cashier could rewrite the
--    global configuration directly through PostgREST. The /settings page is
--    admin-only (settings.manage; only super_admin/owner hold it by default),
--    so writes are locked to admins. SELECT stays open: every page resolves
--    the effective settings at boot.
-- Additive + idempotent.
-- ============================================================================

ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS brand_color text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS pos_default_payment_method text DEFAULT 'cash';
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS pos_barcode_autofocus boolean DEFAULT true;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS pos_line_discount boolean DEFAULT true;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS invoice_prefix text DEFAULT 'INV-';
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS invoice_next_number bigint DEFAULT 1;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS invoice_decimal_places integer DEFAULT 2;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS receipt_width_mm integer DEFAULT 58;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS receipt_copies integer DEFAULT 1;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS receipt_auto_print boolean DEFAULT true;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS receipt_show_tax boolean DEFAULT true;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS receipt_show_qr boolean DEFAULT true;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS low_stock_threshold numeric(12,2) DEFAULT 5;

DROP POLICY IF EXISTS "auth_insert_settings" ON public.settings;
CREATE POLICY "auth_insert_settings" ON public.settings FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin());

DROP POLICY IF EXISTS "auth_update_settings" ON public.settings;
CREATE POLICY "auth_update_settings" ON public.settings FOR UPDATE TO authenticated
  USING (is_pos_admin()) WITH CHECK (is_pos_admin());

DROP POLICY IF EXISTS "auth_delete_settings" ON public.settings;
CREATE POLICY "auth_delete_settings" ON public.settings FOR DELETE TO authenticated
  USING (is_pos_admin());

-- ==========================================
-- 036_floorplan_orders.sql
-- ==========================================
-- ============================================================================
-- 036. Restaurant floor plan + open orders (Phase 3 foundation)
-- ----------------------------------------------------------------------------
-- Adds the dine-in foundation on top of the completed-sale model:
--   * dining_areas   - floor zones per branch (Terrace, Hall, Second floor...)
--   * dining_tables  - tables in an area with layout {x,y,w,h} + status
--                      (vacant | occupied | reserved | closed)
--   * orders         - open/held in-progress orders (hold/recall carts) with
--                      an order_type (dine_in | takeaway | delivery | drive_thru)
--   * order_items    - lines of an open order (child of orders)
--   * sales          - gains order_type + table_id so completed sales report
--                      the service channel and origin table
--
-- Isolation model (consistent with the branch matrix):
--   * dining_areas:  SELECT admin-or-own-branch; writes admin-only (config).
--   * dining_tables: full (admin-or-own-branch for every command) because the
--                    POS needs to flip status (occupied/vacant) at runtime.
--   * orders:        full (admin-or-own-branch).
--   * order_items:   child rows isolate through their parent order.
-- Table privileges come automatically from 032 ALTER DEFAULT PRIVILEGES.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.dining_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dining_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  area_id uuid REFERENCES public.dining_areas(id) ON DELETE SET NULL,
  name text NOT NULL,
  capacity integer NOT NULL DEFAULT 4,
  status text NOT NULL DEFAULT 'vacant',
  shape text NOT NULL DEFAULT 'rect',
  layout jsonb NOT NULL DEFAULT '{"x":0,"y":0,"w":120,"h":80}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  order_type text NOT NULL DEFAULT 'dine_in',
  status text NOT NULL DEFAULT 'open',
  table_id uuid REFERENCES public.dining_tables(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  cashier_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  guest_count integer,
  notes text,
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  discount_type text NOT NULL DEFAULT 'amount',
  tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  unit_name text NOT NULL DEFAULT 'piece',
  quantity numeric(14,4) NOT NULL DEFAULT 1,
  unit_price numeric(12,2) NOT NULL DEFAULT 0,
  discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  bonus_quantity numeric(14,4) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Completed sales record their service channel + origin table.
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS order_type text NOT NULL DEFAULT 'takeaway';
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS table_id uuid REFERENCES public.dining_tables(id) ON DELETE SET NULL;

-- ===== Indexes =====
CREATE INDEX IF NOT EXISTS idx_dining_areas_branch ON public.dining_areas (branch_id);
CREATE INDEX IF NOT EXISTS idx_dining_tables_branch ON public.dining_tables (branch_id);
CREATE INDEX IF NOT EXISTS idx_dining_tables_area ON public.dining_tables (area_id);
CREATE INDEX IF NOT EXISTS idx_dining_tables_status ON public.dining_tables (status);
CREATE INDEX IF NOT EXISTS idx_orders_branch_status ON public.orders (branch_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_table ON public.orders (table_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_sales_order_type ON public.sales (order_type);

-- ===== RLS =====
ALTER TABLE public.dining_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dining_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

-- dining_areas: SELECT admin-or-own-branch; writes admin-only.
DROP POLICY IF EXISTS "auth_select_dining_areas" ON public.dining_areas;
CREATE POLICY "auth_select_dining_areas" ON public.dining_areas FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_write_dining_areas" ON public.dining_areas;
CREATE POLICY "auth_write_dining_areas" ON public.dining_areas FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin());
DROP POLICY IF EXISTS "auth_write_dining_areas_upd" ON public.dining_areas;
CREATE POLICY "auth_write_dining_areas_upd" ON public.dining_areas FOR UPDATE TO authenticated
  USING (is_pos_admin()) WITH CHECK (is_pos_admin());
DROP POLICY IF EXISTS "auth_write_dining_areas_del" ON public.dining_areas;
CREATE POLICY "auth_write_dining_areas_del" ON public.dining_areas FOR DELETE TO authenticated
  USING (is_pos_admin());

-- dining_tables: full (admin-or-own-branch for every command).
DROP POLICY IF EXISTS "auth_select_dining_tables" ON public.dining_tables;
CREATE POLICY "auth_select_dining_tables" ON public.dining_tables FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_write_dining_tables" ON public.dining_tables;
CREATE POLICY "auth_write_dining_tables" ON public.dining_tables FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_write_dining_tables_upd" ON public.dining_tables;
CREATE POLICY "auth_write_dining_tables_upd" ON public.dining_tables FOR UPDATE TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id())
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_write_dining_tables_del" ON public.dining_tables;
CREATE POLICY "auth_write_dining_tables_del" ON public.dining_tables FOR DELETE TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());

-- orders: full (admin-or-own-branch for every command).
DROP POLICY IF EXISTS "auth_select_orders" ON public.orders;
CREATE POLICY "auth_select_orders" ON public.orders FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_write_orders" ON public.orders;
CREATE POLICY "auth_write_orders" ON public.orders FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_write_orders_upd" ON public.orders;
CREATE POLICY "auth_write_orders_upd" ON public.orders FOR UPDATE TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id())
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_write_orders_del" ON public.orders;
CREATE POLICY "auth_write_orders_del" ON public.orders FOR DELETE TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());

-- order_items: child rows isolate through the parent order.
DROP POLICY IF EXISTS "auth_select_order_items" ON public.order_items;
CREATE POLICY "auth_select_order_items" ON public.order_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_id AND (is_pos_admin() OR o.branch_id = get_branch_id())
  ));
DROP POLICY IF EXISTS "auth_write_order_items" ON public.order_items;
CREATE POLICY "auth_write_order_items" ON public.order_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_id AND (is_pos_admin() OR o.branch_id = get_branch_id())
  ));
DROP POLICY IF EXISTS "auth_write_order_items_upd" ON public.order_items;
CREATE POLICY "auth_write_order_items_upd" ON public.order_items FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_id AND (is_pos_admin() OR o.branch_id = get_branch_id())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_id AND (is_pos_admin() OR o.branch_id = get_branch_id())
  ));
DROP POLICY IF EXISTS "auth_write_order_items_del" ON public.order_items;
CREATE POLICY "auth_write_order_items_del" ON public.order_items FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_id AND (is_pos_admin() OR o.branch_id = get_branch_id())
  ));

-- ==========================================
-- 037_floorplan_rpc.sql
-- ==========================================
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

-- ==========================================
-- 038_process_sale_order_fields.sql
-- ==========================================
-- ============================================================================
-- 038. process_sale: order channel + table + linked order
-- ----------------------------------------------------------------------------
-- Extends the authoritative process_sale (031) with three trailing arguments:
--   * p_order_type text  DEFAULT 'takeaway'  - dine_in | takeaway | delivery | drive_thru
--   * p_table_id uuid    DEFAULT NULL        - origin table for dine-in
--   * p_order_id uuid    DEFAULT NULL        - an open/held order being paid
-- The order channel + table are stored on the completed sale; a linked order is
-- marked completed and its table freed. Server-side pricing is unchanged.
-- The old 16-argument signature is dropped (the frontend is the only caller and
-- always goes through the API wrapper); trailing defaults keep the pricing
-- integration test's 16-argument call working.
-- ============================================================================

DROP FUNCTION IF EXISTS public.process_sale(text, uuid, uuid, uuid, uuid, numeric, numeric, text, numeric, numeric, numeric, numeric, text, text, jsonb, uuid);

CREATE OR REPLACE FUNCTION public.process_sale(p_invoice_number text, p_branch_id uuid, p_warehouse_id uuid, p_customer_id uuid, p_salesperson_id uuid, p_subtotal numeric, p_discount_amount numeric, p_discount_type text, p_tax_amount numeric, p_bonus_amount numeric, p_total numeric, p_paid_amount numeric, p_payment_method text, p_status text, p_items jsonb, p_shift_id uuid DEFAULT NULL::uuid, p_order_type text DEFAULT 'takeaway', p_table_id uuid DEFAULT NULL::uuid, p_order_id uuid DEFAULT NULL::uuid)
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
  v_subtotal numeric(14,2) := 0;
  v_discount numeric(14,2);
  v_tax numeric(14,2) := 0;
  v_tax_enabled boolean;
  v_tax_rate numeric(14,2);
  v_total numeric(14,2);
  v_paid numeric(14,2);
  v_ar numeric(14,2);
  v_lines jsonb := '[]'::jsonb;
  v_dr numeric(14,2) := 0;
  v_cr numeric(14,2) := 0;
  v_diff numeric(14,2);
  v_balance_account text;
  v_order_table uuid;
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

    -- Origin table must belong to the sale branch
    IF p_table_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.dining_tables WHERE id = p_table_id AND branch_id = p_branch_id
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'TABLE_NOT_IN_BRANCH', 'table_id', p_table_id);
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

      -- Accumulate the authoritative subtotal (catalog price, clamped discount)
      SELECT COALESCE(sale_price, 0) INTO v_unit_price FROM products WHERE id = v_product_id;
      v_discount_amount := GREATEST(COALESCE((v_item->>'discount_amount')::numeric, 0), 0);
      IF v_discount_amount > v_quantity * v_unit_price THEN
        v_discount_amount := v_quantity * v_unit_price;
      END IF;
      v_subtotal := v_subtotal + ROUND(v_quantity * v_unit_price - v_discount_amount, 2);
    END LOOP;

    -- ===== SERVER-SIDE HEADER TOTALS (computed from authoritative prices) =====
    v_discount := GREATEST(COALESCE(p_discount_amount, 0), 0);
    IF v_discount > v_subtotal THEN v_discount := v_subtotal; END IF;
    SELECT COALESCE(tax_enabled, false), COALESCE(tax_rate, 0) INTO v_tax_enabled, v_tax_rate
    FROM public.settings LIMIT 1;
    IF v_tax_enabled THEN
      v_tax := ROUND((v_subtotal - v_discount) * v_tax_rate / 100, 2);
    END IF;
    v_total := ROUND(v_subtotal - v_discount + v_tax, 2);
    v_paid := ROUND(GREATEST(COALESCE(p_paid_amount, 0), 0), 2);
    v_ar := ROUND(GREATEST(v_total - v_paid, 0), 2);

    -- ===== WRITE PHASE 1: sale header (authoritative totals) =====
    INSERT INTO sales (invoice_number, branch_id, warehouse_id, customer_id, cashier_id, salesperson_id,
      subtotal, discount_amount, discount_type, tax_amount, bonus_amount, total, paid_amount, payment_method, status, order_type, table_id)
    VALUES (p_invoice_number, p_branch_id, p_warehouse_id, p_customer_id, auth.uid(), p_salesperson_id,
      v_subtotal, v_discount, p_discount_type, v_tax, COALESCE(p_bonus_amount, 0),
      v_total, v_paid, p_payment_method, p_status, COALESCE(p_order_type, 'takeaway'), p_table_id)
    RETURNING id INTO v_sale_id;

    -- ===== WRITE PHASE 2: items + FIFO stock deduction + ledger =====
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
      v_discount_amount := GREATEST(COALESCE((v_item->>'discount_amount')::numeric, 0), 0);

      SELECT sale_price INTO v_unit_price FROM products WHERE id = v_product_id;
      v_unit_price := COALESCE(v_unit_price, 0);
      IF v_discount_amount > v_quantity * v_unit_price THEN
        v_discount_amount := v_quantity * v_unit_price;
      END IF;
      v_bonus_quantity := COALESCE((v_item->>'bonus_quantity')::numeric, 0);
      v_item_total := ROUND(v_quantity * v_unit_price - v_discount_amount, 2);

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

    -- ===== WRITE PHASE 2b: settle a linked open/held order =====
    IF p_order_id IS NOT NULL THEN
      SELECT table_id INTO v_order_table FROM public.orders WHERE id = p_order_id;
      IF v_order_table IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.orders
        WHERE id = p_order_id AND branch_id = p_branch_id AND status IN ('open', 'held')
      ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
      END IF;
      UPDATE public.orders SET status = 'completed', completed_at = now(), updated_at = now()
      WHERE id = p_order_id;
      UPDATE public.dining_tables SET status = 'vacant', updated_at = now()
      WHERE id = v_order_table;
    END IF;

    -- ===== WRITE PHASE 3: log the sale into the active shift =====
    IF v_shift_id IS NOT NULL THEN
      INSERT INTO shift_operations (shift_id, operation_type, amount, payment_method, reference_type, reference_id, created_by)
      VALUES (v_shift_id, 'sale', v_paid, p_payment_method, 'sale', v_sale_id, auth.uid());
    END IF;

    -- ===== WRITE PHASE 4: post the sales + COGS journal entry =====
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
    IF v_discount > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'discount_given', 'debit', v_discount, 'credit', 0);
      v_dr := v_dr + v_discount;
    END IF;
    IF v_subtotal > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'revenue', 'debit', 0, 'credit', v_subtotal);
      v_cr := v_cr + v_subtotal;
    END IF;
    IF v_tax > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'vat_payable', 'debit', 0, 'credit', v_tax);
      v_cr := v_cr + v_tax;
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

-- ==========================================
-- 039_permissions_floorplan.sql
-- ==========================================
-- ============================================================================
-- 039. Floor-plan permissions
-- ----------------------------------------------------------------------------
-- Grants the floor-plan permissions to the seeded roles (idempotent for the
-- roles that already hold them). Admins bypass via is_pos_admin(); the entries
-- keep the roles matrix consistent for the UI. Non-admin floor-plan layout
-- writes are still branch-gated by the dining_* RLS policies.
-- ============================================================================

UPDATE public.roles
SET permissions = permissions || '["floor_plan.view","floor_plan.manage"]'::jsonb
WHERE role IN ('super_admin', 'owner');

UPDATE public.roles
SET permissions = permissions || '["floor_plan.view"]'::jsonb
WHERE role = 'branch_manager';

-- ==========================================
-- 040_floorplan_permissions_cashier.sql
-- ==========================================
-- ============================================================================
-- 040. Floor-plan permission for cashiers
-- ----------------------------------------------------------------------------
-- Cashiers serve tables, so they need floor_plan.view to open/resume dine-in
-- orders from the floor. Keeps the DB roles matrix consistent with the code
-- defaults. floor_plan.manage stays admin / branch-manager only.
-- ============================================================================

UPDATE public.roles
SET permissions = permissions || '["floor_plan.view"]'::jsonb
WHERE role = 'cashier';

-- ==========================================
-- 041_floorplan_branch_manager_manage.sql
-- ==========================================
-- ============================================================================
-- 041. Floor-plan manage for branch managers
-- ----------------------------------------------------------------------------
-- Branch managers administer the floor plan of their branch (add areas/tables,
-- reposition, set statuses). 039 only granted them floor_plan.view; the code
-- defaults (permissionDefs.ts) and the floor_plan.manage usage inside
-- FloorPlanPage expect manage as well. Keeps the DB roles matrix consistent
-- with the UI defaults. floor_plan.manage stays admin / branch-manager only.
-- ============================================================================

UPDATE public.roles
SET permissions = permissions || '["floor_plan.manage"]'::jsonb
WHERE role = 'branch_manager'
  AND NOT permissions ? 'floor_plan.manage';

-- ==========================================
-- 042_realtime_orders_publication.sql
-- ==========================================
-- ============================================================================
-- 042. Realtime publication for POS live counters
-- ----------------------------------------------------------------------------
-- The POS header strip shows live counters (occupied tables / held / delivery /
-- takeaway). It subscribes via supabase.channel('pos-live-summary') to
-- postgres_changes on orders and dining_tables. Those tables must be members of
-- the supabase_realtime publication, otherwise the browser subscription is
-- rejected. The publication may not exist in some self-hosted / CI setups, so
-- this migration is guarded and idempotent (no-op on Postgres without the
-- supabase_realtime publication).
--
-- NOTE: on hosted Supabase the project owner should also enable realtime for
-- these tables via the dashboard (Database > Replication) or this same SQL; the
-- guard here only makes sure the migration never breaks existing deployments.
-- ============================================================================

DO $$
DECLARE
  pub_exists boolean;
  tbl text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) INTO pub_exists;

  IF pub_exists THEN
    FOREACH tbl IN ARRAY ARRAY['public.orders', 'public.dining_tables'] LOOP
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

-- ==========================================
-- 043_user_role_management.sql
-- ==========================================
-- ============================================================================
-- 043. User & Role Management
-- ----------------------------------------------------------------------------
-- Backing schema for the User & Role Management feature. Additive + idempotent
-- (safe to re-run; the migration runner also gates it by checksum).
--
--   1. roles: `scope` (global/branch) + `branch_id` + descriptions + active
--      flag; branch managers can create/manage roles scoped to their own
--      branch. System/global roles stay admin-managed only.
--   2. users: phone / is_locked / failed_attempts / lock_until / last_login_at;
--      the fixed-role CHECK is dropped so custom roles work. Role validity is
--      enforced by the (updated) role-guard trigger instead.
--   3. guard_user_role_changes: validates assigned roles exist and are
--      assignable in the caller's scope; blocks self-lock tampering; keeps the
--      existing admin/BM safeguards intact.
--   4. login_as_log + login_as_user / return_from_login_as RPCs.
--   5. Login lockout: record_login_failure / record_login_success + a locked
--      check in get_login_email.
--   6. audit_log: ip / device columns.
--   7. Seeds the two legacy role values (kitchen / customer_display) that exist
--      in users but were never in the roles matrix, and appends the new action
--      permissions to the default role matrix.
-- ============================================================================

-- ============ 1. ROLES: SCOPE + BRANCH ============
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'global';
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE;
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS description_ar text;
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS description_en text;
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roles_scope_check') THEN
    ALTER TABLE public.roles ADD CONSTRAINT roles_scope_check CHECK (scope IN ('global', 'branch'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_roles_branch ON public.roles (branch_id);

-- Seed the two legacy role values referenced by users.role that were never in
-- the matrix (kept so the role-guard trigger never rejects existing accounts).
INSERT INTO public.roles (role, name_ar, name_en, permissions, scope) VALUES
  ('kitchen', 'المطبخ', 'Kitchen', '["dashboard.view"]'::jsonb, 'global'),
  ('customer_display', 'شاشة العملاء', 'Customer Display', '[]'::jsonb, 'global')
ON CONFLICT (role) DO NOTHING;

-- ============ 2. ROLES: RLS (admins all; BMs their own branch) ============
DROP POLICY IF EXISTS "auth_select_roles" ON public.roles;
CREATE POLICY "auth_select_roles" ON public.roles FOR SELECT TO authenticated
  USING (is_pos_admin() OR scope = 'global' OR branch_id = get_branch_id());

DROP POLICY IF EXISTS "auth_write_roles" ON public.roles;
CREATE POLICY "auth_write_roles" ON public.roles FOR INSERT TO authenticated
  WITH CHECK (
    is_pos_admin()
    OR (is_branch_manager() AND scope = 'branch' AND branch_id = get_branch_id())
  );

DROP POLICY IF EXISTS "auth_write_roles_upd" ON public.roles;
CREATE POLICY "auth_write_roles_upd" ON public.roles FOR UPDATE TO authenticated
  USING (
    is_pos_admin()
    OR (is_branch_manager() AND scope = 'branch' AND branch_id = get_branch_id())
  )
  WITH CHECK (
    is_pos_admin()
    OR (is_branch_manager() AND scope = 'branch' AND branch_id = get_branch_id())
  );

DROP POLICY IF EXISTS "auth_write_roles_del" ON public.roles;
CREATE POLICY "auth_write_roles_del" ON public.roles FOR DELETE TO authenticated
  USING (
    is_pos_admin()
    OR (is_branch_manager() AND scope = 'branch' AND branch_id = get_branch_id())
  );

-- ============ 3. USERS: EXTRA COLUMNS, DROP FIXED-ROLE CHECK ============
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS failed_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS lock_until timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;

-- ============ 4. AUDIT LOG: IP / DEVICE ============
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS ip text;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS device text;

-- ============ 5. ROLE-GUARD TRIGGER (custom roles + lockout safety) ============
-- Keeps every existing safeguard (admins only manage admins, no self
-- role/branch/status changes, BMs scoped to their branch) and adds:
--   * assigned roles must exist in the roles matrix;
--   * BMs may only assign global roles or roles of their own branch;
--   * nobody may clear their own lock / login counters (except the lockout RPC,
--     signalled via the app.login_guard_bypass GUC);
--   * unknown callers may only self-register a fresh cashier row or update
--     lockout counters (anon-callable record_login_failure).
CREATE OR REPLACE FUNCTION public.guard_user_role_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_caller_role text;
  v_caller_branch uuid;
  v_bypass boolean;
BEGIN
  SELECT role, branch_id INTO v_caller_role, v_caller_branch
  FROM public.users WHERE id = auth.uid();

  v_bypass := COALESCE(current_setting('app.login_guard_bypass', true), '') = 'on';

  -- Assigned role must exist in the matrix.
  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE role = NEW.role) THEN
    RAISE EXCEPTION 'UNKNOWN_ROLE';
  END IF;

  -- Unknown / anonymous caller (e.g. anon lockout RPC, or self-registration).
  IF v_caller_role IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      -- Self-registration: fresh basic cashier profile owned by the caller
      -- (RLS already enforces this exact shape).
      IF NEW.id = auth.uid() AND NEW.role = 'cashier' AND NEW.branch_id IS NULL THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'PERMISSION_DENIED';
    END IF;
    -- UPDATE: only lockout counters may change (record_login_failure as anon).
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.role IS DISTINCT FROM OLD.role
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.is_active IS DISTINCT FROM OLD.is_active
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.username IS DISTINCT FROM OLD.username
       OR NEW.full_name IS DISTINCT FROM OLD.full_name
       OR NEW.phone IS DISTINCT FROM OLD.phone THEN
      RAISE EXCEPTION 'PERMISSION_DENIED';
    END IF;
    RETURN NEW;
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

      -- Lockout fields are system-managed (only the lockout RPC may touch them).
      IF NOT v_bypass THEN
        IF NEW.is_locked IS DISTINCT FROM OLD.is_locked
           OR NEW.failed_attempts IS DISTINCT FROM OLD.failed_attempts
           OR NEW.lock_until IS DISTINCT FROM OLD.lock_until THEN
          RAISE EXCEPTION 'PERMISSION_DENIED: users cannot modify their own lock state';
        END IF;
      END IF;
    END IF;
  END IF;

  -- Branch managers may only manage staff of their own branch.
  IF v_caller_role = 'branch_manager' THEN
    IF NEW.branch_id IS DISTINCT FROM v_caller_branch THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: branch managers can only manage their own branch';
    END IF;
    -- Assigned role must be a global role or a role of this branch.
    IF NOT EXISTS (
      SELECT 1 FROM public.roles
      WHERE role = NEW.role AND is_active AND (scope = 'global' OR branch_id = v_caller_branch)
    ) THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: role is not assignable in this branch';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_users_role_guard ON public.users;
CREATE TRIGGER trg_users_role_guard
BEFORE INSERT OR UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.guard_user_role_changes();

-- ============ 6. LOGIN AS (LOGIN_AS_LOG + RPCs) ============
CREATE TABLE IF NOT EXISTS public.login_as_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  admin_email text,
  admin_branch_id uuid,
  target_user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  target_branch_id uuid,
  reason text,
  ip text,
  device text,
  login_at timestamptz NOT NULL DEFAULT now(),
  logout_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_as_log_login ON public.login_as_log (login_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_as_log_target ON public.login_as_log (target_user_id);

ALTER TABLE public.login_as_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "login_as_log_select_admin" ON public.login_as_log;
CREATE POLICY "login_as_log_select_admin" ON public.login_as_log
  FOR SELECT TO authenticated USING (is_pos_admin());
DROP POLICY IF EXISTS "login_as_log_insert_admin" ON public.login_as_log;
CREATE POLICY "login_as_log_insert_admin" ON public.login_as_log
  FOR INSERT TO authenticated WITH CHECK (is_pos_admin());
DROP POLICY IF EXISTS "login_as_log_update_admin" ON public.login_as_log;
CREATE POLICY "login_as_log_update_admin" ON public.login_as_log
  FOR UPDATE TO authenticated USING (is_pos_admin()) WITH CHECK (is_pos_admin());

GRANT SELECT, INSERT, UPDATE ON public.login_as_log TO authenticated;

-- Start impersonating a user. Super admin / owner only. The caller's GoTrue
-- session stays active (the app swaps the resolved profile); RLS stays scoped
-- to the admin, who already sees every branch, so no privilege is widened.
-- The log row is the authoritative audit record for the impersonation.
CREATE OR REPLACE FUNCTION public.login_as_user(
  p_target_user_id uuid,
  p_reason text DEFAULT NULL,
  p_ip text DEFAULT NULL,
  p_device text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin public.users%ROWTYPE;
  v_target public.users%ROWTYPE;
  v_log_id uuid;
BEGIN
  SELECT * INTO v_admin FROM public.users WHERE id = auth.uid();
  IF v_admin.id IS NULL OR NOT v_admin.is_active OR v_admin.role NOT IN ('super_admin', 'owner') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  SELECT * INTO v_target FROM public.users WHERE id = p_target_user_id;
  IF v_target.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;
  IF NOT v_target.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_INACTIVE');
  END IF;
  IF v_target.id = v_admin.id THEN
    RETURN jsonb_build_object('success', false, 'error', 'CANNOT_IMPERSONATE_SELF');
  END IF;
  IF v_target.role IN ('super_admin', 'owner') THEN
    RETURN jsonb_build_object('success', false, 'error', 'CANNOT_IMPERSONATE_ADMIN');
  END IF;

  INSERT INTO public.login_as_log (
    admin_user_id, admin_email, admin_branch_id, target_user_id, target_branch_id,
    reason, ip, device
  ) VALUES (
    v_admin.id, v_admin.email, v_admin.branch_id, v_target.id, v_target.branch_id,
    p_reason, p_ip, p_device
  )
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object(
    'success', true,
    'log_id', v_log_id,
    'target', jsonb_build_object(
      'id', v_target.id,
      'email', v_target.email,
      'username', v_target.username,
      'full_name', v_target.full_name,
      'role', v_target.role,
      'branch_id', v_target.branch_id,
      'phone', v_target.phone,
      'is_active', v_target.is_active,
      'is_locked', v_target.is_locked
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.login_as_user(uuid, text, text, text) TO authenticated;

-- End an impersonation (logs logout_at). Only the same admin can close it.
CREATE OR REPLACE FUNCTION public.return_from_login_as(p_log_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated int;
BEGIN
  UPDATE public.login_as_log
  SET logout_at = now()
  WHERE id = p_log_id AND admin_user_id = auth.uid() AND logout_at IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.return_from_login_as(uuid) TO authenticated;

-- ============ 7. LOGIN LOCKOUT RPCs ============
-- Client calls this on a failed sign-in (anon session). Increments the failure
-- counter and locks the account after 5 consecutive failures for 5 minutes.
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

GRANT EXECUTE ON FUNCTION public.record_login_failure(text) TO anon, authenticated;

-- Client calls this on a successful sign-in. Resets the counter/lock and
-- records last_login_at. Uses the app.login_guard_bypass GUC so the role-guard
-- trigger lets the lockout fields change without opening self-unlock.
CREATE OR REPLACE FUNCTION public.record_login_success(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id AND NOT is_pos_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  PERFORM set_config('app.login_guard_bypass', 'on', true);

  UPDATE public.users
  SET failed_attempts = 0, is_locked = false, lock_until = NULL, last_login_at = now()
  WHERE id = p_user_id;

  PERFORM set_config('app.login_guard_bypass', 'off', true);

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_login_success(uuid) TO authenticated;

-- get_login_email: reject locked accounts before returning the email.
CREATE OR REPLACE FUNCTION public.get_login_email(p_username text)
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
  IF v_user.is_locked AND (v_user.lock_until IS NULL OR v_user.lock_until > now()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_LOCKED');
  END IF;
  -- Auto-clear an expired lock so the locked flag never goes stale.
  IF v_user.is_locked AND v_user.lock_until IS NOT NULL AND v_user.lock_until <= now() THEN
    UPDATE public.users SET is_locked = false, failed_attempts = 0, lock_until = NULL WHERE id = v_user.id;
  END IF;
  RETURN jsonb_build_object('success', true, 'email', v_user.email);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_login_email(text) TO anon, authenticated;

-- ============ 8. create_user: CUSTOM-ROLE AWARE ============
-- The role is validated against the roles matrix (instead of a hardcoded
-- whitelist) so admins can assign custom roles and branch managers can assign
-- any global role or a role scoped to their own branch. Everything else (email/
-- username uniqueness, auth.users + auth.identities creation, PIN hashing) is
-- unchanged from 007/011.
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

  -- Custom-role aware: the assigned role must exist in the matrix and be
  -- assignable by the caller (BM: global or own-branch roles only).
  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE role = p_role) THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ROLE');
  END IF;
  IF v_caller_role = 'branch_manager' AND NOT EXISTS (
    SELECT 1 FROM public.roles
    WHERE role = p_role AND (scope = 'global' OR branch_id = v_caller_branch)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED',
      'detail', 'Role not assignable in this branch');
  END IF;
  v_role := p_role;

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

GRANT EXECUTE ON FUNCTION public.create_user(text, text, text, text, uuid, boolean, text) TO authenticated;

-- ============ 9. DEFAULT ROLE MATRIX: NEW ACTION PERMISSIONS ============
-- Appends the granular action permissions (print / export / import / POS
-- discount / change price / reprint) to the DB matrix so the features work out
-- of the box. Idempotent: dedupes and never strips existing permissions.
DO $$
DECLARE
  v_key text;
  v_perms jsonb;
BEGIN
  -- { role -> permissions to ensure }
  FOR v_key, v_perms IN
    SELECT kv.key, kv.value
    FROM jsonb_each(jsonb_build_object(
      'cashier', '["pos.reprint","sales.print","customers.print","products.print"]'::jsonb,
      'warehouse_manager', '["products.print","products.export","products.import","purchases.print","suppliers.print"]'::jsonb,
      'accountant', '["sales.print","sales.export","reports.print","reports.export","expenses.print","purchases.print","customers.print","customers.export","suppliers.print"]'::jsonb,
      'production_manager', '["products.print","products.export","products.import","purchases.print","suppliers.print"]'::jsonb,
      'branch_manager', '["pos.discount","pos.change_price","pos.reprint","products.print","products.export","products.import","purchases.print","sales.print","sales.export","reports.print","reports.export","customers.print","customers.export","suppliers.print","expenses.print"]'::jsonb,
      'super_admin', '["pos.discount","pos.change_price","pos.reprint","products.print","products.export","products.import","purchases.print","sales.print","sales.export","reports.print","reports.export","customers.print","customers.export","suppliers.print","expenses.print"]'::jsonb,
      'owner', '["pos.discount","pos.change_price","pos.reprint","products.print","products.export","products.import","purchases.print","sales.print","sales.export","reports.print","reports.export","customers.print","customers.export","suppliers.print","expenses.print"]'::jsonb
    )) AS kv
  LOOP
    UPDATE public.roles
    SET permissions = (
      SELECT COALESCE(jsonb_agg(DISTINCT elem), '[]'::jsonb)
      FROM jsonb_array_elements_text(permissions || v_perms) AS t(elem)
    )
    WHERE role = v_key AND v_perms IS NOT NULL;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- ==========================================
-- 044_rbac_hardening.sql
-- ==========================================
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

-- ==========================================
-- 045_fix_process_sale_order_settlement.sql
-- ==========================================
-- ============================================================================
-- 045. process_sale: settle the linked order BEFORE any writes
-- ----------------------------------------------------------------------------
-- CRITICAL FIX (audit C1). The previous 038 implementation validated the linked
-- order AFTER it had already inserted the sale header, the sale items, deducted
-- stock (FIFO), and posted the journal entry. Because plpgsql RETURN does not
-- abort the caller transaction, a "failed" settlement (ORDER_NOT_FOUND) still
-- committed the whole sale:
--
--   1. A held takeaway/delivery order has table_id = NULL. The old check
--      treated NULL as "order not found", so paying such an order always
--      reported failure while silently committing a full sale and stock
--      deduction. Retrying produced a duplicate sale / double deduction.
--   2. Two devices paying the same held order: the second payment hit the
--      status guard and "failed" after committing a second full sale.
--
-- This migration moves the order lookup + validation to before WRITE PHASE 1.
-- FOUND semantics distinguish "no matching open/held order" from "order exists
-- but has no table", so a held takeaway/delivery order is now payable. A
-- rejected settlement now returns before anything is written, so no phantom
-- sale, no double stock deduction.
--
-- Signature is unchanged (038). Additive migration — 038 must remain in place.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.process_sale(p_invoice_number text, p_branch_id uuid, p_warehouse_id uuid, p_customer_id uuid, p_salesperson_id uuid, p_subtotal numeric, p_discount_amount numeric, p_discount_type text, p_tax_amount numeric, p_bonus_amount numeric, p_total numeric, p_paid_amount numeric, p_payment_method text, p_status text, p_items jsonb, p_shift_id uuid DEFAULT NULL::uuid, p_order_type text DEFAULT 'takeaway', p_table_id uuid DEFAULT NULL::uuid, p_order_id uuid DEFAULT NULL::uuid)
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
  v_subtotal numeric(14,2) := 0;
  v_discount numeric(14,2);
  v_tax numeric(14,2) := 0;
  v_tax_enabled boolean;
  v_tax_rate numeric(14,2);
  v_total numeric(14,2);
  v_paid numeric(14,2);
  v_ar numeric(14,2);
  v_lines jsonb := '[]'::jsonb;
  v_dr numeric(14,2) := 0;
  v_cr numeric(14,2) := 0;
  v_diff numeric(14,2);
  v_balance_account text;
  v_order_table uuid;
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

    -- Origin table must belong to the sale branch
    IF p_table_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.dining_tables WHERE id = p_table_id AND branch_id = p_branch_id
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'TABLE_NOT_IN_BRANCH', 'table_id', p_table_id);
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

    -- ===== VALIDATE the linked order BEFORE any writes =====
    -- FOUND (not the table value) is what matters: a held takeaway/delivery
    -- order legitimately has table_id = NULL and must still be payable. Any
    -- RETURN here is safe because nothing has been written yet.
    IF p_order_id IS NOT NULL THEN
      SELECT table_id INTO v_order_table
      FROM public.orders
      WHERE id = p_order_id AND branch_id = p_branch_id AND status IN ('open', 'held');

      IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND',
          'detail', 'The order must exist, belong to this branch, and be open or held. No sale was created.');
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

      -- Accumulate the authoritative subtotal (catalog price, clamped discount)
      SELECT COALESCE(sale_price, 0) INTO v_unit_price FROM products WHERE id = v_product_id;
      v_discount_amount := GREATEST(COALESCE((v_item->>'discount_amount')::numeric, 0), 0);
      IF v_discount_amount > v_quantity * v_unit_price THEN
        v_discount_amount := v_quantity * v_unit_price;
      END IF;
      v_subtotal := v_subtotal + ROUND(v_quantity * v_unit_price - v_discount_amount, 2);
    END LOOP;

    -- ===== SERVER-SIDE HEADER TOTALS (computed from authoritative prices) =====
    v_discount := GREATEST(COALESCE(p_discount_amount, 0), 0);
    IF v_discount > v_subtotal THEN v_discount := v_subtotal; END IF;
    SELECT COALESCE(tax_enabled, false), COALESCE(tax_rate, 0) INTO v_tax_enabled, v_tax_rate
    FROM public.settings LIMIT 1;
    IF v_tax_enabled THEN
      v_tax := ROUND((v_subtotal - v_discount) * v_tax_rate / 100, 2);
    END IF;
    v_total := ROUND(v_subtotal - v_discount + v_tax, 2);
    v_paid := ROUND(GREATEST(COALESCE(p_paid_amount, 0), 0), 2);
    v_ar := ROUND(GREATEST(v_total - v_paid, 0), 2);

    -- ===== WRITE PHASE 1: sale header (authoritative totals) =====
    INSERT INTO sales (invoice_number, branch_id, warehouse_id, customer_id, cashier_id, salesperson_id,
      subtotal, discount_amount, discount_type, tax_amount, bonus_amount, total, paid_amount, payment_method, status, order_type, table_id)
    VALUES (p_invoice_number, p_branch_id, p_warehouse_id, p_customer_id, auth.uid(), p_salesperson_id,
      v_subtotal, v_discount, p_discount_type, v_tax, COALESCE(p_bonus_amount, 0),
      v_total, v_paid, p_payment_method, p_status, COALESCE(p_order_type, 'takeaway'), p_table_id)
    RETURNING id INTO v_sale_id;

    -- ===== WRITE PHASE 2: items + FIFO stock deduction + ledger =====
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
      v_discount_amount := GREATEST(COALESCE((v_item->>'discount_amount')::numeric, 0), 0);

      SELECT sale_price INTO v_unit_price FROM products WHERE id = v_product_id;
      v_unit_price := COALESCE(v_unit_price, 0);
      IF v_discount_amount > v_quantity * v_unit_price THEN
        v_discount_amount := v_quantity * v_unit_price;
      END IF;
      v_bonus_quantity := COALESCE((v_item->>'bonus_quantity')::numeric, 0);
      v_item_total := ROUND(v_quantity * v_unit_price - v_discount_amount, 2);

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

    -- ===== WRITE PHASE 2b: settle the validated open/held order =====
    IF p_order_id IS NOT NULL THEN
      UPDATE public.orders SET status = 'completed', completed_at = now(), updated_at = now()
      WHERE id = p_order_id;
      -- NULL table (held takeaway/delivery) has no table to free.
      IF v_order_table IS NOT NULL THEN
        UPDATE public.dining_tables SET status = 'vacant', updated_at = now()
        WHERE id = v_order_table;
      END IF;
    END IF;

    -- ===== WRITE PHASE 3: log the sale into the active shift =====
    IF v_shift_id IS NOT NULL THEN
      INSERT INTO shift_operations (shift_id, operation_type, amount, payment_method, reference_type, reference_id, created_by)
      VALUES (v_shift_id, 'sale', v_paid, p_payment_method, 'sale', v_sale_id, auth.uid());
    END IF;

    -- ===== WRITE PHASE 4: post the sales + COGS journal entry =====
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
    IF v_discount > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'discount_given', 'debit', v_discount, 'credit', 0);
      v_dr := v_dr + v_discount;
    END IF;
    IF v_subtotal > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'revenue', 'debit', 0, 'credit', v_subtotal);
      v_cr := v_cr + v_subtotal;
    END IF;
    IF v_tax > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'vat_payable', 'debit', 0, 'credit', v_tax);
      v_cr := v_cr + v_tax;
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

-- ==========================================
-- 046_floorplan_update_order.sql
-- ==========================================
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

-- ==========================================
-- 047_order_lifecycle_guards.sql
-- ==========================================
-- ============================================================================
-- 047. Order-lifecycle guards: detach_order RPC, atomic table free in
--      process_sale, guest_count on sales, status/type CHECK constraints
-- ----------------------------------------------------------------------------
-- Completes the floor-plan lifecycle fixes started in 046:
--
--   H1  The POS "detach" buttons only cleared local state; nothing detached the
--       order in the DB (and the old client-side free now hits the 046 guard).
--       New detach_order RPC nulls the order's table_id and frees the old
--       table atomically (respecting other open/held orders on it).
--   H3  A direct dine-in sale (no linked order) freed its table client-side,
--       after the sale committed — non-atomic. process_sale now frees the
--       origin table in the same transaction.
--   H4  process_sale freed a table purely by the settled order's table_id
--       without checking other open/held orders. Both the linked-order and
--       direct-sale free paths now re-check before freeing.
--   M9  guest_count is captured on the POS screen but never stored. process_sale
--       gains p_guest_count and persists it on sales.guest_count.
--   L2  No CHECK constraints on orders.status / orders.order_type /
--       dining_tables.status. Added below (guards against impossible states).
--
-- process_sale gains ONE new trailing param (p_guest_count, defaulted), so the
-- 19-arg call shape from 038/045 still resolves to this function. The old
-- 19-arg overload is dropped first to keep a single implementation. All three
-- RPCs are re-granted to the standard roles explicitly.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- L2: CHECK constraints (idempotent; safe because no violating rows exist)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_status_check' AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_status_check CHECK (status IN ('open', 'held', 'completed', 'cancelled'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_order_type_check' AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_order_type_check CHECK (order_type IN ('dine_in', 'takeaway', 'delivery', 'drive_thru'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dining_tables_status_check' AND conrelid = 'public.dining_tables'::regclass
  ) THEN
    ALTER TABLE public.dining_tables ADD CONSTRAINT dining_tables_status_check CHECK (status IN ('vacant', 'occupied', 'reserved', 'closed'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- M9: guest_count on sales
-- ---------------------------------------------------------------------------
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS guest_count integer;

-- ---------------------------------------------------------------------------
-- process_sale: + p_guest_count, atomic origin-table free (H3/H4/M9)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.process_sale(
  text, uuid, uuid, uuid, uuid, numeric, numeric, text, numeric, numeric,
  numeric, numeric, text, text, jsonb, uuid, text, uuid, uuid);

CREATE OR REPLACE FUNCTION public.process_sale(p_invoice_number text, p_branch_id uuid, p_warehouse_id uuid, p_customer_id uuid, p_salesperson_id uuid, p_subtotal numeric, p_discount_amount numeric, p_discount_type text, p_tax_amount numeric, p_bonus_amount numeric, p_total numeric, p_paid_amount numeric, p_payment_method text, p_status text, p_items jsonb, p_shift_id uuid DEFAULT NULL::uuid, p_order_type text DEFAULT 'takeaway', p_table_id uuid DEFAULT NULL::uuid, p_order_id uuid DEFAULT NULL::uuid, p_guest_count integer DEFAULT NULL::integer)
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
  v_subtotal numeric(14,2) := 0;
  v_discount numeric(14,2);
  v_tax numeric(14,2) := 0;
  v_tax_enabled boolean;
  v_tax_rate numeric(14,2);
  v_total numeric(14,2);
  v_paid numeric(14,2);
  v_ar numeric(14,2);
  v_lines jsonb := '[]'::jsonb;
  v_dr numeric(14,2) := 0;
  v_cr numeric(14,2) := 0;
  v_diff numeric(14,2);
  v_balance_account text;
  v_order_table uuid;
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

    -- Origin table must belong to the sale branch
    IF p_table_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.dining_tables WHERE id = p_table_id AND branch_id = p_branch_id
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'TABLE_NOT_IN_BRANCH', 'table_id', p_table_id);
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

    -- ===== VALIDATE the linked order BEFORE any writes =====
    -- FOUND (not the table value) is what matters: a held takeaway/delivery
    -- order legitimately has table_id = NULL and must still be payable. Any
    -- RETURN here is safe because nothing has been written yet.
    IF p_order_id IS NOT NULL THEN
      SELECT table_id INTO v_order_table
      FROM public.orders
      WHERE id = p_order_id AND branch_id = p_branch_id AND status IN ('open', 'held');

      IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND',
          'detail', 'The order must exist, belong to this branch, and be open or held. No sale was created.');
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

      -- Accumulate the authoritative subtotal (catalog price, clamped discount)
      SELECT COALESCE(sale_price, 0) INTO v_unit_price FROM products WHERE id = v_product_id;
      v_discount_amount := GREATEST(COALESCE((v_item->>'discount_amount')::numeric, 0), 0);
      IF v_discount_amount > v_quantity * v_unit_price THEN
        v_discount_amount := v_quantity * v_unit_price;
      END IF;
      v_subtotal := v_subtotal + ROUND(v_quantity * v_unit_price - v_discount_amount, 2);
    END LOOP;

    -- ===== SERVER-SIDE HEADER TOTALS (computed from authoritative prices) =====
    v_discount := GREATEST(COALESCE(p_discount_amount, 0), 0);
    IF v_discount > v_subtotal THEN v_discount := v_subtotal; END IF;
    SELECT COALESCE(tax_enabled, false), COALESCE(tax_rate, 0) INTO v_tax_enabled, v_tax_rate
    FROM public.settings LIMIT 1;
    IF v_tax_enabled THEN
      v_tax := ROUND((v_subtotal - v_discount) * v_tax_rate / 100, 2);
    END IF;
    v_total := ROUND(v_subtotal - v_discount + v_tax, 2);
    v_paid := ROUND(GREATEST(COALESCE(p_paid_amount, 0), 0), 2);
    v_ar := ROUND(GREATEST(v_total - v_paid, 0), 2);

    -- ===== WRITE PHASE 1: sale header (authoritative totals) =====
    INSERT INTO sales (invoice_number, branch_id, warehouse_id, customer_id, cashier_id, salesperson_id,
      subtotal, discount_amount, discount_type, tax_amount, bonus_amount, total, paid_amount, payment_method, status, order_type, table_id, guest_count)
    VALUES (p_invoice_number, p_branch_id, p_warehouse_id, p_customer_id, auth.uid(), p_salesperson_id,
      v_subtotal, v_discount, p_discount_type, v_tax, COALESCE(p_bonus_amount, 0),
      v_total, v_paid, p_payment_method, p_status, COALESCE(p_order_type, 'takeaway'), p_table_id, p_guest_count)
    RETURNING id INTO v_sale_id;

    -- ===== WRITE PHASE 2: items + FIFO stock deduction + ledger =====
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
      v_discount_amount := GREATEST(COALESCE((v_item->>'discount_amount')::numeric, 0), 0);

      SELECT sale_price INTO v_unit_price FROM products WHERE id = v_product_id;
      v_unit_price := COALESCE(v_unit_price, 0);
      IF v_discount_amount > v_quantity * v_unit_price THEN
        v_discount_amount := v_quantity * v_unit_price;
      END IF;
      v_bonus_quantity := COALESCE((v_item->>'bonus_quantity')::numeric, 0);
      v_item_total := ROUND(v_quantity * v_unit_price - v_discount_amount, 2);

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

    -- ===== WRITE PHASE 2b: settle the linked order + free tables atomically =====
    -- H4: only free a table when NO other open/held order still references it.
    -- H3: a direct dine-in sale (no linked order) frees its origin table here,
    --     inside the sale transaction, instead of client-side afterwards.
    IF p_order_id IS NOT NULL THEN
      UPDATE public.orders SET status = 'completed', completed_at = now(), updated_at = now()
      WHERE id = p_order_id;
      -- NULL table (held takeaway/delivery) has no table to free.
      IF v_order_table IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.orders
        WHERE table_id = v_order_table AND status IN ('open', 'held') AND id <> p_order_id
      ) THEN
        UPDATE public.dining_tables SET status = 'vacant', updated_at = now()
        WHERE id = v_order_table;
      END IF;
    ELSIF p_table_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.orders
      WHERE table_id = p_table_id AND status IN ('open', 'held')
    ) THEN
      UPDATE public.dining_tables SET status = 'vacant', updated_at = now()
      WHERE id = p_table_id;
    END IF;

    -- ===== WRITE PHASE 3: log the sale into the active shift =====
    IF v_shift_id IS NOT NULL THEN
      INSERT INTO shift_operations (shift_id, operation_type, amount, payment_method, reference_type, reference_id, created_by)
      VALUES (v_shift_id, 'sale', v_paid, p_payment_method, 'sale', v_sale_id, auth.uid());
    END IF;

    -- ===== WRITE PHASE 4: post the sales + COGS journal entry =====
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
    IF v_discount > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'discount_given', 'debit', v_discount, 'credit', 0);
      v_dr := v_dr + v_discount;
    END IF;
    IF v_subtotal > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'revenue', 'debit', 0, 'credit', v_subtotal);
      v_cr := v_cr + v_subtotal;
    END IF;
    IF v_tax > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'vat_payable', 'debit', 0, 'credit', v_tax);
      v_cr := v_cr + v_tax;
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

-- ---------------------------------------------------------------------------
-- H1: detach_order — detach an open/held order from its table atomically
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.detach_order(p_order_id uuid)
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
    SELECT branch_id, table_id, status INTO v_branch_id, v_table_id, v_status
    FROM public.orders WHERE id = p_order_id;
    IF v_branch_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
    END IF;
    IF v_status NOT IN ('open', 'held') THEN
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_EDITABLE',
        'detail', 'Only open or held orders can be detached.');
    END IF;

    SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
    IF NOT is_pos_admin() AND COALESCE(v_user_branch, '00000000-0000-0000-0000-000000000000'::uuid) <> v_branch_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;

    UPDATE public.orders SET table_id = NULL, updated_at = now() WHERE id = p_order_id;

    -- Free the old table only when no other open/held order still references it.
    IF v_table_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.orders
      WHERE table_id = v_table_id AND status IN ('open', 'held') AND id <> p_order_id
    ) THEN
      UPDATE public.dining_tables SET status = 'vacant', updated_at = now() WHERE id = v_table_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'order_id', p_order_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Grants (re-applied after the process_sale drop + new client-facing RPCs)
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.process_sale(text, uuid, uuid, uuid, uuid, numeric, numeric, text, numeric, numeric, numeric, numeric, text, text, jsonb, uuid, text, uuid, uuid, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.detach_order(uuid) TO anon, authenticated, service_role;

-- ==========================================
-- 048_kitchen_sends.sql
-- ==========================================
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

-- ==========================================
-- 049_demo_data_management.sql
-- ==========================================
-- ============================================================================
-- 049. Demo data management (seed + delete, per branch)
-- ----------------------------------------------------------------------------
-- Branch admins / super admins need a safe, reversible way to populate a branch
-- with throwaway test data for trying the POS. Every demo row carries the
-- is_demo flag (default false, so nothing real is ever flagged) and:
--
--   * seed_demo_data(p_branch_id)   - idempotent: seeds once per branch
--   * delete_demo_data(p_branch_id) - removes demo business data + any
--                                     orders/sales that reference it
--
-- Deletion order matters for FKs:
--   production_orders reference products with NO ACTION  -> delete first
--   sales / orders reference customers, tables, products -> delete next
--   demo customers / products / categories / tables / areas -> last
--
-- Users/auth are intentionally out of scope: a demo cashier account is created
-- by an administrator directly and is not removed by this function.
-- ============================================================================

ALTER TABLE public.dining_areas   ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.dining_tables  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.customers      ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.categories     ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.products       ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_demo_products_branch
  ON public.products (branch_id) WHERE is_demo;
CREATE INDEX IF NOT EXISTS idx_demo_tables_branch
  ON public.dining_tables (branch_id) WHERE is_demo;

-- ============================================================================
-- seed_demo_data: one call seeds an area, tables, a category, products and
-- customers for the branch. Safe to call repeatedly (no-op if already seeded).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.seed_demo_data(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_area_id uuid;
  v_cat_id  uuid;
  v_areas   integer := 0;
  v_tables  integer := 0;
  v_cats    integer := 0;
  v_prods   integer := 0;
  v_custs   integer := 0;
BEGIN
  IF NOT is_pos_admin() AND NOT (is_branch_manager() AND get_branch_id() = p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_NOT_FOUND');
  END IF;

  -- Idempotent: a branch with demo rows already present is left untouched.
  IF EXISTS (SELECT 1 FROM public.dining_areas WHERE branch_id = p_branch_id AND is_demo)
     OR EXISTS (SELECT 1 FROM public.products WHERE branch_id = p_branch_id AND is_demo) THEN
    RETURN jsonb_build_object('success', true, 'seeded', 0, 'existing', true);
  END IF;

  INSERT INTO public.dining_areas (branch_id, name, is_demo)
  VALUES (p_branch_id, 'منطقة تجريبية', true)
  RETURNING id INTO v_area_id;
  v_areas := v_areas + 1;

  INSERT INTO public.dining_tables (branch_id, area_id, name, capacity, is_demo) VALUES
    (p_branch_id, v_area_id, 'طاولة تجريبية 1', 4, true),
    (p_branch_id, v_area_id, 'طاولة تجريبية 2', 4, true),
    (p_branch_id, v_area_id, 'طاولة تجريبية 3', 2, true),
    (p_branch_id, v_area_id, 'طاولة تجريبية 4', 8, true);
  v_tables := 4;

  INSERT INTO public.categories (branch_id, name, name_en, is_demo)
  VALUES (p_branch_id, 'أصناف تجريبية', 'Demo items', true)
  RETURNING id INTO v_cat_id;
  v_cats := 1;

  INSERT INTO public.products (
    branch_id, category_id, name, name_en, sku, barcode,
    cost_price, sale_price, wholesale_price, product_type, is_demo, low_stock_threshold, is_active
  ) VALUES
    (p_branch_id, v_cat_id, 'قهوة تركية',     'Turkish coffee',   'DEMO-001', 'DEMO00000001', 8,  25, 20, 'ready', true, 20, true),
    (p_branch_id, v_cat_id, 'قهوة فرنسية',    'French coffee',    'DEMO-002', 'DEMO00000002', 7,  20, 16, 'ready', true, 20, true),
    (p_branch_id, v_cat_id, 'شاي',            'Tea',              'DEMO-003', 'DEMO00000003', 4,  15, 12, 'ready', true, 20, true),
    (p_branch_id, v_cat_id, 'عصير برتقال',    'Orange juice',     'DEMO-004', 'DEMO00000004', 10, 30, 24, 'ready', true, 20, true),
    (p_branch_id, v_cat_id, 'بيبسي',          'Pepsi',            'DEMO-005', 'DEMO00000005', 5,  15, 12, 'ready', true, 20, true),
    (p_branch_id, v_cat_id, 'بيتزا صغيرة',    'Small pizza',      'DEMO-006', 'DEMO00000006', 20, 45, 36, 'ready', true, 10, true),
    (p_branch_id, v_cat_id, 'برجر',           'Burger',           'DEMO-007', 'DEMO00000007', 28, 60, 48, 'ready', true, 10, true),
    (p_branch_id, v_cat_id, 'سلطة سيزر',      'Caesar salad',     'DEMO-008', 'DEMO00000008', 15, 35, 28, 'ready', true, 10, true);
  v_prods := 8;

  INSERT INTO public.customers (branch_id, name, phone, is_demo) VALUES
    (p_branch_id, 'عميل تجريبي 1', '01111111111', true),
    (p_branch_id, 'عميل تجريبي 2', '01122222222', true);
  v_custs := 2;

  RETURN jsonb_build_object('success', true, 'seeded', 1, 'existing', false,
    'areas', v_areas, 'tables', v_tables, 'categories', v_cats,
    'products', v_prods, 'customers', v_custs);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'SEED_FAILED', 'detail', SQLERRM);
END;
$fn$;

-- ============================================================================
-- delete_demo_data: removes demo business rows and every order/sale that
-- references them (referencing rows are demo artifacts only, but the branch
-- scope keeps the operation safe).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.delete_demo_data(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  n_prod_orders integer := 0;
  n_shift_ops   integer := 0;
  n_sales       integer := 0;
  n_orders      integer := 0;
  n_custs       integer := 0;
  n_prods       integer := 0;
  n_cats        integer := 0;
  n_tables      integer := 0;
  n_areas       integer := 0;
BEGIN
  IF NOT is_pos_admin() AND NOT (is_branch_manager() AND get_branch_id() = p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  -- production_orders has a NO ACTION FK on product_id -> delete them first.
  DELETE FROM public.production_orders
  WHERE product_id IN (
    SELECT id FROM public.products WHERE branch_id = p_branch_id AND is_demo
  );
  GET DIAGNOSTICS n_prod_orders = ROW_COUNT;

  -- shift_operations are not FK'd to sales: clear the sale entries that point
  -- at sales we are about to delete so the drawer stays consistent.
  DELETE FROM public.shift_operations
  WHERE operation_type = 'sale'
    AND reference_id IN (
      SELECT s.id FROM public.sales s
      WHERE s.branch_id = p_branch_id
        AND (s.customer_id IN (SELECT id FROM public.customers WHERE branch_id = p_branch_id AND is_demo)
             OR s.table_id IN (SELECT id FROM public.dining_tables WHERE branch_id = p_branch_id AND is_demo)
             OR EXISTS (SELECT 1 FROM public.sale_items si
                        WHERE si.sale_id = s.id
                          AND si.product_id IN (SELECT id FROM public.products WHERE branch_id = p_branch_id AND is_demo)))
    );
  GET DIAGNOSTICS n_shift_ops = ROW_COUNT;

  DELETE FROM public.sales WHERE id IN (
    SELECT s.id FROM public.sales s
    WHERE s.branch_id = p_branch_id
      AND (s.customer_id IN (SELECT id FROM public.customers WHERE branch_id = p_branch_id AND is_demo)
           OR s.table_id IN (SELECT id FROM public.dining_tables WHERE branch_id = p_branch_id AND is_demo)
           OR EXISTS (SELECT 1 FROM public.sale_items si
                      WHERE si.sale_id = s.id
                        AND si.product_id IN (SELECT id FROM public.products WHERE branch_id = p_branch_id AND is_demo)))
  );
  GET DIAGNOSTICS n_sales = ROW_COUNT;

  DELETE FROM public.orders WHERE id IN (
    SELECT o.id FROM public.orders o
    WHERE o.branch_id = p_branch_id
      AND (o.table_id IN (SELECT id FROM public.dining_tables WHERE branch_id = p_branch_id AND is_demo)
           OR o.customer_id IN (SELECT id FROM public.customers WHERE branch_id = p_branch_id AND is_demo)
           OR EXISTS (SELECT 1 FROM public.order_items oi
                      WHERE oi.order_id = o.id
                        AND oi.product_id IN (SELECT id FROM public.products WHERE branch_id = p_branch_id AND is_demo)))
  );
  GET DIAGNOSTICS n_orders = ROW_COUNT;

  DELETE FROM public.customers     WHERE branch_id = p_branch_id AND is_demo;
  GET DIAGNOSTICS n_custs = ROW_COUNT;

  DELETE FROM public.products      WHERE branch_id = p_branch_id AND is_demo;
  GET DIAGNOSTICS n_prods = ROW_COUNT;

  DELETE FROM public.categories    WHERE branch_id = p_branch_id AND is_demo;
  GET DIAGNOSTICS n_cats = ROW_COUNT;

  DELETE FROM public.dining_tables WHERE branch_id = p_branch_id AND is_demo;
  GET DIAGNOSTICS n_tables = ROW_COUNT;

  DELETE FROM public.dining_areas  WHERE branch_id = p_branch_id AND is_demo;
  GET DIAGNOSTICS n_areas = ROW_COUNT;

  RETURN jsonb_build_object('success', true,
    'production_orders', n_prod_orders, 'shift_operations', n_shift_ops,
    'sales', n_sales, 'orders', n_orders, 'customers', n_custs,
    'products', n_prods, 'categories', n_cats, 'tables', n_tables, 'areas', n_areas);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'DELETE_FAILED', 'detail', SQLERRM);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.seed_demo_data(uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_demo_data(uuid) TO authenticated;

-- ==========================================
-- 049_remove_duplicate_users_branch_fk.sql
-- ==========================================
-- ============================================================================
-- 049. Remove duplicate users.branch_id foreign key
-- ----------------------------------------------------------------------------
-- The production schema previously contained two foreign keys for the same
-- relationship: users.branch_id -> branches.id. Keep the strict RBAC FK and
-- remove the legacy duplicate so PostgREST cannot expose an ambiguous
-- relationship for this column.
--
-- Idempotent: safe to apply to databases where the legacy constraint is
-- already absent (including the current production database).
-- ============================================================================

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_branch_id_fkey;

-- ==========================================
-- 050_demo_data_inventory.sql
-- ==========================================
-- ============================================================================
-- 050. Demo data: sellable inventory + full cascade cleanup
-- ----------------------------------------------------------------------------
-- The initial demo seeder (049) created products/tables/customers but the POS
-- product grid disables products with zero stock, so demo rows were not
-- sellable. This migration upgrades the two functions:
--
--   * seed_demo_data   - ensures a branch warehouse and inserts inventory rows
--                        for every demo product (so they are clickable/sellable)
--   * delete_demo_data - also clears the NO ACTION FKs (production_waste,
--                        warehouse_transfer_items) and any warehouse the seeder
--                        created (is_demo), plus inventory that points at it
-- ============================================================================

ALTER TABLE public.warehouses ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

-- ============================================================================
-- seed_demo_data (upgrade)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.seed_demo_data(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_area_id    uuid;
  v_cat_id     uuid;
  v_warehouse  uuid;
  v_prod       record;
  v_areas      integer := 0;
  v_tables     integer := 0;
  v_cats       integer := 0;
  v_prods      integer := 0;
  v_custs      integer := 0;
  v_inv        integer := 0;
  v_wh         integer := 0;
BEGIN
  IF NOT is_pos_admin() AND NOT (is_branch_manager() AND get_branch_id() = p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_NOT_FOUND');
  END IF;

  -- Idempotent: a branch with demo rows already present is left untouched.
  IF EXISTS (SELECT 1 FROM public.dining_areas WHERE branch_id = p_branch_id AND is_demo)
     OR EXISTS (SELECT 1 FROM public.products WHERE branch_id = p_branch_id AND is_demo) THEN
    RETURN jsonb_build_object('success', true, 'seeded', 0, 'existing', true);
  END IF;

  -- Warehouse: reuse the first active one, otherwise create a demo one.
  SELECT id INTO v_warehouse
  FROM public.warehouses
  WHERE branch_id = p_branch_id AND is_active
  ORDER BY created_at
  LIMIT 1;
  IF v_warehouse IS NULL THEN
    INSERT INTO public.warehouses (branch_id, name, is_active, is_demo)
    VALUES (p_branch_id, 'مستودع تجريبي', true, true)
    RETURNING id INTO v_warehouse;
    v_wh := 1;
  END IF;

  INSERT INTO public.dining_areas (branch_id, name, is_demo)
  VALUES (p_branch_id, 'منطقة تجريبية', true)
  RETURNING id INTO v_area_id;
  v_areas := v_areas + 1;

  INSERT INTO public.dining_tables (branch_id, area_id, name, capacity, is_demo) VALUES
    (p_branch_id, v_area_id, 'طاولة تجريبية 1', 4, true),
    (p_branch_id, v_area_id, 'طاولة تجريبية 2', 4, true),
    (p_branch_id, v_area_id, 'طاولة تجريبية 3', 2, true),
    (p_branch_id, v_area_id, 'طاولة تجريبية 4', 8, true);
  v_tables := 4;

  INSERT INTO public.categories (branch_id, name, name_en, is_demo)
  VALUES (p_branch_id, 'أصناف تجريبية', 'Demo items', true)
  RETURNING id INTO v_cat_id;
  v_cats := 1;

  INSERT INTO public.products (
    branch_id, category_id, name, name_en, sku, barcode,
    cost_price, sale_price, wholesale_price, product_type, is_demo, low_stock_threshold, is_active
  ) VALUES
    (p_branch_id, v_cat_id, 'قهوة تركية',     'Turkish coffee',   'DEMO-001', 'DEMO00000001', 8,  25, 20, 'ready', true, 20, true),
    (p_branch_id, v_cat_id, 'قهوة فرنسية',    'French coffee',    'DEMO-002', 'DEMO00000002', 7,  20, 16, 'ready', true, 20, true),
    (p_branch_id, v_cat_id, 'شاي',            'Tea',              'DEMO-003', 'DEMO00000003', 4,  15, 12, 'ready', true, 20, true),
    (p_branch_id, v_cat_id, 'عصير برتقال',    'Orange juice',     'DEMO-004', 'DEMO00000004', 10, 30, 24, 'ready', true, 20, true),
    (p_branch_id, v_cat_id, 'بيبسي',          'Pepsi',            'DEMO-005', 'DEMO00000005', 5,  15, 12, 'ready', true, 20, true),
    (p_branch_id, v_cat_id, 'بيتزا صغيرة',    'Small pizza',      'DEMO-006', 'DEMO00000006', 20, 45, 36, 'ready', true, 10, true),
    (p_branch_id, v_cat_id, 'برجر',           'Burger',           'DEMO-007', 'DEMO00000007', 28, 60, 48, 'ready', true, 10, true),
    (p_branch_id, v_cat_id, 'سلطة سيزر',      'Caesar salad',     'DEMO-008', 'DEMO00000008', 15, 35, 28, 'ready', true, 10, true);
  v_prods := 8;

  INSERT INTO public.customers (branch_id, name, phone, is_demo) VALUES
    (p_branch_id, 'عميل تجريبي 1', '01111111111', true),
    (p_branch_id, 'عميل تجريبي 2', '01122222222', true);
  v_custs := 2;

  -- Stock every demo product so the POS grid shows them as sellable.
  INSERT INTO public.inventory (id, product_id, warehouse_id, quantity, branch_id)
  SELECT gen_random_uuid(), p.id, v_warehouse, 100, p.branch_id
  FROM public.products p
  WHERE p.branch_id = p_branch_id AND p.is_demo;
  GET DIAGNOSTICS v_inv = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'seeded', 1, 'existing', false,
    'areas', v_areas, 'tables', v_tables, 'categories', v_cats,
    'products', v_prods, 'customers', v_custs, 'inventory', v_inv,
    'warehouses', v_wh);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'SEED_FAILED', 'detail', SQLERRM);
END;
$fn$;

-- ============================================================================
-- delete_demo_data (upgrade)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.delete_demo_data(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  n_prod_orders integer := 0;
  n_prod_waste  integer := 0;
  n_tr_items    integer := 0;
  n_shift_ops   integer := 0;
  n_sales       integer := 0;
  n_orders      integer := 0;
  n_custs       integer := 0;
  n_prods       integer := 0;
  n_cats        integer := 0;
  n_tables      integer := 0;
  n_areas       integer := 0;
  n_inv         integer := 0;
  n_wh          integer := 0;
BEGIN
  IF NOT is_pos_admin() AND NOT (is_branch_manager() AND get_branch_id() = p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  -- production_orders has a NO ACTION FK on product_id -> delete them first.
  DELETE FROM public.production_orders
  WHERE product_id IN (SELECT id FROM public.products WHERE branch_id = p_branch_id AND is_demo);
  GET DIAGNOSTICS n_prod_orders = ROW_COUNT;

  DELETE FROM public.production_waste
  WHERE product_id IN (SELECT id FROM public.products WHERE branch_id = p_branch_id AND is_demo);
  GET DIAGNOSTICS n_prod_waste = ROW_COUNT;

  DELETE FROM public.warehouse_transfer_items
  WHERE product_id IN (SELECT id FROM public.products WHERE branch_id = p_branch_id AND is_demo);
  GET DIAGNOSTICS n_tr_items = ROW_COUNT;

  -- shift_operations are not FK'd to sales: clear the sale entries that point
  -- at sales we are about to delete so the drawer stays consistent.
  DELETE FROM public.shift_operations
  WHERE operation_type = 'sale'
    AND reference_id IN (
      SELECT s.id FROM public.sales s
      WHERE s.branch_id = p_branch_id
        AND (s.customer_id IN (SELECT id FROM public.customers WHERE branch_id = p_branch_id AND is_demo)
             OR s.table_id IN (SELECT id FROM public.dining_tables WHERE branch_id = p_branch_id AND is_demo)
             OR EXISTS (SELECT 1 FROM public.sale_items si
                        WHERE si.sale_id = s.id
                          AND si.product_id IN (SELECT id FROM public.products WHERE branch_id = p_branch_id AND is_demo)))
    );
  GET DIAGNOSTICS n_shift_ops = ROW_COUNT;

  DELETE FROM public.sales WHERE id IN (
    SELECT s.id FROM public.sales s
    WHERE s.branch_id = p_branch_id
      AND (s.customer_id IN (SELECT id FROM public.customers WHERE branch_id = p_branch_id AND is_demo)
           OR s.table_id IN (SELECT id FROM public.dining_tables WHERE branch_id = p_branch_id AND is_demo)
           OR EXISTS (SELECT 1 FROM public.sale_items si
                      WHERE si.sale_id = s.id
                        AND si.product_id IN (SELECT id FROM public.products WHERE branch_id = p_branch_id AND is_demo)))
  );
  GET DIAGNOSTICS n_sales = ROW_COUNT;

  DELETE FROM public.orders WHERE id IN (
    SELECT o.id FROM public.orders o
    WHERE o.branch_id = p_branch_id
      AND (o.table_id IN (SELECT id FROM public.dining_tables WHERE branch_id = p_branch_id AND is_demo)
           OR o.customer_id IN (SELECT id FROM public.customers WHERE branch_id = p_branch_id AND is_demo)
           OR EXISTS (SELECT 1 FROM public.order_items oi
                      WHERE oi.order_id = o.id
                        AND oi.product_id IN (SELECT id FROM public.products WHERE branch_id = p_branch_id AND is_demo)))
  );
  GET DIAGNOSTICS n_orders = ROW_COUNT;

  DELETE FROM public.customers     WHERE branch_id = p_branch_id AND is_demo;
  GET DIAGNOSTICS n_custs = ROW_COUNT;

  -- Products cascade into inventory/inventory_ledger/stock_transactions/etc.
  DELETE FROM public.products      WHERE branch_id = p_branch_id AND is_demo;
  GET DIAGNOSTICS n_prods = ROW_COUNT;

  DELETE FROM public.categories    WHERE branch_id = p_branch_id AND is_demo;
  GET DIAGNOSTICS n_cats = ROW_COUNT;

  DELETE FROM public.dining_tables WHERE branch_id = p_branch_id AND is_demo;
  GET DIAGNOSTICS n_tables = ROW_COUNT;

  DELETE FROM public.dining_areas  WHERE branch_id = p_branch_id AND is_demo;
  GET DIAGNOSTICS n_areas = ROW_COUNT;

  -- Any inventory pointing at a demo warehouse, then the warehouse itself.
  DELETE FROM public.inventory WHERE warehouse_id IN (
    SELECT id FROM public.warehouses WHERE branch_id = p_branch_id AND is_demo
  );
  GET DIAGNOSTICS n_inv = ROW_COUNT;

  DELETE FROM public.warehouses    WHERE branch_id = p_branch_id AND is_demo;
  GET DIAGNOSTICS n_wh = ROW_COUNT;

  RETURN jsonb_build_object('success', true,
    'production_orders', n_prod_orders, 'production_waste', n_prod_waste,
    'transfer_items', n_tr_items, 'shift_operations', n_shift_ops,
    'sales', n_sales, 'orders', n_orders, 'customers', n_custs,
    'products', n_prods, 'categories', n_cats, 'tables', n_tables, 'areas', n_areas,
    'inventory', n_inv, 'warehouses', n_wh);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'DELETE_FAILED', 'detail', SQLERRM);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.seed_demo_data(uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_demo_data(uuid) TO authenticated;

-- ==========================================
-- 050_system_control_center.sql
-- ==========================================
-- 050. Centralized System Control Center
-- Stores configurable business/UI behavior without changing application code.
CREATE TABLE IF NOT EXISTS public.system_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "system_settings_select_admin" ON public.system_settings;
CREATE POLICY "system_settings_select_admin" ON public.system_settings
  FOR SELECT TO authenticated
  USING (is_pos_admin());

DROP POLICY IF EXISTS "system_settings_insert_admin" ON public.system_settings;
CREATE POLICY "system_settings_insert_admin" ON public.system_settings
  FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin());

DROP POLICY IF EXISTS "system_settings_update_admin" ON public.system_settings;
CREATE POLICY "system_settings_update_admin" ON public.system_settings
  FOR UPDATE TO authenticated
  USING (is_pos_admin())
  WITH CHECK (is_pos_admin());

INSERT INTO public.system_settings (id, config)
VALUES (1, '{
  "general": {"default_language":"ar","default_currency":"EGP","date_format":"DD/MM/YYYY","time_format":"24h","week_starts":"saturday"},
  "pos": {"default_order_type":"quick","ask_table_people":true,"allow_hold":true,"allow_split":true,"allow_discount":true,"allow_price_override":false,"require_customer":false,"auto_print":false,"auto_close_order":false,"show_product_images":true},
  "order_types": {"dine_in":true,"delivery":true,"takeaway":true,"quick":true,"car":true},
  "payments": {"cash":true,"card":true,"wallet":true,"credit":false,"other":false,"default_method":"cash"},
  "sales": {"tax_enabled":false,"tax_rate":0,"discount_max_percent":100,"allow_returns":true,"return_requires_approval":false,"negative_stock":false,"invoice_prefix":"INV-"},
  "inventory": {"low_stock_threshold":5,"allow_negative":false,"auto_deduct_on_sale":true,"auto_deduct_components":true,"allow_zero_cost":false,"enable_expiry":false},
  "purchases": {"auto_post_inventory":true,"require_receiving":false,"allow_edit_posted":false,"default_payment_status":"unpaid"},
  "manufacturing": {"auto_consume_components":true,"allow_overproduction":false,"require_approval":false,"rounding_decimals":3},
  "accounting": {"auto_journal":true,"fiscal_year_start":"01-01","decimal_places":2,"cost_method":"weighted_average"},
  "customers_suppliers": {"allow_customer_credit":false,"allow_supplier_credit":true,"credit_limit_default":0,"require_phone":false},
  "printing": {"paper":"80mm","copies":1,"show_logo":true,"show_tax":true,"show_cashier":true,"show_customer":true,"show_barcode":true,"footer":"شكراً لزيارتكم"},
  "dashboard": {"default_range":"today","show_sales":true,"show_expenses":true,"show_profit":true,"show_inventory":true,"show_top_products":true,"show_recent_sales":true,"show_payment_chart":true,"show_employee_chart":true},
  "reports": {"default_range":"today","default_rows":25,"show_zero_rows":false,"allow_export_excel":true,"allow_export_pdf":true,"allow_print":true},
  "notifications": {"low_stock":true,"shift_open":true,"shift_close":true,"purchase_due":true,"customer_due":false},
  "security": {"session_timeout_minutes":480,"max_login_attempts":5,"lockout_minutes":15,"require_password_change":false,"audit_all_changes":true},
  "ui": {"compact_tables":false,"animations":true,"confirm_delete":true,"confirm_post":true,"rtl":true,"show_help":true}
}'::jsonb)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.touch_system_settings()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  NEW.updated_by = auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_system_settings ON public.system_settings;
CREATE TRIGGER trg_touch_system_settings
BEFORE UPDATE ON public.system_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_system_settings();

-- ==========================================
-- 051_system_settings_compatibility.sql
-- ==========================================
-- 051. Keep the existing centralized JSONB settings schema compatible with the System Control Center.
-- This migration is intentionally non-destructive: it preserves the existing config row.

CREATE TABLE IF NOT EXISTS public.system_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "system_settings_select_admin" ON public.system_settings;
CREATE POLICY "system_settings_select_admin" ON public.system_settings
  FOR SELECT TO authenticated
  USING (is_pos_admin());

DROP POLICY IF EXISTS "system_settings_insert_admin" ON public.system_settings;
CREATE POLICY "system_settings_insert_admin" ON public.system_settings
  FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin());

DROP POLICY IF EXISTS "system_settings_update_admin" ON public.system_settings;
CREATE POLICY "system_settings_update_admin" ON public.system_settings
  FOR UPDATE TO authenticated
  USING (is_pos_admin())
  WITH CHECK (is_pos_admin());

INSERT INTO public.system_settings (id, config)
VALUES (1, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.touch_system_settings()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  NEW.updated_by = auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_system_settings ON public.system_settings;
CREATE TRIGGER trg_touch_system_settings
BEFORE UPDATE ON public.system_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_system_settings();

-- Refresh PostgREST's schema cache after the compatibility migration.
NOTIFY pgrst, 'reload schema';

-- ==========================================
-- 052_system_integrity_checks.sql
-- ==========================================
-- PHASE 0.2: read-only integrity audit helpers
-- These functions NEVER modify business data. They return counts only.

create or replace function public.system_integrity_audit()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb := '{}'::jsonb;
  n bigint;
begin
  -- Orphan / consistency checks. Missing tables are reported as null rather than
  -- making the whole audit fail on installations with optional modules.
  if to_regclass('public.orders') is not null and to_regclass('public.order_items') is not null then
    select count(*) into n from public.orders o
    where not exists (select 1 from public.order_items i where i.order_id = o.id)
      and coalesce(o.status, '') not in ('cancelled','void','deleted');
    result := result || jsonb_build_object('orders_without_items', n);
  end if;

  if to_regclass('public.order_items') is not null and to_regclass('public.products') is not null then
    select count(*) into n from public.order_items i
    where i.product_id is not null
      and not exists (select 1 from public.products p where p.id = i.product_id);
    result := result || jsonb_build_object('order_items_missing_product', n);
  end if;

  if to_regclass('public.products') is not null and to_regclass('public.branches') is not null then
    select count(*) into n from public.products p
    where p.branch_id is not null
      and not exists (select 1 from public.branches b where b.id = p.branch_id);
    result := result || jsonb_build_object('products_missing_branch', n);
  end if;

  if to_regclass('public.inventory') is not null and to_regclass('public.products') is not null then
    select count(*) into n from public.inventory s
    where s.product_id is not null
      and not exists (select 1 from public.products p where p.id = s.product_id);
    result := result || jsonb_build_object('inventory_missing_product', n);
  elsif to_regclass('public.warehouse_stock') is not null and to_regclass('public.products') is not null then
    select count(*) into n from public.warehouse_stock s
    where s.product_id is not null
      and not exists (select 1 from public.products p where p.id = s.product_id);
    result := result || jsonb_build_object('warehouse_stock_missing_product', n);
  end if;

  if to_regclass('public.purchase_items') is not null and to_regclass('public.purchases') is not null then
    select count(*) into n from public.purchase_items pi
    where pi.purchase_id is not null
      and not exists (select 1 from public.purchases p where p.id = pi.purchase_id);
    result := result || jsonb_build_object('purchase_items_missing_purchase', n);
  end if;

  if to_regclass('public.users') is not null and to_regclass('public.branches') is not null then
    select count(*) into n from public.users u
    where u.branch_id is not null
      and not exists (select 1 from public.branches b where b.id = u.branch_id);
    result := result || jsonb_build_object('users_missing_branch', n);
  end if;

  return result;
end;
$$;

revoke all on function public.system_integrity_audit() from public;
grant execute on function public.system_integrity_audit() to authenticated;

-- ==========================================
-- 053_phase8_12_hardening.sql
-- ==========================================
-- PHASE 8-12: production hardening
-- Branch ownership is mandatory for every user.
ALTER TABLE public.users ALTER COLUMN branch_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_branch_id ON public.users(branch_id);
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_branch_fk_strict;
ALTER TABLE public.users ADD CONSTRAINT users_branch_fk_strict
  FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE RESTRICT;

-- Prevent invalid financial/inventory values.
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_positive_prices;
ALTER TABLE public.products ADD CONSTRAINT products_positive_prices
  CHECK (COALESCE(cost_price,0) >= 0 AND COALESCE(sale_price,0) >= 0 AND COALESCE(wholesale_price,0) >= 0);
ALTER TABLE public.sale_items DROP CONSTRAINT IF EXISTS sale_items_positive_values;
ALTER TABLE public.sale_items ADD CONSTRAINT sale_items_positive_values
  CHECK (quantity > 0 AND unit_price >= 0 AND COALESCE(discount_amount,0) >= 0
         AND COALESCE(refunded_quantity,0) >= 0 AND COALESCE(refunded_amount,0) >= 0);
ALTER TABLE public.purchase_items DROP CONSTRAINT IF EXISTS purchase_items_positive_values;
ALTER TABLE public.purchase_items ADD CONSTRAINT purchase_items_positive_values
  CHECK (quantity > 0 AND unit_cost >= 0 AND COALESCE(total,0) >= 0
         AND COALESCE(returned_quantity,0) >= 0 AND COALESCE(returned_amount,0) >= 0);
ALTER TABLE public.inventory DROP CONSTRAINT IF EXISTS inventory_nonnegative_quantity;
ALTER TABLE public.inventory ADD CONSTRAINT inventory_nonnegative_quantity CHECK (quantity >= 0);
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_nonnegative_amounts;
ALTER TABLE public.shifts ADD CONSTRAINT shifts_nonnegative_amounts
  CHECK (opening_amount >= 0 AND expected_amount >= 0 AND actual_amount >= 0);

-- Performance indexes for branch-scoped reporting and operations.
CREATE INDEX IF NOT EXISTS idx_sales_branch_created_at ON public.sales(branch_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON public.sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON public.sale_items(product_id);
CREATE INDEX IF NOT EXISTS idx_purchases_branch_created_at ON public.purchases(branch_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase_id ON public.purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_inventory_branch_product ON public.inventory(branch_id,product_id);
CREATE INDEX IF NOT EXISTS idx_expenses_branch_date ON public.expenses(branch_id,expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_journal_entries_branch_date ON public.journal_entries(branch_id,entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_orders_branch_created_at ON public.orders(branch_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_branch_created_at ON public.inventory_ledger(branch_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_branch_created_at ON public.audit_log(branch_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customers_branch_id ON public.customers(branch_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_branch_id ON public.suppliers(branch_id);
CREATE INDEX IF NOT EXISTS idx_products_branch_category ON public.products(branch_id,category_id);
CREATE INDEX IF NOT EXISTS idx_shifts_branch_status ON public.shifts(branch_id,status);

-- ==========================================
-- 054_ci_rls_admin_branch_fixture.sql
-- ==========================================
-- CI-only compatibility for the strict branch ownership rule.
--
-- Production rule: public.users.branch_id is NOT NULL (053) and every real
-- user must belong to a branch. The RLS integration fixture historically
-- created super_admin/owner rows with NULL branch_id because those roles can
-- see all branches. That fixture is now incompatible with the production
-- invariant.
--
-- The CI database is identified by auth.is_ci_stub(), which exists only in
-- supabase/ci/stub_auth.sql and is never installed on a real Supabase project.
-- In CI only, assign a missing admin fixture branch to the first branch created
-- by the fixture. This keeps branch_id mandatory while preserving admin-wide
-- visibility semantics. No production database behavior is changed.

DO $$
BEGIN
  IF to_regprocedure('auth.is_ci_stub()') IS NOT NULL THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.ci_assign_admin_fixture_branch()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $body$
      BEGIN
        IF NEW.branch_id IS NULL AND NEW.role IN ('super_admin', 'owner') THEN
          SELECT b.id
            INTO NEW.branch_id
            FROM public.branches b
            ORDER BY b.created_at ASC, b.id ASC
            LIMIT 1;

          IF NEW.branch_id IS NULL THEN
            RAISE EXCEPTION 'CI RLS fixture requires at least one branch before creating an admin user';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $body$;
    $fn$;

    EXECUTE 'DROP TRIGGER IF EXISTS trg_ci_assign_admin_fixture_branch ON public.users';
    EXECUTE $sql$
      CREATE TRIGGER trg_ci_assign_admin_fixture_branch
      BEFORE INSERT ON public.users
      FOR EACH ROW
      EXECUTE FUNCTION public.ci_assign_admin_fixture_branch()
    $sql$;
  END IF;
END $$;

-- ==========================================
-- 055_subscriptions.sql
-- ==========================================
-- ============================================================================
-- 055. Subscriptions: 14-day trial + paid plans (Basic / Standard / Enterprise)
-- ----------------------------------------------------------------------------
-- Adds the subscription layer that gates selling per branch:
--
--   1. subscription_plans        – the three paid tiers (EGP, monthly & yearly).
--   2. branch_subscriptions      – one subscription row per branch (PK=branch_id);
--      status: trial → active / past_due / cancelled / expired.
--   3. subscription_status()     – effective status of a branch (trial window /
--      billing period aware). SECURITY DEFINER so anon/authenticated can query.
--   4. subscription_expired()    – boolean helper used by the sale guard.
--   5. register_branch(...)      – anon self-service signup: creates branch +
--      main warehouse + branch_settings + owner auth account (email confirmed)
--      + a 14-day trial subscription, atomically. Reuses create_user(), which
--      gains an app.register_branch GUC bypass mirroring app.login_guard_bypass.
--   6. activate_subscription()   – admin-only: start/cancel a plan.
--   7. process_sale()            – returns SUBSCRIPTION_EXPIRED before any write
--      when the branch subscription is not active/live-trial. super_admin only
--      is exempt (owners manage plans, they do not bypass the gate).
--
-- Backfill: every existing branch gets an active trial starting now, so nothing
-- already deployed is locked out.
--
-- Additive + idempotent (safe to re-run; the migration runner also gates it by
-- checksum). create_user() and guard_user_role_changes() are re-created with the
-- register_branch bypass; process_sale() is re-created with the gate on top of
-- the exact 047 body.
-- ============================================================================

-- ============ 1. SUBSCRIPTION PLANS ============
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id text PRIMARY KEY,
  name_ar text NOT NULL,
  name_en text NOT NULL,
  monthly_price_egp numeric(10,2) NOT NULL,
  yearly_price_egp numeric(10,2) NOT NULL,
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.subscription_plans (id, name_ar, name_en, monthly_price_egp, yearly_price_egp, features)
VALUES
  ('basic',      'الأساسية', 'Basic',      299, 2990,
    '["Users: 2","Warehouses: 1","Inventory & sales"]'::jsonb),
  ('standard',   'القياسية', 'Standard',   599, 5990,
    '["Users: 5","Warehouses: 3","Accounting & reports"]'::jsonb),
  ('enterprise', 'المتقدمة', 'Enterprise', 999, 9990,
    '["Users: unlimited","Multi-branch","Full suite + priority support"]'::jsonb)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plans_read_all" ON public.subscription_plans;
CREATE POLICY "plans_read_all" ON public.subscription_plans FOR SELECT TO anon, authenticated
  USING (true);

GRANT SELECT ON public.subscription_plans TO anon, authenticated, service_role;

-- ============ 2. BRANCH SUBSCRIPTIONS ============
CREATE TABLE IF NOT EXISTS public.branch_subscriptions (
  branch_id uuid PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
  plan_id text REFERENCES public.subscription_plans(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'trial',
  trial_starts_at timestamptz NOT NULL DEFAULT now(),
  trial_ends_at timestamptz,
  current_period_starts_at timestamptz,
  current_period_ends_at timestamptz,
  cancel_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT branch_subscriptions_status_check
    CHECK (status IN ('trial', 'active', 'past_due', 'cancelled', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_branch_subscriptions_status ON public.branch_subscriptions (status);

ALTER TABLE public.branch_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "subs_select_own" ON public.branch_subscriptions;
CREATE POLICY "subs_select_own" ON public.branch_subscriptions FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());

DROP POLICY IF EXISTS "subs_admin_insert" ON public.branch_subscriptions;
CREATE POLICY "subs_admin_insert" ON public.branch_subscriptions FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin());

DROP POLICY IF EXISTS "subs_admin_update" ON public.branch_subscriptions;
CREATE POLICY "subs_admin_update" ON public.branch_subscriptions FOR UPDATE TO authenticated
  USING (is_pos_admin()) WITH CHECK (is_pos_admin());

DROP POLICY IF EXISTS "subs_admin_delete" ON public.branch_subscriptions;
CREATE POLICY "subs_admin_delete" ON public.branch_subscriptions FOR DELETE TO authenticated
  USING (is_pos_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.branch_subscriptions TO authenticated, service_role;

-- ============ 3. BACKFILL: existing branches start an active trial ============
INSERT INTO public.branch_subscriptions (branch_id, status, trial_starts_at, trial_ends_at)
SELECT b.id, 'trial', now(), now() + interval '14 days'
FROM public.branches b
WHERE NOT EXISTS (SELECT 1 FROM public.branch_subscriptions s WHERE s.branch_id = b.id);

-- ============ 4. STATUS HELPERS ============
CREATE OR REPLACE FUNCTION public.subscription_status(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.branch_subscriptions%ROWTYPE;
  v_status text;
  v_expired boolean;
BEGIN
  SELECT * INTO v_row FROM public.branch_subscriptions WHERE branch_id = p_branch_id;

  IF v_row.branch_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'none', 'plan_id', NULL,
      'expired', true, 'trial_ends_at', NULL, 'current_period_ends_at', NULL
    );
  END IF;

  v_status := v_row.status;
  v_expired := false;

  IF v_status IN ('trial', 'active', 'past_due') THEN
    IF v_status = 'trial' THEN
      IF v_row.trial_ends_at IS NOT NULL AND v_row.trial_ends_at <= now() THEN
        v_status := 'expired';
        v_expired := true;
      END IF;
    ELSE
      IF v_row.current_period_ends_at IS NOT NULL AND v_row.current_period_ends_at <= now() THEN
        v_status := 'expired';
        v_expired := true;
      END IF;
    END IF;
  ELSE
    v_expired := true;
  END IF;

  RETURN jsonb_build_object(
    'branch_id', p_branch_id,
    'status', v_status,
    'plan_id', v_row.plan_id,
    'expired', v_expired,
    'trial_ends_at', v_row.trial_ends_at,
    'current_period_ends_at', v_row.current_period_ends_at,
    'cancelled_at', v_row.cancelled_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.subscription_expired(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (public.subscription_status(p_branch_id)->>'expired')::boolean;
$$;

GRANT EXECUTE ON FUNCTION public.subscription_status(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.subscription_expired(uuid) TO anon, authenticated, service_role;

-- ============ 5. ACTIVATE / CANCEL PLAN (admin only) ============
CREATE OR REPLACE FUNCTION public.activate_subscription(
  p_branch_id uuid,
  p_plan_id text,
  p_billing_period text DEFAULT 'monthly',
  p_activate boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.subscription_plans%ROWTYPE;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_price numeric(10,2);
BEGIN
  IF NOT is_pos_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  IF p_branch_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_NOT_FOUND');
  END IF;

  IF NOT p_activate THEN
    UPDATE public.branch_subscriptions
    SET status = 'cancelled',
        cancel_at = now(),
        cancelled_at = now(),
        updated_at = now()
    WHERE branch_id = p_branch_id;
    RETURN jsonb_build_object('success', true, 'branch_id', p_branch_id, 'status', 'cancelled');
  END IF;

  SELECT * INTO v_plan FROM public.subscription_plans WHERE id = p_plan_id AND is_active;
  IF v_plan.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'PLAN_NOT_FOUND');
  END IF;

  v_period_start := now();
  IF p_billing_period = 'yearly' THEN
    v_period_end := v_period_start + interval '1 year';
    v_price := v_plan.yearly_price_egp;
  ELSE
    v_period_end := v_period_start + interval '1 month';
    v_price := v_plan.monthly_price_egp;
  END IF;

  INSERT INTO public.branch_subscriptions (
    branch_id, plan_id, status,
    trial_starts_at, trial_ends_at,
    current_period_starts_at, current_period_ends_at,
    cancel_at, cancelled_at, updated_at
  ) VALUES (
    p_branch_id, v_plan.id, 'active',
    NULL, NULL,
    v_period_start, v_period_end,
    NULL, NULL, now()
  )
  ON CONFLICT (branch_id) DO UPDATE SET
    plan_id = EXCLUDED.plan_id,
    status = 'active',
    trial_starts_at = NULL,
    trial_ends_at = NULL,
    current_period_starts_at = EXCLUDED.current_period_starts_at,
    current_period_ends_at = EXCLUDED.current_period_ends_at,
    cancel_at = NULL,
    cancelled_at = NULL,
    updated_at = now();

  RETURN jsonb_build_object('success', true, 'branch_id', p_branch_id, 'status', 'active',
    'plan_id', v_plan.id, 'price_egp', v_price);
END;
$$;

GRANT EXECUTE ON FUNCTION public.activate_subscription(uuid, text, text, boolean) TO authenticated, service_role;

-- ============ 6. create_user: register_branch GUC bypass ============
-- Mirrors the app.login_guard_bypass pattern so the anon self-service RPC can
-- provision the owner account while everything else stays admin/branch-manager.
CREATE OR REPLACE FUNCTION public.create_user(
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

  IF current_setting('app.register_branch', true) = 'on' THEN
    NULL; -- trusted caller: register_branch (SECURITY DEFINER) pre-validates
  ELSIF is_pos_admin() THEN
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

  -- Custom-role aware: the assigned role must exist in the matrix and be
  -- assignable by the caller (BM: global or own-branch roles only).
  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE role = p_role) THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ROLE');
  END IF;
  IF v_caller_role = 'branch_manager' AND NOT EXISTS (
    SELECT 1 FROM public.roles
    WHERE role = p_role AND (scope = 'global' OR branch_id = v_caller_branch)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED',
      'detail', 'Role not assignable in this branch');
  END IF;
  v_role := p_role;

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

GRANT EXECUTE ON FUNCTION public.create_user(text, text, text, text, uuid, boolean, text) TO authenticated;

-- ============ 7. guard_user_role_changes: register_branch bypass ============
CREATE OR REPLACE FUNCTION public.guard_user_role_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_caller_role text;
  v_caller_branch uuid;
  v_bypass boolean;
  v_register boolean;
BEGIN
  SELECT role, branch_id INTO v_caller_role, v_caller_branch
  FROM public.users WHERE id = auth.uid();

  v_bypass := COALESCE(current_setting('app.login_guard_bypass', true), '') = 'on';
  v_register := COALESCE(current_setting('app.register_branch', true), '') = 'on';

  -- Self-service registration: register_branch (SECURITY DEFINER) owns the whole
  -- user row (owner account for the freshly created branch).
  IF v_register THEN
    RETURN NEW;
  END IF;

  -- Assigned role must exist in the matrix.
  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE role = NEW.role) THEN
    RAISE EXCEPTION 'UNKNOWN_ROLE';
  END IF;

  -- Unknown / anonymous caller (e.g. anon lockout RPC, or self-registration).
  IF v_caller_role IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      -- Self-registration: fresh basic cashier profile owned by the caller
      -- (RLS already enforces this exact shape).
      IF NEW.id = auth.uid() AND NEW.role = 'cashier' AND NEW.branch_id IS NULL THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'PERMISSION_DENIED';
    END IF;
    -- UPDATE: only lockout counters may change (record_login_failure as anon).
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.role IS DISTINCT FROM OLD.role
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.is_active IS DISTINCT FROM OLD.is_active
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.username IS DISTINCT FROM OLD.username
       OR NEW.full_name IS DISTINCT FROM OLD.full_name
       OR NEW.phone IS DISTINCT FROM OLD.phone THEN
      RAISE EXCEPTION 'PERMISSION_DENIED';
    END IF;
    RETURN NEW;
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

      -- Lockout fields are system-managed (only the lockout RPC may touch them).
      IF NOT v_bypass THEN
        IF NEW.is_locked IS DISTINCT FROM OLD.is_locked
           OR NEW.failed_attempts IS DISTINCT FROM OLD.failed_attempts
           OR NEW.lock_until IS DISTINCT FROM OLD.lock_until THEN
          RAISE EXCEPTION 'PERMISSION_DENIED: users cannot modify their own lock state';
        END IF;
      END IF;
    END IF;
  END IF;

  -- Branch managers may only manage staff of their own branch.
  IF v_caller_role = 'branch_manager' THEN
    IF NEW.branch_id IS DISTINCT FROM v_caller_branch THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: branch managers can only manage their own branch';
    END IF;
    -- Assigned role must be a global role or a role of this branch.
    IF NOT EXISTS (
      SELECT 1 FROM public.roles
      WHERE role = NEW.role AND is_active AND (scope = 'global' OR branch_id = v_caller_branch)
    ) THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: role is not assignable in this branch';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ============ 8. register_branch: anon self-service signup ============
CREATE OR REPLACE FUNCTION public.register_branch(
  p_store_name text,
  p_owner_name text,
  p_email text,
  p_password text,
  p_store_name_en text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_currency text DEFAULT 'EGP'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
  v_warehouse_id uuid;
  v_user_id uuid;
  v_email text;
  v_global_tax numeric(5,2);
  v_global_tax_enabled boolean;
  v_global_currency text;
  v_res jsonb;
BEGIN
  BEGIN
    v_email := lower(btrim(p_email));
    IF v_email = '' OR v_email !~ '@' OR v_email !~ '.' THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_EMAIL');
    END IF;
    IF p_password IS NULL OR length(p_password) < 6 THEN
      RETURN jsonb_build_object('success', false, 'error', 'WEAK_PASSWORD');
    END IF;
    IF btrim(coalesce(p_store_name, '')) = '' THEN
      RETURN jsonb_build_object('success', false, 'error', 'MISSING_STORE_NAME');
    END IF;

    IF EXISTS (SELECT 1 FROM auth.users WHERE email = v_email)
       OR EXISTS (SELECT 1 FROM public.users WHERE email = v_email) THEN
      RETURN jsonb_build_object('success', false, 'error', 'EMAIL_TAKEN');
    END IF;

    INSERT INTO public.branches (name, name_en, address, phone, is_active)
    VALUES (p_store_name, p_store_name_en, p_address, p_phone, true)
    RETURNING id INTO v_branch_id;

    INSERT INTO public.warehouses (name, branch_id, is_active)
    VALUES (p_store_name || ' - Main', v_branch_id, true)
    RETURNING id INTO v_warehouse_id;

    SELECT COALESCE(tax_rate, 15), COALESCE(tax_enabled, true), COALESCE(currency, 'EGP')
    INTO v_global_tax, v_global_tax_enabled, v_global_currency
    FROM public.settings ORDER BY id LIMIT 1;

    INSERT INTO public.branch_settings (branch_id, tax_rate, tax_enabled, currency, low_stock_threshold)
    VALUES (v_branch_id, v_global_tax, v_global_tax_enabled,
      COALESCE(NULLIF(btrim(p_currency), ''), v_global_currency), 10);

    INSERT INTO public.branch_subscriptions (branch_id, status, trial_starts_at, trial_ends_at)
    VALUES (v_branch_id, 'trial', now(), now() + interval '14 days');

    -- Provision the owner auth account (email confirmed) inside the same
    -- transaction. register_branch owns the whole row, so the guard bypasses.
    PERFORM set_config('app.register_branch', 'on', true);
    v_res := public.create_user(v_email, p_password, p_owner_name, 'owner', v_branch_id, true, NULL);
    PERFORM set_config('app.register_branch', 'off', true);

    IF NOT COALESCE((v_res->>'success')::boolean, false) THEN
      RAISE EXCEPTION 'USER_CREATE_FAILED: %', coalesce(v_res->>'error', 'UNKNOWN');
    END IF;
    v_user_id := (v_res->>'user_id')::uuid;

    RETURN jsonb_build_object('success', true,
      'branch_id', v_branch_id, 'warehouse_id', v_warehouse_id,
      'user_id', v_user_id, 'trial_days', 14);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'REGISTRATION_FAILED', 'detail', SQLERRM);
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_branch(text, text, text, text, text, text, text, text)
  TO anon, authenticated, service_role;

-- ============ 9. process_sale: subscription gate on the exact 047 body ============
-- The 19-arg overload from 038/045 is dropped first (matching 047); the single
-- 20-arg implementation below keeps the same call shape plus p_guest_count.
DROP FUNCTION IF EXISTS public.process_sale(
  text, uuid, uuid, uuid, uuid, numeric, numeric, text, numeric, numeric,
  numeric, numeric, text, text, jsonb, uuid, text, uuid, uuid);

CREATE OR REPLACE FUNCTION public.process_sale(p_invoice_number text, p_branch_id uuid, p_warehouse_id uuid, p_customer_id uuid, p_salesperson_id uuid, p_subtotal numeric, p_discount_amount numeric, p_discount_type text, p_tax_amount numeric, p_bonus_amount numeric, p_total numeric, p_paid_amount numeric, p_payment_method text, p_status text, p_items jsonb, p_shift_id uuid DEFAULT NULL::uuid, p_order_type text DEFAULT 'takeaway', p_table_id uuid DEFAULT NULL::uuid, p_order_id uuid DEFAULT NULL::uuid, p_guest_count integer DEFAULT NULL::integer)
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
  v_subtotal numeric(14,2) := 0;
  v_discount numeric(14,2);
  v_tax numeric(14,2) := 0;
  v_tax_enabled boolean;
  v_tax_rate numeric(14,2);
  v_total numeric(14,2);
  v_paid numeric(14,2);
  v_ar numeric(14,2);
  v_lines jsonb := '[]'::jsonb;
  v_dr numeric(14,2) := 0;
  v_cr numeric(14,2) := 0;
  v_diff numeric(14,2);
  v_balance_account text;
  v_order_table uuid;
BEGIN
  BEGIN
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'EMPTY_CART');
    END IF;

    -- Subscription gate: only super_admin may sell on an expired / non-active
    -- subscription. Owners manage plans from the console but do not bypass.
    IF NOT EXISTS (
      SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'super_admin'
    ) AND public.subscription_expired(p_branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'SUBSCRIPTION_EXPIRED',
        'subscription', public.subscription_status(p_branch_id));
    END IF;

    SELECT role, branch_id INTO v_role, v_user_branch FROM public.users WHERE id = auth.uid();

    -- Branch isolation (mirror of RLS on sales)
    IF NOT is_pos_admin() THEN
      IF v_user_branch IS NOT NULL AND v_user_branch <> p_branch_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    -- Origin table must belong to the sale branch
    IF p_table_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.dining_tables WHERE id = p_table_id AND branch_id = p_branch_id
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'TABLE_NOT_IN_BRANCH', 'table_id', p_table_id);
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

    -- ===== VALIDATE the linked order BEFORE any writes =====
    -- FOUND (not the table value) is what matters: a held takeaway/delivery
    -- order legitimately has table_id = NULL and must still be payable. Any
    -- RETURN here is safe because nothing has been written yet.
    IF p_order_id IS NOT NULL THEN
      SELECT table_id INTO v_order_table
      FROM public.orders
      WHERE id = p_order_id AND branch_id = p_branch_id AND status IN ('open', 'held');

      IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND',
          'detail', 'The order must exist, belong to this branch, and be open or held. No sale was created.');
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

      -- Accumulate the authoritative subtotal (catalog price, clamped discount)
      SELECT COALESCE(sale_price, 0) INTO v_unit_price FROM products WHERE id = v_product_id;
      v_discount_amount := GREATEST(COALESCE((v_item->>'discount_amount')::numeric, 0), 0);
      IF v_discount_amount > v_quantity * v_unit_price THEN
        v_discount_amount := v_quantity * v_unit_price;
      END IF;
      v_subtotal := v_subtotal + ROUND(v_quantity * v_unit_price - v_discount_amount, 2);
    END LOOP;

    -- ===== SERVER-SIDE HEADER TOTALS (computed from authoritative prices) =====
    v_discount := GREATEST(COALESCE(p_discount_amount, 0), 0);
    IF v_discount > v_subtotal THEN v_discount := v_subtotal; END IF;
    SELECT COALESCE(tax_enabled, false), COALESCE(tax_rate, 0) INTO v_tax_enabled, v_tax_rate
    FROM public.settings LIMIT 1;
    IF v_tax_enabled THEN
      v_tax := ROUND((v_subtotal - v_discount) * v_tax_rate / 100, 2);
    END IF;
    v_total := ROUND(v_subtotal - v_discount + v_tax, 2);
    v_paid := ROUND(GREATEST(COALESCE(p_paid_amount, 0), 0), 2);
    v_ar := ROUND(GREATEST(v_total - v_paid, 0), 2);

    -- ===== WRITE PHASE 1: sale header (authoritative totals) =====
    INSERT INTO sales (invoice_number, branch_id, warehouse_id, customer_id, cashier_id, salesperson_id,
      subtotal, discount_amount, discount_type, tax_amount, bonus_amount, total, paid_amount, payment_method, status, order_type, table_id, guest_count)
    VALUES (p_invoice_number, p_branch_id, p_warehouse_id, p_customer_id, auth.uid(), p_salesperson_id,
      v_subtotal, v_discount, p_discount_type, v_tax, COALESCE(p_bonus_amount, 0),
      v_total, v_paid, p_payment_method, p_status, COALESCE(p_order_type, 'takeaway'), p_table_id, p_guest_count)
    RETURNING id INTO v_sale_id;

    -- ===== WRITE PHASE 2: items + FIFO stock deduction + ledger =====
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
      v_discount_amount := GREATEST(COALESCE((v_item->>'discount_amount')::numeric, 0), 0);

      SELECT sale_price INTO v_unit_price FROM products WHERE id = v_product_id;
      v_unit_price := COALESCE(v_unit_price, 0);
      IF v_discount_amount > v_quantity * v_unit_price THEN
        v_discount_amount := v_quantity * v_unit_price;
      END IF;
      v_bonus_quantity := COALESCE((v_item->>'bonus_quantity')::numeric, 0);
      v_item_total := ROUND(v_quantity * v_unit_price - v_discount_amount, 2);

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

    -- ===== WRITE PHASE 2b: settle the linked order + free tables atomically =====
    -- H4: only free a table when NO other open/held order still references it.
    -- H3: a direct dine-in sale (no linked order) frees its origin table here,
    --     inside the sale transaction, instead of client-side afterwards.
    IF p_order_id IS NOT NULL THEN
      UPDATE public.orders SET status = 'completed', completed_at = now(), updated_at = now()
      WHERE id = p_order_id;
      -- NULL table (held takeaway/delivery) has no table to free.
      IF v_order_table IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.orders
        WHERE table_id = v_order_table AND status IN ('open', 'held') AND id <> p_order_id
      ) THEN
        UPDATE public.dining_tables SET status = 'vacant', updated_at = now()
        WHERE id = v_order_table;
      END IF;
    ELSIF p_table_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.orders
      WHERE table_id = p_table_id AND status IN ('open', 'held')
    ) THEN
      UPDATE public.dining_tables SET status = 'vacant', updated_at = now()
      WHERE id = p_table_id;
    END IF;

    -- ===== WRITE PHASE 3: log the sale into the active shift =====
    IF v_shift_id IS NOT NULL THEN
      INSERT INTO shift_operations (shift_id, operation_type, amount, payment_method, reference_type, reference_id, created_by)
      VALUES (v_shift_id, 'sale', v_paid, p_payment_method, 'sale', v_sale_id, auth.uid());
    END IF;

    -- ===== WRITE PHASE 4: post the sales + COGS journal entry =====
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
    IF v_discount > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'discount_given', 'debit', v_discount, 'credit', 0);
      v_dr := v_dr + v_discount;
    END IF;
    IF v_subtotal > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'revenue', 'debit', 0, 'credit', v_subtotal);
      v_cr := v_cr + v_subtotal;
    END IF;
    IF v_tax > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'vat_payable', 'debit', 0, 'credit', v_tax);
      v_cr := v_cr + v_tax;
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

GRANT EXECUTE ON FUNCTION public.process_sale(text, uuid, uuid, uuid, uuid, numeric, numeric, text, numeric, numeric, numeric, numeric, text, text, jsonb, uuid, text, uuid, uuid, integer) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ==========================================
-- 056_fix_activate_subscription.sql
-- ==========================================
-- ============================================================================
-- 056. Fix activate_subscription: never touch NOT NULL trial columns
-- ----------------------------------------------------------------------------
-- 055 activated a plan by writing trial_starts_at/trial_ends_at = NULL, but
-- both columns are NOT NULL, so every activate_subscription call raised
-- "null value in column trial_starts_at". The trial fields are historical once
-- the row becomes 'active' (subscription_status reads current_period_ends_at),
-- so activation now leaves them untouched. Idempotent.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.activate_subscription(
  p_branch_id uuid,
  p_plan_id text,
  p_billing_period text DEFAULT 'monthly',
  p_activate boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.subscription_plans%ROWTYPE;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_price numeric(10,2);
BEGIN
  IF NOT is_pos_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  IF p_branch_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_NOT_FOUND');
  END IF;

  IF NOT p_activate THEN
    UPDATE public.branch_subscriptions
    SET status = 'cancelled',
        cancel_at = now(),
        cancelled_at = now(),
        updated_at = now()
    WHERE branch_id = p_branch_id;
    RETURN jsonb_build_object('success', true, 'branch_id', p_branch_id, 'status', 'cancelled');
  END IF;

  SELECT * INTO v_plan FROM public.subscription_plans WHERE id = p_plan_id AND is_active;
  IF v_plan.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'PLAN_NOT_FOUND');
  END IF;

  v_period_start := now();
  IF p_billing_period = 'yearly' THEN
    v_period_end := v_period_start + interval '1 year';
    v_price := v_plan.yearly_price_egp;
  ELSE
    v_period_end := v_period_start + interval '1 month';
    v_price := v_plan.monthly_price_egp;
  END IF;

  INSERT INTO public.branch_subscriptions (
    branch_id, plan_id, status,
    current_period_starts_at, current_period_ends_at,
    cancel_at, cancelled_at, updated_at
  ) VALUES (
    p_branch_id, v_plan.id, 'active',
    v_period_start, v_period_end,
    NULL, NULL, now()
  )
  ON CONFLICT (branch_id) DO UPDATE SET
    plan_id = EXCLUDED.plan_id,
    status = 'active',
    current_period_starts_at = EXCLUDED.current_period_starts_at,
    current_period_ends_at = EXCLUDED.current_period_ends_at,
    cancel_at = NULL,
    cancelled_at = NULL,
    updated_at = now();

  RETURN jsonb_build_object('success', true, 'branch_id', p_branch_id, 'status', 'active',
    'plan_id', v_plan.id, 'price_egp', v_price);
END;
$$;

GRANT EXECUTE ON FUNCTION public.activate_subscription(uuid, text, text, boolean) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ==========================================
-- 057_subscriptions_implicit_trial.sql
-- ==========================================
-- ============================================================================
-- 057. Implicit 14-day trial for branches without a subscription row
-- ----------------------------------------------------------------------------
-- The 055 sale guard blocks any branch whose subscription is not active / on a
-- live trial. subscription_status() treated a branch with NO row in
-- branch_subscriptions as 'none' + expired, which locked out two legitimate
-- cases:
--
--   1. Branches created directly by an admin from the branches panel (a plain
--      INSERT into public.branches, not register_branch): they never received a
--      subscription row, so every non-super_admin sale returned SUBSCRIPTION_EXPIRED.
--   2. Integration tests that insert fixture branches directly: the guard now
--      short-circuits them with SUBSCRIPTION_EXPIRED before any sale logic runs.
--
-- Fix: when a branch exists but has no subscription row, subscription_status()
-- now reports the same trial register_branch()/the 055 backfill grant, anchored
-- to branches.created_at so it is a real, non-renewable 14-day window. Unknown
-- branch ids (no row AND no branch) still report 'none'/expired. Idempotent.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.subscription_status(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.branch_subscriptions%ROWTYPE;
  v_created timestamptz;
  v_implicit_end timestamptz;
  v_status text;
  v_expired boolean;
BEGIN
  SELECT * INTO v_row FROM public.branch_subscriptions WHERE branch_id = p_branch_id;

  IF v_row.branch_id IS NULL THEN
    SELECT created_at INTO v_created FROM public.branches WHERE id = p_branch_id;
    IF v_created IS NULL THEN
      RETURN jsonb_build_object(
        'branch_id', p_branch_id,
        'status', 'none', 'plan_id', NULL,
        'expired', true, 'trial_ends_at', NULL,
        'current_period_ends_at', NULL, 'cancelled_at', NULL
      );
    END IF;
    v_implicit_end := v_created + interval '14 days';
    RETURN jsonb_build_object(
      'branch_id', p_branch_id,
      'status', 'trial', 'plan_id', NULL,
      'expired', v_implicit_end <= now(),
      'trial_ends_at', v_implicit_end,
      'current_period_ends_at', NULL, 'cancelled_at', NULL
    );
  END IF;

  v_status := v_row.status;
  v_expired := false;

  IF v_status IN ('trial', 'active', 'past_due') THEN
    IF v_status = 'trial' THEN
      IF v_row.trial_ends_at IS NOT NULL AND v_row.trial_ends_at <= now() THEN
        v_status := 'expired';
        v_expired := true;
      END IF;
    ELSE
      IF v_row.current_period_ends_at IS NOT NULL AND v_row.current_period_ends_at <= now() THEN
        v_status := 'expired';
        v_expired := true;
      END IF;
    END IF;
  ELSE
    v_expired := true;
  END IF;

  RETURN jsonb_build_object(
    'branch_id', p_branch_id,
    'status', v_status,
    'plan_id', v_row.plan_id,
    'expired', v_expired,
    'trial_ends_at', v_row.trial_ends_at,
    'current_period_ends_at', v_row.current_period_ends_at,
    'cancelled_at', v_row.cancelled_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.subscription_status(uuid) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ==========================================
-- 058_super_admin_subscription_control.sql
-- ==========================================
-- 058. Super Admin-only subscription control and DB sale guard
-- Keeps subscription management exclusive to the super_admin role.

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.is_active AND u.role = 'super_admin'
  );
$$;
REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;

CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id text PRIMARY KEY,
  name_ar text NOT NULL,
  name_en text NOT NULL,
  monthly_price_egp numeric(10,2) NOT NULL DEFAULT 0,
  yearly_price_egp numeric(10,2) NOT NULL DEFAULT 0,
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.branch_subscriptions (
  branch_id uuid PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
  plan_id text REFERENCES public.subscription_plans(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'trial',
  trial_starts_at timestamptz NOT NULL DEFAULT now(),
  trial_ends_at timestamptz,
  current_period_starts_at timestamptz,
  current_period_ends_at timestamptz,
  cancel_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT branch_subscriptions_status_check CHECK (status IN ('trial','active','past_due','cancelled','expired'))
);

INSERT INTO public.subscription_plans (id,name_ar,name_en,monthly_price_egp,yearly_price_egp,features)
VALUES
('basic','الأساسية','Basic',299,2990,'["Users: 2","Warehouses: 1","Inventory & sales"]'),
('standard','القياسية','Standard',599,5990,'["Users: 5","Warehouses: 3","Accounting & reports"]'),
('enterprise','المتقدمة','Enterprise',999,9990,'["Users: unlimited","Multi-branch","Full suite + priority support"]')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.branch_subscriptions(branch_id,status,trial_starts_at,trial_ends_at)
SELECT b.id,'trial',now(),now()+interval '14 days'
FROM public.branches b
WHERE NOT EXISTS (SELECT 1 FROM public.branch_subscriptions s WHERE s.branch_id=b.id);

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscription_plans_public_read ON public.subscription_plans;
CREATE POLICY subscription_plans_public_read ON public.subscription_plans FOR SELECT TO anon,authenticated USING (is_active=true);
DROP POLICY IF EXISTS subscription_plans_super_admin_write ON public.subscription_plans;
CREATE POLICY subscription_plans_super_admin_write ON public.subscription_plans FOR ALL TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());
DROP POLICY IF EXISTS branch_subscriptions_super_admin_only ON public.branch_subscriptions;
CREATE POLICY branch_subscriptions_super_admin_only ON public.branch_subscriptions FOR ALL TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());
GRANT SELECT ON public.subscription_plans TO anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.subscription_plans, public.branch_subscriptions TO authenticated;

CREATE OR REPLACE FUNCTION public.subscription_status(p_branch_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.branch_subscriptions%ROWTYPE; s text; e boolean;
BEGIN
 SELECT * INTO r FROM public.branch_subscriptions WHERE branch_id=p_branch_id;
 IF r.branch_id IS NULL THEN RETURN jsonb_build_object('status','none','expired',true,'branch_id',p_branch_id); END IF;
 s:=r.status; e:=false;
 IF s='trial' AND r.trial_ends_at IS NOT NULL AND r.trial_ends_at<=now() THEN s:='expired'; e:=true;
 ELSIF s IN ('active','past_due') AND r.current_period_ends_at IS NOT NULL AND r.current_period_ends_at<=now() THEN s:='expired'; e:=true;
 ELSIF s IN ('cancelled','expired') THEN e:=true; END IF;
 RETURN jsonb_build_object('branch_id',p_branch_id,'status',s,'plan_id',r.plan_id,'expired',e,'trial_ends_at',r.trial_ends_at,'current_period_ends_at',r.current_period_ends_at,'cancelled_at',r.cancelled_at);
END; $$;
REVOKE ALL ON FUNCTION public.subscription_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.subscription_status(uuid) TO anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.subscription_expired(p_branch_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE((public.subscription_status(p_branch_id)->>'expired')::boolean, true);
$$;
REVOKE ALL ON FUNCTION public.subscription_expired(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.subscription_expired(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.activate_subscription(p_branch_id uuid,p_plan_id text,p_billing_period text DEFAULT 'monthly',p_activate boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p public.subscription_plans%ROWTYPE; st timestamptz:=now(); en timestamptz; price numeric(10,2);
BEGIN
 IF NOT is_super_admin() THEN RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.branches WHERE id=p_branch_id) THEN RETURN jsonb_build_object('success',false,'error','BRANCH_NOT_FOUND'); END IF;
 IF NOT p_activate THEN
   UPDATE public.branch_subscriptions SET status='cancelled',cancel_at=now(),cancelled_at=now(),updated_at=now() WHERE branch_id=p_branch_id;
   RETURN jsonb_build_object('success',true,'status','cancelled','branch_id',p_branch_id);
 END IF;
 SELECT * INTO p FROM public.subscription_plans WHERE id=p_plan_id AND is_active;
 IF p.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','PLAN_NOT_FOUND'); END IF;
 IF p_billing_period='yearly' THEN en:=st+interval '1 year'; price:=p.yearly_price_egp; ELSE en:=st+interval '1 month'; price:=p.monthly_price_egp; END IF;
 INSERT INTO public.branch_subscriptions(branch_id,plan_id,status,trial_starts_at,trial_ends_at,current_period_starts_at,current_period_ends_at,cancel_at,cancelled_at,updated_at)
 VALUES(p_branch_id,p.id,'active',NULL,NULL,st,en,NULL,NULL,now())
 ON CONFLICT(branch_id) DO UPDATE SET plan_id=excluded.plan_id,status='active',trial_starts_at=NULL,trial_ends_at=NULL,current_period_starts_at=excluded.current_period_starts_at,current_period_ends_at=excluded.current_period_ends_at,cancel_at=NULL,cancelled_at=NULL,updated_at=now();
 RETURN jsonb_build_object('success',true,'status','active','branch_id',p_branch_id,'plan_id',p.id,'price_egp',price,'current_period_ends_at',en);
END; $$;
REVOKE ALL ON FUNCTION public.activate_subscription(uuid,text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_subscription(uuid,text,text,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_order_subscription()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role' THEN RETURN NEW; END IF;
  IF public.is_super_admin() THEN RETURN NEW; END IF;
  IF NEW.branch_id IS NULL OR public.subscription_expired(NEW.branch_id) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_EXPIRED' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_order_subscription() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_order_subscription() TO authenticated,service_role;
DROP TRIGGER IF EXISTS trg_guard_order_subscription ON public.orders;
CREATE TRIGGER trg_guard_order_subscription BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.guard_order_subscription();

-- ==========================================
-- 059_instapay_subscription_payments.sql
-- ==========================================
-- 059. InstaPay subscription transfer workflow
-- Super Admin is global and is never restricted to a branch.

CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  plan_id text REFERENCES public.subscription_plans(id) ON DELETE SET NULL,
  amount numeric(10,2) NOT NULL CHECK (amount >= 0),
  billing_period text NOT NULL DEFAULT 'monthly' CHECK (billing_period IN ('monthly','yearly')),
  payment_method text NOT NULL DEFAULT 'instapay' CHECK (payment_method = 'instapay'),
  reference text,
  receipt_url text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  submitted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscription_payments_branch ON public.subscription_payments(branch_id);
CREATE INDEX IF NOT EXISTS idx_subscription_payments_status ON public.subscription_payments(status);

ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subscription_payments_super_admin_all ON public.subscription_payments;
CREATE POLICY subscription_payments_super_admin_all ON public.subscription_payments FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

CREATE OR REPLACE FUNCTION public.submit_instapay_payment(p_branch_id uuid,p_plan_id text,p_amount numeric,p_billing_period text DEFAULT 'monthly',p_reference text DEFAULT NULL,p_receipt_url text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RETURN jsonb_build_object('success',false,'error','UNAUTHENTICATED'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id=uid AND u.is_active) THEN RETURN jsonb_build_object('success',false,'error','USER_INACTIVE'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id=p_branch_id) THEN RETURN jsonb_build_object('success',false,'error','BRANCH_NOT_FOUND'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE id=p_plan_id AND is_active) THEN RETURN jsonb_build_object('success',false,'error','PLAN_NOT_FOUND'); END IF;
  IF p_amount <= 0 THEN RETURN jsonb_build_object('success',false,'error','INVALID_AMOUNT'); END IF;
  INSERT INTO public.subscription_payments(branch_id,plan_id,amount,billing_period,reference,receipt_url,submitted_by)
  VALUES(p_branch_id,p_plan_id,p_amount,p_billing_period,p_reference,p_receipt_url,uid);
  RETURN jsonb_build_object('success',true,'status','pending');
END; $$;
REVOKE ALL ON FUNCTION public.submit_instapay_payment(uuid,text,numeric,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_instapay_payment(uuid,text,numeric,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.review_instapay_payment(p_payment_id uuid,p_approve boolean,p_rejection_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE pay public.subscription_payments%ROWTYPE; uid uuid := auth.uid();
BEGIN
  IF NOT public.is_super_admin() THEN RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED'); END IF;
  SELECT * INTO pay FROM public.subscription_payments WHERE id=p_payment_id FOR UPDATE;
  IF pay.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','PAYMENT_NOT_FOUND'); END IF;
  IF pay.status <> 'pending' THEN RETURN jsonb_build_object('success',false,'error','PAYMENT_ALREADY_REVIEWED'); END IF;
  IF NOT p_approve THEN
    UPDATE public.subscription_payments SET status='rejected',rejected_at=now(),rejection_reason=p_rejection_reason,approved_by=uid,updated_at=now() WHERE id=p_payment_id;
    RETURN jsonb_build_object('success',true,'status','rejected');
  END IF;
  UPDATE public.subscription_payments SET status='approved',approved_by=uid,approved_at=now(),updated_at=now() WHERE id=p_payment_id;
  PERFORM public.activate_subscription(pay.branch_id,pay.plan_id,pay.billing_period,true);
  RETURN jsonb_build_object('success',true,'status','approved','branch_id',pay.branch_id);
END; $$;
REVOKE ALL ON FUNCTION public.review_instapay_payment(uuid,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_instapay_payment(uuid,boolean,text) TO authenticated;

-- ==========================================
-- 059_subscription_ci_bypass.sql
-- ==========================================
-- 059. CI-only subscription bypass hook
-- The flag is OFF by default and is never set on a real Supabase project.
-- It exists so disposable Postgres integration fixtures can test POS/RLS
-- behavior without a subscription fixture masking the behavior under test.

CREATE OR REPLACE FUNCTION public.subscription_expired(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN current_setting('app.ci_subscription_bypass', true) = 'on' THEN false
    ELSE COALESCE((public.subscription_status(p_branch_id)->>'expired')::boolean, true)
  END;
$$;

REVOKE ALL ON FUNCTION public.subscription_expired(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.subscription_expired(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ==========================================
-- 060_branch_isolate_raw_materials.sql
-- ==========================================
-- Branch isolation for raw materials and recipe items.
-- Super Admin/Owner remain global through the canonical is_pos_admin() helper;
-- branch users are restricted through get_branch_id().

ALTER TABLE public.raw_materials ADD COLUMN IF NOT EXISTS branch_id uuid;

-- Backfill materials that are used by exactly one branch from their recipe.
UPDATE public.raw_materials rm
SET branch_id = x.branch_id
FROM (
  SELECT ri.raw_material_id,
         (array_agg(r.branch_id ORDER BY r.branch_id))[1] AS branch_id
  FROM public.recipe_items ri
  JOIN public.recipes r ON r.id = ri.recipe_id
  WHERE r.branch_id IS NOT NULL
  GROUP BY ri.raw_material_id
  HAVING count(DISTINCT r.branch_id) = 1
) x
WHERE rm.id = x.raw_material_id AND rm.branch_id IS NULL;

-- Legacy materials with no unambiguous recipe ownership are assigned to the
-- oldest branch, matching the project's existing catalog backfill convention.
DO $$
DECLARE
  v_default_branch uuid;
BEGIN
  SELECT id INTO v_default_branch
  FROM public.branches
  ORDER BY created_at, id
  LIMIT 1;

  IF v_default_branch IS NULL THEN
    INSERT INTO public.branches (name) VALUES ('الفرع الرئيسي')
    RETURNING id INTO v_default_branch;
  END IF;

  UPDATE public.raw_materials
  SET branch_id = v_default_branch
  WHERE branch_id IS NULL;
END $$;

ALTER TABLE public.raw_materials ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE public.raw_materials DROP CONSTRAINT IF EXISTS raw_materials_branch_id_fkey;
ALTER TABLE public.raw_materials
  ADD CONSTRAINT raw_materials_branch_id_fkey
  FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_raw_materials_branch_id ON public.raw_materials(branch_id);

ALTER TABLE public.raw_materials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS raw_materials_write ON public.raw_materials;
DROP POLICY IF EXISTS raw_materials_select_branch_isolated ON public.raw_materials;
DROP POLICY IF EXISTS raw_materials_insert_branch_isolated ON public.raw_materials;
DROP POLICY IF EXISTS raw_materials_update_branch_isolated ON public.raw_materials;
DROP POLICY IF EXISTS raw_materials_delete_branch_isolated ON public.raw_materials;

CREATE POLICY raw_materials_select_branch_isolated
ON public.raw_materials FOR SELECT
USING (public.is_pos_admin() OR branch_id = public.get_branch_id());

CREATE POLICY raw_materials_insert_branch_isolated
ON public.raw_materials FOR INSERT
WITH CHECK (public.is_pos_admin() OR branch_id = public.get_branch_id());

CREATE POLICY raw_materials_update_branch_isolated
ON public.raw_materials FOR UPDATE
USING (public.is_pos_admin() OR branch_id = public.get_branch_id())
WITH CHECK (public.is_pos_admin() OR branch_id = public.get_branch_id());

CREATE POLICY raw_materials_delete_branch_isolated
ON public.raw_materials FOR DELETE
USING (public.is_pos_admin() OR branch_id = public.get_branch_id());

-- Prevent recipe items from connecting a recipe to a raw material owned by
-- another branch. SECURITY DEFINER is intentional so validation is not
-- bypassed by RLS visibility.
CREATE OR REPLACE FUNCTION public.validate_recipe_item_branch_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recipe_branch uuid;
  material_branch uuid;
BEGIN
  SELECT branch_id INTO recipe_branch
  FROM public.recipes
  WHERE id = NEW.recipe_id;

  SELECT branch_id INTO material_branch
  FROM public.raw_materials
  WHERE id = NEW.raw_material_id;

  IF recipe_branch IS NULL OR material_branch IS NULL OR recipe_branch <> material_branch THEN
    RAISE EXCEPTION 'RAW_MATERIAL_BRANCH_MISMATCH';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_recipe_item_branch ON public.recipe_items;
CREATE TRIGGER trg_validate_recipe_item_branch
BEFORE INSERT OR UPDATE ON public.recipe_items
FOR EACH ROW EXECUTE FUNCTION public.validate_recipe_item_branch_match();

-- ==========================================
-- 060_harden_instapay_submission.sql
-- ==========================================
-- 060. Harden InstaPay submission and enforce branch ownership.
-- Super Admin is global; ordinary users can submit only for their own branch.

CREATE OR REPLACE FUNCTION public.submit_instapay_payment(
  p_branch_id uuid,
  p_plan_id text,
  p_amount numeric,
  p_billing_period text DEFAULT 'monthly',
  p_reference text DEFAULT NULL,
  p_receipt_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  expected_amount numeric;
  own_branch uuid;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','UNAUTHENTICATED');
  END IF;

  SELECT u.branch_id INTO own_branch
  FROM public.users u
  WHERE u.id = uid AND u.is_active;

  IF own_branch IS NULL AND NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('success',false,'error','NO_BRANCH');
  END IF;

  IF NOT public.is_super_admin() AND own_branch <> p_branch_id THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_ACCESS_DENIED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = p_branch_id AND b.is_active) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_NOT_FOUND');
  END IF;

  IF p_billing_period NOT IN ('monthly','yearly') THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_BILLING_PERIOD');
  END IF;

  SELECT CASE WHEN p_billing_period = 'yearly' THEN yearly_price_egp ELSE monthly_price_egp END
  INTO expected_amount
  FROM public.subscription_plans
  WHERE id = p_plan_id AND is_active;

  IF expected_amount IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','PLAN_NOT_FOUND');
  END IF;

  IF p_amount <> expected_amount THEN
    RETURN jsonb_build_object('success',false,'error','AMOUNT_MISMATCH','expected_amount',expected_amount);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.subscription_payments sp
    WHERE sp.branch_id = p_branch_id
      AND sp.status = 'pending'
  ) THEN
    RETURN jsonb_build_object('success',false,'error','PENDING_PAYMENT_EXISTS');
  END IF;

  INSERT INTO public.subscription_payments(
    branch_id, plan_id, amount, billing_period, reference, receipt_url, submitted_by
  )
  VALUES(
    p_branch_id, p_plan_id, p_amount, p_billing_period, NULLIF(trim(p_reference), ''), NULLIF(trim(p_receipt_url), ''), uid
  );

  RETURN jsonb_build_object('success',true,'status','pending');
END;
$$;

REVOKE ALL ON FUNCTION public.submit_instapay_payment(uuid,text,numeric,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_instapay_payment(uuid,text,numeric,text,text,text) TO authenticated;

CREATE INDEX IF NOT EXISTS idx_subscription_payments_pending_branch
  ON public.subscription_payments(branch_id)
  WHERE status = 'pending';

-- ==========================================
-- 061_instapay_payment_read_policy.sql
-- ==========================================
-- 061. Allow users to view only their own branch's InstaPay payment history.
DROP POLICY IF EXISTS subscription_payments_branch_read ON public.subscription_payments;
CREATE POLICY subscription_payments_branch_read
ON public.subscription_payments
FOR SELECT TO authenticated
USING (
  public.is_super_admin()
  OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND u.is_active
      AND u.branch_id = subscription_payments.branch_id
  )
);

