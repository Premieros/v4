import { supabase } from '@/api';
import type { KitchenSendItem, KitchenSendResult } from '../types';
import type { OrderItem, Product } from '@/lib/types';
import { rpc } from '@/api/rpc';

// In-flight locks to guarantee idempotency across rapid double-clicks
const activeSendLocks = new Set<string>();

/**
 * Sends order items to the kitchen and atomically consumes inventory:
 * - Ready Stocked Products: Deduct product stock directly.
 * - Recipe Products: Deduct recipe ingredients (raw materials) directly based on BOM quantities.
 * - Idempotent: Subsequent sends or duplicate clicks will not deduct stock twice.
 * - Quantity deltas: Increasing quantity (e.g. 2 -> 3) consumes only +1; decreasing reverses -1.
 */
export async function sendOrderToKitchen(p: {
  p_order_id: string;
  p_sent_by?: string | null;
}): Promise<KitchenSendResult> {
  const orderId = p.p_order_id;
  if (!orderId) return { success: false, error: 'NO_ORDER_ID', detail: 'Order ID is required' };

  if (activeSendLocks.has(orderId)) {
    return { success: false, error: 'SEND_IN_PROGRESS', detail: 'Kitchen send is already in progress for this order' };
  }

  activeSendLocks.add(orderId);

  try {
    // 1. Attempt database-level atomic send_to_kitchen RPC first
    try {
      const rpcRes = await rpc<{
        success: boolean;
        error?: string;
        detail?: string;
        order_id?: string;
        sent?: KitchenSendItem[];
        items_sent_count?: number;
        items_processed?: number;
        all_sent?: boolean;
      }>(
        'send_to_kitchen',
        {
          p_order_id: orderId,
          p_sent_by: p.p_sent_by || null,
        }
      );

      if (rpcRes.data && rpcRes.data.success) {
        const sentItems = rpcRes.data.sent || [];
        const count = rpcRes.data.items_sent_count ?? sentItems.length ?? rpcRes.data.items_processed ?? 0;
        return {
          success: true,
          order_id: orderId,
          sent: sentItems,
          items_sent_count: count,
          all_sent: rpcRes.data.all_sent ?? true,
        };
      }

      if (rpcRes.data && !rpcRes.data.success && rpcRes.data.error) {
        return {
          success: false,
          error: rpcRes.data.error,
          detail: rpcRes.data.detail || rpcRes.data.error,
        };
      }
    } catch (rpcErr) {
      console.warn('send_to_kitchen RPC failed, attempting consume_order_kitchen_inventory or client transaction fallback:', rpcErr);
    }

    // 1b. Attempt consume_order_kitchen_inventory RPC fallback
    try {
      const rpcRes = await rpc<{ success: boolean; error?: string; detail?: string; order_id?: string; items_processed?: number; sent?: KitchenSendItem[]; items_sent_count?: number; all_sent?: boolean }>(
        'consume_order_kitchen_inventory',
        {
          p_order_id: orderId,
          p_sent_by: p.p_sent_by || null,
        }
      );

      if (rpcRes.data && rpcRes.data.success) {
        if (rpcRes.data.sent && rpcRes.data.sent.length > 0) {
          return {
            success: true,
            order_id: orderId,
            sent: rpcRes.data.sent,
            items_sent_count: rpcRes.data.items_sent_count ?? rpcRes.data.sent.length,
            all_sent: rpcRes.data.all_sent ?? true,
          };
        }

        // Fetch current items and products to return rich KitchenSendResult for UI
        const { data: items } = await supabase.from('order_items').select('*').eq('order_id', orderId);
        const orderItems = (items as OrderItem[]) || [];
        const productIds = orderItems.map((x) => x.product_id).filter(Boolean) as string[];
        const productsMap: Record<string, Product> = {};

        if (productIds.length > 0) {
          const { data: prods } = await supabase.from('products').select('*').in('id', productIds);
          for (const prod of (prods || []) as Product[]) productsMap[prod.id] = prod;
        }

        const sentItems: KitchenSendItem[] = orderItems.map((item) => ({
          send_id: `send_${item.id}_${Date.now()}`,
          order_item_id: item.id,
          product_id: item.product_id,
          product_name: item.product_id && productsMap[item.product_id] ? productsMap[item.product_id].name : null,
          unit_name: item.unit_name,
          quantity: Number(item.quantity) || 0,
          unit_price: Number(item.unit_price) || 0,
          discount_amount: Number(item.discount_amount) || 0,
          bonus_quantity: Number(item.bonus_quantity) || 0,
          total: Number(item.total) || 0,
          notes: item.notes || null,
        }));

        const count = rpcRes.data.items_sent_count ?? rpcRes.data.items_processed ?? sentItems.length;

        return {
          success: true,
          order_id: orderId,
          sent: sentItems,
          items_sent_count: count,
          all_sent: true,
        };
      }
    } catch (rpcErr) {
      console.warn('consume_order_kitchen_inventory RPC failed, executing resilient client transaction fallback:', rpcErr);
    }

    // 2. Resilient Client-Side Fallback Transaction
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .maybeSingle();

    if (orderErr || !order) {
      return {
        success: false,
        error: 'ORDER_NOT_FOUND',
        detail: orderErr?.message || 'Order not found',
      };
    }

    const branchId = order.branch_id;

    // Fetch current order items
    const { data: items } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', orderId);

    const orderItems = (items as OrderItem[]) || [];
    if (orderItems.length === 0) {
      return { success: true, items_sent_count: 0, all_sent: true, sent: [] };
    }

    // Fetch existing consumptions for tracking idempotency & delta
    const { data: existingConsumptions } = await supabase
      .from('order_inventory_consumptions')
      .select('*')
      .eq('order_id', orderId);

    const consumptionByItemId: Record<string, { consumed_quantity: number; id: string }> = {};
    for (const c of (existingConsumptions || []) as { order_item_id: string; consumed_quantity: number; id: string }[]) {
      consumptionByItemId[c.order_item_id] = {
        consumed_quantity: Number(c.consumed_quantity) || 0,
        id: c.id,
      };
    }

    // Fetch branch active warehouse
    let warehouseId: string | null = null;
    if (branchId) {
      const { data: wh } = await supabase
        .from('warehouses')
        .select('id')
        .eq('branch_id', branchId)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      warehouseId = wh?.id || null;
    }

    // Fetch products
    const productIds = orderItems.map((x) => x.product_id).filter(Boolean) as string[];
    const productsMap: Record<string, Product> = {};
    if (productIds.length > 0) {
      const { data: prods } = await supabase.from('products').select('*').in('id', productIds);
      for (const p of (prods || []) as Product[]) productsMap[p.id] = p;
    }

    const newSentItems: KitchenSendItem[] = [];
    const timestamp = new Date().toISOString();

    for (const item of orderItems) {
      if (!item.product_id) continue;
      const orderedQty = Number(item.quantity) || 0;
      const existing = consumptionByItemId[item.id];
      const previouslyConsumed = existing ? existing.consumed_quantity : 0;
      const prod = productsMap[item.product_id];

      // If quantity is identical to what was previously consumed, skip deduction (Idempotent!)
      if (orderedQty === previouslyConsumed && previouslyConsumed > 0) {
        newSentItems.push({
          send_id: `send_${item.id}_${Date.now()}`,
          order_item_id: item.id,
          product_id: item.product_id,
          product_name: prod?.name || null,
          unit_name: item.unit_name,
          quantity: orderedQty,
          unit_price: Number(item.unit_price) || 0,
          discount_amount: Number(item.discount_amount) || 0,
          bonus_quantity: Number(item.bonus_quantity) || 0,
          total: Number(item.total) || 0,
          notes: item.notes || null,
        });
        continue;
      }

      const delta = orderedQty - previouslyConsumed;

      // A. Check for Recipe & Ingredients (Product -> Ingredients)
      const { data: recipe } = await supabase
        .from('recipes')
        .select('*, recipe_items(*, raw_material:raw_materials(*))')
        .eq('product_id', item.product_id)
        .eq('branch_id', branchId)
        .maybeSingle();

      if (recipe && recipe.recipe_items && Array.isArray(recipe.recipe_items) && recipe.recipe_items.length > 0) {
        const yieldQty = Number(recipe.yield_quantity) || 1;
        const multiplier = Math.abs(delta) / yieldQty;

        for (const rItem of recipe.recipe_items) {
          const wastage = Number(rItem.wastage_percent) || 0;
          const rDeduct = Number(rItem.quantity) * multiplier * (1 + wastage / 100);

          const { data: rmInv } = await supabase
            .from('raw_material_inventory')
            .select('*')
            .eq('raw_material_id', rItem.raw_material_id)
            .eq('branch_id', branchId)
            .maybeSingle();

          if (rmInv) {
            const currentQty = Number(rmInv.quantity) || 0;
            const updatedQty = delta > 0 ? Math.max(0, currentQty - rDeduct) : currentQty + rDeduct;
            await supabase
              .from('raw_material_inventory')
              .update({ quantity: updatedQty, updated_at: timestamp })
              .eq('id', rmInv.id);
          }

          try {
            await supabase.from('raw_material_movements').insert({
              material_id: rItem.raw_material_id,
              branch_id: branchId,
              movement_type: delta > 0 ? 'KITCHEN_CONSUMPTION' : 'KITCHEN_CONSUMPTION_REVERSAL',
              quantity: delta > 0 ? -rDeduct : rDeduct,
              reference_id: orderId,
              created_at: timestamp,
            });
          } catch {
            // Best effort logging
          }
        }
      } else if (warehouseId && prod) {
        // B. Direct Product Inventory deduction (Ready / Stocked item)
        const { data: inv } = await supabase
          .from('inventory')
          .select('*')
          .eq('product_id', item.product_id)
          .eq('warehouse_id', warehouseId)
          .maybeSingle();

        if (inv) {
          const currentQty = Number(inv.quantity) || 0;
          const updatedQty = delta > 0 ? Math.max(0, currentQty - Math.abs(delta)) : currentQty + Math.abs(delta);
          await supabase
            .from('inventory')
            .update({ quantity: updatedQty, updated_at: timestamp })
            .eq('id', inv.id);

          try {
            await supabase.from('inventory_movements').insert({
              product_id: item.product_id,
              warehouse_id: warehouseId,
              movement_type: delta > 0 ? 'KITCHEN_CONSUMPTION' : 'KITCHEN_CONSUMPTION_REVERSAL',
              quantity: delta > 0 ? -Math.abs(delta) : Math.abs(delta),
              reference_id: orderId,
              created_at: timestamp,
            });
          } catch {
            // Best effort
          }
        }
      }

      // Track consumption in order_inventory_consumptions
      try {
        if (existing) {
          await supabase
            .from('order_inventory_consumptions')
            .update({
              consumed_quantity: orderedQty,
              updated_at: timestamp,
            })
            .eq('id', existing.id);
        } else {
          await supabase
            .from('order_inventory_consumptions')
            .insert({
              order_id: orderId,
              order_item_id: item.id,
              product_id: item.product_id,
              warehouse_id: warehouseId,
              branch_id: branchId,
              consumed_quantity: orderedQty,
              status: 'consumed',
              created_at: timestamp,
              updated_at: timestamp,
            });
        }
      } catch {
        // Continue
      }

      // Record in order_kitchen_sends
      try {
        await supabase
          .from('order_kitchen_sends')
          .insert({
            branch_id: branchId,
            order_id: orderId,
            order_item_id: item.id,
            sent_at: timestamp,
            sent_by: p.p_sent_by || null,
          });
      } catch {
        // Continue
      }

      newSentItems.push({
        send_id: `send_${item.id}_${Date.now()}`,
        order_item_id: item.id,
        product_id: item.product_id,
        product_name: prod?.name || null,
        unit_name: item.unit_name,
        quantity: orderedQty,
        unit_price: Number(item.unit_price) || 0,
        discount_amount: Number(item.discount_amount) || 0,
        bonus_quantity: Number(item.bonus_quantity) || 0,
        total: Number(item.total) || 0,
        notes: item.notes || null,
      });
    }

    // Update order status & table
    try {
      await supabase
        .from('orders')
        .update({
          status: 'open',
          updated_at: timestamp,
        })
        .eq('id', orderId);

      if (order.table_id) {
        await supabase
          .from('dining_tables')
          .update({ status: 'occupied', updated_at: timestamp })
          .eq('id', order.table_id);
      }
    } catch {
      // Best effort
    }

    return {
      success: true,
      order_id: orderId,
      sent: newSentItems,
      items_sent_count: newSentItems.length,
      all_sent: true,
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
 * Reverses inventory consumption or logs waste when an order is canceled
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

  // Fallback direct execution
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
        // Return to branch stock
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
            // ignore
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
            // ignore
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
        // Log waste entry
        let unitCost = 0;
        if (c.raw_material_id) {
          const { data: rm } = await supabase.from('raw_materials').select('default_cost').eq('id', c.raw_material_id).maybeSingle();
          unitCost = Number(rm?.default_cost) || 0;
        } else if (c.product_id) {
          const { data: pr } = await supabase.from('products').select('cost_price').eq('id', c.product_id).maybeSingle();
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
          .update({
            status: 'wasted',
            updated_at: timestamp,
          })
          .eq('id', c.id);
      }

      processedCount++;
    }

    // Cancel order
    await supabase.from('orders').update({
      status: 'cancelled',
      notes: order.notes ? `${order.notes}\n[تم الإلغاء: ${reason || ''}]` : `[تم الإلغاء: ${reason || ''}]`,
      updated_at: timestamp,
    }).eq('id', orderId);

    // Vacate table
    if (order.table_id) {
      await supabase.from('dining_tables').update({
        status: 'vacant',
        updated_at: timestamp,
      }).eq('id', order.table_id);
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

/**
 * Reverses inventory consumption when an order is canceled before kitchen preparation
 */
export async function reverseOrderKitchenConsumption(
  orderId: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  const res = await cancelOrderWithInventoryHandling(orderId, false, reason);
  return { success: res.success, error: res.error };
}
