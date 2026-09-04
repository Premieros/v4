-- Migration 087: Fix audit_log column names in order status RPCs from migration 086.
-- audit_log uses: user_id (not actor_id), entity (not entity_type), details (not new_data)

CREATE OR REPLACE FUNCTION public.set_kitchen_status(
  p_order_id uuid,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status NOT IN ('pending','sent','cooking','ready','served','cancelled') THEN
    RAISE EXCEPTION 'Invalid kitchen_status: %', p_status;
  END IF;

  UPDATE public.orders
  SET kitchen_status = p_status,
      kitchen_sent_at = CASE WHEN p_status = 'sent' THEN now() ELSE kitchen_sent_at END,
      kitchen_ready_at = CASE WHEN p_status = 'ready' THEN now() ELSE kitchen_ready_at END,
      updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO public.audit_log(user_id, action, entity, entity_id, details)
  VALUES (auth.uid(), 'kitchen_status', 'order', p_order_id,
    jsonb_build_object('kitchen_status', p_status));
END;
$$;

CREATE OR REPLACE FUNCTION public.set_payment_status(
  p_order_id uuid,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status NOT IN ('unpaid','partial','paid','refunded') THEN
    RAISE EXCEPTION 'Invalid payment_status: %', p_status;
  END IF;

  UPDATE public.orders
  SET payment_status = p_status,
      payment_at = CASE WHEN p_status IN ('paid','refunded') THEN now() ELSE payment_at END,
      updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO public.audit_log(user_id, action, entity, entity_id, details)
  VALUES (auth.uid(), 'payment_status', 'order', p_order_id,
    jsonb_build_object('payment_status', p_status));
END;
$$;

CREATE OR REPLACE FUNCTION public.set_print_status(
  p_order_id uuid,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status NOT IN ('pending','printed','cancelled') THEN
    RAISE EXCEPTION 'Invalid print_status: %', p_status;
  END IF;

  UPDATE public.orders
  SET print_status = p_status,
      printed_at = CASE WHEN p_status = 'printed' THEN now() ELSE printed_at END,
      updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO public.audit_log(user_id, action, entity, entity_id, details)
  VALUES (auth.uid(), 'print_status', 'order', p_order_id,
    jsonb_build_object('print_status', p_status));
END;
$$;
