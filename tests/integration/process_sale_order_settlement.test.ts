import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import type pg from 'pg';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('process_sale linked-order settlement (045 C1)', () => {
  let client: pg.Client;
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const productId = randomUUID();
  const unitId = randomUUID();
  const tableId = randomUUID();

  const itemJson = (qty: number, price = 100) =>
    JSON.stringify([
      { product_id: productId, unit_name: 'piece', quantity: qty, unit_price: price, discount_amount: 0, bonus_quantity: 0, total: qty * price },
    ]);

  async function insertOrder(status: string, opts: { tableId?: string | null; branchId?: string; orderType?: string } = {}): Promise<string> {
    const r = await client.query<{ id: string }>(
      `INSERT INTO public.orders (order_number, branch_id, order_type, status, table_id, subtotal, discount_amount, tax_amount, total)
       VALUES ($1, $2, $3, $4, $5, 100, 0, 0, 100) RETURNING id`,
      [`ORD-${randomUUID()}`, opts.branchId ?? branchId, opts.orderType ?? 'takeaway', status, opts.tableId ?? null],
    );
    return r.rows[0].id;
  }

  async function settle(invoiceNumber: string, orderId: string | null, opts: { tableId?: string | null } = {}) {
    const res = await client.query<{ r: { success: boolean; error?: string; sale_id?: string; detail?: string } }>(
      `SELECT public.process_sale($1, $2, $3, NULL, NULL, 100, 0, 'amount', 0, 0, 100, 100, 'cash', 'completed',
         $4::jsonb, NULL, 'takeaway', $5, $6) AS r`,
      [invoiceNumber, branchId, warehouseId, itemJson(1), opts.tableId ?? null, orderId],
    );
    return res.rows[0].r;
  }

  async function saleCount(invoicePrefix: string): Promise<number> {
    const r = await client.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM public.sales WHERE invoice_number LIKE $1`,
      [`${invoicePrefix}%`],
    );
    return r.rows[0].c;
  }

  async function batchQty(): Promise<number> {
    const r = await client.query<{ q: string }>(
      `SELECT quantity::text AS q FROM public.inventory_unit_batches WHERE unit_id = $1 AND warehouse_id = $2`,
      [unitId, warehouseId],
    );
    return Number(r.rows[0].q);
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(`INSERT INTO public.branches (id, name) VALUES ($1, $2)`, [branchId, '045 C1 Branch']);
    await client.query(
      `INSERT INTO public.warehouses (id, name, branch_id, is_active) VALUES ($1, $2, $3, true)`,
      [warehouseId, '045 C1 Warehouse', branchId],
    );
    await client.query(
      `INSERT INTO public.products (id, name, branch_id, sale_price, cost_price, is_active) VALUES ($1, $2, $3, 100, 50, true)`,
      [productId, '045 C1 Product', branchId],
    );
    await client.query(
      `INSERT INTO public.inventory_units (id, code, name, unit_type, branch_id, cost_price, sale_price, is_active)
       VALUES ($1, $2, $3, 'ready', $4, 50, 100, true)`,
      [unitId, `U-${randomUUID()}`, '045 C1 Unit', branchId],
    );
    await client.query(
      `INSERT INTO public.product_unit_links (product_id, unit_id, quantity) VALUES ($1, $2, 1)`,
      [productId, unitId],
    );
    await client.query(
      `INSERT INTO public.inventory_unit_batches (unit_id, branch_id, warehouse_id, quantity, unit_cost)
       VALUES ($1, $2, $3, 10, 50)`,
      [unitId, branchId, warehouseId],
    );
    await client.query(
      `INSERT INTO public.dining_tables (id, name, branch_id, capacity, status) VALUES ($1, $2, $3, 4, 'vacant')`,
      [tableId, 'T1', branchId],
    );
    await client.query(`SELECT public.ensure_chart_of_accounts($1)`, [branchId]);
    await client.query(`SELECT public.seed_account_mappings($1)`, [branchId]);
    await client.query(`UPDATE public.settings SET tax_enabled = false`);
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }
  });

  it('pays a held takeaway order (table_id NULL)', async () => {
    const orderId = await insertOrder('held', { tableId: null, orderType: 'takeaway' });
    const before = await batchQty();

    const r = await settle(`045-TAK-${Date.now()}`, orderId);
    expect(r.success).toBe(true);
    if (!r.success) throw new Error(JSON.stringify(r));

    const order = await client.query(`SELECT status FROM public.orders WHERE id = $1`, [orderId]);
    expect(order.rows[0].status).toBe('completed');

    const sale = await client.query(
      `SELECT order_type, table_id FROM public.sales WHERE id = $1`,
      [r.sale_id],
    );
    expect(sale.rows[0].order_type).toBe('takeaway');
    expect(sale.rows[0].table_id).toBeNull();
    expect(await batchQty()).toBe(before - 1);
  });

  it('rejects a second payment of the same order WITHOUT writing a sale', async () => {
    const orderId = await insertOrder('held', { tableId: null, orderType: 'takeaway' });
    const beforeQty = await batchQty();

    const first = await settle(`045-DBL-${Date.now()}`, orderId);
    expect(first.success).toBe(true);

    const prefix = `045-DBL2-${Date.now()}`;
    const saleCountBefore = await saleCount(prefix);

    const second = await settle(prefix, orderId);
    expect(second.success).toBe(false);
    expect(second.error).toBe('ORDER_NOT_FOUND');
    expect(await saleCount(prefix)).toBe(saleCountBefore);
    expect(await batchQty()).toBe(beforeQty - 1);

    const order = await client.query(`SELECT status FROM public.orders WHERE id = $1`, [orderId]);
    expect(order.rows[0].status).toBe('completed');
  });

  it('rejects an order from another branch WITHOUT writing a sale', async () => {
    const otherBranch = randomUUID();
    await client.query(`INSERT INTO public.branches (id, name) VALUES ($1, $2)`, [otherBranch, '045 Other Branch']);
    const foreignOrderId = await insertOrder('held', { branchId: otherBranch, tableId: null });

    const prefix = `045-XBR-${Date.now()}`;
    const saleCountBefore = await saleCount(prefix);

    const r = await settle(prefix, foreignOrderId);
    expect(r.success).toBe(false);
    expect(r.error).toBe('ORDER_NOT_FOUND');
    expect(await saleCount(prefix)).toBe(saleCountBefore);

    const order = await client.query(`SELECT status FROM public.orders WHERE id = $1`, [foreignOrderId]);
    expect(order.rows[0].status).toBe('held');
  });

  it('frees the table when settling a held dine-in order', async () => {
    const orderId = await insertOrder('held', { tableId, orderType: 'dine_in' });
    await client.query(`UPDATE public.dining_tables SET status = 'occupied' WHERE id = $1`, [tableId]);

    const r = await settle(`045-DIN-${Date.now()}`, orderId, { tableId });
    expect(r.success).toBe(true);
    if (!r.success) throw new Error(JSON.stringify(r));

    const t = await client.query(`SELECT status FROM public.dining_tables WHERE id = $1`, [tableId]);
    expect(t.rows[0].status).toBe('vacant');
  });
});