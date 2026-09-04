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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  IF coalesce(p_trial_days, 0) < 0 OR coalesce(p_trial_days, 0) > 365
     OR coalesce(p_warning_days, 7) < 0 OR coalesce(p_warning_days, 7) > 90
     OR coalesce(p_grace_days, 0) < 0 OR coalesce(p_grace_days, 0) > 90 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_SETTINGS');
  END IF;

  IF coalesce(p_allow_monthly, true) = false AND coalesce(p_allow_yearly, true) = false THEN
    RETURN jsonb_build_object('success', false, 'error', 'ONE_BILLING_PERIOD_REQUIRED');
  END IF;

  UPDATE public.subscription_settings
  SET instapay_id = coalesce(nullif(btrim(p_instapay_id), ''), ''),
      beneficiary_name = coalesce(nullif(btrim(p_beneficiary_name), ''), ''),
      qr_code_url = coalesce(nullif(btrim(p_qr_code_url), ''), ''),
      instructions_ar = coalesce(nullif(btrim(p_instructions_ar), ''), ''),
      instructions_en = coalesce(nullif(btrim(p_instructions_en), ''), ''),
      trial_days = coalesce(p_trial_days, 0),
      warning_days = coalesce(p_warning_days, 7),
      grace_days = coalesce(p_grace_days, 0),
      require_receipt = coalesce(p_require_receipt, true),
      allow_monthly = coalesce(p_allow_monthly, true),
      allow_yearly = coalesce(p_allow_yearly, true),
      updated_at = now(),
      updated_by = auth.uid()
  WHERE id = true;

  RETURN jsonb_build_object('success', true);
END;
$$;
