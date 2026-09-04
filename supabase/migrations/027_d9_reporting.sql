-- =====================================================================
-- Phase D9: Report queries + schema hardening
-- =====================================================================
-- 1. Missing report indexes (all idempotent CREATE INDEX IF NOT EXISTS)
-- 2. get_cash_flow      -> treasury inflow / outflow / net per account
-- 3. get_party_statement-> chronological AR / AP statement per party with
--                          opening balance and running balance
-- No RLS changes; the new functions are read-only STABLE helpers.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Indexes used by the aging / statement / ledger report queries
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_purchases_branch_created ON public.purchases (branch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON public.sales (customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_branch_created ON public.sales (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_payments_branch ON public.customer_payments (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_branch ON public.supplier_payments (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bank_reconciliations_branch ON public.bank_reconciliations (branch_id, status);
CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_recon ON public.bank_statement_lines (reconciliation_id);
CREATE INDEX IF NOT EXISTS idx_expenses_branch_date ON public.expenses (branch_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_journal_lines_party ON public.journal_entry_lines (customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_journal_lines_supplier ON public.journal_entry_lines (supplier_id, created_at);

-- ---------------------------------------------------------------------
-- 2. Cash flow: treasury movements per account for a period
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_cash_flow(
  p_branch_id uuid,
  p_from_date date,
  p_to_date date DEFAULT CURRENT_DATE
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE AS $function$
SELECT COALESCE(jsonb_agg(row ORDER BY row.account_name), '[]'::jsonb)
FROM (
  SELECT t.id AS treasury_account_id, t.account_name, t.account_type, a.code,
         round(COALESCE(SUM(CASE WHEN tx.to_account_id = t.id THEN tx.amount ELSE 0 END), 0), 2) AS inflow,
         round(COALESCE(SUM(CASE WHEN tx.from_account_id = t.id THEN tx.amount ELSE 0 END), 0), 2) AS outflow,
         round(COALESCE(SUM(CASE WHEN tx.to_account_id = t.id THEN tx.amount ELSE -tx.amount END), 0), 2) AS net
  FROM public.treasury_accounts t
  JOIN public.chart_of_accounts a ON a.id = t.account_id
  LEFT JOIN public.treasury_transactions tx
    ON (tx.to_account_id = t.id OR tx.from_account_id = t.id)
   AND tx.branch_id = p_branch_id
   AND tx.created_at::date >= p_from_date AND tx.created_at::date <= p_to_date
  WHERE t.branch_id = p_branch_id AND t.is_active
  GROUP BY t.id, t.account_name, t.account_type, a.code
  HAVING COALESCE(SUM(CASE WHEN tx.to_account_id = t.id THEN tx.amount ELSE -tx.amount END), 0) <> 0
) row;
$function$;

COMMENT ON FUNCTION public.get_cash_flow(uuid, date, date) IS 'التدفقات النقدية (داخل/خارج/صافي) لكل حساب خزينة';

-- ---------------------------------------------------------------------
-- 3. Party statement: chronological AR ('ar') / AP ('ap') movements with
--    opening balance and running balance from the posted ledger
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_party_statement(
  p_branch_id uuid,
  p_side text,
  p_party_id uuid,
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE AS $function$
WITH lines AS (
  SELECT jl.id AS line_id, jl.debit, jl.credit, j.entry_date, j.entry_number,
         j.reference_type, j.reference_number, j.description
  FROM public.journal_entry_lines jl
  JOIN public.journal_entries j ON j.id = jl.journal_entry_id
  WHERE j.branch_id = p_branch_id
    AND (CASE WHEN p_side = 'ap' THEN jl.supplier_id ELSE jl.customer_id END) = p_party_id
    AND (p_to_date IS NULL OR j.entry_date <= p_to_date)
), run AS (
  SELECT line_id, entry_date, entry_number, reference_type, reference_number, description,
         round(debit, 2) AS debit, round(credit, 2) AS credit,
         round(SUM(CASE WHEN p_side = 'ap' THEN credit - debit ELSE debit - credit END)
               OVER (ORDER BY entry_date, entry_number, line_id), 2) AS balance
  FROM lines
)
SELECT jsonb_build_object(
  'party_id', p_party_id, 'side', p_side,
  'opening', round(COALESCE((SELECT SUM(CASE WHEN p_side = 'ap' THEN credit - debit ELSE debit - credit END)
                             FROM lines WHERE p_from_date IS NOT NULL AND entry_date < p_from_date), 0), 2),
  'rows', (SELECT COALESCE(jsonb_agg(r ORDER BY r.entry_date, r.entry_number), '[]'::jsonb)
           FROM (SELECT line_id, entry_date, entry_number, reference_type, reference_number,
                        description, debit, credit, balance
                 FROM run WHERE p_from_date IS NULL OR entry_date >= p_from_date) r)
);
$function$;

COMMENT ON FUNCTION public.get_party_statement(uuid, text, uuid, date, date) IS 'كشف حساب عميل/مورد مع الرصيد الافتتاحي والجاري';
