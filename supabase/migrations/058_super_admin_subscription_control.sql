-- 058. Super Admin-only subscription control and DB sale guard
-- Keeps subscription management exclusive to the super_admin role.

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.is_active AND u.role = 'super_admin'
  );
$$;
REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;

CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id text PRIMARY KEY,
  name_ar text NOT NULL,
  name_en text NOT NULL,
  monthly_price_egp numeric(10,2) NOT NULL DEFAULT 0,
  yearly_price_egp numeric(10,2) NOT NULL DEFAULT 0,
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.branch_subscriptions (
  branch_id uuid PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
  plan_id text REFERENCES public.subscription_plans(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'trial',
  trial_starts_at timestamptz NOT NULL DEFAULT now(),
  trial_ends_at timestamptz,
  current_period_starts_at timestamptz,
  current_period_ends_at timestamptz,
  cancel_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT branch_subscriptions_status_check CHECK (status IN ('trial','active','past_due','cancelled','expired'))
);

INSERT INTO public.subscription_plans (id,name_ar,name_en,monthly_price_egp,yearly_price_egp,features)
VALUES
('basic','الأساسية','Basic',299,2990,'["Users: 2","Warehouses: 1","Inventory & sales"]'),
('standard','القياسية','Standard',599,5990,'["Users: 5","Warehouses: 3","Accounting & reports"]'),
('enterprise','المتقدمة','Enterprise',999,9990,'["Users: unlimited","Multi-branch","Full suite + priority support"]')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.branch_subscriptions(branch_id,status,trial_starts_at,trial_ends_at)
SELECT b.id,'trial',now(),now()+interval '14 days'
FROM public.branches b
WHERE NOT EXISTS (SELECT 1 FROM public.branch_subscriptions s WHERE s.branch_id=b.id);

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscription_plans_public_read ON public.subscription_plans;
CREATE POLICY subscription_plans_public_read ON public.subscription_plans FOR SELECT TO anon,authenticated USING (is_active=true);
DROP POLICY IF EXISTS subscription_plans_super_admin_write ON public.subscription_plans;
CREATE POLICY subscription_plans_super_admin_write ON public.subscription_plans FOR ALL TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());
DROP POLICY IF EXISTS branch_subscriptions_super_admin_only ON public.branch_subscriptions;
CREATE POLICY branch_subscriptions_super_admin_only ON public.branch_subscriptions FOR ALL TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());
GRANT SELECT ON public.subscription_plans TO anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.subscription_plans, public.branch_subscriptions TO authenticated;

CREATE OR REPLACE FUNCTION public.subscription_status(p_branch_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.branch_subscriptions%ROWTYPE; s text; e boolean;
BEGIN
 SELECT * INTO r FROM public.branch_subscriptions WHERE branch_id=p_branch_id;
 IF r.branch_id IS NULL THEN RETURN jsonb_build_object('status','none','expired',true,'branch_id',p_branch_id); END IF;
 s:=r.status; e:=false;
 IF s='trial' AND r.trial_ends_at IS NOT NULL AND r.trial_ends_at<=now() THEN s:='expired'; e:=true;
 ELSIF s IN ('active','past_due') AND r.current_period_ends_at IS NOT NULL AND r.current_period_ends_at<=now() THEN s:='expired'; e:=true;
 ELSIF s IN ('cancelled','expired') THEN e:=true; END IF;
 RETURN jsonb_build_object('branch_id',p_branch_id,'status',s,'plan_id',r.plan_id,'expired',e,'trial_ends_at',r.trial_ends_at,'current_period_ends_at',r.current_period_ends_at,'cancelled_at',r.cancelled_at);
END; $$;
REVOKE ALL ON FUNCTION public.subscription_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.subscription_status(uuid) TO anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.subscription_expired(p_branch_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE((public.subscription_status(p_branch_id)->>'expired')::boolean, true);
$$;
REVOKE ALL ON FUNCTION public.subscription_expired(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.subscription_expired(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.activate_subscription(p_branch_id uuid,p_plan_id text,p_billing_period text DEFAULT 'monthly',p_activate boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p public.subscription_plans%ROWTYPE; st timestamptz:=now(); en timestamptz; price numeric(10,2);
BEGIN
 IF NOT is_super_admin() THEN RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.branches WHERE id=p_branch_id) THEN RETURN jsonb_build_object('success',false,'error','BRANCH_NOT_FOUND'); END IF;
 IF NOT p_activate THEN
   UPDATE public.branch_subscriptions SET status='cancelled',cancel_at=now(),cancelled_at=now(),updated_at=now() WHERE branch_id=p_branch_id;
   RETURN jsonb_build_object('success',true,'status','cancelled','branch_id',p_branch_id);
 END IF;
 SELECT * INTO p FROM public.subscription_plans WHERE id=p_plan_id AND is_active;
 IF p.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','PLAN_NOT_FOUND'); END IF;
 IF p_billing_period='yearly' THEN en:=st+interval '1 year'; price:=p.yearly_price_egp; ELSE en:=st+interval '1 month'; price:=p.monthly_price_egp; END IF;
 INSERT INTO public.branch_subscriptions(branch_id,plan_id,status,trial_starts_at,trial_ends_at,current_period_starts_at,current_period_ends_at,cancel_at,cancelled_at,updated_at)
 VALUES(p_branch_id,p.id,'active',NULL,NULL,st,en,NULL,NULL,now())
 ON CONFLICT(branch_id) DO UPDATE SET plan_id=excluded.plan_id,status='active',trial_starts_at=NULL,trial_ends_at=NULL,current_period_starts_at=excluded.current_period_starts_at,current_period_ends_at=excluded.current_period_ends_at,cancel_at=NULL,cancelled_at=NULL,updated_at=now();
 RETURN jsonb_build_object('success',true,'status','active','branch_id',p_branch_id,'plan_id',p.id,'price_egp',price,'current_period_ends_at',en);
END; $$;
REVOKE ALL ON FUNCTION public.activate_subscription(uuid,text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_subscription(uuid,text,text,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_order_subscription()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role' THEN RETURN NEW; END IF;
  IF public.is_super_admin() THEN RETURN NEW; END IF;
  IF NEW.branch_id IS NULL OR public.subscription_expired(NEW.branch_id) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_EXPIRED' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_order_subscription() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_order_subscription() TO authenticated,service_role;
DROP TRIGGER IF EXISTS trg_guard_order_subscription ON public.orders;
CREATE TRIGGER trg_guard_order_subscription BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.guard_order_subscription();
