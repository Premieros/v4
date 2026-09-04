import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import type pg from 'pg';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('Phase 1 — inventory units & order status split', () => {
  let client: pg.Client;
  const branchId = randomUUID();
  const whId = randomUUID();
  const rmId = randomUUID();
  const readyUnitId = randomUUID();
  const mfgUnitId = randomUUID();
  const productId = randomUUID();
  const orderId = randomUUID();
  const orderId2 = randomUUID();

  async function asAdmin<T>(fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [randomUUID()]);
    await client.query(`SET LOCAL ROLE service_role`);
    try {
      return await fn();
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await client.query(sql, params)).rows as T[];

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);

    await client.query(`INSERT INTO public.branches (id, name) VALUES ($1, $2)`, [branchId, 'Phase1 Test']);
    await client.query(`INSERT INTO public.warehouses (id, name, branch_id) VALUES ($1, $2, $3)`, [whId, 'WH', branchId]);
    await client.query(`INSERT INTO public.raw_materials (id, code, name, min_stock, default_cost, is_active, branch_id) VALUES ($1, 'RM-001', 'Flour', 0, 10, true, $2)`, [rmId, branchId]);
    await client.query(`INSERT INTO public.products (id, name, branch_id, product_type, sale_price, cost_price) VALUES ($1, $2, $3, 'ready', 25, 10)`, [productId, 'Burger', branchId]);
    await client.query(`INSERT INTO public.orders (id, order_number, branch_id, status) VALUES ($1, 'ORD-P1-001', $2, 'open')`, [orderId, branchId]);
    await client.query(`INSERT INTO public.orders (id, order_number, branch_id, status) VALUES ($1, 'ORD-P1-002', $2, 'open')`, [orderId2, branchId]);
  });

  afterAll(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('measurement_units table is queryable', async () => {
    const rows = await q(`SELECT id, code, name FROM public.measurement_units LIMIT 5`);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('units view is a compatibility layer over measurement_units', async () => {
    const rows = await q(`SELECT id, code, name FROM public.units LIMIT 5`);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('inventory_units: insert, read, update, delete', async () => {
    await asAdmin(async () => {
      await client.query(`INSERT INTO public.inventory_units (id, code, name, unit_type, branch_id, cost_price, sale_price) VALUES ($1, $2, $3, 'ready', $4, 5, 12)`, [readyUnitId, 'BP-001', 'Burger Patty', branchId]);
      const rows = await q(`SELECT * FROM public.inventory_units WHERE id = $1`, [readyUnitId]);
      expect(rows.length).toBe(1);
      expect(rows[0].code).toBe('BP-001');
      expect(rows[0].unit_type).toBe('ready');

      await client.query(`UPDATE public.inventory_units SET cost_price = 6 WHERE id = $1`, [readyUnitId]);
      const updated = await q(`SELECT cost_price FROM public.inventory_units WHERE id = $1`, [readyUnitId]);
      expect(Number(updated[0].cost_price)).toBe(6);

      await client.query(`DELETE FROM public.inventory_units WHERE id = $1`, [readyUnitId]);
      const afterDel = await q(`SELECT id FROM public.inventory_units WHERE id = $1`, [readyUnitId]);
      expect(afterDel.length).toBe(0);
    });
  });

  it('inventory_units: rejects invalid unit_type', async () => {
    await client.query('SAVEPOINT sp_unit_type');
    try {
      await expect(
        asAdmin(async () => {
          await client.query(`INSERT INTO public.inventory_units (id, code, name, unit_type) VALUES ($1, 'X', 'Bad', 'invalid')`, [randomUUID()]);
        }),
      ).rejects.toThrow();
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT sp_unit_type');
      await client.query('RELEASE SAVEPOINT sp_unit_type');
    }
  });

  it('product_unit_links: link product to inventory unit', async () => {
    await client.query(`INSERT INTO public.inventory_units (id, code, name, unit_type, branch_id) VALUES ($1, 'PU-001', 'Sauce', 'ready', $2)`, [readyUnitId, branchId]);

    const linkId = randomUUID();
    await asAdmin(async () => {
      await client.query(`INSERT INTO public.product_unit_links (id, product_id, unit_id, quantity) VALUES ($1, $2, $3, 2)`, [linkId, productId, readyUnitId]);
      const rows = await q(`SELECT * FROM public.product_unit_links WHERE id = $1`, [linkId]);
      expect(rows.length).toBe(1);
      expect(Number(rows[0].quantity)).toBe(2);
    });
  });

  it('product_unit_links: rejects duplicate product+unit', async () => {
    await client.query('SAVEPOINT sp_pul_dup');
    try {
      await expect(
        asAdmin(async () => {
          await client.query(`INSERT INTO public.product_unit_links (id, product_id, unit_id, quantity) VALUES ($1, $2, $3, 3)`, [randomUUID(), productId, readyUnitId]);
        }),
      ).rejects.toThrow();
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT sp_pul_dup');
      await client.query('RELEASE SAVEPOINT sp_pul_dup');
    }
  });

  it('inventory_unit_recipes: recipe for manufactured unit', async () => {
    await client.query(`INSERT INTO public.inventory_units (id, code, name, unit_type, branch_id) VALUES ($1, 'MU-001', 'Patty Mfg', 'manufactured', $2)`, [mfgUnitId, branchId]);
    const recId = randomUUID();
    await asAdmin(async () => {
      await client.query(`INSERT INTO public.inventory_unit_recipes (id, unit_id, raw_material_id, quantity, wastage_percent) VALUES ($1, $2, $3, 1.5, 5)`, [recId, mfgUnitId, rmId]);
      const rows = await q(`SELECT * FROM public.inventory_unit_recipes WHERE id = $1`, [recId]);
      expect(rows.length).toBe(1);
      expect(Number(rows[0].quantity)).toBe(1.5);
      expect(Number(rows[0].wastage_percent)).toBe(5);
    });
  });

  it('inventory_unit_batches: create and deduct stock', async () => {
    const batchId = randomUUID();
    await asAdmin(async () => {
      await client.query(`INSERT INTO public.inventory_unit_batches (id, unit_id, branch_id, warehouse_id, quantity, unit_cost) VALUES ($1, $2, $3, $4, 100, 5)`, [batchId, readyUnitId, branchId, whId]);
      let rows = await q(`SELECT quantity FROM public.inventory_unit_batches WHERE id = $1`, [batchId]);
      expect(Number(rows[0].quantity)).toBe(100);

      await client.query(`UPDATE public.inventory_unit_batches SET quantity = quantity - 10 WHERE id = $1`, [batchId]);
      rows = await q(`SELECT quantity FROM public.inventory_unit_batches WHERE id = $1`, [batchId]);
      expect(Number(rows[0].quantity)).toBe(90);
    });
  });

  it('inventory_unit_entries: record a movement', async () => {
    const entryId = randomUUID();
    await asAdmin(async () => {
      await client.query(`INSERT INTO public.inventory_unit_entries (id, unit_id, branch_id, quantity, unit_cost, entry_type) VALUES ($1, $2, $3, -10, 5, 'sale')`, [entryId, readyUnitId, branchId]);
      const rows = await q(`SELECT quantity, entry_type FROM public.inventory_unit_entries WHERE id = $1`, [entryId]);
      expect(rows.length).toBe(1);
      expect(Number(rows[0].quantity)).toBe(-10);
      expect(rows[0].entry_type).toBe('sale');
    });
  });

  it('orders: kitchen_status / payment_status / print_status columns exist', async () => {
    const rows = await q(`SELECT kitchen_status, payment_status, print_status FROM public.orders WHERE id = $1`, [orderId]);
    expect(rows.length).toBe(1);
    expect(rows[0].kitchen_status).toBe('pending');
    expect(rows[0].payment_status).toBe('unpaid');
    expect(rows[0].print_status).toBe('pending');
  });

  it('set_kitchen_status RPC updates order', async () => {
    await asAdmin(async () => {
      await client.query(`SELECT public.set_kitchen_status($1, 'sent')`, [orderId]);
      const rows = await q(`SELECT kitchen_status FROM public.orders WHERE id = $1`, [orderId]);
      expect(rows[0].kitchen_status).toBe('sent');
    });
  });

  it('set_payment_status RPC updates order', async () => {
    await asAdmin(async () => {
      await client.query(`SELECT public.set_payment_status($1, 'paid')`, [orderId]);
      const rows = await q(`SELECT payment_status FROM public.orders WHERE id = $1`, [orderId]);
      expect(rows[0].payment_status).toBe('paid');
    });
  });

  it('set_print_status RPC updates order', async () => {
    await asAdmin(async () => {
      await client.query(`SELECT public.set_print_status($1, 'printed')`, [orderId]);
      const rows = await q(`SELECT print_status FROM public.orders WHERE id = $1`, [orderId]);
      expect(rows[0].print_status).toBe('printed');
    });
  });

  it('set_kitchen_status rejects invalid value', async () => {
    await client.query('SAVEPOINT sp_kitchen_invalid');
    try {
      await expect(
        asAdmin(async () => {
          await client.query(`SELECT public.set_kitchen_status($1, 'bogus')`, [orderId2]);
        }),
      ).rejects.toThrow();
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT sp_kitchen_invalid');
      await client.query('RELEASE SAVEPOINT sp_kitchen_invalid');
    }
  });
});
