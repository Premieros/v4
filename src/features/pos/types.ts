import type { DiningTable, Order, OrderItem } from '@/lib/types';

export interface OrderKitchenSend {
  id: string;
  branch_id: string;
  order_id: string;
  order_item_id: string;
  sent_at: string;
  sent_by: string | null;
}

export interface KitchenSendItem {
  send_id: string;
  order_item_id: string;
  product_id: string | null;
  product_name: string | null;
  unit_name: string | null;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  bonus_quantity: number;
  total: number;
  notes: string | null;
}

export interface KitchenSendResult {
  success: boolean;
  order_id?: string;
  sent?: KitchenSendItem[];
  items_sent_count?: number;
  all_sent?: boolean;
  error?: string;
  detail?: string;
}

export interface PosRealtimeData {
  orders: Order[];
  tables: DiningTable[];
  orderItems: OrderItem[];
  kitchenSends: OrderKitchenSend[];
}
