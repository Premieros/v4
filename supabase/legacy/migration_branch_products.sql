-- =============================================================
-- Migration: Branch Product Assignment (junction table)
-- Run this in Supabase SQL Editor AFTER migration_enterprise_core.sql
--
-- 1. Creates branch_products (branch_id, product_id, is_active,
--    selling_price, display_order) as the authoritative source of
--    which products are sellable at each branch.
-- 2. Backfills one row per existing product into its own branch.
-- 3. Relaxes products / product_units RLS so a branch can read/edit
--    products assigned to it even when the product "home" branch differs.
-- 4. Hardens process_sale: products not assigned to the branch are
--    rejected, and the per-branch selling_price overrides the price.
-- =============================================================

-- ---------- 1. JUNCTION TABLE ----------
CREATE TABLE IF NOT EXISTS branch_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  selling_price numeric(12,2),
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_branch_products_branch_id ON branch_products(branch_id);
CREATE INDEX IF NOT EXISTS idx_branch_products_product_id ON branch_products(product_id);

ALTER TABLE branch_products ENABLE ROW LEVEL SECURITY;

-- ---------- 2. BACKFILL existing products into their own branch ----------
INSERT INTO branch_products (branch_id, product_id, is_active, selling_price, display_order)
SELECT p.branch_id, p.id, true, NULL, 0
FROM products p
ON CONFLICT (branch_id, product_id) DO NOTHING;

-- ---------- 3. RLS ----------
-- Admins manage everything. Branch staff see / update their own rows
-- (selling_price, is_active) but can never move a row to another branch.
DROP POLICY IF EXISTS "auth_select_branch_products" ON branch_products;
CREATE POLICY "auth_select_branch_products" ON branch_products FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());

DROP POLICY IF EXISTS "auth_insert_branch_products" ON branch_products;
CREATE POLICY "auth_insert_branch_products" ON branch_products FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin());

DROP POLICY IF EXISTS "auth_update_branch_products" ON branch_products;
-- Branch staff may edit their own rows (price/active) but can never move a
-- row to another branch or re-point it at a different product. `NEW` cannot
-- be used inside a policy subquery, so validate against the pre-update row
-- with a SECURITY DEFINER helper.
CREATE OR REPLACE FUNCTION branch_products_can_update(p_row_id uuid, p_new_branch uuid, p_new_product uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_old_branch uuid;
  v_old_product uuid;
BEGIN
  SELECT branch_id, product_id INTO v_old_branch, v_old_product
  FROM public.branch_products WHERE id = p_row_id;
  IF v_old_branch IS NULL THEN
    RETURN false;
  END IF;
  RETURN v_old_branch = get_branch_id()
    AND v_old_branch = p_new_branch
    AND v_old_product = p_new_product;
END;
$$;

CREATE POLICY "auth_update_branch_products" ON branch_products FOR UPDATE TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id())
  WITH CHECK (is_pos_admin() OR branch_products_can_update(id, branch_id, product_id));

DROP POLICY IF EXISTS "auth_delete_branch_products" ON branch_products;
CREATE POLICY "auth_delete_branch_products" ON branch_products FOR DELETE TO authenticated
  USING (is_pos_admin());

-- ---------- 4. RELAX products RLS for assigned cross-branch products ----------
DROP POLICY IF EXISTS "auth_select_products" ON products;
CREATE POLICY "auth_select_products" ON products FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id()
    OR EXISTS (
      SELECT 1 FROM branch_products bp
      WHERE bp.product_id = products.id AND bp.branch_id = get_branch_id() AND bp.is_active
    ));

DROP POLICY IF EXISTS "auth_insert_products" ON products;
CREATE POLICY "auth_insert_products" ON products FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id());

DROP POLICY IF EXISTS "auth_update_products" ON products;
CREATE POLICY "auth_update_products" ON products FOR UPDATE TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id()
    OR EXISTS (
      SELECT 1 FROM branch_products bp
      WHERE bp.product_id = products.id AND bp.branch_id = get_branch_id() AND bp.is_active
    ))
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id()
    OR EXISTS (
      SELECT 1 FROM branch_products bp
      WHERE bp.product_id = products.id AND bp.branch_id = get_branch_id() AND bp.is_active
    ));

DROP POLICY IF EXISTS "auth_delete_products" ON products;
CREATE POLICY "auth_delete_products" ON products FOR DELETE TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id()
    OR EXISTS (
      SELECT 1 FROM branch_products bp
      WHERE bp.product_id = products.id AND bp.branch_id = get_branch_id() AND bp.is_active
    ));

-- ---------- 5. RELAX product_units RLS for assigned cross-branch products ----------
DROP POLICY IF EXISTS "auth_select_product_units" ON product_units;
CREATE POLICY "auth_select_product_units" ON product_units FOR SELECT TO authenticated
  USING (is_pos_admin() OR EXISTS (
    SELECT 1 FROM products p WHERE p.id = product_units.product_id
    AND (p.branch_id = get_branch_id() OR p.branch_id IS NULL
      OR EXISTS (
        SELECT 1 FROM branch_products bp
        WHERE bp.product_id = p.id AND bp.branch_id = get_branch_id() AND bp.is_active
      ))
  ));

DROP POLICY IF EXISTS "auth_insert_product_units" ON product_units;
CREATE POLICY "auth_insert_product_units" ON product_units FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR EXISTS (
    SELECT 1 FROM products p WHERE p.id = product_units.product_id
    AND (p.branch_id = get_branch_id() OR p.branch_id IS NULL
      OR EXISTS (
        SELECT 1 FROM branch_products bp
        WHERE bp.product_id = p.id AND bp.branch_id = get_branch_id() AND bp.is_active
      ))
  ));

DROP POLICY IF EXISTS "auth_update_product_units" ON product_units;
CREATE POLICY "auth_update_product_units" ON product_units FOR UPDATE TO authenticated
  USING (is_pos_admin() OR EXISTS (
    SELECT 1 FROM products p WHERE p.id = product_units.product_id
    AND (p.branch_id = get_branch_id() OR p.branch_id IS NULL
      OR EXISTS (
        SELECT 1 FROM branch_products bp
        WHERE bp.product_id = p.id AND bp.branch_id = get_branch_id() AND bp.is_active
      ))
  ))
  WITH CHECK (is_pos_admin() OR EXISTS (
    SELECT 1 FROM products p WHERE p.id = product_units.product_id
    AND (p.branch_id = get_branch_id() OR p.branch_id IS NULL
      OR EXISTS (
        SELECT 1 FROM branch_products bp
        WHERE bp.product_id = p.id AND bp.branch_id = get_branch_id() AND bp.is_active
      ))
  ));

DROP POLICY IF EXISTS "auth_delete_product_units" ON product_units;
CREATE POLICY "auth_delete_product_units" ON product_units FOR DELETE TO authenticated
  USING (is_pos_admin() OR EXISTS (
    SELECT 1 FROM products p WHERE p.id = product_units.product_id
    AND (p.branch_id = get_branch_id() OR p.branch_id IS NULL
      OR EXISTS (
        SELECT 1 FROM branch_products bp
        WHERE bp.product_id = p.id AND bp.branch_id = get_branch_id() AND bp.is_active
      ))
  ));

-- ---------- 6. HARDEN process_sale ----------
--   * Rejects products not assigned (and active) for the branch.
--   * Applies the per-branch selling_price and recomputes item totals.
-- The active overload used by the app is the 16-arg one (with p_shift_id).
-- The legacy 15-arg overload is dropped to avoid ambiguity.

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
  v_discount_amount numeric(14,2);
  v_bonus_quantity numeric(14,4);
  v_item_total numeric(14,2);
  v_price_override numeric(12,2);
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

      -- Branch product assignment: the product must be assigned & active
      -- for this branch (defense-in-depth behind the junction-based POS load).
      IF NOT EXISTS (
        SELECT 1 FROM branch_products
        WHERE branch_id = p_branch_id AND product_id = v_product_id AND is_active
      ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_ASSIGNED',
          'product_id', v_product_id, 'branch_id', p_branch_id);
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

      -- Apply the per-branch price override (authoritative for this branch)
      SELECT selling_price INTO v_price_override
      FROM branch_products
      WHERE branch_id = p_branch_id AND product_id = v_product_id AND is_active;
      IF v_price_override IS NOT NULL AND v_price_override > 0 THEN
        v_unit_price := v_price_override;
        v_item_total := v_quantity * v_unit_price - v_discount_amount;
      END IF;

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

-- Refresh the PostgREST schema cache so new tables/constraints (shifts, users FKs, branch_products)
-- are immediately available to the API without a manual reload.
NOTIFY pgrst, 'reload schema';
