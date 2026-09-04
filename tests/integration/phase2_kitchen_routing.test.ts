import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import type pg from 'pg';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('Phase 2 — kitchen station routing', () => {
  let client: pg.Client;
  const branchId = randomUUID();
  const orderId = randomUUID();

  async function asAdmin<T>(fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [randomUUID()]);
    await client.query(`SET LOCAL ROLE service_role`);
    await client.query(`SAVEPOINT phase2_kitchen_admin`);
    try {
      const result = await fn();
      await client.query(`RELEASE SAVEPOINT phase2_kitchen_admin`);
      return result;
    } catch (error) {
      await client.query(`ROLLBACK TO SAVEPOINT phase2_kitchen_admin`).catch(() => {});
      await client.query(`RELEASE SAVEPOINT phase2_kitchen_admin`).catch(() => {});
      throw error;
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  async function expectDbError(fn: () => Promise<unknown>): Promise<void> {
    const savepoint = 'phase2_kitchen_expected_error';
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
    await client.query(`INSERT INTO public.branches (id, name) VALUES ($1, 'Phase2 Kitchen')`, [branchId]);
    await client.query(`INSERT INTO public.orders (id, order_number, branch_id, status, kitchen_status) VALUES ($1, 'ORD-K001', $2, 'open', 'sent')`, [orderId, branchId]);
  });

  afterAll(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('orders table has station column', async () => {
    const cols = await q<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name='orders' AND column_name='station'`
    );
    expect(cols.length).toBe(1);
  });

  it('route_to_station RPC sets station on order', async () => {
    await asAdmin(async () => {
      await client.query(`SELECT public.route_to_station($1, $2)`, [orderId, 'grill']);
      const rows = await q<{ station: string }>(
        `SELECT station FROM public.orders WHERE id = $1`, [orderId]
      );
      expect(rows[0].station).toBe('grill');
    });
  });

  it('route_to_station rejects invalid station', async () => {
    await asAdmin(async () => {
      await expectDbError(() =>
        client.query(`SELECT public.route_to_station($1, $2)`, [orderId, 'invalid_station'])
      );
    });
  });

  it('get_kitchen_queue returns orders with kitchen_status sent or cooking', async () => {
    await asAdmin(async () => {
      const rows = await q<{ order_id: string; station: string }>(
        `SELECT order_id, station FROM public.get_kitchen_queue(NULL, $1)`, [branchId]
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows.find(r => r.order_id === orderId)?.station).toBe('grill');
    });
  });

  it('get_kitchen_queue filters by station', async () => {
    await asAdmin(async () => {
      const rows = await q<{ order_id: string }>(
        `SELECT order_id FROM public.get_kitchen_queue('salad', $1)`, [branchId]
      );
      expect(rows.find(r => r.order_id === orderId)).toBeUndefined();
    });
  });

  it('get_kitchen_queue includes elapsed_seconds', async () => {
    await asAdmin(async () => {
      const rows = await q<{ elapsed_seconds: number }>(
        `SELECT elapsed_seconds FROM public.get_kitchen_queue(NULL, $1)`, [branchId]
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0].elapsed_seconds).toBeGreaterThanOrEqual(0);
    });
  });
});
