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
