-- 060. Harden InstaPay submission and enforce branch ownership.
-- Super Admin is global; ordinary users can submit only for their own branch.

CREATE OR REPLACE FUNCTION public.submit_instapay_payment(
  p_branch_id uuid,
  p_plan_id text,
  p_amount numeric,
  p_billing_period text DEFAULT 'monthly',
  p_reference text DEFAULT NULL,
  p_receipt_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  expected_amount numeric;
  own_branch uuid;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','UNAUTHENTICATED');
  END IF;

  SELECT u.branch_id INTO own_branch
  FROM public.users u
  WHERE u.id = uid AND u.is_active;

  IF own_branch IS NULL AND NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('success',false,'error','NO_BRANCH');
  END IF;

  IF NOT public.is_super_admin() AND own_branch <> p_branch_id THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_ACCESS_DENIED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = p_branch_id AND b.is_active) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_NOT_FOUND');
  END IF;

  IF p_billing_period NOT IN ('monthly','yearly') THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_BILLING_PERIOD');
  END IF;

  SELECT CASE WHEN p_billing_period = 'yearly' THEN yearly_price_egp ELSE monthly_price_egp END
  INTO expected_amount
  FROM public.subscription_plans
  WHERE id = p_plan_id AND is_active;

  IF expected_amount IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','PLAN_NOT_FOUND');
  END IF;

  IF p_amount <> expected_amount THEN
    RETURN jsonb_build_object('success',false,'error','AMOUNT_MISMATCH','expected_amount',expected_amount);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.subscription_payments sp
    WHERE sp.branch_id = p_branch_id
      AND sp.status = 'pending'
  ) THEN
    RETURN jsonb_build_object('success',false,'error','PENDING_PAYMENT_EXISTS');
  END IF;

  INSERT INTO public.subscription_payments(
    branch_id, plan_id, amount, billing_period, reference, receipt_url, submitted_by
  )
  VALUES(
    p_branch_id, p_plan_id, p_amount, p_billing_period, NULLIF(trim(p_reference), ''), NULLIF(trim(p_receipt_url), ''), uid
  );

  RETURN jsonb_build_object('success',true,'status','pending');
END;
$$;

REVOKE ALL ON FUNCTION public.submit_instapay_payment(uuid,text,numeric,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_instapay_payment(uuid,text,numeric,text,text,text) TO authenticated;

CREATE INDEX IF NOT EXISTS idx_subscription_payments_pending_branch
  ON public.subscription_payments(branch_id)
  WHERE status = 'pending';
