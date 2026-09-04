-- PHASE 8-12: production hardening
-- Branch ownership is mandatory for every user.
ALTER TABLE public.users ALTER COLUMN branch_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_branch_id ON public.users(branch_id);
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_branch_fk_strict;
ALTER TABLE public.users ADD CONSTRAINT users_branch_fk_strict
  FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE RESTRICT;

-- Prevent invalid financial/inventory values.
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_positive_prices;
ALTER TABLE public.products ADD CONSTRAINT products_positive_prices
  CHECK (COALESCE(cost_price,0) >= 0 AND COALESCE(sale_price,0) >= 0 AND COALESCE(wholesale_price,0) >= 0);
ALTER TABLE public.sale_items DROP CONSTRAINT IF EXISTS sale_items_positive_values;
ALTER TABLE public.sale_items ADD CONSTRAINT sale_items_positive_values
  CHECK (quantity > 0 AND unit_price >= 0 AND COALESCE(discount_amount,0) >= 0
         AND COALESCE(refunded_quantity,0) >= 0 AND COALESCE(refunded_amount,0) >= 0);
ALTER TABLE public.purchase_items DROP CONSTRAINT IF EXISTS purchase_items_positive_values;
ALTER TABLE public.purchase_items ADD CONSTRAINT purchase_items_positive_values
  CHECK (quantity > 0 AND unit_cost >= 0 AND COALESCE(total,0) >= 0
         AND COALESCE(returned_quantity,0) >= 0 AND COALESCE(returned_amount,0) >= 0);
ALTER TABLE public.inventory DROP CONSTRAINT IF EXISTS inventory_nonnegative_quantity;
ALTER TABLE public.inventory ADD CONSTRAINT inventory_nonnegative_quantity CHECK (quantity >= 0);
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_nonnegative_amounts;
ALTER TABLE public.shifts ADD CONSTRAINT shifts_nonnegative_amounts
  CHECK (opening_amount >= 0 AND expected_amount >= 0 AND actual_amount >= 0);

-- Performance indexes for branch-scoped reporting and operations.
CREATE INDEX IF NOT EXISTS idx_sales_branch_created_at ON public.sales(branch_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON public.sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON public.sale_items(product_id);
CREATE INDEX IF NOT EXISTS idx_purchases_branch_created_at ON public.purchases(branch_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase_id ON public.purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_inventory_branch_product ON public.inventory(branch_id,product_id);
CREATE INDEX IF NOT EXISTS idx_expenses_branch_date ON public.expenses(branch_id,expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_journal_entries_branch_date ON public.journal_entries(branch_id,entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_orders_branch_created_at ON public.orders(branch_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_branch_created_at ON public.inventory_ledger(branch_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_branch_created_at ON public.audit_log(branch_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customers_branch_id ON public.customers(branch_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_branch_id ON public.suppliers(branch_id);
CREATE INDEX IF NOT EXISTS idx_products_branch_category ON public.products(branch_id,category_id);
CREATE INDEX IF NOT EXISTS idx_shifts_branch_status ON public.shifts(branch_id,status);
