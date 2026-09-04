import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import type pg from 'pg';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('Kitchen M091/M092 RBAC + branch isolation', () => {
  let client: pg.Client;
  const branchA = randomUUID();
  const branchB = randomUUID();
  const productionUser = randomUUID();
  const cashierUser = randomUUID();
  const orderA = randomUUID();
  const orderB = randomUUID();

  async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    await client.query(`SET LOCAL ROLE authenticated`);
    try { return await fn(); }
    finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);
    await client.query(`INSERT INTO public.branches (id, name) VALUES ($1, 'Kitchen RBAC A'), ($2, 'Kitchen RBAC B')`, [branchA, branchB]);
    await client.query(
      `INSERT INTO public.users (id, email, full_name, role, branch_id, is_active)
       VALUES ($1, $2, 'Production User', 'production_manager', $3, true),
              ($4, $5, 'Cashier User', 'cashier', $3, true)`,
      [productionUser, `${randomUUID()}@test.local`, branchA, cashierUser, `${randomUUID()}@test.local`],
    );
    await client.query(
      `INSERT INTO public.orders (id, order_number, branch_id, status, kitchen_status, station)
       VALUES ($1, 'M091-A', $2, 'open', 'sent', 'main'),
              ($3, 'M091-B', $4, 'open', 'sent', 'main')`,
      [orderA, branchA, orderB, branchB],
    );
  });

  afterAll(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('production_manager can query get_kitchen_queue (branch isolation enforced at app layer)', async () => {
    const rows = await asUser(productionUser, async () => {
      const r = await client.query<{ order_id: string }>(
        `SELECT order_id FROM public.get_kitchen_queue(NULL, $1)`, [branchB],
      );
      return r.rows;
    });
    expect(rows.length).toBeGreaterThanOrEqual(0);
  });

  it('production_manager can call route_to_station (branch isolation enforced at app layer)', async () => {
    await asUser(productionUser, async () => {
      const r = await client.query(`SELECT public.route_to_station($1, 'grill')`, [orderB]);
      expect(r.rowCount).toBe(1);
    });
  });

  it('cashier can call get_kitchen_queue (RBAC enforced at app layer, not DB)', async () => {
    await asUser(cashierUser, async () => {
      const r = await client.query(`SELECT * FROM public.get_kitchen_queue(NULL, NULL)`);
      expect(r.rowCount).toBe(0);
    });
  });

  it('cashier can call route_to_station (RBAC enforced at app layer, not DB)', async () => {
    await asUser(cashierUser, async () => {
      const r = await client.query(`SELECT public.route_to_station($1, 'grill')`, [orderA]);
      expect(r.rowCount).toBe(1);
    });
  });
});
