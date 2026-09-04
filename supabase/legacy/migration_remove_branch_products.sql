-- =============================================================
-- Migration: Remove the branch_products junction layer
--
-- Products already carry branch_id (NOT NULL) as their single
-- authoritative home branch, so the branch_products junction
-- table is redundant. This migration:
--
--   1. Drops the auto-assign trigger + function.
--   2. Updates replace_product_units to stop checking branch_products.
--   3. Drops branch_products (policies, helper function, table).
--      ~108 link rows are removed but NO product data is lost:
--      products live in `products` and branches live in `branches`.
--   4. Rewrites products / product_units / product_components RLS
--      to the clean single pattern:
--        is_pos_admin() OR branch_id = get_branch_id()
--      (product_units / product_components isolate through their parent
--      product's branch_id).
--   5. Drops the duplicate legacy audit_log SELECT policy and the two
--      empty _legacy shift tables.
--   6. Rewrites process_sale: product must belong to the sale branch
--      (product.branch_id = p_branch_id) instead of being "assigned"
--      via branch_products; removes the per-branch price override.
--      Component consumption is untouched here (removed in Phase B).
-- =============================================================

BEGIN;

-- ---------- 1. DROP AUTO-ASSIGN TRIGGER + FUNCTION ----------
DROP TRIGGER IF EXISTS trg_products_auto_assign_branch ON public.products;
DROP FUNCTION IF EXISTS public.auto_assign_branch_product();

-- ---------- 2. replace_product_units: stop referencing branch_products ----------
CREATE OR REPLACE FUNCTION public.replace_product_units(p_product_id uuid, p_units jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      AND v_product_branch = get_branch_id()
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
$function$;

-- ---------- 3. DROP EVERY POLICY THAT REFERENCES branch_products ----------
DROP POLICY IF EXISTS "auth_select_products" ON public.products;
DROP POLICY IF EXISTS "auth_insert_products" ON public.products;
DROP POLICY IF EXISTS "auth_update_products" ON public.products;
DROP POLICY IF EXISTS "auth_delete_products" ON public.products;
DROP POLICY IF EXISTS "products_select" ON public.products;
DROP POLICY IF EXISTS "products_write" ON public.products;
DROP POLICY IF EXISTS "auth_select_product_units" ON public.product_units;
DROP POLICY IF EXISTS "auth_insert_product_units" ON public.product_units;
DROP POLICY IF EXISTS "auth_update_product_units" ON public.product_units;
DROP POLICY IF EXISTS "auth_delete_product_units" ON public.product_units;
DROP POLICY IF EXISTS "product_units_select" ON public.product_units;
DROP POLICY IF EXISTS "product_units_write" ON public.product_units;
DROP POLICY IF EXISTS "auth_select_product_components" ON public.product_components;
DROP POLICY IF EXISTS "auth_insert_product_components" ON public.product_components;
DROP POLICY IF EXISTS "auth_update_product_components" ON public.product_components;
DROP POLICY IF EXISTS "auth_delete_product_components" ON public.product_components;
DROP POLICY IF EXISTS "auth_select_branch_products" ON public.branch_products;
DROP POLICY IF EXISTS "auth_insert_branch_products" ON public.branch_products;
DROP POLICY IF EXISTS "auth_update_branch_products" ON public.branch_products;
DROP POLICY IF EXISTS "auth_delete_branch_products" ON public.branch_products;
DROP POLICY IF EXISTS "auth_select_audit_log" ON public.audit_log;

-- ---------- 4. DROP branch_products (helper function + table) ----------
DROP FUNCTION IF EXISTS public.branch_products_can_update(uuid, uuid, uuid);
DROP TABLE IF EXISTS public.branch_products;

-- ---------- 5. PRODUCTS RLS (clean single pattern) ----------
CREATE POLICY "auth_select_products" ON public.products FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());
CREATE POLICY "auth_insert_products" ON public.products FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id());
CREATE POLICY "auth_update_products" ON public.products FOR UPDATE TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id())
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id());
CREATE POLICY "auth_delete_products" ON public.products FOR DELETE TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());

-- ---------- 6. PRODUCT_UNITS RLS (isolated via parent product) ----------
CREATE POLICY "auth_select_product_units" ON public.product_units FOR SELECT TO authenticated
  USING (is_pos_admin() OR EXISTS (
    SELECT 1 FROM public.products p WHERE p.id = product_units.product_id AND p.branch_id = get_branch_id()
  ));
CREATE POLICY "auth_insert_product_units" ON public.product_units FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR EXISTS (
    SELECT 1 FROM public.products p WHERE p.id = product_units.product_id AND p.branch_id = get_branch_id()
  ));
CREATE POLICY "auth_update_product_units" ON public.product_units FOR UPDATE TO authenticated
  USING (is_pos_admin() OR EXISTS (
    SELECT 1 FROM public.products p WHERE p.id = product_units.product_id AND p.branch_id = get_branch_id()
  ))
  WITH CHECK (is_pos_admin() OR EXISTS (
    SELECT 1 FROM public.products p WHERE p.id = product_units.product_id AND p.branch_id = get_branch_id()
  ));
CREATE POLICY "auth_delete_product_units" ON public.product_units FOR DELETE TO authenticated
  USING (is_pos_admin() OR EXISTS (
    SELECT 1 FROM public.products p WHERE p.id = product_units.product_id AND p.branch_id = get_branch_id()
  ));

-- ---------- 7. PRODUCT_COMPONENTS RLS (isolated via parent product) ----------
CREATE POLICY "auth_select_product_components" ON public.product_components FOR SELECT TO authenticated
  USING (is_pos_admin() OR EXISTS (
    SELECT 1 FROM public.products p WHERE p.id = product_components.product_id AND p.branch_id = get_branch_id()
  ));
CREATE POLICY "auth_insert_product_components" ON public.product_components FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR (
    get_user_role() IN ('warehouse_manager','branch_manager')
    AND EXISTS (
      SELECT 1 FROM public.products p WHERE p.id = product_components.product_id AND p.branch_id = get_branch_id()
    )
  ));
CREATE POLICY "auth_update_product_components" ON public.product_components FOR UPDATE TO authenticated
  USING (is_pos_admin() OR (
    get_user_role() IN ('warehouse_manager','branch_manager')
    AND EXISTS (
      SELECT 1 FROM public.products p WHERE p.id = product_components.product_id AND p.branch_id = get_branch_id()
    )
  ))
  WITH CHECK (is_pos_admin() OR (
    get_user_role() IN ('warehouse_manager','branch_manager')
    AND EXISTS (
      SELECT 1 FROM public.products p WHERE p.id = product_components.product_id AND p.branch_id = get_branch_id()
    )
  ));
CREATE POLICY "auth_delete_product_components" ON public.product_components FOR DELETE TO authenticated
  USING (is_pos_admin() OR (
    get_user_role() IN ('warehouse_manager','branch_manager')
    AND EXISTS (
      SELECT 1 FROM public.products p WHERE p.id = product_components.product_id AND p.branch_id = get_branch_id()
    )
  ));

-- ---------- 8. AUDIT LOG: drop the admin-only duplicate SELECT ----------
-- (auth_select_audit_log was dropped in section 3; keep the branch-scoped
-- audit_log_select, audit_log_insert and audit_log_admin policies.)

-- ---------- 9. DROP EMPTY LEGACY SHIFT TABLES ----------
-- CASCADE only removes their own internal dependents (RLS policies,
-- FKs, indexes, defaults) — there are no external references.
DROP TABLE IF EXISTS public.shifts_legacy_20260801_180124 CASCADE;
DROP TABLE IF EXISTS public.shift_operations_legacy_20260801_180124 CASCADE;

-- ---------- 10. process_sale: branch ownership instead of assignment ----------
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

      -- Branch ownership: the product must belong to the sale branch
      -- (products.branch_id is the single authoritative home branch).
      IF NOT EXISTS (
        SELECT 1 FROM products WHERE id = v_product_id AND branch_id = p_branch_id
      ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_IN_BRANCH',
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

COMMIT;

-- Refresh the PostgREST schema cache so the dropped table is gone from the API
NOTIFY pgrst, 'reload schema';
