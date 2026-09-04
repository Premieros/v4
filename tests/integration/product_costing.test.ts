import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import type pg from 'pg';

// Integration coverage for migration 074 (P0 item 2 — Product / Recipe Costing):
//
//   product_cost_history table + track_product_cost_history trigger, and the
//   branch-scoped SECURITY DEFINER RPCs get_costing_overview,
//   get_product_costing_detail, get_cost_history, get_order_margin and
//   get_supplier_price_impact (raw-material side; the product side is already
//   covered by procurement_workflow.test.ts).
//
// Every RPC is branch-scoped: non-admins are locked to their own branch via
// is_pos_admin(), admins may pass NULL (all branches) or a specific branch.
//
// Runs inside a single BEGIN..ROLLBACK transaction — safe against a live DB.
//
//   Run:  SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres npm run test:integration

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('product costing RPCs (074)', () => {
  let client: pg.Client;
  const branchA = randomUUID();
  const branchB = randomUUID();
  const whId = randomUUID();
  const prodId = randomUUID();
  const prodNoRecipe = randomUUID();
  const rmId = randomUUID();
  const recipeId = randomUUID();
  const adminId = randomUUID();
  const managerId = randomUUID();
  const managerBId = randomUUID();
  const supplierA = randomUUID();
  let saleId = '';

  async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    await client.query(`SET LOCAL ROLE authenticated`);
    try {
      return await fn();
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await client.query(sql, params)).rows as T[];

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);

    const orgId = randomUUID();
    await client.query(`INSERT INTO public.organizations (id, name, slug) VALUES ($1, $2, $3)`, [orgId, 'PC Org', `pc-${randomUUID().slice(0, 8)}`]);
    await client.query(`INSERT INTO public.branches (id, name, organization_id) VALUES ($1, $2, $3), ($4, $5, $6)`, [branchA, 'Cost A', orgId, branchB, 'Cost B', orgId]);
    await client.query(`INSERT INTO public.warehouses (id, name, branch_id, is_active) VALUES ($1, $2, $3, true)`, [whId, 'Cost WH', branchA]);
    await client.query(`INSERT INTO public.products (id, name, branch_id, sale_price, cost_price, is_active) VALUES ($1, $2, $3, 100, 30, true), ($4, $5, $6, 80, 20, true)`, [prodId, 'Cost Product', branchA, prodNoRecipe, 'Cost NoRecipe', branchA]);
    await client.query(`INSERT INTO public.raw_materials (id, code, name, branch_id, default_cost, is_active) VALUES ($1, $2, $3, $4, 15, true)`, [rmId, `RM-${rmId.slice(0, 8)}`, 'Cost Raw', branchA]);
    await client.query(`INSERT INTO public.suppliers (id, name, branch_id, balance) VALUES ($1, $2, $3, 0)`, [supplierA, 'Cost Supplier', branchA]);
    await client.query(`INSERT INTO public.recipes (id, product_id, branch_id, name, yield_quantity, is_active) VALUES ($1, $2, $3, 'Recipe', 2, true)`, [recipeId, prodId, branchA]);
    await client.query(`INSERT INTO public.recipe_items (recipe_id, raw_material_id, quantity, wastage_percent) VALUES ($1, $2, 1, 10)`, [recipeId, rmId]);
    await client.query(`INSERT INTO public.raw_material_batches (raw_material_id, branch_id, quantity, unit_cost, source_type) VALUES ($1, $2, 10, 20, 'purchase')`, [rmId, branchA]);

    const mkUser = async (id: string, role: string, branch: string | null) => {
      const uname = `costu-${randomUUID().slice(0, 8)}`;
      await client.query(
        `INSERT INTO public.users (id, email, username, full_name, role, branch_id, is_active) VALUES ($1, $2, $3, $4, $5, $6, true)`,
        [id, `cost-${randomUUID()}@test.local`, uname, 'Cost User', role, branch],
      );
    };
    await mkUser(adminId, 'super_admin', null);
    await mkUser(managerId, 'branch_manager', branchA);
    await mkUser(managerBId, 'branch_manager', branchB);
    await client.query(`INSERT INTO public.organization_members (organization_id, user_id, membership_role, is_active) VALUES ($1, $2, 'owner', true), ($1, $3, 'member', true), ($1, $4, 'member', true)`, [orgId, adminId, managerId, managerBId]);
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }
  });

  it('get_costing_overview: recipe cost math (avg batch cost x (1 + wastage) x qty)', async () => {
    const overview = await asUser(adminId, async () =>
      rows<{ product_id: string; actual_cost: string; theoretical_cost: string; sale_price: string; recipe_item_count: string }>(
        `SELECT product_id, actual_cost, theoretical_cost, sale_price, recipe_item_count FROM public.get_costing_overview(NULL) WHERE product_id = $1`, [prodId],
      ),
    );
    expect(overview.length).toBe(1);
    expect(Number(overview[0].actual_cost)).toBe(22); // 1 x 1.1 x 20 (batch avg cost), no yield division
    expect(Number(overview[0].theoretical_cost)).toBe(0); // no product_components BOM
    expect(Number(overview[0].sale_price)).toBe(100);
    expect(Number(overview[0].recipe_item_count)).toBe(1);

    // Product without a recipe has zero recipe cost and a 0 item count.
    const noRecipe = await asUser(adminId, async () =>
      rows<{ product_id: string; actual_cost: string; recipe_item_count: string }>(
        `SELECT product_id, actual_cost, recipe_item_count FROM public.get_costing_overview(NULL) WHERE product_id = $1`, [prodNoRecipe],
      ),
    );
    expect(Number(noRecipe[0].actual_cost)).toBe(0);
    expect(Number(noRecipe[0].recipe_item_count)).toBe(0);
  });

  it('_raw_wavg_cost falls back to raw_materials.default_cost when no batches exist', async () => {
    const wavg = await client.query<{ wavg: string }>(
      `SELECT round(public._raw_wavg_cost($1, $2), 2) AS wavg FROM public.raw_materials WHERE id = $1`, [rmId, branchA],
    );
    expect(Number(wavg.rows[0].wavg)).toBe(20); // from the seeded batch

    // A raw material with no batches (tmp) resolves to its default_cost.
    const tmp = await client.query<{ id: string }>(
      `INSERT INTO public.raw_materials (id, code, name, branch_id, default_cost, is_active) VALUES ($1, 'TMPRM', 'Tmp', $2, 7, true) RETURNING id`,
      [randomUUID(), branchA],
    );
    const fallback = await client.query<{ wavg: string }>(
      `SELECT round(public._raw_wavg_cost($1, $2), 2) AS wavg`, [tmp.rows[0].id, branchA],
    );
    expect(Number(fallback.rows[0].wavg)).toBe(7);
  });

  it('get_costing_overview: branch isolation for non-admins', async () => {
    // Branch A manager sees only branch-A products even with p_branch_id = NULL.
    const inBranch = await asUser(managerId, async () =>
      rows<{ product_id: string }>(`SELECT product_id FROM public.get_costing_overview(NULL)`),
    );
    expect(inBranch.some((r) => r.product_id === prodId)).toBe(true);
    expect(inBranch.length).toBe(2); // both seeded products live in branch A

    // Branch B manager sees neither product.
    const outBranch = await asUser(managerBId, async () =>
      rows<{ product_id: string }>(`SELECT product_id FROM public.get_costing_overview(NULL)`),
    );
    expect(outBranch.length).toBe(0);

    // Admin may scope to a specific branch (none of the products are in B).
    const adminB = await asUser(adminId, async () =>
      rows<{ product_id: string }>(`SELECT product_id FROM public.get_costing_overview($1)`, [branchB]),
    );
    expect(adminB.length).toBe(0);
  });

  it('get_product_costing_detail: recipe lines, batch-cost fallback and error on missing product', async () => {
    const detail = await asUser(managerId, async () =>
      rows<{ r: { success: boolean; product_name: string; actual_cost: number; recipe_items: Array<{ line_cost: number; unit_cost: number }>; history: unknown[] } }>(
        `SELECT public.get_product_costing_detail($1, NULL) AS r`, [prodId],
      ),
    );
    expect(detail[0].r.success).toBe(true);
    expect(detail[0].r.product_name).toBe('Cost Product');
    expect(Number(detail[0].r.actual_cost)).toBe(22);
    expect(detail[0].r.recipe_items.length).toBe(1);
    expect(Number(detail[0].r.recipe_items[0].unit_cost)).toBe(20);
    expect(Number(detail[0].r.recipe_items[0].line_cost)).toBe(22);

    const missing = await asUser(managerId, async () =>
      rows<{ r: { success: boolean; error: string } }>(
        `SELECT public.get_product_costing_detail($1, NULL) AS r`, [randomUUID()],
      ),
    );
    expect(missing[0].r.success).toBe(false);
    expect(missing[0].r.error).toBe('PRODUCT_NOT_FOUND');
  });

  it('track_product_cost_history trigger records cost changes; get_cost_history returns them', async () => {
    await client.query(`UPDATE public.products SET cost_price = 45 WHERE id = $1`, [prodId]);

    const history = await asUser(adminId, async () =>
      rows<{ old_cost: string; new_cost: string; source: string }>(
        `SELECT old_cost, new_cost, source FROM public.get_cost_history($1, 50)`, [prodId],
      ),
    );
    expect(history.length).toBeGreaterThan(0);
    expect(Number(history[0].old_cost)).toBe(30);
    expect(Number(history[0].new_cost)).toBe(45);
    expect(history[0].source).toBe('auto');

    const table = await client.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM public.product_cost_history WHERE product_id = $1`, [prodId],
    );
    expect(Number(table.rows[0].c)).toBe(1);
  });

  it('get_order_margin: COGS from the inventory ledger sale rows', async () => {
    const sale = await client.query<{ id: string }>(
      `INSERT INTO public.sales (id, invoice_number, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status)
       VALUES ($1, 'COSTINV', $2, $3, 0, 0, 0, 200, 200, 'cash', 'completed') RETURNING id`,
      [randomUUID(), branchA, whId],
    );
    saleId = sale.rows[0].id;
    await client.query(
      `INSERT INTO public.inventory_ledger (product_id, branch_id, warehouse_id, quantity, unit_cost, total_cost, entry_type, reference_type, reference_id, reference_number)
       VALUES ($1, $2, $3, -2, 25, -50, 'sale', 'sale', $4, 'COSTINV')`,
      [prodId, branchA, whId, saleId],
    );

    const margins = await asUser(adminId, async () =>
      rows<{ sale_id: string; invoice_number: string; total: string; cogs: string; gross_margin: string }>(
        `SELECT sale_id, invoice_number, total, cogs, gross_margin FROM public.get_order_margin($1, NULL, NULL) WHERE sale_id = $2`, [branchA, saleId],
      ),
    );
    expect(margins.length).toBe(1);
    expect(Number(margins[0].total)).toBe(200);
    expect(Number(margins[0].cogs)).toBe(50);
    expect(Number(margins[0].gross_margin)).toBe(150);

    // Branch B manager cannot see branch A's order.
    const out = await asUser(managerBId, async () =>
      rows<{ sale_id: string }>(`SELECT sale_id FROM public.get_order_margin(NULL, NULL, NULL) WHERE sale_id = $1`, [saleId]),
    );
    expect(out.length).toBe(0);
  });

  it('get_supplier_price_impact returns raw-material price history for the branch', async () => {
    await client.query(
      `INSERT INTO public.purchases (id, invoice_number, supplier_id, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status)
       VALUES ($1, 'COSTPO', $2, $3, $4, 0, 0, 0, 0, 0, 'cash', 'completed')`,
      [randomUUID(), supplierA, branchA, whId],
    );
    const purch = await client.query<{ id: string }>(
      `SELECT id FROM public.purchases WHERE supplier_id = $1 AND branch_id = $2 ORDER BY created_at DESC LIMIT 1`, [supplierA, branchA],
    );
    await client.query(
      `INSERT INTO public.purchase_items (purchase_id, raw_material_id, unit_name, quantity, unit_cost, total)
       VALUES ($1, $2, 'kg', 5, 18, 90)`,
      [purch.rows[0].id, rmId],
    );

    const impact = await asUser(managerId, async () =>
      rows<{ item_id: string; item_type: string; first_cost: string; last_cost: string; avg_cost: string; purchase_count: string }>(
        `SELECT item_id, item_type, first_cost, last_cost, avg_cost, purchase_count FROM public.get_supplier_price_impact($1) WHERE item_id = $2`, [supplierA, rmId],
      ),
    );
    expect(impact.length).toBe(1);
    expect(impact[0].item_type).toBe('raw_material');
    expect(Number(impact[0].first_cost)).toBe(18);
    expect(Number(impact[0].last_cost)).toBe(18);
    expect(Number(impact[0].avg_cost)).toBe(18);
    expect(Number(impact[0].purchase_count)).toBe(1);
  });
});
