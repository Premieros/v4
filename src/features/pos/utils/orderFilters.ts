import type { Order, OrderStatus, OrderType } from '@/lib/types';

export function filterOrdersByType(orders: Order[], type: OrderType | ''): Order[] {
  if (!type) return orders;
  return orders.filter((o) => o.order_type === type);
}

export function filterOrdersByStatus(orders: Order[], status: 'all' | OrderStatus): Order[] {
  if (status === 'all') return orders;
  return orders.filter((o) => o.status === status);
}

export interface ActiveOrderCounts {
  active: number;
  open: number;
  held: number;
  dineIn: number;
  takeaway: number;
  delivery: number;
  driveThru: number;
}

export function countActiveOrders(orders: Order[]): ActiveOrderCounts {
  const counts: ActiveOrderCounts = { active: 0, open: 0, held: 0, dineIn: 0, takeaway: 0, delivery: 0, driveThru: 0 };
  for (const o of orders) {
    counts.active += 1;
    if (o.status === 'open') counts.open += 1;
    if (o.status === 'held') counts.held += 1;
    if (o.order_type === 'dine_in') counts.dineIn += 1;
    if (o.order_type === 'takeaway') counts.takeaway += 1;
    if (o.order_type === 'delivery') counts.delivery += 1;
    if (o.order_type === 'drive_thru') counts.driveThru += 1;
  }
  return counts;
}
