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
  it('treats super_admin and owner as admin', () => {
    expect(isAdminRole('super_admin')).toBe(true);
    expect(isAdminRole('owner')).toBe(true);
  });

  it('treats other roles and undefined as non-admin', () => {
    expect(isAdminRole('cashier')).toBe(false);
    expect(isAdminRole('branch_manager')).toBe(false);
    expect(isAdminRole(null)).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
  });
});

describe('hasPermission', () => {
  it('denies when no role', () => {
    expect(hasPermission(null, null, 'pos.sell')).toBe(false);
    expect(hasPermission(undefined, undefined, 'pos.sell')).toBe(false);
  });

  it('admins always have every permission', () => {
    expect(hasPermission('super_admin', null, 'settings.manage')).toBe(true);
    expect(hasPermission('owner', {}, 'branches.manage')).toBe(true);
  });

  it('resolves from role defaults when no DB map', () => {
    expect(hasPermission('cashier', null, 'pos.sell')).toBe(true);
    expect(hasPermission('cashier', null, 'settings.manage')).toBe(false);
    expect(hasPermission('accountant', null, 'reports.financial')).toBe(true);
  });

  it('POS action permissions follow the default role matrix', () => {
    expect(hasPermission('cashier', null, 'pos.reprint')).toBe(true);
    expect(hasPermission('cashier', null, 'pos.discount')).toBe(false);
    expect(hasPermission('cashier', null, 'pos.change_price')).toBe(false);
    expect(hasPermission('branch_manager', null, 'pos.discount')).toBe(true);
    expect(hasPermission('branch_manager', null, 'pos.change_price')).toBe(true);
    expect(hasPermission('super_admin', null, 'pos.discount')).toBe(true);
  });

  it('print/export/import permissions follow the default role matrix', () => {
    expect(hasPermission('cashier', null, 'products.print')).toBe(true);
    expect(hasPermission('cashier', null, 'products.export')).toBe(false);
    expect(hasPermission('warehouse_manager', null, 'products.export')).toBe(true);
    expect(hasPermission('warehouse_manager', null, 'products.import')).toBe(true);
    expect(hasPermission('accountant', null, 'sales.export')).toBe(true);
    expect(hasPermission('accountant', null, 'reports.print')).toBe(true);
    expect(hasPermission('branch_manager', null, 'reports.export')).toBe(true);
    expect(hasPermission('production_manager', null, 'products.import')).toBe(true);
  });

  it('DB map overrides code defaults', () => {
    const map: Record<string, Permission[]> = { cashier: ['pos.sell'] };
    expect(hasPermission('cashier', map, 'sales.view')).toBe(false);
    expect(hasPermission('cashier', map, 'pos.sell')).toBe(true);
  });
});

describe('permission model integrity', () => {
  it('all role defaults only reference known permissions', () => {
    const known = new Set<Permission>(ALL_PERMISSIONS);
    for (const role of Object.keys(DEFAULT_ROLE_PERMISSIONS) as Role[]) {
      for (const p of DEFAULT_ROLE_PERMISSIONS[role]) {
        expect(known.has(p), `${role} references unknown permission ${p}`).toBe(true);
      }
    }
  });

  it('every role in ROLE_META has defaults', () => {
    for (const role of Object.keys(ROLE_META) as Role[]) {
      expect(DEFAULT_ROLE_PERMISSIONS[role]).toBeDefined();
      expect(DEFAULT_ROLE_PERMISSIONS[role].length).toBeGreaterThan(0);
    }
  });

  it('every permission appears in a group (reviewable in the settings UI)', () => {
    const grouped = new Set<Permission>();
    for (const g of PERMISSION_GROUPS) {
      for (const p of g.permissions) grouped.add(p);
    }
    for (const p of ALL_PERMISSIONS) {
      expect(grouped.has(p), `${p} missing from PERMISSION_GROUPS`).toBe(true);
    }
  });

  it('admin roles have full permission sets', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.super_admin).toHaveLength(ALL_PERMISSIONS.length);
    expect(DEFAULT_ROLE_PERMISSIONS.owner).toHaveLength(ALL_PERMISSIONS.length);
  });
});
