import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  hasPermission,
  isAdminRole,
  PERMISSION_GROUPS,
  ROLE_META,
  type Permission,
  type Role,
} from '@/lib/permissionDefs';

describe('isAdminRole', () => {
  it('treats only super_admin as implicit platform admin', () => {
    expect(isAdminRole('super_admin')).toBe(true);
    expect(isAdminRole('owner')).toBe(false);
  });

  it('treats all other roles and empty values as non-admin', () => {
    expect(isAdminRole('cashier')).toBe(false);
    expect(isAdminRole('branch_manager')).toBe(false);
    expect(isAdminRole('accountant')).toBe(false);
    expect(isAdminRole(null)).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
  });
});

describe('hasPermission', () => {
  it('denies when no role', () => {
    expect(hasPermission(null, null, 'pos.sell')).toBe(false);
    expect(hasPermission(undefined, undefined, 'pos.sell')).toBe(false);
  });

  it('grants super_admin every permission implicitly', () => {
    expect(hasPermission('super_admin', null, 'settings.manage')).toBe(true);
    expect(hasPermission('super_admin', {}, 'branches.manage')).toBe(true);
  });

  it('fails closed for every non-super-admin role when DB permissions are unavailable', () => {
    expect(hasPermission('owner', null, 'branches.manage')).toBe(false);
    expect(hasPermission('owner', {}, 'settings.manage')).toBe(false);
    expect(hasPermission('cashier', null, 'pos.sell')).toBe(false);
    expect(hasPermission('branch_manager', undefined, 'products.manage')).toBe(false);
    expect(hasPermission('accountant', {}, 'reports.financial')).toBe(false);
  });

  it('uses the explicit DB permission map for non-super-admin roles', () => {
    const map: Record<string, Permission[]> = {
      owner: ['branches.manage'],
      cashier: ['pos.sell'],
      branch_manager: ['products.view', 'products.manage'],
      accountant: ['reports.financial'],
    };

    expect(hasPermission('owner', map, 'branches.manage')).toBe(true);
    expect(hasPermission('owner', map, 'settings.manage')).toBe(false);
    expect(hasPermission('cashier', map, 'pos.sell')).toBe(true);
    expect(hasPermission('cashier', map, 'sales.view')).toBe(false);
    expect(hasPermission('branch_manager', map, 'products.manage')).toBe(true);
    expect(hasPermission('accountant', map, 'reports.financial')).toBe(true);
  });

  it('does not revive template permissions when a DB role is missing', () => {
    const map: Record<string, Permission[]> = { cashier: ['pos.sell'] };
    expect(hasPermission('branch_manager', map, 'products.manage')).toBe(false);
    expect(hasPermission('owner', map, 'branches.manage')).toBe(false);
  });
});

describe('permission model integrity', () => {
  it('all role templates only reference known permissions', () => {
    const known = new Set<Permission>(ALL_PERMISSIONS);
    for (const role of Object.keys(DEFAULT_ROLE_PERMISSIONS) as Role[]) {
      for (const permission of DEFAULT_ROLE_PERMISSIONS[role]) {
        expect(known.has(permission), `${role} references unknown permission ${permission}`).toBe(true);
      }
    }
  });

  it('every role in ROLE_META has a seed/edit template', () => {
    for (const role of Object.keys(ROLE_META) as Role[]) {
      expect(DEFAULT_ROLE_PERMISSIONS[role]).toBeDefined();
      expect(DEFAULT_ROLE_PERMISSIONS[role].length).toBeGreaterThan(0);
    }
  });

  it('every permission appears in a settings group', () => {
    const grouped = new Set<Permission>();
    for (const group of PERMISSION_GROUPS) {
      for (const permission of group.permissions) grouped.add(permission);
    }
    for (const permission of ALL_PERMISSIONS) {
      expect(grouped.has(permission), `${permission} missing from PERMISSION_GROUPS`).toBe(true);
    }
  });

  it('templates are configuration defaults, not runtime authorization bypasses', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.super_admin).toHaveLength(ALL_PERMISSIONS.length);
    expect(DEFAULT_ROLE_PERMISSIONS.owner).toHaveLength(ALL_PERMISSIONS.length);
    expect(hasPermission('owner', null, 'branches.manage')).toBe(false);
  });
});
