import { useAuth } from '../context/AuthContext';
import { isAdminRole } from './permissions';
import { useActiveBranchId } from './activeBranch';

/** A non-existent UUID used to make branch-scoped reads fail closed. */
export const NO_BRANCH_ACCESS_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Returns the active operational branch filter.
 *
 * Rules:
 * - Super Admin may intentionally operate with no branch selected to view all.
 * - Every other role must operate through an explicitly selected/granted branch.
 * - users.branch_id is not an authorization fallback.
 * - Missing branch context for non-Super Admin resolves to an impossible UUID,
 *   never to an unfiltered query.
 */
export function useBranchFilter(): string | null {
  const { user } = useAuth();
  const [activeBranchId] = useActiveBranchId();
  if (!user) return NO_BRANCH_ACCESS_ID;
  if (activeBranchId) return activeBranchId;
  if (isAdminRole(user.role)) return null;
  return NO_BRANCH_ACCESS_ID;
}
