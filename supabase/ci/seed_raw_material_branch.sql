-- CI-only helpers. Never apply this file to real Supabase.
-- Integration fixtures seed as the postgres role and historically omitted branch_id.
-- Production/application writes remain protected by the NOT NULL + RLS rules in 060.

CREATE OR REPLACE FUNCTION public.ci_default_raw_material_branch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch uuid;
BEGIN
  IF current_user = 'postgres' AND NEW.branch_id IS NULL THEN
    SELECT id INTO v_branch
    FROM public.branches
    ORDER BY created_at, id
    LIMIT 1;

    IF v_branch IS NULL THEN
      RAISE EXCEPTION 'CI_NO_BRANCH_AVAILABLE';
    END IF;

    NEW.branch_id := v_branch;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ci_default_raw_material_branch ON public.raw_materials;
CREATE TRIGGER trg_ci_default_raw_material_branch
BEFORE INSERT ON public.raw_materials
FOR EACH ROW
EXECUTE FUNCTION public.ci_default_raw_material_branch();

-- The integration fixture intentionally creates a recipe in branch B while
-- initially reusing the branch-A material. In production that cross-branch
-- relation must fail. In CI-only postgres seeding, clone the material into the
-- recipe branch so the fixture can be created without weakening the production
-- validation trigger.
CREATE OR REPLACE FUNCTION public.ci_normalize_recipe_item_branch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recipe_branch uuid;
  material_branch uuid;
  source_material public.raw_materials%ROWTYPE;
  target_material uuid;
  target_code text;
BEGIN
  IF current_user <> 'postgres' THEN
    RETURN NEW;
  END IF;

  SELECT branch_id INTO recipe_branch
  FROM public.recipes
  WHERE id = NEW.recipe_id;

  SELECT * INTO source_material
  FROM public.raw_materials
  WHERE id = NEW.raw_material_id;

  material_branch := source_material.branch_id;

  IF recipe_branch IS NULL OR material_branch IS NULL OR recipe_branch = material_branch THEN
    RETURN NEW;
  END IF;

  target_code := source_material.code || '-CI-' || replace(substr(recipe_branch::text, 1, 8), '-', '');

  SELECT id INTO target_material
  FROM public.raw_materials
  WHERE branch_id = recipe_branch
    AND code = target_code
  LIMIT 1;

  IF target_material IS NULL THEN
    INSERT INTO public.raw_materials (
      code, name, unit_id, category, min_stock, default_cost,
      description, is_active, branch_id
    ) VALUES (
      target_code, source_material.name, source_material.unit_id,
      source_material.category, source_material.min_stock,
      source_material.default_cost, source_material.description,
      source_material.is_active, recipe_branch
    )
    RETURNING id INTO target_material;
  END IF;

  NEW.raw_material_id := target_material;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ci_normalize_recipe_item_branch ON public.recipe_items;
CREATE TRIGGER ci_normalize_recipe_item_branch
BEFORE INSERT OR UPDATE ON public.recipe_items
FOR EACH ROW
EXECUTE FUNCTION public.ci_normalize_recipe_item_branch();
