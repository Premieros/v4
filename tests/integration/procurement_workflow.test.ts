import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import type pg from 'pg';

// End-to-end tests for migration 075 (P0 Procurement Workflow):
//
//   Purchase Request -> RFQ -> Supplier Quotations (comparison + selection)
//   -> Purchase Order (draft->submitted->approved) -> Receiving (GRN + ledger)
//   -> Backorders / Receipts / Supplier Evaluation, plus the hardened
//   get_supplier_price_impact (branch isolation).
//
// Every RPC is SECURITY DEFINER and enforces is_pos_admin()/can_permission()
// + branch isolation, so tests run under the `authenticated` role with the
// `app.user_id` GUC pointing at real users (admin / branch_manager / accountant).
//
// Runs inside a single BEGIN..ROLLBACK transaction — safe against the live DB.
//
//   Run:  npm run test:integration

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('procurement workflow (075)', () => {
  let client: pg.Client;
  const branchA = randomUUID();
  const branchB = randomUUID();
  const whId = randomUUID();
  const prodId = randomUUID();
  const rmId = randomUUID();
  const adminId = randomUUID();
  const managerId = randomUUID();
  const managerBId = randomUUID();
  const accountantId = randomUUID();
  const supplierA = randomUUID();
  const supplierB = randomUUID();

  type RpcResultRow = { r: { success: boolean; error?: string; detail?: string; [k: string]: unknown } };

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

  const call = async (sql: string, params: unknown[]): Promise<Record<string, unknown>> => {
    const res = await client.query<RpcResultRow>(sql, params);
    return res.rows[0].r as Record<string, unknown>;
  };

  const items = (list: { product_id?: string; raw_material_id?: string; quantity: number; unit_cost?: number; estimated_cost?: number; unit_name?: string; notes?: string }[]) =>
    JSON.stringify(list);

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);

    const orgId = randomUUID();
    await client.query(`INSERT INTO public.organizations (id, name, slug) VALUES ($1, $2, $3)`, [orgId, 'Proc Org', `proc-${randomUUID().slice(0, 8)}`]);
    await client.query(`INSERT INTO public.branches (id, name, organization_id) VALUES ($1, $2, $3), ($4, $5, $6)`, [branchA, 'Proc A', orgId, branchB, 'Proc B', orgId]);
    await client.query(`INSERT INTO public.warehouses (id, name, branch_id, is_active) VALUES ($1, $2, $3, true)`, [whId, 'Proc WH', branchA]);
    await client.query(`INSERT INTO public.products (id, name, branch_id, sale_price, cost_price, is_active) VALUES ($1, $2, $3, 200, 50, true)`, [prodId, 'Proc Product', branchA]);
    await client.query(`INSERT INTO public.raw_materials (id, code, name, branch_id, is_active) VALUES ($1, $2, $3, $4, true)`, [rmId, `RM-${rmId.slice(0, 8)}`, 'Proc Raw', branchA]);
    await client.query(`INSERT INTO public.suppliers (id, name, branch_id, balance) VALUES ($1, $2, $3, 0), ($4, $5, $6, 0)`, [supplierA, 'Supplier A', branchA, supplierB, 'Supplier B', branchB]);

    const mkUser = async (id: string, role: string, branch: string | null) => {
      await client.query(
        `INSERT INTO public.users (id, email, full_name, role, branch_id, is_active) VALUES ($1, $2, $3, $4, $5, true)`,
        [id, `proc-${randomUUID()}@test.local`, 'Proc User', role, branch],
      );
    };
    await mkUser(adminId, 'super_admin', null);
    await mkUser(managerId, 'branch_manager', branchA);
    await mkUser(managerBId, 'branch_manager', branchB);
    await mkUser(accountantId, 'accountant', branchA);
    await client.query(`INSERT INTO public.organization_members (organization_id, user_id, membership_role, is_active) VALUES ($1, $2, 'owner', true), ($1, $3, 'member', true), ($1, $4, 'member', true), ($1, $5, 'member', true)`, [orgId, adminId, managerId, managerBId, accountantId]);

    await client.query(`SELECT public.ensure_chart_of_accounts($1)`, [branchA]);
    await client.query(`SELECT public.seed_account_mappings($1)`, [branchA]);
    await client.query(`UPDATE public.settings SET tax_enabled = false`);
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }
  });

  it('rejects requests from users without purchases.manage (NOT_ALLOWED)', async () => {
    const res = await asUser(accountantId, () =>
      call(`SELECT public.create_purchase_request($1, NULL, 'normal', NULL, NULL, NULL) AS r`, [branchA]),
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe('NOT_ALLOWED');
  });

  it('create_purchase_request + item lines + status lifecycle', async () => {
    const created = await asUser(managerId, () =>
      call(
        `SELECT public.create_purchase_request($1, $2, 'high', NULL, 'urgent restock', $3::jsonb) AS r`,
        [branchA, supplierA, items([
          { product_id: prodId, quantity: 10, unit_name: 'piece', estimated_cost: 90 },
          { raw_material_id: rmId, quantity: 5, unit_name: 'kg', estimated_cost: 18 },
        ])],
      ),
    );
    expect(created.success).toBe(true);
    const requestId = created.request_id as string;
    expect(created.items_added).toBe(2);

    const reqRow = await client.query<{ status: string; priority: string; request_number: string }>(
      `SELECT status, priority, request_number FROM public.purchase_requests WHERE id = $1`, [requestId],
    );
    expect(reqRow.rows[0].status).toBe('draft');
    expect(reqRow.rows[0].priority).toBe('high');
    expect(reqRow.rows[0].request_number).toBeTruthy();

    const itemCount = await client.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM public.purchase_request_items WHERE request_id = $1`, [requestId],
    );
    expect(itemCount.rows[0].c).toBe('2');

    // draft -> approved must fail (must go through submitted)
    const bad = await asUser(managerId, () =>
      call(`SELECT public.update_purchase_request_status($1, 'approved') AS r`, [requestId]),
    );
    expect(bad.success).toBe(false);
    expect(bad.error).toBe('BAD_TRANSITION');

    // draft -> submitted -> approved
    const sub = await asUser(managerId, () =>
      call(`SELECT public.update_purchase_request_status($1, 'submitted') AS r`, [requestId]),
    );
    expect(sub.success).toBe(true);
    const appr = await asUser(managerId, () =>
      call(`SELECT public.update_purchase_request_status($1, 'approved') AS r`, [requestId]),
    );
    expect(appr.success).toBe(true);

    const approved = await client.query<{ status: string; approved_by: string | null }>(
      `SELECT status, approved_by FROM public.purchase_requests WHERE id = $1`, [requestId],
    );
    expect(approved.rows[0].status).toBe('approved');
    expect(approved.rows[0].approved_by).toBe(managerId);
  });

  it('enforces branch isolation on create_purchase_request', async () => {
    const res = await asUser(managerId, () =>
      call(`SELECT public.create_purchase_request($1, NULL, 'normal', NULL, NULL, NULL) AS r`, [branchB]),
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe('BRANCH_MISMATCH');

    // Admin can create for any branch.
    const adminOk = await asUser(adminId, () =>
      call(`SELECT public.create_purchase_request($1, NULL, 'normal', NULL, NULL, NULL) AS r`, [branchB]),
    );
    expect(adminOk.success).toBe(true);
  });

  it('create_rfq from an approved request copies its items', async () => {
    const approved = await client.query<{ id: string }>(
      `SELECT id FROM public.purchase_requests WHERE branch_id = $1 AND status = 'approved' LIMIT 1`, [branchA],
    );
    const rfq = await asUser(managerId, () =>
      call(`SELECT public.create_rfq($1, $2, NULL, 'get quotes', NULL) AS r`, [branchA, approved.rows[0].id]),
    );
    expect(rfq.success).toBe(true);
    const rfqId = rfq.rfq_id as string;
    expect(rfq.items_added).toBe(2);

    const sent = await asUser(managerId, () =>
      call(`SELECT public.update_rfq_status($1, 'sent') AS r`, [rfqId]),
    );
    expect(sent.success).toBe(true);

    // Reject quotation from a supplier outside the RFQ branch.
    const wrongSupp = await asUser(managerId, () =>
      call(`SELECT public.record_supplier_quotation($1, $2, NULL, NULL, NULL, $3::jsonb) AS r`,
        [rfqId, supplierB, items([{ product_id: prodId, quantity: 10, unit_cost: 90 }])]),
    );
    expect(wrongSupp.success).toBe(false);
    expect(wrongSupp.error).toBe('SUPPLIER_NOT_IN_BRANCH');

    // Two quotations from branch-local suppliers.
    const q1 = await asUser(managerId, () =>
      call(`SELECT public.record_supplier_quotation($1, $2, NULL, 5, NULL, $3::jsonb) AS r`,
        [rfqId, supplierA, items([
          { product_id: prodId, quantity: 10, unit_cost: 95 },
          { raw_material_id: rmId, quantity: 5, unit_cost: 20 },
        ])]),
    );
    expect(q1.success).toBe(true);
    expect(q1.total).toBe(1050);

    const q2 = await asUser(managerId, () =>
      call(`SELECT public.record_supplier_quotation($1, $2, NULL, 3, NULL, $3::jsonb) AS r`,
        [rfqId, supplierA, items([{ product_id: prodId, quantity: 10, unit_cost: 88 }])]),
    );
    expect(q2.success).toBe(true);

    // Comparison returns one row per requested line with both quotes.
    const comparison = await asUser(managerId, async () => {
      const res = await client.query<{ item_id: string; item_type: string; best_unit_cost: number | null; quotation_count: number }>(
        `SELECT item_id, item_type, best_unit_cost, quotation_count FROM public.get_rfq_comparison($1)`, [rfqId],
      );
      return res.rows;
    });
    expect(comparison.length).toBe(2);
    const productLine = comparison.find((r) => r.item_id === prodId);
    expect(productLine).toBeTruthy();
    expect(Number(productLine!.best_unit_cost)).toBe(88);
    expect(Number(productLine!.quotation_count)).toBe(2);

    // Select the winning quotation -> RFQ awarded, others rejected.
    const selected = await asUser(managerId, () =>
      call(`SELECT public.select_supplier_quotation($1) AS r`, [q2.quotation_id as string]),
    );
    expect(selected.success).toBe(true);
    const quoteStatus = await client.query<{ status: string }>(
      `SELECT status FROM public.supplier_quotations WHERE id = $1`, [q2.quotation_id as string],
    );
    expect(quoteStatus.rows[0].status).toBe('selected');
    const rfqStatus = await client.query<{ status: string }>(`SELECT status FROM public.rfqs WHERE id = $1`, [rfqId]);
    expect(rfqStatus.rows[0].status).toBe('awarded');
  });

  it('create_purchase_order from selected quotation then approval workflow', async () => {
    const quote = await client.query<{ id: string }>(
      `SELECT id FROM public.supplier_quotations WHERE status = 'selected' LIMIT 1`,
    );
    const po = await asUser(managerId, () =>
      call(`SELECT public.create_purchase_order($1, $2, $3, 'cash', 'PO from quote', NULL, $4) AS r`,
        [branchA, supplierA, whId, quote.rows[0].id]),
    );
    expect(po.success).toBe(true);
    expect(po.items_added).toBe(1);
    const purchaseId = po.purchase_id as string;

    const poRow = await client.query<{ status: string; total: string; request_id: string | null }>(
      `SELECT status, total, request_id FROM public.purchases WHERE id = $1`, [purchaseId],
    );
    expect(poRow.rows[0].status).toBe('draft');
    expect(Number(poRow.rows[0].total)).toBe(880);
    // The originating request is now 'ordered'.
    const reqStatus = await client.query<{ status: string }>(
      `SELECT status FROM public.purchase_requests WHERE id = $1`, [poRow.rows[0].request_id],
    );
    expect(reqStatus.rows[0].status).toBe('ordered');

    // draft -> approved directly must fail.
    const bad = await asUser(managerId, () =>
      call(`SELECT public.update_purchase_order_status($1, 'approved') AS r`, [purchaseId]),
    );
    expect(bad.success).toBe(false);
    expect(bad.error).toBe('BAD_TRANSITION');

    const sub = await asUser(managerId, () =>
      call(`SELECT public.update_purchase_order_status($1, 'submitted') AS r`, [purchaseId]),
    );
    expect(sub.success).toBe(true);
    const appr = await asUser(managerId, () =>
      call(`SELECT public.update_purchase_order_status($1, 'approved') AS r`, [purchaseId]),
    );
    expect(appr.success).toBe(true);
  });

  it('receive_purchase_order: partial receipt, backorders, then completion posts the ledger', async () => {
    const po = await client.query<{ id: string; invoice_number: string }>(
      `SELECT id, invoice_number FROM public.purchases WHERE status = 'approved' AND branch_id = $1 LIMIT 1`, [branchA],
    );
    const items = await client.query<{ id: string; product_id: string | null; raw_material_id: string | null; quantity: string; received_quantity: string }>(
      `SELECT id, product_id, raw_material_id, quantity, received_quantity FROM public.purchase_items WHERE purchase_id = $1`, [po.rows[0].id],
    );
    expect(items.rows.length).toBe(1);
    const productItem = items.rows.find((i) => i.product_id === prodId)!;

    // Over-receipt must be rejected.
    const over = await asUser(managerId, () =>
      call(`SELECT public.receive_purchase_order($1, $2::jsonb) AS r`,
        [po.rows[0].id, JSON.stringify([{ purchase_item_id: productItem.id, quantity_received: 99 }])]),
    );
    expect(over.success).toBe(false);
    expect(over.error).toBe('OVER_RECEIPT');

    // Partial receipt of the product line only.
    const partial = await asUser(managerId, () =>
      call(`SELECT public.receive_purchase_order($1, $2::jsonb) AS r`,
        [po.rows[0].id, JSON.stringify([{ purchase_item_id: productItem.id, quantity_received: 4 }])]),
    );
    expect(partial.success).toBe(true);
    expect(partial.status).toBe('partial');
    expect(partial.fully_received).toBe(false);

    const backorders = await asUser(managerId, async () => {
      const res = await client.query<{ purchase_id: string; remaining: string }>(
        `SELECT purchase_id, remaining FROM public.get_purchase_backorders($1)`, [branchA],
      );
      return res.rows;
    });
    const bo = backorders.find((b) => b.purchase_id === po.rows[0].id);
    expect(bo).toBeTruthy();
    expect(Number(bo!.remaining)).toBeGreaterThan(0);

    // Inventory for the received product increased.
    const inv = await client.query<{ qty: string }>(
      `SELECT COALESCE(SUM(quantity), 0)::text AS qty FROM public.inventory_batches WHERE product_id = $1 AND branch_id = $2`, [prodId, branchA],
    );
    expect(Number(inv.rows[0].qty)).toBe(4);

    // Complete the receipt (product remainder).
    const complete = await asUser(managerId, () =>
      call(`SELECT public.receive_purchase_order($1, $2::jsonb) AS r`,
        [po.rows[0].id, JSON.stringify([{ purchase_item_id: productItem.id, quantity_received: 6 }])]),
    );
    expect(complete.success).toBe(true);
    expect(complete.status).toBe('completed');
    expect(complete.fully_received).toBe(true);

    // No backorders remain for this PO.
    const boAfter = await asUser(managerId, async () => {
      const res = await client.query<{ purchase_id: string }>(
        `SELECT purchase_id FROM public.get_purchase_backorders($1)`, [branchA],
      );
      return res.rows;
    });
    expect(boAfter.find((b) => b.purchase_id === po.rows[0].id)).toBeUndefined();

    // Ledger entry was posted on full receipt.
    const ledger = await client.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM public.journal_entries WHERE reference_type = 'purchase' AND reference_id = $1`, [po.rows[0].id],
    );
    expect(Number(ledger.rows[0].c)).toBeGreaterThan(0);

    // Receipts list shows both GRNs.
    const receipts = await asUser(managerId, async () => {
      const res = await client.query<{ receipt_id: string; invoice_number: string }>(
        `SELECT receipt_id, invoice_number FROM public.get_purchase_receipts($1)`, [branchA],
      );
      return res.rows;
    });
    expect(receipts.length).toBeGreaterThanOrEqual(2);
    expect(receipts.some((r) => r.invoice_number === po.rows[0].invoice_number)).toBe(true);
  });

  it('supplier evaluation aggregates real documents', async () => {
    const ev = await asUser(managerId, async () => {
      const res = await client.query<{ supplier_id: string; orders_count: string; total_purchased: string; return_rate: string }>(
        `SELECT supplier_id, orders_count, total_purchased, return_rate FROM public.get_supplier_evaluation($1)`, [branchA],
      );
      return res.rows;
    });
    const row = ev.find((r) => r.supplier_id === supplierA);
    expect(row).toBeTruthy();
    expect(Number(row!.orders_count)).toBe(1);
    expect(Number(row!.total_purchased)).toBe(880);
    expect(Number(row!.return_rate)).toBe(0);
  });

  it('hardened get_supplier_price_impact is branch-isolated', async () => {
    // Manager of branch A sees the completed purchase for supplier A.
    const inBranch = await asUser(managerId, async () => {
      const res = await client.query<{ item_id: string; item_type: string; purchase_count: string }>(
        `SELECT item_id, item_type, purchase_count FROM public.get_supplier_price_impact($1)`, [supplierA],
      );
      return res.rows;
    });
    expect(inBranch.some((r) => r.item_id === prodId)).toBe(true);

    // Manager of branch B sees nothing for supplier A (foreign branch).
    const outBranch = await asUser(managerBId, async () => {
      const res = await client.query<{ item_id: string }>(
        `SELECT item_id FROM public.get_supplier_price_impact($1)`, [supplierA],
      );
      return res.rows;
    });
    expect(outBranch.length).toBe(0);
  });
});
