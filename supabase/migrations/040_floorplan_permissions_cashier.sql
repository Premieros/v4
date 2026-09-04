-- ============================================================================
-- 040. Floor-plan permission for cashiers
-- ----------------------------------------------------------------------------
-- Cashiers serve tables, so they need floor_plan.view to open/resume dine-in
-- orders from the floor. Keeps the DB roles matrix consistent with the code
-- defaults. floor_plan.manage stays admin / branch-manager only.
-- ============================================================================

UPDATE public.roles
SET permissions = permissions || '["floor_plan.view"]'::jsonb
WHERE role = 'cashier';
