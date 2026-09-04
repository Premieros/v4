-- =====================================================================
-- Phase D6: Open AR/AP aging + journal listing with reference numbers
-- =====================================================================
-- Report surface for the credit-control and audit screens:
--   1. get_ap_aging          -> AP mirror of the existing get_ar_aging
--   2. get_open_invoices     -> invoice-level open AR / AP detail
--   3. get_aging_summary     -> single-row AR + AP totals per bucket
--   4. get_journals          -> posted journal entries with their lines,
--                               entry numbers and source references
-- All are read-only (STABLE, SECURITY DEFINER), branch-scoped, and rely
-- on the existing posted-ledger numbers (no double counting).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. AP aging: open payable per supplier in 30-day buckets
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_ap_aging(p_branch_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE AS $function$
SELECT COALESCE(jsonb_agg(row ORDER BY row.open_amount DESC), '[]'::jsonb)
FROM (
  SELECT s.id AS supplier_id, s.name, s.phone,
         sum(p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0)) AS open_amount,
         round(sum(CASE WHEN (p_as_of - p.created_at::date) <= 30 THEN p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0) ELSE 0 END), 2) AS bucket_0_30,
         round(sum(CASE WHEN (p_as_of - p.created_at::date) BETWEEN 31 AND 60 THEN p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0) ELSE 0 END), 2) AS bucket_31_60,
         round(sum(CASE WHEN (p_as_of - p.created_at::date) BETWEEN 61 AND 90 THEN p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0) ELSE 0 END), 2) AS bucket_61_90,
         round(sum(CASE WHEN (p_as_of - p.created_at::date) > 90 THEN p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0) ELSE 0 END), 2) AS bucket_90_plus
  FROM public.purchases p
  JOIN public.suppliers s ON s.id = p.supplier_id
  WHERE p.branch_id = p_branch_id AND p.status = 'completed'
    AND (p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0)) > 0
  GROUP BY s.id, s.name, s.phone
) row;
$function$;

COMMENT ON FUNCTION public.get_ap_aging(uuid, date) IS 'ذمم دائنة مفتوحة لكل مورد حسب العمر الزمني';

-- ---------------------------------------------------------------------
-- 2. Open invoices: invoice-level AR / AP detail with overdue days
--    p_side = 'ar' -> sales invoices, 'ap' -> purchase invoices
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_open_invoices(
  p_branch_id uuid,
  p_side text DEFAULT 'ar',
  p_as_of date DEFAULT CURRENT_DATE
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE AS $function$
SELECT CASE
  WHEN COALESCE(p_side, 'ar') = 'ap' THEN (
    SELECT COALESCE(jsonb_agg(row ORDER BY row.invoice_date, row.invoice_number), '[]'::jsonb)
    FROM (
      SELECT p.id AS invoice_id, p.invoice_number, p.supplier_id AS party_id,
             sup.name AS party_name, sup.phone AS party_phone,
             p.created_at::date AS invoice_date,
             (p.created_at::date + 30) AS due_date,
             GREATEST(p_as_of - p.created_at::date, 0) AS days_overdue,
             round(p.total, 2) AS invoice_total,
             round(COALESCE(p.paid_amount, 0), 2) AS paid,
             round(COALESCE(p.returned_amount, 0), 2) AS returned,
             round(p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0), 2) AS open_amount
      FROM public.purchases p
      JOIN public.suppliers sup ON sup.id = p.supplier_id
      WHERE p.branch_id = p_branch_id AND p.status = 'completed'
        AND (p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0)) > 0
    ) row
  ) ELSE (
    SELECT COALESCE(jsonb_agg(row ORDER BY row.invoice_date, row.invoice_number), '[]'::jsonb)
    FROM (
      SELECT s.id AS invoice_id, s.invoice_number, s.customer_id AS party_id,
             c.name AS party_name, c.phone AS party_phone,
             s.created_at::date AS invoice_date,
             (s.created_at::date + 30) AS due_date,
             GREATEST(p_as_of - s.created_at::date, 0) AS days_overdue,
             round(s.total, 2) AS invoice_total,
             round(COALESCE(s.paid_amount, 0), 2) AS paid,
             round(COALESCE(s.refunded_amount, 0), 2) AS returned,
             round(s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0), 2) AS open_amount
      FROM public.sales s
      JOIN public.customers c ON c.id = s.customer_id
      WHERE s.branch_id = p_branch_id AND s.status <> 'returned'
        AND (s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0)) > 0
    ) row
  ) END;
$function$;

COMMENT ON FUNCTION public.get_open_invoices(uuid, text, date) IS 'فواتير مفتوحة بالتفصيل (AR أو AP) مع أيام التأخير';

-- ---------------------------------------------------------------------
-- 3. Aging summary: single object with AR/AP totals per bucket
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_aging_summary(p_branch_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE AS $function$
WITH ar AS (
  SELECT
    round(sum(s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0)), 2) AS open_total,
    round(sum(CASE WHEN (p_as_of - s.created_at::date) <= 30 THEN s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0) ELSE 0 END), 2) AS bucket_0_30,
    round(sum(CASE WHEN (p_as_of - s.created_at::date) BETWEEN 31 AND 60 THEN s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0) ELSE 0 END), 2) AS bucket_31_60,
    round(sum(CASE WHEN (p_as_of - s.created_at::date) BETWEEN 61 AND 90 THEN s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0) ELSE 0 END), 2) AS bucket_61_90,
    round(sum(CASE WHEN (p_as_of - s.created_at::date) > 90 THEN s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0) ELSE 0 END), 2) AS bucket_90_plus
  FROM public.sales s
  WHERE s.branch_id = p_branch_id AND s.status <> 'returned'
    AND (s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0)) > 0
), ap AS (
  SELECT
    round(sum(p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0)), 2) AS open_total,
    round(sum(CASE WHEN (p_as_of - p.created_at::date) <= 30 THEN p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0) ELSE 0 END), 2) AS bucket_0_30,
    round(sum(CASE WHEN (p_as_of - p.created_at::date) BETWEEN 31 AND 60 THEN p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0) ELSE 0 END), 2) AS bucket_31_60,
    round(sum(CASE WHEN (p_as_of - p.created_at::date) BETWEEN 61 AND 90 THEN p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0) ELSE 0 END), 2) AS bucket_61_90,
    round(sum(CASE WHEN (p_as_of - p.created_at::date) > 90 THEN p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0) ELSE 0 END), 2) AS bucket_90_plus
  FROM public.purchases p
  WHERE p.branch_id = p_branch_id AND p.status = 'completed'
    AND (p.total - COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0)) > 0
)
SELECT jsonb_build_object(
  'as_of', p_as_of,
  'ar_open', round(COALESCE((SELECT open_total FROM ar), 0), 2),
  'ap_open', round(COALESCE((SELECT open_total FROM ap), 0), 2),
  'ar', jsonb_build_object('0_30', COALESCE((SELECT bucket_0_30 FROM ar), 0),
                           '31_60', COALESCE((SELECT bucket_31_60 FROM ar), 0),
                           '61_90', COALESCE((SELECT bucket_61_90 FROM ar), 0),
                           '90_plus', COALESCE((SELECT bucket_90_plus FROM ar), 0)),
  'ap', jsonb_build_object('0_30', COALESCE((SELECT bucket_0_30 FROM ap), 0),
                           '31_60', COALESCE((SELECT bucket_31_60 FROM ap), 0),
                           '61_90', COALESCE((SELECT bucket_61_90 FROM ap), 0),
                           '90_plus', COALESCE((SELECT bucket_90_plus FROM ap), 0))
);
$function$;

COMMENT ON FUNCTION public.get_aging_summary(uuid, date) IS 'ملخص إجمالي الذمم المدينة/الدائنة حسب العمر';

-- ---------------------------------------------------------------------
-- 4. Journals: posted entries with lines, entry numbers and references
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_journals(
  p_branch_id uuid,
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_search text DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE AS $function$
SELECT COALESCE(jsonb_agg(e ORDER BY e.entry_date, e.entry_number), '[]'::jsonb)
FROM (
  SELECT j.id, j.entry_number, j.entry_date, j.reference_type, j.reference_id,
         j.reference_number, j.description, j.created_at,
         round(COALESCE(SUM(l.debit), 0), 2) AS debit_total,
         round(COALESCE(SUM(l.credit), 0), 2) AS credit_total,
         (SELECT COALESCE(jsonb_agg(line ORDER BY line.id), '[]'::jsonb)
          FROM (
            SELECT l.id, a.code, a.name AS account_name, a.account_type,
                   round(l.debit, 2) AS debit, round(l.credit, 2) AS credit,
                   l.note, l.customer_id, l.supplier_id
            FROM public.journal_entry_lines l
            JOIN public.chart_of_accounts a ON a.id = l.account_id
            WHERE l.journal_entry_id = j.id
          ) line) AS lines
  FROM public.journal_entries j
  LEFT JOIN public.journal_entry_lines l ON l.journal_entry_id = j.id
  WHERE j.branch_id = p_branch_id
    AND (p_from_date IS NULL OR j.entry_date >= p_from_date)
    AND (p_to_date IS NULL OR j.entry_date <= p_to_date)
    AND (p_reference_type IS NULL OR j.reference_type = p_reference_type)
    AND (p_search IS NULL OR j.entry_number ILIKE '%' || p_search || '%'
                            OR j.reference_number ILIKE '%' || p_search || '%')
  GROUP BY j.id
) e;
$function$;

COMMENT ON FUNCTION public.get_journals(uuid, date, date, text, text) IS 'قائمة قيود اليومية مع الأرقام والمراجع';

-- ---------------------------------------------------------------------
-- 5. Journal detail: one entry with its lines (for the entry screen)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_journal_entry(p_journal_entry_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE AS $function$
SELECT jsonb_build_object(
  'entry', jsonb_build_object(
    'id', j.id, 'entry_number', j.entry_number, 'entry_date', j.entry_date,
    'reference_type', j.reference_type, 'reference_id', j.reference_id,
    'reference_number', j.reference_number, 'description', j.description,
    'created_at', j.created_at, 'created_by', j.created_by
  ),
  'lines', (SELECT COALESCE(jsonb_agg(line ORDER BY line.id), '[]'::jsonb)
            FROM (
              SELECT l.id, a.id AS account_id, a.code, a.name AS account_name,
                     a.account_type, round(l.debit, 2) AS debit, round(l.credit, 2) AS credit,
                     l.note, l.customer_id, l.supplier_id
              FROM public.journal_entry_lines l
              JOIN public.chart_of_accounts a ON a.id = l.account_id
              WHERE l.journal_entry_id = j.id
            ) line)
)
FROM public.journal_entries j
WHERE j.id = p_journal_entry_id;
$function$;

COMMENT ON FUNCTION public.get_journal_entry(uuid) IS 'تفاصيل قيد يومية واحد مع أطرافه';
