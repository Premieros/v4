-- ============================================================
-- 033_perf_indexes.sql
-- Phase 1 audit: FK columns used on hot query paths that lack a
-- leading index. Additive only — all CREATE INDEX IF NOT EXISTS.
-- (Skipped low-value audit flags such as *_created_by lookups.)
-- ============================================================

-- Catalog / BOM lookups
CREATE INDEX IF NOT EXISTS idx_product_components_component ON public.product_components (component_product_id);
CREATE INDEX IF NOT EXISTS idx_product_units_product        ON public.product_units (product_id);

-- Recipes / production
CREATE INDEX IF NOT EXISTS idx_recipe_items_recipe          ON public.recipe_items (recipe_id);
CREATE INDEX IF NOT EXISTS idx_recipe_items_raw             ON public.recipe_items (raw_material_id);
CREATE INDEX IF NOT EXISTS idx_production_waste_order       ON public.production_waste (order_id);
CREATE INDEX IF NOT EXISTS idx_production_orders_branch     ON public.production_orders (branch_id);

-- Warehouses / transfers
CREATE INDEX IF NOT EXISTS idx_inventory_batches_warehouse  ON public.inventory_batches (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_transactions_warehouse ON public.stock_transactions (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_transfer_items_tx  ON public.warehouse_transfer_items (transfer_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_transfers_from     ON public.warehouse_transfers (from_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_transfers_to       ON public.warehouse_transfers (to_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_transfers_branch   ON public.warehouse_transfers (branch_id);

-- Sales / purchases filters
CREATE INDEX IF NOT EXISTS idx_sales_cashier                ON public.sales (cashier_id);
CREATE INDEX IF NOT EXISTS idx_sales_salesperson            ON public.sales (salesperson_id);
CREATE INDEX IF NOT EXISTS idx_sales_warehouse              ON public.sales (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_purchases_warehouse          ON public.purchases (warehouse_id);

-- Accounting joins
CREATE INDEX IF NOT EXISTS idx_account_mappings_account     ON public.account_mappings (account_id);
CREATE INDEX IF NOT EXISTS idx_expenses_account             ON public.expenses (account_id);
CREATE INDEX IF NOT EXISTS idx_treasury_accounts_coa        ON public.treasury_accounts (account_id);
