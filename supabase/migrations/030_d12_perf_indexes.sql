-- Migration: D12 Performance - index coverage
-- Audit finding: several FK / filter columns used by common join and report
-- queries had no index (seq scans as data grows). The only exact-duplicate
-- index (idx_journal_reference, a non-unique copy of uq_journal_reference)
-- is dropped to save write overhead.

DROP INDEX IF EXISTS public.idx_journal_reference;

CREATE INDEX IF NOT EXISTS idx_sale_items_product              ON public.sale_items (product_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_product          ON public.purchase_items (product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_batches_branch        ON public.inventory_batches (branch_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_branch_date           ON public.audit_log (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user                  ON public.audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_matched    ON public.bank_statement_lines (matched_journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_treasury_transactions_from      ON public.treasury_transactions (from_account_id);
CREATE INDEX IF NOT EXISTS idx_treasury_transactions_to        ON public.treasury_transactions (to_account_id);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_product        ON public.inventory_ledger (product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_raw            ON public.inventory_ledger (raw_material_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_transfer_items_product ON public.warehouse_transfer_items (product_id);
CREATE INDEX IF NOT EXISTS idx_production_waste_product        ON public.production_waste (product_id);
