-- Migration 090: Kitchen station routing
-- Adds station column to orders + get_kitchen_queue RPC

-- ======================================================================
-- 1. Station column on orders
-- ======================================================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS station text DEFAULT 'main'
    CHECK (station IN ('main','grill','salad','drinks','dessert','fryer'));

COMMENT ON COLUMN public.orders.station IS 'Kitchen station assigned to this order (grill/salad/drinks/etc).';

CREATE INDEX IF NOT EXISTS idx_orders_station ON public.orders(station);

-- ======================================================================
-- 2. RPC: route_to_station
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
BEGIN
  IF p_station NOT IN ('main','grill','salad','drinks','dessert','fryer') THEN
    RAISE EXCEPTION 'Invalid station: %', p_station;
  END IF;

  UPDATE public.orders
  SET station = p_station, updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO public.audit_log(user_id, action, entity, entity_id, details)
  VALUES (auth.uid(), 'route_station', 'order', p_order_id,
    jsonb_build_object('station', p_station));
END;
$$;

-- ======================================================================
-- 3. RPC: get_kitchen_queue
-- ======================================================================
CREATE OR REPLACE FUNCTION public.get_kitchen_queue(
  p_station text DEFAULT NULL,
  p_branch_id uuid DEFAULT public.get_branch_id()
)
RETURNS TABLE (
  order_id uuid,
  order_number text,
  table_number integer,
  station text,
  kitchen_status text,
  guest_count integer,
  notes text,
  created_at timestamptz,
  items jsonb,
  elapsed_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.id AS order_id,
    o.order_number,
    o.table_number,
    o.station,
    o.kitchen_status,
    o.guest_count,
    o.notes,
    o.created_at,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'product_name', p.name,
        'quantity', oi.quantity,
        'modifiers', oi.notes
      ))
      FROM public.order_items oi
      JOIN public.products p ON p.id = oi.product_id
      WHERE oi.order_id = o.id),
      '[]'::jsonb
    ) AS items,
    EXTRACT(EPOCH FROM (now() - o.created_at))::integer AS elapsed_seconds
  FROM public.orders o
  WHERE o.branch_id = p_branch_id
    AND o.kitchen_status IN ('sent', 'cooking')
    AND (p_station IS NULL OR o.station = p_station)
  ORDER BY o.created_at ASC;
END;
$$;

-- ======================================================================
-- 4. Grants
-- ======================================================================
GRANT EXECUTE ON FUNCTION public.route_to_station(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_kitchen_queue(text, uuid) TO authenticated;
