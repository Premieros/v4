-- Migration 083: Rename 'units' (measurement units: KG, PCS, etc.) to
-- 'measurement_units', create a backward-compatible view, and prepare
-- for the new 'units' concept (intermediate sub-products) in 084.
--
-- This migration is safe because:
-- - The renamed table retains all data, indexes, and constraints.
-- - The compatibility view lets old RPCs (013, 020, 075) keep working.
-- - RLS policies are re-created with updated names.

-- 1. Rename the table
ALTER TABLE IF EXISTS public.units RENAME TO measurement_units;

-- 2. PK already exists from 011; no action needed.

-- 3. Drop old RLS policies that referenced the old table name
DROP POLICY IF EXISTS "units_select" ON public.measurement_units;
DROP POLICY IF EXISTS "units_write" ON public.measurement_units;

-- 4. Re-create RLS on measurement_units
CREATE POLICY measurement_units_select ON public.measurement_units
  FOR SELECT USING (true);
CREATE POLICY measurement_units_admin_write ON public.measurement_units
  FOR ALL USING (is_pos_admin());

-- 5. Backward-compatible view: old RPCs reference 'public.units'
CREATE OR REPLACE VIEW public.units AS
  SELECT id, code, name, symbol, is_active, created_at
  FROM public.measurement_units;

-- 6. Grants
GRANT SELECT ON public.units TO authenticated;
GRANT SELECT ON public.measurement_units TO authenticated;
