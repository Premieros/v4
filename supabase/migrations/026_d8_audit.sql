-- =====================================================================
-- Phase D8: Audit trail + manual journal entry
-- =====================================================================
-- Accounting audit trail on top of the existing branch-scoped audit_log:
--   1. log_audit_action     -> generic, secure insert into audit_log
--   2. _post_journal_entry  -> now also records a 'journal_post' entry for
--                              every posted journal (one hook, all postings)
--   3. post_manual_journal  -> manual/adjustment entries (accountant+) that
--                              go through _post_journal_entry and are audited
--   4. get_audit_trail      -> filterable read of the accounting trail
-- No RLS is weakened; audit writes happen inside SECURITY DEFINER RPCs that
-- already enforce role/branch authorization.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. log_audit_action helper
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_audit_action(
  p_branch_id uuid,
  p_action text,
  p_entity text DEFAULT NULL,
  p_entity_id uuid DEFAULT NULL,
  p_details jsonb DEFAULT NULL
) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.audit_log (user_id, user_email, branch_id, action, entity, entity_id, details)
  VALUES (
    auth.uid(),
    (SELECT email FROM public.users WHERE id = auth.uid()),
    p_branch_id,
    p_action, p_entity, p_entity_id, p_details
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

-- ---------------------------------------------------------------------
-- 2. _post_journal_entry: same behaviour + audit record on new postings
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._post_journal_entry(
  p_branch_id uuid,
  p_reference_type text,
  p_reference_id uuid,
  p_reference_number text,
  p_description text,
  p_lines jsonb
) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_entry_id uuid;
  v_entry_no text;
  v_line jsonb;
  v_account uuid;
  v_debit numeric(14,2);
  v_credit numeric(14,2);
  v_total_debit numeric(14,2) := 0;
  v_total_credit numeric(14,2) := 0;
BEGIN
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'JOURNAL_EMPTY_LINES';
  END IF;

  -- Idempotency: never post a second entry for the same reference.
  IF p_reference_id IS NOT NULL THEN
    SELECT id INTO v_entry_id
    FROM public.journal_entries
    WHERE reference_type = p_reference_type AND reference_id = p_reference_id;
    IF v_entry_id IS NOT NULL THEN
      RETURN v_entry_id;
    END IF;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_total_debit := v_total_debit + COALESCE((v_line->>'debit')::numeric, 0);
    v_total_credit := v_total_credit + COALESCE((v_line->>'credit')::numeric, 0);
  END LOOP;

  IF round(v_total_debit, 2) <> round(v_total_credit, 2) THEN
    RAISE EXCEPTION 'JOURNAL_UNBALANCED: debit % <> credit %',
      round(v_total_debit, 2), round(v_total_credit, 2);
  END IF;

  v_entry_no := (public.next_document_number('journal')->>'number')::text;

  INSERT INTO public.journal_entries
    (entry_number, branch_id, entry_date, reference_type, reference_id, reference_number, description, created_by)
  VALUES (v_entry_no, p_branch_id, CURRENT_DATE, p_reference_type, p_reference_id,
          p_reference_number, p_description, auth.uid())
  RETURNING id INTO v_entry_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_debit := COALESCE((v_line->>'debit')::numeric, 0);
    v_credit := COALESCE((v_line->>'credit')::numeric, 0);
    IF v_debit <= 0 AND v_credit <= 0 THEN CONTINUE; END IF;

    IF v_line ? 'account_key' THEN
      v_account := public.resolve_account_key(p_branch_id, v_line->>'account_key', v_line->>'account_code');
    ELSE
      SELECT id INTO v_account
      FROM public.chart_of_accounts
      WHERE branch_id = p_branch_id AND code = upper(btrim((v_line->>'account_code')::text));
    END IF;
    IF v_account IS NULL THEN
      RAISE EXCEPTION 'ACCOUNT_NOT_FOUND: %', COALESCE(v_line->>'account_key', v_line->>'account_code');
    END IF;

    INSERT INTO public.journal_entry_lines
      (journal_entry_id, account_id, debit, credit, customer_id, supplier_id, note)
    VALUES (v_entry_id, v_account, v_debit, v_credit,
            (v_line->>'customer_id')::uuid, (v_line->>'supplier_id')::uuid, v_line->>'note');
  END LOOP;

  PERFORM public.log_audit_action(p_branch_id, 'journal_post', 'journal_entry', v_entry_id,
    jsonb_build_object('entry_number', v_entry_no, 'reference_type', p_reference_type,
                       'reference_number', p_reference_number,
                       'debit_total', round(v_total_debit, 2), 'credit_total', round(v_total_credit, 2)));

  RETURN v_entry_id;
END;
$function$;

-- ---------------------------------------------------------------------
-- 3. post_manual_journal: accountant + manual adjustment entries
--    p_lines = [{"account_key"|"account_code", "debit", "credit",
--                 "note", "customer_id", "supplier_id"}]
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_manual_journal(
  p_branch_id uuid,
  p_description text,
  p_lines jsonb
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user_branch uuid;
  v_entry_id uuid;
  v_line jsonb;
  v_debit numeric(14,2) := 0;
  v_credit numeric(14,2) := 0;
BEGIN
  BEGIN
    IF p_branch_id IS NULL OR p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_INPUT',
        'detail', 'Branch and at least one line are required.');
    END IF;

    IF NOT is_pos_admin() AND get_user_role() NOT IN ('accountant', 'branch_manager') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
        'detail', 'Manual journal entries require the accountant or branch manager role.');
    END IF;

    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND p_branch_id <> v_user_branch THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
      v_debit := v_debit + COALESCE((v_line->>'debit')::numeric, 0);
      v_credit := v_credit + COALESCE((v_line->>'credit')::numeric, 0);
    END LOOP;
    IF round(v_debit, 2) <> round(v_credit, 2) THEN
      RETURN jsonb_build_object('success', false, 'error', 'JOURNAL_UNBALANCED',
        'debit', round(v_debit, 2), 'credit', round(v_credit, 2));
    END IF;

    -- Manual entries are distinct actions: a fresh reference id per posting.
    v_entry_id := public._post_journal_entry(p_branch_id, 'manual', gen_random_uuid(), NULL,
      p_description, p_lines);

    PERFORM public.log_audit_action(p_branch_id, 'manual_journal', 'journal_entry', v_entry_id,
      jsonb_build_object('description', p_description, 'lines', p_lines));

    RETURN jsonb_build_object('success', true, 'entry_id', v_entry_id,
      'entry_number', (SELECT entry_number FROM public.journal_entries WHERE id = v_entry_id));
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------
-- 4. get_audit_trail: filterable audit reads for the branch
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_audit_trail(
  p_branch_id uuid,
  p_action text DEFAULT NULL,
  p_entity text DEFAULT NULL,
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL,
  p_limit integer DEFAULT 200
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE AS $function$
SELECT COALESCE(jsonb_agg(row ORDER BY row.created_at DESC), '[]'::jsonb)
FROM (
  SELECT a.id, a.created_at, a.action, a.entity, a.entity_id, a.details,
         a.branch_id, a.user_id, u.full_name AS user_name,
         COALESCE(a.user_email, u.email) AS user_email
  FROM public.audit_log a
  LEFT JOIN public.users u ON u.id = a.user_id
  WHERE a.branch_id = p_branch_id
    AND (p_action IS NULL OR a.action = p_action)
    AND (p_entity IS NULL OR a.entity = p_entity)
    AND (p_from_date IS NULL OR a.created_at::date >= p_from_date)
    AND (p_to_date IS NULL OR a.created_at::date <= p_to_date)
  ORDER BY a.created_at DESC
  LIMIT p_limit
) row;
$function$;

COMMENT ON FUNCTION public.log_audit_action(uuid, text, text, uuid, jsonb) IS 'تسجيل حدث في سجل التدقيق';
COMMENT ON FUNCTION public.get_audit_trail(uuid, text, text, date, date, integer) IS 'قراءة سجل التدقيق مع الفلاتر';
