import { pos as posApi, supabase } from '@/api';
import type { RpcResult, OrderType } from '@/lib/types';
import type { ItemPayload } from '../utils/cart';
import { offlinePosManager } from './offlinePos';

export interface ProcessSalePayload {
  p_invoice_number: string;
  p_branch_id: string;
  p_shift_id: string | null;
  p_warehouse_id: string | null;
  p_customer_id: string | null;
  p_salesperson_id: string | null;
  p_subtotal: number;
  p_discount_amount: number;
  p_discount_type: 'percent' | 'amount';
  p_tax_amount: number;
  p_bonus_amount: number;
  p_total: number;
  p_paid_amount: number;
  p_payment_method: string;
  p_status: string;
  p_items: ItemPayload[];
  p_order_type: OrderType;
  p_table_id: string | null;
  p_order_id: string | null;
  p_guest_count: number | null;
}

export async function processSaleForOrder(p: ProcessSalePayload): Promise<{ result: (RpcResult & { offline?: boolean }) | null; error: string | null }> {
  // If explicitly offline, save immediately to offline queue
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const queued = offlinePosManager.enqueueSale(p);
    return {
      result: {
        success: true,
        offline: true,
        sale_id: queued.localId,
        order_id: p.p_order_id || undefined,
      },
      error: null,
    };
  }

  try {
    const { data, error } = await posApi.processSale(p);
    if (!error && (data as { success?: boolean })?.success) {
      return { result: data as RpcResult, error: null };
    }

    // If network or server error occurred, fallback gracefully to offline queue
    const queued = offlinePosManager.enqueueSale(p);
    return {
      result: {
        success: true,
        offline: true,
        sale_id: queued.localId,
        order_id: p.p_order_id || undefined,
      },
      error: null,
    };
  } catch {
    const queued = offlinePosManager.enqueueSale(p);
    return {
      result: {
        success: true,
        offline: true,
        sale_id: queued.localId,
        order_id: p.p_order_id || undefined,
      },
      error: null,
    };
  }
}

export async function nextInvoiceNumber(): Promise<string | null> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `INV-OFF-${dateStr}-${rand}`;
  }

  try {
    const { data, error } = await posApi.nextDocumentNumber({ p_type: 'sale' });
    if (!error && data?.success) {
      return (data as { number?: string }).number || null;
    }
  } catch {
    // Network fallback
  }

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `INV-${dateStr}-${rand}`;
}

export async function fetchBranchWarehouseId(branchId: string): Promise<string | null> {
  try {
    const { data } = await supabase.from('warehouses').select('id').eq('branch_id', branchId).eq('is_active', true);
    const rows = (data as { id: string }[] | null) || [];
    return rows.length > 0 ? rows[0].id : null;
  } catch {
    return null;
  }
}

