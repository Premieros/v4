import type { CartItem, OrderItem } from '@/lib/types';
import type { KitchenSendItem } from '../types';

export interface SentLineState {
  sentQty: number;
  newQty: number;
  sent: boolean;
  partial: boolean;
}

// Derive kitchen state from persisted order-item identity first.
// A product id is not an order-line identity: the same product can be
// changed/added while an order is still open. sessionSent is only a fallback
// for the short realtime gap immediately after send_to_kitchen returns, and
// may never promote a cart line to "sent" unless its order_item_id belongs to
// the current persisted order.
export function computeSentState(
  cart: CartItem[],
  orderItems: OrderItem[],
  sentOrderItemIds: Set<string>,
  sessionSent: KitchenSendItem[],
): Record<string, SentLineState> {
  const qtyByProduct: Record<string, number> = {};
  for (const item of cart) qtyByProduct[item.product.id] = item.quantity;

  const map: Record<string, SentLineState> = {};
  for (const pid of Object.keys(qtyByProduct)) {
    map[pid] = {
      sentQty: 0,
      newQty: qtyByProduct[pid],
      sent: false,
      partial: false,
    };
  }

  // The authoritative source is the current order_items + kitchen-send
  // relation. This keeps newly added order lines unsent even when the realtime
  // stream is briefly behind the cart update.
  for (const oi of orderItems) {
    const pid = oi.product_id;
    if (!pid || !map[pid] || !sentOrderItemIds.has(oi.id)) continue;
    map[pid].sentQty += Math.max(0, Number(oi.quantity) || 0);
  }

  // sessionSent is a realtime-gap fallback, but only for an order_item that is
  // already known to belong to the current order. Never use product_id alone:
  // doing so can leak a previous/old send state onto a newly added cart line.
  const currentOrderItemIds = new Set(orderItems.map((oi) => oi.id));
  for (const s of sessionSent) {
    if (!currentOrderItemIds.has(s.order_item_id)) continue;
    const pid = s.product_id;
    if (!pid || !map[pid]) continue;
    const qty = Math.max(0, Number(s.quantity) || 0);
    if (qty > map[pid].sentQty) map[pid].sentQty = qty;
  }

  for (const pid of Object.keys(map)) {
    const qty = qtyByProduct[pid];
    const sent = Math.min(map[pid].sentQty, qty);
    map[pid].sentQty = sent;
    map[pid].newQty = Math.max(0, qty - sent);
    map[pid].sent = sent > 0 && map[pid].newQty === 0;
    map[pid].partial = sent > 0 && map[pid].newQty > 0;
  }

  return map;
}
