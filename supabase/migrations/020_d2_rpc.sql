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
