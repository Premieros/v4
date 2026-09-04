-- ============================================================================
-- 036. Restaurant floor plan + open orders (Phase 3 foundation)
-- ----------------------------------------------------------------------------
-- Adds the dine-in foundation on top of the completed-sale model:
--   * dining_areas   - floor zones per branch (Terrace, Hall, Second floor...)
--   * dining_tables  - tables in an area with layout {x,y,w,h} + status
--                      (vacant | occupied | reserved | closed)
--   * orders         - open/held in-progress orders (hold/recall carts) with
--                      an order_type (dine_in | takeaway | delivery | drive_thru)
--   * order_items    - lines of an open order (child of orders)
--   * sales          - gains order_type + table_id so completed sales report
--                      the service channel and origin table
--
-- Isolation model (consistent with the branch matrix):
--   * dining_areas:  SELECT admin-or-own-branch; writes admin-only (config).
--   * dining_tables: full (admin-or-own-branch for every command) because the
--                    POS needs to flip status (occupied/vacant) at runtime.
--   * orders:        full (admin-or-own-branch).
--   * order_items:   child rows isolate through their parent order.
-- Table privileges come automatically from 032 ALTER DEFAULT PRIVILEGES.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.dining_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dining_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  area_id uuid REFERENCES public.dining_areas(id) ON DELETE SET NULL,
  name text NOT NULL,
  capacity integer NOT NULL DEFAULT 4,
  status text NOT NULL DEFAULT 'vacant',
  shape text NOT NULL DEFAULT 'rect',
  layout jsonb NOT NULL DEFAULT '{"x":0,"y":0,"w":120,"h":80}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  order_type text NOT NULL DEFAULT 'dine_in',
  status text NOT NULL DEFAULT 'open',
  table_id uuid REFERENCES public.dining_tables(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  cashier_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  guest_count integer,
  notes text,
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  discount_type text NOT NULL DEFAULT 'amount',
  tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  unit_name text NOT NULL DEFAULT 'piece',
  quantity numeric(14,4) NOT NULL DEFAULT 1,
  unit_price numeric(12,2) NOT NULL DEFAULT 0,
  discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  bonus_quantity numeric(14,4) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Completed sales record their service channel + origin table.
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS order_type text NOT NULL DEFAULT 'takeaway';
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS table_id uuid REFERENCES public.dining_tables(id) ON DELETE SET NULL;

-- ===== Indexes =====
CREATE INDEX IF NOT EXISTS idx_dining_areas_branch ON public.dining_areas (branch_id);
CREATE INDEX IF NOT EXISTS idx_dining_tables_branch ON public.dining_tables (branch_id);
CREATE INDEX IF NOT EXISTS idx_dining_tables_area ON public.dining_tables (area_id);
CREATE INDEX IF NOT EXISTS idx_dining_tables_status ON public.dining_tables (status);
CREATE INDEX IF NOT EXISTS idx_orders_branch_status ON public.orders (branch_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_table ON public.orders (table_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_sales_order_type ON public.sales (order_type);

-- ===== RLS =====
ALTER TABLE public.dining_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dining_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

-- dining_areas: SELECT admin-or-own-branch; writes admin-only.
DROP POLICY IF EXISTS "auth_select_dining_areas" ON public.dining_areas;
CREATE POLICY "auth_select_dining_areas" ON public.dining_areas FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_write_dining_areas" ON public.dining_areas;
CREATE POLICY "auth_write_dining_areas" ON public.dining_areas FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin());
DROP POLICY IF EXISTS "auth_write_dining_areas_upd" ON public.dining_areas;
CREATE POLICY "auth_write_dining_areas_upd" ON public.dining_areas FOR UPDATE TO authenticated
  USING (is_pos_admin()) WITH CHECK (is_pos_admin());
DROP POLICY IF EXISTS "auth_write_dining_areas_del" ON public.dining_areas;
CREATE POLICY "auth_write_dining_areas_del" ON public.dining_areas FOR DELETE TO authenticated
  USING (is_pos_admin());

-- dining_tables: full (admin-or-own-branch for every command).
DROP POLICY IF EXISTS "auth_select_dining_tables" ON public.dining_tables;
CREATE POLICY "auth_select_dining_tables" ON public.dining_tables FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_write_dining_tables" ON public.dining_tables;
CREATE POLICY "auth_write_dining_tables" ON public.dining_tables FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_write_dining_tables_upd" ON public.dining_tables;
CREATE POLICY "auth_write_dining_tables_upd" ON public.dining_tables FOR UPDATE TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id())
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_write_dining_tables_del" ON public.dining_tables;
CREATE POLICY "auth_write_dining_tables_del" ON public.dining_tables FOR DELETE TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());

-- orders: full (admin-or-own-branch for every command).
DROP POLICY IF EXISTS "auth_select_orders" ON public.orders;
CREATE POLICY "auth_select_orders" ON public.orders FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_write_orders" ON public.orders;
CREATE POLICY "auth_write_orders" ON public.orders FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_write_orders_upd" ON public.orders;
CREATE POLICY "auth_write_orders_upd" ON public.orders FOR UPDATE TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id())
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "auth_write_orders_del" ON public.orders;
CREATE POLICY "auth_write_orders_del" ON public.orders FOR DELETE TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());

-- order_items: child rows isolate through the parent order.
DROP POLICY IF EXISTS "auth_select_order_items" ON public.order_items;
CREATE POLICY "auth_select_order_items" ON public.order_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_id AND (is_pos_admin() OR o.branch_id = get_branch_id())
  ));
DROP POLICY IF EXISTS "auth_write_order_items" ON public.order_items;
CREATE POLICY "auth_write_order_items" ON public.order_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_id AND (is_pos_admin() OR o.branch_id = get_branch_id())
  ));
DROP POLICY IF EXISTS "auth_write_order_items_upd" ON public.order_items;
CREATE POLICY "auth_write_order_items_upd" ON public.order_items FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_id AND (is_pos_admin() OR o.branch_id = get_branch_id())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_id AND (is_pos_admin() OR o.branch_id = get_branch_id())
  ));
DROP POLICY IF EXISTS "auth_write_order_items_del" ON public.order_items;
CREATE POLICY "auth_write_order_items_del" ON public.order_items FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_id AND (is_pos_admin() OR o.branch_id = get_branch_id())
  ));
