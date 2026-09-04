-- ============================================================================
-- 039. Floor-plan permissions
-- ----------------------------------------------------------------------------
-- Grants the floor-plan permissions to the seeded roles (idempotent for the
-- roles that already hold them). Admins bypass via is_pos_admin(); the entries
-- keep the roles matrix consistent for the UI. Non-admin floor-plan layout
-- writes are still branch-gated by the dining_* RLS policies.
-- ============================================================================

UPDATE public.roles
SET permissions = permissions || '["floor_plan.view","floor_plan.manage"]'::jsonb
WHERE role IN ('super_admin', 'owner');

UPDATE public.roles
SET permissions = permissions || '["floor_plan.view"]'::jsonb
WHERE role = 'branch_manager';
