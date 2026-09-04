-- =====================================================================
-- Phase B3: relax write policies for permission-gated roles
-- =====================================================================
-- The B1 schema locked writes on master data to is_pos_admin() only, but
-- production_manager (and other roles) hold manage permissions via the
-- `roles` table. Relax policies so those roles can manage master data
-- through the frontend, consistent with the can_permission() checks used
-- by the SECURITY DEFINER RPCs.
-- =====================================================================

DROP POLICY IF EXISTS raw_materials_write ON public.raw_materials;
CREATE POLICY raw_materials_write ON public.raw_materials
  FOR ALL TO authenticated
  USING (can_permission('raw_materials.manage'))
  WITH CHECK (can_permission('raw_materials.manage'));

DROP POLICY IF EXISTS raw_material_inventory_write ON public.raw_material_inventory;
CREATE POLICY raw_material_inventory_write ON public.raw_material_inventory
  FOR ALL TO authenticated
  USING (is_pos_admin() OR (can_permission('raw_materials.manage') AND branch_id = get_branch_id()))
  WITH CHECK (is_pos_admin() OR (can_permission('raw_materials.manage') AND branch_id = get_branch_id()));

DROP POLICY IF EXISTS raw_material_batches_write ON public.raw_material_batches;
CREATE POLICY raw_material_batches_write ON public.raw_material_batches
  FOR ALL TO authenticated
  USING (is_pos_admin() OR (can_permission('raw_materials.manage') AND branch_id = get_branch_id()))
  WITH CHECK (is_pos_admin() OR (can_permission('raw_materials.manage') AND branch_id = get_branch_id()));

DROP POLICY IF EXISTS recipes_write ON public.recipes;
CREATE POLICY recipes_write ON public.recipes
  FOR ALL TO authenticated
  USING (is_pos_admin() OR (can_permission('recipes.manage') AND branch_id = get_branch_id()))
  WITH CHECK (is_pos_admin() OR (can_permission('recipes.manage') AND branch_id = get_branch_id()));

DROP POLICY IF EXISTS recipe_items_write ON public.recipe_items;
CREATE POLICY recipe_items_write ON public.recipe_items
  FOR ALL TO authenticated
  USING (
    is_pos_admin() OR (
      can_permission('recipes.manage') AND EXISTS (
        SELECT 1 FROM public.recipes r
        WHERE r.id = recipe_items.recipe_id AND r.branch_id = get_branch_id()
      )
    )
  )
  WITH CHECK (
    is_pos_admin() OR (
      can_permission('recipes.manage') AND EXISTS (
        SELECT 1 FROM public.recipes r
        WHERE r.id = recipe_items.recipe_id AND r.branch_id = get_branch_id()
      )
    )
  );
