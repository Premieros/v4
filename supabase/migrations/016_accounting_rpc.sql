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
