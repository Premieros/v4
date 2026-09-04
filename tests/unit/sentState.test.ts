import { describe, expect, it } from 'vitest';
import { computeSentState } from '@/features/pos/utils/sentState';
import type { CartItem, OrderItem, Product } from '@/lib/types';
import type { KitchenSendItem } from '@/features/pos/types';

const product = (id: string, name = id) => ({
  id,
  name,
  name_en: name,
  sale_price: 10,
} as Product);

const cartItem = (p: Product, quantity = 1) => ({
  product: p,
  unit_name: 'piece',
  quantity,
  unit_price: 10,
  discount_amount: 0,
  bonus_quantity: 0,
} as CartItem);

const orderItem = (id: string, productId: string, quantity = 1) => ({
  id,
  product_id: productId,
  quantity,
} as OrderItem);

const kitchenSend = (orderItemId: string, productId: string, quantity = 1) => ({
  send_id: `send-${orderItemId}`,
  order_item_id: orderItemId,
  product_id: productId,
  product_name: productId,
  unit_name: 'piece',
  quantity,
  unit_price: 10,
  discount_amount: 0,
  bonus_quantity: 0,
  total: quantity * 10,
  notes: null,
} as KitchenSendItem);

describe('computeSentState', () => {
  it('keeps a newly added product unsent after earlier lines were sent', () => {
    const burger = product('burger');
    const fries = product('fries');
    const cart = [cartItem(burger), cartItem(fries)];
    const items = [orderItem('item-burger', 'burger'), orderItem('item-fries', 'fries')];

    const state = computeSentState(
      cart,
      items,
      new Set(['item-burger']),
      [kitchenSend('item-burger', 'burger')],
    );

    expect(state.burger.sent).toBe(true);
    expect(state.burger.newQty).toBe(0);
    expect(state.fries.sent).toBe(false);
    expect(state.fries.newQty).toBe(1);
  });

  it('does not leak a stale session send onto a newly added line', () => {
    const burger = product('burger');
    const cart = [cartItem(burger)];
    const items: OrderItem[] = [];

    const state = computeSentState(
      cart,
      items,
      new Set(),
      [kitchenSend('old-order-item', 'burger')],
    );

    expect(state.burger.sent).toBe(false);
    expect(state.burger.newQty).toBe(1);
  });

  it('preserves partial state when an existing line has additional unsent quantity', () => {
    const burger = product('burger');
    const cart = [cartItem(burger, 2)];
    const items = [orderItem('item-burger', 'burger', 2)];

    const state = computeSentState(
      cart,
      items,
      new Set(['item-burger']),
      [kitchenSend('item-burger', 'burger', 1)],
    );

    expect(state.burger.sentQty).toBe(2);
    expect(state.burger.newQty).toBe(0);
    expect(state.burger.sent).toBe(true);
  });
});
