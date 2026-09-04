import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/api';
import { useAuth } from '@/context/AuthContext';
import { useActiveBranchId } from '@/lib/activeBranch';
import { useCan } from '@/lib/permissions';
import {
  type PosApprovalRequest,
  type PosApprovalType,
  fetchPendingApprovals,
  respondToApprovalRequest,
} from '../services/approvals';

type ApprovalListener = () => void;
const approvalListeners = new Set<ApprovalListener>();
let sharedApprovalsChannel: ReturnType<typeof supabase.channel> | null = null;
let sharedDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function subscribeToApprovals(listener: ApprovalListener): () => void {
  approvalListeners.add(listener);

  if (!sharedApprovalsChannel) {
    const channelName = `pos_approvals_live_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    sharedApprovalsChannel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pos_approval_requests' },
        () => {
          if (sharedDebounceTimer) clearTimeout(sharedDebounceTimer);
          sharedDebounceTimer = setTimeout(() => {
            sharedDebounceTimer = null;
            approvalListeners.forEach((fn) => fn());
          }, 300);
        }
      )
      .subscribe();
  }

  return () => {
    approvalListeners.delete(listener);
    if (approvalListeners.size === 0 && sharedApprovalsChannel) {
      if (sharedDebounceTimer) clearTimeout(sharedDebounceTimer);
      const ch = sharedApprovalsChannel;
      sharedApprovalsChannel = null;
      void supabase.removeChannel(ch);
    }
  };
}

export function usePosApprovals() {
  const { user } = useAuth();
  const can = useCan();
  const [activeBranchId] = useActiveBranchId();
  const [requests, setRequests] = useState<PosApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const canApproveType = useCallback((type: PosApprovalType) => {
    switch (type) {
      case 'discount': return can('pos.approve.discount');
      case 'reprint': return can('pos.approve.reprint');
      case 'cancel': return can('pos.approve.cancel');
      case 'void': return can('pos.approve.void');
      default: return false;
    }
  }, [can]);

  const canApprove =
    can('pos.approve.discount') ||
    can('pos.approve.reprint') ||
    can('pos.approve.cancel') ||
    can('pos.approve.void');

  const loadRequests = useCallback(async () => {
    setLoading(true);
    const data = await fetchPendingApprovals(activeBranchId || undefined);
    setRequests(data);
    setLoading(false);
  }, [activeBranchId]);

  useEffect(() => {
    void loadRequests();
    const unsubscribe = subscribeToApprovals(() => void loadRequests());
    return unsubscribe;
  }, [loadRequests]);

  const respond = async (id: string, status: 'approved' | 'rejected', note?: string) => {
    if (!user) return false;
    const request = requests.find((r) => r.id === id);
    if (!request || !canApproveType(request.request_type)) return false;

    const ok = await respondToApprovalRequest({
      request_id: id,
      status,
      user_id: user.id,
      user_name: user.full_name || user.username || user.email || 'المشرف',
      response_note: note,
    });
    if (ok) void loadRequests();
    return ok;
  };

  const pendingRequests = requests.filter((r) => r.status === 'pending');
  const pendingCount = pendingRequests.length;

  return {
    requests,
    pendingRequests,
    pendingCount,
    canApprove,
    canApproveType,
    loading,
    refresh: loadRequests,
    approve: (id: string, note?: string) => respond(id, 'approved', note),
    reject: (id: string, note?: string) => respond(id, 'rejected', note),
  };
}
