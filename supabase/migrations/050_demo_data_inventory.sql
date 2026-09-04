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
