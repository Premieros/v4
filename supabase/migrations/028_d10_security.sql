-- Migration: D10 Security hardening
-- Fixes found in the full system audit:
--   1. Privilege escalation: users UPDATE/INSERT policies let any branch
--      manager (or staff) promote ANY account in their branch to
--      super_admin/owner by editing public.users directly (the UsersPage uses
--      a direct table update, and RLS only scopes to the branch, not the
--      role value). Confirmed live.
--   2. trg_protect_last_admin was defined but never attached to users in the
--      live database, so "the last admin cannot be removed" was NOT enforced.
--   3. document_sequences has RLS disabled -> anon/authenticated could read
--      the counters directly via PostgREST.

-- ================================================================
-- 1. guard_user_role_changes: DB-level guard on public.users
--    Enforces (independent of RLS, since RLS cannot inspect NEW values):
--     - Only active super_admin/owner can create or modify admin accounts.
--     - No user may change their OWN role / branch_id / is_active unless
--       they are an admin.
--     - Branch managers can only create/update staff of their own branch.
-- ================================================================
CREATE OR REPLACE FUNCTION public.guard_user_role_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_caller_role text;
  v_caller_branch uuid;
BEGIN
  SELECT role, branch_id INTO v_caller_role, v_caller_branch
  FROM public.users WHERE id = auth.uid();

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  -- Only admins may create or modify admin accounts.
  IF NEW.role IN ('super_admin', 'owner') AND v_caller_role NOT IN ('super_admin', 'owner') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: only an admin can assign admin roles';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Only admins may modify existing admin accounts.
    IF OLD.role IN ('super_admin', 'owner') AND v_caller_role NOT IN ('super_admin', 'owner') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: only an admin can modify admin accounts';
    END IF;

    -- No self-demotion / self-deactivation / self-branch-change for non-admins.
    IF NEW.id = auth.uid() AND v_caller_role NOT IN ('super_admin', 'owner') THEN
      IF NEW.role IS DISTINCT FROM OLD.role
         OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
         OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: users cannot change their own role/branch/status';
      END IF;
    END IF;
  END IF;

  -- Branch managers may only manage staff of their own branch.
  IF v_caller_role = 'branch_manager' THEN
    IF NEW.branch_id IS DISTINCT FROM v_caller_branch THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: branch managers can only manage their own branch';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_users_role_guard ON public.users;
CREATE TRIGGER trg_users_role_guard
BEFORE INSERT OR UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.guard_user_role_changes();

-- ================================================================
-- 2. protect_last_admin: fix the live definition (it still checked the
--    legacy role 'admin' instead of 'super_admin'/'owner', so the last-admin
--    protection was a silent no-op) and (re-)attach the trigger, which was
--    missing from the live database entirely.
-- ================================================================
CREATE OR REPLACE FUNCTION public.protect_last_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_other_active_admins int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role IN ('super_admin', 'owner') AND OLD.is_active THEN
      SELECT count(*) INTO v_other_active_admins
      FROM public.users
      WHERE role IN ('super_admin', 'owner') AND is_active AND id <> OLD.id;
      IF v_other_active_admins = 0 THEN
        RAISE EXCEPTION 'LAST_ADMIN';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.role IN ('super_admin', 'owner') AND OLD.is_active
     AND (NEW.role NOT IN ('super_admin', 'owner') OR NOT NEW.is_active) THEN
    SELECT count(*) INTO v_other_active_admins
    FROM public.users
    WHERE role IN ('super_admin', 'owner') AND is_active AND id <> OLD.id;
    IF v_other_active_admins = 0 THEN
      RAISE EXCEPTION 'LAST_ADMIN';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_protect_last_admin ON public.users;
CREATE TRIGGER trg_protect_last_admin
BEFORE UPDATE OR DELETE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.protect_last_admin();

-- ================================================================
-- 3. Lock down document_sequences: RLS on, authenticated read-only.
--    Writes happen exclusively through SECURITY DEFINER RPCs which run as
--    the table owner and bypass RLS, so nothing else is affected.
-- ================================================================
ALTER TABLE public.document_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_sequences_select ON public.document_sequences;
CREATE POLICY document_sequences_select ON public.document_sequences
  FOR SELECT TO authenticated USING (true);

-- Reject any direct write attempt from the client (there is no policy for
-- INSERT/UPDATE/DELETE, and anon gets nothing).
REVOKE INSERT, UPDATE, DELETE ON public.document_sequences FROM anon, authenticated;
GRANT SELECT ON public.document_sequences TO authenticated;

NOTIFY pgrst, 'reload schema';
