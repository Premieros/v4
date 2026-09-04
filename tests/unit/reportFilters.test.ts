import { describe, expect, it } from 'vitest';
import {
  ALL_REPORT_TYPES,
  DATE_DRIVEN_REPORTS,
  REPORT_FILTER_DIMS,
  REPORT_FILTER_KEYS,
  applyExpenseFilters,
  applyProductScopedFilters,
  applyPurchaseFilters,
  applySaleItemFilters,
  applySalesFilters,
  type ReportFilters,
} from '@/features/reporting/reportFilters';

function makeBuilder() {
  const calls: [string, unknown][] = [];
  const builder = {
    eq(column: string, value: unknown) {
      calls.push([column, value]);
      return builder;
    },
    calls,
  };
  return builder;
}

describe('reportFilters (ERP-01 §6)', () => {
  it('covers every operational report type with a valid filter dimension set', () => {
    for (const type of ALL_REPORT_TYPES) {
      const dims = REPORT_FILTER_DIMS[type];
      expect(Array.isArray(dims), `${type} must declare filter dimensions`).toBe(true);
      for (const dim of dims) {
        expect(REPORT_FILTER_KEYS).toContain(dim);
      }
    }
  });

  it('hides the date range for snapshot/static reports', () => {
    for (const type of DATE_DRIVEN_REPORTS) {
      expect(REPORT_FILTER_DIMS[type], `${type} is date-driven`).toBeDefined();
    }
    expect(DATE_DRIVEN_REPORTS.has('inventory')).toBe(false);
    expect(DATE_DRIVEN_REPORTS.has('recipe_costs')).toBe(false);
    expect(DATE_DRIVEN_REPORTS.has('low_stock')).toBe(false);
  });

  it('applies only the set sales filters to the query builder', () => {
    const builder = makeBuilder();
    const result = applySalesFilters(builder, {
      warehouse: 'w1', cashier: 'c1', customer: 'cu1', order_type: 'dine_in',
      payment_method: 'cash', status: 'completed', table: 't1',
    });
    expect(result).toBe(builder);
    expect(builder.calls).toEqual([
      ['warehouse_id', 'w1'],
      ['cashier_id', 'c1'],
      ['customer_id', 'cu1'],
      ['order_type', 'dine_in'],
      ['payment_method', 'cash'],
      ['status', 'completed'],
      ['table_id', 't1'],
    ]);
  });

  it('leaves the builder untouched when no filters are set', () => {
    const builder = makeBuilder();
    applySalesFilters(builder, {});
    expect(builder.calls).toEqual([]);
  });

  it('prefixes nested relations for sale-item reports (product./sale.)', () => {
    const builder = makeBuilder();
    applySaleItemFilters(builder, {
      product: 'p1', category: 'cat1', order_type: 'delivery', warehouse: 'w1',
      cashier: 'c1', customer: 'cu1', payment_method: 'card', status: 'refunded',
    });
    expect(builder.calls).toEqual([
      ['product_id', 'p1'],
      ['product.category_id', 'cat1'],
      ['sale.order_type', 'delivery'],
      ['sale.warehouse_id', 'w1'],
      ['sale.cashier_id', 'c1'],
      ['sale.customer_id', 'cu1'],
      ['sale.payment_method', 'card'],
      ['sale.status', 'refunded'],
    ]);
  });

  it('maps purchase filters to supplier/buyer/warehouse/status columns', () => {
    const builder = makeBuilder();
    applyPurchaseFilters(builder, { supplier: 's1', buyer: 'b1', warehouse: 'w1', status: 'completed' });
    expect(builder.calls).toEqual([
      ['supplier_id', 's1'],
      ['buyer_id', 'b1'],
      ['warehouse_id', 'w1'],
      ['status', 'completed'],
    ]);
  });

  it('maps expense filters to the plain category/payment_method columns', () => {
    const builder = makeBuilder();
    applyExpenseFilters(builder, { category: 'Rent', payment_method: 'transfer' });
    expect(builder.calls).toEqual([
      ['payment_method', 'transfer'],
      ['category', 'Rent'],
    ]);
  });

  it('maps product-scoped filters (inventory/stock transactions) including embedded category', () => {
    const builder = makeBuilder();
    applyProductScopedFilters(builder, { warehouse: 'w1', product: 'p1', category: 'cat1' });
    expect(builder.calls).toEqual([
      ['warehouse_id', 'w1'],
      ['product_id', 'p1'],
      ['product.category_id', 'cat1'],
    ]);
  });

  it('keeps empty filters object behavior stable', () => {
    const f: ReportFilters = {};
    expect(Object.keys(f)).toHaveLength(0);
  });
});
