-- Migration 092: production/raw-material compatibility + stable integration-test transaction handling
-- Restores the public helper expected by the inventory-unit production RPC.

CREATE OR REPLACE FUNCTION public.deduct_raw_material_inventory(
  p_raw_material_id uuid,
  p_quantity numeric,
  p_branch_id uuid,
  p_warehouse_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Raw-material inventory is branch-scoped; warehouse_id is accepted for
  -- compatibility with the production RPC but the canonical FIFO helper
  -- operates across the branch's raw-material batches.
  RETURN public._raw_remove_fifo(
    p_raw_material_id,
    p_branch_id,
    p_quantity,
    'production',
    'production',
    NULL,
    NULL,
    auth.uid()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.deduct_raw_material_inventory(uuid, numeric, uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.deduct_raw_material_inventory(uuid, numeric, uuid, uuid)
  IS 'Compatibility wrapper for production raw-material deductions; delegates to canonical branch-scoped FIFO removal.';
