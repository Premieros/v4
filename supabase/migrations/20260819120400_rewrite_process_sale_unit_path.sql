-- Finalize the POS sale path after 20260819120300.
-- That migration already rewrites process_sale to use unit inventory and removes
-- the legacy product inventory validation/deduction. This migration is an
-- idempotent verification gate rather than a second rewrite.

DO $do$
DECLARE
  v_src text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'process_sale'
    AND pg_get_function_identity_arguments(p.oid) = 'p_invoice_number text, p_branch_id uuid, p_warehouse_id uuid, p_customer_id uuid, p_salesperson_id uuid, p_subtotal numeric, p_discount_amount numeric, p_discount_type text, p_tax_amount numeric, p_bonus_amount numeric, p_total numeric, p_paid_amount numeric, p_payment_method text, p_status text, p_items jsonb, p_shift_id uuid, p_order_type text, p_table_id uuid, p_order_id uuid, p_guest_count integer';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'target process_sale not found';
  END IF;

  IF position('deduct_sale_unit_inventory' in v_src) = 0 THEN
    RAISE EXCEPTION 'process_sale is not routed through unit inventory';
  END IF;

  IF position('_product_inv_remove_fifo' in v_src) > 0 THEN
    RAISE EXCEPTION 'legacy product inventory deduction remains in process_sale';
  END IF;

  IF position('FROM inventory_batches' in v_src) > 0 THEN
    RAISE EXCEPTION 'legacy product inventory validation remains in process_sale';
  END IF;
END
$do$;
