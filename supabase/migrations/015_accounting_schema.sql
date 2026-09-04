-- =====================================================================
-- Phase C1: Chart of Accounts + Journal Entries schema
-- =====================================================================
-- Adds: chart_of_accounts, journal_entries, journal_entry_lines,
--       customer_payments. Auto-seeds a standard chart of accounts per
--       branch (system accounts are locked; others editable). Journal
--       entries are immutable (audit trail) and branch-scoped.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Chart of accounts (one chart per branch, seeded automatically)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chart_of_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id     uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  code          text NOT NULL,
  name          text NOT NULL,
  name_en       text,
  account_type  text NOT NULL
                CHECK (account_type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  is_system     boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, code)
);
COMMENT ON TABLE public.chart_of_accounts IS 'شجرة الحسابات المستقلة لكل فرع (يتم تلقائياً إنشاء حسابات نظام عند إنشاء الفرع)';

CREATE INDEX IF NOT EXISTS idx_coa_branch ON public.chart_of_accounts (branch_id, account_type);

-- System account codes used by auto-posting (resolved by code within a branch).
-- These must never be deleted and their code/type must never change.
CREATE OR REPLACE FUNCTION public.protect_system_accounts()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.is_system THEN
    RAISE EXCEPTION 'SYSTEM_ACCOUNT_PROTECTED: % (%)', OLD.code, OLD.name;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_system THEN
    IF NEW.code IS DISTINCT FROM OLD.code OR NEW.account_type IS DISTINCT FROM OLD.account_type THEN
      RAISE EXCEPTION 'SYSTEM_ACCOUNT_PROTECTED: % (%)', OLD.code, OLD.name;
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    NEW.name := btrim(NEW.name);
    IF NEW.name = '' THEN
      RAISE EXCEPTION 'ACCOUNT_NAME_REQUIRED';
    END IF;
    NEW.code := upper(btrim(NEW.code));
    IF NEW.code = '' THEN
      RAISE EXCEPTION 'ACCOUNT_CODE_REQUIRED';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_system_accounts ON public.chart_of_accounts;
CREATE TRIGGER trg_protect_system_accounts
  BEFORE INSERT OR UPDATE OR DELETE ON public.chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION public.protect_system_accounts();

CREATE TRIGGER trg_coa_updated BEFORE UPDATE ON public.chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coa_select" ON public.chart_of_accounts
  FOR SELECT TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id());
CREATE POLICY "coa_insert" ON public.chart_of_accounts
  FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR (can_permission('accounts.manage') AND branch_id = get_branch_id()));
CREATE POLICY "coa_update" ON public.chart_of_accounts
  FOR UPDATE TO authenticated
  USING (is_pos_admin() OR (can_permission('accounts.manage') AND branch_id = get_branch_id()))
  WITH CHECK (is_pos_admin() OR (can_permission('accounts.manage') AND branch_id = get_branch_id()));
CREATE POLICY "coa_delete" ON public.chart_of_accounts
  FOR DELETE TO authenticated
  USING (is_pos_admin() OR (can_permission('accounts.manage') AND branch_id = get_branch_id()));

-- ---------------------------------------------------------------------
-- 2. Standard chart seed (called for every branch + on new branch insert)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_chart_of_accounts(p_branch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.chart_of_accounts (branch_id, code, name, name_en, account_type, is_system)
  SELECT p_branch_id, c.code, c.name, c.name_en, c.account_type, c.is_system
  FROM (VALUES
    ('1000','النقدية بالخزينة','Cash on Hand','asset',true),
    ('1010','البنك','Bank','asset',true),
    ('1100','العملاء (ذمم مدينة)','Accounts Receivable','asset',true),
    ('1200','المخزون (بضاعة جاهزة)','Finished Goods Inventory','asset',true),
    ('1210','مخزون المواد الخام','Raw Materials Inventory','asset',false),
    ('1500','الأصول الثابتة','Fixed Assets','asset',false),
    ('2000','الموردون (ذمم دائنة)','Accounts Payable','liability',true),
    ('2100','ضريبة القيمة المضافة المستحقة','VAT Payable','liability',true),
    ('2300','القروض','Loans','liability',false),
    ('3000','رأس المال','Capital','equity',false),
    ('3100','الأرباح المحتجزة','Retained Earnings','equity',false),
    ('4000','إيرادات المبيعات','Sales Revenue','income',true),
    ('4100','خصم مسموح به','Discount Given','income',true),
    ('4200','إيرادات أخرى','Other Income','income',false),
    ('5000','تكلفة البضاعة المباعة','Cost of Goods Sold','expense',true),
    ('5100','مصاريف تشغيلية','Operating Expenses','expense',false),
    ('5200','أجور ورواتب','Salaries & Wages','expense',false),
    ('5300','إيجار','Rent','expense',false),
    ('5400','مرافق','Utilities','expense',false),
    ('5900','مصاريف أخرى','Other Expenses','expense',false)
  ) AS c(code, name, name_en, account_type, is_system)
  ON CONFLICT (branch_id, code) DO UPDATE SET
    name = EXCLUDED.name,
    name_en = EXCLUDED.name_en,
    account_type = EXCLUDED.account_type,
    is_system = COALESCE(public.chart_of_accounts.is_system, EXCLUDED.is_system),
    updated_at = now();
END;
$function$;

-- Seed every existing branch now and every future branch automatically.
SELECT public.ensure_chart_of_accounts(id) FROM public.branches;

CREATE OR REPLACE FUNCTION public.seed_chart_for_new_branch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.ensure_chart_of_accounts(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_chart_on_branch_insert ON public.branches;
CREATE TRIGGER trg_seed_chart_on_branch_insert
  AFTER INSERT ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.seed_chart_for_new_branch();

-- ---------------------------------------------------------------------
-- 3. Journal entries (immutable audit trail)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.journal_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_number      text NOT NULL UNIQUE,
  branch_id         uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  entry_date        date NOT NULL DEFAULT CURRENT_DATE,
  reference_type    text,
  reference_id      uuid,
  reference_number  text,
  description       text,
  created_by        uuid REFERENCES public.users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.journal_entries IS 'قيود اليومية (كل قيد مدين = دائن تلقائياً)';

CREATE INDEX IF NOT EXISTS idx_journal_branch_date ON public.journal_entries (branch_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_journal_reference ON public.journal_entries (reference_type, reference_id);

ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "journal_entries_select" ON public.journal_entries
  FOR SELECT TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id());
CREATE POLICY "journal_entries_insert" ON public.journal_entries
  FOR INSERT TO authenticated WITH CHECK (is_pos_admin());
-- No UPDATE / DELETE policies: posted entries are immutable.

CREATE TABLE IF NOT EXISTS public.journal_entry_lines (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  journal_entry_id  uuid NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  account_id        uuid NOT NULL REFERENCES public.chart_of_accounts(id),
  debit             numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit            numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  customer_id       uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  supplier_id       uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((debit > 0) <> (credit > 0))
);
COMMENT ON TABLE public.journal_entry_lines IS 'أطراف قيد اليومية (مدين أو دائن لكل حساب)';

CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON public.journal_entry_lines (journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON public.journal_entry_lines (account_id, created_at);

ALTER TABLE public.journal_entry_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "journal_entry_lines_select" ON public.journal_entry_lines
  FOR SELECT TO authenticated USING (
    is_pos_admin() OR EXISTS (
      SELECT 1 FROM public.journal_entries je
      WHERE je.id = journal_entry_lines.journal_entry_id AND je.branch_id = get_branch_id()
    )
  );
CREATE POLICY "journal_entry_lines_insert" ON public.journal_entry_lines
  FOR INSERT TO authenticated WITH CHECK (is_pos_admin());
-- No UPDATE / DELETE policies.

-- ---------------------------------------------------------------------
-- 4. Customer payments (AR collections)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  branch_id         uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  amount            numeric(14,2) NOT NULL CHECK (amount > 0),
  payment_method    text NOT NULL DEFAULT 'cash',
  sale_id           uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  reference_number  text,
  notes             text,
  created_by        uuid REFERENCES public.users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.customer_payments IS 'سندات القبض (تحصيل من العملاء مقابل ذمم مدينة)';

CREATE INDEX IF NOT EXISTS idx_customer_payments_customer ON public.customer_payments (customer_id, created_at);

ALTER TABLE public.customer_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customer_payments_select" ON public.customer_payments
  FOR SELECT TO authenticated USING (is_pos_admin() OR branch_id = get_branch_id());
CREATE POLICY "customer_payments_insert" ON public.customer_payments
  FOR INSERT TO authenticated WITH CHECK (is_pos_admin());

-- ---------------------------------------------------------------------
-- 5. Document sequence for journal entries
-- ---------------------------------------------------------------------
INSERT INTO public.document_sequences (seq_type, next_value) VALUES ('journal', 1)
ON CONFLICT (seq_type) DO NOTHING;
