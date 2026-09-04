import { useMemo } from 'react';
import type { PosSummary } from '@/lib/types';
import { countActiveOrders } from '../utils/orderFilters';
import { useActiveOrders } from './useActiveOrders';

export function usePosSummary(branchId: string): PosSummary {
  const { orders, tables } = useActiveOrders(branchId);
  return useMemo<PosSummary>(() => {
    const c = countActiveOrders(orders);
    return {
      occupiedTables: tables.filter((t) => t.status === 'occupied').length,
      heldOrders: c.held,
      deliveryOrders: c.delivery,
      takeawayOrders: c.takeaway,
      activeOrders: c.active,
    };
  }, [orders, tables]);
}
