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

    setLoading(true);
    try {
      const { data: allB, error: allErr } = await supabase
        .from('branches')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (allErr) {
        setAccessibleBranches([]);
        setAllBranches([]);
        return;
      }

      const allList = (allB as Branch[]) || [];
      setAllBranches(allList);

      if (isAdmin) {
        setAccessibleBranches(allList);
        return;
      }

      // Permission does not grant branch access. For every non-Super Admin
      // account, only explicit user_branch_access rows are authoritative here.
      // This deliberately ignores legacy org-role expansion from the old RPC.
      const { data: grants, error: grantsError } = await supabase
        .from('user_branch_access')
        .select('branch_id')
        .eq('user_id', user.id);

      if (grantsError || !Array.isArray(grants)) {
        setAccessibleBranches([]);
        return;
      }

      const allowedIds = new Set(
        grants
          .map((grant: { branch_id?: string | null }) => grant.branch_id)
          .filter((id): id is string => Boolean(id))
      );
      setAccessibleBranches(allList.filter((branch) => allowedIds.has(branch.id)));
    } catch (err) {
      console.error('Failed to load accessible branches:', err);
      setAccessibleBranches([]);
      setAllBranches([]);
    } finally {
      setLoading(false);
    }
  }, [user, isAdmin]);

  useEffect(() => {
    void fetchBranches();
  }, [fetchBranches]);

  useEffect(() => {
    if (loading || isAdmin) return;

    if (accessibleBranches.length === 0) {
      if (activeBranchId) setActiveBranchId(null);
      return;
    }

    const isValid = accessibleBranches.some((branch) => branch.id === activeBranchId);
    if (!isValid) {
      setActiveBranchId(accessibleBranches[0].id);
    }
  }, [loading, accessibleBranches, activeBranchId, isAdmin, setActiveBranchId]);

  const canSwitch = isAdmin || accessibleBranches.length > 1;
  const currentBranch = accessibleBranches.find((branch) => branch.id === activeBranchId)
    || (isAdmin ? allBranches.find((branch) => branch.id === activeBranchId) : undefined)
    || null;

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
