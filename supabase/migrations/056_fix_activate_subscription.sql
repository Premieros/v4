-- ============================================================================
-- 056. Fix activate_subscription: never touch NOT NULL trial columns
-- ----------------------------------------------------------------------------
-- 055 activated a plan by writing trial_starts_at/trial_ends_at = NULL, but
-- both columns are NOT NULL, so every activate_subscription call raised
-- "null value in column trial_starts_at". The trial fields are historical once
-- the row becomes 'active' (subscription_status reads current_period_ends_at),
-- so activation now leaves them untouched. Idempotent.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.activate_subscription(
  p_branch_id uuid,
  p_plan_id text,
  p_billing_period text DEFAULT 'monthly',
  p_activate boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.subscription_plans%ROWTYPE;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_price numeric(10,2);
BEGIN
  IF NOT is_pos_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  IF p_branch_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_NOT_FOUND');
  END IF;

  IF NOT p_activate THEN
    UPDATE public.branch_subscriptions
    SET status = 'cancelled',
        cancel_at = now(),
        cancelled_at = now(),
        updated_at = now()
    WHERE branch_id = p_branch_id;
    RETURN jsonb_build_object('success', true, 'branch_id', p_branch_id, 'status', 'cancelled');
  END IF;

  SELECT * INTO v_plan FROM public.subscription_plans WHERE id = p_plan_id AND is_active;
  IF v_plan.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'PLAN_NOT_FOUND');
  END IF;

  v_period_start := now();
  IF p_billing_period = 'yearly' THEN
    v_period_end := v_period_start + interval '1 year';
    v_price := v_plan.yearly_price_egp;
  ELSE
    v_period_end := v_period_start + interval '1 month';
    v_price := v_plan.monthly_price_egp;
  END IF;

  INSERT INTO public.branch_subscriptions (
    branch_id, plan_id, status,
    current_period_starts_at, current_period_ends_at,
    cancel_at, cancelled_at, updated_at
  ) VALUES (
    p_branch_id, v_plan.id, 'active',
    v_period_start, v_period_end,
    NULL, NULL, now()
  )
  ON CONFLICT (branch_id) DO UPDATE SET
    plan_id = EXCLUDED.plan_id,
    status = 'active',
    current_period_starts_at = EXCLUDED.current_period_starts_at,
    current_period_ends_at = EXCLUDED.current_period_ends_at,
    cancel_at = NULL,
    cancelled_at = NULL,
    updated_at = now();

  RETURN jsonb_build_object('success', true, 'branch_id', p_branch_id, 'status', 'active',
    'plan_id', v_plan.id, 'price_egp', v_price);
END;
$$;

GRANT EXECUTE ON FUNCTION public.activate_subscription(uuid, text, text, boolean) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
