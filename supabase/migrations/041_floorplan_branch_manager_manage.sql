-- ============================================================================
-- 041. Floor-plan manage for branch managers
-- ----------------------------------------------------------------------------
-- Branch managers administer the floor plan of their branch (add areas/tables,
-- reposition, set statuses). 039 only granted them floor_plan.view; the code
-- defaults (permissionDefs.ts) and the floor_plan.manage usage inside
-- FloorPlanPage expect manage as well. Keeps the DB roles matrix consistent
-- with the UI defaults. floor_plan.manage stays admin / branch-manager only.
-- ============================================================================

UPDATE public.roles
SET permissions = permissions || '["floor_plan.manage"]'::jsonb
WHERE role = 'branch_manager'
  AND NOT permissions ? 'floor_plan.manage';
