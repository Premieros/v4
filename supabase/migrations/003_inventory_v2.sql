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
