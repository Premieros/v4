import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDbUrl, openDb } from './db';
import { runAs, seedRlsFixture, canImpersonate } from './rls';
import type { RlsIds } from './rls';
import type pg from 'pg';

const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('Phase 3 — Full Tenant Data Isolation', () => {
  let client: pg.Client;
  let canImp: boolean;
  let ids: RlsIds;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    canImp = await canImpersonate(client);
    if (canImp) {
      ids = await seedRlsFixture(client);
    }
  });

  afterAll(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  // ── Helper: assert cross-tenant isolation for a table ─────────────────

  const crossTenant = (table: string, ownKey: string) => {
    it(`${table}: cashier (orgA only) sees only org A rows, not org B`, async () => {
      if (!canImp) return;
      const ownId = ids.rows[ownKey].own;
      const otherId = ids.rows[ownKey].other;

      // Cashier (orgA only) sees their own row
      const own = await runAs(client, ids.users.cashier,
        `SELECT id FROM public.${table} WHERE id = $1`, [ownId]);
      expect(own.rows).toHaveLength(1);

      // Cashier does NOT see orgB row
      const other = await runAs(client, ids.users.cashier,
        `SELECT id FROM public.${table} WHERE id = $1`, [otherId]);
      expect(other.rows).toHaveLength(0);
    });
  };

  const crossTenantSuperAdmin = (table: string, ownKey: string) => {
    it(`${table}: super_admin sees all rows`, async () => {
      if (!canImp) return;
      const ownId = ids.rows[ownKey].own;
      const otherId = ids.rows[ownKey].other;

      const res = await runAs(client, ids.users.super_admin,
        `SELECT id FROM public.${table} WHERE id::text = ANY($1)`, [[ownId, otherId]]);
      expect(res.rows).toHaveLength(2);
    });
  };

  // ── Core business tables ─────────────────────────────────────────────

  for (const tbl of ['products', 'categories', 'warehouses', 'customers', 'suppliers', 'expenses']) {
    crossTenant(tbl, tbl);
    crossTenantSuperAdmin(tbl, tbl);
  }

  // ── Transaction tables ───────────────────────────────────────────────

  for (const tbl of ['sales', 'purchases', 'stock_transactions']) {
    crossTenant(tbl, tbl);
    crossTenantSuperAdmin(tbl, tbl);
  }

  // ── Accounting tables ────────────────────────────────────────────────

  for (const tbl of ['chart_of_accounts', 'account_mappings', 'customer_payments', 'supplier_payments',
    'treasury_accounts', 'treasury_transactions', 'bank_reconciliations']) {
    crossTenant(tbl, tbl);
    crossTenantSuperAdmin(tbl, tbl);
  }

  // ── Manufacturing tables ─────────────────────────────────────────────

  for (const tbl of ['raw_material_inventory', 'raw_material_batches', 'inventory_batches', 'inventory_ledger',
    'production_orders', 'recipes', 'warehouse_transfers', 'production_waste']) {
    crossTenant(tbl, tbl);
    crossTenantSuperAdmin(tbl, tbl);
  }

  // ── Floorplan tables ─────────────────────────────────────────────────

  for (const tbl of ['dining_areas', 'dining_tables', 'orders']) {
    crossTenant(tbl, tbl);
    crossTenantSuperAdmin(tbl, tbl);
  }

  // ── Other branch-scoped tables ───────────────────────────────────────

  for (const tbl of ['audit_log', 'journal_entries']) {
    crossTenant(tbl, tbl);
    crossTenantSuperAdmin(tbl, tbl);
  }

  it('branch_settings: cross-tenant isolation', async () => {
    if (!canImp) return;
    const own = ids.rows.branch_settings.own;
    const other = ids.rows.branch_settings.other;

    const rOwn = await runAs(client, ids.users.cashier,
      `SELECT branch_id FROM public.branch_settings WHERE branch_id = $1`, [own]);
    expect(rOwn.rows).toHaveLength(1);

    const rOther = await runAs(client, ids.users.cashier,
      `SELECT branch_id FROM public.branch_settings WHERE branch_id = $1`, [other]);
    expect(rOther.rows).toHaveLength(0);
  });

  // ── Child tables: cross-tenant via parent JOIN ───────────────────────

  const childTables = [
    { table: 'journal_entry_lines',  ownKey: 'journal_entry_lines' },
    { table: 'bank_statement_lines', ownKey: 'bank_statement_lines' },
    { table: 'shift_operations',     ownKey: 'shift_operations' },
    { table: 'warehouse_transfer_items', ownKey: 'warehouse_transfer_items' },
    { table: 'recipe_items',         ownKey: 'recipe_items' },
    { table: 'order_items',          ownKey: 'order_items' },
  ];

  for (const { table, ownKey } of childTables) {
    crossTenant(table, ownKey);
    crossTenantSuperAdmin(table, ownKey);
  }

  // ── Write isolation: cashier A cannot INSERT into tenant B ─────────────

  it('products: cashier cannot INSERT into tenant B branch', async () => {
    if (!canImp) return;
    const res = await runAs(client, ids.users.cashier,
      `INSERT INTO public.products (name, branch_id, cost_price, sale_price, is_active)
       VALUES ('hack', $1, 1, 2, true)`, [ids.branchB]);
    expect(res.error).toBeTruthy();
  });

  it('sales: cashier cannot INSERT into tenant B branch', async () => {
    if (!canImp) return;
    const res = await runAs(client, ids.users.cashier,
      `INSERT INTO public.sales (invoice_number, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status)
       VALUES ('INV-HACK', $1, $2, 0, 0, 0, 0, 0, 'cash', 'completed')`,
      [ids.branchB, ids.whB]);
    expect(res.error).toBeTruthy();
  });

  it('purchases: cashier cannot INSERT into tenant B branch', async () => {
    if (!canImp) return;
    const res = await runAs(client, ids.users.cashier,
      `INSERT INTO public.purchases (invoice_number, supplier_id, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status)
       VALUES ('PINV-HACK', $1, $2, $3, 0, 0, 0, 0, 0, 'cash', 'completed')`,
      [ids.suppB, ids.branchB, ids.whB]);
    expect(res.error).toBeTruthy();
  });

  // ── Branch Manager in A: restricted to org A ─────────────────────────

  it('branch_manager in A: cannot read tenant B branches', async () => {
    if (!canImp) return;
    const res = await runAs(client, ids.users.branch_manager,
      `SELECT id FROM public.branches WHERE id = $1`, [ids.branchB]);
    expect(res.rows).toHaveLength(0);
  });

  it('branch_manager in A: cannot INSERT products into tenant B', async () => {
    if (!canImp) return;
    const res = await runAs(client, ids.users.branch_manager,
      `INSERT INTO public.products (name, branch_id, cost_price, sale_price, is_active)
       VALUES ('hack', $1, 1, 2, true)`, [ids.branchB]);
    expect(res.error).toBeTruthy();
  });

  it('branch_manager in A: CAN INSERT products into own branch', async () => {
    if (!canImp) return;
    const res = await runAs(client, ids.users.branch_manager,
      `INSERT INTO public.products (name, branch_id, cost_price, sale_price, is_active)
       VALUES ('bm-prod', $1, 1, 2, true)`, [ids.branchA]);
    expect(res.error).toBeUndefined();
  });

  // ── Super admin: full access ─────────────────────────────────────────

  it('super_admin: can read all branches', async () => {
    if (!canImp) return;
    const res = await runAs(client, ids.users.super_admin,
      `SELECT id FROM public.branches ORDER BY name`);
    expect(res.error).toBeUndefined();
    const branchIds = res.rows.map(r => r.id as string);
    expect(branchIds).toContain(ids.branchA);
    expect(branchIds).toContain(ids.branchB);
  });

  it('super_admin: can read all products', async () => {
    if (!canImp) return;
    const res = await runAs(client, ids.users.super_admin,
      `SELECT id FROM public.products`);
    expect(res.error).toBeUndefined();
    const prodIds = res.rows.map(r => r.id as string);
    expect(prodIds).toContain(ids.rows.products.own);
    expect(prodIds).toContain(ids.rows.products.other);
  });

  it('super_admin: can INSERT into any branch', async () => {
    if (!canImp) return;
    const res = await runAs(client, ids.users.super_admin,
      `INSERT INTO public.products (name, branch_id, cost_price, sale_price, is_active)
       VALUES ('SA-prod', $1, 1, 2, true)`, [ids.branchB]);
    expect(res.error).toBeUndefined();
  });

  // ── user_may_access_branch: NULL branch_id ───────────────────────────

  it('user_may_access_branch: NULL branch_id requires platform admin', async () => {
    if (!canImp) return;
    const saRes = await runAs(client, ids.users.super_admin,
      `SELECT public.user_may_access_branch(NULL) AS ok`);
    expect(saRes.rows[0].ok).toBe(true);

    const owRes = await runAs(client, ids.users.owner,
      `SELECT public.user_may_access_branch(NULL) AS ok`);
    expect(owRes.rows[0].ok).toBe(false);
  });
});
