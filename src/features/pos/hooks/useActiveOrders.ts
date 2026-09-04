import { useMemo } from 'react';
import type { DiningTable, Order, OrderItem } from '@/lib/types';
import { countActiveOrders } from '../utils/orderFilters';
import { usePosRealtime } from './usePosRealtime';
import type { OrderKitchenSend, PosRealtimeData } from '../types';

export interface UseActiveOrdersResult {
  data: PosRealtimeData;
  orders: Order[];
  tables: DiningTable[];
  counts: ReturnType<typeof countActiveOrders>;
  ordersByTable: Record<string, Order[]>;
  tableById: Record<string, DiningTable>;
  itemsByOrder: Record<string, OrderItem[]>;
  kitchenSendsByOrder: Record<string, OrderKitchenSend[]>;
  sentOrderItemIds: Set<string>;
  loading: boolean;
  error: string;
}

export function useActiveOrders(branchId: string): UseActiveOrdersResult {
  const { data, loading, error } = usePosRealtime(branchId);

  const orders = data.orders;
  const counts = useMemo(() => countActiveOrders(orders), [orders]);
  const ordersByTable = useMemo(() => {
    const map: Record<string, Order[]> = {};
    for (const o of orders) {
      if (o.table_id) (map[o.table_id] ||= []).push(o);
    }
    return map;
  }, [orders]);
  const tableById = useMemo(() => {
    const map: Record<string, DiningTable> = {};
    for (const t of data.tables) map[t.id] = t;
    return map;
  }, [data.tables]);
  const itemsByOrder = useMemo(() => {
    const map: Record<string, OrderItem[]> = {};
    for (const i of data.orderItems) (map[i.order_id] ||= []).push(i);
    return map;
  }, [data.orderItems]);
  const kitchenSendsByOrder = useMemo(() => {
    const map: Record<string, OrderKitchenSend[]> = {};
    for (const k of data.kitchenSends) (map[k.order_id] ||= []).push(k);
    return map;
  }, [data.kitchenSends]);
  const sentOrderItemIds = useMemo(() => new Set(data.kitchenSends.map((k) => k.order_item_id)), [data.kitchenSends]);

  return { data, orders, tables: data.tables, counts, ordersByTable, tableById, itemsByOrder, kitchenSendsByOrder, sentOrderItemIds, loading, error };
}
