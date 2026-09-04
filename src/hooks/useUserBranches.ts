import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/api';
import { useAuth } from '@/context/AuthContext';
import { isAdminRole } from '@/lib/permissions';
import { useActiveBranchId } from '@/lib/activeBranch';
import type { Branch } from '@/lib/types';

export function useUserBranches() {
  const { user } = useAuth();
  const isAdmin = isAdminRole(user?.role);
  const [activeBranchId, setActiveBranchId] = useActiveBranchId();
  const [accessibleBranches, setAccessibleBranches] = useState<Branch[]>([]);
  const [allBranches, setAllBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBranches = useCallback(async () => {
    if (!user) {
      setAccessibleBranches([]);
      setAllBranches([]);
      setLoading(false);
      return;
    }

    try {
      // 1. Fetch all active branches
      const { data: allB, error: allErr } = await supabase
        .from('branches')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (allErr) {
        console.warn('Could not fetch all branches:', allErr.message);
      }

      const allList = (allB as Branch[]) || [];
      setAllBranches(allList);

      if (isAdmin) {
        setAccessibleBranches(allList);
      } else {
        // Fetch branches allowed for this user via RPC
        const { data: accessData, error: accessErr } = await supabase.rpc('get_user_branch_access', {
          p_user_id: user.id,
        });

        if (!accessErr && Array.isArray(accessData) && accessData.length > 0) {
          const allowedIds = new Set(accessData.map((a: { branch_id: string }) => a.branch_id));
          const filtered = allList.filter((b) => allowedIds.has(b.id));
          setAccessibleBranches(filtered.length > 0 ? filtered : allList.filter((b) => b.id === user.branch_id));
        } else if (user.branch_id) {
          setAccessibleBranches(allList.filter((b) => b.id === user.branch_id));
        } else {
          setAccessibleBranches(allList);
        }
      }
    } catch (err) {
      console.error('Failed to load accessible branches:', err);
    } finally {
      setLoading(false);
    }
  }, [user, isAdmin]);

  useEffect(() => {
    void fetchBranches();
  }, [fetchBranches]);

  // Ensure activeBranchId is valid for non-admin users
  useEffect(() => {
    if (loading || accessibleBranches.length === 0) return;
    if (!isAdmin) {
      const isValid = accessibleBranches.some((b) => b.id === activeBranchId);
      if (!isValid) {
        // Default to first accessible branch or user's assigned branch
        const fallback = accessibleBranches.find((b) => b.id === user?.branch_id)?.id || accessibleBranches[0]?.id;
        if (fallback) setActiveBranchId(fallback);
      }
    }
  }, [loading, accessibleBranches, activeBranchId, isAdmin, user?.branch_id, setActiveBranchId]);

  const canSwitch = isAdmin || accessibleBranches.length > 1;

  const currentBranch = accessibleBranches.find((b) => b.id === activeBranchId) ||
    allBranches.find((b) => b.id === activeBranchId) || null;

  return {
    accessibleBranches,
    allBranches,
    activeBranchId,
    setActiveBranchId,
    currentBranch,
    canSwitch,
    loading,
    refresh: fetchBranches,
  };
}
