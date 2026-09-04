import { supabase } from '@/lib/supabase';
import type { ApiError, ApiResult } from '../types';
import type { RpcResult } from '@/lib/types';
import { rpc } from '../rpc';

export const shifts = {
  async open(p: { p_branch_id: string; p_opening_amount: number; p_notes: string | null }): ApiResult<RpcResult & { shift_id?: string }> {
    try {
      const res = await rpc<RpcResult & { shift_id?: string }>('open_shift', p);
      if (!res.error && res.data && res.data.success) {
        return res;
      }
    } catch {
      // Fallback
    }

    try {
      const timestamp = new Date().toISOString();
      const { data: shift, error } = await supabase
        .from('shifts')
        .insert({
          branch_id: p.p_branch_id,
          opening_amount: p.p_opening_amount || 0,
          expected_amount: p.p_opening_amount || 0,
          notes: p.p_notes || null,
          status: 'open',
          opened_at: timestamp,
        })
        .select()
        .single();

      if (error) return { data: { success: false, error: error.message }, error: error as unknown as ApiError };
      return { data: { success: true, shift_id: shift.id }, error: null };
    } catch (err) {
      return { data: { success: false, error: err instanceof Error ? err.message : 'Failed to open shift' }, error: null };
    }
  },

  async close(p: { p_shift_id: string; p_actual_amount: number; p_notes: string | null }): ApiResult<RpcResult> {
    try {
      const res = await rpc<RpcResult>('close_shift', p);
      if (!res.error && res.data && res.data.success) {
        return res;
      }
    } catch {
      // Fallback
    }

    try {
      const timestamp = new Date().toISOString();
      const { error } = await supabase
        .from('shifts')
        .update({
          actual_amount: p.p_actual_amount || 0,
          notes: p.p_notes || null,
          status: 'closed',
          closed_at: timestamp,
        })
        .eq('id', p.p_shift_id);

      if (error) return { data: { success: false, error: error.message }, error: error as unknown as ApiError };
      return { data: { success: true }, error: null };
    } catch (err) {
      return { data: { success: false, error: err instanceof Error ? err.message : 'Failed to close shift' }, error: null };
    }
  },
};

