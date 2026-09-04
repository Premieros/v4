BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='subscription_settings' AND column_name='id' AND data_type='integer') THEN
    ALTER TABLE public.subscription_settings DROP CONSTRAINT IF EXISTS subscription_settings_id_check;
    ALTER TABLE public.subscription_settings ALTER COLUMN id DROP DEFAULT;
    ALTER TABLE public.subscription_settings ALTER COLUMN id TYPE boolean USING (id <> 0);
    ALTER TABLE public.subscription_settings ALTER COLUMN id SET DEFAULT true;
    ALTER TABLE public.subscription_settings ADD CONSTRAINT subscription_settings_id_check CHECK (id = true);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='subscription_settings' AND column_name='grace_period_days') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='subscription_settings' AND column_name='grace_days') THEN ALTER TABLE public.subscription_settings RENAME COLUMN grace_period_days TO grace_days; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='subscription_settings' AND column_name='monthly_enabled') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='subscription_settings' AND column_name='allow_monthly') THEN ALTER TABLE public.subscription_settings RENAME COLUMN monthly_enabled TO allow_monthly; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='subscription_settings' AND column_name='annual_enabled') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='subscription_settings' AND column_name='allow_yearly') THEN ALTER TABLE public.subscription_settings RENAME COLUMN annual_enabled TO allow_yearly; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='subscription_settings' AND column_name='updated_by') THEN ALTER TABLE public.subscription_settings ADD COLUMN updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL; END IF;
END $$;

DROP FUNCTION IF EXISTS public.subscription_settings_get();
DROP FUNCTION IF EXISTS public.subscription_settings_update(jsonb);

CREATE OR REPLACE FUNCTION public.subscription_settings_get()
RETURNS public.subscription_settings LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v public.subscription_settings%ROWTYPE;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  SELECT * INTO v FROM public.subscription_settings WHERE id=true;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.subscription_settings_update(p_instapay_id text,p_beneficiary_name text,p_qr_code_url text,p_instructions_ar text,p_instructions_en text,p_trial_days integer,p_warning_days integer,p_grace_days integer,p_require_receipt boolean,p_allow_monthly boolean,p_allow_yearly boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.is_super_admin() THEN RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED'); END IF;
  IF p_trial_days < 0 OR p_trial_days > 365 OR p_warning_days < 0 OR p_warning_days > 90 OR p_grace_days < 0 OR p_grace_days > 90 THEN RETURN jsonb_build_object('success',false,'error','INVALID_SETTINGS'); END IF;
  IF NOT p_allow_monthly AND NOT p_allow_yearly THEN RETURN jsonb_build_object('success',false,'error','ONE_BILLING_PERIOD_REQUIRED'); END IF;
  UPDATE public.subscription_settings SET instapay_id=NULLIF(btrim(p_instapay_id),''),beneficiary_name=NULLIF(btrim(p_beneficiary_name),''),qr_code_url=NULLIF(btrim(p_qr_code_url),''),instructions_ar=NULLIF(btrim(p_instructions_ar),''),instructions_en=NULLIF(btrim(p_instructions_en),''),trial_days=p_trial_days,warning_days=p_warning_days,grace_days=p_grace_days,require_receipt=p_require_receipt,allow_monthly=p_allow_monthly,allow_yearly=p_allow_yearly,updated_at=now(),updated_by=auth.uid() WHERE id=true;
  RETURN jsonb_build_object('success',true);
END;
$$;

REVOKE ALL ON FUNCTION public.subscription_settings_get() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.subscription_settings_update(text,text,text,text,text,integer,integer,integer,boolean,boolean,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.subscription_settings_get() TO authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_settings_update(text,text,text,text,text,integer,integer,integer,boolean,boolean,boolean) TO authenticated;

COMMIT;
