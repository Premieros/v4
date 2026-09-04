-- ============================================================================
-- 057. Implicit 14-day trial for branches without a subscription row
-- ----------------------------------------------------------------------------
-- The 055 sale guard blocks any branch whose subscription is not active / on a
-- live trial. subscription_status() treated a branch with NO row in
-- branch_subscriptions as 'none' + expired, which locked out two legitimate
-- cases:
--
--   1. Branches created directly by an admin from the branches panel (a plain
--      INSERT into public.branches, not register_branch): they never received a
--      subscription row, so every non-super_admin sale returned SUBSCRIPTION_EXPIRED.
--   2. Integration tests that insert fixture branches directly: the guard now
--      short-circuits them with SUBSCRIPTION_EXPIRED before any sale logic runs.
--
-- Fix: when a branch exists but has no subscription row, subscription_status()
-- now reports the same trial register_branch()/the 055 backfill grant, anchored
-- to branches.created_at so it is a real, non-renewable 14-day window. Unknown
-- branch ids (no row AND no branch) still report 'none'/expired. Idempotent.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.subscription_status(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.branch_subscriptions%ROWTYPE;
  v_created timestamptz;
  v_implicit_end timestamptz;
  v_status text;
  v_expired boolean;
BEGIN
  SELECT * INTO v_row FROM public.branch_subscriptions WHERE branch_id = p_branch_id;

  IF v_row.branch_id IS NULL THEN
    SELECT created_at INTO v_created FROM public.branches WHERE id = p_branch_id;
    IF v_created IS NULL THEN
      RETURN jsonb_build_object(
        'branch_id', p_branch_id,
        'status', 'none', 'plan_id', NULL,
        'expired', true, 'trial_ends_at', NULL,
        'current_period_ends_at', NULL, 'cancelled_at', NULL
      );
    END IF;
    v_implicit_end := v_created + interval '14 days';
    RETURN jsonb_build_object(
      'branch_id', p_branch_id,
      'status', 'trial', 'plan_id', NULL,
      'expired', v_implicit_end <= now(),
      'trial_ends_at', v_implicit_end,
      'current_period_ends_at', NULL, 'cancelled_at', NULL
    );
  END IF;

  v_status := v_row.status;
  v_expired := false;

  IF v_status IN ('trial', 'active', 'past_due') THEN
    IF v_status = 'trial' THEN
      IF v_row.trial_ends_at IS NOT NULL AND v_row.trial_ends_at <= now() THEN
        v_status := 'expired';
        v_expired := true;
      END IF;
    ELSE
      IF v_row.current_period_ends_at IS NOT NULL AND v_row.current_period_ends_at <= now() THEN
        v_status := 'expired';
        v_expired := true;
      END IF;
    END IF;
  ELSE
    v_expired := true;
  END IF;

  RETURN jsonb_build_object(
    'branch_id', p_branch_id,
    'status', v_status,
    'plan_id', v_row.plan_id,
    'expired', v_expired,
    'trial_ends_at', v_row.trial_ends_at,
    'current_period_ends_at', v_row.current_period_ends_at,
    'cancelled_at', v_row.cancelled_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.subscription_status(uuid) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
