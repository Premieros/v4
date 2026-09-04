-- ============================================================================
-- 049. Remove duplicate users.branch_id foreign key
-- ----------------------------------------------------------------------------
-- The production schema previously contained two foreign keys for the same
-- relationship: users.branch_id -> branches.id. Keep the strict RBAC FK and
-- remove the legacy duplicate so PostgREST cannot expose an ambiguous
-- relationship for this column.
--
-- Idempotent: safe to apply to databases where the legacy constraint is
-- already absent (including the current production database).
-- ============================================================================

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_branch_id_fkey;
