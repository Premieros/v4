import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import { runAs, runAsPersist, canImpersonate } from './rls';
import type pg from 'pg';

const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('Multi-tenant Phase 2 — Branch Management', () => {
  let client: pg.Client;
  let canImp: boolean;

  // Tenant A
  let orgAId: string;
  let ownerAUserId: string;
  let branchA1Id: string;
  let warehouseA1Id: string;

  // Tenant B
  let orgBId: string;
  let ownerBUserId: string;
  let branchB1Id: string;

  const emailA = `ownerA-${randomUUID()}@example.test`;
  const emailB = `ownerB-${randomUUID()}@example.test`;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');
    canImp = await canImpersonate(client);
  });

  afterAll(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  // ── CASE 1 & 2: Register two tenants atomically ────────────────────────

  it('CASE 1: User A registers → Tenant A + Branch A1 atomically', async () => {
    await client.query('SET LOCAL ROLE anon');
    const result = await client.query(
      `SELECT public.register_tenant($1,$2,$3,$4,$5,$6,$7,$8) AS res`,
      ['Tenant A', 'Owner A', emailA, 'secret123', 'Tenant A EN', '01000000001', 'Cairo', 'EGP'],
    );
    await client.query('SET LOCAL ROLE postgres');

    const res = result.rows[0].res as Record<string, unknown>;
    expect(res.success, `register_tenant A failed: ${res.error ?? ''} ${res.detail ?? ''}`.trim()).toBe(true);

    orgAId = res.organization_id as string;
    branchA1Id = res.branch_id as string;
    warehouseA1Id = res.warehouse_id as string;
    ownerAUserId = res.user_id as string;

    expect(orgAId).toBeTruthy();
    expect(branchA1Id).toBeTruthy();
    expect(warehouseA1Id).toBeTruthy();
    expect(ownerAUserId).toBeTruthy();
    expect(res.membership_role).toBe('owner');
    expect(res.trial_days).toBe(14);

    const branchRow = await client.query(
      `SELECT organization_id FROM public.branches WHERE id = $1`, [branchA1Id],
    );
    expect(branchRow.rows[0].organization_id).toBe(orgAId);
  });

  it('CASE 2: User B registers → Tenant B + Branch B1 atomically', async () => {
    await client.query('SET LOCAL ROLE anon');
    const result = await client.query(
      `SELECT public.register_tenant($1,$2,$3,$4,$5,$6,$7,$8) AS res`,
      ['Tenant B', 'Owner B', emailB, 'secret123', 'Tenant B EN', '01000000002', 'Alex', 'EGP'],
    );
    await client.query('SET LOCAL ROLE postgres');

    const res = result.rows[0].res as Record<string, unknown>;
    expect(res.success, `register_tenant B failed: ${res.error ?? ''} ${res.detail ?? ''}`.trim()).toBe(true);

    orgBId = res.organization_id as string;
    branchB1Id = res.branch_id as string;
    ownerBUserId = res.user_id as string;

    expect(orgBId).toBeTruthy();
    expect(branchB1Id).toBeTruthy();
    expect(ownerBUserId).toBeTruthy();

    const branchRow = await client.query(
      `SELECT organization_id FROM public.branches WHERE id = $1`, [branchB1Id],
    );
    expect(branchRow.rows[0].organization_id).toBe(orgBId);
  });

  // ── CASE 3: Owner A creates Branch A2 ──────────────────────────────────

  it('CASE 3: Owner A creates Branch A2 via create_organization_branch RPC', async () => {
    const res = await runAsPersist(client, ownerAUserId,
      `SELECT public.create_organization_branch($1, $2, $3, $4, $5) AS res`,
      [orgAId, 'Branch A2', 'Branch A2 EN', 'Giza', '01000000003'],
    );
    expect(res.error).toBeUndefined();
    const row = res.rows[0] as { res: Record<string, unknown> };
    expect(row.res.success, `create_organization_branch failed: ${JSON.stringify(row.res)}`).toBe(true);
    expect(row.res.branch_id).toBeTruthy();
    expect(row.res.warehouse_id).toBeTruthy();

    const verify = await client.query(
      `SELECT organization_id, is_active FROM public.branches WHERE id = $1`,
      [row.res.branch_id as string],
    );
    expect(verify.rows[0].organization_id).toBe(orgAId);
    expect(verify.rows[0].is_active).toBe(true);
  });

  // ── CASE 4: Owner A sees A1 + A2 ───────────────────────────────────────

  it('CASE 4: Owner A sees A1 + A2 (their org branches)', async () => {
    if (!canImp) return;
    const res = await runAs(client, ownerAUserId,
      `SELECT id FROM public.branches ORDER BY name`,
    );
    expect(res.error).toBeUndefined();
    const ids = res.rows.map((r) => r.id as string);
    expect(ids).toContain(branchA1Id);
    // A2 was just created; verify it is visible
    const allBranches = await client.query(
      `SELECT id FROM public.branches WHERE organization_id = $1`, [orgAId],
    );
    const orgBranchIds = allBranches.rows.map((r) => r.id as string);
    for (const bid of orgBranchIds) {
      expect(ids).toContain(bid);
    }
  });

  // ── CASE 5: Owner A does NOT see B1 ────────────────────────────────────

  it('CASE 5: Owner A cannot see Tenant B branches', async () => {
    if (!canImp) return;
    const res = await runAs(client, ownerAUserId,
      `SELECT id FROM public.branches WHERE id = $1`, [branchB1Id],
    );
    expect(res.error).toBeUndefined();
    expect(res.rows).toHaveLength(0);
  });

  // ── CASE 6: Owner A cannot update B1 ───────────────────────────────────

  it('CASE 6: Owner A cannot update Tenant B branch', async () => {
    if (!canImp) return;
    const res = await runAs(client, ownerAUserId,
      `UPDATE public.branches SET name = 'HACKED' WHERE id = $1`, [branchB1Id],
    );
    // RLS silently filters: no rows updated
    expect(res.rowCount).toBe(0);

    const verify = await client.query(`SELECT name FROM public.branches WHERE id = $1`, [branchB1Id]);
    expect(verify.rows[0].name).not.toBe('HACKED');
  });

  // ── CASE 7 & 8 (cross-tenant warehouse/product writes) are deferred to
  // Phase 3 (full tenant data isolation), where warehouses/products RLS will
  // become org-aware. --NEXT_PHASE--

  // ── CASE 9: Branch Manager in A1 is restricted to A1 only ──────────────

  it('CASE 9: Branch Manager in A1 only sees A1 branches', async () => {
    // Create a branch_manager user in A1
    await client.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');
    const bmEmail = `bm-${randomUUID()}@example.test`;
    const bmResult = await client.query(
      `INSERT INTO public.users (id, email, username, full_name, role, branch_id, is_active)
       VALUES ($1, $2, $3, 'BM A1', 'branch_manager', $4, true) RETURNING id`,
      [randomUUID(), bmEmail, bmEmail.split('@')[0], branchA1Id],
    );
    const bmUserId = bmResult.rows[0].id as string;
    await client.query('ALTER TABLE public.users ENABLE TRIGGER trg_users_role_guard');

    // Also add BM to org A as a member
    await client.query(
      `INSERT INTO public.organization_members (organization_id, user_id, membership_role, is_active)
       VALUES ($1, $2, 'member', true) ON CONFLICT DO NOTHING`,
      [orgAId, bmUserId],
    );

    if (!canImp) return;
    // Branch Manager should see only branches in A1's org
    const res = await runAs(client, bmUserId,
      `SELECT id FROM public.branches ORDER BY name`,
    );
    expect(res.error).toBeUndefined();
    const ids = res.rows.map((r) => r.id as string);
    // Should contain A1 (and A2 if it belongs to org A)
    expect(ids).toContain(branchA1Id);
    // Should NOT contain any Tenant B branches
    expect(ids).not.toContain(branchB1Id);
  });

  // ── CASE 10: Disabled branch rejects new transactions ──────────────────

  it('CASE 10: Disabled branch rejects new operational transactions', async () => {
    // Deactivate branch A2 (if it exists from CASE 3)
    const a2Result = await client.query(
      `SELECT id FROM public.branches WHERE organization_id = $1 AND name = 'Branch A2'`,
      [orgAId],
    );
    const branchA2Id = a2Result.rows[0]?.id as string | undefined;
    if (!branchA2Id) return;

    const deactivateRes = await runAsPersist(client, ownerAUserId,
      `SELECT public.deactivate_branch($1) AS res`, [branchA2Id],
    );
    const deactivateRow = deactivateRes.rows[0] as { res: Record<string, unknown> };
    expect(deactivateRow.res.success).toBe(true);

    // Verify is_active = false
    const verify = await client.query(
      `SELECT is_active FROM public.branches WHERE id = $1`, [branchA2Id],
    );
    expect(verify.rows[0].is_active).toBe(false);

    // Try to insert a sale into the deactivated branch — should fail
    const saleRes = await client.query(
      `SELECT id FROM public.warehouses WHERE branch_id = $1 LIMIT 1`, [branchA2Id],
    );
    const whId = saleRes.rows[0]?.id;
    if (whId) {
      const insRes = await runAs(client, ownerAUserId,
        `INSERT INTO public.sales (invoice_number, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status)
         VALUES ($1, $2, $3, 0, 0, 0, 0, 0, 'cash', 'completed')`,
        [`INV-${randomUUID().slice(0, 8)}`, branchA2Id, whId],
      );
      expect(insRes.error).toBeTruthy();
      expect(insRes.error!).toContain('BRANCH_INACTIVE');
    }
  });

  // ── CASE 11: Cannot change organization_id via direct UPDATE ────────────

  it('CASE 11: Cannot change organization_id of A1 to Tenant B', async () => {
    if (!canImp) return;

    // Try to move branch A1 to org B
    const res = await runAs(client, ownerAUserId,
      `UPDATE public.branches SET organization_id = $1 WHERE id = $2`,
      [orgBId, branchA1Id],
    );
    // Trigger should raise exception
    expect(res.error).toBeTruthy();
    expect(res.error!).toContain('ORG_CHANGE_FORBIDDEN');

    // Verify organization_id is still A
    const verify = await client.query(
      `SELECT organization_id FROM public.branches WHERE id = $1`, [branchA1Id],
    );
    expect(verify.rows[0].organization_id).toBe(orgAId);
  });
});
