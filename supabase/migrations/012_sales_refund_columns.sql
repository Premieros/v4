-- ============================================================================
-- Refund tracking columns on sales / sale_items
-- ----------------------------------------------------------------------------
-- process_refund (defined later in manufacturing_rpc) and the receivable
-- checks in accounting_rpc / d1_foundation read sales.refunded_amount and
-- sale_items.refunded_quantity / refunded_amount. On the live database these
-- columns were added by the legacy audit_fixes migration; this file recreates
-- them for a fresh build. Additive + idempotent.
-- ============================================================================

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS refunded_amount numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS refunded_quantity numeric(14,4) NOT NULL DEFAULT 0;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS refunded_amount numeric(14,2) NOT NULL DEFAULT 0;
