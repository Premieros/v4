-- Multi-tenant registration must be able to provision branch-scoped inventory units
-- before the newly-created owner has an authenticated session. Keep normal INSERTs
-- branch-scoped; only the existing registration transaction gets the bootstrap path.

DROP POLICY IF EXISTS inventory_units_registration_insert ON public.inventory_units;
CREATE POLICY inventory_units_registration_insert
  ON public.inventory_units
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    (
      COALESCE(current_setting('app.register_branch', true), '') = 'on'
      AND branch_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.branches b
        WHERE b.id = inventory_units.branch_id
      )
    )
    OR branch_id = public.get_branch_id()
    OR public.is_pos_admin()
  );

-- Regression coverage for the bootstrap path is intentionally kept in the
-- integration suite; this policy must never broaden UPDATE/DELETE access.
