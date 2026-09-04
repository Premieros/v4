-- =============================================================
-- Migration: FK naming cleanup + inventory branch_id
--
--   1. Renames the default Postgres FK names to explicit, readable
--      names so PostgREST embed hints are stable and self-documenting.
--   2. Adds branch_id to inventory (NOT NULL, backfilled from the
--      row's warehouse branch) and rewrites inventory RLS to the
--      clean single pattern: is_pos_admin() OR branch_id = get_branch_id()
--
-- The renamed FKs must be matched in the frontend embed hints:
--   src/pages/ReportsPage.tsx:132,176  users!sales_cashier_id_fkey
--     ->  users!fk_sales_cashier
-- =============================================================

BEGIN;

-- ---------- 1. RENAME FOREIGN KEY CONSTRAINTS ----------
ALTER TABLE public.products    RENAME CONSTRAINT products_branch_id_fkey      TO fk_products_branch;
ALTER TABLE public.sales       RENAME CONSTRAINT sales_branch_id_fkey         TO fk_sales_branch;
ALTER TABLE public.sales       RENAME CONSTRAINT sales_cashier_id_fkey        TO fk_sales_cashier;
ALTER TABLE public.sales       RENAME CONSTRAINT sales_salesperson_id_fkey    TO fk_sales_salesperson;
ALTER TABLE public.sale_items  RENAME CONSTRAINT sale_items_product_id_fkey   TO fk_sale_item_product;
ALTER TABLE public.inventory   RENAME CONSTRAINT inventory_product_id_fkey    TO fk_stock_product;
ALTER TABLE public.purchases   RENAME CONSTRAINT purchases_supplier_id_fkey   TO fk_purchase_supplier;

-- ---------- 2. INVENTORY branch_id (NOT NULL, backfilled from warehouse) ----------
ALTER TABLE public.inventory ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE RESTRICT;

UPDATE public.inventory i
SET branch_id = w.branch_id
FROM public.warehouses w
WHERE w.id = i.warehouse_id AND i.branch_id IS NULL;

-- Safety: never leave a stock row without a branch (the warehouse must belong
-- to a branch). Failing here rolls the whole migration back.
ALTER TABLE public.inventory ALTER COLUMN branch_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_branch ON public.inventory(branch_id);

-- ---------- 3. INVENTORY RLS (clean single pattern via inventory.branch_id) ----------
DROP POLICY IF EXISTS "auth_select_inventory" ON public.inventory;
DROP POLICY IF EXISTS "auth_insert_inventory" ON public.inventory;
DROP POLICY IF EXISTS "auth_update_inventory" ON public.inventory;
DROP POLICY IF EXISTS "auth_delete_inventory" ON public.inventory;

CREATE POLICY "auth_select_inventory" ON public.inventory FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());
CREATE POLICY "auth_insert_inventory" ON public.inventory FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id());
CREATE POLICY "auth_update_inventory" ON public.inventory FOR UPDATE TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id())
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id());
CREATE POLICY "auth_delete_inventory" ON public.inventory FOR DELETE TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());

COMMIT;

-- Refresh the PostgREST schema cache so the renamed FKs / new column are live
NOTIFY pgrst, 'reload schema';
