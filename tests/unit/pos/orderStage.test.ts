import { describe, expect, it } from 'vitest';
import { deriveOrderStage, deriveCartStage } from '@/features/pos/utils/orderStage';
import type { Order, OrderItem } from '@/lib/types';
import type { OrderKitchenSend } from '@/features/pos/types';

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

function makeItem(id: string, productId: string, quantity: number): OrderItem {
  return {
    id,
    order_id: 'o1',
    product_id: productId,
    unit_name: 'piece',
    quantity,
    unit_price: 10,
    discount_amount: 0,
    bonus_quantity: 0,
    total: quantity * 10,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
  };
}

function makeSend(orderItemId: string): OrderKitchenSend {
  return {
    id: `s-${orderItemId}`,
    branch_id: 'b1',
    order_id: 'o1',
    order_item_id: orderItemId,
    sent_at: '2026-01-01T00:00:00Z',
    sent_by: null,
  };
}

describe('deriveOrderStage', () => {
  it('returns hold for held orders regardless of sends', () => {
    expect(deriveOrderStage(makeOrder({ status: 'held' }), [makeItem('i1', 'p1', 2)], [makeSend('i1')])).toBe('hold');
  });

  it('returns open when nothing has been sent to the kitchen', () => {
    expect(deriveOrderStage(makeOrder({}), [makeItem('i1', 'p1', 2)], [])).toBe('open');
  });

  it('returns kitchen for partial sends', () => {
    const items = [makeItem('i1', 'p1', 2), makeItem('i2', 'p2', 1)];
    expect(deriveOrderStage(makeOrder({}), items, [makeSend('i1')])).toBe('kitchen');
  });

  it('returns ready when all item quantities are sent', () => {
    const items = [makeItem('i1', 'p1', 2), makeItem('i2', 'p2', 1)];
    expect(deriveOrderStage(makeOrder({}), items, [makeSend('i1'), makeSend('i2')])).toBe('ready');
  });

  it('returns open for an empty order', () => {
    expect(deriveOrderStage(makeOrder({}), [], [])).toBe('open');
  });
});

describe('deriveCartStage', () => {
  const cart = [{ product: { id: 'p1' }, quantity: 2 }];

  it('returns hold when held', () => {
    expect(deriveCartStage(cart, {}, true)).toBe('hold');
  });

  it('returns open when nothing sent', () => {
    expect(deriveCartStage(cart, { p1: { sentQty: 0, newQty: 2 } }, false)).toBe('open');
  });

  it('returns kitchen on partial send', () => {
    expect(deriveCartStage(cart, { p1: { sentQty: 1, newQty: 1 } }, false)).toBe('kitchen');
  });

  it('returns ready when fully sent', () => {
    expect(deriveCartStage(cart, { p1: { sentQty: 2, newQty: 0 } }, false)).toBe('ready');
  });
});
