-- ============================================================================
-- Phase 3: Full Tenant Data Isolation
-- Extends branch-scoped RLS from Phase 2 to ALL branch-related tables.
-- ============================================================================

-- ============================================================================
-- Helper: user_may_access_branch
-- ============================================================================

CREATE OR REPLACE FUNCTION public.user_may_access_branch(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.branches b
      WHERE b.id = p_branch_id
        AND b.organization_id IN (SELECT public.user_organization_ids())
    )
    OR (p_branch_id IS NULL AND public.is_platform_admin());
$$;

GRANT EXECUTE ON FUNCTION public.user_may_access_branch(uuid) TO authenticated;

-- ============================================================================
-- Core business tables: products, categories, warehouses, customers,
-- suppliers, expenses
-- ============================================================================

-- products
DROP POLICY IF EXISTS auth_select_products ON public.products;
CREATE POLICY auth_select_products ON public.products
  FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_insert_products ON public.products;
CREATE POLICY auth_insert_products ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR (public.can_permission('products.manage') AND public.user_may_access_branch(branch_id))
  );

DROP POLICY IF EXISTS auth_update_products ON public.products;
CREATE POLICY auth_update_products ON public.products
  FOR UPDATE TO authenticated
  USING (public.user_may_access_branch(branch_id))
  WITH CHECK (
    public.is_platform_admin()
    OR (public.can_permission('products.manage') AND public.user_may_access_branch(branch_id))
  );

DROP POLICY IF EXISTS auth_delete_products ON public.products;
CREATE POLICY auth_delete_products ON public.products
  FOR DELETE TO authenticated
  USING (
    public.is_platform_admin()
    OR (public.can_permission('products.manage') AND public.user_may_access_branch(branch_id))
  );

-- categories
DROP POLICY IF EXISTS auth_select_categories ON public.categories;
CREATE POLICY auth_select_categories ON public.categories
  FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_insert_categories ON public.categories;
CREATE POLICY auth_insert_categories ON public.categories
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR (public.can_permission('categories.manage') AND public.user_may_access_branch(branch_id))
  );

DROP POLICY IF EXISTS auth_update_categories ON public.categories;
CREATE POLICY auth_update_categories ON public.categories
  FOR UPDATE TO authenticated
  USING (public.user_may_access_branch(branch_id))
  WITH CHECK (
    public.is_platform_admin()
    OR (public.can_permission('categories.manage') AND public.user_may_access_branch(branch_id))
  );

DROP POLICY IF EXISTS auth_delete_categories ON public.categories;
CREATE POLICY auth_delete_categories ON public.categories
  FOR DELETE TO authenticated
  USING (
    public.is_platform_admin()
    OR (public.can_permission('categories.manage') AND public.user_may_access_branch(branch_id))
  );

-- warehouses
DROP POLICY IF EXISTS auth_select_warehouses ON public.warehouses;
CREATE POLICY auth_select_warehouses ON public.warehouses
  FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_insert_warehouses ON public.warehouses;
CREATE POLICY auth_insert_warehouses ON public.warehouses
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR (public.can_permission('warehouses.manage') AND public.user_may_access_branch(branch_id))
  );

DROP POLICY IF EXISTS auth_update_warehouses ON public.warehouses;
CREATE POLICY auth_update_warehouses ON public.warehouses
  FOR UPDATE TO authenticated
  USING (public.user_may_access_branch(branch_id))
  WITH CHECK (
    public.is_platform_admin()
    OR (public.can_permission('warehouses.manage') AND public.user_may_access_branch(branch_id))
  );

DROP POLICY IF EXISTS auth_delete_warehouses ON public.warehouses;
CREATE POLICY auth_delete_warehouses ON public.warehouses
  FOR DELETE TO authenticated
  USING (
    public.is_platform_admin()
    OR (public.can_permission('warehouses.manage') AND public.user_may_access_branch(branch_id))
  );

-- customers
DROP POLICY IF EXISTS auth_select_customers ON public.customers;
CREATE POLICY auth_select_customers ON public.customers
  FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_insert_customers ON public.customers;
CREATE POLICY auth_insert_customers ON public.customers
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR (public.can_permission('customers.manage') AND public.user_may_access_branch(branch_id))
  );

DROP POLICY IF EXISTS auth_update_customers ON public.customers;
CREATE POLICY auth_update_customers ON public.customers
  FOR UPDATE TO authenticated
  USING (public.user_may_access_branch(branch_id))
  WITH CHECK (
    public.is_platform_admin()
    OR (public.can_permission('customers.manage') AND public.user_may_access_branch(branch_id))
  );

DROP POLICY IF EXISTS auth_delete_customers ON public.customers;
CREATE POLICY auth_delete_customers ON public.customers
  FOR DELETE TO authenticated
  USING (
    public.is_platform_admin()
    OR (public.can_permission('customers.manage') AND public.user_may_access_branch(branch_id))
  );

-- suppliers
DROP POLICY IF EXISTS auth_select_suppliers ON public.suppliers;
CREATE POLICY auth_select_suppliers ON public.suppliers
  FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_insert_suppliers ON public.suppliers;
CREATE POLICY auth_insert_suppliers ON public.suppliers
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR (public.can_permission('suppliers.manage') AND public.user_may_access_branch(branch_id))
  );

DROP POLICY IF EXISTS auth_update_suppliers ON public.suppliers;
CREATE POLICY auth_update_suppliers ON public.suppliers
  FOR UPDATE TO authenticated
  USING (public.user_may_access_branch(branch_id))
  WITH CHECK (
    public.is_platform_admin()
    OR (public.can_permission('suppliers.manage') AND public.user_may_access_branch(branch_id))
  );

DROP POLICY IF EXISTS auth_delete_suppliers ON public.suppliers;
CREATE POLICY auth_delete_suppliers ON public.suppliers
  FOR DELETE TO authenticated
  USING (
    public.is_platform_admin()
    OR (public.can_permission('suppliers.manage') AND public.user_may_access_branch(branch_id))
  );

-- expenses
DROP POLICY IF EXISTS auth_select_expenses ON public.expenses;
CREATE POLICY auth_select_expenses ON public.expenses
  FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_insert_expenses ON public.expenses;
CREATE POLICY auth_insert_expenses ON public.expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR (public.can_permission('expenses.manage') AND public.user_may_access_branch(branch_id))
  );

DROP POLICY IF EXISTS auth_update_expenses ON public.expenses;
CREATE POLICY auth_update_expenses ON public.expenses
  FOR UPDATE TO authenticated
  USING (public.user_may_access_branch(branch_id))
  WITH CHECK (
    public.is_platform_admin()
    OR (public.can_permission('expenses.manage') AND public.user_may_access_branch(branch_id))
  );

DROP POLICY IF EXISTS auth_delete_expenses ON public.expenses;
CREATE POLICY auth_delete_expenses ON public.expenses
  FOR DELETE TO authenticated
  USING (
    public.is_platform_admin()
    OR (public.can_permission('expenses.manage') AND public.user_may_access_branch(branch_id))
  );

-- ============================================================================
-- Transaction tables: sales, purchases, stock_transactions
-- ============================================================================

-- sales
DROP POLICY IF EXISTS auth_select_sales ON public.sales;
CREATE POLICY auth_select_sales ON public.sales
  FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_insert_sales ON public.sales;
CREATE POLICY auth_insert_sales ON public.sales
  FOR INSERT TO authenticated
  WITH CHECK (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_update_sales ON public.sales;
CREATE POLICY auth_update_sales ON public.sales
  FOR UPDATE TO authenticated
  USING (public.user_may_access_branch(branch_id))
  WITH CHECK (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_delete_sales ON public.sales;
CREATE POLICY auth_delete_sales ON public.sales
  FOR DELETE TO authenticated
  USING (
    public.is_platform_admin()
    OR (public.can_permission('sales.manage') AND public.user_may_access_branch(branch_id))
  );

-- purchases
DROP POLICY IF EXISTS auth_select_purchases ON public.purchases;
CREATE POLICY auth_select_purchases ON public.purchases
  FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_insert_purchases ON public.purchases;
CREATE POLICY auth_insert_purchases ON public.purchases
  FOR INSERT TO authenticated
  WITH CHECK (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_update_purchases ON public.purchases;
CREATE POLICY auth_update_purchases ON public.purchases
  FOR UPDATE TO authenticated
  USING (public.user_may_access_branch(branch_id))
  WITH CHECK (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_delete_purchases ON public.purchases;
CREATE POLICY auth_delete_purchases ON public.purchases
  FOR DELETE TO authenticated
  USING (
    public.is_platform_admin()
    OR (public.can_permission('purchases.manage') AND public.user_may_access_branch(branch_id))
  );

-- stock_transactions
DROP POLICY IF EXISTS auth_select_stock_transactions ON public.stock_transactions;
CREATE POLICY auth_select_stock_transactions ON public.stock_transactions
  FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_insert_stock_transactions ON public.stock_transactions;
CREATE POLICY auth_insert_stock_transactions ON public.stock_transactions
  FOR INSERT TO authenticated
  WITH CHECK (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_update_stock_transactions ON public.stock_transactions;
CREATE POLICY auth_update_stock_transactions ON public.stock_transactions
  FOR UPDATE TO authenticated
  USING (public.user_may_access_branch(branch_id))
  WITH CHECK (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_delete_stock_transactions ON public.stock_transactions;
CREATE POLICY auth_delete_stock_transactions ON public.stock_transactions
  FOR DELETE TO authenticated
  USING (false);

-- ============================================================================
-- Accounting tables
-- ============================================================================

-- chart_of_accounts
DROP POLICY IF EXISTS auth_select_chart_of_accounts ON public.chart_of_accounts;
DROP POLICY IF EXISTS coa_select ON public.chart_of_accounts;
DROP POLICY IF EXISTS coa_insert ON public.chart_of_accounts;
DROP POLICY IF EXISTS coa_update ON public.chart_of_accounts;
DROP POLICY IF EXISTS coa_delete ON public.chart_of_accounts;
CREATE POLICY auth_select_chart_of_accounts ON public.chart_of_accounts
  FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_insert_chart_of_accounts ON public.chart_of_accounts;
CREATE POLICY auth_insert_chart_of_accounts ON public.chart_of_accounts
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR (public.can_permission('accounts.manage') AND public.user_may_access_branch(branch_id))
  );

DROP POLICY IF EXISTS auth_update_chart_of_accounts ON public.chart_of_accounts;
CREATE POLICY auth_update_chart_of_accounts ON public.chart_of_accounts
  FOR UPDATE TO authenticated
  USING (public.user_may_access_branch(branch_id))
  WITH CHECK (
    public.is_platform_admin()
    OR (public.can_permission('accounts.manage') AND public.user_may_access_branch(branch_id))
  );

DROP POLICY IF EXISTS auth_delete_chart_of_accounts ON public.chart_of_accounts;
CREATE POLICY auth_delete_chart_of_accounts ON public.chart_of_accounts
  FOR DELETE TO authenticated
  USING (
    public.is_platform_admin()
    OR (public.can_permission('accounts.manage') AND public.user_may_access_branch(branch_id))
  );

-- account_mappings
DROP POLICY IF EXISTS auth_select_account_mappings ON public.account_mappings;
DROP POLICY IF EXISTS account_mappings_select ON public.account_mappings;
DROP POLICY IF EXISTS account_mappings_insert ON public.account_mappings;
DROP POLICY IF EXISTS account_mappings_update ON public.account_mappings;
DROP POLICY IF EXISTS account_mappings_delete ON public.account_mappings;
CREATE POLICY auth_select_account_mappings ON public.account_mappings
  FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_insert_account_mappings ON public.account_mappings;
CREATE POLICY auth_insert_account_mappings ON public.account_mappings
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR (public.can_permission('accounts.manage') AND public.user_may_access_branch(branch_id))
  );

DROP POLICY IF EXISTS auth_update_account_mappings ON public.account_mappings;
CREATE POLICY auth_update_account_mappings ON public.account_mappings
  FOR UPDATE TO authenticated
  USING (public.user_may_access_branch(branch_id))
  WITH CHECK (
    public.is_platform_admin()
    OR (public.can_permission('accounts.manage') AND public.user_may_access_branch(branch_id))
  );

DROP POLICY IF EXISTS auth_delete_account_mappings ON public.account_mappings;
CREATE POLICY auth_delete_account_mappings ON public.account_mappings
  FOR DELETE TO authenticated
  USING (
    public.is_platform_admin()
    OR (public.can_permission('accounts.manage') AND public.user_may_access_branch(branch_id))
  );

-- journal_entries
DROP POLICY IF EXISTS auth_select_journal_entries ON public.journal_entries;
DROP POLICY IF EXISTS journal_entries_select ON public.journal_entries;
DROP POLICY IF EXISTS journal_entries_insert ON public.journal_entries;
CREATE POLICY auth_select_journal_entries ON public.journal_entries
  FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_insert_journal_entries ON public.journal_entries;
CREATE POLICY auth_insert_journal_entries ON public.journal_entries
  FOR INSERT TO authenticated
  WITH CHECK (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_update_journal_entries ON public.journal_entries;
CREATE POLICY auth_update_journal_entries ON public.journal_entries
  FOR UPDATE TO authenticated
  USING (public.user_may_access_branch(branch_id))
  WITH CHECK (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_delete_journal_entries ON public.journal_entries;
CREATE POLICY auth_delete_journal_entries ON public.journal_entries
  FOR DELETE TO authenticated
  USING (false);

-- journal_entry_lines
DROP POLICY IF EXISTS auth_select_journal_entry_lines ON public.journal_entry_lines;
DROP POLICY IF EXISTS journal_entry_lines_select ON public.journal_entry_lines;
DROP POLICY IF EXISTS journal_entry_lines_insert ON public.journal_entry_lines;
CREATE POLICY auth_select_journal_entry_lines ON public.journal_entry_lines
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.journal_entries je
      WHERE je.id = journal_entry_lines.journal_entry_id
        AND public.user_may_access_branch(je.branch_id)
    )
  );

DROP POLICY IF EXISTS auth_insert_journal_entry_lines ON public.journal_entry_lines;
CREATE POLICY auth_insert_journal_entry_lines ON public.journal_entry_lines
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.journal_entries je
      WHERE je.id = journal_entry_lines.journal_entry_id
        AND public.user_may_access_branch(je.branch_id)
    )
  );

DROP POLICY IF EXISTS auth_update_journal_entry_lines ON public.journal_entry_lines;
CREATE POLICY auth_update_journal_entry_lines ON public.journal_entry_lines
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.journal_entries je
      WHERE je.id = journal_entry_lines.journal_entry_id
        AND public.user_may_access_branch(je.branch_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.journal_entries je
      WHERE je.id = journal_entry_lines.journal_entry_id
        AND public.user_may_access_branch(je.branch_id)
    )
  );

DROP POLICY IF EXISTS auth_delete_journal_entry_lines ON public.journal_entry_lines;
CREATE POLICY auth_delete_journal_entry_lines ON public.journal_entry_lines
  FOR DELETE TO authenticated
  USING (false);

-- customer_payments
DROP POLICY IF EXISTS auth_select_customer_payments ON public.customer_payments;
DROP POLICY IF EXISTS customer_payments_select ON public.customer_payments;
DROP POLICY IF EXISTS customer_payments_insert ON public.customer_payments;
CREATE POLICY auth_select_customer_payments ON public.customer_payments
  FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_insert_customer_payments ON public.customer_payments;
CREATE POLICY auth_insert_customer_payments ON public.customer_payments
  FOR INSERT TO authenticated
  WITH CHECK (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_update_customer_payments ON public.customer_payments;
CREATE POLICY auth_update_customer_payments ON public.customer_payments
  FOR UPDATE TO authenticated
  USING (public.user_may_access_branch(branch_id))
  WITH CHECK (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_delete_customer_payments ON public.customer_payments;
CREATE POLICY auth_delete_customer_payments ON public.customer_payments
  FOR DELETE TO authenticated
  USING (false);

-- supplier_payments
DROP POLICY IF EXISTS auth_select_supplier_payments ON public.supplier_payments;
DROP POLICY IF EXISTS supplier_payments_select ON public.supplier_payments;
DROP POLICY IF EXISTS supplier_payments_insert ON public.supplier_payments;
CREATE POLICY auth_select_supplier_payments ON public.supplier_payments
  FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_insert_supplier_payments ON public.supplier_payments;
CREATE POLICY auth_insert_supplier_payments ON public.supplier_payments
  FOR INSERT TO authenticated
  WITH CHECK (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_update_supplier_payments ON public.supplier_payments;
CREATE POLICY auth_update_supplier_payments ON public.supplier_payments
  FOR UPDATE TO authenticated
  USING (public.user_may_access_branch(branch_id))
  WITH CHECK (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_delete_supplier_payments ON public.supplier_payments;
CREATE POLICY auth_delete_supplier_payments ON public.supplier_payments
  FOR DELETE TO authenticated
  USING (false);

-- treasury_accounts
DROP POLICY IF EXISTS auth_select_treasury_accounts ON public.treasury_accounts;
DROP POLICY IF EXISTS treasury_accounts_select ON public.treasury_accounts;
DROP POLICY IF EXISTS treasury_accounts_insert ON public.treasury_accounts;
DROP POLICY IF EXISTS treasury_accounts_update ON public.treasury_accounts;
DROP POLICY IF EXISTS treasury_accounts_delete ON public.treasury_accounts;
CREATE POLICY auth_select_treasury_accounts ON public.treasury_accounts
  FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_insert_treasury_accounts ON public.treasury_accounts;
CREATE POLICY auth_insert_treasury_accounts ON public.treasury_accounts
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR (public.can_permission('accounts.manage') AND public.user_may_access_branch(branch_id))
  );

DROP POLICY IF EXISTS auth_update_treasury_accounts ON public.treasury_accounts;
CREATE POLICY auth_update_treasury_accounts ON public.treasury_accounts
  FOR UPDATE TO authenticated
  USING (public.user_may_access_branch(branch_id))
  WITH CHECK (
    public.is_platform_admin()
    OR (public.can_permission('accounts.manage') AND public.user_may_access_branch(branch_id))
  );

DROP POLICY IF EXISTS auth_delete_treasury_accounts ON public.treasury_accounts;
CREATE POLICY auth_delete_treasury_accounts ON public.treasury_accounts
  FOR DELETE TO authenticated
  USING (
    public.is_platform_admin()
    OR (public.can_permission('accounts.manage') AND public.user_may_access_branch(branch_id))
  );

-- treasury_transactions
DROP POLICY IF EXISTS auth_select_treasury_transactions ON public.treasury_transactions;
DROP POLICY IF EXISTS treasury_transactions_select ON public.treasury_transactions;
DROP POLICY IF EXISTS treasury_transactions_insert ON public.treasury_transactions;
CREATE POLICY auth_select_treasury_transactions ON public.treasury_transactions
  FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_insert_treasury_transactions ON public.treasury_transactions;
CREATE POLICY auth_insert_treasury_transactions ON public.treasury_transactions
  FOR INSERT TO authenticated
  WITH CHECK (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_update_treasury_transactions ON public.treasury_transactions;
CREATE POLICY auth_update_treasury_transactions ON public.treasury_transactions
  FOR UPDATE TO authenticated
  USING (public.user_may_access_branch(branch_id))
  WITH CHECK (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_delete_treasury_transactions ON public.treasury_transactions;
CREATE POLICY auth_delete_treasury_transactions ON public.treasury_transactions
  FOR DELETE TO authenticated
  USING (false);

-- bank_reconciliations
DROP POLICY IF EXISTS auth_select_bank_reconciliations ON public.bank_reconciliations;
DROP POLICY IF EXISTS bank_reconciliations_select ON public.bank_reconciliations;
DROP POLICY IF EXISTS bank_reconciliations_insert ON public.bank_reconciliations;
DROP POLICY IF EXISTS bank_reconciliations_update ON public.bank_reconciliations;
CREATE POLICY auth_select_bank_reconciliations ON public.bank_reconciliations
  FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_insert_bank_reconciliations ON public.bank_reconciliations;
CREATE POLICY auth_insert_bank_reconciliations ON public.bank_reconciliations
  FOR INSERT TO authenticated
  WITH CHECK (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_update_bank_reconciliations ON public.bank_reconciliations;
CREATE POLICY auth_update_bank_reconciliations ON public.bank_reconciliations
  FOR UPDATE TO authenticated
  USING (public.user_may_access_branch(branch_id))
  WITH CHECK (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_delete_bank_reconciliations ON public.bank_reconciliations;
CREATE POLICY auth_delete_bank_reconciliations ON public.bank_reconciliations
  FOR DELETE TO authenticated
  USING (false);

-- bank_statement_lines
DROP POLICY IF EXISTS auth_select_bank_statement_lines ON public.bank_statement_lines;
DROP POLICY IF EXISTS bank_statement_lines_select ON public.bank_statement_lines;
DROP POLICY IF EXISTS bank_statement_lines_insert ON public.bank_statement_lines;
DROP POLICY IF EXISTS bank_statement_lines_update ON public.bank_statement_lines;
CREATE POLICY auth_select_bank_statement_lines ON public.bank_statement_lines
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bank_reconciliations br
      WHERE br.id = bank_statement_lines.reconciliation_id
        AND public.user_may_access_branch(br.branch_id)
    )
  );

DROP POLICY IF EXISTS auth_insert_bank_statement_lines ON public.bank_statement_lines;
CREATE POLICY auth_insert_bank_statement_lines ON public.bank_statement_lines
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bank_reconciliations br
      WHERE br.id = bank_statement_lines.reconciliation_id
        AND public.user_may_access_branch(br.branch_id)
    )
  );

DROP POLICY IF EXISTS auth_update_bank_statement_lines ON public.bank_statement_lines;
CREATE POLICY auth_update_bank_statement_lines ON public.bank_statement_lines
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bank_reconciliations br
      WHERE br.id = bank_statement_lines.reconciliation_id
        AND public.user_may_access_branch(br.branch_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bank_reconciliations br
      WHERE br.id = bank_statement_lines.reconciliation_id
        AND public.user_may_access_branch(br.branch_id)
    )
  );

DROP POLICY IF EXISTS auth_delete_bank_statement_lines ON public.bank_statement_lines;
CREATE POLICY auth_delete_bank_statement_lines ON public.bank_statement_lines
  FOR DELETE TO authenticated
  USING (false);

-- ============================================================================
-- Manufacturing tables
-- ============================================================================

-- raw_materials (open read, permission-gated writes)
DROP POLICY IF EXISTS auth_select_raw_materials ON public.raw_materials;
DROP POLICY IF EXISTS raw_materials_select ON public.raw_materials;
CREATE POLICY auth_select_raw_materials ON public.raw_materials
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS auth_insert_raw_materials ON public.raw_materials;
CREATE POLICY auth_insert_raw_materials ON public.raw_materials
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR (public.can_permission('raw_materials.manage') AND public.user_may_access_branch(branch_id))
  );

DROP POLICY IF EXISTS auth_update_raw_materials ON public.raw_materials;
CREATE POLICY auth_update_raw_materials ON public.raw_materials
  FOR UPDATE TO authenticated
  USING (public.user_may_access_branch(branch_id))
  WITH CHECK (
    public.is_platform_admin()
    OR (public.can_permission('raw_materials.manage') AND public.user_may_access_branch(branch_id))
  );

DROP POLICY IF EXISTS auth_delete_raw_materials ON public.raw_materials;
CREATE POLICY auth_delete_raw_materials ON public.raw_materials
  FOR DELETE TO authenticated
  USING (
    public.is_platform_admin()
    OR (public.can_permission('raw_materials.manage') AND public.user_may_access_branch(branch_id))
  );

-- raw_material_inventory
DROP POLICY IF EXISTS auth_select_raw_material_inventory ON public.raw_material_inventory;
DROP POLICY IF EXISTS raw_material_inventory_select ON public.raw_material_inventory;
DROP POLICY IF EXISTS raw_material_inventory_write ON public.raw_material_inventory;
CREATE POLICY auth_select_raw_material_inventory ON public.raw_material_inventory
  FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_insert_raw_material_inventory ON public.raw_material_inventory;
CREATE POLICY auth_insert_raw_material_inventory ON public.raw_material_inventory
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR (public.can_permission('raw_materials.manage') AND public.user_may_access_branch(branch_id))
  );

DROP POLICY IF EXISTS auth_update_raw_material_inventory ON public.raw_material_inventory;
CREATE POLICY auth_update_raw_material_inventory ON public.raw_material_inventory
  FOR UPDATE TO authenticated
  USING (public.user_may_access_branch(branch_id))
  WITH CHECK (
    public.is_platform_admin()
    OR (public.can_permission('raw_materials.manage') AND public.user_may_access_branch(branch_id))
  );

DROP POLICY IF EXISTS auth_delete_raw_material_inventory ON public.raw_material_inventory;
CREATE POLICY auth_delete_raw_material_inventory ON public.raw_material_inventory
  FOR DELETE TO authenticated
  USING (false);

-- raw_material_batches
DROP POLICY IF EXISTS auth_select_raw_material_batches ON public.raw_material_batches;
DROP POLICY IF EXISTS raw_material_batches_select ON public.raw_material_batches;
DROP POLICY IF EXISTS raw_material_batches_write ON public.raw_material_batches;
CREATE POLICY auth_select_raw_material_batches ON public.raw_material_batches
  FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_insert_raw_material_batches ON public.raw_material_batches;
CREATE POLICY auth_insert_raw_material_batches ON public.raw_material_batches
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR (public.can_permission('raw_materials.manage') AND public.user_may_access_branch(branch_id))
  );

DROP POLICY IF EXISTS auth_update_raw_material_batches ON public.raw_material_batches;
CREATE POLICY auth_update_raw_material_batches ON public.raw_material_batches
  FOR UPDATE TO authenticated
  USING (public.user_may_access_branch(branch_id))
  WITH CHECK (
    public.is_platform_admin()
    OR (public.can_permission('raw_materials.manage') AND public.user_may_access_branch(branch_id))
  );

DROP POLICY IF EXISTS auth_delete_raw_material_batches ON public.raw_material_batches;
CREATE POLICY auth_delete_raw_material_batches ON public.raw_material_batches
  FOR DELETE TO authenticated
  USING (false);

-- recipes
DROP POLICY IF EXISTS auth_select_recipes ON public.recipes;
DROP POLICY IF EXISTS recipes_select ON public.recipes;
DROP POLICY IF EXISTS recipes_write ON public.recipes;
CREATE POLICY auth_select_recipes ON public.recipes
  FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_insert_recipes ON public.recipes;
CREATE POLICY auth_insert_recipes ON public.recipes
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR (public.can_permission('recipes.manage') AND public.user_may_access_branch(branch_id))
  );

DROP POLICY IF EXISTS auth_update_recipes ON public.recipes;
CREATE POLICY auth_update_recipes ON public.recipes
  FOR UPDATE TO authenticated
  USING (public.user_may_access_branch(branch_id))
  WITH CHECK (
    public.is_platform_admin()
    OR (public.can_permission('recipes.manage') AND public.user_may_access_branch(branch_id))
  );

DROP POLICY IF EXISTS auth_delete_recipes ON public.recipes;
CREATE POLICY auth_delete_recipes ON public.recipes
  FOR DELETE TO authenticated
  USING (false);

-- recipe_items
DROP POLICY IF EXISTS auth_select_recipe_items ON public.recipe_items;
DROP POLICY IF EXISTS recipe_items_select ON public.recipe_items;
DROP POLICY IF EXISTS recipe_items_write ON public.recipe_items;
CREATE POLICY auth_select_recipe_items ON public.recipe_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.recipes r
      WHERE r.id = recipe_items.recipe_id
        AND public.user_may_access_branch(r.branch_id)
    )
  );

DROP POLICY IF EXISTS auth_insert_recipe_items ON public.recipe_items;
CREATE POLICY auth_insert_recipe_items ON public.recipe_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.recipes r
      WHERE r.id = recipe_items.recipe_id
        AND public.user_may_access_branch(r.branch_id)
    )
  );

DROP POLICY IF EXISTS auth_update_recipe_items ON public.recipe_items;
CREATE POLICY auth_update_recipe_items ON public.recipe_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.recipes r
      WHERE r.id = recipe_items.recipe_id
        AND public.user_may_access_branch(r.branch_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.recipes r
      WHERE r.id = recipe_items.recipe_id
        AND public.user_may_access_branch(r.branch_id)
    )
  );

DROP POLICY IF EXISTS auth_delete_recipe_items ON public.recipe_items;
CREATE POLICY auth_delete_recipe_items ON public.recipe_items
  FOR DELETE TO authenticated
  USING (false);

-- production_orders
DROP POLICY IF EXISTS auth_select_production_orders ON public.production_orders;
DROP POLICY IF EXISTS production_orders_select ON public.production_orders;
DROP POLICY IF EXISTS production_orders_write ON public.production_orders;
CREATE POLICY auth_select_production_orders ON public.production_orders
  FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_insert_production_orders ON public.production_orders;
CREATE POLICY auth_insert_production_orders ON public.production_orders
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR (public.can_permission('production.manage') AND public.user_may_access_branch(branch_id))
  );

DROP POLICY IF EXISTS auth_update_production_orders ON public.production_orders;
CREATE POLICY auth_update_production_orders ON public.production_orders
  FOR UPDATE TO authenticated
  USING (public.user_may_access_branch(branch_id))
  WITH CHECK (
    public.is_platform_admin()
    OR (public.can_permission('production.manage') AND public.user_may_access_branch(branch_id))
  );

DROP POLICY IF EXISTS auth_delete_production_orders ON public.production_orders;
CREATE POLICY auth_delete_production_orders ON public.production_orders
  FOR DELETE TO authenticated
  USING (false);

-- production_waste
DROP POLICY IF EXISTS auth_select_production_waste ON public.production_waste;
DROP POLICY IF EXISTS production_waste_select ON public.production_waste;
DROP POLICY IF EXISTS production_waste_write ON public.production_waste;
CREATE POLICY auth_select_production_waste ON public.production_waste
  FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_insert_production_waste ON public.production_waste;
CREATE POLICY auth_insert_production_waste ON public.production_waste
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS auth_update_production_waste ON public.production_waste;
CREATE POLICY auth_update_production_waste ON public.production_waste
  FOR UPDATE TO authenticated
  USING (public.user_may_access_branch(branch_id))
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS auth_delete_production_waste ON public.production_waste;
CREATE POLICY auth_delete_production_waste ON public.production_waste
  FOR DELETE TO authenticated
  USING (false);

-- warehouse_transfers
DROP POLICY IF EXISTS auth_select_warehouse_transfers ON public.warehouse_transfers;
DROP POLICY IF EXISTS warehouse_transfers_select ON public.warehouse_transfers;
DROP POLICY IF EXISTS warehouse_transfers_write ON public.warehouse_transfers;
CREATE POLICY auth_select_warehouse_transfers ON public.warehouse_transfers
  FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_insert_warehouse_transfers ON public.warehouse_transfers;
CREATE POLICY auth_insert_warehouse_transfers ON public.warehouse_transfers
  FOR INSERT TO authenticated
  WITH CHECK (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_update_warehouse_transfers ON public.warehouse_transfers;
CREATE POLICY auth_update_warehouse_transfers ON public.warehouse_transfers
  FOR UPDATE TO authenticated
  USING (public.user_may_access_branch(branch_id))
  WITH CHECK (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_delete_warehouse_transfers ON public.warehouse_transfers;
CREATE POLICY auth_delete_warehouse_transfers ON public.warehouse_transfers
  FOR DELETE TO authenticated
  USING (false);

-- warehouse_transfer_items
DROP POLICY IF EXISTS auth_select_warehouse_transfer_items ON public.warehouse_transfer_items;
DROP POLICY IF EXISTS warehouse_transfer_items_select ON public.warehouse_transfer_items;
DROP POLICY IF EXISTS warehouse_transfer_items_write ON public.warehouse_transfer_items;
CREATE POLICY auth_select_warehouse_transfer_items ON public.warehouse_transfer_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.warehouse_transfers wt
      WHERE wt.id = warehouse_transfer_items.transfer_id
        AND public.user_may_access_branch(wt.branch_id)
    )
  );

DROP POLICY IF EXISTS auth_insert_warehouse_transfer_items ON public.warehouse_transfer_items;
CREATE POLICY auth_insert_warehouse_transfer_items ON public.warehouse_transfer_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.warehouse_transfers wt
      WHERE wt.id = warehouse_transfer_items.transfer_id
        AND public.user_may_access_branch(wt.branch_id)
    )
  );

DROP POLICY IF EXISTS auth_update_warehouse_transfer_items ON public.warehouse_transfer_items;
CREATE POLICY auth_update_warehouse_transfer_items ON public.warehouse_transfer_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.warehouse_transfers wt
      WHERE wt.id = warehouse_transfer_items.transfer_id
        AND public.user_may_access_branch(wt.branch_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.warehouse_transfers wt
      WHERE wt.id = warehouse_transfer_items.transfer_id
        AND public.user_may_access_branch(wt.branch_id)
    )
  );

DROP POLICY IF EXISTS auth_delete_warehouse_transfer_items ON public.warehouse_transfer_items;
CREATE POLICY auth_delete_warehouse_transfer_items ON public.warehouse_transfer_items
  FOR DELETE TO authenticated
  USING (false);

-- inventory_batches
DROP POLICY IF EXISTS auth_select_inventory_batches ON public.inventory_batches;
DROP POLICY IF EXISTS inventory_batches_select ON public.inventory_batches;
DROP POLICY IF EXISTS inventory_batches_write ON public.inventory_batches;
CREATE POLICY auth_select_inventory_batches ON public.inventory_batches
  FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_insert_inventory_batches ON public.inventory_batches;
CREATE POLICY auth_insert_inventory_batches ON public.inventory_batches
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS auth_update_inventory_batches ON public.inventory_batches;
CREATE POLICY auth_update_inventory_batches ON public.inventory_batches
  FOR UPDATE TO authenticated
  USING (public.user_may_access_branch(branch_id))
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS auth_delete_inventory_batches ON public.inventory_batches;
CREATE POLICY auth_delete_inventory_batches ON public.inventory_batches
  FOR DELETE TO authenticated
  USING (false);

-- inventory_ledger
DROP POLICY IF EXISTS auth_select_inventory_ledger ON public.inventory_ledger;
DROP POLICY IF EXISTS inventory_ledger_select ON public.inventory_ledger;
DROP POLICY IF EXISTS inventory_ledger_write ON public.inventory_ledger;
CREATE POLICY auth_select_inventory_ledger ON public.inventory_ledger
  FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_insert_inventory_ledger ON public.inventory_ledger;
CREATE POLICY auth_insert_inventory_ledger ON public.inventory_ledger
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS auth_update_inventory_ledger ON public.inventory_ledger;
CREATE POLICY auth_update_inventory_ledger ON public.inventory_ledger
  FOR UPDATE TO authenticated
  USING (public.user_may_access_branch(branch_id))
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS auth_delete_inventory_ledger ON public.inventory_ledger;
CREATE POLICY auth_delete_inventory_ledger ON public.inventory_ledger
  FOR DELETE TO authenticated
  USING (false);

-- ============================================================================
-- Floorplan tables: dining_areas, dining_tables, orders, order_items
-- ============================================================================

-- dining_areas
DROP POLICY IF EXISTS auth_select_dining_areas ON public.dining_areas;
DROP POLICY IF EXISTS auth_write_dining_areas ON public.dining_areas;
DROP POLICY IF EXISTS auth_write_dining_areas_del ON public.dining_areas;
DROP POLICY IF EXISTS auth_write_dining_areas_upd ON public.dining_areas;
CREATE POLICY auth_select_dining_areas ON public.dining_areas
  FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_insert_dining_areas ON public.dining_areas;
CREATE POLICY auth_insert_dining_areas ON public.dining_areas
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS auth_update_dining_areas ON public.dining_areas;
CREATE POLICY auth_update_dining_areas ON public.dining_areas
  FOR UPDATE TO authenticated
  USING (public.user_may_access_branch(branch_id))
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS auth_delete_dining_areas ON public.dining_areas;
CREATE POLICY auth_delete_dining_areas ON public.dining_areas
  FOR DELETE TO authenticated
  USING (false);

-- dining_tables
DROP POLICY IF EXISTS auth_select_dining_tables ON public.dining_tables;
DROP POLICY IF EXISTS auth_write_dining_tables ON public.dining_tables;
DROP POLICY IF EXISTS auth_write_dining_tables_del ON public.dining_tables;
DROP POLICY IF EXISTS auth_write_dining_tables_upd ON public.dining_tables;
CREATE POLICY auth_select_dining_tables ON public.dining_tables
  FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_insert_dining_tables ON public.dining_tables;
CREATE POLICY auth_insert_dining_tables ON public.dining_tables
  FOR INSERT TO authenticated
  WITH CHECK (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_update_dining_tables ON public.dining_tables;
CREATE POLICY auth_update_dining_tables ON public.dining_tables
  FOR UPDATE TO authenticated
  USING (public.user_may_access_branch(branch_id))
  WITH CHECK (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_delete_dining_tables ON public.dining_tables;
CREATE POLICY auth_delete_dining_tables ON public.dining_tables
  FOR DELETE TO authenticated
  USING (false);

-- orders
DROP POLICY IF EXISTS auth_select_orders ON public.orders;
DROP POLICY IF EXISTS auth_write_orders ON public.orders;
DROP POLICY IF EXISTS auth_write_orders_del ON public.orders;
DROP POLICY IF EXISTS auth_write_orders_upd ON public.orders;
CREATE POLICY auth_select_orders ON public.orders
  FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_insert_orders ON public.orders;
CREATE POLICY auth_insert_orders ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_update_orders ON public.orders;
CREATE POLICY auth_update_orders ON public.orders
  FOR UPDATE TO authenticated
  USING (public.user_may_access_branch(branch_id))
  WITH CHECK (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_delete_orders ON public.orders;
CREATE POLICY auth_delete_orders ON public.orders
  FOR DELETE TO authenticated
  USING (false);

-- order_items
DROP POLICY IF EXISTS auth_select_order_items ON public.order_items;
DROP POLICY IF EXISTS auth_write_order_items ON public.order_items;
DROP POLICY IF EXISTS auth_write_order_items_del ON public.order_items;
DROP POLICY IF EXISTS auth_write_order_items_upd ON public.order_items;
CREATE POLICY auth_select_order_items ON public.order_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
        AND public.user_may_access_branch(o.branch_id)
    )
  );

DROP POLICY IF EXISTS auth_insert_order_items ON public.order_items;
CREATE POLICY auth_insert_order_items ON public.order_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
        AND public.user_may_access_branch(o.branch_id)
    )
  );

DROP POLICY IF EXISTS auth_update_order_items ON public.order_items;
CREATE POLICY auth_update_order_items ON public.order_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
        AND public.user_may_access_branch(o.branch_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
        AND public.user_may_access_branch(o.branch_id)
    )
  );

DROP POLICY IF EXISTS auth_delete_order_items ON public.order_items;
CREATE POLICY auth_delete_order_items ON public.order_items
  FOR DELETE TO authenticated
  USING (false);

-- ============================================================================
-- Other tables: branch_settings, shifts, shift_operations, audit_log,
-- users, settings, order_kitchen_sends, waste_entries,
-- product_components, product_units
-- ============================================================================

-- branch_settings
DROP POLICY IF EXISTS auth_select_branch_settings ON public.branch_settings;
DROP POLICY IF EXISTS auth_write_branch_settings ON public.branch_settings;
DROP POLICY IF EXISTS auth_write_branch_settings_del ON public.branch_settings;
DROP POLICY IF EXISTS auth_write_branch_settings_upd ON public.branch_settings;
CREATE POLICY auth_select_branch_settings ON public.branch_settings
  FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_insert_branch_settings ON public.branch_settings;
CREATE POLICY auth_insert_branch_settings ON public.branch_settings
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR (public.can_permission('settings.manage') AND public.user_may_access_branch(branch_id))
  );

DROP POLICY IF EXISTS auth_update_branch_settings ON public.branch_settings;
CREATE POLICY auth_update_branch_settings ON public.branch_settings
  FOR UPDATE TO authenticated
  USING (public.user_may_access_branch(branch_id))
  WITH CHECK (
    public.is_platform_admin()
    OR (public.can_permission('settings.manage') AND public.user_may_access_branch(branch_id))
  );

DROP POLICY IF EXISTS auth_delete_branch_settings ON public.branch_settings;
CREATE POLICY auth_delete_branch_settings ON public.branch_settings
  FOR DELETE TO authenticated
  USING (false);

-- shifts
DROP POLICY IF EXISTS auth_select_shifts ON public.shifts;
CREATE POLICY auth_select_shifts ON public.shifts
  FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_insert_shifts ON public.shifts;
CREATE POLICY auth_insert_shifts ON public.shifts
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS auth_update_shifts ON public.shifts;
CREATE POLICY auth_update_shifts ON public.shifts
  FOR UPDATE TO authenticated
  USING (public.user_may_access_branch(branch_id))
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS auth_delete_shifts ON public.shifts;
CREATE POLICY auth_delete_shifts ON public.shifts
  FOR DELETE TO authenticated
  USING (false);

-- shift_operations
DROP POLICY IF EXISTS auth_select_shift_operations ON public.shift_operations;
CREATE POLICY auth_select_shift_operations ON public.shift_operations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.shifts s
      WHERE s.id = shift_operations.shift_id
        AND public.user_may_access_branch(s.branch_id)
    )
  );

DROP POLICY IF EXISTS auth_insert_shift_operations ON public.shift_operations;
CREATE POLICY auth_insert_shift_operations ON public.shift_operations
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.shifts s
      WHERE s.id = shift_operations.shift_id
        AND public.user_may_access_branch(s.branch_id)
    )
  );

DROP POLICY IF EXISTS auth_update_shift_operations ON public.shift_operations;
CREATE POLICY auth_update_shift_operations ON public.shift_operations
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.shifts s
      WHERE s.id = shift_operations.shift_id
        AND public.user_may_access_branch(s.branch_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.shifts s
      WHERE s.id = shift_operations.shift_id
        AND public.user_may_access_branch(s.branch_id)
    )
  );

DROP POLICY IF EXISTS auth_delete_shift_operations ON public.shift_operations;
CREATE POLICY auth_delete_shift_operations ON public.shift_operations
  FOR DELETE TO authenticated
  USING (false);

-- audit_log
DROP POLICY IF EXISTS auth_select_audit_log ON public.audit_log;
CREATE POLICY auth_select_audit_log ON public.audit_log
  FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_insert_audit_log ON public.audit_log;
CREATE POLICY auth_insert_audit_log ON public.audit_log
  FOR INSERT TO authenticated
  WITH CHECK (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_update_audit_log ON public.audit_log;
CREATE POLICY auth_update_audit_log ON public.audit_log
  FOR UPDATE TO authenticated
  USING (public.user_may_access_branch(branch_id))
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS auth_delete_audit_log ON public.audit_log;
CREATE POLICY auth_delete_audit_log ON public.audit_log
  FOR DELETE TO authenticated
  USING (false);

-- users (keep existing complex policies — already branch-scoped in 004)
DROP POLICY IF EXISTS auth_select_users ON public.users;
CREATE POLICY auth_select_users ON public.users
  FOR SELECT TO authenticated
  USING (
    public.user_may_access_branch(branch_id)
    OR id = auth.uid()
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS auth_insert_users ON public.users;
CREATE POLICY auth_insert_users ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR (id = auth.uid() AND public.user_may_access_branch(branch_id))
  );

DROP POLICY IF EXISTS auth_update_users ON public.users;
CREATE POLICY auth_update_users ON public.users
  FOR UPDATE TO authenticated
  USING (
    id = auth.uid()
    OR public.is_platform_admin()
    OR (public.can_permission('users.manage') AND public.user_may_access_branch(branch_id))
  )
  WITH CHECK (
    id = auth.uid()
    OR public.is_platform_admin()
    OR (public.can_permission('users.manage') AND public.user_may_access_branch(branch_id))
  );

DROP POLICY IF EXISTS auth_delete_users ON public.users;
CREATE POLICY auth_delete_users ON public.users
  FOR DELETE TO authenticated
  USING (false);

-- settings (global, admin-only)
DROP POLICY IF EXISTS auth_select_settings ON public.settings;
CREATE POLICY auth_select_settings ON public.settings
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS auth_insert_settings ON public.settings;
CREATE POLICY auth_insert_settings ON public.settings
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS auth_update_settings ON public.settings;
CREATE POLICY auth_update_settings ON public.settings
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS auth_delete_settings ON public.settings;
CREATE POLICY auth_delete_settings ON public.settings
  FOR DELETE TO authenticated
  USING (false);

-- order_kitchen_sends
DROP POLICY IF EXISTS auth_select_order_kitchen_sends ON public.order_kitchen_sends;
DROP POLICY IF EXISTS auth_write_order_kitchen_sends ON public.order_kitchen_sends;
DROP POLICY IF EXISTS auth_write_order_kitchen_sends_del ON public.order_kitchen_sends;
DROP POLICY IF EXISTS auth_write_order_kitchen_sends_upd ON public.order_kitchen_sends;
CREATE POLICY auth_select_order_kitchen_sends ON public.order_kitchen_sends
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_kitchen_sends.order_id
        AND public.user_may_access_branch(o.branch_id)
    )
  );

DROP POLICY IF EXISTS auth_insert_order_kitchen_sends ON public.order_kitchen_sends;
CREATE POLICY auth_insert_order_kitchen_sends ON public.order_kitchen_sends
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_kitchen_sends.order_id
        AND public.user_may_access_branch(o.branch_id)
    )
  );

DROP POLICY IF EXISTS auth_update_order_kitchen_sends ON public.order_kitchen_sends;
CREATE POLICY auth_update_order_kitchen_sends ON public.order_kitchen_sends
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_kitchen_sends.order_id
        AND public.user_may_access_branch(o.branch_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_kitchen_sends.order_id
        AND public.user_may_access_branch(o.branch_id)
    )
  );

DROP POLICY IF EXISTS auth_delete_order_kitchen_sends ON public.order_kitchen_sends;
CREATE POLICY auth_delete_order_kitchen_sends ON public.order_kitchen_sends
  FOR DELETE TO authenticated
  USING (false);

-- waste_entries
DROP POLICY IF EXISTS auth_select_waste_entries ON public.waste_entries;
DROP POLICY IF EXISTS we_admin_all ON public.waste_entries;
DROP POLICY IF EXISTS we_branch_read ON public.waste_entries;
CREATE POLICY auth_select_waste_entries ON public.waste_entries
  FOR SELECT TO authenticated
  USING (public.user_may_access_branch(branch_id));

DROP POLICY IF EXISTS auth_insert_waste_entries ON public.waste_entries;
CREATE POLICY auth_insert_waste_entries ON public.waste_entries
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS auth_update_waste_entries ON public.waste_entries;
CREATE POLICY auth_update_waste_entries ON public.waste_entries
  FOR UPDATE TO authenticated
  USING (public.user_may_access_branch(branch_id))
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS auth_delete_waste_entries ON public.waste_entries;
CREATE POLICY auth_delete_waste_entries ON public.waste_entries
  FOR DELETE TO authenticated
  USING (false);

-- product_components (via parent products)
DROP POLICY IF EXISTS auth_select_product_components ON public.product_components;
CREATE POLICY auth_select_product_components ON public.product_components
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_components.product_id
        AND public.user_may_access_branch(p.branch_id)
    )
  );

DROP POLICY IF EXISTS auth_insert_product_components ON public.product_components;
CREATE POLICY auth_insert_product_components ON public.product_components
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_components.product_id
        AND public.user_may_access_branch(p.branch_id)
    )
  );

DROP POLICY IF EXISTS auth_update_product_components ON public.product_components;
CREATE POLICY auth_update_product_components ON public.product_components
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_components.product_id
        AND public.user_may_access_branch(p.branch_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_components.product_id
        AND public.user_may_access_branch(p.branch_id)
    )
  );

DROP POLICY IF EXISTS auth_delete_product_components ON public.product_components;
CREATE POLICY auth_delete_product_components ON public.product_components
  FOR DELETE TO authenticated
  USING (false);

-- product_units (via parent products)
DROP POLICY IF EXISTS auth_select_product_units ON public.product_units;
CREATE POLICY auth_select_product_units ON public.product_units
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_units.product_id
        AND public.user_may_access_branch(p.branch_id)
    )
  );

DROP POLICY IF EXISTS auth_insert_product_units ON public.product_units;
CREATE POLICY auth_insert_product_units ON public.product_units
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_units.product_id
        AND public.user_may_access_branch(p.branch_id)
    )
  );

DROP POLICY IF EXISTS auth_update_product_units ON public.product_units;
CREATE POLICY auth_update_product_units ON public.product_units
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_units.product_id
        AND public.user_may_access_branch(p.branch_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_units.product_id
        AND public.user_may_access_branch(p.branch_id)
    )
  );

DROP POLICY IF EXISTS auth_delete_product_units ON public.product_units;
CREATE POLICY auth_delete_product_units ON public.product_units
  FOR DELETE TO authenticated
  USING (false);
