import { describe, it, expect } from 'vitest';
import {
  suggestProductReorderQty,
  suggestRawReorderQty,
  buildProductReorderLines,
  buildRawReorderLines,
  reorderLinesToProcurementItems,
} from '@/lib/reorder';
import type { LowStockAlertRow } from '@/lib/types';

const alert = (over: Partial<LowStockAlertRow>): LowStockAlertRow => ({
  product_id: 'p1',
  product_name: 'Cola',
  barcode: '123',
  sku: null,
  warehouse_id: 'w1',
  warehouse_name: 'WH1',
  branch_id: 'b1',
  quantity: 5,
  min_stock: 0,
  max_stock: 0,
  reorder_point: 0,
  low_stock_threshold: 10,
  shortage_qty: 5,
  status: 'low',
  ...over,
});

describe('reorder suggestion logic', () => {
  it('uses max_stock when set, otherwise shortage', () => {
    expect(suggestProductReorderQty({ on_hand: 5, max_stock: 20, shortage_qty: 5, status: 'low' })).toBe(15);
    expect(suggestProductReorderQty({ on_hand: 5, max_stock: 0, shortage_qty: 5, status: 'low' })).toBe(5);
  });

  it('never suggests a negative quantity', () => {
    expect(suggestProductReorderQty({ on_hand: 25, max_stock: 20, shortage_qty: 0, status: 'ok' })).toBe(0);
  });

  it('forces at least 1 when the product is out of stock', () => {
    expect(suggestProductReorderQty({ on_hand: 0, max_stock: 0, shortage_qty: 0, status: 'out' })).toBe(1);
  });

  it('raw materials suggest up to min_stock', () => {
    expect(suggestRawReorderQty({ quantity: 3, min_stock: 10 })).toBe(7);
    expect(suggestRawReorderQty({ quantity: 12, min_stock: 10 })).toBe(0);
    expect(suggestRawReorderQty({ quantity: 0, min_stock: 0 })).toBe(1);
  });
});

describe('buildProductReorderLines', () => {
  it('aggregates warehouses per product and sums on-hand', () => {
    const lines = buildProductReorderLines([
      alert({ product_id: 'p1', quantity: 4, max_stock: 10, status: 'low' }),
      alert({ product_id: 'p1', quantity: 3, max_stock: 10, status: 'low' }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].on_hand).toBe(7);
    expect(lines[0].suggested_qty).toBe(3);
    expect(lines[0].item_type).toBe('product');
  });

  it('drops ok rows and lines with nothing to suggest', () => {
    const lines = buildProductReorderLines([
      alert({ product_id: 'p1', status: 'ok' }),
      alert({ product_id: 'p2', quantity: 20, max_stock: 10, status: 'low' }),
    ]);
    expect(lines).toHaveLength(0);
  });

  it('uses worst status across warehouses', () => {
    const lines = buildProductReorderLines([
      alert({ product_id: 'p1', quantity: 0, max_stock: 0, reorder_point: 0, shortage_qty: 0, status: 'out' }),
      alert({ product_id: 'p1', quantity: 4, max_stock: 0, shortage_qty: 6, status: 'low' }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].on_hand).toBe(4);
    expect(lines[0].suggested_qty).toBeGreaterThan(0);
  });
});

describe('buildRawReorderLines', () => {
  it('builds a raw line per material below min_stock', () => {
    const lines = buildRawReorderLines([
      { raw_material_id: 'r1', name: 'Flour', unit_name: 'kg', quantity: 2, min_stock: 10, default_cost: 5 },
      { raw_material_id: 'r2', name: 'Sugar', unit_name: 'kg', quantity: 50, min_stock: 10, default_cost: 8 },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].item_type).toBe('raw');
    expect(lines[0].suggested_qty).toBe(8);
    expect(lines[0].estimated_cost).toBe(5);
    expect(lines[0].unit_name).toBe('kg');
  });
});

describe('reorderLinesToProcurementItems', () => {
  it('maps lines to procurement inputs with overrides', () => {
    const lines = buildProductReorderLines([alert({ product_id: 'p1', quantity: 5, max_stock: 20, status: 'low' })]);
    const items = reorderLinesToProcurementItems(lines, { [lines[0].key]: 12 });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ product_id: 'p1', quantity: 12, unit_name: 'piece' });
  });

  it('filters out zero-quantity lines', () => {
    const lines = buildProductReorderLines([alert({ product_id: 'p1', quantity: 5, max_stock: 20, status: 'low' })]);
    const items = reorderLinesToProcurementItems(lines, { [lines[0].key]: 0 });
    expect(items).toHaveLength(0);
  });
});
