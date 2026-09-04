import type { Product } from './catalog';

export type OrderType = 'dine_in' | 'takeaway' | 'delivery' | 'drive_thru';
export type DiningTableStatus = 'vacant' | 'occupied' | 'reserved' | 'closed';
export type OrderStatus = 'open' | 'held' | 'completed' | 'cancelled';

export interface PosSummary {
  occupiedTables: number;
  heldOrders: number;
  deliveryOrders: number;
  takeawayOrders: number;
  activeOrders: number;
}

export interface DiningArea {
  id: string;
  branch_id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface DiningTableLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DiningTable {
  id: string;
  branch_id: string;
  area_id: string | null;
  name: string;
  capacity: number;
  status: DiningTableStatus;
  shape: string;
  layout: DiningTableLayout;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Order {
  id: string;
  order_number: string;
  branch_id: string;
  order_type: OrderType;
  status: OrderStatus;
  table_id: string | null;
  customer_id: string | null;
  cashier_id: string | null;
  guest_count: number | null;
  notes: string | null;
  subtotal: number;
  discount_amount: number;
  discount_type: string;
  tax_amount: number;
  total: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  table?: DiningTable;
  items?: OrderItem[];
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string | null;
  unit_name: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  bonus_quantity: number;
  total: number;
  notes: string | null;
  created_at: string;
  product?: Product;
}
