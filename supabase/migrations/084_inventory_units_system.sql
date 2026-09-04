-- Migration 084: Create the NEW 'product_units' concept (intermediate
-- sub-products with their own stock, recipes, and production).
-- NOT to be confused with:
--   - measurement_units (old 'units' table, renamed in 083) — measurement UOMs
--   - product_units (existing table, UOM conversions per-product — bottle/carton)
--
-- New tables:
--   - inventory_units: intermediate products (Burger Patty, Bun, Sauce)
--   - product_unit_links: junction — which units a sellable product uses

-- ======================================================================
-- 1. inventory_units — intermediate sub-products
-- ======================================================================
CREATE TABLE public.inventory_units (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  name_en     text,
  unit_type   text NOT NULL DEFAULT 'ready'
                CHECK (unit_type IN ('ready','manufactured')),
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  branch_id   uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  cost_price      numeric(12,2) NOT NULL DEFAULT 0,
  sale_price      numeric(12,2) NOT NULL DEFAULT 0,
  min_stock       numeric(14,4) NOT NULL DEFAULT 0,
  max_stock       numeric(14,4) NOT NULL DEFAULT 0,
  reorder_point   numeric(14,4) NOT NULL DEFAULT 0,
  low_stock_threshold integer NOT NULL DEFAULT 5,
  barcode     text,
  sku         text,
  description text,
  image_url   text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.inventory_units
  IS 'Intermediate sub-products (e.g. Burger Patty, Bun). Tracked in inventory independently from raw materials.';

CREATE TRIGGER inventory_units_updated_at
  BEFORE UPDATE ON public.inventory_units
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ======================================================================
-- 2. product_unit_links — which units a sellable product uses
-- ======================================================================
CREATE TABLE public.product_unit_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  unit_id     uuid NOT NULL REFERENCES public.inventory_units(id) ON DELETE CASCADE,
  quantity    numeric(14,4) NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id, unit_id)
);

COMMENT ON TABLE public.product_unit_links
  IS 'Junction: a sellable product consumes these inventory_units at sale time.';

-- ======================================================================
-- 3. inventory_unit_recipes — recipe for manufactured units
-- ======================================================================
CREATE TABLE public.inventory_unit_recipes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id     uuid NOT NULL REFERENCES public.inventory_units(id) ON DELETE CASCADE,
  raw_material_id uuid NOT NULL REFERENCES public.raw_materials(id) ON DELETE CASCADE,
  quantity    numeric(14,4) NOT NULL DEFAULT 1,
  wastage_percent numeric(5,2) NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(unit_id, raw_material_id)
);

COMMENT ON TABLE public.inventory_unit_recipes
  IS 'Recipe ingredients for manufactured inventory_units.';

-- ======================================================================
-- 4. inventory_unit_batches — stock batches for units
-- ======================================================================
CREATE TABLE public.inventory_unit_batches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id         uuid NOT NULL REFERENCES public.inventory_units(id) ON DELETE CASCADE,
  branch_id       uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  warehouse_id    uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  batch_number    text,
  quantity        numeric(14,4) NOT NULL DEFAULT 0,
  unit_cost       numeric(12,2) NOT NULL DEFAULT 0,
  production_date date,
  expiry_date     date,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.inventory_unit_batches
  IS 'Stock batches for inventory_units — mirrors inventory_batches pattern.';

-- ======================================================================
-- 5. inventory_unit_entries — movement ledger for units
-- ======================================================================
CREATE TABLE public.inventory_unit_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id         uuid NOT NULL REFERENCES public.inventory_units(id) ON DELETE CASCADE,
  branch_id       uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  warehouse_id    uuid REFERENCES public.warehouses(id),
  quantity        numeric(14,4) NOT NULL,
  unit_cost       numeric(12,2) NOT NULL DEFAULT 0,
  entry_type      text NOT NULL,
  reference_type  text,
  reference_id    uuid,
  reference_number text,
  batch_number    text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.inventory_unit_entries
  IS 'Inventory movement ledger for inventory_units.';

-- ======================================================================
-- 6. RLS
-- ======================================================================
ALTER TABLE public.inventory_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_unit_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_unit_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_unit_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_unit_entries ENABLE ROW LEVEL SECURITY;

-- inventory_units
CREATE POLICY inventory_units_admin_all ON public.inventory_units
  FOR ALL USING (is_pos_admin());
CREATE POLICY inventory_units_branch_read ON public.inventory_units
  FOR SELECT USING (branch_id IS NULL OR branch_id = public.get_branch_id());

-- product_unit_links
CREATE POLICY pul_admin_all ON public.product_unit_links
  FOR ALL USING (is_pos_admin());
CREATE POLICY pul_branch_read ON public.product_unit_links
  FOR SELECT USING (
    product_id IN (SELECT id FROM public.products
                   WHERE branch_id = public.get_branch_id() OR branch_id IS NULL)
  );

-- inventory_unit_recipes
CREATE POLICY iur_admin_all ON public.inventory_unit_recipes
  FOR ALL USING (is_pos_admin());
CREATE POLICY iur_branch_read ON public.inventory_unit_recipes
  FOR SELECT USING (
    unit_id IN (SELECT id FROM public.inventory_units
                WHERE branch_id = public.get_branch_id() OR branch_id IS NULL)
  );

-- inventory_unit_batches
CREATE POLICY iub_admin_all ON public.inventory_unit_batches
  FOR ALL USING (is_pos_admin());
CREATE POLICY iub_branch_read ON public.inventory_unit_batches
  FOR SELECT USING (branch_id = public.get_branch_id());

-- inventory_unit_entries
CREATE POLICY iue_admin_all ON public.inventory_unit_entries
  FOR ALL USING (is_pos_admin());
CREATE POLICY iue_branch_read ON public.inventory_unit_entries
  FOR SELECT USING (branch_id = public.get_branch_id());

-- ======================================================================
-- 7. Indexes
-- ======================================================================
CREATE INDEX idx_inventory_units_branch ON public.inventory_units(branch_id);
CREATE INDEX idx_inventory_units_active ON public.inventory_units(is_active);
CREATE INDEX idx_product_unit_links_product ON public.product_unit_links(product_id);
CREATE INDEX idx_product_unit_links_unit ON public.product_unit_links(unit_id);
CREATE INDEX idx_inventory_unit_recipes_unit ON public.inventory_unit_recipes(unit_id);
CREATE INDEX idx_inventory_unit_batches_unit ON public.inventory_unit_batches(unit_id);
CREATE INDEX idx_inventory_unit_batches_branch ON public.inventory_unit_batches(branch_id);
CREATE INDEX idx_inventory_unit_entries_unit ON public.inventory_unit_entries(unit_id);
CREATE INDEX idx_inventory_unit_entries_branch ON public.inventory_unit_entries(branch_id);
CREATE INDEX idx_inventory_unit_entries_ref ON public.inventory_unit_entries(reference_type, reference_id);

-- ======================================================================
-- 8. Grants
-- ======================================================================
GRANT SELECT ON public.inventory_units TO authenticated;
GRANT SELECT ON public.product_unit_links TO authenticated;
GRANT SELECT ON public.inventory_unit_recipes TO authenticated;
GRANT SELECT ON public.inventory_unit_batches TO authenticated;
GRANT SELECT ON public.inventory_unit_entries TO authenticated;

GRANT INSERT, UPDATE ON public.inventory_units TO authenticated;
GRANT INSERT, UPDATE ON public.product_unit_links TO authenticated;
GRANT INSERT, UPDATE ON public.inventory_unit_recipes TO authenticated;
GRANT INSERT, UPDATE ON public.inventory_unit_batches TO authenticated;
GRANT INSERT ON public.inventory_unit_entries TO authenticated;
