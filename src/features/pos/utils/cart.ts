import type { CartItem, OrderItem, Product } from '@/lib/types';

export interface ItemPayload {
  product_id: string;
  unit_name: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  bonus_quantity: number;
  total: number;
  notes?: string | null;
}

export function cartToItems(cart: CartItem[]): ItemPayload[] {
  return cart.map((i) => ({
    product_id: i.product.id,
    unit_name: i.unit_name,
    quantity: i.quantity,
    unit_price: i.unit_price,
    discount_amount: i.discount_amount,
    bonus_quantity: i.bonus_quantity,
    total: i.quantity * i.unit_price - i.discount_amount,
    notes: i.modifiers && i.modifiers.length > 0 ? i.modifiers.map((m) => m.name).join(', ') : null,
  }));
}

export function orderItemsToCart(items: OrderItem[], products: Product[]): CartItem[] {
  const prodMap: Record<string, Product> = {};
  for (const p of products) prodMap[p.id] = p;
  return items
    .map((i) => ({
      product: prodMap[i.product_id || ''],
      unit_name: i.unit_name,
      quantity: Number(i.quantity),
      unit_price: Number(i.unit_price),
      discount_amount: Number(i.discount_amount),
      bonus_quantity: Number(i.bonus_quantity),
      modifiers: i.notes ? i.notes.split(', ').map((n) => ({ name: n })) : [],
    }))
    .filter((i) => i.product)
    .map((i) => ({ ...i, product: i.product as Product }));
}

export function cartSubtotal(cart: CartItem[]): number {
  return cart.reduce((s, i) => s + i.quantity * i.unit_price - i.discount_amount, 0);
}
