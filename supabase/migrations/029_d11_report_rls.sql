-- Migration: D11 Reporting-RPC security hardening
-- Confirmed live during the full system audit:
--   1. Every public function granted EXECUTE to PUBLIC + anon. Because the
--      reporting functions are SECURITY DEFINER, any caller (including an
--      unauthenticated request using the public anon key, and any user of any
--      branch) could read ANY branch's financial data by passing an arbitrary
--      p_branch_id. Proven live: anon and a BRANCH_B cashier both retrieved
--      BRANCH_A journals / trial balance.
--   2. The read-only reporting functions also bypass RLS, so passing another
--      branch's id leaked that branch's rows regardless of the caller.

-- ================================================================
-- 1. Restrict EXECUTE to authenticated/service_role only.
--    anon keeps exactly one function: get_login_email (the PIN-login flow
--    resolves username -> email before the user authenticates).
-- ================================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.get_login_email(text) TO anon;

-- ================================================================
-- 2. Convert the read-only reporting functions to SECURITY INVOKER.
--    They then run under the caller's grants + RLS, so branch isolation is
--    enforced by the policies themselves regardless of the p_branch_id that
--    the client passes (a user can only ever see their own branch; admins
--    still see everything).
-- ================================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND p.proname IN (
        'get_journals', 'get_journal_entry', 'get_general_ledger',
        'get_income_statement', 'get_balance_sheet', 'get_trial_balance',
        'get_trial_balance_summary', 'get_cash_flow', 'get_aging_summary',
        'get_ar_aging', 'get_ap_aging', 'get_open_invoices',
        'get_party_statement', 'get_treasury_balances',
        'get_bank_reconciliation', 'get_audit_trail'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SECURITY INVOKER', r.sig);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
