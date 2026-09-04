import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAs, seedRlsFixture, type RlsIds, uniq } from './rls';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('RBAC hardening regression', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let imp = false;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
    imp = await canImpersonate(client);
  });

  afterAll(async () => {
    await client?.query('ROLLBACK').catch(() => {});
    await client?.end().catch(() => {});
  });

  it('revokes direct EXECUTE on internal journal and audit writers', async () => {
    const result = await client.query<{ journal_exec: boolean; audit_exec: boolean }>(`
      SELECT
        has_function_privilege('authenticated', 'public._post_journal_entry(uuid,text,uuid,text,text,jsonb)', 'EXECUTE') AS journal_exec,
        has_function_privilege('authenticated', 'public.log_audit_action(uuid,text,text,uuid,jsonb)', 'EXECUTE') AS audit_exec
    `);
    expect(result.rows[0].journal_exec).toBe(false);
    expect(result.rows[0].audit_exec).toBe(false);
  });

  it('blocks a cashier from inserting a discounted sale without pos.discount', async () => {
    if (!imp) return;
    const res = await runAs(
      client,
      ids.users.cashier,
      `INSERT INTO public.sales
        (invoice_number, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status)
       VALUES ('RBAC-DISCOUNT', $1, $2, 100, 10, 0, 90, 90, 'cash', 'completed')`,
      [ids.branchA, ids.whA],
    );
    expect(res.error).toBeTruthy();
    expect(res.error).toContain('DISCOUNT_NOT_ALLOWED');
  });

  it('allows the privileged POS role to create a discounted sale only when permission exists', async () => {
    if (!imp) return;

    await client.query(
      `UPDATE public.roles
       SET permissions = permissions || '["pos.discount"]'::jsonb
       WHERE role = 'branch_manager'`,
    );

    const allowed = await runAs(
      client,
      ids.users.branch_manager,
      `INSERT INTO public.sales
        (invoice_number, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status)
       VALUES ('RBAC-DISCOUNT-BM', $1, $2, 100, 10, 0, 90, 90, 'cash', 'completed')`,
      [ids.branchA, ids.whA],
    );
    expect(allowed.error).toBeUndefined();
    expect(allowed.rowCount).toBe(1);
  });

  it('prevents a branch manager from granting admin-only permissions', async () => {
    if (!imp) return;

    const denied = await runAs(
      client,
      ids.users.branch_manager,
      `INSERT INTO public.roles (role, name_ar, name_en, permissions)
       VALUES ($1, 'X', 'Y', '["audit.view"]'::jsonb)`,
      [uniq('RBAC-ROLE')],
    );
    expect(denied.error).toBeTruthy();
    expect(denied.error).toContain('PERMISSION_DENIED');
  });

  it('does not let a cashier read another branch audit trail', async () => {
    if (!imp) return;
    const denied = await runAs(
      client,
      ids.users.cashier,
      `SELECT public.get_audit_trail($1)`,
      [ids.branchB],
    );
    if (denied.error) {
      expect(denied.error).toBeTruthy();
      return;
    }
    const value = denied.rows?.[0]?.get_audit_trail;
    expect(value).toEqual([]);
  });
});