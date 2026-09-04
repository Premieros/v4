-- Migration 086: Split order status into kitchen/payment/print status columns
-- This enables independent kitchen display, payment processing, and print workflow.

-- ======================================================================
-- 1. Add new columns to orders
-- ======================================================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS kitchen_status text DEFAULT 'pending'
    CHECK (kitchen_status IN ('pending','sent','cooking','ready','served','cancelled')),
  ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid','partial','paid','refunded')),
  ADD COLUMN IF NOT EXISTS print_status text DEFAULT 'pending'
    CHECK (print_status IN ('pending','printed','cancelled')),
  ADD COLUMN IF NOT EXISTS kitchen_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS kitchen_ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_at timestamptz,
  ADD COLUMN IF NOT EXISTS printed_at timestamptz;

COMMENT ON COLUMN public.orders.kitchen_status IS 'Kitchen workflow: pending → sent → cooking → ready → served';
COMMENT ON COLUMN public.orders.payment_status IS 'Payment workflow: unpaid → partial → paid → refunded';
COMMENT ON COLUMN public.orders.print_status IS 'Print workflow: pending → printed → cancelled';

-- ======================================================================
-- 2. Backfill from existing status column
-- ======================================================================
UPDATE public.orders SET
  kitchen_status = CASE
    WHEN status IN ('open','confirmed') THEN 'pending'
    WHEN status = 'kitchen' THEN 'cooking'
    WHEN status = 'served' THEN 'served'
    WHEN status = 'completed' THEN 'served'
    WHEN status = 'cancelled' THEN 'cancelled'
    ELSE 'pending'
  END,
  payment_status = CASE
    WHEN status IN ('open','confirmed','kitchen','served') THEN 'unpaid'
    WHEN status = 'completed' THEN 'paid'
    WHEN status = 'refunded' THEN 'refunded'
    ELSE 'unpaid'
  END,
  print_status = CASE
    WHEN status = 'completed' THEN 'printed'
    ELSE 'pending'
  END
WHERE kitchen_status = 'pending' AND payment_status = 'unpaid';

-- ======================================================================
-- 3. RPC: set_kitchen_status
-- ======================================================================
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

-- ======================================================================
-- 4. RPC: set_payment_status
-- ======================================================================
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

-- ======================================================================
-- 5. RPC: set_print_status
-- ======================================================================
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

-- ======================================================================
-- 6. Grants
-- ======================================================================
GRANT EXECUTE ON FUNCTION public.set_kitchen_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_payment_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_print_status(uuid, text) TO authenticated;

-- ======================================================================
-- 7. Indexes for filtering by sub-status
-- ======================================================================
CREATE INDEX IF NOT EXISTS idx_orders_kitchen_status ON public.orders(kitchen_status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON public.orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_print_status ON public.orders(print_status);
