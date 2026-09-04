-- Add Phase C permission keys to DB `roles` rows (source of truth for
-- DB-side can_permission() checks and the frontend RolesContext map).
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['accounts.view', 'accounts.manage', 'reports.financial']::text[] LOOP
    UPDATE public.roles
    SET permissions = permissions || to_jsonb(r)
    WHERE role IN ('branch_manager', 'accountant')
      AND NOT (permissions ? r);
  END LOOP;
END $$;
