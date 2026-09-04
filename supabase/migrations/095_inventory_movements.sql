-- Migration 095: Add inventory_movements and raw_material_movements tables for movement history tracking
-- Canonical schema note: tenant/organization isolation is derived from branch_id in this migration.
-- The organizations table is not part of the schema available at this migration point.

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE CASCADE,
  movement_type text NOT NULL,
  quantity numeric(14,4) NOT NULL,
  reference_id uuid,
  notes text,
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_inventory_movements" ON public.inventory_movements;
CREATE POLICY "auth_all_inventory_movements" ON public.inventory_movements
  FOR ALL TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id())
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id());

CREATE TABLE IF NOT EXISTS public.raw_material_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id uuid REFERENCES public.raw_materials(id) ON DELETE CASCADE,
  warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE CASCADE,
  movement_type text NOT NULL,
  quantity numeric(14,4) NOT NULL,
  reference_id uuid,
  notes text,
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.raw_material_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_raw_material_movements" ON public.raw_material_movements;
CREATE POLICY "auth_all_raw_material_movements" ON public.raw_material_movements
  FOR ALL TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id())
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id());

CREATE INDEX IF NOT EXISTS idx_inv_movements_product ON public.inventory_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_inv_movements_warehouse ON public.inventory_movements(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inv_movements_branch ON public.inventory_movements(branch_id);
CREATE INDEX IF NOT EXISTS idx_rm_movements_material ON public.raw_material_movements(material_id);
CREATE INDEX IF NOT EXISTS idx_rm_movements_warehouse ON public.raw_material_movements(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_rm_movements_branch ON public.raw_material_movements(branch_id);
