import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAs, seedRlsFixture, uniq, type RlsIds } from './rls';

// P0 security hardening gate (068).
// Locks the audited branch-isolation gaps:
//   1. process_sale is NOT executable by anon / PUBLIC (only authenticated + service_role).
//   2. subscription_status is NOT executable by anon / PUBLIC (only authenticated + service_role).
//   3. product_components SELECT is branch-scoped through the parent product
//      (staff see only components of their own branch; admins see all).
//
// Runs in one BEGIN..ROLLBACK transaction. Impersonation happens through the
// CI stub (auth.uid() reads the app.user_id GUC), so the whole suite is
// skipped when impersonation is unavailable. As with the PHASE 4 gate, a
// configured DB without impersonation is a hard failure.
//
//   Run:  npm run test:integration
//   URL:  SUPABASE_DB_URL (or DATABASE_URL) in .env / environment

const dbUrl = getDbUrl();
const skipLocal = !process.env.CI && !dbUrl;

const PROCESS_SALE_SIG =
  'public.process_sale(text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,numeric,text,text,jsonb,uuid,text,uuid,uuid,integer)';

describe.skipIf(skipLocal)('P0 security hardening (068)', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let imp: boolean;

  const adminId = () => ids.users.super_admin;
  const cashierId = () => ids.users.cashier; // branch A

  beforeAll(async () => {
    if (!dbUrl) throw new Error('P0 security hardening requires SUPABASE_DB_URL/DATABASE_URL in CI');
    client = openDb(dbUrl);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
    imp = await canImpersonate(client);
    if (!imp) {
      throw new Error('P0 SECURITY GATE FAILED: auth.uid() impersonation is unavailable; security tests must not be skipped');
    }

    // Seed one product_components row per branch (session role bypasses RLS).
    const ids_ = ids;
    await client.query(
      `INSERT INTO public.product_components (product_id, component_product_id, quantity) VALUES ($1, $1, 1), ($2, $2, 1)`,
      [ids_.prodA, ids_.prodB],
    );
  });

  afterAll(async () => {
    await client?.query('ROLLBACK').catch(() => {});
    await client?.end().catch(() => {});
  });

  describe('process_sale execution grants (CRITICAL: anon cross-branch write)', () => {
    it('revokes EXECUTE from anon and PUBLIC, keeps authenticated + service_role', async () => {
      const result = await client.query<{ anon_exec: boolean; pub_exec: boolean; auth_exec: boolean; svc_exec: boolean }>(
        `SELECT
           has_function_privilege('anon', $1, 'EXECUTE') AS anon_exec,
           has_function_privilege('public', $1, 'EXECUTE') AS pub_exec,
           has_function_privilege('authenticated', $1, 'EXECUTE') AS auth_exec,
           has_function_privilege('service_role', $1, 'EXECUTE') AS svc_exec`,
        [PROCESS_SALE_SIG],
      );
      expect(result.rows[0].anon_exec).toBe(false);
      expect(result.rows[0].pub_exec).toBe(false);
      expect(result.rows[0].auth_exec).toBe(true);
      expect(result.rows[0].svc_exec).toBe(true);
    });

    it('denies an actual anonymous call (no auth.uid())', async () => {
      // As the anon role with no app.user_id GUC, the old branch guard treated
      // auth.uid() = NULL as a pass-through. After 068 the call must fail with
      // a permission error before reaching any business logic.
      await client.query('SAVEPOINT anon_call');
      await client.query('SET LOCAL ROLE anon');
      let error: string | undefined;
      try {
        await client.query(
          `SELECT public.process_sale($1, $2, NULL, NULL, NULL, 0, 0, 'amount', 0, 0, 0, 0, 'cash', 'completed', '[]'::jsonb, NULL, 'takeaway', NULL, NULL, NULL)`,
          [uniq('P0-INV'), ids.branchA],
        );
      } catch (e: unknown) {
        error = (e as Error).message;
      } finally {
        await client.query('ROLLBACK TO SAVEPOINT anon_call').catch(() => {});
        await client.query('RESET ROLE').catch(() => {});
        await client.query('RELEASE SAVEPOINT anon_call').catch(() => {});
      }
      expect(error).toBeTruthy();
    });
  });

  describe('subscription_status execution grants (low: cross-branch info read)', () => {
    it('revokes EXECUTE from anon and PUBLIC, keeps authenticated + service_role', async () => {
      const result = await client.query<{ anon_exec: boolean; pub_exec: boolean; auth_exec: boolean; svc_exec: boolean }>(
        `SELECT
           has_function_privilege('anon', 'public.subscription_status(uuid)', 'EXECUTE') AS anon_exec,
           has_function_privilege('public', 'public.subscription_status(uuid)', 'EXECUTE') AS pub_exec,
           has_function_privilege('authenticated', 'public.subscription_status(uuid)', 'EXECUTE') AS auth_exec,
           has_function_privilege('service_role', 'public.subscription_status(uuid)', 'EXECUTE') AS svc_exec`,
      );
      expect(result.rows[0].anon_exec).toBe(false);
      expect(result.rows[0].pub_exec).toBe(false);
      expect(result.rows[0].auth_exec).toBe(true);
      expect(result.rows[0].svc_exec).toBe(true);
    });
  });

  describe('product_components SELECT isolation (read leak fix)', () => {
    it('admin sees components of both branches; staff see only their own branch', async () => {
      const admin = await runAs(client, adminId(), `SELECT count(*)::int AS c FROM public.product_components`);
      expect(admin.error).toBeUndefined();
      expect(Number(admin.rows?.[0]?.c)).toBe(2);

      const cashier = await runAs(client, cashierId(), `SELECT count(*)::int AS c FROM public.product_components`);
      expect(cashier.error).toBeUndefined();
      expect(Number(cashier.rows?.[0]?.c)).toBe(1);

      const otherCount = await runAs(
        client,
        cashierId(),
        `SELECT count(*)::int AS c FROM public.product_components pc
           JOIN public.products p ON p.id = pc.product_id
         WHERE p.branch_id = $1`,
        [ids.branchB],
      );
      expect(otherCount.error).toBeUndefined();
      expect(Number(otherCount.rows?.[0]?.c)).toBe(0);
    });
  });
});
