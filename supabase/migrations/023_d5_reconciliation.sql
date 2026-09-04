-- =====================================================================
-- Phase D5: Bank reconciliation
-- =====================================================================
-- Reconciling treasury bank accounts against the bank statement:
--   1. bank_reconciliations  -> header (statement date, balances, status)
--   2. bank_statement_lines  -> statement entries, optionally matched to
--                               a posted journal entry
--   3. create_bank_reconciliation -> opens a reconciliation and computes
--                               book balance + difference
--   4. add_statement_line / match_bank_line -> build the statement side
--   5. complete_bank_reconciliation -> validates the difference is fully
--                               explained, then closes the reconciliation
--   6. get_bank_reconciliation -> header + lines + book candidates
-- No posting happens here (bank charges etc. are expense transactions);
-- RLS is never weakened.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. bank_reconciliations
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bank_reconciliations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id            uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  treasury_account_id  uuid NOT NULL REFERENCES public.treasury_accounts(id) ON DELETE CASCADE,
  statement_date       date NOT NULL,
  statement_balance    numeric(14,2) NOT NULL,
  book_balance         numeric(14,2) NOT NULL DEFAULT 0,
  difference           numeric(14,2) NOT NULL DEFAULT 0,
  status               text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'cancelled')),
  created_by           uuid REFERENCES public.users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  closed_at            timestamptz
);
COMMENT ON TABLE public.bank_reconciliations IS 'تسويات بنكية: مطابقة كشف البنك مع الدفتر لكل حساب بنكي';

CREATE INDEX IF NOT EXISTS idx_bank_recon_branch ON public.bank_reconciliations (branch_id, statement_date DESC);

ALTER TABLE public.bank_reconciliations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bank_reconciliations_select" ON public.bank_reconciliations;
CREATE POLICY "bank_reconciliations_select" ON public.bank_reconciliations
  FOR SELECT TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS "bank_reconciliations_insert" ON public.bank_reconciliations;
CREATE POLICY "bank_reconciliations_insert" ON public.bank_reconciliations
  FOR INSERT TO authenticated WITH CHECK (is_pos_admin());
DROP POLICY IF EXISTS "bank_reconciliations_update" ON public.bank_reconciliations;
CREATE POLICY "bank_reconciliations_update" ON public.bank_reconciliations
  FOR UPDATE TO authenticated USING (is_pos_admin()) WITH CHECK (is_pos_admin());

-- ---------------------------------------------------------------------
-- 2. bank_statement_lines
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bank_statement_lines (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id       uuid NOT NULL REFERENCES public.bank_reconciliations(id) ON DELETE CASCADE,
  statement_date          date NOT NULL,
  description             text,
  reference               text,
  amount                  numeric(14,2) NOT NULL,
  matched_journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.bank_statement_lines IS 'بنود كشف الحساب البنكي (إيداع موجب / سحب سالب) مع ربط اختياري بقيد دفتر';

CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_recon ON public.bank_statement_lines (reconciliation_id);

ALTER TABLE public.bank_statement_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bank_statement_lines_select" ON public.bank_statement_lines;
CREATE POLICY "bank_statement_lines_select" ON public.bank_statement_lines
  FOR SELECT TO authenticated USING (
    is_pos_admin() OR EXISTS (
      SELECT 1 FROM public.bank_reconciliations r
      WHERE r.id = bank_statement_lines.reconciliation_id AND r.branch_id = get_branch_id()
    )
  );
DROP POLICY IF EXISTS "bank_statement_lines_insert" ON public.bank_statement_lines;
CREATE POLICY "bank_statement_lines_insert" ON public.bank_statement_lines
  FOR INSERT TO authenticated WITH CHECK (is_pos_admin());
DROP POLICY IF EXISTS "bank_statement_lines_update" ON public.bank_statement_lines;
CREATE POLICY "bank_statement_lines_update" ON public.bank_statement_lines
  FOR UPDATE TO authenticated USING (is_pos_admin()) WITH CHECK (is_pos_admin());

-- ---------------------------------------------------------------------
-- 3. create_bank_reconciliation
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_bank_reconciliation(
  p_branch_id uuid,
  p_treasury_account_id uuid,
  p_statement_date date,
  p_statement_balance numeric
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_account record;
  v_user_branch uuid;
  v_book numeric(14,2);
  v_diff numeric(14,2);
  v_recon_id uuid;
BEGIN
  BEGIN
    IF p_statement_balance IS NULL OR p_statement_date IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_INPUT');
    END IF;

    IF NOT is_pos_admin() AND get_user_role() NOT IN ('accountant', 'branch_manager') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
        'detail', 'Reconciliation requires the accountant or branch manager role.');
    END IF;

    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND p_branch_id <> v_user_branch THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    SELECT t.id, t.account_id, t.is_active INTO v_account
    FROM public.treasury_accounts t
    WHERE t.id = p_treasury_account_id AND t.branch_id = p_branch_id;
    IF v_account.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'TREASURY_ACCOUNT_NOT_FOUND');
    END IF;
    IF NOT v_account.is_active THEN
      RETURN jsonb_build_object('success', false, 'error', 'TREASURY_ACCOUNT_INACTIVE');
    END IF;

    -- Book balance of the underlying chart account up to the statement date
    SELECT COALESCE(SUM(jl.debit - jl.credit), 0)
    INTO v_book
    FROM public.journal_entry_lines jl
    JOIN public.journal_entries je ON je.id = jl.journal_entry_id
    WHERE jl.account_id = v_account.account_id
      AND je.branch_id = p_branch_id
      AND je.entry_date <= p_statement_date;

    v_book := round(v_book, 2);
    v_diff := round(p_statement_balance - v_book, 2);

    INSERT INTO public.bank_reconciliations (branch_id, treasury_account_id, statement_date,
      statement_balance, book_balance, difference, created_by)
    VALUES (p_branch_id, p_treasury_account_id, p_statement_date,
      round(p_statement_balance, 2), v_book, v_diff, auth.uid())
    RETURNING id INTO v_recon_id;

    RETURN jsonb_build_object('success', true, 'reconciliation_id', v_recon_id,
      'statement_date', p_statement_date, 'statement_balance', round(p_statement_balance, 2),
      'book_balance', v_book, 'difference', v_diff);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------
-- 4. add_statement_line
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_statement_line(
  p_reconciliation_id uuid,
  p_statement_date date,
  p_description text,
  p_amount numeric,
  p_reference text DEFAULT NULL::text
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_recon record;
  v_line_id uuid;
BEGIN
  BEGIN
    IF p_amount IS NULL OR p_amount = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_AMOUNT');
    END IF;

    SELECT id, branch_id, status INTO v_recon
    FROM public.bank_reconciliations WHERE id = p_reconciliation_id;
    IF v_recon.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'RECONCILIATION_NOT_FOUND');
    END IF;
    IF v_recon.status <> 'open' THEN
      RETURN jsonb_build_object('success', false, 'error', 'RECONCILIATION_CLOSED', 'status', v_recon.status);
    END IF;

    INSERT INTO public.bank_statement_lines (reconciliation_id, statement_date, description, reference, amount)
    VALUES (p_reconciliation_id, p_statement_date, p_description, p_reference, round(p_amount, 2))
    RETURNING id INTO v_line_id;

    RETURN jsonb_build_object('success', true, 'line_id', v_line_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------
-- 5. match_bank_line
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_bank_line(
  p_line_id uuid,
  p_journal_entry_id uuid
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_line record;
  v_account uuid;
  v_matched boolean;
  v_entry_amount numeric(14,2);
  v_line_amount numeric(14,2);
BEGIN
  BEGIN
    SELECT l.id, l.reconciliation_id, l.amount, r.status, r.treasury_account_id
      INTO v_line
    FROM public.bank_statement_lines l
    JOIN public.bank_reconciliations r ON r.id = l.reconciliation_id
    WHERE l.id = p_line_id;
    IF v_line.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'LINE_NOT_FOUND');
    END IF;
    IF v_line.status <> 'open' THEN
      RETURN jsonb_build_object('success', false, 'error', 'RECONCILIATION_CLOSED');
    END IF;

    SELECT t.account_id INTO v_account
    FROM public.treasury_accounts t WHERE t.id = v_line.treasury_account_id;

    -- The journal entry must affect this bank account in the same branch
    SELECT EXISTS (
      SELECT 1 FROM public.journal_entry_lines jl
      JOIN public.journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.journal_entry_id = p_journal_entry_id
        AND jl.account_id = v_account
        AND je.branch_id = (SELECT branch_id FROM public.bank_reconciliations WHERE id = v_line.reconciliation_id)
    ) INTO v_matched;

    IF NOT v_matched THEN
      RETURN jsonb_build_object('success', false, 'error', 'ENTRY_NOT_ON_ACCOUNT',
        'detail', 'The journal entry does not post to this bank account in this branch.');
    END IF;

    -- The entry's net effect on the account must equal the statement line amount
    SELECT round(SUM(jl.debit - jl.credit), 2)
    INTO v_entry_amount
    FROM public.journal_entry_lines jl
    WHERE jl.journal_entry_id = p_journal_entry_id AND jl.account_id = v_account;

    v_line_amount := round(v_line.amount, 2);
    IF round(COALESCE(v_entry_amount, 0), 2) <> v_line_amount THEN
      RETURN jsonb_build_object('success', false, 'error', 'AMOUNT_MISMATCH',
        'entry_amount', round(COALESCE(v_entry_amount, 0), 2), 'statement_amount', v_line_amount,
        'detail', 'The journal entry effect on the bank account must equal the statement line amount.');
    END IF;

    UPDATE public.bank_statement_lines
      SET matched_journal_entry_id = p_journal_entry_id
      WHERE id = p_line_id;

    RETURN jsonb_build_object('success', true, 'line_id', p_line_id, 'journal_entry_id', p_journal_entry_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------
-- 6. complete_bank_reconciliation
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_bank_reconciliation(p_reconciliation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_recon record;
  v_total numeric(14,2);
  v_matched_total numeric(14,2);
  v_unmatched numeric(14,2);
BEGIN
  BEGIN
    SELECT id, branch_id, status, statement_balance, book_balance, difference
      INTO v_recon
    FROM public.bank_reconciliations WHERE id = p_reconciliation_id;
    IF v_recon.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'RECONCILIATION_NOT_FOUND');
    END IF;
    IF v_recon.status = 'completed' THEN
      RETURN jsonb_build_object('success', false, 'error', 'ALREADY_COMPLETED');
    END IF;
    IF v_recon.status = 'cancelled' THEN
      RETURN jsonb_build_object('success', false, 'error', 'RECONCILIATION_CANCELLED');
    END IF;

    SELECT COALESCE(SUM(amount), 0),
           COALESCE(SUM(CASE WHEN matched_journal_entry_id IS NOT NULL THEN amount ELSE 0 END), 0)
    INTO v_total, v_matched_total
    FROM public.bank_statement_lines WHERE reconciliation_id = p_reconciliation_id;

    v_total := round(v_total, 2);
    v_unmatched := round(COALESCE(v_recon.difference, 0) - v_total, 2);

    IF round(v_unmatched, 2) <> 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'RECON_OUT_OF_BALANCE',
        'difference', round(v_recon.difference, 2), 'statement_lines', v_total,
        'outstanding', v_unmatched,
        'detail', 'The statement lines must explain the full difference between the statement and book balances.');
    END IF;

    UPDATE public.bank_reconciliations
      SET status = 'completed', closed_at = now()
      WHERE id = p_reconciliation_id;

    RETURN jsonb_build_object('success', true, 'reconciliation_id', p_reconciliation_id,
      'difference', round(v_recon.difference, 2), 'statement_lines_total', v_total,
      'matched_total', round(v_matched_total, 2));
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------
-- 7. get_bank_reconciliation
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_bank_reconciliation(p_reconciliation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_header jsonb;
  v_lines jsonb;
  v_candidates jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', r.id, 'branch_id', r.branch_id, 'treasury_account_id', r.treasury_account_id,
    'statement_date', r.statement_date, 'statement_balance', r.statement_balance,
    'book_balance', r.book_balance, 'difference', r.difference, 'status', r.status,
    'closed_at', r.closed_at, 'account_name', t.account_name, 'code', a.code
  )
  INTO v_header
  FROM public.bank_reconciliations r
  JOIN public.treasury_accounts t ON t.id = r.treasury_account_id
  JOIN public.chart_of_accounts a ON a.id = t.account_id
  WHERE r.id = p_reconciliation_id;

  IF v_header IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'RECONCILIATION_NOT_FOUND');
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'id', l.id, 'statement_date', l.statement_date, 'description', l.description,
    'reference', l.reference, 'amount', l.amount, 'matched_journal_entry_id', l.matched_journal_entry_id
  ) ORDER BY l.statement_date, l.id)
  INTO v_lines
  FROM public.bank_statement_lines l
  WHERE l.reconciliation_id = p_reconciliation_id;

  -- Book candidates: posted journal entries touching this bank account
  SELECT jsonb_agg(s.candidate ORDER BY s.candidate->>'entry_date', s.candidate->>'id')
  INTO v_candidates
  FROM (
    SELECT jsonb_build_object(
      'id', je.id, 'entry_number', je.entry_number, 'entry_date', je.entry_date,
      'reference_type', je.reference_type, 'reference_number', je.reference_number,
      'description', je.description,
      'amount', round(COALESCE(SUM(CASE WHEN jl.account_id = a.id THEN jl.debit - jl.credit ELSE 0 END), 0), 2)
    ) AS candidate
    FROM public.journal_entries je
    JOIN public.journal_entry_lines jl ON jl.journal_entry_id = je.id
    JOIN public.bank_reconciliations r ON r.id = p_reconciliation_id
    JOIN public.treasury_accounts t ON t.id = r.treasury_account_id
    JOIN public.chart_of_accounts a ON a.id = t.account_id
    WHERE je.branch_id = r.branch_id
      AND je.entry_date <= r.statement_date
      AND jl.account_id = a.id
    GROUP BY je.id, je.entry_number, je.entry_date, je.reference_type, je.reference_number, je.description
  ) s;

  RETURN jsonb_build_object('success', true, 'header', v_header,
    'statement_lines', COALESCE(v_lines, '[]'::jsonb), 'book_candidates', COALESCE(v_candidates, '[]'::jsonb));
END;
$function$;

-- ---------------------------------------------------------------------
-- Reload the PostgREST schema cache.
-- ---------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
