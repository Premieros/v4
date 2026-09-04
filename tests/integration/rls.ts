import type pg from 'pg';
import { randomUUID } from 'node:crypto';

// Harness for RLS branch-isolation integration tests.
//
// Impersonation model (CI/local only): auth.uid() reads the transaction-scoped
// GUC `app.user_id` (see supabase/ci/stub_auth.sql). Every assertion runs as
// `authenticated` with that GUC set, so RLS policies evaluate against the
// impersonated user. Each run is wrapped in a savepoint so a policy-rejected
// statement (which aborts the transaction) is rolled back cleanly and the
// shared BEGIN..ROLLBACK fixture transaction stays usable.

export const ADMIN_ROLES = new Set(['super_admin', 'owner']);
export const PERM_ROLES = new Set(['branch_manager']); // granted accounts.manage in the fixture

export const ROLES = ['super_admin', 'owner', 'branch_manager', 'cashier', 'warehouse_manager', 'accountant', 'production_manager'] as const;
export type RoleName = (typeof ROLES)[number];

let seq = 0;
export function uniq(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}`;
}

export interface RlsUsers {
  super_admin: string;
  owner: string;
  branch_manager: string;
  cashier: string;
  cashier_b: string;
  warehouse_manager: string;
  accountant: string;
  production_manager: string;
}

export interface RlsIds {
  branchA: string;
  branchB: string;
  whA: string;
  whB: string;
  catA: string;
  catB: string;
  prodA: string;
  prodB: string;
  custA: string;
  custB: string;
  suppA: string;
  suppB: string;
  rm: string;
  rm2: string;
  coaPoolA: string[];
  coaPoolB: string[];
  treasuryBankA: string;
  treasuryBankB: string;
  users: RlsUsers;
  coaCashA: string;
  coaBankA: string;
  coaCashB: string;
  coaBankB: string;
  rows: Record<string, { own: string; other: string }>;
  saleA: string;
  saleB: string;
  purchA: string;
  purchB: string;
  shiftA: string;
  shiftB: string;
  jeA: string;
  jeB: string;
}

async function ins(client: pg.Client, sql: string): Promise<string> {
  const r = await client.query<{ id: string }>(`${sql} RETURNING id`);
  return r.rows[0].id;
}

// Seeds two branches with a full isolated dataset. Runs as the session role
// (postgres) so it is unaffected by RLS. Every row is discarded at ROLLBACK.
export async function seedRlsFixture(client: pg.Client): Promise<RlsIds> {
  const ids: RlsIds = {} as RlsIds;

  // Create two organizations for proper tenant isolation
  const orgA = await ins(client, `INSERT INTO public.organizations (name, slug) VALUES ('Org A', 'org-a')`);
  const orgB = await ins(client, `INSERT INTO public.organizations (name, slug) VALUES ('Org B', 'org-b')`);

  ids.branchA = await ins(client, `INSERT INTO public.branches (name, organization_id) VALUES ('RLS A', '${orgA}')`);
  ids.branchB = await ins(client, `INSERT INTO public.branches (name, organization_id) VALUES ('RLS B', '${orgB}')`);

  // Chart of accounts + mappings + treasury accounts are seeded per branch by
  // their canonical functions (SECURITY DEFINER).
  await client.query(`SELECT public.seed_account_mappings($1)`, [ids.branchA]);
  await client.query(`SELECT public.seed_account_mappings($1)`, [ids.branchB]);
  await client.query(`SELECT public.seed_treasury_accounts($1)`, [ids.branchA]);
  await client.query(`SELECT public.seed_treasury_accounts($1)`, [ids.branchB]);

  const cashOf = async (branchId: string) =>
    (await client.query<{ account_id: string }>(
      `SELECT account_id FROM public.account_mappings WHERE branch_id = $1 AND semantic_key = 'cash'`,
      [branchId],
    )).rows[0].account_id;
  ids.coaCashA = await cashOf(ids.branchA);
  ids.coaCashB = await cashOf(ids.branchB);
  ids.coaBankA = (await client.query<{ account_id: string }>(
    `SELECT account_id FROM public.account_mappings WHERE branch_id = $1 AND semantic_key = 'bank'`,
    [ids.branchA],
  )).rows[0].account_id;
  ids.coaBankB = (await client.query<{ account_id: string }>(
    `SELECT account_id FROM public.account_mappings WHERE branch_id = $1 AND semantic_key = 'bank'`,
    [ids.branchB],
  )).rows[0].account_id;

  // Treasury rows (seed_treasury_accounts) carry their OWN generated id and a
  // separate account_id pointing at the chart account. Reconcilions FK to the
  // treasury row id, so resolve those per branch here.
  const treasuryIdOf = async (branchId: string, accountId: string) =>
    (await client.query<{ id: string }>(
      `SELECT id FROM public.treasury_accounts WHERE branch_id = $1 AND account_id = $2`,
      [branchId, accountId],
    )).rows[0].id;
  ids.treasuryBankA = await treasuryIdOf(ids.branchA, ids.coaBankA);
  ids.treasuryBankB = await treasuryIdOf(ids.branchB, ids.coaBankB);

  ids.whA = await ins(client, `INSERT INTO public.warehouses (name, branch_id, is_active) VALUES ('WA', '${ids.branchA}', true)`);
  ids.whB = await ins(client, `INSERT INTO public.warehouses (name, branch_id, is_active) VALUES ('WB', '${ids.branchB}', true)`);
  ids.catA = await ins(client, `INSERT INTO public.categories (name, branch_id) VALUES ('CatA', '${ids.branchA}')`);
  ids.catB = await ins(client, `INSERT INTO public.categories (name, branch_id) VALUES ('CatB', '${ids.branchB}')`);
  ids.prodA = await ins(client, `INSERT INTO public.products (name, branch_id, cost_price, sale_price, is_active) VALUES ('ProdA', '${ids.branchA}', 10, 20, true)`);
  ids.prodB = await ins(client, `INSERT INTO public.products (name, branch_id, cost_price, sale_price, is_active) VALUES ('ProdB', '${ids.branchB}', 10, 20, true)`);
  ids.custA = await ins(client, `INSERT INTO public.customers (name, branch_id) VALUES ('CustA', '${ids.branchA}')`);
  ids.custB = await ins(client, `INSERT INTO public.customers (name, branch_id) VALUES ('CustB', '${ids.branchB}')`);
  ids.suppA = await ins(client, `INSERT INTO public.suppliers (name, branch_id) VALUES ('SuppA', '${ids.branchA}')`);
  ids.suppB = await ins(client, `INSERT INTO public.suppliers (name, branch_id) VALUES ('SuppB', '${ids.branchB}')`);
  ids.rm = await ins(client, `INSERT INTO public.raw_materials (code, name) VALUES ('${uniq('RM')}', 'RM')`);

  // The role-guard trigger reads auth.uid() and rejects inserts when the caller
  // is unknown. Seeding runs as postgres (no JWT), so disable it for the seed
  // and restore immediately after (the trigger guard is what the tests
  // exercise, not the seed).
  await client.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');

  const user = async (email: string, fullName: string, role: string, branchId: string | null) =>
    (await client.query<{ id: string }>(
      `INSERT INTO public.users (id, email, username, full_name, role, branch_id, is_active) VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING id`,
      [randomUUID(), email, email.split('@')[0], fullName, role, branchId],
    )).rows[0].id;

  ids.users = {
    super_admin: await user('su@rls.test', 'Super', 'super_admin', null),
    owner: await user('ow@rls.test', 'Owner', 'owner', null),
    branch_manager: await user('bm@rls.test', 'Branch Mgr', 'branch_manager', ids.branchA),
    cashier: await user('ca@rls.test', 'Cashier A', 'cashier', ids.branchA),
    cashier_b: await user('cb@rls.test', 'Cashier B', 'cashier', ids.branchB),
    warehouse_manager: await user('wh@rls.test', 'Whouse Mgr', 'warehouse_manager', ids.branchA),
    accountant: await user('ac@rls.test', 'Accountant', 'accountant', ids.branchA),
    production_manager: await user('pm@rls.test', 'Production Mgr', 'production_manager', ids.branchA),
  };

  await client.query('ALTER TABLE public.users ENABLE TRIGGER trg_users_role_guard');

  // Add organization memberships so user_organization_ids() returns non-empty
  // for non-super_admin users. This enables user_may_access_branch() to work.
  await client.query(
    `INSERT INTO public.organization_members (organization_id, user_id, membership_role, is_active) VALUES
     ($1, $2, 'owner', true),
     ($1, $3, 'member', true),
     ($1, $4, 'member', true),
     ($1, $5, 'member', true),
     ($1, $6, 'member', true),
      ($1, $7, 'member', true),
     ($8, $9, 'member', true),
     ($1, $10, 'member', true),
     ($8, $10, 'member', true),
     ($8, $2, 'member', true)`,
    [
      orgA, ids.users.owner, ids.users.branch_manager, ids.users.cashier,
      ids.users.warehouse_manager, ids.users.accountant, ids.users.production_manager,
      orgB, ids.users.cashier_b,
      ids.users.super_admin,
    ],
  );

  // branch_manager holds the accounts.manage permission so PERM-mode tables
  // can be exercised for a non-admin role (rolled back with the transaction).
  await client.query(
    `UPDATE public.roles SET permissions = permissions || '["accounts.manage"]'::jsonb WHERE role = 'branch_manager'`,
  );

  ids.saleA = await ins(client, `INSERT INTO public.sales (invoice_number, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status) VALUES ('${uniq('INV')}', '${ids.branchA}', '${ids.whA}', 0, 0, 0, 0, 0, 'cash', 'completed')`);
  ids.saleB = await ins(client, `INSERT INTO public.sales (invoice_number, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status) VALUES ('${uniq('INV')}', '${ids.branchB}', '${ids.whB}', 0, 0, 0, 0, 0, 'cash', 'completed')`);
  ids.purchA = await ins(client, `INSERT INTO public.purchases (invoice_number, supplier_id, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status) VALUES ('${uniq('PINV')}', '${ids.suppA}', '${ids.branchA}', '${ids.whA}', 0, 0, 0, 0, 0, 'cash', 'completed')`);
  ids.purchB = await ins(client, `INSERT INTO public.purchases (invoice_number, supplier_id, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status) VALUES ('${uniq('PINV')}', '${ids.suppB}', '${ids.branchB}', '${ids.whB}', 0, 0, 0, 0, 0, 'cash', 'completed')`);

  ids.shiftA = await ins(client, `INSERT INTO public.shifts (branch_id, cashier_id, opening_amount, status) VALUES ('${ids.branchA}', '${ids.users.cashier}', 0, 'open')`);
  ids.shiftB = await ins(client, `INSERT INTO public.shifts (branch_id, cashier_id, opening_amount, status) VALUES ('${ids.branchB}', '${ids.users.cashier_b}', 0, 'open')`);

  ids.jeA = await ins(client, `INSERT INTO public.journal_entries (entry_number, branch_id, entry_date, description) VALUES ('${uniq('JE')}', '${ids.branchA}', CURRENT_DATE, 'rls')`);
  ids.jeB = await ins(client, `INSERT INTO public.journal_entries (entry_number, branch_id, entry_date, description) VALUES ('${uniq('JE')}', '${ids.branchB}', CURRENT_DATE, 'rls')`);

  // Fresh chart rows used only as FK targets for treasury_accounts /
  // account_mappings fixtures (never picked up by the count assertions).
  const coaPoolA = [] as string[];
  const coaPoolB = [] as string[];
  for (let i = 0; i < 5; i++) {
    coaPoolA.push(await ins(client, `INSERT INTO public.chart_of_accounts (branch_id, code, name, account_type) VALUES ('${ids.branchA}', '${uniq('PC')}', 'PoolA', 'asset')`));
    coaPoolB.push(await ins(client, `INSERT INTO public.chart_of_accounts (branch_id, code, name, account_type) VALUES ('${ids.branchB}', '${uniq('PC')}', 'PoolB', 'asset')`));
  }
  ids.coaPoolA = coaPoolA;
  ids.coaPoolB = coaPoolB;
  // A second raw material for raw_material_inventory insert probes (UNIQUE on
  // (raw_material_id, branch_id) would reject a repeat of ids.rm).
  ids.rm2 = await ins(client, `INSERT INTO public.raw_materials (code, name) VALUES ('${uniq('RM')}', 'RM2')`);

  // Dedicated spec rows: one per branch, standalone (never referenced by the
  // child fixtures below), so UPDATE/DELETE probes cannot cascade.
  const R: Record<string, { own: string; other: string }> = {};
  const row = async (key: string, ownSql: string, otherSql: string) => {
    R[key] = { own: await ins(client, ownSql), other: await ins(client, otherSql) };
  };

  await row('products', `INSERT INTO public.products (name, branch_id, cost_price, sale_price, is_active) VALUES ('P', '${ids.branchA}', 1, 2, true)`,
      `INSERT INTO public.products (name, branch_id, cost_price, sale_price, is_active) VALUES ('P', '${ids.branchB}', 1, 2, true)`);
  await row('customers', `INSERT INTO public.customers (name, branch_id) VALUES ('C', '${ids.branchA}')`,
      `INSERT INTO public.customers (name, branch_id) VALUES ('C', '${ids.branchB}')`);
  await row('suppliers', `INSERT INTO public.suppliers (name, branch_id) VALUES ('S', '${ids.branchA}')`,
      `INSERT INTO public.suppliers (name, branch_id) VALUES ('S', '${ids.branchB}')`);
  await row('categories', `INSERT INTO public.categories (name, branch_id) VALUES ('Ca', '${ids.branchA}')`,
      `INSERT INTO public.categories (name, branch_id) VALUES ('Ca', '${ids.branchB}')`);
  await row('warehouses', `INSERT INTO public.warehouses (name, branch_id, is_active) VALUES ('W', '${ids.branchA}', true)`,
      `INSERT INTO public.warehouses (name, branch_id, is_active) VALUES ('W', '${ids.branchB}', true)`);
  await row('sales', `INSERT INTO public.sales (invoice_number, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status) VALUES ('${uniq('INV')}', '${ids.branchA}', '${ids.whA}', 0, 0, 0, 0, 0, 'cash', 'completed')`,
      `INSERT INTO public.sales (invoice_number, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status) VALUES ('${uniq('INV')}', '${ids.branchB}', '${ids.whB}', 0, 0, 0, 0, 0, 'cash', 'completed')`);
  await row('purchases', `INSERT INTO public.purchases (invoice_number, supplier_id, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status) VALUES ('${uniq('PINV')}', '${ids.suppA}', '${ids.branchA}', '${ids.whA}', 0, 0, 0, 0, 0, 'cash', 'completed')`,
      `INSERT INTO public.purchases (invoice_number, supplier_id, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status) VALUES ('${uniq('PINV')}', '${ids.suppB}', '${ids.branchB}', '${ids.whB}', 0, 0, 0, 0, 0, 'cash', 'completed')`);
  await row('expenses', `INSERT INTO public.expenses (category, description, amount, branch_id, expense_date, payment_method) VALUES ('ops', 'x', 10, '${ids.branchA}', CURRENT_DATE, 'cash')`,
      `INSERT INTO public.expenses (category, description, amount, branch_id, expense_date, payment_method) VALUES ('ops', 'x', 10, '${ids.branchB}', CURRENT_DATE, 'cash')`);
  await row('stock_transactions', `INSERT INTO public.stock_transactions (product_id, warehouse_id, branch_id, transaction_type, reference_type, quantity, reason) VALUES ('${ids.prodA}', '${ids.whA}', '${ids.branchA}', 'adjustment', 'adjustment', 1, 'x')`,
      `INSERT INTO public.stock_transactions (product_id, warehouse_id, branch_id, transaction_type, reference_type, quantity, reason) VALUES ('${ids.prodB}', '${ids.whB}', '${ids.branchB}', 'adjustment', 'adjustment', 1, 'x')`);
  await row('inventory', `INSERT INTO public.inventory (product_id, warehouse_id, branch_id, quantity) VALUES ('${ids.prodA}', '${ids.whA}', '${ids.branchA}', 1)`,
      `INSERT INTO public.inventory (product_id, warehouse_id, branch_id, quantity) VALUES ('${ids.prodB}', '${ids.whB}', '${ids.branchB}', 1)`);
  await row('production_orders', `INSERT INTO public.production_orders (order_number, product_id, branch_id, warehouse_id, quantity) VALUES ('${uniq('PO')}', '${ids.prodA}', '${ids.branchA}', '${ids.whA}', 1)`,
      `INSERT INTO public.production_orders (order_number, product_id, branch_id, warehouse_id, quantity) VALUES ('${uniq('PO')}', '${ids.prodB}', '${ids.branchB}', '${ids.whB}', 1)`);
  await row('recipes', `INSERT INTO public.recipes (product_id, branch_id, name, yield_quantity) VALUES ('${ids.prodA}', '${ids.branchA}', 'R', 1)`,
      `INSERT INTO public.recipes (product_id, branch_id, name, yield_quantity) VALUES ('${ids.prodB}', '${ids.branchB}', 'R', 1)`);
  await row('warehouse_transfers', `INSERT INTO public.warehouse_transfers (transfer_number, from_warehouse_id, to_warehouse_id, branch_id, status) VALUES ('${uniq('WT')}', '${ids.whA}', '${ids.whB}', '${ids.branchA}', 'pending')`,
      `INSERT INTO public.warehouse_transfers (transfer_number, from_warehouse_id, to_warehouse_id, branch_id, status) VALUES ('${uniq('WT')}', '${ids.whA}', '${ids.whB}', '${ids.branchB}', 'pending')`);
  await row('chart_of_accounts', `INSERT INTO public.chart_of_accounts (branch_id, code, name, account_type) VALUES ('${ids.branchA}', '${uniq('RC')}', 'R', 'asset')`,
      `INSERT INTO public.chart_of_accounts (branch_id, code, name, account_type) VALUES ('${ids.branchB}', '${uniq('RC')}', 'R', 'asset')`);
  await row('account_mappings', `INSERT INTO public.account_mappings (branch_id, semantic_key, account_id) VALUES ('${ids.branchA}', '${uniq('SK')}', '${coaPoolA[0]}')`,
      `INSERT INTO public.account_mappings (branch_id, semantic_key, account_id) VALUES ('${ids.branchB}', '${uniq('SK')}', '${coaPoolB[0]}')`);
  await row('inventory_batches', `INSERT INTO public.inventory_batches (product_id, warehouse_id, branch_id, quantity, unit_cost, source_type) VALUES ('${ids.prodA}', '${ids.whA}', '${ids.branchA}', 5, 10, 'opening')`,
      `INSERT INTO public.inventory_batches (product_id, warehouse_id, branch_id, quantity, unit_cost, source_type) VALUES ('${ids.prodB}', '${ids.whB}', '${ids.branchB}', 5, 10, 'opening')`);
  await row('inventory_ledger', `INSERT INTO public.inventory_ledger (product_id, branch_id, warehouse_id, quantity, unit_cost, total_cost, entry_type, reference_number) VALUES ('${ids.prodA}', '${ids.branchA}', '${ids.whA}', 1, 10, 10, 'sale', '${uniq('IL')}')`,
      `INSERT INTO public.inventory_ledger (product_id, branch_id, warehouse_id, quantity, unit_cost, total_cost, entry_type, reference_number) VALUES ('${ids.prodB}', '${ids.branchB}', '${ids.whB}', 1, 10, 10, 'sale', '${uniq('IL')}')`);
  await row('customer_payments', `INSERT INTO public.customer_payments (customer_id, branch_id, amount, payment_method, reference_number) VALUES ('${ids.custA}', '${ids.branchA}', 10, 'cash', '${uniq('CP')}')`,
      `INSERT INTO public.customer_payments (customer_id, branch_id, amount, payment_method, reference_number) VALUES ('${ids.custB}', '${ids.branchB}', 10, 'cash', '${uniq('CP')}')`);
  await row('supplier_payments', `INSERT INTO public.supplier_payments (supplier_id, branch_id, amount, payment_method, reference_number) VALUES ('${ids.suppA}', '${ids.branchA}', 10, 'cash', '${uniq('SP')}')`,
      `INSERT INTO public.supplier_payments (supplier_id, branch_id, amount, payment_method, reference_number) VALUES ('${ids.suppB}', '${ids.branchB}', 10, 'cash', '${uniq('SP')}')`);
  await row('treasury_accounts', `INSERT INTO public.treasury_accounts (branch_id, account_id, account_type, account_name) VALUES ('${ids.branchA}', '${coaPoolA[1]}', 'cash', 'T')`,
      `INSERT INTO public.treasury_accounts (branch_id, account_id, account_type, account_name) VALUES ('${ids.branchB}', '${coaPoolB[1]}', 'cash', 'T')`);
  await row('treasury_transactions', `INSERT INTO public.treasury_transactions (branch_id, transaction_type, amount, reference_number) VALUES ('${ids.branchA}', 'deposit', 10, '${uniq('TT')}')`,
      `INSERT INTO public.treasury_transactions (branch_id, transaction_type, amount, reference_number) VALUES ('${ids.branchB}', 'deposit', 10, '${uniq('TT')}')`);
  await row('bank_reconciliations', `INSERT INTO public.bank_reconciliations (branch_id, treasury_account_id, statement_date, statement_balance, book_balance, difference, status) VALUES ('${ids.branchA}', '${ids.treasuryBankA}', CURRENT_DATE, 0, 0, 0, 'open')`,
      `INSERT INTO public.bank_reconciliations (branch_id, treasury_account_id, statement_date, statement_balance, book_balance, difference, status) VALUES ('${ids.branchB}', '${ids.treasuryBankB}', CURRENT_DATE, 0, 0, 0, 'open')`);
  await row('raw_material_inventory', `INSERT INTO public.raw_material_inventory (raw_material_id, branch_id, quantity, avg_cost) VALUES ('${ids.rm2}', '${ids.branchA}', 5, 10)`,
      `INSERT INTO public.raw_material_inventory (raw_material_id, branch_id, quantity, avg_cost) VALUES ('${ids.rm2}', '${ids.branchB}', 5, 10)`);
  await row('raw_material_batches', `INSERT INTO public.raw_material_batches (raw_material_id, branch_id, quantity, unit_cost, source_type) VALUES ('${ids.rm}', '${ids.branchA}', 5, 10, 'opening')`,
      `INSERT INTO public.raw_material_batches (raw_material_id, branch_id, quantity, unit_cost, source_type) VALUES ('${ids.rm}', '${ids.branchB}', 5, 10, 'opening')`);
  await row('production_waste', `INSERT INTO public.production_waste (order_id, branch_id, raw_material_id, quantity) VALUES ('${(await client.query<{ id: string }>(`INSERT INTO public.production_orders (order_number, product_id, branch_id, warehouse_id, quantity) VALUES ('${uniq('PO')}', '${ids.prodA}', '${ids.branchA}', '${ids.whA}', 1) RETURNING id`)).rows[0].id}', '${ids.branchA}', '${ids.rm}', 1)`,
      `INSERT INTO public.production_waste (order_id, branch_id, raw_material_id, quantity) VALUES ('${(await client.query<{ id: string }>(`INSERT INTO public.production_orders (order_number, product_id, branch_id, warehouse_id, quantity) VALUES ('${uniq('PO')}', '${ids.prodB}', '${ids.branchB}', '${ids.whB}', 1) RETURNING id`)).rows[0].id}', '${ids.branchB}', '${ids.rm}', 1)`);
  await row('audit_log', `INSERT INTO public.audit_log (user_id, user_email, action, entity, entity_id, branch_id) VALUES ('${ids.users.cashier}', 'ca@rls.test', 'test', 'sale', null, '${ids.branchA}')`,
      `INSERT INTO public.audit_log (user_id, user_email, action, entity, entity_id, branch_id) VALUES ('${ids.users.cashier_b}', 'cb@rls.test', 'test', 'sale', null, '${ids.branchB}')`);
  await row('journal_entries', `INSERT INTO public.journal_entries (entry_number, branch_id, entry_date, description) VALUES ('${uniq('JE')}', '${ids.branchA}', CURRENT_DATE, 'rls')`,
      `INSERT INTO public.journal_entries (entry_number, branch_id, entry_date, description) VALUES ('${uniq('JE')}', '${ids.branchB}', CURRENT_DATE, 'rls')`);
  await row('dining_areas', `INSERT INTO public.dining_areas (name, branch_id) VALUES ('Area', '${ids.branchA}')`,
      `INSERT INTO public.dining_areas (name, branch_id) VALUES ('Area', '${ids.branchB}')`);
  await row('dining_tables', `INSERT INTO public.dining_tables (name, branch_id, capacity, status) VALUES ('T', '${ids.branchA}', 4, 'vacant')`,
      `INSERT INTO public.dining_tables (name, branch_id, capacity, status) VALUES ('T', '${ids.branchB}', 4, 'vacant')`);
  await row('orders', `INSERT INTO public.orders (order_number, branch_id, order_type, status) VALUES ('${uniq('ORD')}', '${ids.branchA}', 'dine_in', 'open')`,
      `INSERT INTO public.orders (order_number, branch_id, order_type, status) VALUES ('${uniq('ORD')}', '${ids.branchB}', 'dine_in', 'open')`);

  // branch_settings keys on branch_id (no surrogate id), so it cannot use the
  // RETURNING id helper above; insert it explicitly.
  R.branch_settings = {
    own: (await client.query<{ branch_id: string }>(
      `INSERT INTO public.branch_settings (branch_id, receipt_header) VALUES ($1, 'H') RETURNING branch_id`,
      [ids.branchA],
    )).rows[0].branch_id,
    other: (await client.query<{ branch_id: string }>(
      `INSERT INTO public.branch_settings (branch_id, receipt_header) VALUES ($1, 'H') RETURNING branch_id`,
      [ids.branchB],
    )).rows[0].branch_id,
  };

  ids.rows = R;

  // Child fixtures (no branch column; isolation goes through the parent).
  const child = async (key: string, ownSql: string, otherSql: string) => {
    R[key] = { own: await ins(client, ownSql), other: await ins(client, otherSql) };
  };

  await child('sale_items', `INSERT INTO public.sale_items (sale_id, product_id, unit_name, quantity, unit_price, total) VALUES ('${ids.saleA}', '${ids.prodA}', 'piece', 1, 20, 20)`,
      `INSERT INTO public.sale_items (sale_id, product_id, unit_name, quantity, unit_price, total) VALUES ('${ids.saleB}', '${ids.prodB}', 'piece', 1, 20, 20)`);
  await child('purchase_items', `INSERT INTO public.purchase_items (purchase_id, product_id, unit_name, quantity, unit_cost, total) VALUES ('${ids.purchA}', '${ids.prodA}', 'piece', 1, 10, 10)`,
      `INSERT INTO public.purchase_items (purchase_id, product_id, unit_name, quantity, unit_cost, total) VALUES ('${ids.purchB}', '${ids.prodB}', 'piece', 1, 10, 10)`);
  await child('shift_operations', `INSERT INTO public.shift_operations (shift_id, operation_type, amount, payment_method) VALUES ('${ids.shiftA}', 'opening', 0, 'cash')`,
      `INSERT INTO public.shift_operations (shift_id, operation_type, amount, payment_method) VALUES ('${ids.shiftB}', 'opening', 0, 'cash')`);
  await child('warehouse_transfer_items', `INSERT INTO public.warehouse_transfer_items (transfer_id, product_id, quantity) VALUES ('${R.warehouse_transfers.own}', '${ids.prodA}', 1)`,
      `INSERT INTO public.warehouse_transfer_items (transfer_id, product_id, quantity) VALUES ('${R.warehouse_transfers.other}', '${ids.prodB}', 1)`);
  await child('recipe_items', `INSERT INTO public.recipe_items (recipe_id, raw_material_id, quantity) VALUES ('${R.recipes.own}', '${ids.rm}', 1)`,
      `INSERT INTO public.recipe_items (recipe_id, raw_material_id, quantity) VALUES ('${R.recipes.other}', '${ids.rm}', 1)`);
  await child('journal_entry_lines', `INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit) VALUES ('${ids.jeA}', '${ids.coaCashA}', 0, 10)`,
      `INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit) VALUES ('${ids.jeB}', '${ids.coaCashB}', 0, 10)`);
  await child('bank_statement_lines', `INSERT INTO public.bank_statement_lines (reconciliation_id, statement_date, amount) VALUES ('${R.bank_reconciliations.own}', CURRENT_DATE, 100)`,
      `INSERT INTO public.bank_statement_lines (reconciliation_id, statement_date, amount) VALUES ('${R.bank_reconciliations.other}', CURRENT_DATE, 100)`);
  await child('order_items', `INSERT INTO public.order_items (order_id, product_id, unit_name, quantity, unit_price, total) VALUES ('${R.orders.own}', '${ids.prodA}', 'piece', 1, 10, 10)`,
      `INSERT INTO public.order_items (order_id, product_id, unit_name, quantity, unit_price, total) VALUES ('${R.orders.other}', '${ids.prodB}', 'piece', 1, 10, 10)`);

  return ids;
}

export interface RunResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  error?: string;
}

// Runs one statement as `userId` (role authenticated + app.user_id GUC).
// Every run is isolated in a savepoint; results never persist.
export async function runAs(client: pg.Client, userId: string, sql: string, params: unknown[] = []): Promise<RunResult> {
  await client.query('SAVEPOINT rls_run');
  await client.query('SELECT set_config($1, $2, true)', ['app.user_id', userId]);
  await client.query('SET LOCAL ROLE authenticated');
  try {
    const res = await client.query(sql, params);
    return { rows: res.rows as Array<Record<string, unknown>>, rowCount: res.rowCount ?? 0 };
  } catch (e: unknown) {
    return { rows: [], rowCount: 0, error: (e as Error).message };
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT rls_run').catch(() => {});
    await client.query('RESET ROLE').catch(() => {});
    await client.query('RESET app.user_id').catch(() => {});
    await client.query('RELEASE SAVEPOINT rls_run').catch(() => {});
  }
}

// Like runAs but WITHOUT the savepoint rollback: DML (e.g. SECURITY DEFINER
// RPCs) persists within the outer transaction. Cleanup still resets role/GUC.
export async function runAsPersist(client: pg.Client, userId: string, sql: string, params: unknown[] = []): Promise<RunResult> {
  await client.query('SELECT set_config($1, $2, true)', ['app.user_id', userId]);
  await client.query('SET LOCAL ROLE authenticated');
  try {
    const res = await client.query(sql, params);
    return { rows: res.rows as Array<Record<string, unknown>>, rowCount: res.rowCount ?? 0 };
  } catch (e: unknown) {
    return { rows: [], rowCount: 0, error: (e as Error).message };
  } finally {
    await client.query('RESET ROLE').catch(() => {});
    await client.query('RESET app.user_id').catch(() => {});
  }
}

// True when the connected DB is the CI stub (auth.uid() driven by app.user_id).
export async function canImpersonate(client: pg.Client): Promise<boolean> {
  await client.query('SAVEPOINT rls_probe');
  try {
    const probe = '00000000-0000-0000-0000-000000000000';
    await client.query('SELECT set_config($1, $2, true)', ['app.user_id', probe]);
    const r = await client.query('SELECT auth.uid() AS uid');
    return r.rows[0].uid === probe;
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT rls_probe').catch(() => {});
    await client.query('RESET app.user_id').catch(() => {});
    await client.query('RELEASE SAVEPOINT rls_probe').catch(() => {});
  }
}
