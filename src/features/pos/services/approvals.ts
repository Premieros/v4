import { supabase } from '@/api';

export type PosApprovalType = 'discount' | 'reprint' | 'cancel' | 'void';
export type PosApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface PosApprovalRequest {
  id: string;
  branch_id: string;
  order_id?: string | null;
  order_number?: string | null;
  cashier_id?: string | null;
  cashier_name?: string | null;
  request_type: PosApprovalType;
  status: PosApprovalStatus;
  amount?: number | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
  approved_by?: string | null;
  approved_by_name?: string | null;
  response_note?: string | null;
  created_at: string;
  responded_at?: string | null;
}

export async function createApprovalRequest(params: {
  branch_id: string;
  order_id?: string | null;
  order_number?: string | null;
  cashier_id?: string | null;
  cashier_name?: string | null;
  request_type: PosApprovalType;
  amount?: number | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<PosApprovalRequest | null> {
  const { data, error } = await supabase
    .from('pos_approval_requests')
    .insert({
      branch_id: params.branch_id,
      order_id: params.order_id || null,
      order_number: params.order_number || null,
      cashier_id: params.cashier_id || null,
      cashier_name: params.cashier_name || 'كاشير',
      request_type: params.request_type,
      status: 'pending',
      amount: params.amount !== undefined ? params.amount : null,
      reason: params.reason || null,
      metadata: params.metadata || {},
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to create approval request:', error);
    throw error;
  }
  return data as PosApprovalRequest;
}

export async function respondToApprovalRequest(params: {
  request_id: string;
  status: 'approved' | 'rejected';
  user_id: string;
  user_name: string;
  response_note?: string;
}): Promise<boolean> {
  const { error } = await supabase
    .from('pos_approval_requests')
    .update({
      status: params.status,
      approved_by: params.user_id,
      approved_by_name: params.user_name,
      response_note: params.response_note || null,
      responded_at: new Date().toISOString(),
    })
    .eq('id', params.request_id);

  if (error) {
    console.error('Failed to respond to approval request:', error);
    return false;
  }
  return true;
}

export async function fetchPendingApprovals(branchId?: string | null): Promise<PosApprovalRequest[]> {
  let query = supabase
    .from('pos_approval_requests')
    .select('*')
    .order('created_at', { ascending: false });

  if (branchId) {
    query = query.eq('branch_id', branchId);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Failed to fetch approvals:', error);
    return [];
  }
  return (data as PosApprovalRequest[]) || [];
}
