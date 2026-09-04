import { useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRoles } from '../context/RolesContext';
import type { Permission, Role } from './permissionDefs';

export * from './permissionDefs';

/**
 * Only the platform Super Admin is an implicit admin.
 * Every other role is a label/template and must be authorized by the DB-backed
 * permission map plus branch access/RLS.
 */
export function isAdminRole(role?: Role | null): boolean {
  return role === 'super_admin';
}

/** Hook: memoized fail-closed can(permission) checker for the current user. */
export function useCan(): (permission: Permission) => boolean {
  const { user } = useAuth();
  const { rolePermissionsMap } = useRoles();

  return useCallback(
    (permission: Permission) => {
      if (!user?.role) return false;
      if (user.role === 'super_admin') return true;
      const permissions = rolePermissionsMap[user.role];
      return Array.isArray(permissions) && permissions.includes(permission);
    },
    [user, rolePermissionsMap]
  );
}
