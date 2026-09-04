import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import {
  DEFAULT_ROLE_PERMISSIONS,
  ROLE_META,
  type Permission,
  type Role,
  type RoleDef,
} from '../lib/permissionDefs';

export type RoleScope = 'global' | 'branch';

export interface RoleDefRow extends Omit<RoleDef, 'role'> {
  role: string;
  scope: RoleScope;
  branch_id: string | null;
  description_ar: string | null;
  description_en: string | null;
  is_active: boolean;
}

interface RolesContextValue {
  rolesList: RoleDefRow[];
  rolePermissionsMap: Record<string, Permission[]>;
  roleMeta: Record<string, { ar: string; en: string }>;
  loading: boolean;
  refresh: () => Promise<void>;
  saveRole: (role: string, permissions: Permission[]) => Promise<boolean>;
  createRole: (input: {
    role: string;
    name_ar: string;
    name_en?: string;
    permissions: Permission[];
    scope?: RoleScope;
    branch_id?: string | null;
    description_ar?: string | null;
    description_en?: string | null;
  }) => Promise<{ success: boolean; error?: string; role?: string }>;
  deleteRole: (role: string) => Promise<{ success: boolean; error?: string }>;
}

const RolesContext = createContext<RolesContextValue | undefined>(undefined);

export function RolesProvider({ children }: { children: ReactNode }) {
  const [rolesList, setRolesList] = useState<RoleDefRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { session } = useAuth();

  const refresh = useCallback(async () => {
    if (!session) {
      setRolesList([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase.from('roles').select('*');
    if (!error && Array.isArray(data)) {
      const list: RoleDefRow[] = (data as Array<{
        role: string;
        name_ar: string;
        name_en: string;
        permissions: unknown;
        updated_at?: string;
        scope: RoleScope;
        branch_id: string | null;
        description_ar: string | null;
        description_en: string | null;
        is_active: boolean;
      }>).map((row) => ({
        role: row.role,
        name_ar: row.name_ar,
        name_en: row.name_en,
        permissions: normalizePermissions(row.permissions),
        updated_at: row.updated_at,
        scope: row.scope ?? 'global',
        branch_id: row.branch_id ?? null,
        description_ar: row.description_ar ?? null,
        description_en: row.description_en ?? null,
        is_active: row.is_active ?? true,
      }));
      setRolesList(list);
    }
    setLoading(false);
  }, [session]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const rolePermissionsMap = useMemo(() => {
    const map: Record<string, Permission[]> = {};
    for (const def of rolesList) map[def.role] = def.permissions;
    if (Object.keys(map).length === 0) {
      for (const role of Object.keys(DEFAULT_ROLE_PERMISSIONS) as Role[]) {
        map[role] = DEFAULT_ROLE_PERMISSIONS[role];
      }
    }
    return map;
  }, [rolesList]);

  const roleMeta = useMemo(() => {
    const meta: Record<string, { ar: string; en: string }> = { ...ROLE_META };
    for (const def of rolesList) {
      if (!meta[def.role]) {
        meta[def.role] = { ar: def.name_ar || def.role, en: def.name_en || def.role };
      } else {
        meta[def.role] = { ar: def.name_ar || meta[def.role].ar, en: def.name_en || meta[def.role].en };
      }
    }
    return meta;
  }, [rolesList]);

  const saveRole = useCallback(async (role: string, permissions: Permission[]): Promise<boolean> => {
    const existing = rolesList.find((r) => r.role === role);
    const payload = {
      role,
      name_ar: existing?.name_ar ?? ROLE_META[role as Role]?.ar ?? role,
      name_en: existing?.name_en ?? ROLE_META[role as Role]?.en ?? role,
      permissions,
      updated_at: new Date().toISOString(),
    };
    const { error } = existing
      ? await supabase.from('roles').update(payload).eq('role', role)
      : await supabase.from('roles').insert(payload);
    if (error) return false;
    await refresh();
    return true;
  }, [rolesList, refresh]);

  const createRole = useCallback(async (input: {
    role: string;
    name_ar: string;
    name_en?: string;
    permissions: Permission[];
    scope?: RoleScope;
    branch_id?: string | null;
    description_ar?: string | null;
    description_en?: string | null;
  }): Promise<{ success: boolean; error?: string; role?: string }> => {
    const role = input.role.trim().replace(/\s+/g, '_').toLowerCase();
    if (!role) return { success: false, error: 'ROLE_CODE_REQUIRED' };
    if (rolesList.some((r) => r.role === role)) return { success: false, error: 'ROLE_EXISTS' };
    const { error } = await supabase.from('roles').insert({
      role,
      name_ar: input.name_ar.trim(),
      name_en: input.name_en?.trim() || input.name_ar.trim(),
      permissions: input.permissions,
      scope: input.scope ?? 'global',
      branch_id: input.branch_id ?? null,
      description_ar: input.description_ar?.trim() || null,
      description_en: input.description_en?.trim() || null,
      is_active: true,
      updated_at: new Date().toISOString(),
    });
    if (error) return { success: false, error: error.message };
    await refresh();
    return { success: true, role };
  }, [rolesList, refresh]);

  const deleteRole = useCallback(async (role: string): Promise<{ success: boolean; error?: string }> => {
    const def = rolesList.find((r) => r.role === role);
    if (!def) return { success: false, error: 'NOT_FOUND' };
    if (def.scope === 'global' && Object.prototype.hasOwnProperty.call(ROLE_META, role)) {
      return { success: false, error: 'SYSTEM_ROLE' };
    }
    const { count, error: countError } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('role', role);
    if (countError) return { success: false, error: countError.message };
    if ((count ?? 0) > 0) return { success: false, error: 'ROLE_IN_USE' };
    const { error } = await supabase.from('roles').delete().eq('role', role);
    if (error) return { success: false, error: error.message };
    await refresh();
    return { success: true };
  }, [rolesList, refresh]);

  return (
    <RolesContext.Provider value={{ rolesList, rolePermissionsMap, roleMeta, loading, refresh, saveRole, createRole, deleteRole }}>
      {children}
    </RolesContext.Provider>
  );
}

function normalizePermissions(value: unknown): Permission[] {
  if (!Array.isArray(value)) return [];
  return value.filter((p): p is Permission => typeof p === 'string');
}

export function useRoles() {
  const ctx = useContext(RolesContext);
  if (!ctx) throw new Error('useRoles must be used within RolesProvider');
  return ctx;
}
