-- 063. Global subscription settings, Super Admin only.
-- Super Admin is global and is never restricted to a branch.

CREATE TABLE IF NOT EXISTS public.subscription_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  instapay_id text,
  beneficiary_name text,
  qr_code_url text,
  instructions_ar text,
  instructions_en text,
  trial_days integer NOT NULL DEFAULT 14 CHECK (trial_days >= 0 AND trial_days <= 365),
  warning_days integer NOT NULL DEFAULT 7 CHECK (warning_days >= 0 AND warning_days <= 90),
  grace_days integer NOT NULL DEFAULT 0 CHECK (grace_days >= 0 AND grace_days <= 90),
  require_receipt boolean NOT NULL DEFAULT true,
  allow_monthly boolean NOT NULL DEFAULT true,
  allow_yearly boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

INSERT INTO public.subscription_settings (id) VALUES (true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.subscription_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subscription_settings_super_admin_select ON public.subscription_settings;
DROP POLICY IF EXISTS subscription_settings_super_admin_write ON public.subscription_settings;

CREATE POLICY subscription_settings_super_admin_select
ON public.subscription_settings FOR SELECT TO authenticated
USING (public.is_super_admin());

CREATE POLICY subscription_settings_super_admin_write
ON public.subscription_settings FOR ALL TO authenticated
USING (public.is_super_admin())
WITH CHECK (public.is_super_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscription_settings TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.subscription_settings_get()
RETURNS public.subscription_settings
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v public.subscription_settings%ROWTYPE;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;
  SELECT * INTO v FROM public.subscription_settings WHERE id=true;
  RETURN v;
END; $$;

CREATE OR REPLACE FUNCTION public.subscription_settings_update(
  p_instapay_id text,
  p_beneficiary_name text,
  p_qr_code_url text,
  p_instructions_ar text,
  p_instructions_en text,
  p_trial_days integer,
  p_warning_days integer,
  p_grace_days integer,
  p_require_receipt boolean,
  p_allow_monthly boolean,
  p_allow_yearly boolean
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED');
  END IF;
  IF p_trial_days < 0 OR p_trial_days > 365 OR p_warning_days < 0 OR p_warning_days > 90 OR p_grace_days < 0 OR p_grace_days > 90 THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_SETTINGS');
  END IF;
  IF NOT p_allow_monthly AND NOT p_allow_yearly THEN
    RETURN jsonb_build_object('success',false,'error','ONE_BILLING_PERIOD_REQUIRED');
  END IF;
  UPDATE public.subscription_settings SET
    instapay_id = NULLIF(btrim(p_instapay_id),''),
    beneficiary_name = NULLIF(btrim(p_beneficiary_name),''),
    qr_code_url = NULLIF(btrim(p_qr_code_url),''),
    instructions_ar = NULLIF(btrim(p_instructions_ar),''),
    instructions_en = NULLIF(btrim(p_instructions_en),''),
    trial_days = p_trial_days,
    warning_days = p_warning_days,
    grace_days = p_grace_days,
    require_receipt = p_require_receipt,
    allow_monthly = p_allow_monthly,
    allow_yearly = p_allow_yearly,
    updated_at = now(),
    updated_by = auth.uid()
  WHERE id=true;
  RETURN jsonb_build_object('success',true);
END; $$;

REVOKE ALL ON FUNCTION public.subscription_settings_get() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.subscription_settings_update(text,text,text,text,text,integer,integer,integer,boolean,boolean,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.subscription_settings_get() TO authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_settings_update(text,text,text,text,text,integer,integer,integer,boolean,boolean,boolean) TO authenticated;
