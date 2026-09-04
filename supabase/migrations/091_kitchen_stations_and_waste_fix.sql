-- Migration 091: Kitchen stations table + fix waste report for admin users

-- ======================================================================
-- 1. Kitchen stations table (replaces hardcoded CHECK constraint)
-- ======================================================================
CREATE TABLE IF NOT EXISTS public.kitchen_stations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE,
  name_ar    text NOT NULL,
  name_en    text NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.kitchen_stations IS 'Configurable kitchen stations for KDS routing.';

INSERT INTO public.kitchen_stations (code, name_ar, name_en, sort_order) VALUES
  ('main',    'الرئيسي',   'Main',    0),
  ('grill',   'المشويات',  'Grill',   1),
  ('salad',   'السلط',     'Salad',   2),
  ('drinks',  'المشروبات', 'Drinks',  3),
  ('dessert', 'الحلويات',  'Dessert', 4),
  ('fryer',   'المقالي',   'Fryer',   5)
ON CONFLICT (code) DO NOTHING;

-- ======================================================================
-- 2. RLS — admins manage, everyone reads
-- ======================================================================
ALTER TABLE public.kitchen_stations ENABLE ROW LEVEL SECURITY;

CREATE POLICY ks_admin_all ON public.kitchen_stations
  FOR ALL USING (is_pos_admin());
CREATE POLICY ks_select ON public.kitchen_stations
  FOR SELECT USING (true);

GRANT SELECT ON public.kitchen_stations TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.kitchen_stations TO authenticated;

-- ======================================================================
-- 3. Fix get_waste_report: handle NULL branch_id for admin users
-- ======================================================================
CREATE OR REPLACE FUNCTION public.get_waste_report(
  p_branch_id uuid DEFAULT public.get_branch_id(),
  p_from_date date DEFAULT (CURRENT_DATE - INTERVAL '30 days'),
  p_to_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  waste_category text,
  waste_type text,
  total_quantity numeric,
  total_cost numeric,
  entry_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    wc.name AS waste_category,
    we.waste_type,
    SUM(we.quantity) AS total_quantity,
    SUM(we.total_cost) AS total_cost,
    COUNT(*)::bigint AS entry_count
  FROM public.waste_entries we
  JOIN public.waste_categories wc ON wc.id = we.waste_category_id
  WHERE (p_branch_id IS NULL OR we.branch_id = p_branch_id)
    AND we.status = 'approved'
    AND we.created_at >= p_from_date
    AND we.created_at < (p_to_date + INTERVAL '1 day')
  GROUP BY wc.name, we.waste_type
  ORDER BY SUM(we.total_cost) DESC;
END;
$$;

-- ======================================================================
-- 4. Fix route_to_station: validate against kitchen_stations table
-- ======================================================================
CREATE OR REPLACE FUNCTION public.route_to_station(
  p_order_id uuid,
  p_station text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.kitchen_stations WHERE code = p_station AND is_active = true) INTO v_exists;

  IF NOT v_exists THEN
    RAISE EXCEPTION 'Invalid or inactive station: %', p_station;
  END IF;

  UPDATE public.orders
  SET station = p_station, updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO public.audit_log(user_id, action, entity, entity_id, details)
  VALUES (auth.uid(), 'route_station', 'order', p_order_id,
    jsonb_build_object('station', p_station));
END;
$$;
