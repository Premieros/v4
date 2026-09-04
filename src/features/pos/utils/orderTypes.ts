import type { DiningTableStatus, OrderType } from '@/lib/types';
import type { TranslationKey } from '@/lib/i18n';

export const ORDER_TYPE_KEY: Record<OrderType, TranslationKey> = {
  dine_in: 'dineIn',
  takeaway: 'takeaway',
  delivery: 'delivery',
  drive_thru: 'driveThru',
} as const;

export const ORDER_TYPES: readonly OrderType[] = ['dine_in', 'takeaway', 'delivery', 'drive_thru'] as const;

export interface TableStatusStyle {
  label: DiningTableStatus;
  card: string;
  badge: string;
  dot: string;
}

export const STATUS_STYLES: Record<DiningTableStatus, TableStatusStyle> = {
  vacant: { label: 'vacant', card: 'border-ui-success/50 bg-ui-success/10', badge: 'bg-ui-success/15 text-ui-success', dot: 'bg-ui-success' },
  occupied: { label: 'occupied', card: 'border-ui-warning/60 bg-ui-warning/10', badge: 'bg-ui-warning/15 text-ui-warning', dot: 'bg-ui-warning' },
  reserved: { label: 'reserved', card: 'border-ui-info/50 bg-ui-info/10', badge: 'bg-ui-info/15 text-ui-info', dot: 'bg-ui-info' },
  closed: { label: 'closed', card: 'border-ui-border bg-ui-page-alt', badge: 'bg-ui-page-alt text-ui-muted', dot: 'bg-ui-subtle' },
};
