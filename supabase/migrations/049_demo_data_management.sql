-- ============================================================================
-- 049. Demo data management (seed + delete, per branch)
-- ----------------------------------------------------------------------------
-- Branch admins / super admins need a safe, reversible way to populate a branch
-- with throwaway test data for trying the POS. Every demo row carries the
-- is_demo flag (default false, so nothing real is ever flagged) and:
--
--   * seed_demo_data(p_branch_id)   - idempotent: seeds once per branch
--   * delete_demo_data(p_branch_id) - removes demo business data + any
--                                     orders/sales that reference it
--
-- Deletion order matters for FKs:
--   production_orders reference products with NO ACTION  -> delete first
--   sales / orders reference customers, tables, products -> delete next
--   demo customers / products / categories / tables / areas -> last
--
-- Users/auth are intentionally out of scope: a demo cashier account is created
-- by an administrator directly and is not removed by this function.
-- ============================================================================

ALTER TABLE public.dining_areas   ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.dining_tables  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.customers      ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.categories     ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.products       ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_demo_products_branch
  ON public.products (branch_id) WHERE is_demo;
CREATE INDEX IF NOT EXISTS idx_demo_tables_branch
  ON public.dining_tables (branch_id) WHERE is_demo;

-- ============================================================================
-- seed_demo_data: one call seeds an area, tables, a category, products and
-- customers for the branch. Safe to call repeatedly (no-op if already seeded).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.seed_demo_data(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_area_id uuid;
  v_cat_id  uuid;
  v_areas   integer := 0;
  v_tables  integer := 0;
  v_cats    integer := 0;
  v_prods   integer := 0;
  v_custs   integer := 0;
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

  RETURN jsonb_build_object('success', true, 'seeded', 1, 'existing', false,
    'areas', v_areas, 'tables', v_tables, 'categories', v_cats,
    'products', v_prods, 'customers', v_custs);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'SEED_FAILED', 'detail', SQLERRM);
END;
$fn$;

-- ============================================================================
-- delete_demo_data: removes demo business rows and every order/sale that
-- references them (referencing rows are demo artifacts only, but the branch
-- scope keeps the operation safe).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.delete_demo_data(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  n_prod_orders integer := 0;
  n_shift_ops   integer := 0;
  n_sales       integer := 0;
  n_orders      integer := 0;
  n_custs       integer := 0;
  n_prods       integer := 0;
  n_cats        integer := 0;
  n_tables      integer := 0;
  n_areas       integer := 0;
BEGIN
  IF NOT is_pos_admin() AND NOT (is_branch_manager() AND get_branch_id() = p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  -- production_orders has a NO ACTION FK on product_id -> delete them first.
  DELETE FROM public.production_orders
  WHERE product_id IN (
    SELECT id FROM public.products WHERE branch_id = p_branch_id AND is_demo
  );
  GET DIAGNOSTICS n_prod_orders = ROW_COUNT;

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

  DELETE FROM public.products      WHERE branch_id = p_branch_id AND is_demo;
  GET DIAGNOSTICS n_prods = ROW_COUNT;

  DELETE FROM public.categories    WHERE branch_id = p_branch_id AND is_demo;
  GET DIAGNOSTICS n_cats = ROW_COUNT;

  DELETE FROM public.dining_tables WHERE branch_id = p_branch_id AND is_demo;
  GET DIAGNOSTICS n_tables = ROW_COUNT;

  DELETE FROM public.dining_areas  WHERE branch_id = p_branch_id AND is_demo;
  GET DIAGNOSTICS n_areas = ROW_COUNT;

  RETURN jsonb_build_object('success', true,
    'production_orders', n_prod_orders, 'shift_operations', n_shift_ops,
    'sales', n_sales, 'orders', n_orders, 'customers', n_custs,
    'products', n_prods, 'categories', n_cats, 'tables', n_tables, 'areas', n_areas);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'DELETE_FAILED', 'detail', SQLERRM);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.seed_demo_data(uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_demo_data(uuid) TO authenticated;
