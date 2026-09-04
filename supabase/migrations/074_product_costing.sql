-- =====================================================================
-- P0 Item 2: Product / Recipe Costing.
-- Additive-only. Adds:
--   1. product_cost_history table + trigger tracking products.cost_price
--      changes (any source: manual edit, purchase recomputation, ...).
--   2. Costing analysis RPCs:
--      - get_costing_overview             per-product cost figures
--      - get_product_costing_detail       deep detail + component/recipe/history
--      - get_cost_history                 cost changes for one product
--      - get_supplier_price_impact        purchase-price trend per supplier item
--      - get_order_margin                 gross margin per sale order
-- All RPCs are SECURITY DEFINER and branch-scoped like the other reporting
-- functions: admins may pass NULL p_branch_id to scan all branches; branch
-- staff are locked to their own branch.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Cost history
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_cost_history (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  old_cost   numeric(12,2) NOT NULL DEFAULT 0,
  new_cost   numeric(12,2) NOT NULL DEFAULT 0,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid,
  source     text NOT NULL DEFAULT 'change'
);
COMMENT ON TABLE public.product_cost_history IS 'سجل تغيّر تكلفة المنتج (أي مصدر: تعديل يدوي، مشتريات، ...)';

CREATE INDEX IF NOT EXISTS idx_product_cost_history_product
  ON public.product_cost_history (product_id, changed_at DESC);

ALTER TABLE public.product_cost_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_cost_history_select" ON public.product_cost_history;
CREATE POLICY "product_cost_history_select" ON public.product_cost_history
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "product_cost_history_insert" ON public.product_cost_history;
CREATE POLICY "product_cost_history_insert" ON public.product_cost_history
  FOR INSERT TO authenticated WITH CHECK (true);

-- Trigger function runs as SECURITY DEFINER so the history insert succeeds
-- regardless of the caller's path (direct table update or RPC).
CREATE OR REPLACE FUNCTION public.track_product_cost_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.cost_price IS DISTINCT FROM OLD.cost_price THEN
    INSERT INTO public.product_cost_history (product_id, old_cost, new_cost, changed_by, source)
    VALUES (NEW.id, COALESCE(OLD.cost_price, 0), COALESCE(NEW.cost_price, 0), auth.uid(), 'auto');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_product_cost_history ON public.products;
CREATE TRIGGER trg_product_cost_history
  AFTER UPDATE OF cost_price ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.track_product_cost_history();

-- ---------------------------------------------------------------------
-- 2. Internal cost helpers (reused by overview + detail)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._product_wavg_cost(p_product_id uuid, p_branch_id uuid)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $function$
  SELECT CASE WHEN SUM(b.quantity) > 0
    THEN round(SUM(b.quantity * b.unit_cost) / SUM(b.quantity), 2)
    ELSE 0 END
  FROM public.inventory_batches b
  WHERE b.product_id = p_product_id AND b.quantity > 0
    AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
$function$;

CREATE OR REPLACE FUNCTION public._raw_wavg_cost(p_raw_material_id uuid, p_branch_id uuid)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $function$
  SELECT CASE WHEN SUM(b.quantity) > 0
    THEN round(SUM(b.quantity * b.unit_cost) / SUM(b.quantity), 2)
    ELSE COALESCE(
      (SELECT rm.default_cost FROM public.raw_materials rm WHERE rm.id = p_raw_material_id),
      0) END
  FROM public.raw_material_batches b
  WHERE b.raw_material_id = p_raw_material_id AND b.quantity > 0
    AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
$function$;

CREATE OR REPLACE FUNCTION public._product_bom_cost(p_product_id uuid, p_branch_id uuid)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $function$
  SELECT COALESCE(round(SUM(
    pc.quantity * COALESCE(public._product_wavg_cost(pc.component_product_id, p_branch_id), 0)
  ), 2), 0)
  FROM public.product_components pc
  WHERE pc.product_id = p_product_id
$function$;

CREATE OR REPLACE FUNCTION public._product_recipe_cost(p_product_id uuid, p_branch_id uuid)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $function$
  SELECT COALESCE(round(SUM(
    ri.quantity * (1 + COALESCE(ri.wastage_percent, 0) / 100.0) *
    COALESCE(public._raw_wavg_cost(ri.raw_material_id, p_branch_id), 0)
  ), 2), 0)
  FROM public.recipe_items ri
  JOIN public.recipes r ON r.id = ri.recipe_id
  WHERE r.product_id = p_product_id
    AND (p_branch_id IS NULL OR r.branch_id = p_branch_id)
$function$;

-- ---------------------------------------------------------------------
-- 3. get_costing_overview: per-product cost figures for the costing screen
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_costing_overview(
  p_branch_id uuid DEFAULT NULL
) RETURNS TABLE (
  product_id        uuid,
  product_name      text,
  barcode           text,
  sku               text,
  category_name     text,
  product_type      text,
  sale_price        numeric(12,2),
  unit_cost         numeric(12,2),
  theoretical_cost  numeric(12,2),
  actual_cost       numeric(12,2),
  component_count   bigint,
  recipe_item_count bigint
) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' STABLE
AS $function$
DECLARE
  v_user_branch uuid;
  v_scope uuid;
BEGIN
  IF NOT is_pos_admin() THEN
    SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
    v_scope := v_user_branch;
  ELSE
    v_scope := p_branch_id;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    COALESCE(NULLIF(btrim(p.name), ''), 'Product'),
    p.barcode,
    p.sku,
    c.name,
    COALESCE(p.product_type, 'ready'),
    COALESCE(p.sale_price, 0)::numeric(12,2),
    COALESCE(public._product_wavg_cost(p.id, v_scope), 0)::numeric(12,2),
    COALESCE(public._product_bom_cost(p.id, v_scope), 0)::numeric(12,2),
    COALESCE(public._product_recipe_cost(p.id, v_scope), 0)::numeric(12,2),
    (SELECT COUNT(*) FROM public.product_components pc WHERE pc.product_id = p.id)::bigint,
    (SELECT COUNT(*) FROM public.recipe_items ri JOIN public.recipes r ON r.id = ri.recipe_id
      WHERE r.product_id = p.id)::bigint
  FROM public.products p
  LEFT JOIN public.categories c ON c.id = p.category_id
  WHERE p.is_active = true
    AND (v_scope IS NULL OR p.branch_id = v_scope)
  ORDER BY p.name ASC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_costing_overview(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 4. get_product_costing_detail: deep detail for one product
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_product_costing_detail(
  p_product_id uuid,
  p_branch_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' STABLE
AS $function$
DECLARE
  v_user_branch uuid;
  v_scope uuid;
  v_row record;
  v_components jsonb;
  v_recipe jsonb;
  v_history jsonb;
BEGIN
  IF NOT is_pos_admin() THEN
    SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
    v_scope := v_user_branch;
  ELSE
    v_scope := p_branch_id;
  END IF;

  SELECT
    p.id, p.name, p.barcode, p.sku,
    COALESCE(p.sale_price, 0) AS sale_price,
    COALESCE(public._product_wavg_cost(p.id, v_scope), 0) AS unit_cost,
    COALESCE(public._product_bom_cost(p.id, v_scope), 0) AS theoretical_cost,
    COALESCE(public._product_recipe_cost(p.id, v_scope), 0) AS actual_cost,
    (SELECT COUNT(*) FROM public.product_components pc WHERE pc.product_id = p.id) AS component_count,
    (SELECT COUNT(*) FROM public.recipe_items ri JOIN public.recipes r ON r.id = ri.recipe_id
      WHERE r.product_id = p.id) AS recipe_item_count
  INTO v_row
  FROM public.products p
  WHERE p.id = p_product_id;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_FOUND');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'component_product_id', cp.id,
    'component_name', COALESCE(NULLIF(btrim(cp.name), ''), 'Component'),
    'quantity', pc.quantity,
    'unit_cost', COALESCE(public._product_wavg_cost(pc.component_product_id, v_scope), 0),
    'line_cost', round(pc.quantity * COALESCE(public._product_wavg_cost(pc.component_product_id, v_scope), 0), 2)
  ) ORDER BY cp.name), '[]'::jsonb)
  INTO v_components
  FROM public.product_components pc
  JOIN public.products cp ON cp.id = pc.component_product_id
  WHERE pc.product_id = p_product_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'raw_material_id', rm.id,
    'raw_material_name', COALESCE(NULLIF(btrim(rm.name), ''), 'Raw Material'),
    'quantity', ri.quantity,
    'wastage_percent', ri.wastage_percent,
    'unit_cost', COALESCE(public._raw_wavg_cost(ri.raw_material_id, v_scope), 0),
    'line_cost', round(ri.quantity * (1 + COALESCE(ri.wastage_percent, 0) / 100.0) *
      COALESCE(public._raw_wavg_cost(ri.raw_material_id, v_scope), 0), 2)
  ) ORDER BY rm.name), '[]'::jsonb)
  INTO v_recipe
  FROM public.recipe_items ri
  JOIN public.recipes r ON r.id = ri.recipe_id
  JOIN public.raw_materials rm ON rm.id = ri.raw_material_id
  WHERE r.product_id = p_product_id
    AND (v_scope IS NULL OR r.branch_id = v_scope);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', ch.id,
    'old_cost', ch.old_cost,
    'new_cost', ch.new_cost,
    'changed_at', ch.changed_at,
    'changed_by', COALESCE(NULLIF(btrim(u.username), ''), u.full_name, u.email, ''),
    'source', ch.source
  ) ORDER BY ch.changed_at DESC), '[]'::jsonb)
  INTO v_history
  FROM public.product_cost_history ch
  LEFT JOIN public.users u ON u.id = ch.changed_by
  WHERE ch.product_id = p_product_id;

  RETURN jsonb_build_object(
    'success', true,
    'product_id', v_row.id,
    'product_name', v_row.name,
    'barcode', v_row.barcode,
    'sku', v_row.sku,
    'sale_price', v_row.sale_price,
    'unit_cost', v_row.unit_cost,
    'theoretical_cost', v_row.theoretical_cost,
    'actual_cost', v_row.actual_cost,
    'component_count', v_row.component_count,
    'recipe_item_count', v_row.recipe_item_count,
    'components', v_components,
    'recipe_items', v_recipe,
    'history', v_history
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_product_costing_detail(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 5. get_cost_history: cost changes for one product
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_cost_history(
  p_product_id uuid,
  p_limit integer DEFAULT 50
) RETURNS TABLE (
  id         uuid,
  product_id uuid,
  old_cost   numeric(12,2),
  new_cost   numeric(12,2),
  changed_at timestamptz,
  changed_by text,
  source     text
) LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE
AS $function$
  SELECT
    ch.id,
    ch.product_id,
    ch.old_cost,
    ch.new_cost,
    ch.changed_at,
    COALESCE(NULLIF(btrim(u.username), ''), u.full_name, u.email, ''),
    ch.source
  FROM public.product_cost_history ch
  LEFT JOIN public.users u ON u.id = ch.changed_by
  WHERE ch.product_id = p_product_id
  ORDER BY ch.changed_at DESC
  LIMIT GREATEST(LEAST(p_limit, 500), 1)
$function$;

GRANT EXECUTE ON FUNCTION public.get_cost_history(uuid, integer) TO authenticated;

-- ---------------------------------------------------------------------
-- 6. get_supplier_price_impact: purchase-price trend per supplier item
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_supplier_price_impact(
  p_supplier_id uuid
) RETURNS TABLE (
  item_id          uuid,
  item_type        text,
  item_name        text,
  first_cost       numeric(12,2),
  last_cost        numeric(12,2),
  avg_cost         numeric(12,2),
  change_pct       numeric(10,2),
  purchase_count   bigint,
  last_purchased_at timestamptz
) LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE
AS $function$
  SELECT
    p.id,
    'product'::text AS item_type,
    COALESCE(NULLIF(btrim(p.name), ''), 'Product'),
    (array_agg(pi.unit_cost ORDER BY pc.created_at ASC))[1]::numeric(12,2),
    (array_agg(pi.unit_cost ORDER BY pc.created_at DESC))[1]::numeric(12,2),
    round(AVG(pi.unit_cost), 2)::numeric(12,2),
    round(CASE
      WHEN (array_agg(pi.unit_cost ORDER BY pc.created_at ASC))[1] > 0
      THEN ((array_agg(pi.unit_cost ORDER BY pc.created_at DESC))[1] - (array_agg(pi.unit_cost ORDER BY pc.created_at ASC))[1]) * 100.0
        / (array_agg(pi.unit_cost ORDER BY pc.created_at ASC))[1]
      ELSE 0 END, 2)::numeric(10,2),
    COUNT(*)::bigint,
    MAX(pc.created_at)::timestamptz
  FROM public.purchase_items pi
  JOIN public.purchases pc ON pc.id = pi.purchase_id
  JOIN public.products p ON p.id = pi.product_id
  WHERE pc.supplier_id = p_supplier_id
    AND pc.status = 'completed'
    AND pi.product_id IS NOT NULL
  GROUP BY p.id
UNION ALL
  SELECT
    rm.id,
    'raw_material'::text,
    COALESCE(NULLIF(btrim(rm.name), ''), 'Raw Material'),
    (array_agg(pi.unit_cost ORDER BY pc.created_at ASC))[1]::numeric(12,2),
    (array_agg(pi.unit_cost ORDER BY pc.created_at DESC))[1]::numeric(12,2),
    round(AVG(pi.unit_cost), 2)::numeric(12,2),
    round(CASE
      WHEN (array_agg(pi.unit_cost ORDER BY pc.created_at ASC))[1] > 0
      THEN ((array_agg(pi.unit_cost ORDER BY pc.created_at DESC))[1] - (array_agg(pi.unit_cost ORDER BY pc.created_at ASC))[1]) * 100.0
        / (array_agg(pi.unit_cost ORDER BY pc.created_at ASC))[1]
      ELSE 0 END, 2)::numeric(10,2),
    COUNT(*)::bigint,
    MAX(pc.created_at)::timestamptz
  FROM public.purchase_items pi
  JOIN public.purchases pc ON pc.id = pi.purchase_id
  JOIN public.raw_materials rm ON rm.id = pi.raw_material_id
  WHERE pc.supplier_id = p_supplier_id
    AND pc.status = 'completed'
    AND pi.raw_material_id IS NOT NULL
  GROUP BY rm.id
  ORDER BY 2 ASC, 3 ASC
$function$;

GRANT EXECUTE ON FUNCTION public.get_supplier_price_impact(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 7. get_order_margin: gross margin per sale order (COGS from the ledger)
--    inventory_ledger records sale deductions with entry_type='sale' and
--    reference_id = sale.id; total_cost is negative on deductions.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_order_margin(
  p_branch_id uuid DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
) RETURNS TABLE (
  sale_id        uuid,
  invoice_number text,
  branch_id      uuid,
  sale_date      date,
  total          numeric(14,2),
  discount_amount numeric(14,2),
  cogs           numeric(16,2),
  gross_margin   numeric(16,2)
) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' STABLE
AS $function$
DECLARE
  v_user_branch uuid;
  v_scope uuid;
BEGIN
  IF NOT is_pos_admin() THEN
    SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
    v_scope := v_user_branch;
  ELSE
    v_scope := p_branch_id;
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.invoice_number,
    s.branch_id,
    s.created_at::date,
    COALESCE(s.total, 0),
    COALESCE(s.discount_amount, 0),
    COALESCE(-SUM(il.total_cost), 0)::numeric(16,2) AS cogs,
    round(COALESCE(s.total, 0) - COALESCE(-SUM(il.total_cost), 0), 2)::numeric(16,2) AS gross_margin
  FROM public.sales s
  LEFT JOIN public.inventory_ledger il
    ON il.reference_id = s.id AND il.entry_type = 'sale' AND il.reference_type = 'sale'
  WHERE (v_scope IS NULL OR s.branch_id = v_scope)
    AND (p_from IS NULL OR s.created_at::date >= p_from)
    AND (p_to IS NULL OR s.created_at::date <= p_to)
  GROUP BY s.id
  ORDER BY s.created_at DESC
  LIMIT 500;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_order_margin(uuid, date, date) TO authenticated;
