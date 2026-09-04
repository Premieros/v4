-- Super Admin data management center
-- Branch-scoped destructive operations and complete demo-data seeding.

CREATE OR REPLACE FUNCTION public.admin_data_delete_section(p_branch_id uuid, p_section text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE v_count bigint := 0; v_total bigint := 0;
BEGIN
  IF NOT public.is_super_admin() THEN RETURN jsonb_build_object('success', false, 'error', 'SUPER_ADMIN_ONLY'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id) THEN RETURN jsonb_build_object('success', false, 'error', 'BRANCH_NOT_FOUND'); END IF;
  CASE p_section
    WHEN 'catalog' THEN
      DELETE FROM public.order_kitchen_sends WHERE branch_id=p_branch_id;
      DELETE FROM public.order_items WHERE order_id IN (SELECT id FROM public.orders WHERE branch_id=p_branch_id);
      DELETE FROM public.orders WHERE branch_id=p_branch_id;
      DELETE FROM public.customer_payments WHERE sale_id IN (SELECT id FROM public.sales WHERE branch_id=p_branch_id);
      DELETE FROM public.sale_items WHERE sale_id IN (SELECT id FROM public.sales WHERE branch_id=p_branch_id);
      DELETE FROM public.sales WHERE branch_id=p_branch_id;
      DELETE FROM public.product_cost_history WHERE product_id IN (SELECT id FROM public.products WHERE branch_id=p_branch_id);
      DELETE FROM public.product_components WHERE product_id IN (SELECT id FROM public.products WHERE branch_id=p_branch_id) OR component_product_id IN (SELECT id FROM public.products WHERE branch_id=p_branch_id);
      DELETE FROM public.inventory_batches WHERE branch_id=p_branch_id;
      DELETE FROM public.inventory_ledger WHERE branch_id=p_branch_id;
      DELETE FROM public.stock_transactions WHERE branch_id=p_branch_id;
      DELETE FROM public.inventory WHERE branch_id=p_branch_id;
      DELETE FROM public.product_units WHERE product_id IN (SELECT id FROM public.products WHERE branch_id=p_branch_id);
      DELETE FROM public.products WHERE branch_id=p_branch_id;
      DELETE FROM public.categories WHERE branch_id=p_branch_id;
    WHEN 'customers' THEN
      DELETE FROM public.customer_payments WHERE branch_id=p_branch_id;
      DELETE FROM public.journal_entry_lines WHERE customer_id IN (SELECT id FROM public.customers WHERE branch_id=p_branch_id);
      DELETE FROM public.customers WHERE branch_id=p_branch_id;
    WHEN 'suppliers' THEN
      DELETE FROM public.supplier_quotation_items WHERE quotation_id IN (SELECT id FROM public.supplier_quotations WHERE branch_id=p_branch_id);
      DELETE FROM public.supplier_quotations WHERE branch_id=p_branch_id;
      DELETE FROM public.supplier_payments WHERE branch_id=p_branch_id;
      DELETE FROM public.journal_entry_lines WHERE supplier_id IN (SELECT id FROM public.suppliers WHERE branch_id=p_branch_id);
      DELETE FROM public.suppliers WHERE branch_id=p_branch_id;
    WHEN 'sales' THEN
      DELETE FROM public.shift_operations WHERE operation_type='sale' AND reference_id IN (SELECT id FROM public.sales WHERE branch_id=p_branch_id);
      DELETE FROM public.customer_payments WHERE sale_id IN (SELECT id FROM public.sales WHERE branch_id=p_branch_id);
      DELETE FROM public.sale_items WHERE sale_id IN (SELECT id FROM public.sales WHERE branch_id=p_branch_id);
      DELETE FROM public.sales WHERE branch_id=p_branch_id;
    WHEN 'orders' THEN
      DELETE FROM public.order_kitchen_sends WHERE branch_id=p_branch_id;
      DELETE FROM public.order_items WHERE order_id IN (SELECT id FROM public.orders WHERE branch_id=p_branch_id);
      DELETE FROM public.orders WHERE branch_id=p_branch_id;
    WHEN 'purchasing' THEN
      DELETE FROM public.purchase_receipt_items WHERE receipt_id IN (SELECT id FROM public.purchase_receipts WHERE branch_id=p_branch_id);
      DELETE FROM public.purchase_receipts WHERE branch_id=p_branch_id;
      DELETE FROM public.supplier_payments WHERE branch_id=p_branch_id;
      DELETE FROM public.purchase_items WHERE purchase_id IN (SELECT id FROM public.purchases WHERE branch_id=p_branch_id);
      DELETE FROM public.purchases WHERE branch_id=p_branch_id;
      DELETE FROM public.supplier_quotation_items WHERE quotation_id IN (SELECT id FROM public.supplier_quotations WHERE branch_id=p_branch_id);
      DELETE FROM public.supplier_quotations WHERE branch_id=p_branch_id;
      DELETE FROM public.rfq_items WHERE rfq_id IN (SELECT id FROM public.rfqs WHERE branch_id=p_branch_id);
      DELETE FROM public.rfqs WHERE branch_id=p_branch_id;
      DELETE FROM public.purchase_request_items WHERE request_id IN (SELECT id FROM public.purchase_requests WHERE branch_id=p_branch_id);
      DELETE FROM public.purchase_requests WHERE branch_id=p_branch_id;
    WHEN 'manufacturing' THEN
      DELETE FROM public.production_waste WHERE branch_id=p_branch_id;
      DELETE FROM public.production_orders WHERE branch_id=p_branch_id;
      DELETE FROM public.recipe_items WHERE recipe_id IN (SELECT id FROM public.recipes WHERE branch_id=p_branch_id);
      DELETE FROM public.recipes WHERE branch_id=p_branch_id;
      DELETE FROM public.raw_material_batches WHERE branch_id=p_branch_id;
      DELETE FROM public.raw_material_inventory WHERE branch_id=p_branch_id;
      DELETE FROM public.raw_materials WHERE branch_id=p_branch_id;
    WHEN 'accounting' THEN
      DELETE FROM public.bank_statement_lines WHERE reconciliation_id IN (SELECT id FROM public.bank_reconciliations WHERE branch_id=p_branch_id);
      DELETE FROM public.bank_reconciliations WHERE branch_id=p_branch_id;
      DELETE FROM public.journal_entry_lines WHERE journal_entry_id IN (SELECT id FROM public.journal_entries WHERE branch_id=p_branch_id);
      DELETE FROM public.journal_entries WHERE branch_id=p_branch_id;
      DELETE FROM public.treasury_transactions WHERE branch_id=p_branch_id;
      DELETE FROM public.treasury_accounts WHERE branch_id=p_branch_id;
      DELETE FROM public.account_mappings WHERE branch_id=p_branch_id;
      DELETE FROM public.chart_of_accounts WHERE branch_id=p_branch_id AND NOT is_system;
    WHEN 'shifts' THEN
      DELETE FROM public.shift_operations WHERE shift_id IN (SELECT id FROM public.shifts WHERE branch_id=p_branch_id);
      DELETE FROM public.shifts WHERE branch_id=p_branch_id;
    WHEN 'tables' THEN
      DELETE FROM public.dining_tables WHERE branch_id=p_branch_id;
      DELETE FROM public.dining_areas WHERE branch_id=p_branch_id;
    WHEN 'warehouses' THEN
      DELETE FROM public.warehouse_transfer_items WHERE transfer_id IN (SELECT id FROM public.warehouse_transfers WHERE branch_id=p_branch_id);
      DELETE FROM public.warehouse_transfers WHERE branch_id=p_branch_id;
      DELETE FROM public.inventory_batches WHERE branch_id=p_branch_id;
      DELETE FROM public.inventory_ledger WHERE branch_id=p_branch_id;
      DELETE FROM public.stock_transactions WHERE branch_id=p_branch_id;
      DELETE FROM public.inventory WHERE branch_id=p_branch_id;
      DELETE FROM public.warehouses WHERE branch_id=p_branch_id;
    WHEN 'expenses' THEN
      DELETE FROM public.expenses WHERE branch_id=p_branch_id;
    WHEN 'all' THEN
      PERFORM public.admin_data_delete_section(p_branch_id,'orders');
      PERFORM public.admin_data_delete_section(p_branch_id,'sales');
      PERFORM public.admin_data_delete_section(p_branch_id,'purchasing');
      PERFORM public.admin_data_delete_section(p_branch_id,'manufacturing');
      PERFORM public.admin_data_delete_section(p_branch_id,'customers');
      PERFORM public.admin_data_delete_section(p_branch_id,'suppliers');
      PERFORM public.admin_data_delete_section(p_branch_id,'shifts');
      PERFORM public.admin_data_delete_section(p_branch_id,'tables');
      PERFORM public.admin_data_delete_section(p_branch_id,'catalog');
      PERFORM public.admin_data_delete_section(p_branch_id,'warehouses');
      PERFORM public.admin_data_delete_section(p_branch_id,'expenses');
      RETURN jsonb_build_object('success',true,'section','all');
    ELSE RETURN jsonb_build_object('success',false,'error','INVALID_SECTION');
  END CASE;
  RETURN jsonb_build_object('success',true,'section',p_section,'affected',v_total);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error','DELETE_FAILED','detail',SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_data_seed_all(p_branch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE
  v_user uuid:=auth.uid(); v_wh uuid; v_product uuid; v_supplier uuid; v_raw uuid; v_unit uuid; v_recipe uuid;
  v_purchase uuid; v_sale uuid; v_order uuid; v_customer uuid; v_shift uuid; v_cash_account uuid; v_treasury uuid; v_total numeric;
BEGIN
  IF NOT public.is_super_admin() THEN RETURN jsonb_build_object('success',false,'error','SUPER_ADMIN_ONLY'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id=p_branch_id) THEN RETURN jsonb_build_object('success',false,'error','BRANCH_NOT_FOUND'); END IF;
  PERFORM public.seed_demo_data(p_branch_id);
  SELECT id INTO v_wh FROM public.warehouses WHERE branch_id=p_branch_id ORDER BY is_demo DESC,created_at LIMIT 1;
  SELECT id INTO v_product FROM public.products WHERE branch_id=p_branch_id AND is_demo ORDER BY created_at LIMIT 1;
  SELECT id INTO v_customer FROM public.customers WHERE branch_id=p_branch_id AND is_demo ORDER BY created_at LIMIT 1;
  SELECT id INTO v_supplier FROM public.suppliers WHERE branch_id=p_branch_id AND name='مورد تجريبي' LIMIT 1;
  IF v_supplier IS NULL THEN INSERT INTO public.suppliers(name,name_en,phone,branch_id,is_active,notes) VALUES('مورد تجريبي','Demo Supplier','01000000000',p_branch_id,true,'بيانات تجريبية') RETURNING id INTO v_supplier; END IF;
  SELECT id INTO v_unit FROM public.units ORDER BY id LIMIT 1;
  IF v_unit IS NOT NULL THEN
    SELECT id INTO v_raw FROM public.raw_materials WHERE branch_id=p_branch_id AND code='DEMO-RAW-001' LIMIT 1;
    IF v_raw IS NULL THEN
      INSERT INTO public.raw_materials(code,name,unit_id,category,min_stock,default_cost,is_active,branch_id) VALUES('DEMO-RAW-001','مادة خام تجريبية',v_unit,'مواد خام',10,5,true,p_branch_id) RETURNING id INTO v_raw;
      INSERT INTO public.raw_material_inventory(raw_material_id,branch_id,quantity,avg_cost,min_stock) VALUES(v_raw,p_branch_id,100,5,10);
      INSERT INTO public.raw_material_batches(raw_material_id,branch_id,batch_number,quantity,unit_cost,source_type) VALUES(v_raw,p_branch_id,'DEMO-RAW-BATCH',100,5,'opening');
    END IF;
  END IF;
  IF v_raw IS NOT NULL AND v_product IS NOT NULL THEN
    SELECT id INTO v_recipe FROM public.recipes WHERE branch_id=p_branch_id AND product_id=v_product LIMIT 1;
    IF v_recipe IS NULL THEN
      INSERT INTO public.recipes(product_id,branch_id,name,yield_quantity,is_active,notes) VALUES(v_product,p_branch_id,'وصفة تجريبية',1,true,'وصفة بيانات تجريبية') RETURNING id INTO v_recipe;
      INSERT INTO public.recipe_items(recipe_id,raw_material_id,quantity,wastage_percent) VALUES(v_recipe,v_raw,1,0);
    END IF;
  END IF;
  IF v_supplier IS NOT NULL AND v_product IS NOT NULL AND v_wh IS NOT NULL THEN
    SELECT id INTO v_purchase FROM public.purchases WHERE branch_id=p_branch_id AND invoice_number='DEMO-PUR-001' LIMIT 1;
    IF v_purchase IS NULL THEN
      INSERT INTO public.purchases(invoice_number,supplier_id,branch_id,warehouse_id,buyer_id,subtotal,total,paid_amount,payment_method,status,notes) VALUES('DEMO-PUR-001',v_supplier,p_branch_id,v_wh,v_user,100,100,100,'cash','completed','بيانات تجريبية') RETURNING id INTO v_purchase;
      INSERT INTO public.purchase_items(purchase_id,product_id,quantity,unit_name,unit_cost,total,received_quantity) VALUES(v_purchase,v_product,10,'piece',10,100,10);
    END IF;
  END IF;
  IF v_product IS NOT NULL AND v_wh IS NOT NULL THEN
    SELECT sale_price INTO v_total FROM public.products WHERE id=v_product;
    SELECT id INTO v_sale FROM public.sales WHERE branch_id=p_branch_id AND invoice_number='DEMO-SALE-001' LIMIT 1;
    IF v_sale IS NULL THEN
      INSERT INTO public.sales(invoice_number,branch_id,warehouse_id,customer_id,cashier_id,salesperson_id,subtotal,total,paid_amount,payment_method,status,order_type,guest_count,notes) VALUES('DEMO-SALE-001',p_branch_id,v_wh,v_customer,v_user,v_user,v_total,v_total,v_total,'cash','completed','takeaway',1,'بيانات تجريبية') RETURNING id INTO v_sale;
      INSERT INTO public.sale_items(sale_id,product_id,quantity,unit_name,unit_price,total) VALUES(v_sale,v_product,1,'piece',v_total,v_total);
    END IF;
  END IF;
  IF v_product IS NOT NULL THEN
    SELECT id INTO v_order FROM public.orders WHERE branch_id=p_branch_id AND order_number='DEMO-ORD-001' LIMIT 1;
    IF v_order IS NULL THEN
      INSERT INTO public.orders(order_number,branch_id,order_type,status,customer_id,cashier_id,guest_count,subtotal,total,notes) VALUES('DEMO-ORD-001',p_branch_id,'takeaway','completed',v_customer,v_user,1,v_total,v_total,'طلب تجريبي') RETURNING id INTO v_order;
      INSERT INTO public.order_items(order_id,product_id,quantity,unit_name,unit_price,total) VALUES(v_order,v_product,1,'piece',v_total,v_total);
    END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.expenses WHERE branch_id=p_branch_id AND description='مصروف تجريبي') THEN INSERT INTO public.expenses(category,description,amount,branch_id,payment_method,expense_date,notes,created_by) VALUES('مصروفات تشغيل','مصروف تجريبي',50,p_branch_id,'cash',CURRENT_DATE,'بيانات تجريبية',v_user); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.shifts WHERE branch_id=p_branch_id AND notes='وردية تجريبية') THEN
    INSERT INTO public.shifts(branch_id,cashier_id,opening_amount,status,notes) VALUES(p_branch_id,v_user,500,'closed','وردية تجريبية') RETURNING id INTO v_shift;
    INSERT INTO public.shift_operations(shift_id,operation_type,amount,payment_method,created_by) VALUES(v_shift,'opening',500,'cash',v_user);
  END IF;
  SELECT id INTO v_cash_account FROM public.chart_of_accounts WHERE branch_id=p_branch_id AND account_type='asset' AND (name ILIKE '%نقد%' OR name_en ILIKE '%cash%') ORDER BY is_system DESC LIMIT 1;
  IF v_cash_account IS NOT NULL THEN
    SELECT id INTO v_treasury FROM public.treasury_accounts WHERE branch_id=p_branch_id AND account_type='cash' LIMIT 1;
    IF v_treasury IS NULL THEN INSERT INTO public.treasury_accounts(branch_id,account_id,account_type,account_name,opening_balance) VALUES(p_branch_id,v_cash_account,'cash','الخزينة التجريبية',500) RETURNING id INTO v_treasury; END IF;
  END IF;
  RETURN jsonb_build_object('success',true,'seeded',true,'section_count',11);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error','SEED_FAILED','detail',SQLERRM);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_data_delete_section(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_data_seed_all(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_data_delete_section(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_data_seed_all(uuid) TO authenticated;