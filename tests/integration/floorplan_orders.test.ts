import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import type pg from 'pg';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('floor plan + open orders (036-039)', () => {
  let client: pg.Client;
  const branchA = randomUUID(); const branchB = randomUUID();
  const whA = randomUUID(); const whB = randomUUID();
  const prodA = randomUUID(); const prodB = randomUUID();
  const unitA = randomUUID(); const unitB = randomUUID();
  const tableA = randomUUID(); const tableB = randomUUID();
  const cashierA = randomUUID(); const cashierB = randomUUID();

  async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    await client.query(`SET LOCAL ROLE authenticated`);
    try { return await fn(); } finally { await client.query('RESET ROLE').catch(() => {}); await client.query('RESET app.user_id').catch(() => {}); }
  }

  const itemJson = (prodId: string, qty: number, price = 100) => JSON.stringify([{ product_id: prodId, unit_name: 'piece', quantity: qty, unit_price: price, discount_amount: 0, bonus_quantity: 0, total: qty * price }]);

  beforeAll(async () => {
    client = openDb(dbUrl!); await client.connect(); await client.query('BEGIN');
    await client.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');
    const orgId = randomUUID();
    await client.query(`INSERT INTO public.organizations (id, name, slug) VALUES ($1, $2, $3)`, [orgId, 'FP Org', `fp-${randomUUID().slice(0, 8)}`]);
  const seedBranch = async (branchId: string, whId: string, prodId: string, unitId: string, tableId: string, cashierId: string, name: string) => {
      await client.query(`INSERT INTO public.branches (id, name, organization_id) VALUES ($1, $2, $3)`, [branchId, name, orgId]);
      await client.query(`INSERT INTO public.warehouses (id, name, branch_id, is_active) VALUES ($1, $2, $3, true)`, [whId, `${name} WH`, branchId]);
      await client.query(`INSERT INTO public.products (id, name, branch_id, sale_price, cost_price, is_active) VALUES ($1, $2, $3, 100, 50, true)`, [prodId, `${name} Product`, branchId]);
      await client.query(`INSERT INTO public.inventory_units (id, code, name, unit_type, branch_id, cost_price, sale_price, is_active) VALUES ($1, $2, $3, 'ready', $4, 50, 100, true)`, [unitId, `U-${randomUUID()}`, `${name} Unit`, branchId]);
      await client.query(`INSERT INTO public.product_unit_links (product_id, unit_id, quantity) VALUES ($1, $2, 1)`, [prodId, unitId]);
      await client.query(`INSERT INTO public.inventory_unit_batches (unit_id, branch_id, warehouse_id, quantity, unit_cost) VALUES ($1, $2, $3, 10, 50)`, [unitId, branchId, whId]);
      await client.query(`INSERT INTO public.dining_tables (id, name, branch_id, capacity, status) VALUES ($1, $2, $3, 4, 'vacant')`, [tableId, 'T1', branchId]);
      await client.query(`INSERT INTO public.users (id, email, full_name, role, branch_id, is_active) VALUES ($1, $2, $3, 'cashier', $4, true)`, [cashierId, `fp-${randomUUID()}@test.local`, name, branchId]);
      await client.query(`INSERT INTO public.organization_members (organization_id, user_id, membership_role, is_active) VALUES ($1, $2, 'member', true)`, [orgId, cashierId]);
      await client.query(`INSERT INTO public.shifts (branch_id, cashier_id, opening_amount, status) VALUES ($1, $2, 0, 'open')`, [branchId, cashierId]);
      await client.query(`SELECT public.ensure_chart_of_accounts($1)`, [branchId]);
      await client.query(`SELECT public.seed_account_mappings($1)`, [branchId]);
    };
    await seedBranch(branchA, whA, prodA, unitA, tableA, cashierA, 'FP A');
    await seedBranch(branchB, whB, prodB, unitB, tableB, cashierB, 'FP B');
    await client.query(`UPDATE public.settings SET tax_enabled = false`);
  });

  afterAll(async () => { if (client) { await client.query('ROLLBACK').catch(() => {}); await client.end(); } });

  it('create_order opens a dine-in order and occupies the table', async () => {
    const r = await asUser(cashierA, () => client.query(`SELECT public.create_order($1, 'dine_in', $2, NULL, 4, NULL, $3::jsonb, 200, 0, 'amount', 0, 200) AS r`, [branchA, tableA, itemJson(prodA, 2)]));
    const order = r.rows[0].r; expect(order.success).toBe(true); if (!order.success) throw new Error(JSON.stringify(order));
    const o = await client.query(`SELECT status, order_type, order_number FROM public.orders WHERE id = $1`, [order.order_id]);
    expect(o.rows[0].status).toBe('open'); expect(o.rows[0].order_type).toBe('dine_in'); expect(String(o.rows[0].order_number)).toContain('-');
    expect((await client.query(`SELECT status FROM public.dining_tables WHERE id = $1`, [tableA])).rows[0].status).toBe('occupied');
    expect((await client.query(`SELECT count(*)::int AS c FROM public.order_items WHERE order_id = $1`, [order.order_id])).rows[0].c).toBe(1);
    const comp = await asUser(cashierA, () => client.query(`SELECT public.set_order_status($1, 'completed') AS r`, [order.order_id]));
    expect(comp.rows[0].r.success).toBe(true); expect((await client.query(`SELECT status FROM public.dining_tables WHERE id = $1`, [tableA])).rows[0].status).toBe('vacant');
  });

  it('process_sale stores order channel + table and settles a linked order', async () => {
    const created = await asUser(cashierA, () => client.query(`SELECT public.create_order($1, 'dine_in', $2, NULL, 2, NULL, $3::jsonb, 100, 0, 'amount', 0, 100) AS r`, [branchA, tableA, itemJson(prodA, 1)]));
    const order = created.rows[0].r; expect(order.success).toBe(true);
    const res = await asUser(cashierA, () => client.query(`SELECT public.process_sale($1, $2, $3, NULL, NULL, 0, 0, 'amount', 0, 0, 0, 100, 'cash', 'completed', $4::jsonb, NULL, 'dine_in', $5, $6) AS r`, [`FP-INV-${Date.now()}`, branchA, whA, itemJson(prodA, 1, 1), tableA, order.order_id]));
    const r = res.rows[0].r; expect(r.success).toBe(true); if (!r.success) throw new Error(JSON.stringify(r));
    const sale = await client.query(`SELECT order_type, table_id FROM public.sales WHERE id = $1`, [r.sale_id]);
    expect(sale.rows[0].order_type).toBe('dine_in'); expect(sale.rows[0].table_id).toBe(tableA);
    expect((await client.query(`SELECT status FROM public.orders WHERE id = $1`, [order.order_id])).rows[0].status).toBe('completed');
    expect((await client.query(`SELECT status FROM public.dining_tables WHERE id = $1`, [tableA])).rows[0].status).toBe('vacant');
  });

  it('RPCs are branch-gated: cross-branch access is rejected', async () => {
    const bad = await asUser(cashierB, () => client.query(`SELECT public.create_order($1, 'dine_in', $2, NULL, 2, NULL, $3::jsonb, 100, 0, 'amount', 0, 100) AS r`, [branchA, tableA, itemJson(prodA, 1)]));
    expect(bad.rows[0].r.success).toBe(false); expect(bad.rows[0].r.error).toBe('BRANCH_MISMATCH');
    const tb = await asUser(cashierA, () => client.query(`SELECT public.set_table_status($1, 'reserved') AS r`, [tableB]));
    expect(tb.rows[0].r.success).toBe(false); expect(tb.rows[0].r.error).toBe('BRANCH_MISMATCH');
    const ok = await asUser(cashierA, () => client.query(`SELECT public.set_table_status($1, 'reserved') AS r`, [tableA]));
    expect(ok.rows[0].r.success).toBe(true); expect((await client.query(`SELECT status FROM public.dining_tables WHERE id = $1`, [tableA])).rows[0].status).toBe('reserved');
  });
});