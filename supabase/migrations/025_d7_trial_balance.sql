-- =====================================================================
-- Phase D7: Trial balance hardening + balance sheet fix
-- =====================================================================
-- Two fixes to the Phase C report functions:
--   1. get_trial_balance / get_balance_sheet joined journal_entry_lines
--      to journal_entries with the branch/date filter inside the LEFT JOIN
--      condition. Lines belonging to other branches' entries were therefore
--      still summed (the join produced a NULL journal but kept the line).
--      Both are rewritten to filter lines through their entries first.
--   2. get_trial_balance keeps its existing array shape (used by the
--      frontend) and a new get_trial_balance_summary adds totals and a
--      balanced flag.
-- All functions stay read-only, STABLE, SECURITY DEFINER.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Trial balance (array shape preserved; branch filter hardened)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_trial_balance(p_branch_id uuid, p_to_date date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE AS $function$
SELECT COALESCE(jsonb_agg(row ORDER BY row.code), '[]'::jsonb)
FROM (
  SELECT a.code, a.name, a.name_en, a.account_type,
         round(COALESCE(SUM(l.debit), 0), 2) AS debit,
         round(COALESCE(SUM(l.credit), 0), 2) AS credit,
         round(COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0), 2) AS balance
  FROM public.chart_of_accounts a
  LEFT JOIN (
    SELECT l.account_id, l.debit, l.credit
    FROM public.journal_entry_lines l
    JOIN public.journal_entries j ON j.id = l.journal_entry_id
    WHERE j.branch_id = p_branch_id AND j.entry_date <= p_to_date
  ) l ON l.account_id = a.id
  WHERE a.branch_id = p_branch_id AND a.is_active
  GROUP BY a.code, a.name, a.name_en, a.account_type
  HAVING COALESCE(SUM(l.debit), 0) <> 0 OR COALESCE(SUM(l.credit), 0) <> 0
) row;
$function$;

COMMENT ON FUNCTION public.get_trial_balance(uuid, date) IS 'ميزان المراجعة (كل حساب مع إجمالي مدين/دائن والرصيد)';

-- ---------------------------------------------------------------------
-- 2. Trial balance summary: totals + balanced flag
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_trial_balance_summary(p_branch_id uuid, p_to_date date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE AS $function$
WITH rows AS (
  SELECT COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
  FROM public.chart_of_accounts a
  LEFT JOIN (
    SELECT l.account_id, l.debit, l.credit
    FROM public.journal_entry_lines l
    JOIN public.journal_entries j ON j.id = l.journal_entry_id
    WHERE j.branch_id = p_branch_id AND j.entry_date <= p_to_date
  ) l ON l.account_id = a.id
  WHERE a.branch_id = p_branch_id AND a.is_active
    AND (COALESCE(l.debit, 0) <> 0 OR COALESCE(l.credit, 0) <> 0)
)
SELECT jsonb_build_object(
  'to_date', p_to_date,
  'total_debit', round(COALESCE((SELECT SUM(debit) FROM rows), 0), 2),
  'total_credit', round(COALESCE((SELECT SUM(credit) FROM rows), 0), 2),
  'balanced', round(COALESCE((SELECT SUM(debit) FROM rows), 0), 2)
              = round(COALESCE((SELECT SUM(credit) FROM rows), 0), 2)
);
$function$;

COMMENT ON FUNCTION public.get_trial_balance_summary(uuid, date) IS 'ملخص ميزان المراجعة (إجماليات وعلامة التوازن)';

-- ---------------------------------------------------------------------
-- 3. Balance sheet (branch filter hardened)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_balance_sheet(p_branch_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE AS $function$
WITH bal AS (
  SELECT a.account_type, a.code,
         COALESCE(SUM(l.debit), 0) AS debit,
         COALESCE(SUM(l.credit), 0) AS credit
  FROM public.chart_of_accounts a
  LEFT JOIN (
    SELECT l.account_id, l.debit, l.credit
    FROM public.journal_entry_lines l
    JOIN public.journal_entries j ON j.id = l.journal_entry_id
    WHERE j.branch_id = p_branch_id AND j.entry_date <= p_as_of
  ) l ON l.account_id = a.id
  WHERE a.branch_id = p_branch_id AND a.is_active
  GROUP BY a.account_type, a.code
), summary AS (
  SELECT
    round(COALESCE(SUM(CASE WHEN account_type = 'asset' THEN debit - credit ELSE 0 END), 0), 2) AS assets,
    round(COALESCE(SUM(CASE WHEN account_type = 'liability' THEN credit - debit ELSE 0 END), 0), 2) AS liabilities,
    round(COALESCE(SUM(CASE WHEN code = '3000' THEN credit - debit ELSE 0 END), 0), 2) AS capital,
    round(COALESCE(SUM(CASE WHEN code = '3100' THEN credit - debit ELSE 0 END), 0), 2) AS retained,
    round(COALESCE(SUM(CASE WHEN account_type = 'income' THEN credit - debit ELSE 0 END), 0)
         - COALESCE(SUM(CASE WHEN account_type = 'expense' THEN debit - credit ELSE 0 END), 0), 2) AS net_income
  FROM bal
)
SELECT jsonb_build_object(
  'assets', assets,
  'liabilities', liabilities,
  'capital', capital,
  'retained', retained,
  'net_income', net_income,
  'equity', round(capital + retained + net_income, 2),
  'balanced', round(assets - (liabilities + capital + retained + net_income), 2) = 0
)
FROM summary;
$function$;

COMMENT ON FUNCTION public.get_balance_sheet(uuid, date) IS 'الميزانية العمومية في تاريخ محدد';
