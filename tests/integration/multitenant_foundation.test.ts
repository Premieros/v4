import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import type pg from 'pg';

const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('Multi-tenant foundation', () => {
  let client: pg.Client;
  const email = `tenant-${randomUUID()}@example.test`;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);
  });

  afterAll(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('creates an isolated organization, first branch, warehouse, owner membership, and trial atomically', async () => {
    await client.query('SET LOCAL ROLE anon');

    const result = await client.query(
      `SELECT public.register_tenant($1,$2,$3,$4,$5,$6,$7,$8) AS res`,
      ['Tenant E2E', 'Tenant Owner', email, 'secret123', 'Tenant E2E EN', '01000000000', 'Cairo', 'EGP'],
    );

    const res = result.rows[0].res as {
      success?: boolean;
      organization_id?: string;
      branch_id?: string;
      warehouse_id?: string;
      user_id?: string;
      membership_role?: string;
      trial_days?: number;
      error?: string;
      detail?: string;
    };

    expect(res.success, `register_tenant failed: ${res.error ?? 'UNKNOWN'} ${res.detail ?? ''}`.trim()).toBe(true);
    expect(res.organization_id).toBeTruthy();
    expect(res.branch_id).toBeTruthy();
    expect(res.warehouse_id).toBeTruthy();
    expect(res.user_id).toBeTruthy();
    expect(res.membership_role).toBe('owner');
    expect(res.trial_days).toBe(14);

    await client.query('SET LOCAL ROLE postgres');

    const branch = await client.query(
      `SELECT organization_id FROM public.branches WHERE id = $1`,
      [res.branch_id],
    );
    expect(branch.rows[0].organization_id).toBe(res.organization_id);

    const warehouse = await client.query(
      `SELECT branch_id FROM public.warehouses WHERE id = $1`,
      [res.warehouse_id],
    );
    expect(warehouse.rows[0].branch_id).toBe(res.branch_id);

    const membership = await client.query(
      `SELECT organization_id, user_id, membership_role, is_active
       FROM public.organization_members
       WHERE organization_id = $1 AND user_id = $2`,
      [res.organization_id, res.user_id],
    );
    expect(membership.rows).toHaveLength(1);
    expect(membership.rows[0].membership_role).toBe('owner');
    expect(membership.rows[0].is_active).toBe(true);

    const subscription = await client.query(
      `SELECT status, trial_ends_at > trial_starts_at AS valid_window
       FROM public.branch_subscriptions
       WHERE branch_id = $1`,
      [res.branch_id],
    );
    expect(subscription.rows[0].status).toBe('trial');
    expect(subscription.rows[0].valid_window).toBe(true);

    const isolation = await client.query(
      `SELECT count(*)::int AS count
       FROM public.branches
       WHERE organization_id = $1 AND id <> $2`,
      [res.organization_id, res.branch_id],
    );
    expect(isolation.rows[0].count).toBe(0);
  });
});
