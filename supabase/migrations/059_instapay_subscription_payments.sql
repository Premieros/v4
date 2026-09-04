-- 059. InstaPay subscription transfer workflow
-- Super Admin is global and is never restricted to a branch.

CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  plan_id text REFERENCES public.subscription_plans(id) ON DELETE SET NULL,
  amount numeric(10,2) NOT NULL CHECK (amount >= 0),
  billing_period text NOT NULL DEFAULT 'monthly' CHECK (billing_period IN ('monthly','yearly')),
  payment_method text NOT NULL DEFAULT 'instapay' CHECK (payment_method = 'instapay'),
  reference text,
  receipt_url text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  submitted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscription_payments_branch ON public.subscription_payments(branch_id);
CREATE INDEX IF NOT EXISTS idx_subscription_payments_status ON public.subscription_payments(status);

ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subscription_payments_super_admin_all ON public.subscription_payments;
CREATE POLICY subscription_payments_super_admin_all ON public.subscription_payments FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

CREATE OR REPLACE FUNCTION public.submit_instapay_payment(p_branch_id uuid,p_plan_id text,p_amount numeric,p_billing_period text DEFAULT 'monthly',p_reference text DEFAULT NULL,p_receipt_url text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RETURN jsonb_build_object('success',false,'error','UNAUTHENTICATED'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id=uid AND u.is_active) THEN RETURN jsonb_build_object('success',false,'error','USER_INACTIVE'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id=p_branch_id) THEN RETURN jsonb_build_object('success',false,'error','BRANCH_NOT_FOUND'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE id=p_plan_id AND is_active) THEN RETURN jsonb_build_object('success',false,'error','PLAN_NOT_FOUND'); END IF;
  IF p_amount <= 0 THEN RETURN jsonb_build_object('success',false,'error','INVALID_AMOUNT'); END IF;
  INSERT INTO public.subscription_payments(branch_id,plan_id,amount,billing_period,reference,receipt_url,submitted_by)
  VALUES(p_branch_id,p_plan_id,p_amount,p_billing_period,p_reference,p_receipt_url,uid);
  RETURN jsonb_build_object('success',true,'status','pending');
END; $$;
REVOKE ALL ON FUNCTION public.submit_instapay_payment(uuid,text,numeric,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_instapay_payment(uuid,text,numeric,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.review_instapay_payment(p_payment_id uuid,p_approve boolean,p_rejection_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE pay public.subscription_payments%ROWTYPE; uid uuid := auth.uid();
BEGIN
  IF NOT public.is_super_admin() THEN RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED'); END IF;
  SELECT * INTO pay FROM public.subscription_payments WHERE id=p_payment_id FOR UPDATE;
  IF pay.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','PAYMENT_NOT_FOUND'); END IF;
  IF pay.status <> 'pending' THEN RETURN jsonb_build_object('success',false,'error','PAYMENT_ALREADY_REVIEWED'); END IF;
  IF NOT p_approve THEN
    UPDATE public.subscription_payments SET status='rejected',rejected_at=now(),rejection_reason=p_rejection_reason,approved_by=uid,updated_at=now() WHERE id=p_payment_id;
    RETURN jsonb_build_object('success',true,'status','rejected');
  END IF;
  UPDATE public.subscription_payments SET status='approved',approved_by=uid,approved_at=now(),updated_at=now() WHERE id=p_payment_id;
  PERFORM public.activate_subscription(pay.branch_id,pay.plan_id,pay.billing_period,true);
  RETURN jsonb_build_object('success',true,'status','approved','branch_id',pay.branch_id);
END; $$;
REVOKE ALL ON FUNCTION public.review_instapay_payment(uuid,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_instapay_payment(uuid,boolean,text) TO authenticated;
