-- Route POS sales through unit inventory instead of product inventory_batches.
-- Product -> unit links are the only sale components; raw materials remain manufacturing-only.

DO $do$
DECLARE
  v_src text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public'
    AND p.proname='process_sale'
    AND pg_get_function_identity_arguments(p.oid) = 'p_invoice_number text, p_branch_id uuid, p_warehouse_id uuid, p_customer_id uuid, p_salesperson_id uuid, p_subtotal numeric, p_discount_amount numeric, p_discount_type text, p_tax_amount numeric, p_bonus_amount numeric, p_total numeric, p_paid_amount numeric, p_payment_method text, p_status text, p_items jsonb, p_shift_id uuid, p_order_type text, p_table_id uuid, p_order_id uuid, p_guest_count integer';
  IF v_src IS NULL THEN RAISE EXCEPTION 'process_sale target signature not found'; END IF;

  v_old := $a$      SELECT COALESCE(SUM(quantity), 0) INTO v_available
      FROM inventory_batches
      WHERE product_id = v_product_id AND warehouse_id = ANY(v_warehouse_ids);
      IF v_available < v_quantity THEN
        RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_STOCK',
          'product_id', v_product_id, 'required', v_quantity, 'available', v_available);
      END IF;
$a$;
  v_src := replace(v_src, v_old, '');

  v_old := $a$      v_res := public._product_inv_remove_fifo(v_product_id, NULL, p_branch_id, v_quantity,
        'sale', 'sale', v_sale_id, p_invoice_number, auth.uid());
      v_short := (v_res->>'shortage')::numeric;
      IF v_short > 0 THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: product % needs % but only % available',
          v_product_id, v_quantity, (v_quantity - v_short);
      END IF;
      v_cogs_total := v_cogs_total + COALESCE((v_res->>'total_cost')::numeric, 0);
$a$;
  v_new := $b$      v_res := public.deduct_sale_unit_inventory(
        p_branch_id,
        p_warehouse_id,
        jsonb_build_array(v_item),
        v_sale_id,
        p_invoice_number
      );
      IF COALESCE((v_res->>'success')::boolean, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'UNIT_SALE_DEDUCTION_FAILED: %', COALESCE(v_res->>'detail', v_res->>'error', 'unknown');
      END IF;
      v_cogs_total := v_cogs_total + COALESCE((v_res->>'total_cost')::numeric, 0);
$b$;
  v_src := replace(v_src, v_old, v_new);

  EXECUTE v_src;
END
$do$;
