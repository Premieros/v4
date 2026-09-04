import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import type pg from 'pg';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('Phase 2 — production enhancements', () => {
  let client: pg.Client;
  const branchId = randomUUID();
  const whId = randomUUID();
  const rmId = randomUUID();
  const unitId = randomUUID();

  async function asAdmin<T>(fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [randomUUID()]);
    await client.query(`SET LOCAL ROLE service_role`);
    await client.query(`SAVEPOINT phase2_production_admin`);
    try {
      const result = await fn();
      await client.query(`RELEASE SAVEPOINT phase2_production_admin`);
      return result;
    } catch (error) {
      await client.query(`ROLLBACK TO SAVEPOINT phase2_production_admin`).catch(() => {});
      await client.query(`RELEASE SAVEPOINT phase2_production_admin`).catch(() => {});
      throw error;
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  async function expectDbError(fn: () => Promise<unknown>): Promise<void> {
    const savepoint = 'phase2_production_expected_error';
    await client.query(`SAVEPOINT ${savepoint}`);
    let threw = false;
    try {
      await fn();
    } catch {
      threw = true;
    }
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    expect(threw).toBe(true);
  }

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await client.query(sql, params)).rows as T[];

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);
    await client.query(`INSERT INTO public.branches (id, name) VALUES ($1, 'Phase2 Prod')`, [branchId]);
    await client.query(`INSERT INTO public.warehouses (id, name, branch_id) VALUES ($1, 'WH', $2)`, [whId, branchId]);
    await client.query(`INSERT INTO public.raw_materials (id, code, name, min_stock, default_cost, is_active, branch_id) VALUES ($1, 'RM-P', 'Flour', 0, 5, true, $2)`, [rmId, branchId]);
    await client.query(`INSERT INTO public.inventory_units (id, code, name, unit_type, branch_id, cost_price, is_active) VALUES ($1, 'IU-MFG', 'Bread Mix', 'manufactured', $2, 0, true)`, [unitId, branchId]);
    await client.query(`INSERT INTO public.inventory_unit_recipes (unit_id, raw_material_id, quantity, wastage_percent) VALUES ($1, $2, 2, 5)`, [unitId, rmId]);
  });

  afterAll(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('recipes table has version and is_active columns', async () => {
    const cols = await q<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name='recipes' AND column_name IN ('version', 'is_active')`
    );
    expect(cols.length).toBe(2);
  });

  it('inventory_unit_productions table exists', async () => {
    const cols = await q<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name='inventory_unit_productions' AND table_schema='public' ORDER BY ordinal_position`
    );
    const names = cols.map(c => c.column_name);
    expect(names).toContain('unit_id');
    expect(names).toContain('quantity');
    expect(names).toContain('status');
    expect(names).toContain('total_cost');
  });

  it('produce_inventory_unit creates production + batch + entry', async () => {
    await asAdmin(async () => {
      const result = await q<{ produce_inventory_unit: string }>(
        `SELECT public.produce_inventory_unit($1, 3, $2, $3)`,
        [unitId, whId, branchId]
      );
      const prodId = result[0].produce_inventory_unit;
      expect(prodId).toBeTruthy();

      const prodRows = await q<{ status: string; quantity: string }>(
        `SELECT status, quantity::text FROM public.inventory_unit_productions WHERE id = $1`, [prodId]
      );
      expect(prodRows[0].status).toBe('completed');
      expect(Number(prodRows[0].quantity)).toBe(3);

      const batchRows = await q<{ quantity: string }>(
        `SELECT quantity::text FROM public.inventory_unit_batches WHERE unit_id = $1`, [unitId]
      );
      expect(batchRows.length).toBe(1);
    });
  });

  it('get_production_variance returns variance rows', async () => {
    await asAdmin(async () => {
      const rows = await q<{ raw_material_name: string; theoretical_qty: string; actual_qty: string }>(
        `SELECT raw_material_name, theoretical_qty::text, actual_qty::text FROM public.get_production_variance($1, $2)`,
        [unitId, branchId]
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0].raw_material_name).toBe('Flour');
    });
  });

  it('produce_inventory_unit rejects non-manufactured unit', async () => {
    const readyUnitId = randomUUID();
    await client.query(`INSERT INTO public.inventory_units (id, code, name, unit_type, branch_id, cost_price, is_active) VALUES ($1, 'IU-R', 'Ready Item', 'ready', $2, 5, true)`, [readyUnitId, branchId]);
    await asAdmin(async () => {
      await expectDbError(() =>
        client.query(`SELECT public.produce_inventory_unit($1, 1, $2, $3)`, [readyUnitId, whId, branchId])
      );
    });
  });

  it('produce_inventory_unit rejects non-positive quantity', async () => {
    await asAdmin(async () => {
      await expectDbError(() =>
        client.query(`SELECT public.produce_inventory_unit($1, 0, $2, $3)`, [unitId, whId, branchId])
      );
    });
  });
});
