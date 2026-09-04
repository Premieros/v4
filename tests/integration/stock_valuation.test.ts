import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import type pg from 'pg';

// Integration tests for get_stock_valuation / get_stock_valuation_summary
// (migration 072, fixed by migration 076).
//
//   * The RPC signature must be (uuid, uuid) and SECURITY DEFINER.
//   * Admin (owner/super_admin) scope: p_branch_id NULL scans all branches;
//     a non-null p_branch_id filters to that branch.
//   * Branch-staff scope (regression for 076): the function must execute for a
//     non-admin caller (the 072 body raised "column reference branch_id is
//     ambiguous" on this exact path) and lock the caller to their own branch.
//   * Valuation math: quantity is the batch sum, unit_cost is the quantity
//     weighted-average batch cost, total_value = quantity * unit_cost.
//   * The summary returns one row per branch consistent with the valuation.
//
// Runs inside a single BEGIN..ROLLBACK transaction - safe against the live DB.
//
//   Run:  npm run test:integration
//   Skip: when no URL is configured

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('stock valuation RPC (072/076)', () => {
  let client: pg.Client;

  const branchA = randomUUID();
  const branchB = randomUUID();
  const whA = randomUUID();
  const whB = randomUUID();
  const prodA = randomUUID();
  const prodB = randomUUID();
  const ownerId = randomUUID();
  const cashierId = randomUUID();

  async function asUser<T>(userId: string, role: 'authenticated' | 'anon' = 'authenticated', fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    await client.query(`SET LOCAL ROLE ${role}`);
    try {
      return await fn();
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  interface ValRow {
    product_id: string;
    product_name: string;
    warehouse_id: string;
    branch_id: string;
    quantity: string;
    unit_cost: string;
    total_value: string;
  }
  interface SumRow {
    branch_id: string;
    branch_name: string;
    total_quantity: string;
    total_value: string;
    item_count: string;
  }

  const valuation = (branchId: string | null, warehouseId: string | null) =>
    client.query<ValRow>(
      `SELECT product_id, product_name, warehouse_id, branch_id,
              quantity::text AS quantity, unit_cost::text AS unit_cost,
              total_value::text AS total_value
       FROM public.get_stock_valuation($1, $2)`,
      [branchId, warehouseId],
    );

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);

    const orgId = randomUUID();
    await client.query(`INSERT INTO public.organizations (id, name, slug) VALUES ($1, $2, $3)`, [orgId, 'SV Org', `sv-${randomUUID().slice(0, 8)}`]);
    await client.query(`INSERT INTO public.branches (id, name, organization_id) VALUES ($1, $2, $3)`, [branchA, 'Branch A', orgId]);
    await client.query(`INSERT INTO public.branches (id, name, organization_id) VALUES ($1, $2, $3)`, [branchB, 'Branch B', orgId]);
    await client.query(`INSERT INTO public.warehouses (id, name, branch_id, is_active) VALUES ($1, $2, $3, true)`, [whA, 'WH A', branchA]);
    await client.query(`INSERT INTO public.warehouses (id, name, branch_id, is_active) VALUES ($1, $2, $3, true)`, [whB, 'WH B', branchB]);
    await client.query(`INSERT INTO public.products (id, name, branch_id, sale_price, cost_price, is_active) VALUES ($1, $2, $3, 200, 100, true)`, [prodA, 'Product A', branchA]);
    await client.query(`INSERT INTO public.products (id, name, branch_id, sale_price, cost_price, is_active) VALUES ($1, $2, $3, 100, 50, true)`, [prodB, 'Product B', branchB]);

    // Branch A / prodA: two batches -> weighted-average unit cost = 75,
    // quantity = 20, total value = 1500.
    await client.query(
      `INSERT INTO public.inventory_batches (product_id, warehouse_id, branch_id, quantity, unit_cost, source_type)
       VALUES ($1, $2, $3, 10, 100, 'opening')`,
      [prodA, whA, branchA],
    );
    await client.query(
      `INSERT INTO public.inventory_batches (product_id, warehouse_id, branch_id, quantity, unit_cost, source_type)
       VALUES ($1, $2, $3, 10, 50, 'opening')`,
      [prodA, whA, branchA],
    );
    // Branch B / prodB: single batch -> unit cost 40, quantity 5, value 200.
    await client.query(
      `INSERT INTO public.inventory_batches (product_id, warehouse_id, branch_id, quantity, unit_cost, source_type)
       VALUES ($1, $2, $3, 5, 40, 'opening')`,
      [prodB, whB, branchB],
    );

    await client.query(
      `INSERT INTO public.users (id, email, full_name, role, branch_id, is_active)
       VALUES ($1, $2, $3, 'owner', NULL, true)`,
      [ownerId, `owner-${randomUUID()}@test.local`, 'Owner'],
    );
    await client.query(
      `INSERT INTO public.users (id, email, full_name, role, branch_id, is_active)
       VALUES ($1, $2, $3, 'cashier', $4, true)`,
      [cashierId, `cashier-${randomUUID()}@test.local`, 'Cashier A', branchA],
    );
    await client.query(`INSERT INTO public.organization_members (organization_id, user_id, membership_role, is_active) VALUES ($1, $2, 'owner', true), ($1, $3, 'member', true)`, [orgId, ownerId, cashierId]);
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }
  });

  it('exposes the expected (uuid, uuid) SECURITY DEFINER signatures', async () => {
    const r = await client.query<{ proname: string; identity_args: string; prosecdef: boolean }>(`
      SELECT p.proname,
             pg_get_function_identity_arguments(p.oid) AS identity_args,
             p.prosecdef
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('get_stock_valuation', 'get_stock_valuation_summary')
      ORDER BY p.proname
    `);
    const byName = new Map(r.rows.map((row) => [row.proname, row]));
    const v = byName.get('get_stock_valuation');
    const s = byName.get('get_stock_valuation_summary');
    expect(v).toBeTruthy();
    expect(s).toBeTruthy();
    expect(v!.identity_args).toBe('p_branch_id uuid, p_warehouse_id uuid');
    expect(s!.identity_args).toBe('p_branch_id uuid, p_warehouse_id uuid');
    expect(v!.prosecdef).toBe(true);
    expect(s!.prosecdef).toBe(true);
  });

  it('admin scope scans all branches and computes weighted-average valuation', async () => {
    const res = await asUser(ownerId, 'authenticated', () => valuation(null, null));
    const rows = res.rows;

    const a = rows.find((r) => r.product_id === prodA);
    const b = rows.find((r) => r.product_id === prodB);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a!.branch_id).toBe(branchA);
    expect(a!.quantity).toBe('20.0000');
    expect(Number(a!.unit_cost)).toBeCloseTo(75, 2);
    expect(Number(a!.total_value)).toBeCloseTo(1500, 2);
    expect(b!.branch_id).toBe(branchB);
    expect(b!.quantity).toBe('5.0000');
    expect(Number(b!.unit_cost)).toBeCloseTo(40, 2);
    expect(Number(b!.total_value)).toBeCloseTo(200, 2);
  });

  it('admin scope with p_branch_id filters to that branch', async () => {
    const res = await asUser(ownerId, 'authenticated', () => valuation(branchA, null));
    expect(res.rows.every((r) => r.branch_id === branchA)).toBe(true);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].product_id).toBe(prodA);
  });

  it('staff (non-admin) scope executes without ambiguity and is branch-locked (regression 076)', async () => {
    const res = await asUser(cashierId, 'authenticated', () => valuation(null, null));
    expect(res.rows.length).toBeGreaterThan(0);
    expect(res.rows.every((r) => r.branch_id === branchA)).toBe(true);
    expect(res.rows.every((r) => r.branch_id !== branchB)).toBe(true);
    expect(res.rows.find((r) => r.product_id === prodA)).toBeTruthy();
  });

  it('get_stock_valuation_summary returns per-branch totals consistent with the valuation', async () => {
    const res = await asUser(ownerId, 'authenticated', () =>
      client.query<SumRow>(
        `SELECT branch_id, branch_name,
                total_quantity::text AS total_quantity,
                total_value::text AS total_value,
                item_count::text AS item_count
         FROM public.get_stock_valuation_summary(NULL, NULL)`,
      ),
    );
    const a = res.rows.find((r) => r.branch_id === branchA);
    const b = res.rows.find((r) => r.branch_id === branchB);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a!.branch_name).toBe('Branch A');
    expect(Number(a!.total_quantity)).toBeCloseTo(20, 4);
    expect(Number(a!.total_value)).toBeCloseTo(1500, 2);
    expect(Number(a!.item_count)).toBe(1);
    expect(Number(b!.total_quantity)).toBeCloseTo(5, 4);
    expect(Number(b!.total_value)).toBeCloseTo(200, 2);
    expect(Number(b!.item_count)).toBe(1);
  });
});
