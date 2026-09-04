import { supabase } from '@/api';
import type { KitchenSendItem, KitchenSendResult } from '../types';
import { rpc } from '@/api/rpc';

// In-flight UI lock. The database also serializes each order, so this is only
// a UX guard against rapid duplicate clicks, not the idempotency authority.
const activeSendLocks = new Set<string>();

/**
 * Send the unsent order quantity to the kitchen.
 *
 * The database RPC is the single authority for:
 * - delta calculation and idempotency;
 * - branch/permission checks;
 * - inventory_units FIFO deduction;
 * - kitchen-send snapshots;
 * - table/kitchen status updates.
 *
 * There is deliberately no client-side inventory fallback. A failed RPC must
 * fail closed rather than partially mutate stock from the browser.
 */
export async function sendOrderToKitchen(p: {
  p_order_id: string;
  p_sent_by?: string | null;
}): Promise<KitchenSendResult> {
  const orderId = p.p_order_id;
  if (!orderId) {
    return { success: false, error: 'NO_ORDER_ID', detail: 'Order ID is required' };
  }

  if (activeSendLocks.has(orderId)) {
    return {
      success: false,
      error: 'SEND_IN_PROGRESS',
      detail: 'Kitchen send is already in progress for this order',
    };
  }

  activeSendLocks.add(orderId);

  try {
    const rpcRes = await rpc<{
      success: boolean;
      error?: string;
      detail?: string;
      order_id?: string;
      sent?: KitchenSendItem[];
      items_sent_count?: number;
      all_sent?: boolean;
    }>('send_to_kitchen', {
      p_order_id: orderId,
      p_sent_by: p.p_sent_by || null,
    });

    if (!rpcRes.data) {
      return {
        success: false,
        error: 'KITCHEN_SEND_FAILED',
        detail: rpcRes.error?.message || 'Kitchen send returned no result',
      };
    }

    if (!rpcRes.data.success) {
      return {
        success: false,
        error: rpcRes.data.error || 'KITCHEN_SEND_FAILED',
        detail: rpcRes.data.detail || rpcRes.data.error || 'Kitchen send failed',
      };
    }

    const sentItems = rpcRes.data.sent || [];
    return {
      success: true,
      order_id: rpcRes.data.order_id || orderId,
      sent: sentItems,
      items_sent_count: rpcRes.data.items_sent_count ?? sentItems.length,
      all_sent: rpcRes.data.all_sent ?? true,
    };
  } catch (err) {
    return {
      success: false,
      error: 'KITCHEN_SEND_FAILED',
      detail: err instanceof Error ? err.message : 'Unknown error during kitchen send',
    };
  } finally {
    activeSendLocks.delete(orderId);
  }
}

/**
 * Reverses inventory consumption or logs waste when an order is canceled.
 *
 * This still retains its legacy fallback until the cancellation RPC is proven
 * against the current inventory_units contract. Kitchen sending itself no
 * longer has any browser-side inventory mutation path.
 */
export interface CancelOrderResult {
  success: boolean;
  order_id?: string;
  is_waste?: boolean;
  processed_count?: number;
  total_waste_cost?: number;
  error?: string;
  detail?: string;
}

export async function cancelOrderWithInventoryHandling(
  orderId: string,
  isWaste: boolean,
  reason?: string,
  cancelledBy?: string,
  approvedBy?: string
): Promise<CancelOrderResult> {
  try {
    const res = await rpc<CancelOrderResult>('cancel_order_with_inventory_handling', {
      p_order_id: orderId,
      p_is_waste: isWaste,
      p_reason: reason || null,
      p_cancelled_by: cancelledBy || null,
      p_approved_by: approvedBy || null,
    });
    if (res.data && res.data.success) {
      return res.data;
    }
  } catch (err) {
    console.warn('cancel_order_with_inventory_handling RPC error, running fallback:', err);
  }

  // Legacy cancellation fallback. Keep only until the current backend
  // cancellation contract is verified and covered by regression tests.
  try {
    const timestamp = new Date().toISOString();
    const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single();
    if (!order) return { success: false, error: 'Order not found' };

    const { data: consumptions } = await supabase
      .from('order_inventory_consumptions')
      .select('*')
      .eq('order_id', orderId)
      .eq('status', 'consumed');

    let totalWasteCost = 0;
    let processedCount = 0;

    for (const c of consumptions || []) {
      const qty = Number(c.consumed_quantity) || 0;
      if (qty <= 0) continue;

      if (!isWaste) {
        if (c.raw_material_id) {
          const { data: rm } = await supabase
            .from('raw_material_inventory')
            .select('id, quantity')
            .eq('raw_material_id', c.raw_material_id)
            .eq('branch_id', order.branch_id)
            .maybeSingle();

          if (rm) {
            await supabase
              .from('raw_material_inventory')
              .update({ quantity: (Number(rm.quantity) || 0) + qty, updated_at: timestamp })
              .eq('id', rm.id);
          }

          try {
            await supabase.from('raw_material_movements').insert({
              material_id: c.raw_material_id,
              warehouse_id: c.warehouse_id,
              movement_type: 'KITCHEN_CONSUMPTION_REVERSAL',
              quantity: qty,
              reference_id: orderId,
              branch_id: order.branch_id,
              notes: reason || 'Order canceled - returned to stock',
              created_at: timestamp,
            });
          } catch {
            // Best-effort legacy logging only.
          }
        } else if (c.product_id && c.warehouse_id) {
          const { data: inv } = await supabase
            .from('inventory')
            .select('id, quantity')
            .eq('product_id', c.product_id)
            .eq('warehouse_id', c.warehouse_id)
            .maybeSingle();

          if (inv) {
            await supabase
              .from('inventory')
              .update({ quantity: (Number(inv.quantity) || 0) + qty, updated_at: timestamp })
              .eq('id', inv.id);
          }

          try {
            await supabase.from('inventory_movements').insert({
              product_id: c.product_id,
              warehouse_id: c.warehouse_id,
              movement_type: 'KITCHEN_CONSUMPTION_REVERSAL',
              quantity: qty,
              reference_id: orderId,
              branch_id: order.branch_id,
              notes: reason || 'Order canceled - returned to stock',
              created_at: timestamp,
            });
          } catch {
            // Best-effort legacy logging only.
          }
        }

        await supabase
          .from('order_inventory_consumptions')
          .update({
            status: 'reversed',
            reversed_quantity: qty,
            consumed_quantity: 0,
            updated_at: timestamp,
          })
          .eq('id', c.id);
      } else {
        let unitCost = 0;
        if (c.raw_material_id) {
          const { data: rm } = await supabase
            .from('raw_materials')
            .select('default_cost')
            .eq('id', c.raw_material_id)
            .maybeSingle();
          unitCost = Number(rm?.default_cost) || 0;
        } else if (c.product_id) {
          const { data: pr } = await supabase
            .from('products')
            .select('cost_price')
            .eq('id', c.product_id)
            .maybeSingle();
          unitCost = Number(pr?.cost_price) || 0;
        }

        const cost = qty * unitCost;
        totalWasteCost += cost;

        try {
          await supabase.from('waste_entries').insert({
            branch_id: order.branch_id,
            waste_type: c.raw_material_id ? 'raw_material' : 'product',
            raw_material_id: c.raw_material_id || null,
            inventory_unit_id: c.inventory_unit_id || null,
            product_id: c.product_id || null,
            quantity: qty,
            unit_cost: unitCost,
            total_cost: cost,
            reason: reason || 'هالك مطبخ ناتج عن إلغاء طلب',
            warehouse_id: c.warehouse_id || null,
            status: approvedBy ? 'approved' : 'pending',
            approved_by: approvedBy || null,
            approved_at: approvedBy ? timestamp : null,
            created_by: cancelledBy || approvedBy || null,
            created_at: timestamp,
            updated_at: timestamp,
          });
        } catch (e) {
          console.warn('Failed to insert waste entry:', e);
        }

        await supabase
          .from('order_inventory_consumptions')
          .update({ status: 'wasted', updated_at: timestamp })
          .eq('id', c.id);
      }

      processedCount++;
    }

    await supabase
      .from('orders')
      .update({
        status: 'cancelled',
        notes: order.notes
          ? `${order.notes}\n[تم الإلغاء: ${reason || ''}]`
          : `[تم الإلغاء: ${reason || ''}]`,
        updated_at: timestamp,
      })
      .eq('id', orderId);

    if (order.table_id) {
      await supabase
        .from('dining_tables')
        .update({ status: 'vacant', updated_at: timestamp })
        .eq('id', order.table_id);
    }

    return {
      success: true,
      order_id: orderId,
      is_waste: isWaste,
      processed_count: processedCount,
      total_waste_cost: totalWasteCost,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Cancellation failed',
    };
  }
}

/** Reverses kitchen consumption when an order is canceled before preparation. */
export async function reverseOrderKitchenConsumption(
  orderId: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  const res = await cancelOrderWithInventoryHandling(orderId, false, reason);
  return { success: res.success, error: res.error };
}
