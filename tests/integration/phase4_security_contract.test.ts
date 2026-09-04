import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAs, seedRlsFixture, type RlsIds, uniq } from './rls';

// PHASE 4 contract gate.
// In CI, a configured DB without auth impersonation is a HARD FAILURE, never a
// silent skip. This prevents a green security gate that did not actually test
// authenticated RLS/RBAC behavior.
const dbUrl = getDbUrl();
const skipLocal = !process.env.CI && !dbUrl;

describe.skipIf(skipLocal)('PHASE 4 security contract', () => {
  let client: pg.Client;
  let ids: RlsIds;

  beforeAll(async () => {
    if (!dbUrl) throw new Error('PHASE 4 security contract requires SUPABASE_DB_URL/DATABASE_URL in CI');
    client = openDb(dbUrl);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
    const impersonation = await canImpersonate(client);
    if (!impersonation) {
      throw new Error('PHASE 4 SECURITY GATE FAILED: auth.uid() impersonation is unavailable; security tests must not be skipped');
    }
  });

  afterAll(async () => {
    await client?.query('ROLLBACK').catch(() => {});
    await client?.end().catch(() => {});
  });

  it('keeps admin visibility across both branches', async () => {
    // Super admin is in both orgs → sees both products
    const sa = await runAs(
      client,
      ids.users.super_admin,
      `SELECT count(*)::int AS n FROM public.products WHERE id IN ($1, $2)`,
      [ids.prodA, ids.prodB],
    );
    expect(sa.error).toBeUndefined();
    expect(sa.rows?.[0]?.n).toBe(2);

    // Owner is only in orgA → sees only prodA
    const ow = await runAs(
      client,
      ids.users.owner,
      `SELECT count(*)::int AS n FROM public.products WHERE id IN ($1, $2)`,
      [ids.prodA, ids.prodB],
    );
    expect(ow.error).toBeUndefined();
    expect(ow.rows?.[0]?.n).toBe(1);
  });

  it('keeps branch staff isolated for read and write', async () => {
    const ownRead = await runAs(client, ids.users.cashier, 'SELECT id FROM public.products WHERE id = $1', [ids.prodA]);
    expect(ownRead.error).toBeUndefined();
    expect(ownRead.rowCount).toBe(1);

    const otherRead = await runAs(client, ids.users.cashier, 'SELECT id FROM public.products WHERE id = $1', [ids.prodB]);
    expect(otherRead.error).toBeUndefined();
    expect(otherRead.rowCount).toBe(0);

    const otherInsert = await runAs(
      client,
      ids.users.cashier,
      `INSERT INTO public.products (name, branch_id, cost_price, sale_price, is_active)
       VALUES ('CROSS-BRANCH', $1, 1, 2, true)`,
      [ids.branchB],
    );
    expect(otherInsert.error || otherInsert.rowCount === 0).toBeTruthy();

    const otherUpdate = await runAs(client, ids.users.cashier, 'UPDATE public.products SET name = $1 WHERE id = $2', ['blocked', ids.prodB]);
    expect(otherUpdate.error || otherUpdate.rowCount === 0).toBeTruthy();
  });

  it('blocks direct execution of internal journal and audit writers', async () => {
    const result = await client.query<{ journal_exec: boolean; audit_exec: boolean }>(`
      SELECT
        has_function_privilege('authenticated', 'public._post_journal_entry(uuid,text,uuid,text,text,jsonb)', 'EXECUTE') AS journal_exec,
        has_function_privilege('authenticated', 'public.log_audit_action(uuid,text,text,uuid,jsonb)', 'EXECUTE') AS audit_exec
    `);
    expect(result.rows[0].journal_exec).toBe(false);
    expect(result.rows[0].audit_exec).toBe(false);
  });

  it('blocks cross-branch audit reads for branch staff', async () => {
    const result = await runAs(client, ids.users.cashier, 'SELECT public.get_audit_trail($1)', [ids.branchB]);
    if (result.error) {
      expect(result.error).toBeTruthy();
      return;
    }
    expect(result.rows?.[0]?.get_audit_trail).toEqual([]);
  });

  it('enforces pos.discount at the database boundary', async () => {
    const denied = await runAs(
      client,
      ids.users.cashier,
      `INSERT INTO public.sales
        (invoice_number, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status)
       VALUES ('PH4-DENY', $1, $2, 100, 10, 0, 90, 90, 'cash', 'completed')`,
      [ids.branchA, ids.whA],
    );
    expect(denied.error).toBeTruthy();
    expect(denied.error).toContain('DISCOUNT_NOT_ALLOWED');

    await client.query(`UPDATE public.roles SET permissions = permissions || '["pos.discount"]'::jsonb WHERE role = 'branch_manager'`);
    const allowed = await runAs(
      client,
      ids.users.branch_manager,
      `INSERT INTO public.sales
        (invoice_number, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status)
       VALUES ('PH4-ALLOW', $1, $2, 100, 10, 0, 90, 90, 'cash', 'completed')`,
      [ids.branchA, ids.whA],
    );
    expect(allowed.error).toBeUndefined();
    expect(allowed.rowCount).toBe(1);
  });

  it('prevents branch managers from granting admin-only permissions', async () => {
    const denied = await runAs(
      client,
      ids.users.branch_manager,
      `INSERT INTO public.roles (role, name_ar, name_en, permissions)
       VALUES ($1, 'X', 'Y', '["audit.view"]'::jsonb)`,
      [uniq('PH4-ROLE')],
    );
    expect(denied.error).toBeTruthy();
    expect(denied.error).toContain('PERMISSION_DENIED');
  });
});