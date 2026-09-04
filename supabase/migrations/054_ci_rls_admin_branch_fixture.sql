-- CI-only compatibility for the strict branch ownership rule.
--
-- Production rule: public.users.branch_id is NOT NULL (053) and every real
-- user must belong to a branch. The RLS integration fixture historically
-- created super_admin/owner rows with NULL branch_id because those roles can
-- see all branches. That fixture is now incompatible with the production
-- invariant.
--
-- The CI database is identified by auth.is_ci_stub(), which exists only in
-- supabase/ci/stub_auth.sql and is never installed on a real Supabase project.
-- In CI only, assign a missing admin fixture branch to the first branch created
-- by the fixture. This keeps branch_id mandatory while preserving admin-wide
-- visibility semantics. No production database behavior is changed.

DO $$
BEGIN
  IF to_regprocedure('auth.is_ci_stub()') IS NOT NULL THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.ci_assign_admin_fixture_branch()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $body$
      BEGIN
        IF NEW.branch_id IS NULL AND NEW.role IN ('super_admin', 'owner') THEN
          SELECT b.id
            INTO NEW.branch_id
            FROM public.branches b
            ORDER BY b.created_at ASC, b.id ASC
            LIMIT 1;

          IF NEW.branch_id IS NULL THEN
            RAISE EXCEPTION 'CI RLS fixture requires at least one branch before creating an admin user';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $body$;
    $fn$;

    EXECUTE 'DROP TRIGGER IF EXISTS trg_ci_assign_admin_fixture_branch ON public.users';
    EXECUTE $sql$
      CREATE TRIGGER trg_ci_assign_admin_fixture_branch
      BEFORE INSERT ON public.users
      FOR EACH ROW
      EXECUTE FUNCTION public.ci_assign_admin_fixture_branch()
    $sql$;
  END IF;
END $$;
