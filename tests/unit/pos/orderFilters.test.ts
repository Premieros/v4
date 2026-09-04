import { describe, expect, it } from 'vitest';
import {
  countActiveOrders,
  filterOrdersByStatus,
  filterOrdersByType,
} from '@/features/pos/utils/orderFilters';
import type { Order } from '@/lib/types';

function makeOrder(overrides: Partial<Order>): Order {
  return {
    id: 'o1',
    order_number: 'OR-1',
    branch_id: 'b1',
    order_type: 'dine_in',
    status: 'open',
    table_id: null,
    customer_id: null,
    cashier_id: null,
    guest_count: null,
    notes: null,
    subtotal: 100,
    discount_amount: 0,
    discount_type: 'amount',
    tax_amount: 0,
    total: 100,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    completed_at: null,
    ...overrides,
  };
}

const orders: Order[] = [
  makeOrder({ id: '1', order_type: 'dine_in', status: 'open' }),
  makeOrder({ id: '2', order_type: 'takeaway', status: 'held' }),
  makeOrder({ id: '3', order_type: 'delivery', status: 'open' }),
  makeOrder({ id: '4', order_type: 'drive_thru', status: 'held' }),
];

describe('filterOrdersByType', () => {
  it('returns all orders for an empty filter', () => {
    expect(filterOrdersByType(orders, '')).toHaveLength(4);
  });

  it('filters by order type', () => {
    const out = filterOrdersByType(orders, 'delivery');
    expect(out.map((o) => o.id)).toEqual(['3']);
  });
});

describe('filterOrdersByStatus', () => {
  it('returns all orders for status "all"', () => {
    expect(filterOrdersByStatus(orders, 'all')).toHaveLength(4);
  });

  it('filters by order status', () => {
    const out = filterOrdersByStatus(orders, 'held');
    expect(out.map((o) => o.id)).toEqual(['2', '4']);
  });
});

describe('countActiveOrders', () => {
  it('counts active/open/held/type buckets', () => {
    expect(countActiveOrders(orders)).toEqual({
      active: 4,
      open: 2,
      held: 2,
      dineIn: 1,
      takeaway: 1,
      delivery: 1,
      driveThru: 1,
    });
  });

  it('handles an empty list', () => {
    expect(countActiveOrders([])).toEqual({
      active: 0,
      open: 0,
      held: 0,
      dineIn: 0,
      takeaway: 0,
      delivery: 0,
      driveThru: 0,
    });
  });
});
