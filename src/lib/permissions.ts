import { useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRoles } from '../context/RolesContext';
import { hasPermission, type Permission } from './permissionDefs';

export * from './permissionDefs';

/** Hook: memoized can(permission) checker for the current user. */
export function useCan(): (permission: Permission) => boolean {
  const { user } = useAuth();
  const { rolePermissionsMap } = useRoles();
  return useCallback(
    (permission: Permission) => hasPermission(user?.role, rolePermissionsMap, permission),
    [user, rolePermissionsMap]
  );
}
