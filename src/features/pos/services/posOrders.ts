import { supabase, pos as posApi } from '@/api';
import type { Branch, Customer, DiningTable, Order, OrderItem, Product } from '@/lib/types';
import type { OrderKitchenSend, PosRealtimeData } from '../types';

export const EMPTY_POS_REALTIME: PosRealtimeData = {
  orders: [],
  tables: [],
  orderItems: [],
  kitchenSends: [],
};

export async function fetchActiveOrders(branchId: string): Promise<PosRealtimeData> {
  const [tRes, oRes] = await Promise.all([
    supabase.from('dining_tables').select('*').eq('branch_id', branchId).order('name'),
    supabase.from('orders')
      .select('*, table:dining_tables(*)')
      .eq('branch_id', branchId)
      .in('status', ['open', 'held'])
      .order('created_at', { ascending: false }),
  ]);
  const tables = (tRes.data as DiningTable[]) || [];
  const orders = (oRes.data as Order[]) || [];
  let orderItems: OrderItem[] = [];
  let kitchenSends: OrderKitchenSend[] = [];
  if (orders.length > 0) {
    const ids = orders.map((o) => o.id);
    const [iRes, kRes] = await Promise.all([
      supabase.from('order_items').select('*').in('order_id', ids),
      supabase.from('order_kitchen_sends').select('*').in('order_id', ids),
    ]);
    orderItems = (iRes.data as OrderItem[]) || [];
    kitchenSends = (kRes.data as OrderKitchenSend[]) || [];
  }
  return { orders, tables, orderItems, kitchenSends };
}

export async function fetchOrderForWorkspace(orderId: string): Promise<{ order: Order | null; items: OrderItem[]; products: Product[] }> {
  const { data: o } = await supabase.from('orders').select('*').eq('id', orderId).maybeSingle();
  const order = (o as Order | null) || null;
  if (!order) return { order: null, items: [], products: [] };
  const { data: items } = await supabase.from('order_items').select('*').eq('order_id', orderId);
  const itemRows = (items as OrderItem[]) || [];
  const ids = itemRows.map((i) => i.product_id).filter(Boolean) as string[];
  let products: Product[] = [];
  if (ids.length > 0) {
    const { data: prods } = await supabase.from('products').select('*').in('id', ids).eq('branch_id', order.branch_id);
    products = (prods as Product[]) || [];
  }
  return { order, items: itemRows, products };
}

export async function fetchBranches(): Promise<Branch[]> {
  const { data } = await supabase.from('branches').select('*').eq('is_active', true).order('name');
  return (data as Branch[]) || [];
}

export async function fetchCustomers(branchId: string): Promise<Customer[]> {
  let q = supabase.from('customers').select('*');
  if (branchId) q = q.eq('branch_id', branchId);
  const { data } = await q.order('name');
  return (data as Customer[]) || [];
}

export async function fetchActiveShift(branchId: string): Promise<{ id: string; expected: number; opened_at: string; opening_amount: number } | null> {
  const { data } = await posApi.getActiveShift({ p_branch_id: branchId });
  const res = data as unknown as { success?: boolean; open?: boolean; shift?: { id: string; expected: number; opened_at: string; opening_amount: number } } | null;
  return res?.open ? (res.shift ?? null) : null;
}
