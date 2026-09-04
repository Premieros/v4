import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import type pg from 'pg';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('Product -> manufactured unit -> sale stock flow', () => {
  let client: pg.Client;
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const testUserId = randomUUID();
  const rawMaterialId = randomUUID();
  const unitId = randomUUID();
  const productId = randomUUID();

  async function asAdmin<T>(fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [testUserId]);
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

    await client.query(`INSERT INTO public.branches (id, name) VALUES ($1, 'Unit Flow Test Branch')`, [branchId]);
    await client.query(
      `INSERT INTO auth.users (id, email, role, aud, instance_id, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
       VALUES ($1, $2, 'authenticated', 'authenticated', gen_random_uuid(), '{}'::jsonb, '{}'::jsonb, now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [testUserId, `unit-flow-${testUserId}@example.test`],
    );
    await client.query(
      `INSERT INTO public.users (id, email, full_name, role, branch_id, is_active)
       VALUES ($1, $2, 'Unit Flow Test User', 'owner', $3, true)
       ON CONFLICT (id) DO UPDATE
       SET email = EXCLUDED.email,
           full_name = EXCLUDED.full_name,
           role = 'owner',
           branch_id = EXCLUDED.branch_id,
           is_active = true`,
      [testUserId, `unit-flow-${testUserId}@example.test`, branchId],
    );
    await client.query(`INSERT INTO public.warehouses (id, name, branch_id, is_active) VALUES ($1, 'Unit Flow WH', $2, true)`, [warehouseId, branchId]);
    await client.query(
      `INSERT INTO public.raw_materials (id, code, name, min_stock, default_cost, is_active, branch_id)
       VALUES ($1, $2, 'Test Sauce Base', 0, 5, true, $3)`,
      [rawMaterialId, `RM-${randomUUID()}`, branchId],
    );
    await client.query(
      `INSERT INTO public.raw_material_inventory (raw_material_id, branch_id, quantity, avg_cost)
       VALUES ($1, $2, 20, 5)`,
      [rawMaterialId, branchId],
    );
    await client.query(
      `INSERT INTO public.raw_material_batches (raw_material_id, branch_id, batch_number, quantity, unit_cost, source_type)
       VALUES ($1, $2, $3, 20, 5, 'opening')`,
      [rawMaterialId, branchId, `OPEN-${randomUUID()}`],
    );
    await client.query(
      `INSERT INTO public.inventory_units (id, code, name, unit_type, branch_id, cost_price, sale_price, is_active)
       VALUES ($1, $2, 'Manufactured Sauce', 'manufactured', $3, 5, 10, true)`,
      [unitId, `UNIT-${randomUUID()}`, branchId],
    );
    await client.query(
      `INSERT INTO public.inventory_unit_recipes (unit_id, raw_material_id, quantity, wastage_percent)
       VALUES ($1, $2, 1, 0)`,
      [unitId, rawMaterialId],
    );
    await client.query(
      `INSERT INTO public.products (id, name, branch_id, product_type, sale_price, cost_price, is_active)
       VALUES ($1, 'Burger With Sauce', $2, 'ready', 20, 5, true)`,
      [productId, branchId],
    );
    await client.query(
      `INSERT INTO public.product_unit_links (product_id, unit_id, quantity) VALUES ($1, $2, 1)`,
      [productId, unitId],
    );
    await client.query(`SELECT public.ensure_chart_of_accounts($1)`, [branchId]);
    await client.query(`SELECT public.seed_account_mappings($1)`, [branchId]);
    await client.query(`UPDATE public.settings SET tax_enabled = false`);
  });

  afterAll(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('manufactures 10 units by consuming 10 raw materials, then sells 2 units without consuming raw materials again', async () => {
    await asAdmin(async () => {
      const rawBefore = await q<{ quantity: string }>(
        `SELECT quantity::text FROM public.raw_material_inventory WHERE raw_material_id = $1 AND branch_id = $2`,
        [rawMaterialId, branchId],
      );
      expect(Number(rawBefore[0].quantity)).toBe(20);

      const production = await q<{ produce_inventory_unit: string }>(
        `SELECT public.produce_inventory_unit($1, 10, $2, $3)`,
        [unitId, warehouseId, branchId],
      );
      expect(production[0].produce_inventory_unit).toBeTruthy();

      const rawAfterProduction = await q<{ quantity: string }>(
        `SELECT quantity::text FROM public.raw_material_inventory WHERE raw_material_id = $1 AND branch_id = $2`,
        [rawMaterialId, branchId],
      );
      expect(Number(rawAfterProduction[0].quantity)).toBe(10);

      const unitAfterProduction = await q<{ quantity: string }>(
        `SELECT COALESCE(SUM(quantity), 0)::text AS quantity
         FROM public.inventory_unit_batches
         WHERE unit_id = $1 AND branch_id = $2 AND warehouse_id = $3`,
        [unitId, branchId, warehouseId],
      );
      expect(Number(unitAfterProduction[0].quantity)).toBe(10);

      const sale = await q<{ r: { success: boolean; sale_id?: string; error?: string; detail?: string } }>(
        `SELECT public.process_sale(
          $1, $2, $3, NULL, NULL,
          40, 0, 'amount', 0, 0, 40, 40, 'cash', 'completed',
          $4::jsonb, NULL, 'takeaway', NULL, NULL, NULL
        ) AS r`,
        [
          `UNIT-FLOW-${Date.now()}-${randomUUID()}`,
          branchId,
          warehouseId,
          JSON.stringify([
            {
              product_id: productId,
              unit_name: 'piece',
              quantity: 2,
              unit_price: 20,
              discount_amount: 0,
              bonus_quantity: 0,
              total: 40,
            },
          ]),
        ],
      );
      expect(sale[0].r.success).toBe(true);
      if (!sale[0].r.success) throw new Error(JSON.stringify(sale[0].r));

      const rawAfterSale = await q<{ quantity: string }>(
        `SELECT quantity::text FROM public.raw_material_inventory WHERE raw_material_id = $1 AND branch_id = $2`,
        [rawMaterialId, branchId],
      );
      expect(Number(rawAfterSale[0].quantity)).toBe(10);

      const unitAfterSale = await q<{ quantity: string }>(
        `SELECT COALESCE(SUM(quantity), 0)::text AS quantity
         FROM public.inventory_unit_batches
         WHERE unit_id = $1 AND branch_id = $2 AND warehouse_id = $3`,
        [unitId, branchId, warehouseId],
      );
      expect(Number(unitAfterSale[0].quantity)).toBe(8);

      const saleEntries = await q<{ quantity: string; entry_type: string }>(
        `SELECT quantity::text, entry_type
         FROM public.inventory_unit_entries
         WHERE reference_id = $1
         ORDER BY created_at`,
        [sale[0].r.sale_id],
      );
      expect(saleEntries.length).toBeGreaterThan(0);
      expect(saleEntries.some((entry) => entry.entry_type === 'sale' && Number(entry.quantity) === -2)).toBe(true);

      const rawSaleEntries = await q<{ count: number }>(
        `SELECT count(*)::int AS count
         FROM public.inventory_ledger
         WHERE reference_id = $1 AND raw_material_id = $2`,
        [sale[0].r.sale_id, rawMaterialId],
      );
      expect(rawSaleEntries[0].count).toBe(0);
    });
  });
});
