-- Migration: Product Components (BOM - Bill of Materials)
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS product_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  component_product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity numeric(14,4) NOT NULL DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  UNIQUE (product_id, component_product_id)
);
ALTER TABLE product_components ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_product_components" ON product_components;
CREATE POLICY "auth_select_product_components" ON product_components FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_product_components" ON product_components;
CREATE POLICY "auth_insert_product_components" ON product_components FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_product_components" ON product_components;
CREATE POLICY "auth_update_product_components" ON product_components FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_product_components" ON product_components;
CREATE POLICY "auth_delete_product_components" ON product_components FOR DELETE TO authenticated USING (true);
