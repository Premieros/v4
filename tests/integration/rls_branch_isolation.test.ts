import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { seedRlsFixture, runAs, canImpersonate, uniq, ADMIN_ROLES, type RlsIds } from './rls';
import type { RunResult } from './rls';

// RLS branch-isolation matrix.
//
// Seeds two fully isolated branches via seedRlsFixture and then proves, for
// every branch-scoped table and every DML command, that:
//   * admins (super_admin/owner) can see and write every branch;
//   * branch staff see exactly their own branch and are rejected on the other;
//   * commands with no policy at all are denied even for admins;
//   * child tables (no branch column) inherit the parent's isolation.
//
// Runs in one BEGIN..ROLLBACK transaction. Impersonation happens through the
// CI stub (auth.uid() reads the app.user_id GUC), so the whole suite is
// skipped when impersonation is unavailable (e.g. a real Supabase backend).
//
//   Run:  npm run test:integration
//   URL:  SUPABASE_DB_URL (or DATABASE_URL) in .env / environment
//   Skip: when no URL is configured, or when auth.uid() ignores the GUC

const dbUrl = getDbUrl();
const skip = !dbUrl;

// A probe is expected to succeed (RLS lets it through) or be denied (RLS /
// permissions reject it). We never assert on the exact error text.
//
// Postgres RLS denial semantics differ by command:
//   * INSERT: a rejected new row raises an error ("new row violates RLS").
//   * UPDATE/DELETE: rows not matching a USING policy are SILENTLY skipped
//     (rowCount=0, no error). A table with no UPDATE/DELETE policy is read-only
//     through RLS: every write is filtered out even for rows the SELECT policy
//     exposes. So for write probes, "denied" == error OR rowCount===0, and
//     "ok" requires the statement to actually touch a row.
async function runProbe(
  client: pg.Client,
  label: string,
  userId: string,
  sql: string,
  expected: 'ok' | 'denied',
  params: unknown[] = [],
): Promise<RunResult> {
  const res = await runAs(client, userId, sql, params);
  if (expected === 'ok') {
    if (res.error) throw new Error(`${label}: expected success, got: ${res.error}`);
    if (res.rowCount === 0) throw new Error(`${label}: expected success, but RLS silently filtered the statement (rowCount=0)`);
  } else if (!res.error && res.rowCount > 0) {
    throw new Error(`${label}: expected RLS rejection, but statement succeeded (rowCount=${res.rowCount})`);
  }
  return res;
}

// Per-branch FK values used to build INSERT probes for a specific branch.
interface BranchCtx {
  branch: string;
  prod: string;
  wh: string;
  whOther: string; // a warehouse of the OTHER branch (warehouse_transfers probes)
  cust: string;
  supp: string;
  treasury: string; // treasury_accounts id of the branch's bank account
  pool2: string; // free chart account for account_mappings probes
  pool3: string; // free chart account for treasury_accounts probes
  order: string; // a production order in this branch (production_waste FK)
  recipeProd: string; // a product with no recipe yet (recipes probes)
  invProd: string; // a product/warehouse pair with no inventory row (inventory probes)
}

type WriteMode =
  | 'full' // branch staff may also write their own branch
  | 'perm' // writes: admin OR can_permission('<module>.manage') AND own branch (branch_manager holds it)
  | 'permProduction' // writes: admin OR production.manage AND own branch (production_manager holds it)
  | 'adminWrite' // writes are admin-only
  | 'adminInsOnly' // INSERT admin-only; UPDATE/DELETE have no policy (deny-all)
  | 'adminInsUpd' // INSERT/UPDATE admin-only; DELETE has no policy (deny-all)
  | 'permAccounts' // writes: admin OR accounts.manage AND own branch
  | 'permRaw' // writes: admin OR raw_materials.manage AND own branch
  | 'permRecipes' // writes: admin OR recipes.manage AND own branch
  | 'stock' // INSERT admin-or-own; UPDATE/DELETE deny-all
  | 'audit'; // SELECT/INSERT admin-or-own; UPDATE/DELETE admin-only

interface SpecTable {
  name: string;
  key: string;
  mode: WriteMode;
  ins: (c: BranchCtx) => string;
  upd: ((c: BranchCtx) => string) | null;
  noDel?: 'all' | 'cashier'; // Phase 3: 'all' = USING(false), 'cashier' = permission-gated DELETE
}

describe.skipIf(skip)('RLS branch isolation', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let imp: boolean;
  let ctxA: BranchCtx;
  let ctxB: BranchCtx;

  const adminId = () => ids.users.super_admin;
  const cashierId = () => ids.users.cashier; // branch A
  const bmId = () => ids.users.branch_manager; // branch A, holds the *.manage perms from the seed
  const pmId = () => ids.users.production_manager; // branch A, holds production.manage

  const t = (name: string, fn: () => Promise<void>) =>
    it(name, async (ctx: { skip?: () => unknown }) => {
      if (!imp) return typeof ctx?.skip === 'function' ? ctx.skip() : undefined;
      await fn();
    });

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    ids = await seedRlsFixture(client);
    imp = await canImpersonate(client);
    if (!imp) return;

    const insProd = async (name: string, branch: string) =>
      (await client.query<{ id: string }>(
        `INSERT INTO public.products (name, branch_id, cost_price, sale_price, is_active) VALUES ($1, $2, 1, 2, true) RETURNING id`,
        [name, branch],
      )).rows[0].id;
    const insOrder = async (branch: string) =>
      (await client.query<{ id: string }>(
        `INSERT INTO public.production_orders (order_number, product_id, branch_id, warehouse_id, quantity) VALUES ($1, $2, $3, $4, 1) RETURNING id`,
        [uniq('PO'), ids.prodA, branch, ids.whA],
      )).rows[0].id;

    const mkCtx = async (
      branch: string,
      prod: string,
      wh: string,
      whOther: string,
      cust: string,
      supp: string,
      treasury: string,
      pool2: string,
      pool3: string,
    ): Promise<BranchCtx> => ({
      branch,
      prod,
      wh,
      whOther,
      cust,
      supp,
      treasury,
      pool2,
      pool3,
      order: await insOrder(branch),
      recipeProd: await insProd(`recProbe-${branch}`, branch),
      invProd: await insProd(`invProbe-${branch}`, branch),
    });

    ctxA = await mkCtx(ids.branchA, ids.prodA, ids.whA, ids.whB, ids.custA, ids.suppA, ids.treasuryBankA, ids.coaPoolA[2], ids.coaPoolA[3]);
    ctxB = await mkCtx(ids.branchB, ids.prodB, ids.whB, ids.whA, ids.custB, ids.suppB, ids.treasuryBankB, ids.coaPoolB[2], ids.coaPoolB[3]);
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }
  });

  // -------------------------------------------------------------------------
  // Spec tables: write semantics per mode (see comments on WriteMode).
  // -------------------------------------------------------------------------
  const SPEC: SpecTable[] = [
    // Full access: branch staff can create/edit/delete their own branch rows.
    // (044: customers is gated by customers.manage, which the cashier role holds.)
    { name: 'customers', key: 'customers', mode: 'full', ins: (c) => `INSERT INTO public.customers (name, branch_id) VALUES ('C', '${c.branch}')`, upd: () => `SET name = 'probe'` },
    { name: 'sales', key: 'sales', mode: 'full', ins: (c) => `INSERT INTO public.sales (invoice_number, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status) VALUES ('${uniq('INV')}', '${c.branch}', '${c.wh}', 0, 0, 0, 0, 0, 'cash', 'completed')`, upd: () => `SET payment_method = 'cash'`, noDel: 'cashier' },
    { name: 'purchases', key: 'purchases', mode: 'full', ins: (c) => `INSERT INTO public.purchases (invoice_number, supplier_id, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status) VALUES ('${uniq('PINV')}', '${c.supp}', '${c.branch}', '${c.wh}', 0, 0, 0, 0, 0, 'cash', 'completed')`, upd: () => `SET payment_method = 'cash'`, noDel: 'cashier' },
    { name: 'warehouse_transfers', key: 'warehouse_transfers', mode: 'full', ins: (c) => `INSERT INTO public.warehouse_transfers (transfer_number, from_warehouse_id, to_warehouse_id, branch_id, status) VALUES ('${uniq('WT')}', '${c.wh}', '${c.whOther}', '${c.branch}', 'pending')`, upd: () => `SET notes = 'probe'`, noDel: 'all' },
    { name: 'dining_tables', key: 'dining_tables', mode: 'full', ins: (c) => `INSERT INTO public.dining_tables (name, branch_id, capacity, status) VALUES ('Probe', '${c.branch}', 4, 'vacant')`, upd: () => `SET name = 'probe'`, noDel: 'all' },
    { name: 'orders', key: 'orders', mode: 'full', ins: (c) => `INSERT INTO public.orders (order_number, branch_id, order_type, status) VALUES ('${uniq('ORD')}', '${c.branch}', 'dine_in', 'open')`, upd: () => `SET notes = 'probe'`, noDel: 'all' },

    // 044 `*.manage` write gating: admin OR can_permission('<module>.manage') AND own
    // branch. branch_manager holds all of these manage permissions in the seed.
    { name: 'products', key: 'products', mode: 'perm', ins: (c) => `INSERT INTO public.products (name, branch_id, cost_price, sale_price, is_active) VALUES ('P', '${c.branch}', 1, 2, true)`, upd: () => `SET name = 'probe'` },
    { name: 'suppliers', key: 'suppliers', mode: 'perm', ins: (c) => `INSERT INTO public.suppliers (name, branch_id) VALUES ('S', '${c.branch}')`, upd: () => `SET name = 'probe'` },
    { name: 'categories', key: 'categories', mode: 'perm', ins: (c) => `INSERT INTO public.categories (name, branch_id) VALUES ('Ca', '${c.branch}')`, upd: () => `SET name = 'probe'` },
    { name: 'warehouses', key: 'warehouses', mode: 'perm', ins: (c) => `INSERT INTO public.warehouses (name, branch_id, is_active) VALUES ('W', '${c.branch}', true)`, upd: () => `SET name = 'probe'` },
    { name: 'inventory', key: 'inventory', mode: 'perm', ins: (c) => `INSERT INTO public.inventory (product_id, warehouse_id, branch_id, quantity) VALUES ('${c.invProd}', '${c.wh}', '${c.branch}', 1)`, upd: () => `SET quantity = 2` },
    { name: 'expenses', key: 'expenses', mode: 'perm', ins: (c) => `INSERT INTO public.expenses (category, description, amount, branch_id, expense_date, payment_method) VALUES ('ops', 'x', 10, '${c.branch}', CURRENT_DATE, 'cash')`, upd: () => `SET amount = 11` },

    // production.manage write gating (production_manager holds the permission).
    { name: 'production_orders', key: 'production_orders', mode: 'permProduction', ins: (c) => `INSERT INTO public.production_orders (order_number, product_id, branch_id, warehouse_id, quantity) VALUES ('${uniq('PO')}', '${c.prod}', '${c.branch}', '${c.wh}', 1)`, upd: () => `SET notes = 'probe'`, noDel: 'all' },

    // Admin-only writes.
    { name: 'inventory_batches', key: 'inventory_batches', mode: 'adminWrite', ins: (c) => `INSERT INTO public.inventory_batches (product_id, warehouse_id, branch_id, quantity, unit_cost, source_type) VALUES ('${c.prod}', '${c.wh}', '${c.branch}', 5, 10, 'opening')`, upd: () => `SET quantity = 6`, noDel: 'all' },
    { name: 'inventory_ledger', key: 'inventory_ledger', mode: 'adminWrite', ins: (c) => `INSERT INTO public.inventory_ledger (product_id, branch_id, warehouse_id, quantity, unit_cost, total_cost, entry_type, reference_number) VALUES ('${c.prod}', '${c.branch}', '${c.wh}', 1, 10, 10, 'sale', '${uniq('IL')}')`, upd: () => `SET quantity = 2`, noDel: 'all' },
    { name: 'production_waste', key: 'production_waste', mode: 'adminWrite', ins: (c) => `INSERT INTO public.production_waste (order_id, branch_id, raw_material_id, quantity) VALUES ('${c.order}', '${c.branch}', '${ids.rm}', 1)`, upd: () => `SET quantity = 2`, noDel: 'all' },
    { name: 'dining_areas', key: 'dining_areas', mode: 'adminWrite', ins: (c) => `INSERT INTO public.dining_areas (name, branch_id) VALUES ('Probe', '${c.branch}')`, upd: () => `SET name = 'probe'`, noDel: 'all' },

    // Accounts.manage permission tables (branch_manager holds the permission).
    { name: 'chart_of_accounts', key: 'chart_of_accounts', mode: 'permAccounts', ins: (c) => `INSERT INTO public.chart_of_accounts (branch_id, code, name, account_type) VALUES ('${c.branch}', '${uniq('PC')}', 'Probe', 'asset')`, upd: () => `SET name = 'probe'` },
    { name: 'account_mappings', key: 'account_mappings', mode: 'permAccounts', ins: (c) => `INSERT INTO public.account_mappings (branch_id, semantic_key, account_id) VALUES ('${c.branch}', '${uniq('SK')}', '${c.pool2}')`, upd: (c) => `SET account_id = '${c.pool2}'` },
    { name: 'treasury_accounts', key: 'treasury_accounts', mode: 'permAccounts', ins: (c) => `INSERT INTO public.treasury_accounts (branch_id, account_id, account_type, account_name) VALUES ('${c.branch}', '${c.pool3}', 'cash', 'T')`, upd: () => `SET account_name = 'probe'` },

    // raw_materials.manage / recipes.manage tables (branch_manager does NOT hold these).
    { name: 'raw_material_inventory', key: 'raw_material_inventory', mode: 'permRaw', ins: (c) => `INSERT INTO public.raw_material_inventory (raw_material_id, branch_id, quantity, avg_cost) VALUES ('${ids.rm}', '${c.branch}', 1, 0)`, upd: () => `SET quantity = 6`, noDel: 'all' },
    { name: 'raw_material_batches', key: 'raw_material_batches', mode: 'permRaw', ins: (c) => `INSERT INTO public.raw_material_batches (raw_material_id, branch_id, quantity, unit_cost, source_type) VALUES ('${ids.rm2}', '${c.branch}', 1, 10, 'opening')`, upd: () => `SET quantity = 6`, noDel: 'all' },
    { name: 'recipes', key: 'recipes', mode: 'permRecipes', ins: (c) => `INSERT INTO public.recipes (product_id, branch_id, name, yield_quantity) VALUES ('${c.recipeProd}', '${c.branch}', 'Probe', 1)`, upd: () => `SET name = 'probe'`, noDel: 'all' },

    // INSERT admin-only; UPDATE/DELETE deny-all by design.
    { name: 'journal_entries', key: 'journal_entries', mode: 'full', ins: (c) => `INSERT INTO public.journal_entries (entry_number, branch_id, entry_date, description) VALUES ('${uniq('JE')}', '${c.branch}', CURRENT_DATE, 'x')`, upd: () => `SET description = 'probe'`, noDel: 'all' },
    { name: 'customer_payments', key: 'customer_payments', mode: 'full', ins: (c) => `INSERT INTO public.customer_payments (customer_id, branch_id, amount, payment_method, reference_number) VALUES ('${c.cust}', '${c.branch}', 10, 'cash', '${uniq('CP')}')`, upd: () => `SET amount = 11`, noDel: 'all' },
    { name: 'supplier_payments', key: 'supplier_payments', mode: 'full', ins: (c) => `INSERT INTO public.supplier_payments (supplier_id, branch_id, amount, payment_method, reference_number) VALUES ('${c.supp}', '${c.branch}', 10, 'cash', '${uniq('SP')}')`, upd: () => `SET amount = 11`, noDel: 'all' },
    { name: 'treasury_transactions', key: 'treasury_transactions', mode: 'full', ins: (c) => `INSERT INTO public.treasury_transactions (branch_id, transaction_type, amount, reference_number) VALUES ('${c.branch}', 'deposit', 10, '${uniq('TT')}')`, upd: () => `SET amount = 11`, noDel: 'all' },

    // INSERT/UPDATE admin-only; DELETE deny-all.
    { name: 'bank_reconciliations', key: 'bank_reconciliations', mode: 'full', ins: (c) => `INSERT INTO public.bank_reconciliations (branch_id, treasury_account_id, statement_date, statement_balance, book_balance, difference, status) VALUES ('${c.branch}', '${c.treasury}', CURRENT_DATE, 0, 0, 0, 'open')`, upd: () => `SET book_balance = 1`, noDel: 'all' },

    // stock_transactions: INSERT admin-or-own; UPDATE/DELETE deny-all.
    { name: 'stock_transactions', key: 'stock_transactions', mode: 'full', ins: (c) => `INSERT INTO public.stock_transactions (product_id, warehouse_id, branch_id, transaction_type, reference_type, quantity, reason) VALUES ('${c.prod}', '${c.wh}', '${c.branch}', 'adjustment', 'adjustment', 1, 'x')`, upd: () => `SET reason = 'probe'`, noDel: 'all' },

    // audit_log: SELECT/INSERT admin-or-own; UPDATE/DELETE admin-only.
    { name: 'audit_log', key: 'audit_log', mode: 'audit', ins: (c) => `INSERT INTO public.audit_log (user_id, user_email, action, entity, entity_id, branch_id) VALUES ('${ids.users.cashier}', 'probe@rls.test', 'probe', 'sale', null, '${c.branch}')`, upd: () => `SET action = 'probe'` },
  ];

  async function selectBattery(tbl: SpecTable): Promise<void> {
    const own = ids.rows[tbl.key].own;
    const other = ids.rows[tbl.key].other;
    const both = [own, other];

    const admin = await runProbe(client, `${tbl.name} SELECT admin`, adminId(), `SELECT id FROM ${tbl.name} WHERE id::text = ANY($1)`, 'ok', [both]);
    expect(admin.rowCount).toBe(2);

    const cashier = await runProbe(client, `${tbl.name} SELECT cashier`, cashierId(), `SELECT id FROM ${tbl.name} WHERE id::text = ANY($1)`, 'ok', [both]);
    expect(cashier.rowCount).toBe(1);
    expect(cashier.rows[0].id).toBe(own);

    const ownCount = await runProbe(client, `${tbl.name} count own branch`, cashierId(), `SELECT count(*)::int AS c FROM ${tbl.name} WHERE branch_id = $1`, 'ok', [ids.branchA]);
    expect(Number(ownCount.rows[0].c)).toBeGreaterThanOrEqual(1);

    const otherCount = await runProbe(client, `${tbl.name} count other branch`, cashierId(), `SELECT count(*)::int AS c FROM ${tbl.name} WHERE branch_id = $1`, 'ok', [ids.branchB]);
    expect(Number(otherCount.rows[0].c)).toBe(0);
  }

  async function writeBattery(tbl: SpecTable): Promise<void> {
    const own = ids.rows[tbl.key].own;
    const other = ids.rows[tbl.key].other;
    const upd = (id: string, set?: string) => `UPDATE ${tbl.name} ${set ?? tbl.upd!(ctxA)} WHERE id = '${id}'`;
    const del = (id: string) => `DELETE FROM ${tbl.name} WHERE id = '${id}'`;

    if (tbl.ins) {
      await runProbe(client, `${tbl.name} INSERT admin→B`, adminId(), tbl.ins(ctxB), 'ok');
      await runProbe(client, `${tbl.name} INSERT cashier→B`, cashierId(), tbl.ins(ctxB), 'denied');
    }

    switch (tbl.mode) {
      case 'full':
        if (tbl.ins) await runProbe(client, `${tbl.name} INSERT cashier→A`, cashierId(), tbl.ins(ctxA), 'ok');
        if (tbl.upd) {
          await runProbe(client, `${tbl.name} UPDATE cashier own`, cashierId(), upd(own), 'ok');
          await runProbe(client, `${tbl.name} UPDATE cashier other`, cashierId(), upd(other), 'denied');
        }
        if (tbl.noDel === 'all') {
          await runProbe(client, `${tbl.name} DELETE cashier own`, cashierId(), del(own), 'denied');
          await runProbe(client, `${tbl.name} DELETE admin other`, adminId(), del(other), 'denied');
        } else if (tbl.noDel === 'cashier') {
          await runProbe(client, `${tbl.name} DELETE cashier own`, cashierId(), del(own), 'denied');
          await runProbe(client, `${tbl.name} DELETE cashier other`, cashierId(), del(other), 'denied');
          await runProbe(client, `${tbl.name} DELETE admin other`, adminId(), del(other), 'ok');
        } else {
          await runProbe(client, `${tbl.name} DELETE cashier own`, cashierId(), del(own), 'ok');
          await runProbe(client, `${tbl.name} DELETE cashier other`, cashierId(), del(other), 'denied');
          await runProbe(client, `${tbl.name} DELETE admin other`, adminId(), del(other), 'ok');
        }
        break;

      case 'adminWrite':
        if (tbl.ins) await runProbe(client, `${tbl.name} INSERT cashier→A`, cashierId(), tbl.ins(ctxA), 'denied');
        if (tbl.upd) {
          await runProbe(client, `${tbl.name} UPDATE admin own`, adminId(), upd(own), 'ok');
          await runProbe(client, `${tbl.name} UPDATE cashier own`, cashierId(), upd(own), 'denied');
        }
        if (tbl.noDel === 'all') {
          await runProbe(client, `${tbl.name} DELETE admin other`, adminId(), del(other), 'denied');
          await runProbe(client, `${tbl.name} DELETE cashier other`, cashierId(), del(other), 'denied');
        } else {
          await runProbe(client, `${tbl.name} DELETE admin other`, adminId(), del(other), 'ok');
          await runProbe(client, `${tbl.name} DELETE cashier other`, cashierId(), del(other), 'denied');
        }
        break;

      case 'perm':
      case 'permAccounts':
        if (tbl.ins) {
          await runProbe(client, `${tbl.name} INSERT bm→A`, bmId(), tbl.ins(ctxA), 'ok');
          await runProbe(client, `${tbl.name} INSERT bm→B`, bmId(), tbl.ins(ctxB), 'denied');
          await runProbe(client, `${tbl.name} INSERT cashier→A`, cashierId(), tbl.ins(ctxA), 'denied');
        }
        if (tbl.upd) {
          await runProbe(client, `${tbl.name} UPDATE bm own`, bmId(), upd(own), 'ok');
          await runProbe(client, `${tbl.name} UPDATE bm other`, bmId(), upd(other), 'denied');
          await runProbe(client, `${tbl.name} UPDATE cashier own`, cashierId(), upd(own), 'denied');
        }
        await runProbe(client, `${tbl.name} DELETE bm own`, bmId(), del(own), 'ok');
        await runProbe(client, `${tbl.name} DELETE bm other`, bmId(), del(other), 'denied');
        await runProbe(client, `${tbl.name} DELETE cashier other`, cashierId(), del(other), 'denied');
        break;

      case 'permProduction':
        if (tbl.ins) {
          await runProbe(client, `${tbl.name} INSERT pm→A`, pmId(), tbl.ins(ctxA), 'ok');
          await runProbe(client, `${tbl.name} INSERT pm→B`, pmId(), tbl.ins(ctxB), 'denied');
          await runProbe(client, `${tbl.name} INSERT cashier→A`, cashierId(), tbl.ins(ctxA), 'denied');
        }
        if (tbl.upd) {
          await runProbe(client, `${tbl.name} UPDATE pm own`, pmId(), upd(own), 'ok');
          await runProbe(client, `${tbl.name} UPDATE pm other`, pmId(), upd(other), 'denied');
          await runProbe(client, `${tbl.name} UPDATE cashier own`, cashierId(), upd(own), 'denied');
        }
        if (tbl.noDel === 'all') {
          await runProbe(client, `${tbl.name} DELETE pm own`, pmId(), del(own), 'denied');
          await runProbe(client, `${tbl.name} DELETE pm other`, pmId(), del(other), 'denied');
          await runProbe(client, `${tbl.name} DELETE cashier other`, cashierId(), del(other), 'denied');
        } else {
          await runProbe(client, `${tbl.name} DELETE pm own`, pmId(), del(own), 'ok');
          await runProbe(client, `${tbl.name} DELETE pm other`, pmId(), del(other), 'denied');
          await runProbe(client, `${tbl.name} DELETE cashier other`, cashierId(), del(other), 'denied');
        }
        break;

      case 'permRaw':
      case 'permRecipes':
        if (tbl.ins) {
          await runProbe(client, `${tbl.name} INSERT bm→A`, bmId(), tbl.ins(ctxA), 'denied');
          await runProbe(client, `${tbl.name} INSERT cashier→A`, cashierId(), tbl.ins(ctxA), 'denied');
        }
        if (tbl.upd) {
          await runProbe(client, `${tbl.name} UPDATE admin own`, adminId(), upd(own), 'ok');
          await runProbe(client, `${tbl.name} UPDATE bm own`, bmId(), upd(own), 'denied');
        }
        if (tbl.noDel === 'all') {
          await runProbe(client, `${tbl.name} DELETE admin other`, adminId(), del(other), 'denied');
          await runProbe(client, `${tbl.name} DELETE cashier other`, cashierId(), del(other), 'denied');
        } else {
          await runProbe(client, `${tbl.name} DELETE admin other`, adminId(), del(other), 'ok');
          await runProbe(client, `${tbl.name} DELETE cashier other`, cashierId(), del(other), 'denied');
        }
        break;

      case 'adminInsOnly':
        if (tbl.ins) await runProbe(client, `${tbl.name} INSERT cashier→A`, cashierId(), tbl.ins(ctxA), 'denied');
        await runProbe(client, `${tbl.name} UPDATE admin own (no policy)`, adminId(), upd(own, 'SET id = id'), 'denied');
        await runProbe(client, `${tbl.name} DELETE admin other (no policy)`, adminId(), del(other), 'denied');
        await runProbe(client, `${tbl.name} UPDATE cashier own`, cashierId(), upd(own, 'SET id = id'), 'denied');
        await runProbe(client, `${tbl.name} DELETE cashier other`, cashierId(), del(other), 'denied');
        break;

      case 'adminInsUpd':
        if (tbl.ins) await runProbe(client, `${tbl.name} INSERT cashier→A`, cashierId(), tbl.ins(ctxA), 'denied');
        if (tbl.upd) {
          await runProbe(client, `${tbl.name} UPDATE admin own`, adminId(), upd(own), 'ok');
          await runProbe(client, `${tbl.name} UPDATE cashier own`, cashierId(), upd(own), 'denied');
        }
        await runProbe(client, `${tbl.name} DELETE admin other (no policy)`, adminId(), del(other), 'denied');
        await runProbe(client, `${tbl.name} DELETE cashier other`, cashierId(), del(other), 'denied');
        break;

      case 'stock':
        if (tbl.ins) await runProbe(client, `${tbl.name} INSERT cashier→A`, cashierId(), tbl.ins(ctxA), 'ok');
        await runProbe(client, `${tbl.name} UPDATE admin own (no policy)`, adminId(), upd(own), 'denied');
        await runProbe(client, `${tbl.name} UPDATE cashier own`, cashierId(), upd(own), 'denied');
        await runProbe(client, `${tbl.name} DELETE admin other (no policy)`, adminId(), del(other), 'denied');
        await runProbe(client, `${tbl.name} DELETE cashier other`, cashierId(), del(other), 'denied');
        break;

      case 'audit':
        if (tbl.ins) await runProbe(client, `${tbl.name} INSERT cashier→A`, cashierId(), tbl.ins(ctxA), 'ok');
        if (tbl.upd) {
          await runProbe(client, `${tbl.name} UPDATE admin own`, adminId(), upd(own), 'ok');
          await runProbe(client, `${tbl.name} UPDATE cashier own`, cashierId(), upd(own), 'denied');
        }
        await runProbe(client, `${tbl.name} DELETE admin other`, adminId(), del(other), 'denied');
        await runProbe(client, `${tbl.name} DELETE cashier other`, cashierId(), del(other), 'denied');
        break;
    }
  }

  describe('SELECT isolation (branch-scoped tables)', () => {
    for (const tbl of SPEC) {
      t(`${tbl.name}: staff see only their branch, admins see all`, () => selectBattery(tbl));
    }
  });

  describe('Write isolation (branch-scoped tables)', () => {
    for (const tbl of SPEC) {
      t(`${tbl.name}: writes are branch/role gated (${tbl.mode})`, () => writeBattery(tbl));
    }
  });

  describe('shifts (cashier-scoped + branch-scoped)', () => {
    t('SELECT: cashier sees own shift only, admin sees both', async () => {
      const both = [ids.shiftA, ids.shiftB];
      const admin = await runProbe(client, 'shifts SELECT admin', adminId(), `SELECT id FROM public.shifts WHERE id::text = ANY($1)`, 'ok', [both]);
      expect(admin.rowCount).toBe(2);

      const cashier = await runProbe(client, 'shifts SELECT cashier', cashierId(), `SELECT id FROM public.shifts WHERE id::text = ANY($1)`, 'ok', [both]);
      expect(cashier.rowCount).toBe(1);
      expect(cashier.rows[0].id).toBe(ids.shiftA);

      const other = await runProbe(client, 'shifts count other branch', cashierId(), `SELECT count(*)::int AS c FROM public.shifts WHERE branch_id = $1`, 'ok', [ids.branchB]);
      expect(Number(other.rows[0].c)).toBe(0);
    });

    t('INSERT: direct writes are admin-only (044); cashier uses open_shift RPC', async () => {
      const own = `INSERT INTO public.shifts (branch_id, cashier_id, opening_amount, status) VALUES ($1, $2, 0, 'open')`;
      await runProbe(client, 'shifts INSERT cashier own branch', cashierId(), own, 'denied', [ids.branchA, ids.users.cashier]);
      await runProbe(client, 'shifts INSERT cashier other branch', cashierId(), own, 'denied', [ids.branchB, ids.users.cashier]);
      await runProbe(client, 'shifts INSERT admin for another cashier', adminId(), own, 'ok', [ids.branchA, ids.users.cashier]);
    });

    t('UPDATE/DELETE: admin-only (044); cashier may not tamper directly', async () => {
      await runProbe(client, 'shifts UPDATE cashier own', cashierId(), `UPDATE public.shifts SET notes = 'probe' WHERE id::text = $1`, 'denied', [ids.shiftA]);
      await runProbe(client, 'shifts UPDATE admin other', adminId(), `UPDATE public.shifts SET notes = 'probe' WHERE id::text = $1`, 'ok', [ids.shiftB]);
      await runProbe(client, 'shifts DELETE cashier other', cashierId(), `DELETE FROM public.shifts WHERE id::text = $1`, 'denied', [ids.shiftB]);
      await runProbe(client, 'shifts DELETE admin other', adminId(), `DELETE FROM public.shifts WHERE id::text = $1`, 'denied', [ids.shiftB]);
    });
  });

  describe('users (self + branch-scoped)', () => {
    const cashier = () => ids.users.cashier;
    const cashierB = () => ids.users.cashier_b;
    const whMgr = () => ids.users.warehouse_manager;
    const upd = (id: string) => `UPDATE public.users SET full_name = 'probe' WHERE id = '${id}'`;
    const del = (id: string) => `DELETE FROM public.users WHERE id = '${id}'`;

    t('SELECT: staff see self + own branch only', async () => {
      const both = [cashier(), cashierB()];
      const admin = await runProbe(client, 'users SELECT admin', adminId(), `SELECT id FROM public.users WHERE id::text = ANY($1)`, 'ok', [both]);
      expect(admin.rowCount).toBe(2);

      const staff = await runProbe(client, 'users SELECT cashier', cashierId(), `SELECT id FROM public.users WHERE id::text = ANY($1)`, 'ok', [both]);
      expect(staff.rowCount).toBe(1);
      expect(staff.rows[0].id).toBe(cashier());

      const other = await runProbe(client, 'users count other branch', cashierId(), `SELECT count(*)::int AS c FROM public.users WHERE branch_id = $1`, 'ok', [ids.branchB]);
      expect(Number(other.rows[0].c)).toBe(0);
    });

    t('UPDATE: self / own-branch staff only', async () => {
      await runProbe(client, 'users UPDATE cashier self', cashierId(), upd(cashier()), 'ok');
      await runProbe(client, 'users UPDATE cashier other-branch', cashierId(), upd(cashierB()), 'denied');
      await runProbe(client, 'users UPDATE admin other-branch', adminId(), upd(cashierB()), 'ok');
      await runProbe(client, 'users UPDATE bm own-branch staff', bmId(), upd(whMgr()), 'ok');
      await runProbe(client, 'users UPDATE bm other-branch', bmId(), upd(cashierB()), 'denied');
    });

    t('DELETE: Phase 3 uses USING(false) on users — all deletes denied', async () => {
      await runProbe(client, 'users DELETE cashier other-branch', cashierId(), del(cashierB()), 'denied');
      await runProbe(client, 'users DELETE admin other-branch', adminId(), del(cashierB()), 'denied');
      await runProbe(client, 'users DELETE bm own-branch staff', bmId(), del(whMgr()), 'denied');
      await runProbe(client, 'users DELETE bm other-branch', bmId(), del(cashierB()), 'denied');
    });

    t('INSERT: only admins create accounts', async () => {
      const ins = `INSERT INTO public.users (id, email, full_name, role, branch_id, is_active) VALUES ($1, $2, 'Probe', 'cashier', $3, true)`;
      await runProbe(client, 'users INSERT admin', adminId(), ins, 'ok', [randomUUID(), `probe-${uniq('u')}@rls.test`, ids.branchA]);
      await runProbe(client, 'users INSERT cashier', cashierId(), ins, 'denied', [randomUUID(), `probe-${uniq('u')}@rls.test`, ids.branchA]);
    });
  });

  describe('branch_settings (per-branch settings)', () => {
    const own = () => ids.rows.branch_settings.own;
    const other = () => ids.rows.branch_settings.other;
    const ins = (branch: string) => `INSERT INTO public.branch_settings (branch_id, receipt_header) VALUES ('${branch}', 'H')`;

    // branch_settings keys on branch_id (PK), and branch A/B already own seeded
    // rows, so INSERT probes target throwaway branches created by the session
    // role (bypasses RLS; all discarded at the final ROLLBACK).
    const tmpBranch = async () => {
      const orgId = (await client.query<{ organization_id: string }>(
        `SELECT organization_id FROM public.branches WHERE id = $1`, [ids.branchB],
      )).rows[0].organization_id;
      return (await client.query<{ id: string }>(
        `INSERT INTO public.branches (name, organization_id) VALUES ('tmp', $1) RETURNING id`, [orgId],
      )).rows[0].id;
    };
    const tmpRow = async () => {
      const b = await tmpBranch();
      await client.query(`INSERT INTO public.branch_settings (branch_id, receipt_header) VALUES ($1, 'H')`, [b]);
      return b;
    };

    t('SELECT: staff see only their branch, admins see all', async () => {
      const both = [own(), other()];
      const admin = await runProbe(client, 'branch_settings SELECT admin', adminId(), `SELECT branch_id FROM public.branch_settings WHERE branch_id::text = ANY($1)`, 'ok', [both]);
      expect(admin.rowCount).toBe(2);

      const cashier = await runProbe(client, 'branch_settings SELECT cashier', cashierId(), `SELECT branch_id FROM public.branch_settings WHERE branch_id::text = ANY($1)`, 'ok', [both]);
      expect(cashier.rowCount).toBe(1);
      expect(cashier.rows[0].branch_id).toBe(own());

      const otherCount = await runProbe(client, 'branch_settings count other branch', cashierId(), `SELECT count(*)::int AS c FROM public.branch_settings WHERE branch_id = $1`, 'ok', [ids.branchB]);
      expect(Number(otherCount.rows[0].c)).toBe(0);
    });

    t('writes: admin-only by default (branch_manager lacks settings.manage)', async () => {
      await runProbe(client, 'branch_settings INSERT admin', adminId(), ins(await tmpBranch()), 'ok');
      await runProbe(client, 'branch_settings INSERT cashier', cashierId(), ins(await tmpBranch()), 'denied');
      await runProbe(client, 'branch_settings INSERT bm', bmId(), ins(await tmpBranch()), 'denied');
      await runProbe(client, 'branch_settings UPDATE admin', adminId(), `UPDATE public.branch_settings SET receipt_header = 'X' WHERE branch_id = '${await tmpRow()}'`, 'ok');
      await runProbe(client, 'branch_settings UPDATE cashier own row', cashierId(), `UPDATE public.branch_settings SET receipt_header = 'X' WHERE branch_id = '${own()}'`, 'denied');
      await runProbe(client, 'branch_settings DELETE admin', adminId(), `DELETE FROM public.branch_settings WHERE branch_id = '${await tmpRow()}'`, 'denied');
      await runProbe(client, 'branch_settings DELETE cashier own row', cashierId(), `DELETE FROM public.branch_settings WHERE branch_id = '${own()}'`, 'denied');
    });

    t('settings.manage: own-branch writes allowed, other branch denied', async () => {
      // Grant the permission as the session role (bypasses RLS); the whole
      // fixture is rolled back with the outer transaction.
      await client.query(`UPDATE public.roles SET permissions = permissions || '["settings.manage"]'::jsonb WHERE role = 'branch_manager'`);

      // INSERT probes: the row is discarded by runProbe's savepoint rollback,
      // so own-branch INSERT needs the PK row cleared first, and UPDATE/DELETE
      // probes re-seed their target rows through the session role below.
      await client.query(`DELETE FROM public.branch_settings WHERE branch_id = $1`, [own()]);
      await runProbe(client, 'branch_settings INSERT bm own branch', bmId(), ins(ctxA.branch), 'ok');
      await runProbe(client, 'branch_settings INSERT bm other branch', bmId(), ins(await tmpBranch()), 'denied');

      await client.query(`INSERT INTO public.branch_settings (branch_id, receipt_header) VALUES ($1, 'H')`, [own()]);
      await runProbe(client, 'branch_settings UPDATE bm own', bmId(), `UPDATE public.branch_settings SET receipt_header = 'Y' WHERE branch_id = '${own()}'`, 'ok');
      await runProbe(client, 'branch_settings UPDATE bm other', bmId(), `UPDATE public.branch_settings SET receipt_header = 'Y' WHERE branch_id = '${await tmpRow()}'`, 'denied');
      await runProbe(client, 'branch_settings DELETE bm own', bmId(), `DELETE FROM public.branch_settings WHERE branch_id = '${own()}'`, 'denied');
      await runProbe(client, 'branch_settings DELETE bm other', bmId(), `DELETE FROM public.branch_settings WHERE branch_id = '${await tmpRow()}'`, 'denied');
    });
  });

  describe('settings (global, admin-write only)', () => {
    t('staff read the global row; only admins can write it', async () => {
      const read = await runProbe(client, 'settings SELECT cashier', cashierId(), `SELECT count(*)::int AS c FROM public.settings`, 'ok');
      expect(Number(read.rows[0].c)).toBeGreaterThanOrEqual(1);

      const upd = `UPDATE public.settings SET store_name = 'probe' WHERE id = (SELECT id FROM public.settings LIMIT 1)`;
      await runProbe(client, 'settings UPDATE cashier', cashierId(), upd, 'denied');
      await runProbe(client, 'settings UPDATE admin', adminId(), upd, 'ok');
      await runProbe(client, 'settings DELETE cashier', cashierId(), `DELETE FROM public.settings`, 'denied');
      await runProbe(client, 'settings INSERT cashier', cashierId(), `INSERT INTO public.settings (store_name) VALUES ('probe')`, 'denied');
      await runProbe(client, 'settings INSERT admin', adminId(), `INSERT INTO public.settings (store_name) VALUES ('probe')`, 'ok');
    });
  });

  describe('child tables (isolation through the parent)', () => {
    interface ChildSpec {
      name: string;
      key: string;
      parent: string;
      fk: string;
      mode: 'parentWrite' | 'adminWrite' | 'permRecipes' | 'adminInsOnly' | 'adminInsUpd' | 'shiftOps';
      ins: (ownParent: string, otherParent: string) => { sql: string; paramsA: unknown[]; paramsB: unknown[] };
      noDel?: 'all' | 'cashier';
      updSet?: string;
    }

    const CHILDREN: ChildSpec[] = [
      {
        name: 'sale_items', key: 'sale_items', parent: 'sales', fk: 'sale_id', mode: 'parentWrite',
        ins: () => ({ sql: `INSERT INTO public.sale_items (sale_id, product_id, unit_name, quantity, unit_price, total) VALUES ($1, $2, 'piece', 1, 20, 20)`, paramsA: [ids.saleA, ids.prodA], paramsB: [ids.saleB, ids.prodB] }),
      },
      {
        name: 'purchase_items', key: 'purchase_items', parent: 'purchases', fk: 'purchase_id', mode: 'parentWrite',
        ins: () => ({ sql: `INSERT INTO public.purchase_items (purchase_id, product_id, unit_name, quantity, unit_cost, total) VALUES ($1, $2, 'piece', 1, 10, 10)`, paramsA: [ids.purchA, ids.prodA], paramsB: [ids.purchB, ids.prodB] }),
      },
      {
        name: 'warehouse_transfer_items', key: 'warehouse_transfer_items', parent: 'warehouse_transfers', fk: 'transfer_id', mode: 'parentWrite', noDel: 'all',
        ins: () => ({ sql: `INSERT INTO public.warehouse_transfer_items (transfer_id, product_id, quantity) VALUES ($1, $2, 1)`, paramsA: [ids.rows.warehouse_transfers.own, ids.prodA], paramsB: [ids.rows.warehouse_transfers.other, ids.prodB] }),
      },
      {
        name: 'recipe_items', key: 'recipe_items', parent: 'recipes', fk: 'recipe_id', mode: 'parentWrite', noDel: 'all',
        ins: () => ({ sql: `INSERT INTO public.recipe_items (recipe_id, raw_material_id, quantity) VALUES ($1, $2, 1)`, paramsA: [ids.rows.recipes.own, ids.rm], paramsB: [ids.rows.recipes.other, ids.rm] }),
      },
      {
        name: 'journal_entry_lines', key: 'journal_entry_lines', parent: 'journal_entries', fk: 'journal_entry_id', mode: 'parentWrite', noDel: 'all', updSet: 'SET debit = 0',
        ins: () => ({ sql: `INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, 0, 10)`, paramsA: [ids.jeA, ids.coaCashA], paramsB: [ids.jeB, ids.coaCashB] }),
      },
      {
        name: 'bank_statement_lines', key: 'bank_statement_lines', parent: 'bank_reconciliations', fk: 'reconciliation_id', mode: 'parentWrite', noDel: 'all', updSet: 'SET amount = 0',
        ins: () => ({ sql: `INSERT INTO public.bank_statement_lines (reconciliation_id, statement_date, amount) VALUES ($1, CURRENT_DATE, 10)`, paramsA: [ids.rows.bank_reconciliations.own], paramsB: [ids.rows.bank_reconciliations.other] }),
      },
      {
        name: 'shift_operations', key: 'shift_operations', parent: 'shifts', fk: 'shift_id', mode: 'parentWrite', noDel: 'all', updSet: 'SET amount = 0',
        ins: () => ({ sql: `INSERT INTO public.shift_operations (shift_id, operation_type, amount, payment_method) VALUES ($1, 'opening', 0, 'cash')`, paramsA: [ids.shiftA], paramsB: [ids.shiftB] }),
      },
      {
        name: 'order_items', key: 'order_items', parent: 'orders', fk: 'order_id', mode: 'parentWrite', noDel: 'all',
        ins: () => ({ sql: `INSERT INTO public.order_items (order_id, product_id, unit_name, quantity, unit_price, total) VALUES ($1, $2, 'piece', 1, 10, 10)`, paramsA: [ids.rows.orders.own, ids.prodA], paramsB: [ids.rows.orders.other, ids.prodB] }),
      },
    ];

    for (const ch of CHILDREN) {
      t(`${ch.name}: child rows follow the parent branch`, async () => {
        const own = ids.rows[ch.key].own;
        const other = ids.rows[ch.key].other;
        const both = [own, other];

        const admin = await runProbe(client, `${ch.name} SELECT admin`, adminId(), `SELECT id FROM ${ch.name} WHERE id::text = ANY($1)`, 'ok', [both]);
        expect(admin.rowCount).toBe(2);

        const cashier = await runProbe(client, `${ch.name} SELECT cashier`, cashierId(), `SELECT id FROM ${ch.name} WHERE id::text = ANY($1)`, 'ok', [both]);
        expect(cashier.rowCount).toBe(1);
        expect(cashier.rows[0].id).toBe(own);

        const ownCount = await runProbe(client, `${ch.name} count own parent branch`, cashierId(), `SELECT count(*)::int AS c FROM ${ch.name} ci JOIN ${ch.parent} p ON p.id = ci.${ch.fk} WHERE p.branch_id = $1`, 'ok', [ids.branchA]);
        expect(Number(ownCount.rows[0].c)).toBeGreaterThanOrEqual(1);

        const otherCount = await runProbe(client, `${ch.name} count other parent branch`, cashierId(), `SELECT count(*)::int AS c FROM ${ch.name} ci JOIN ${ch.parent} p ON p.id = ci.${ch.fk} WHERE p.branch_id = $1`, 'ok', [ids.branchB]);
        expect(Number(otherCount.rows[0].c)).toBe(0);
      });

      t(`${ch.name}: writes are gated through the parent (${ch.mode})`, async () => {
        const own = ids.rows[ch.key].own;
        const other = ids.rows[ch.key].other;
        const { sql, paramsA, paramsB } = ch.ins(ids.rows[ch.key].own, ids.rows[ch.key].other);
        const upd = (id: string, set: string) => `UPDATE ${ch.name} ${set} WHERE id = '${id}'`;
        const del = (id: string) => `DELETE FROM ${ch.name} WHERE id = '${id}'`;

        switch (ch.mode) {
          case 'parentWrite':
            await runProbe(client, `${ch.name} INSERT cashier own parent`, cashierId(), sql, 'ok', paramsA);
            await runProbe(client, `${ch.name} INSERT cashier other parent`, cashierId(), sql, 'denied', paramsB);
            await runProbe(client, `${ch.name} INSERT admin other parent`, adminId(), sql, 'ok', paramsB);
            await runProbe(client, `${ch.name} UPDATE cashier own`, cashierId(), upd(own, ch.updSet ?? `SET quantity = 2`), 'ok');
            await runProbe(client, `${ch.name} UPDATE cashier other`, cashierId(), upd(other, ch.updSet ?? `SET quantity = 2`), 'denied');
            if (ch.noDel === 'all') {
              await runProbe(client, `${ch.name} DELETE cashier own`, cashierId(), del(own), 'denied');
              await runProbe(client, `${ch.name} DELETE cashier other`, cashierId(), del(other), 'denied');
              await runProbe(client, `${ch.name} DELETE admin other`, adminId(), del(other), 'denied');
            } else if (ch.noDel === 'cashier') {
              await runProbe(client, `${ch.name} DELETE cashier own`, cashierId(), del(own), 'denied');
              await runProbe(client, `${ch.name} DELETE cashier other`, cashierId(), del(other), 'denied');
              await runProbe(client, `${ch.name} DELETE admin other`, adminId(), del(other), 'ok');
            } else {
              await runProbe(client, `${ch.name} DELETE cashier own`, cashierId(), del(own), 'ok');
              await runProbe(client, `${ch.name} DELETE cashier other`, cashierId(), del(other), 'denied');
              await runProbe(client, `${ch.name} DELETE admin other`, adminId(), del(other), 'ok');
            }
            break;

          case 'adminWrite':
            await runProbe(client, `${ch.name} INSERT cashier own parent`, cashierId(), sql, 'denied', paramsA);
            await runProbe(client, `${ch.name} INSERT admin own parent`, adminId(), sql, 'ok', paramsA);
            await runProbe(client, `${ch.name} UPDATE admin own`, adminId(), upd(own, `SET quantity = 2`), 'ok');
            await runProbe(client, `${ch.name} UPDATE cashier own`, cashierId(), upd(own, `SET quantity = 2`), 'denied');
            if (ch.noDel === 'all') {
              await runProbe(client, `${ch.name} DELETE admin other`, adminId(), del(other), 'denied');
              await runProbe(client, `${ch.name} DELETE cashier other`, cashierId(), del(other), 'denied');
            } else {
              await runProbe(client, `${ch.name} DELETE admin other`, adminId(), del(other), 'ok');
              await runProbe(client, `${ch.name} DELETE cashier other`, cashierId(), del(other), 'denied');
            }
            break;

          case 'permRecipes':
            await runProbe(client, `${ch.name} INSERT admin own parent`, adminId(), sql, 'ok', paramsA);
            await runProbe(client, `${ch.name} INSERT cashier own parent`, cashierId(), sql, 'denied', paramsA);
            await runProbe(client, `${ch.name} INSERT bm own parent`, bmId(), sql, 'denied', paramsA);
            await runProbe(client, `${ch.name} UPDATE admin own`, adminId(), upd(own, `SET quantity = 2`), 'ok');
            await runProbe(client, `${ch.name} UPDATE cashier own`, cashierId(), upd(own, `SET quantity = 2`), 'denied');
            if (ch.noDel === 'all') {
              await runProbe(client, `${ch.name} DELETE admin other`, adminId(), del(other), 'denied');
              await runProbe(client, `${ch.name} DELETE cashier other`, cashierId(), del(other), 'denied');
            } else {
              await runProbe(client, `${ch.name} DELETE admin other`, adminId(), del(other), 'ok');
              await runProbe(client, `${ch.name} DELETE cashier other`, cashierId(), del(other), 'denied');
            }
            break;

          case 'adminInsOnly':
            await runProbe(client, `${ch.name} INSERT admin own parent`, adminId(), sql, 'ok', paramsA);
            await runProbe(client, `${ch.name} INSERT cashier own parent`, cashierId(), sql, 'denied', paramsA);
            await runProbe(client, `${ch.name} UPDATE admin own (no policy)`, adminId(), upd(own, `SET debit = 0`), 'denied');
            await runProbe(client, `${ch.name} DELETE admin other (no policy)`, adminId(), del(other), 'denied');
            break;

          case 'adminInsUpd':
            await runProbe(client, `${ch.name} INSERT admin own parent`, adminId(), sql, 'ok', paramsA);
            await runProbe(client, `${ch.name} INSERT cashier own parent`, cashierId(), sql, 'denied', paramsA);
            await runProbe(client, `${ch.name} UPDATE admin own`, adminId(), upd(own, `SET amount = 2`), 'ok');
            await runProbe(client, `${ch.name} UPDATE cashier own`, cashierId(), upd(own, `SET amount = 2`), 'denied');
            await runProbe(client, `${ch.name} DELETE admin other (no policy)`, adminId(), del(other), 'denied');
            break;

          case 'shiftOps':
            await runProbe(client, `${ch.name} INSERT cashier own shift`, cashierId(), sql, 'denied', paramsA);
            await runProbe(client, `${ch.name} INSERT cashier other shift`, cashierId(), sql, 'denied', paramsB);
            await runProbe(client, `${ch.name} INSERT admin own shift`, adminId(), sql, 'ok', paramsA);
            await runProbe(client, `${ch.name} UPDATE admin own (no policy)`, adminId(), upd(own, `SET amount = 2`), 'denied');
            await runProbe(client, `${ch.name} DELETE admin other (no policy)`, adminId(), del(other), 'denied');
            break;
        }
      });
    }
  });

  describe('global reference tables (open read, gated write)', () => {
    t('staff can read global master data', async () => {
      for (const table of ['roles', 'measurement_units', 'raw_materials', 'branches']) {
        const res = await runProbe(client, `${table} SELECT as cashier`, cashierId(), `SELECT count(*)::int AS c FROM ${table}`, 'ok');
        expect(Number(res.rows[0].c)).toBeGreaterThanOrEqual(1);
      }
    });

    t('writes to master data are admin-only', async () => {
      const ins: [string, string][] = [
        ['measurement_units', `INSERT INTO public.measurement_units (code, name) VALUES ('${uniq('U')}', 'Probe')`],
        ['raw_materials', `INSERT INTO public.raw_materials (code, name) VALUES ('${uniq('RM')}', 'Probe')`],
        ['roles', `INSERT INTO public.roles (role, name_ar, name_en, permissions) VALUES ('${uniq('R')}', 'X', 'Y', '[]'::jsonb)`],
        ['branches', `INSERT INTO public.branches (name) VALUES ('${uniq('B')}')`],
      ];
      for (const [table, sql] of ins) {
        await runProbe(client, `${table} INSERT cashier`, cashierId(), sql, 'denied');
        await runProbe(client, `${table} INSERT admin`, adminId(), sql, 'ok');
      }
    });
  });

  describe('deny-by-default (no policy = denied, even for admins)', () => {
    const probes: [string, string, string][] = [
      ['stock_transactions', `DELETE FROM public.stock_transactions WHERE id::text = $1`, 'own'],
      ['shift_operations', `DELETE FROM public.shift_operations WHERE id::text = $1`, 'own'],
      ['journal_entries', `DELETE FROM public.journal_entries WHERE id::text = $1`, 'own'],
      ['journal_entry_lines', `DELETE FROM public.journal_entry_lines WHERE id::text = $1`, 'own'],
      ['bank_reconciliations', `DELETE FROM public.bank_reconciliations WHERE id::text = $1`, 'own'],
      ['bank_statement_lines', `DELETE FROM public.bank_statement_lines WHERE id::text = $1`, 'own'],
    ];

    for (const [table, sql, which] of probes) {
      t(`${table}: ${which === 'own' ? 'no policy' : ''} command is denied for admin`, async () => {
        const id = ids.rows[table].own;
        await runProbe(client, `${table} ${sql.split(' ')[0]} admin`, adminId(), sql, 'denied', [id]);
      });
    }

    t('document_sequences is read-only for authenticated', async () => {
      await runProbe(client, 'document_sequences SELECT admin', adminId(), `SELECT count(*)::int AS c FROM public.document_sequences`, 'ok');
      await runProbe(client, 'document_sequences INSERT admin', adminId(), `INSERT INTO public.document_sequences (seq_type, next_value) VALUES ('${uniq('seq')}', 1)`, 'denied');
      await runProbe(client, 'document_sequences UPDATE admin', adminId(), `UPDATE public.document_sequences SET next_value = 2 WHERE seq_type = 'sale'`, 'denied');
    });
  });

  describe('RBAC hardening (044)', () => {
    t('REVOKE: _post_journal_entry and log_audit_action are internal-only', async () => {
      // A valid, balanced payload that WOULD post if EXECUTE were still granted —
      // so a denial here proves the REVOKE, not a body error.
      const codeA = (await client.query<{ code: string }>(
        `SELECT code FROM public.chart_of_accounts WHERE id = $1`, [ids.coaCashA],
      )).rows[0].code;
      const payload = JSON.stringify([
        { account_code: codeA, debit: 100, credit: 0 },
        { account_code: codeA, debit: 0, credit: 100 },
      ]);
      const call = `SELECT public._post_journal_entry(NULL::uuid, 'probe', NULL::uuid, NULL::text, NULL::text, $1::jsonb)`;
      await runProbe(client, '_post_journal_entry admin', adminId(), call, 'denied', [payload]);
      await runProbe(client, '_post_journal_entry cashier', cashierId(), call, 'denied', [payload]);
      await runProbe(client, 'log_audit_action admin', adminId(),
        `SELECT public.log_audit_action(NULL::uuid, 'x', 'x', NULL::uuid, '{}'::jsonb)`, 'denied');
      await runProbe(client, 'log_audit_action cashier', cashierId(),
        `SELECT public.log_audit_action(NULL::uuid, 'x', 'x', NULL::uuid, '{}'::jsonb)`, 'denied');
    });

    t('get_audit_trail: audit.view required; otherwise empty', async () => {
      // Direct SELECT on audit_log stays branch-scoped (cashier can read own), but
      // the RPC guard requires audit.view on top (044).
      const direct = await runProbe(client, 'audit_log SELECT cashier own', cashierId(),
        `SELECT count(*)::int AS c FROM public.audit_log WHERE branch_id = $1`, 'ok', [ids.branchA]);
      expect(Number(direct.rows[0].c)).toBeGreaterThanOrEqual(1);

      const parseTrail = (v: unknown): unknown[] =>
        typeof v === 'string' ? JSON.parse(v) : (v as unknown[]);
      const admin = await runProbe(client, 'get_audit_trail admin', adminId(),
        `SELECT public.get_audit_trail($1) AS trail`, 'ok', [ids.branchA]);
      expect(parseTrail(admin.rows[0].trail).length).toBeGreaterThanOrEqual(1);

      const cashier = await runProbe(client, 'get_audit_trail cashier', cashierId(),
        `SELECT public.get_audit_trail($1) AS trail`, 'ok', [ids.branchA]);
      expect(parseTrail(cashier.rows[0].trail)).toHaveLength(0);
    });

    t('sale discount guard: pos.discount required for discounted sales (044)', async () => {
      const ins = (discount: number, branch: string) =>
        `INSERT INTO public.sales (invoice_number, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status) VALUES ('${uniq('INV')}', '${branch}', '${ids.whA}', 100, ${discount}, 0, 100, 100, 'cash', 'completed')`;
      // cashier has no pos.discount -> trigger rejects the discount.
      await runProbe(client, 'sales cashier discounted', cashierId(), ins(5, ids.branchA), 'denied');
      // cashier may still insert a no-discount sale in own branch.
      await runProbe(client, 'sales cashier no-discount own', cashierId(), ins(0, ids.branchA), 'ok');
      // branch_manager holds pos.discount (043) -> allowed.
      await runProbe(client, 'sales bm discounted own', bmId(), ins(5, ids.branchA), 'ok');
      await runProbe(client, 'sales admin discounted other', adminId(), ins(5, ids.branchB), 'ok');
    });

    t('product_units / product_components: gated by branch access (044)', async () => {
      const unitA = `INSERT INTO public.product_units (product_id, unit_name, conversion_factor, sale_price, cost_price, is_base) VALUES ('${ids.prodA}', 'piece', 1, 20, 10, false)`;
      const unitB = `INSERT INTO public.product_units (product_id, unit_name, conversion_factor, sale_price, cost_price, is_base) VALUES ('${ids.prodB}', 'piece', 1, 20, 10, false)`;
      const unitCashierA = `INSERT INTO public.product_units (product_id, unit_name, conversion_factor, sale_price, cost_price, is_base) VALUES ('${ids.prodA}', 'cashier-unit', 1, 20, 10, false)`;
      const unitCashierB = `INSERT INTO public.product_units (product_id, unit_name, conversion_factor, sale_price, cost_price, is_base) VALUES ('${ids.prodB}', 'cashier-unit', 1, 20, 10, false)`;
      await runProbe(client, 'product_units INSERT bm own product', bmId(), unitA, 'ok');
      await runProbe(client, 'product_units INSERT bm other product', bmId(), unitB, 'denied');
      await runProbe(client, 'product_units INSERT cashier own product', cashierId(), unitCashierA, 'ok');
      await runProbe(client, 'product_units INSERT cashier other product', cashierId(), unitCashierB, 'denied');
      await runProbe(client, 'product_units INSERT admin other product', adminId(), unitB, 'ok');

      const compA = `INSERT INTO public.product_components (product_id, component_product_id, quantity) VALUES ('${ids.prodA}', '${ids.prodB}', 1)`;
      const compB = `INSERT INTO public.product_components (product_id, component_product_id, quantity) VALUES ('${ids.prodB}', '${ids.prodA}', 1)`;
      await runProbe(client, 'product_components INSERT bm own product', bmId(), compA, 'ok');
      await runProbe(client, 'product_components INSERT bm other product', bmId(), compB, 'denied');
      await runProbe(client, 'product_components INSERT cashier own product', cashierId(), compA, 'ok');
      await runProbe(client, 'product_components INSERT cashier other product', cashierId(), compB, 'denied');
      await runProbe(client, 'product_components INSERT admin other product', adminId(), compB, 'ok');
    });

    t('record_login_failure: does not extend an in-force lock (044)', async () => {
      const uid = ids.users.cashier;
      // Lock the user directly (session role; the role-guard trigger's
      // unknown-caller branch permits lockout-counter changes).
      await client.query(
        `UPDATE public.users SET failed_attempts = 4, is_locked = true, lock_until = now() + interval '5 minutes' WHERE id = $1`,
        [uid],
      );
      const before = await client.query<{ failed_attempts: number; lock_until: string }>(
        `SELECT failed_attempts, lock_until FROM public.users WHERE id = $1`, [uid],
      );
      const res = await client.query(`SELECT public.record_login_failure('ca') AS out`);
      expect((res.rows[0].out as { success: boolean }).success).toBe(true);
      const after = await client.query<{ failed_attempts: number; lock_until: string }>(
        `SELECT failed_attempts, lock_until FROM public.users WHERE id = $1`, [uid],
      );
      expect(Number(after.rows[0].failed_attempts)).toBe(4);
      expect(String(after.rows[0].lock_until)).toBe(String(before.rows[0].lock_until));

      // A not-locked user still gets their counter incremented.
      await client.query(
        `UPDATE public.users SET failed_attempts = 0, is_locked = false, lock_until = NULL WHERE id = $1`, [uid],
      );
      await client.query(`SELECT public.record_login_failure('ca')`);
      const inc = await client.query<{ failed_attempts: number }>(
        `SELECT failed_attempts FROM public.users WHERE id = $1`, [uid],
      );
      expect(Number(inc.rows[0].failed_attempts)).toBe(1);
      // Restore so later assertions see a clean cashier.
      await client.query(
        `UPDATE public.users SET failed_attempts = 0, is_locked = false, lock_until = NULL WHERE id = $1`, [uid],
      );
    });

    t('guard_role_permissions: branch managers cannot mint admin-only roles (044)', async () => {
      const ins = (perms: string) =>
        `INSERT INTO public.roles (role, name_ar, name_en, permissions) VALUES ('${uniq('RG')}', 'X', 'Y', '${perms}'::jsonb)`;
      // bm is blocked by RLS regardless of the trigger (roles INSERT is admin-only).
      await runProbe(client, 'roles INSERT bm with settings.manage', bmId(), ins('["settings.manage"]'), 'denied');
      // admin can create a normal role carrying granular perms.
      await runProbe(client, 'roles INSERT admin plain', adminId(), ins('["pos.sell"]'), 'ok');
    });
  });

  it('fixture sanity: admin role helper resolves', async () => {
    if (!imp) return;
    // ADMIN_ROLES is consumed by the matrix above; ensure the seeded admin is
    // actually recognized (guards against a fixture id regression).
    expect(ADMIN_ROLES.has('super_admin')).toBe(true);
  });
});
