import type { Order } from '@/lib/types';
import type { TranslationKey } from '@/lib/i18n';

export type PosOrderState = 'open' | 'sent' | 'hold' | 'payment' | 'paid' | 'closed';

export interface OrderStateStyle {
  label: TranslationKey;
  badge: string;
  dot: string;
  text: string;
}

export function deriveOrderState(order: Order, hasKitchenSends: boolean): PosOrderState {
  if (order.status === 'held') return 'hold';
  if (order.status === 'cancelled') return 'closed';
  if (order.status === 'completed') return 'paid';
  return hasKitchenSends ? 'sent' : 'open';
}

export const ORDER_STATE_STYLES: Record<PosOrderState, OrderStateStyle> = {
  open: {
    label: 'open',
    badge: 'bg-ui-primary-soft text-ui-accent',
    dot: 'bg-ui-accent',
    text: 'text-ui-accent',
  },
  sent: {
    label: 'inKitchen',
    badge: 'bg-ui-warning/15 text-ui-warning',
    dot: 'bg-ui-warning',
    text: 'text-ui-warning',
  },
  hold: {
    label: 'holdOrder',
    badge: 'bg-ui-warning/15 text-ui-warning',
    dot: 'bg-ui-warning',
    text: 'text-ui-warning',
  },
  payment: {
    label: 'payOrder',
    badge: 'bg-ui-success/15 text-ui-success',
    dot: 'bg-ui-success',
    text: 'text-ui-success',
  },
  paid: {
    label: 'paid',
    badge: 'bg-ui-success/15 text-ui-success',
    dot: 'bg-ui-success',
    text: 'text-ui-success',
  },
  closed: {
    label: 'orderClosed',
    badge: 'bg-ui-page-alt text-ui-muted',
    dot: 'bg-ui-subtle',
    text: 'text-ui-muted',
  },
};
