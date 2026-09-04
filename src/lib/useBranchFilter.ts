import { useAuth } from '../context/AuthContext';
import { isAdminRole } from './permissions';
import { useActiveBranchId } from './activeBranch';

/**
 * Returns the active operational branch filter.
 *
 * Rules:
 * - Super Admin may intentionally operate with no branch selected to view all.
 * - Every other role must operate through an explicitly selected/granted branch.
 * - users.branch_id is not an authorization fallback; branch grants + RLS are
 *   authoritative.
 */
export function useBranchFilter(): string | null {
  const { user } = useAuth();
  const [activeBranchId] = useActiveBranchId();
  if (!user) return null;
  if (activeBranchId) return activeBranchId;
  if (isAdminRole(user.role)) return null;
  return null;
}
