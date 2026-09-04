-- ============================================================================
-- 077_replace_product_units.sql
--
-- The frontend calls `replace_product_units(p_product_id, p_units)` on every
-- product save (ProductsPage.save -> api.catalog.replaceProductUnits), but the
-- function was NEVER defined in any migration. On the live site and any fully
-- migrated database, every product create/edit silently failed at this RPC
-- with PGRST202 ("Could not find the function ... in the schema cache") --
-- exactly the class of bug the schema contract (supabase/api-contract.json +
-- verify-schema.js) exists to catch.
--
-- Additive-only: creates a single new function, touches nothing else.
-- Same conventions as sibling RPCs: SECURITY DEFINER, SET search_path=public,
-- branch isolation via is_pos_admin(), audit logging, atomic replace
-- (delete existing units, insert the new set).
-- ============================================================================

CREATE OR REPLACE FUNCTION replace_product_units(
  p_product_id uuid,
  p_units jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
  v_user_branch uuid;
  v_item jsonb;
  v_units_count integer;
  v_base_count integer;
  v_unit_name text;
  v_row record;
BEGIN
  -- Branch isolation: admin may manage any product; others only their branch.
  SELECT branch_id INTO v_branch_id FROM products WHERE id = p_product_id;
  IF v_branch_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_FOUND');
  END IF;

  IF NOT is_pos_admin() THEN
    SELECT branch_id INTO v_user_branch FROM users WHERE id = auth.uid();
    IF v_user_branch IS NULL OR v_user_branch IS DISTINCT FROM v_branch_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;
  END IF;

  IF p_units IS NULL THEN
    RETURN jsonb_build_object('success', true, 'deleted', 0);
  END IF;

  SELECT count(*) INTO v_units_count FROM jsonb_array_elements(p_units);
  SELECT count(*) INTO v_base_count
  FROM jsonb_array_elements(p_units) AS t(u)
  WHERE COALESCE((t.u->>'is_base')::boolean, false);

  IF v_units_count = 0 OR v_base_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'NO_BASE_UNIT');
  END IF;

  -- Atomic replace inside a single transaction (the RPC is a single statement
  -- with an implicit transaction, so partial states are impossible).
  DELETE FROM product_units WHERE product_id = p_product_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_units) LOOP
    v_unit_name := v_item->>'unit_name';
    IF v_unit_name IS NULL OR v_unit_name = '' THEN
      CONTINUE;
    END IF;
    INSERT INTO product_units (
      product_id, unit_name, unit_name_en, conversion_factor,
      sale_price, cost_price, barcode, is_base
    ) VALUES (
      p_product_id,
      v_unit_name,
      COALESCE(v_item->>'unit_name_en', v_unit_name),
      COALESCE((v_item->>'conversion_factor')::numeric, 1),
      COALESCE((v_item->>'sale_price')::numeric, 0),
      COALESCE((v_item->>'cost_price')::numeric, 0),
      NULLIF(v_item->>'barcode', ''),
      COALESCE((v_item->>'is_base')::boolean, false)
    );
  END LOOP;

  INSERT INTO audit_log (user_id, user_email, action, entity, entity_id, details, branch_id)
  VALUES (auth.uid(), NULL, 'replace_product_units', 'products', p_product_id,
          jsonb_build_object('units_count', v_units_count), v_branch_id);

  RETURN jsonb_build_object('success', true, 'units', v_units_count);
END;
$$;

GRANT EXECUTE ON FUNCTION replace_product_units(uuid, jsonb) TO authenticated;
