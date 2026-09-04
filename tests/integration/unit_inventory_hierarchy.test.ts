import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import type pg from 'pg';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('Unit hierarchy — production to inventory', () => {
  let client: pg.Client;
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const rawMaterialId = randomUUID();
  const unitId = randomUUID();

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(`INSERT INTO public.branches (id, name) VALUES ($1, 'Unit Hierarchy Test Branch')`, [branchId]);
    await client.query(`INSERT INTO public.warehouses (id, name, branch_id, is_active) VALUES ($1, 'Unit Hierarchy WH', $2, true)`, [warehouseId, branchId]);
    await client.query(`INSERT INTO public.raw_materials (id, code, name, default_cost, is_active) VALUES ($1, 'UH-RM-001', 'Mayonnaise', 10, true)`, [rawMaterialId]);
    await client.query(
      `INSERT INTO public.raw_material_inventory (raw_material_id, branch_id, quantity, avg_cost)
       VALUES ($1, $2, 100, 10)`,
      [rawMaterialId, branchId],
    );
    await client.query(`INSERT INTO public.raw_material_batches (raw_material_id, branch_id, batch_number, quantity, unit_cost, source_type) VALUES ($1, $2, 'UH-RM-BATCH', 100, 10, 'opening')`, [rawMaterialId, branchId]);
    await client.query(`INSERT INTO public.inventory_units (id, code, name, unit_type, branch_id, cost_price, sale_price, is_active) VALUES ($1, 'UH-UNIT-001', 'Burger Sauce', 'manufactured', $2, 0, 5, true)`, [unitId, branchId]);
    await client.query(`INSERT INTO public.inventory_unit_recipes (unit_id, raw_material_id, quantity, wastage_percent) VALUES ($1, $2, 2, 0)`, [unitId, rawMaterialId]);
  });

  afterAll(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('manufacturing consumes raw material and creates finished unit stock', async () => {
    const result = await client.query(
      `SELECT public.produce_inventory_unit($1, 20, $2, $3, 'hierarchy integration test') AS production_id`,
      [unitId, warehouseId, branchId],
    );
    expect(result.rows[0].production_id).toBeTruthy();

    const raw = await client.query(
      `SELECT quantity FROM public.raw_material_inventory WHERE raw_material_id = $1 AND branch_id = $2`,
      [rawMaterialId, branchId],
    );
    expect(Number(raw.rows[0].quantity)).toBe(60);

    const batch = await client.query(
      `SELECT quantity, unit_cost FROM public.inventory_unit_batches WHERE unit_id = $1 AND branch_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [unitId, branchId],
    );
    expect(Number(batch.rows[0].quantity)).toBe(20);
    expect(Number(batch.rows[0].unit_cost)).toBe(20);

    const production = await client.query(
      `SELECT status, quantity, total_cost FROM public.inventory_unit_productions WHERE unit_id = $1 AND branch_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [unitId, branchId],
    );
    expect(production.rows[0].status).toBe('completed');
    expect(Number(production.rows[0].quantity)).toBe(20);
    expect(Number(production.rows[0].total_cost)).toBe(400);
  });
});
