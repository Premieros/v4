-- =====================================================================
-- Phase B1: Manufacturing, Warehouses, Batches & Inventory Ledger schema
-- =====================================================================
-- Adds: units, raw_materials, raw_material_inventory, raw_material_batches,
--       recipes, recipe_items, production_orders, production_waste,
--       warehouse_transfers, warehouse_transfer_items, inventory_batches,
--       inventory_ledger, batch columns on inventory, warehouses.warehouse_type,
--       document sequences for production_order/transfer, production_manager role.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Shared updated_at trigger function
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 2. Units of measure (global master data)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.units (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL UNIQUE,
  symbol      text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.units IS 'وحدات القياس (قطعة، كيلو، لتر، كرتونة ...)';

INSERT INTO public.units (code, name, symbol) VALUES
  ('PCS', 'قطعة', 'قطعة'),
  ('UNIT', 'وحدة', 'وحدة'),
  ('KG', 'كيلوغرام', 'كجم'),
  ('GM', 'جرام', 'جم'),
  ('LITR', 'لتر', 'لتر'),
  ('ML', 'ملليلتر', 'مل'),
  ('BOX', 'صندوق', 'صندوق'),
  ('CARTON', 'كرتونة', 'كرتونة'),
  ('PACK', 'كيس', 'كيس'),
  ('BAG', 'شنطة', 'شنطة'),
  ('BOTTLE', 'زجاجة', 'زجاجة'),
  ('CAN', 'علبة', 'علبة'),
  ('JAR', 'برطمان', 'برطمان'),
  ('CUP', 'كوب', 'كوب'),
  ('PLATE', 'طبق', 'طبق'),
  ('TRAY', 'صينية', 'صينية'),
  ('DOZEN', 'دستة', 'دستة'),
  ('CASE', 'دربكة', 'دربكة'),
  ('ROLL', 'لفة', 'لفة'),
  ('TIN', 'تنكة', 'تنكة'),
  ('BUNDLE', 'حزمة', 'حزمة'),
  ('PORTION', 'حصة', 'حصة')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "units_select" ON public.units
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "units_write" ON public.units
  FOR ALL TO authenticated USING (is_pos_admin()) WITH CHECK (is_pos_admin());

-- ---------------------------------------------------------------------
-- 3. Raw materials (global master data) + branch-scoped stock
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.raw_materials (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE,
  name          text NOT NULL,
  unit_id       uuid REFERENCES public.units(id) ON DELETE SET NULL,
  category      text,
  min_stock     numeric(14,4) NOT NULL DEFAULT 0,
  default_cost  numeric(12,2) NOT NULL DEFAULT 0,
  description   text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.raw_materials IS 'المواد الخام (مخزون المواد)';

CREATE INDEX IF NOT EXISTS idx_raw_materials_name ON public.raw_materials (name);
CREATE INDEX IF NOT EXISTS idx_raw_materials_active ON public.raw_materials (is_active);

ALTER TABLE public.raw_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "raw_materials_select" ON public.raw_materials
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "raw_materials_write" ON public.raw_materials
  FOR ALL TO authenticated USING (is_pos_admin()) WITH CHECK (is_pos_admin());

CREATE TRIGGER trg_raw_materials_updated BEFORE UPDATE ON public.raw_materials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------
-- 4. Raw material inventory (aggregate per branch) + batches (lots)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.raw_material_inventory (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_material_id   uuid NOT NULL REFERENCES public.raw_materials(id) ON DELETE CASCADE,
  branch_id         uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  quantity          numeric(14,4) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  avg_cost          numeric(12,2) NOT NULL DEFAULT 0,
  min_stock         numeric(14,4) NOT NULL DEFAULT 0,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (raw_material_id, branch_id)
);
COMMENT ON TABLE public.raw_material_inventory IS 'رصيد المواد الخام لكل فرع (رصيد إجمالي + متوسط التكلفة)';

CREATE INDEX IF NOT EXISTS idx_raw_inv_branch ON public.raw_material_inventory (branch_id);

ALTER TABLE public.raw_material_inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "raw_material_inventory_select" ON public.raw_material_inventory
  FOR SELECT TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id());
CREATE POLICY "raw_material_inventory_write" ON public.raw_material_inventory
  FOR ALL TO authenticated USING (is_pos_admin()) WITH CHECK (is_pos_admin());

CREATE TABLE IF NOT EXISTS public.raw_material_batches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_material_id   uuid NOT NULL REFERENCES public.raw_materials(id) ON DELETE CASCADE,
  branch_id         uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  batch_number      text,
  quantity          numeric(14,4) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit_cost         numeric(12,2) NOT NULL DEFAULT 0,
  production_date   date,
  expiry_date       date,
  source_type       text NOT NULL DEFAULT 'purchase',
  source_id         uuid,
  created_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.raw_material_batches IS 'دفعات المواد الخام (الاستهلاك بأقرب تاريخ انتهاء أولاً FIFO)';

CREATE INDEX IF NOT EXISTS idx_raw_batches_material ON public.raw_material_batches (raw_material_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_raw_batches_expiry ON public.raw_material_batches (raw_material_id, expiry_date);

ALTER TABLE public.raw_material_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "raw_material_batches_select" ON public.raw_material_batches
  FOR SELECT TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id());
CREATE POLICY "raw_material_batches_write" ON public.raw_material_batches
  FOR ALL TO authenticated USING (is_pos_admin()) WITH CHECK (is_pos_admin());

-- ---------------------------------------------------------------------
-- 5. Recipes (product -> raw materials)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recipes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  branch_id       uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  name            text,
  yield_quantity  numeric(14,4) NOT NULL DEFAULT 1 CHECK (yield_quantity > 0),
  notes           text,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, branch_id)
);
COMMENT ON TABLE public.recipes IS 'الوصفات: ربط المنتج المصنّع بمكوناته من المواد الخام';

ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recipes_select" ON public.recipes
  FOR SELECT TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id());
CREATE POLICY "recipes_write" ON public.recipes
  FOR ALL TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id())
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id());

CREATE TRIGGER trg_recipes_updated BEFORE UPDATE ON public.recipes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.recipe_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id         uuid NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  raw_material_id   uuid NOT NULL REFERENCES public.raw_materials(id),
  quantity          numeric(14,4) NOT NULL CHECK (quantity > 0),
  wastage_percent   numeric(5,2) NOT NULL DEFAULT 0 CHECK (wastage_percent >= 0),
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.recipe_items IS 'مكونات الوصفة (كمية من مادة خام لكل وصفة)';

ALTER TABLE public.recipe_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recipe_items_select" ON public.recipe_items
  FOR SELECT TO authenticated USING (
    is_pos_admin() OR EXISTS (
      SELECT 1 FROM public.recipes r
      WHERE r.id = recipe_items.recipe_id AND r.branch_id = get_branch_id()
    )
  );
CREATE POLICY "recipe_items_write" ON public.recipe_items
  FOR ALL TO authenticated USING (is_pos_admin()) WITH CHECK (is_pos_admin());

-- ---------------------------------------------------------------------
-- 6. Production orders + waste
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.production_orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number      text NOT NULL UNIQUE,
  product_id        uuid NOT NULL REFERENCES public.products(id),
  branch_id         uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  warehouse_id      uuid REFERENCES public.warehouses(id),
  quantity          numeric(14,4) NOT NULL CHECK (quantity > 0),
  batch_number      text,
  status            text NOT NULL DEFAULT 'planned'
                    CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled')),
  total_cost        numeric(12,2) NOT NULL DEFAULT 0,
  planned_at        date DEFAULT CURRENT_DATE,
  completed_at      timestamptz,
  cancelled_at      timestamptz,
  cancel_reason     text,
  notes             text,
  created_by        uuid REFERENCES public.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.production_orders IS 'أوامر الإنتاج (تصنيع منتج من المواد الخام عبر الوصفة)';

CREATE INDEX IF NOT EXISTS idx_production_orders_status ON public.production_orders (status, branch_id);
CREATE INDEX IF NOT EXISTS idx_production_orders_product ON public.production_orders (product_id);

ALTER TABLE public.production_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "production_orders_select" ON public.production_orders
  FOR SELECT TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id());
CREATE POLICY "production_orders_write" ON public.production_orders
  FOR ALL TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id())
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id());

CREATE TRIGGER trg_production_orders_updated BEFORE UPDATE ON public.production_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.production_waste (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid NOT NULL REFERENCES public.production_orders(id) ON DELETE CASCADE,
  branch_id         uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  raw_material_id   uuid REFERENCES public.raw_materials(id),
  product_id        uuid REFERENCES public.products(id),
  quantity          numeric(14,4) NOT NULL CHECK (quantity >= 0),
  reason            text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (raw_material_id IS NOT NULL OR product_id IS NOT NULL)
);
COMMENT ON TABLE public.production_waste IS 'هالك الإنتاج (مواد خام أو منتجات تالفة)';

ALTER TABLE public.production_waste ENABLE ROW LEVEL SECURITY;

CREATE POLICY "production_waste_select" ON public.production_waste
  FOR SELECT TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id());
CREATE POLICY "production_waste_write" ON public.production_waste
  FOR ALL TO authenticated USING (is_pos_admin()) WITH CHECK (is_pos_admin());

-- ---------------------------------------------------------------------
-- 7. Warehouse transfers (finished goods between warehouses)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.warehouse_transfers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_number     text NOT NULL UNIQUE,
  from_warehouse_id   uuid NOT NULL REFERENCES public.warehouses(id),
  to_warehouse_id     uuid NOT NULL REFERENCES public.warehouses(id),
  branch_id           uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'rejected')),
  reason              text,
  notes               text,
  requested_by        uuid REFERENCES public.users(id),
  requested_at        timestamptz NOT NULL DEFAULT now(),
  approved_by         uuid REFERENCES public.users(id),
  approved_at         timestamptz,
  rejection_reason    text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (from_warehouse_id <> to_warehouse_id)
);
COMMENT ON TABLE public.warehouse_transfers IS 'التحويلات بين المخازن (بضاعة جاهزة)';

CREATE INDEX IF NOT EXISTS idx_warehouse_transfers_status ON public.warehouse_transfers (status, branch_id);

ALTER TABLE public.warehouse_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "warehouse_transfers_select" ON public.warehouse_transfers
  FOR SELECT TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id());
CREATE POLICY "warehouse_transfers_write" ON public.warehouse_transfers
  FOR ALL TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id())
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id());

CREATE TRIGGER trg_warehouse_transfers_updated BEFORE UPDATE ON public.warehouse_transfers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.warehouse_transfer_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id     uuid NOT NULL REFERENCES public.warehouse_transfers(id) ON DELETE CASCADE,
  product_id      uuid REFERENCES public.products(id),
  quantity        numeric(14,4) NOT NULL CHECK (quantity > 0),
  unit_cost       numeric(12,2) NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (product_id IS NOT NULL)
);
COMMENT ON TABLE public.warehouse_transfer_items IS 'منتجات التحويل';

ALTER TABLE public.warehouse_transfer_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "warehouse_transfer_items_select" ON public.warehouse_transfer_items
  FOR SELECT TO authenticated USING (
    is_pos_admin() OR EXISTS (
      SELECT 1 FROM public.warehouse_transfers wt
      WHERE wt.id = warehouse_transfer_items.transfer_id AND wt.branch_id = get_branch_id()
    )
  );
CREATE POLICY "warehouse_transfer_items_write" ON public.warehouse_transfer_items
  FOR ALL TO authenticated USING (is_pos_admin()) WITH CHECK (is_pos_admin());

-- ---------------------------------------------------------------------
-- 8. Finished-goods batches (expiry-aware FIFO for sales)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_batches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  warehouse_id      uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  branch_id         uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  batch_number      text,
  quantity          numeric(14,4) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit_cost         numeric(12,2) NOT NULL DEFAULT 0,
  production_date   date,
  expiry_date       date,
  source_type       text NOT NULL DEFAULT 'purchase',
  source_id         uuid,
  created_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.inventory_batches IS 'دفعات البضاعة الجاهزة (البيع بأقرب تاريخ انتهاء أولاً FIFO)';

CREATE INDEX IF NOT EXISTS idx_inventory_batches_product ON public.inventory_batches (product_id, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventory_batches_expiry ON public.inventory_batches (product_id, expiry_date);

ALTER TABLE public.inventory_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_batches_select" ON public.inventory_batches
  FOR SELECT TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id());
CREATE POLICY "inventory_batches_write" ON public.inventory_batches
  FOR ALL TO authenticated USING (is_pos_admin()) WITH CHECK (is_pos_admin());

-- ---------------------------------------------------------------------
-- 9. Inventory ledger (single source of truth for all movements)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_ledger (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id        uuid REFERENCES public.products(id) ON DELETE CASCADE,
  raw_material_id   uuid REFERENCES public.raw_materials(id) ON DELETE CASCADE,
  branch_id         uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  warehouse_id      uuid REFERENCES public.warehouses(id),
  batch_number      text,
  quantity          numeric(14,4) NOT NULL,
  unit_cost         numeric(12,2) NOT NULL DEFAULT 0,
  total_cost        numeric(14,2) NOT NULL DEFAULT 0,
  before_qty        numeric(14,4),
  after_qty         numeric(14,4),
  entry_type        text NOT NULL,
  reference_type    text,
  reference_id      uuid,
  reference_number  text,
  created_by        uuid REFERENCES public.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((product_id IS NOT NULL) <> (raw_material_id IS NOT NULL))
);
COMMENT ON TABLE public.inventory_ledger IS 'دفتر المخزون: كل حركة كمية سواء منتجات أو مواد خام';

CREATE INDEX IF NOT EXISTS idx_inventory_ledger_product ON public.inventory_ledger (product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_raw ON public.inventory_ledger (raw_material_id);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_branch ON public.inventory_ledger (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_reference ON public.inventory_ledger (reference_type, reference_id);

ALTER TABLE public.inventory_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_ledger_select" ON public.inventory_ledger
  FOR SELECT TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id());
CREATE POLICY "inventory_ledger_write" ON public.inventory_ledger
  FOR ALL TO authenticated USING (is_pos_admin()) WITH CHECK (is_pos_admin());

-- ---------------------------------------------------------------------
-- 10. Extend existing tables
-- ---------------------------------------------------------------------
ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS batch_number text,
  ADD COLUMN IF NOT EXISTS production_date date,
  ADD COLUMN IF NOT EXISTS expiry_date date;

ALTER TABLE public.warehouses
  ADD COLUMN IF NOT EXISTS warehouse_type text NOT NULL DEFAULT 'general'
  CHECK (warehouse_type IN ('general', 'raw', 'finished'));

ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS raw_material_id uuid REFERENCES public.raw_materials(id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_raw ON public.purchase_items (raw_material_id);

-- ---------------------------------------------------------------------
-- 11. Document sequences for new documents
-- ---------------------------------------------------------------------
INSERT INTO public.document_sequences (seq_type, next_value) VALUES
  ('production_order', 1),
  ('transfer', 1)
ON CONFLICT (seq_type) DO NOTHING;

-- ---------------------------------------------------------------------
-- 12. Backfill inventory_batches from existing inventory rows
--     (opening batches keep product.cost_price so FIFO invariant holds)
-- ---------------------------------------------------------------------
INSERT INTO public.inventory_batches (product_id, warehouse_id, branch_id, batch_number, quantity, unit_cost, source_type)
SELECT i.product_id, i.warehouse_id, i.branch_id, 'OPENING', i.quantity, COALESCE(p.cost_price, 0), 'opening'
FROM public.inventory i
JOIN public.products p ON p.id = i.product_id
WHERE i.quantity > 0;

INSERT INTO public.inventory_ledger (product_id, branch_id, warehouse_id, quantity, unit_cost, total_cost,
  before_qty, after_qty, entry_type, reference_type, reference_number)
SELECT i.product_id, i.branch_id, i.warehouse_id, i.quantity, COALESCE(p.cost_price, 0),
  i.quantity * COALESCE(p.cost_price, 0), 0, i.quantity, 'opening', 'opening', 'OPENING'
FROM public.inventory i
JOIN public.products p ON p.id = i.product_id
WHERE i.quantity > 0;

-- ---------------------------------------------------------------------
-- 13. production_manager role
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_role_check' AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users ADD CONSTRAINT users_role_check
      CHECK (role IN ('super_admin', 'owner', 'branch_manager', 'cashier',
                      'warehouse_manager', 'accountant', 'production_manager'));
  ELSE
    ALTER TABLE public.users DROP CONSTRAINT users_role_check;
    ALTER TABLE public.users ADD CONSTRAINT users_role_check
      CHECK (role IN ('super_admin', 'owner', 'branch_manager', 'cashier',
                      'warehouse_manager', 'accountant', 'production_manager'));
  END IF;
END $$;

INSERT INTO public.roles (role, name_ar, name_en, permissions, updated_at)
VALUES (
  'production_manager', 'مدير إنتاج', 'Production Manager',
  '[
    "dashboard.view", "products.view", "products.manage", "categories.view", "categories.manage",
    "raw_materials.view", "raw_materials.manage", "recipes.view", "recipes.manage",
    "production.view", "production.manage", "production.waste",
    "inventory.view", "inventory.manage", "warehouses.view", "warehouses.manage",
    "inventory.transfers", "inventory.transfers.approve",
    "purchases.view", "purchases.manage", "suppliers.view", "suppliers.manage",
    "inventory.ledger.view", "shifts.view"
  ]'::jsonb,
  now()
)
ON CONFLICT (role) DO UPDATE SET
  name_ar = EXCLUDED.name_ar, name_en = EXCLUDED.name_en,
  permissions = EXCLUDED.permissions, updated_at = now();

-- ---------------------------------------------------------------------
-- 14. create_user: allow production_manager (and drop stale role names)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_user(p_email text, p_password text, p_full_name text DEFAULT NULL::text, p_role text DEFAULT 'cashier'::text, p_branch_id uuid DEFAULT NULL::uuid, p_is_active boolean DEFAULT true, p_username text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_role text;
  v_hash text;
  v_email text;
  v_username text;
  v_pgc_schema text;
  v_caller_role text;
  v_caller_branch uuid;
  v_u_cols text;
  v_u_vals text;
  v_i_cols text;
  v_i_vals text;
BEGIN
  SELECT role, branch_id INTO v_caller_role, v_caller_branch FROM public.users WHERE id = auth.uid();

  IF is_pos_admin() THEN
    NULL;
  ELSIF v_caller_role = 'branch_manager' AND v_caller_branch IS NOT NULL THEN
    -- branch manager: force their own branch and forbid admin roles
    IF p_branch_id IS NOT NULL AND p_branch_id <> v_caller_branch THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED',
        'detail', 'Branch managers can only create users in their own branch');
    END IF;
    IF p_role IN ('super_admin', 'owner') THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED',
        'detail', 'Only a super admin can create super_admin/owner accounts');
    END IF;
    p_branch_id := v_caller_branch;
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  v_email := lower(btrim(p_email));

  -- Email uniqueness (both auth accounts and app profiles)
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
    RETURN jsonb_build_object('success', false, 'error', 'EMAIL_TAKEN');
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE email = v_email) THEN
    RETURN jsonb_build_object('success', false, 'error', 'EMAIL_TAKEN');
  END IF;

  -- Username: default to email prefix, sanitized, must be unique
  v_username := regexp_replace(
    regexp_replace(lower(btrim(coalesce(NULLIF(p_username, ''), split_part(v_email, '@', 1)))), '[^a-z0-9._-]', '_', 'g'),
    '^[._-]+', '', 'g'
  );
  IF v_username = '' THEN
    v_username := 'user' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE username = v_username) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USERNAME_TAKEN');
  END IF;

  SELECT extnamespace::regnamespace::text INTO v_pgc_schema
  FROM pg_extension WHERE extname = 'pgcrypto';

  IF v_pgc_schema IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', 'pgcrypto extension is not enabled');
  END IF;

  EXECUTE format('SELECT %I.crypt($1, %I.gen_salt($2, $3))', v_pgc_schema, v_pgc_schema)
    INTO v_hash USING p_password, 'bf', 10;

  v_role := CASE
    WHEN p_role IN ('super_admin', 'owner', 'branch_manager', 'cashier',
                    'warehouse_manager', 'accountant', 'production_manager') THEN p_role
    ELSE 'cashier'
  END;

  v_user_id := gen_random_uuid();

  SELECT string_agg(c.col, ', ' ORDER BY c.ord), string_agg(c.val, ', ' ORDER BY c.ord)
  INTO v_u_cols, v_u_vals
  FROM (
    SELECT cols.ordinal_position AS ord, quote_ident(cols.column_name) AS col,
      CASE cols.column_name
        WHEN 'instance_id' THEN '''00000000-0000-0000-0000-000000000000'''
        WHEN 'id' THEN quote_literal(v_user_id)
        WHEN 'aud' THEN '''authenticated'''
        WHEN 'role' THEN '''authenticated'''
        WHEN 'email' THEN quote_literal(v_email)
        WHEN 'encrypted_password' THEN quote_literal(v_hash)
        WHEN 'email_confirmed_at' THEN 'now()'
        WHEN 'confirmation_token' THEN ''''''
        WHEN 'recovery_token' THEN ''''''
        WHEN 'email_change' THEN ''''''
        WHEN 'email_change_token_new' THEN ''''''
        WHEN 'email_change_token_current' THEN ''''''
        WHEN 'raw_app_meta_data' THEN format('jsonb_build_object(''provider'',''email'',''providers'',array[''email'']::text[],''email'',%L)', v_email)
        WHEN 'raw_user_meta_data' THEN format('jsonb_build_object(''full_name'',%L,''email'',%L,''email_verified'',true)', p_full_name, v_email)
        WHEN 'created_at' THEN 'now()'
        WHEN 'updated_at' THEN 'now()'
        WHEN 'is_anonymous' THEN 'false'
        WHEN 'is_sso_user' THEN 'false'
      END AS val
    FROM information_schema.columns cols
    WHERE cols.table_schema = 'auth' AND cols.table_name = 'users'
      AND cols.is_generated = 'NEVER'
      AND cols.column_name IN ('instance_id','id','aud','role','email','encrypted_password','email_confirmed_at','confirmation_token','recovery_token','email_change','email_change_token_new','email_change_token_current','raw_app_meta_data','raw_user_meta_data','created_at','updated_at','is_anonymous','is_sso_user')
  ) c;

  IF v_u_cols IS NULL OR v_u_vals IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', 'no insertable columns found for auth.users');
  END IF;

  EXECUTE 'INSERT INTO auth.users (' || v_u_cols || ') VALUES (' || v_u_vals || ')';

  SELECT string_agg(c.col, ', ' ORDER BY c.ord), string_agg(c.val, ', ' ORDER BY c.ord)
  INTO v_i_cols, v_i_vals
  FROM (
    SELECT cols.ordinal_position AS ord, quote_ident(cols.column_name) AS col,
      CASE cols.column_name
        WHEN 'id' THEN 'gen_random_uuid()'
        WHEN 'provider_id' THEN quote_literal(v_user_id::text)
        WHEN 'user_id' THEN quote_literal(v_user_id)
        WHEN 'identity_data' THEN format('jsonb_build_object(''sub'',%L,''email'',%L)', v_user_id::text, v_email)
        WHEN 'provider' THEN '''email'''
        WHEN 'last_sign_in_at' THEN 'now()'
        WHEN 'created_at' THEN 'now()'
        WHEN 'updated_at' THEN 'now()'
        WHEN 'email' THEN quote_literal(v_email)
      END AS val
    FROM information_schema.columns cols
    WHERE cols.table_schema = 'auth' AND cols.table_name = 'identities'
      AND cols.is_generated = 'NEVER'
      AND cols.column_name IN ('id','provider_id','user_id','identity_data','provider','last_sign_in_at','created_at','updated_at','email')
  ) c;

  IF v_i_cols IS NULL OR v_i_vals IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', 'no insertable columns found for auth.identities');
  END IF;

  EXECUTE 'INSERT INTO auth.identities (' || v_i_cols || ') VALUES (' || v_i_vals || ')';

  INSERT INTO public.users (id, email, username, full_name, role, branch_id, is_active)
  VALUES (v_user_id, v_email, v_username, p_full_name, v_role, p_branch_id, p_is_active);

  RETURN jsonb_build_object('success', true, 'user_id', v_user_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', SQLERRM);
END;
$function$;
