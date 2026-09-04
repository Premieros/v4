-- ============================================================================
-- Sales -> users foreign keys (cashier / salesperson)
-- ----------------------------------------------------------------------------
-- On the live database these two constraints existed (the frontend embeds
-- users!fk_sales_cashier, created by renaming sales_cashier_id_fkey in
-- fk_cleanup), but no tracked migration creates them. This file makes a fresh
-- build match the live state before fk_cleanup runs its renames.
-- Additive + idempotent: guarded, creates nothing that already exists.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_cashier_id_fkey' AND conrelid = 'public.sales'::regclass
  ) THEN
    ALTER TABLE public.sales
      ADD CONSTRAINT sales_cashier_id_fkey
      FOREIGN KEY (cashier_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_salesperson_id_fkey' AND conrelid = 'public.sales'::regclass
  ) THEN
    ALTER TABLE public.sales
      ADD CONSTRAINT sales_salesperson_id_fkey
      FOREIGN KEY (salesperson_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END $$;
