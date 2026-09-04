import { supabase } from '@/lib/supabase';
import type { ApiError, ApiResult } from '../types';
import type { RpcResult, OrderType } from '@/lib/types';
import { rpc } from '../rpc';

export const floorPlan = {
  async createOrder(p: {
    p_branch_id: string;
    p_order_type?: OrderType;
    p_table_id?: string | null;
    p_customer_id?: string | null;
    p_guest_count?: number | null;
    p_notes?: string | null;
    p_items: {
      product_id: string;
      unit_name: string;
      quantity: number;
      unit_price: number;
      discount_amount: number;
      bonus_quantity: number;
      total: number;
      notes?: string | null;
    }[];
    p_subtotal?: number;
    p_discount_amount?: number;
    p_discount_type?: 'percent' | 'amount';
    p_tax_amount?: number;
    p_total?: number;
    p_cashier_id?: string | null;
  }): ApiResult<RpcResult & { order_id?: string; order_number?: string }> {
    try {
      const res = await rpc<RpcResult & { order_id?: string; order_number?: string }>('create_order', p);
      if (!res.error && res.data && res.data.success) {
        return res;
      }
    } catch {
      // Fallback
    }

    try {
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const orderNumber = `ORD-${dateStr}-${Math.floor(1000 + Math.random() * 9000)}`;
      const timestamp = new Date().toISOString();

      const { data: order, error: ordErr } = await supabase
        .from('orders')
        .insert({
          order_number: orderNumber,
          branch_id: p.p_branch_id,
          order_type: p.p_order_type || 'takeaway',
          table_id: p.p_table_id || null,
          customer_id: p.p_customer_id || null,
          cashier_id: p.p_cashier_id || null,
          guest_count: p.p_guest_count || null,
          notes: p.p_notes || null,
          subtotal: p.p_subtotal || 0,
          discount_amount: p.p_discount_amount || 0,
          discount_type: p.p_discount_type || 'amount',
          tax_amount: p.p_tax_amount || 0,
          total: p.p_total || 0,
          status: 'open',
          created_at: timestamp,
          updated_at: timestamp,
        })
        .select()
        .single();

      if (ordErr) {
        return { data: { success: false, error: ordErr.message }, error: ordErr as unknown as ApiError };
      }

      // Insert Order Items
      if (p.p_items && p.p_items.length > 0) {
        const itemRows = p.p_items.map((it) => ({
          order_id: order.id,
          product_id: it.product_id,
          unit_name: it.unit_name || 'piece',
          quantity: it.quantity,
          unit_price: it.unit_price,
          discount_amount: it.discount_amount || 0,
          bonus_quantity: it.bonus_quantity || 0,
          total: it.total,
          notes: it.notes || null,
          created_at: timestamp,
        }));

        await supabase.from('order_items').insert(itemRows);
      }

      // Update table if dine-in
      if (p.p_table_id && p.p_order_type === 'dine_in') {
        await supabase
          .from('dining_tables')
          .update({ status: 'occupied', updated_at: timestamp })
          .eq('id', p.p_table_id);
      }

      return {
        data: {
          success: true,
          order_id: order.id,
          order_number: order.order_number,
        },
        error: null,
      };
    } catch (err) {
      return {
        data: { success: false, error: err instanceof Error ? err.message : 'Order creation failed' },
        error: null,
      };
    }
  },

  async setOrderStatus(p: { p_order_id: string; p_status: string; p_notes?: string | null }): ApiResult<RpcResult> {
    try {
      const res = await rpc<RpcResult>('set_order_status', p);
      if (!res.error && res.data && res.data.success) {
        return res;
      }
    } catch {
      // Fallback
    }

    try {
      const updateData: Record<string, unknown> = {
        status: p.p_status,
        updated_at: new Date().toISOString(),
      };
      if (p.p_notes !== undefined) updateData.notes = p.p_notes;

      const { error } = await supabase
        .from('orders')
        .update(updateData)
        .eq('id', p.p_order_id);

      if (error) return { data: { success: false, error: error.message }, error: error as unknown as ApiError };
      return { data: { success: true }, error: null };
    } catch (err) {
      return { data: { success: false, error: err instanceof Error ? err.message : 'Failed to update order status' }, error: null };
    }
  },

  async updateOrder(p: {
    p_order_id: string;
    p_order_type?: OrderType;
    p_table_id?: string | null;
    p_customer_id?: string | null;
    p_guest_count?: number | null;
    p_notes?: string | null;
    p_items: {
      product_id: string;
      unit_name: string;
      quantity: number;
      unit_price: number;
      discount_amount: number;
      bonus_quantity: number;
      total: number;
      notes?: string | null;
    }[];
    p_subtotal?: number;
    p_discount_amount?: number;
    p_discount_type?: 'percent' | 'amount';
    p_tax_amount?: number;
    p_total?: number;
    p_status?: 'open' | 'held';
  }): ApiResult<RpcResult> {
    try {
      const res = await rpc<RpcResult>('update_order', p);
      if (!res.error && res.data && res.data.success) {
        return res;
      }
    } catch {
      // Fallback
    }

    try {
      const timestamp = new Date().toISOString();

      // Fetch current order to check previous table
      const { data: currentOrder } = await supabase
        .from('orders')
        .select('*')
        .eq('id', p.p_order_id)
        .maybeSingle();

      const oldTableId = currentOrder?.table_id;
      const newTableId = p.p_table_id;

      // Update Order row
      const { error: ordErr } = await supabase
        .from('orders')
        .update({
          order_type: p.p_order_type || currentOrder?.order_type || 'takeaway',
          table_id: p.p_table_id !== undefined ? p.p_table_id : currentOrder?.table_id,
          customer_id: p.p_customer_id !== undefined ? p.p_customer_id : currentOrder?.customer_id,
          guest_count: p.p_guest_count !== undefined ? p.p_guest_count : currentOrder?.guest_count,
          notes: p.p_notes !== undefined ? p.p_notes : currentOrder?.notes,
          subtotal: p.p_subtotal ?? currentOrder?.subtotal ?? 0,
          discount_amount: p.p_discount_amount ?? currentOrder?.discount_amount ?? 0,
          discount_type: p.p_discount_type ?? currentOrder?.discount_type ?? 'amount',
          tax_amount: p.p_tax_amount ?? currentOrder?.tax_amount ?? 0,
          total: p.p_total ?? currentOrder?.total ?? 0,
          status: p.p_status || currentOrder?.status || 'open',
          updated_at: timestamp,
        })
        .eq('id', p.p_order_id);

      if (ordErr) return { data: { success: false, error: ordErr.message }, error: ordErr as unknown as ApiError };

      // Update order items: delete existing items for order and reinsert updated cart items
      await supabase.from('order_items').delete().eq('order_id', p.p_order_id);

      if (p.p_items && p.p_items.length > 0) {
        const itemRows = p.p_items.map((it) => ({
          order_id: p.p_order_id,
          product_id: it.product_id,
          unit_name: it.unit_name || 'piece',
          quantity: it.quantity,
          unit_price: it.unit_price,
          discount_amount: it.discount_amount || 0,
          bonus_quantity: it.bonus_quantity || 0,
          total: it.total,
          notes: it.notes || null,
          created_at: timestamp,
        }));
        await supabase.from('order_items').insert(itemRows);
      }

      // Handle table shifts if table changed
      if (oldTableId && oldTableId !== newTableId) {
        await supabase.from('dining_tables').update({ status: 'vacant', updated_at: timestamp }).eq('id', oldTableId);
      }
      if (newTableId && p.p_order_type === 'dine_in') {
        await supabase.from('dining_tables').update({ status: 'occupied', updated_at: timestamp }).eq('id', newTableId);
      }

      return { data: { success: true }, error: null };
    } catch (err) {
      return { data: { success: false, error: err instanceof Error ? err.message : 'Failed to update order' }, error: null };
    }
  },

  async setTableStatus(p: { p_table_id: string; p_status: string }): ApiResult<RpcResult> {
    try {
      const res = await rpc<RpcResult>('set_table_status', p);
      if (!res.error && res.data && res.data.success) {
        return res;
      }
    } catch {
      // Fallback
    }

    try {
      const { error } = await supabase
        .from('dining_tables')
        .update({ status: p.p_status, updated_at: new Date().toISOString() })
        .eq('id', p.p_table_id);

      if (error) return { data: { success: false, error: error.message }, error: error as unknown as ApiError };
      return { data: { success: true }, error: null };
    } catch (err) {
      return { data: { success: false, error: err instanceof Error ? err.message : 'Failed to set table status' }, error: null };
    }
  },

  async detachOrder(p: { p_order_id: string }): ApiResult<RpcResult> {
    try {
      const res = await rpc<RpcResult>('detach_order', p);
      if (!res.error && res.data && res.data.success) {
        return res;
      }
    } catch {
      // Fallback
    }

    try {
      const { data: order } = await supabase
        .from('orders')
        .select('table_id')
        .eq('id', p.p_order_id)
        .maybeSingle();

      const tableId = order?.table_id;

      await supabase
        .from('orders')
        .update({ table_id: null, updated_at: new Date().toISOString() })
        .eq('id', p.p_order_id);

      if (tableId) {
        await supabase
          .from('dining_tables')
          .update({ status: 'vacant', updated_at: new Date().toISOString() })
          .eq('id', tableId);
      }

      return { data: { success: true }, error: null };
    } catch (err) {
      return { data: { success: false, error: err instanceof Error ? err.message : 'Failed to detach order' }, error: null };
    }
  },
};

