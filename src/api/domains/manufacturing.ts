import { supabase } from '@/lib/supabase';
import type { ApiError, ApiResult } from '../types';
import type { RpcResult } from '@/lib/types';
import { rpc } from '../rpc';

export const manufacturing = {
  async createOrder(p: {
    p_product_id: string;
    p_branch_id: string;
    p_warehouse_id: string | null;
    p_quantity: number;
    p_batch_number: string | null;
    p_planned_at: string | null;
    p_notes: string | null;
  }): ApiResult<RpcResult> {
    try {
      const res = await rpc<RpcResult>('create_production_order', p);
      if (!res.error && res.data && res.data.success) {
        return res;
      }
    } catch {
      // Proceed to resilient fallback
    }

    try {
      const orderNumber = `PO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
      const { data, error } = await supabase
        .from('production_orders')
        .insert({
          order_number: orderNumber,
          product_id: p.p_product_id,
          branch_id: p.p_branch_id,
          warehouse_id: p.p_warehouse_id || null,
          quantity: p.p_quantity,
          batch_number: p.p_batch_number || null,
          planned_at: p.p_planned_at || new Date().toISOString(),
          notes: p.p_notes || null,
          status: 'planned',
          total_cost: 0,
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) {
        return { data: { success: false, error: error.message }, error: error as unknown as ApiError };
      }

      return {
        data: {
          success: true,
          order_id: data.id,
          order_number: data.order_number,
        },
        error: null,
      };
    } catch (err) {
      return {
        data: { success: false, error: err instanceof Error ? err.message : 'Failed to create production order' },
        error: null,
      };
    }
  },

  async startOrder(p: { p_order_id: string }): ApiResult<RpcResult> {
    try {
      const res = await rpc<RpcResult>('start_production_order', p);
      if (!res.error && res.data && res.data.success) {
        return res;
      }
    } catch {
      // Proceed to fallback
    }

    try {
      const { error } = await supabase
        .from('production_orders')
        .update({
          status: 'in_progress',
        })
        .eq('id', p.p_order_id);

      if (error) {
        return { data: { success: false, error: error.message }, error: error as unknown as ApiError };
      }

      return { data: { success: true }, error: null };
    } catch (err) {
      return {
        data: { success: false, error: err instanceof Error ? err.message : 'Failed to start order' },
        error: null,
      };
    }
  },

  async completeOrder(p: {
    p_order_id: string;
    p_waste: { raw_material_id: string; quantity: number; reason: string | null }[] | null;
  }): ApiResult<RpcResult> {
    try {
      const res = await rpc<RpcResult>('complete_production_order', p);
      if (!res.error && res.data && res.data.success) {
        return res;
      }
    } catch {
      // Fallback below
    }

    try {
      // 1. Fetch the production order
      const { data: order, error: orderErr } = await supabase
        .from('production_orders')
        .select('*')
        .eq('id', p.p_order_id)
        .single();

      if (orderErr || !order) {
        return { data: { success: false, error: 'Order not found' }, error: null };
      }

      // 2. Fetch recipe for this product and branch
      const { data: recipe } = await supabase
        .from('recipes')
        .select('*, recipe_items(*, raw_material:raw_materials(*))')
        .eq('product_id', order.product_id)
        .eq('branch_id', order.branch_id)
        .maybeSingle();

      let calculatedCost = 0;
      const orderQty = Number(order.quantity) || 1;

      // 3. Deduct raw materials based on recipe items
      if (recipe && recipe.recipe_items && Array.isArray(recipe.recipe_items)) {
        const yieldQty = Number(recipe.yield_quantity) || 1;
        const multiplier = orderQty / yieldQty;

        for (const item of recipe.recipe_items) {
          const itemQty = Number(item.quantity) * multiplier;
          const wastagePct = Number(item.wastage_percent) || 0;
          const totalDeduct = itemQty * (1 + wastagePct / 100);
          const rawMaterial = item.raw_material as { default_cost?: number } | null;
          const unitCost = Number(rawMaterial?.default_cost) || 0;
          calculatedCost += totalDeduct * unitCost;

          // Deduct from raw_material_inventory
          const { data: rmInv } = await supabase
            .from('raw_material_inventory')
            .select('*')
            .eq('raw_material_id', item.raw_material_id)
            .eq('branch_id', order.branch_id)
            .maybeSingle();

          if (rmInv) {
            const newQty = Math.max(0, Number(rmInv.quantity) - totalDeduct);
            await supabase
              .from('raw_material_inventory')
              .update({ quantity: newQty, updated_at: new Date().toISOString() })
              .eq('id', rmInv.id);
          } else {
            await supabase.from('raw_material_inventory').insert({
              raw_material_id: item.raw_material_id,
              branch_id: order.branch_id,
              quantity: 0,
              avg_cost: unitCost,
              min_stock: 0,
              updated_at: new Date().toISOString(),
            });
          }

          // Record raw material movement
          try {
            await supabase.from('raw_material_movements').insert({
              raw_material_id: item.raw_material_id,
              branch_id: order.branch_id,
              movement_type: 'production_consume',
              quantity: -totalDeduct,
              reference_id: order.id,
              created_at: new Date().toISOString(),
            });
          } catch {
            // Best effort
          }
        }
      }

      // 4. Save waste records
      if (p.p_waste && p.p_waste.length > 0) {
        for (const w of p.p_waste) {
          try {
            await supabase.from('production_waste').insert({
              order_id: order.id,
              branch_id: order.branch_id,
              raw_material_id: w.raw_material_id,
              quantity: w.quantity,
              reason: w.reason || null,
              created_at: new Date().toISOString(),
            });
          } catch {
            // Best effort
          }
        }
      }

      // 5. Add finished product to inventory in warehouse or branch
      let warehouseId = order.warehouse_id;
      if (!warehouseId) {
        const { data: wh } = await supabase
          .from('warehouses')
          .select('id')
          .eq('branch_id', order.branch_id)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();
        warehouseId = wh?.id || null;
      }

      if (warehouseId) {
        const { data: existingInv } = await supabase
          .from('inventory')
          .select('*')
          .eq('product_id', order.product_id)
          .eq('warehouse_id', warehouseId)
          .maybeSingle();

        if (existingInv) {
          await supabase
            .from('inventory')
            .update({
              quantity: Number(existingInv.quantity) + orderQty,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingInv.id);
        } else {
          await supabase.from('inventory').insert({
            product_id: order.product_id,
            warehouse_id: warehouseId,
            quantity: orderQty,
            min_stock: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        }
      }

      // 6. Update order status to completed
      const { error: updErr } = await supabase
        .from('production_orders')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          total_cost: calculatedCost,
        })
        .eq('id', order.id);

      if (updErr) {
        return { data: { success: false, error: updErr.message }, error: updErr as unknown as ApiError };
      }

      return {
        data: {
          success: true,
          total_cost: calculatedCost,
        },
        error: null,
      };
    } catch (err) {
      return {
        data: { success: false, error: err instanceof Error ? err.message : 'Failed to complete production order' },
        error: null,
      };
    }
  },

  async cancelOrder(p: { p_order_id: string; p_reason: string | null }): ApiResult<RpcResult> {
    try {
      const res = await rpc<RpcResult>('cancel_production_order', p);
      if (!res.error && res.data && res.data.success) {
        return res;
      }
    } catch {
      // Fallback
    }

    try {
      const { error } = await supabase
        .from('production_orders')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancel_reason: p.p_reason || null,
        })
        .eq('id', p.p_order_id);

      if (error) {
        return { data: { success: false, error: error.message }, error: error as unknown as ApiError };
      }

      return { data: { success: true }, error: null };
    } catch (err) {
      return {
        data: { success: false, error: err instanceof Error ? err.message : 'Failed to cancel order' },
        error: null,
      };
    }
  },
};

