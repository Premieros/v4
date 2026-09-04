import { useAuth } from '../context/AuthContext';
import { isAdminRole } from './permissions';
import { useActiveBranchId } from './activeBranch';

/**
 * Returns the branch_id filter for the current user.
 * - If an active branch is selected: returns activeBranchId for strict branch data isolation.
 * - If activeBranchId is null:
 *     - Admin: null (sees all branches when explicitly choosing "all branches")
 *     - Non-admin: user.branch_id || null
 */
export function useBranchFilter(): string | null {
  const { user } = useAuth();
  const [activeBranchId] = useActiveBranchId();
  if (!user) return null;
  if (activeBranchId) return activeBranchId;
  if (isAdminRole(user.role)) return null;
  return user.branch_id || null;
}


