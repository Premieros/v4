import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import type pg from 'pg';

// Integration tests for replace_product_units (migration 077).
//
// The frontend calls this RPC on every product create/edit (ProductsPage.save),
// but it was never defined in any migration until 077 -- a latent PGRST202
// ("Could not find the function ... in the schema cache") that the schema
// contract (supabase/api-contract.json + verify-schema.js) now prevents.
//
//   * Signature: replace_product_units(uuid, jsonb), SECURITY DEFINER.
//   * Atomic replace: existing units deleted, new set inserted in one call.
//   * Guards: unknown product -> PRODUCT_NOT_FOUND; no base unit -> NO_BASE_UNIT.
//   * Branch isolation: admin may touch any branch; staff locked to own branch.
//   * Audit trail row is written.
//
// Runs inside a single BEGIN..ROLLBACK transaction - safe against the live DB.
//
//   Run:  npm run test:integration
//   Skip: when no URL is configured

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('replace_product_units (077)', () => {
  let client: pg.Client;

  const branchA = randomUUID();
  const prodA = randomUUID();
  const ownerId = randomUUID();
  const cashierId = randomUUID();

  async function asUser<T>(userId: string, role: 'authenticated' | 'anon' = 'authenticated', fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    await client.query(`SET LOCAL ROLE ${role}`);
    try {
      return await fn();
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  const call = (productId: string, units: unknown[] | null) =>
    client.query<{ result: string }>(
      `SELECT public.replace_product_units($1, $2)::text AS result`,
      [productId, units === null ? null : JSON.stringify(units)],
    );

  const resultOf = (row: { result: string }): { success: boolean; error?: string; units?: number } => JSON.parse(row.result);

  const unitsOf = (productId: string) =>
    client.query<{ unit_name: string; conversion_factor: string; is_base: boolean; barcode: string | null }>(
      `SELECT unit_name, conversion_factor::text AS conversion_factor, is_base, barcode
       FROM public.product_units WHERE product_id = $1 ORDER BY is_base DESC, unit_name`,
      [productId],
    );

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);

    const orgId = randomUUID();
    await client.query(`INSERT INTO public.organizations (id, name, slug) VALUES ($1, $2, $3)`, [orgId, 'RPU Org', `rpu-${randomUUID().slice(0, 8)}`]);
    await client.query(`INSERT INTO public.branches (id, name, organization_id) VALUES ($1, $2, $3)`, [branchA, 'Branch A', orgId]);
    await client.query(
      `INSERT INTO public.products (id, name, branch_id, sale_price, cost_price, is_active) VALUES ($1, $2, $3, 100, 50, true)`,
      [prodA, 'Product A', branchA],
    );
    await client.query(
      `INSERT INTO public.users (id, email, full_name, role, branch_id, is_active)
       VALUES ($1, $2, $3, 'owner', NULL, true)`,
      [ownerId, `owner-${randomUUID()}@test.local`, 'Owner'],
    );
    await client.query(
      `INSERT INTO public.users (id, email, full_name, role, branch_id, is_active)
       VALUES ($1, $2, $3, 'cashier', $4, true)`,
      [cashierId, `cashier-${randomUUID()}@test.local`, 'Cashier A', branchA],
    );
    await client.query(`INSERT INTO public.organization_members (organization_id, user_id, membership_role, is_active) VALUES ($1, $2, 'owner', true), ($1, $3, 'member', true)`, [orgId, ownerId, cashierId]);
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }
  });

  it('exposes the expected (uuid, jsonb) SECURITY DEFINER signature', async () => {
    const r = await client.query<{ identity_args: string; prosecdef: boolean }>(`
      SELECT pg_get_function_identity_arguments(p.oid) AS identity_args, p.prosecdef
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'replace_product_units'
    `);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].identity_args).toBe('p_product_id uuid, p_units jsonb');
    expect(r.rows[0].prosecdef).toBe(true);
  });

  it('replaces existing units atomically with the new set', async () => {
    await client.query(
      `INSERT INTO public.product_units (product_id, unit_name, unit_name_en, conversion_factor, sale_price, cost_price, barcode, is_base)
       VALUES ($1, 'piece', 'piece', 1, 10, 5, 'X1', true)`,
      [prodA],
    );
    const res = await asUser(ownerId, 'authenticated', () =>
      call(prodA, [
        { unit_name: 'piece', unit_name_en: 'piece', conversion_factor: 1, sale_price: 20, cost_price: 8, barcode: 'U1', is_base: true },
        { unit_name: 'dozen', unit_name_en: 'dozen', conversion_factor: 12, sale_price: 200, cost_price: 90, barcode: null, is_base: false },
      ]),
    );
    expect(resultOf(res.rows[0]).success).toBe(true);
    expect(resultOf(res.rows[0]).units).toBe(2);

    const units = await unitsOf(prodA);
    expect(units.rows).toHaveLength(2);
    const piece = units.rows.find((u) => u.unit_name === 'piece');
    const dozen = units.rows.find((u) => u.unit_name === 'dozen');
    expect(piece).toBeTruthy();
    expect(piece!.is_base).toBe(true);
    expect(Number(piece!.conversion_factor)).toBe(1);
    expect(piece!.barcode).toBe('U1');
    expect(dozen).toBeTruthy();
    expect(dozen!.is_base).toBe(false);
    expect(Number(dozen!.conversion_factor)).toBe(12);
  });

  it('rejects an unknown product with PRODUCT_NOT_FOUND', async () => {
    const res = await asUser(ownerId, 'authenticated', () => call(randomUUID(), [{ unit_name: 'piece', is_base: true }]));
    expect(resultOf(res.rows[0]).success).toBe(false);
    expect(resultOf(res.rows[0]).error).toBe('PRODUCT_NOT_FOUND');
  });

  it('rejects a payload without a base unit', async () => {
    const res = await asUser(ownerId, 'authenticated', () =>
      call(prodA, [{ unit_name: 'piece', is_base: false }]),
    );
    expect(resultOf(res.rows[0]).success).toBe(false);
    expect(resultOf(res.rows[0]).error).toBe('NO_BASE_UNIT');
  });

  it('allows admin across branches and locks staff to their own branch', async () => {
    const admin = await asUser(ownerId, 'authenticated', () => call(prodA, [{ unit_name: 'piece', is_base: true }]));
    expect(resultOf(admin.rows[0]).success).toBe(true);

    const staff = await asUser(cashierId, 'authenticated', () => call(prodA, [{ unit_name: 'piece', is_base: true }]));
    expect(resultOf(staff.rows[0]).success).toBe(true);

    // A non-admin cannot replace units of a product in a branch they do not own.
    const otherProduct = randomUUID();
    await client.query(
      `INSERT INTO public.branches (id, name) VALUES ($1, $2)`,
      [randomUUID(), 'Branch B'],
    );
    const branchB = (
      await client.query<{ id: string }>(`SELECT id FROM public.branches WHERE name = 'Branch B' LIMIT 1`)
    ).rows[0].id;
    await client.query(
      `INSERT INTO public.products (id, name, branch_id, sale_price, cost_price, is_active) VALUES ($1, $2, $3, 50, 20, true)`,
      [otherProduct, 'Product B', branchB],
    );
    const denied = await asUser(cashierId, 'authenticated', () => call(otherProduct, [{ unit_name: 'piece', is_base: true }]));
    expect(resultOf(denied.rows[0]).success).toBe(false);
    expect(resultOf(denied.rows[0]).error).toBe('NOT_ALLOWED');
  });

  it('writes an audit trail entry for the replacement', async () => {
    await asUser(ownerId, 'authenticated', () => call(prodA, [{ unit_name: 'piece', is_base: true }]));
    const audit = await client.query<{ action: string; entity_id: string; branch_id: string }>(
      `SELECT action, entity_id, branch_id FROM public.audit_log
       WHERE action = 'replace_product_units' AND entity_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [prodA],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].entity_id).toBe(prodA);
    expect(audit.rows[0].branch_id).toBe(branchA);
  });
});
