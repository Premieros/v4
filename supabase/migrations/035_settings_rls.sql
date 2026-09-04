-- ============================================================================
-- 035. Settings expansion + tighten global settings RLS
-- ----------------------------------------------------------------------------
-- 1) The frontend Settings type reads 13 more columns than the canonical 001
--    table created (brand/pos/invoice/receipt/inventory). Those columns lived
--    only in the archived legacy migration, so a canonical fresh build returned
--    NULL/undefined for pos_default_payment_method, invoice_next_number,
--    receipt_width_mm, low_stock_threshold, etc. and the POS/receipt/invoice
--    features silently misbehaved. Add them (idempotent) here.
--
-- 2) settings RLS from 001 was open for EVERY DML command to ANY authenticated
--    user (USING true / WITH CHECK true), so any cashier could rewrite the
--    global configuration directly through PostgREST. The /settings page is
--    admin-only (settings.manage; only super_admin/owner hold it by default),
--    so writes are locked to admins. SELECT stays open: every page resolves
--    the effective settings at boot.
-- Additive + idempotent.
-- ============================================================================

ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS brand_color text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS pos_default_payment_method text DEFAULT 'cash';
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS pos_barcode_autofocus boolean DEFAULT true;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS pos_line_discount boolean DEFAULT true;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS invoice_prefix text DEFAULT 'INV-';
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS invoice_next_number bigint DEFAULT 1;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS invoice_decimal_places integer DEFAULT 2;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS receipt_width_mm integer DEFAULT 58;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS receipt_copies integer DEFAULT 1;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS receipt_auto_print boolean DEFAULT true;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS receipt_show_tax boolean DEFAULT true;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS receipt_show_qr boolean DEFAULT true;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS low_stock_threshold numeric(12,2) DEFAULT 5;

DROP POLICY IF EXISTS "auth_insert_settings" ON public.settings;
CREATE POLICY "auth_insert_settings" ON public.settings FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin());

DROP POLICY IF EXISTS "auth_update_settings" ON public.settings;
CREATE POLICY "auth_update_settings" ON public.settings FOR UPDATE TO authenticated
  USING (is_pos_admin()) WITH CHECK (is_pos_admin());

DROP POLICY IF EXISTS "auth_delete_settings" ON public.settings;
CREATE POLICY "auth_delete_settings" ON public.settings FOR DELETE TO authenticated
  USING (is_pos_admin());
