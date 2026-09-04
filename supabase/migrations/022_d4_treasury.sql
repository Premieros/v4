-- =====================================================================
-- Phase D4: Treasury - cash/bank accounts, transfers & deposits
-- =====================================================================
-- Full treasury module over the chart of accounts:
--   1. treasury_accounts      -> named cash drawers / bank accounts per
--                                branch, each linked to a chart account
--   2. treasury_transactions  -> audit log of every movement
--   3. process_transfer       -> between two treasury accounts
--   4. process_treasury_deposit    -> owner funds entering a treasury account
--   5. process_treasury_withdrawal -> owner funds leaving a treasury account
--   6. get_treasury_balances  -> ledger balance per treasury account
-- All movements post through _post_journal_entry (idempotent per reference)
-- and never weaken existing RLS.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. treasury_accounts
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.treasury_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id       uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  account_id      uuid NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE CASCADE,
  account_type    text NOT NULL DEFAULT 'cash' CHECK (account_type IN ('cash', 'bank')),
  account_name    text NOT NULL,
  account_number  text,
  is_active       boolean NOT NULL DEFAULT true,
  opening_balance numeric(14,2) NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, account_id)
);
COMMENT ON TABLE public.treasury_accounts IS 'حسابات الخزينة (درج نقدية / حساب بنكي) لكل فرع، مرتبطة بشجرة الحسابات';

CREATE INDEX IF NOT EXISTS idx_treasury_accounts_branch ON public.treasury_accounts (branch_id, is_active);

ALTER TABLE public.treasury_accounts ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_treasury_accounts_updated BEFORE UPDATE ON public.treasury_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP POLICY IF EXISTS "treasury_accounts_select" ON public.treasury_accounts;
CREATE POLICY "treasury_accounts_select" ON public.treasury_accounts
  FOR SELECT TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "treasury_accounts_insert" ON public.treasury_accounts;
CREATE POLICY "treasury_accounts_insert" ON public.treasury_accounts
  FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR (can_permission('accounts.manage') AND branch_id = get_branch_id()));
DROP POLICY IF EXISTS "treasury_accounts_update" ON public.treasury_accounts;
CREATE POLICY "treasury_accounts_update" ON public.treasury_accounts
  FOR UPDATE TO authenticated
  USING (is_pos_admin() OR (can_permission('accounts.manage') AND branch_id = get_branch_id()))
  WITH CHECK (is_pos_admin() OR (can_permission('accounts.manage') AND branch_id = get_branch_id()));
DROP POLICY IF EXISTS "treasury_accounts_delete" ON public.treasury_accounts;
CREATE POLICY "treasury_accounts_delete" ON public.treasury_accounts
  FOR DELETE TO authenticated
  USING (is_pos_admin() OR (can_permission('accounts.manage') AND branch_id = get_branch_id()));

-- Seed one cash + one bank account per branch from the mapped accounts
CREATE OR REPLACE FUNCTION public.seed_treasury_accounts(p_branch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.treasury_accounts (branch_id, account_id, account_type, account_name)
  SELECT p_branch_id, m.account_id, m.semantic_key, a.name
  FROM public.account_mappings m
  JOIN public.chart_of_accounts a ON a.id = m.account_id
  WHERE m.branch_id = p_branch_id AND m.semantic_key IN ('cash', 'bank')
  ON CONFLICT (branch_id, account_id) DO NOTHING;
END;
$function$;

SELECT public.seed_treasury_accounts(id) FROM public.branches;

-- ---------------------------------------------------------------------
-- 2. treasury_transactions (movement audit log)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.treasury_transactions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id         uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  transaction_type  text NOT NULL CHECK (transaction_type IN ('transfer', 'deposit', 'withdrawal')),
  from_account_id   uuid REFERENCES public.treasury_accounts(id),
  to_account_id     uuid REFERENCES public.treasury_accounts(id),
  amount            numeric(14,2) NOT NULL CHECK (amount > 0),
  reference_number  text,
  notes             text,
  created_by        uuid REFERENCES public.users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.treasury_transactions IS 'حركات الخزينة (تحويل / إيداع / سحب)';

CREATE INDEX IF NOT EXISTS idx_treasury_transactions_branch ON public.treasury_transactions (branch_id, created_at DESC);

ALTER TABLE public.treasury_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "treasury_transactions_select" ON public.treasury_transactions;
CREATE POLICY "treasury_transactions_select" ON public.treasury_transactions
  FOR SELECT TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "treasury_transactions_insert" ON public.treasury_transactions;
CREATE POLICY "treasury_transactions_insert" ON public.treasury_transactions
  FOR INSERT TO authenticated WITH CHECK (is_pos_admin());

INSERT INTO public.document_sequences (seq_type, next_value) VALUES ('treasury', 1)
ON CONFLICT (seq_type) DO NOTHING;

-- ---------------------------------------------------------------------
-- 3. Shared validation for treasury RPCs
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._treasury_guard(p_branch_id uuid, p_account_id uuid, p_amount numeric)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_account record;
  v_user_branch uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_AMOUNT');
  END IF;

  IF NOT is_pos_admin() AND get_user_role() NOT IN ('accountant', 'branch_manager') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_ALLOWED',
      'detail', 'Treasury operations require the accountant or branch manager role.');
  END IF;

  IF NOT is_pos_admin() THEN
    SELECT branch_id INTO v_user_branch FROM users WHERE id = auth.uid();
    IF v_user_branch IS NOT NULL AND p_branch_id <> v_user_branch THEN
      RETURN jsonb_build_object('ok', false, 'error', 'BRANCH_MISMATCH');
    END IF;
  END IF;

  IF p_account_id IS NOT NULL THEN
    SELECT id, account_id, account_type, is_active INTO v_account
    FROM public.treasury_accounts
    WHERE id = p_account_id AND branch_id = p_branch_id;
    IF v_account.id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'TREASURY_ACCOUNT_NOT_FOUND');
    END IF;
    IF NOT v_account.is_active THEN
      RETURN jsonb_build_object('ok', false, 'error', 'TREASURY_ACCOUNT_INACTIVE');
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- ---------------------------------------------------------------------
-- 4. process_transfer: move money between two treasury accounts
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_transfer(
  p_branch_id uuid,
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount numeric,
  p_notes text DEFAULT NULL::text
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_guard jsonb;
  v_from record;
  v_to record;
  v_number text;
  v_tx_id uuid;
  v_lines jsonb := '[]'::jsonb;
BEGIN
  BEGIN
    v_guard := public._treasury_guard(p_branch_id, p_from_account_id, p_amount);
    IF NOT (v_guard->>'ok')::boolean THEN
      RETURN v_guard;
    END IF;
    v_guard := public._treasury_guard(p_branch_id, p_to_account_id, p_amount);
    IF NOT (v_guard->>'ok')::boolean THEN
      RETURN v_guard;
    END IF;

    IF p_from_account_id = p_to_account_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'SAME_ACCOUNT');
    END IF;

    SELECT id, account_id, account_type, account_name INTO v_from
    FROM public.treasury_accounts WHERE id = p_from_account_id;
    SELECT id, account_id, account_type, account_name INTO v_to
    FROM public.treasury_accounts WHERE id = p_to_account_id;

    v_number := (public.next_document_number('treasury')->>'number')::text;

    INSERT INTO public.treasury_transactions (branch_id, transaction_type, from_account_id, to_account_id, amount, reference_number, notes, created_by)
    VALUES (p_branch_id, 'transfer', p_from_account_id, p_to_account_id, p_amount, v_number, p_notes, auth.uid())
    RETURNING id INTO v_tx_id;

    v_lines := v_lines || jsonb_build_object('account_code', (SELECT code FROM public.chart_of_accounts WHERE id = v_to.account_id),
      'debit', round(p_amount, 2), 'credit', 0, 'note', 'تحويل ' || v_number);
    v_lines := v_lines || jsonb_build_object('account_code', (SELECT code FROM public.chart_of_accounts WHERE id = v_from.account_id),
      'debit', 0, 'credit', round(p_amount, 2), 'note', 'تحويل ' || v_number);

    PERFORM public._post_journal_entry(p_branch_id, 'transfer', v_tx_id, v_number,
      'تحويل خزينة ' || v_number, v_lines);

    RETURN jsonb_build_object('success', true, 'transaction_id', v_tx_id, 'reference_number', v_number);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------
-- 5. process_treasury_deposit: owner funds into a treasury account
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_treasury_deposit(
  p_branch_id uuid,
  p_account_id uuid,
  p_amount numeric,
  p_notes text DEFAULT NULL::text
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_guard jsonb;
  v_account record;
  v_number text;
  v_tx_id uuid;
  v_lines jsonb := '[]'::jsonb;
BEGIN
  BEGIN
    v_guard := public._treasury_guard(p_branch_id, p_account_id, p_amount);
    IF NOT (v_guard->>'ok')::boolean THEN
      RETURN v_guard;
    END IF;

    SELECT id, account_id INTO v_account FROM public.treasury_accounts WHERE id = p_account_id;

    v_number := (public.next_document_number('treasury')->>'number')::text;

    INSERT INTO public.treasury_transactions (branch_id, transaction_type, to_account_id, amount, reference_number, notes, created_by)
    VALUES (p_branch_id, 'deposit', p_account_id, p_amount, v_number, p_notes, auth.uid())
    RETURNING id INTO v_tx_id;

    v_lines := v_lines || jsonb_build_object('account_code', (SELECT code FROM public.chart_of_accounts WHERE id = v_account.account_id),
      'debit', round(p_amount, 2), 'credit', 0, 'note', 'إيداع ' || v_number);
    v_lines := v_lines || jsonb_build_object('account_key', 'capital',
      'debit', 0, 'credit', round(p_amount, 2), 'note', 'إيداع ' || v_number);

    PERFORM public._post_journal_entry(p_branch_id, 'treasury_deposit', v_tx_id, v_number,
      'إيداع خزينة ' || v_number, v_lines);

    RETURN jsonb_build_object('success', true, 'transaction_id', v_tx_id, 'reference_number', v_number);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------
-- 6. process_treasury_withdrawal: owner funds out of a treasury account
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_treasury_withdrawal(
  p_branch_id uuid,
  p_account_id uuid,
  p_amount numeric,
  p_notes text DEFAULT NULL::text
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_guard jsonb;
  v_account record;
  v_number text;
  v_tx_id uuid;
  v_lines jsonb := '[]'::jsonb;
BEGIN
  BEGIN
    v_guard := public._treasury_guard(p_branch_id, p_account_id, p_amount);
    IF NOT (v_guard->>'ok')::boolean THEN
      RETURN v_guard;
    END IF;

    SELECT id, account_id INTO v_account FROM public.treasury_accounts WHERE id = p_account_id;

    v_number := (public.next_document_number('treasury')->>'number')::text;

    INSERT INTO public.treasury_transactions (branch_id, transaction_type, from_account_id, amount, reference_number, notes, created_by)
    VALUES (p_branch_id, 'withdrawal', p_account_id, p_amount, v_number, p_notes, auth.uid())
    RETURNING id INTO v_tx_id;

    v_lines := v_lines || jsonb_build_object('account_key', 'capital',
      'debit', round(p_amount, 2), 'credit', 0, 'note', 'سحب ' || v_number);
    v_lines := v_lines || jsonb_build_object('account_code', (SELECT code FROM public.chart_of_accounts WHERE id = v_account.account_id),
      'debit', 0, 'credit', round(p_amount, 2), 'note', 'سحب ' || v_number);

    PERFORM public._post_journal_entry(p_branch_id, 'treasury_withdrawal', v_tx_id, v_number,
      'سحب خزينة ' || v_number, v_lines);

    RETURN jsonb_build_object('success', true, 'transaction_id', v_tx_id, 'reference_number', v_number);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------
-- 7. get_treasury_balances: ledger balance per treasury account
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_treasury_balances(p_branch_id uuid)
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE
AS $function$
SELECT COALESCE(jsonb_agg(s.jb ORDER BY s.jb->>'account_type', s.jb->>'account_name'), '[]'::jsonb)
FROM (
  SELECT jsonb_build_object(
    'id', t.id,
    'account_type', t.account_type,
    'account_name', t.account_name,
    'account_number', t.account_number,
    'code', a.code,
    'is_active', t.is_active,
    'opening_balance', round(COALESCE(t.opening_balance, 0), 2),
    'balance', round(COALESCE(SUM(l.debit - l.credit), 0), 2)
  ) AS jb
  FROM public.treasury_accounts t
  JOIN public.chart_of_accounts a ON a.id = t.account_id
  LEFT JOIN public.journal_entry_lines l ON l.account_id = a.id
  WHERE t.branch_id = p_branch_id
  GROUP BY t.id, t.account_type, t.account_name, t.account_number, a.code, t.is_active, t.opening_balance
) s;
$function$;

-- ---------------------------------------------------------------------
-- Reload the PostgREST schema cache.
-- ---------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
