-- 059. CI-only subscription bypass hook
-- The flag is OFF by default and is never set on a real Supabase project.
-- It exists so disposable Postgres integration fixtures can test POS/RLS
-- behavior without a subscription fixture masking the behavior under test.

CREATE OR REPLACE FUNCTION public.subscription_expired(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN current_setting('app.ci_subscription_bypass', true) = 'on' THEN false
    ELSE COALESCE((public.subscription_status(p_branch_id)->>'expired')::boolean, true)
  END;
$$;

REVOKE ALL ON FUNCTION public.subscription_expired(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.subscription_expired(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
