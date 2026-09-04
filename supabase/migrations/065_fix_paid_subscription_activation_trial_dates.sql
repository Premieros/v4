-- Fix paid subscription activation against canonical branch_subscriptions schema.
-- trial_starts_at is NOT NULL; paid activation is represented by a zero-length trial marker.
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
  p public.subscription_plans%ROWTYPE;
  st timestamptz := now();
  en timestamptz;
  price numeric(10,2);
BEGIN
  IF NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id=p_branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_NOT_FOUND');
  END IF;
  IF NOT p_activate THEN
    UPDATE public.branch_subscriptions
      SET status='cancelled', cancel_at=now(), cancelled_at=now(), updated_at=now()
      WHERE branch_id=p_branch_id;
    RETURN jsonb_build_object('success',true,'status','cancelled','branch_id',p_branch_id);
  END IF;

  SELECT * INTO p
  FROM public.subscription_plans
  WHERE id=p_plan_id AND is_active;
  IF p.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','PLAN_NOT_FOUND');
  END IF;

  IF p_billing_period='yearly' THEN
    en := st + interval '1 year';
    price := p.yearly_price_egp;
  ELSE
    en := st + interval '1 month';
    price := p.monthly_price_egp;
  END IF;

  INSERT INTO public.branch_subscriptions(
    branch_id, plan_id, status,
    trial_starts_at, trial_ends_at,
    current_period_starts_at, current_period_ends_at,
    cancel_at, cancelled_at, updated_at
  ) VALUES (
    p_branch_id, p.id, 'active',
    st, st,
    st, en,
    NULL, NULL, now()
  )
  ON CONFLICT(branch_id) DO UPDATE SET
    plan_id=excluded.plan_id,
    status='active',
    trial_starts_at=excluded.trial_starts_at,
    trial_ends_at=excluded.trial_ends_at,
    current_period_starts_at=excluded.current_period_starts_at,
    current_period_ends_at=excluded.current_period_ends_at,
    cancel_at=NULL,
    cancelled_at=NULL,
    updated_at=now();

  RETURN jsonb_build_object(
    'success',true,
    'status','active',
    'branch_id',p_branch_id,
    'plan_id',p.id,
    'price_egp',price,
    'current_period_ends_at',en
  );
END;
$$;
