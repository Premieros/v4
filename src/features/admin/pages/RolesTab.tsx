import { useEffect, useState } from 'react';
import { Plus, Save, Trash2, ShieldCheck } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { useRoles, type RoleScope } from '@/context/RolesContext';
import { useBranches } from '@/hooks/useBranches';
import { Card } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { logAudit } from '@/lib/audit';
import { ALL_PERMISSIONS, PERMISSION_GROUPS, PERMISSION_LABELS, isAdminRole, ROLE_META, type Permission } from '@/lib/permissions';
import type { Role } from '@/lib/types';

export function RolesTab() {
  const { t, lang } = useLanguage();
  const { show } = useToast();
  const { rolePermissionsMap, roleMeta, rolesList, loading, saveRole, createRole, deleteRole } = useRoles();
  const { branches } = useBranches();
  const isAr = lang === 'ar';
  const [drafts, setDrafts] = useState<Record<string, Permission[]>>({});
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({ role: '', name_ar: '', name_en: '', scope: 'global' as RoleScope, branch_id: '', description_ar: '', description_en: '' });
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    if (loading || Object.keys(rolePermissionsMap).length === 0) return;
    setDrafts((prev) => {
      const merged = { ...prev };
      for (const role of Object.keys(rolePermissionsMap)) {
        if (!merged[role]) merged[role] = [...rolePermissionsMap[role]];
      }
      return merged;
    });
  }, [loading, rolePermissionsMap]);

  const roles: string[] = rolesList.length > 0 ? rolesList.map((r) => r.role) : Object.keys(ROLE_META);

  const toggle = (role: string, perm: Permission) => {
    setDrafts((prev) => {
      const list = prev[role] ?? rolePermissionsMap[role] ?? [];
      const has = list.includes(perm);
      return { ...prev, [role]: has ? list.filter((p) => p !== perm) : [...list, perm] };
    });
  };

  const setAll = (role: string, value: boolean) => {
    setDrafts((prev) => ({ ...prev, [role]: value ? [...ALL_PERMISSIONS] : [] }));
  };

  const save = async (role: string) => {
    setSavingRole(role);
    const ok = await saveRole(role, drafts[role] ?? []);
    setSavingRole(null);
    if (ok) show(t('saveSuccess'), 'success');
    else show(isAr ? 'تعذر حفظ الصلاحيات' : 'Failed to save permissions', 'error');
  };

  const submitCreate = async () => {
    if (!createForm.role.trim() || !createForm.name_ar.trim()) { show(t('required'), 'error'); return; }
    const res = await createRole({
      role: createForm.role,
      name_ar: createForm.name_ar,
      name_en: createForm.name_en,
      scope: createForm.scope,
      branch_id: createForm.scope === 'branch' ? (createForm.branch_id || null) : null,
      description_ar: createForm.description_ar,
      description_en: createForm.description_en,
      permissions: [],
    });
    if (!res.success) {
      if (res.error === 'ROLE_EXISTS') show(isAr ? 'الدور موجود بالفعل' : 'Role already exists', 'error');
      else if (res.error === 'ROLE_CODE_REQUIRED') show(isAr ? 'أدخل رمزًا صالحًا للدور' : 'Enter a valid role code', 'error');
      else show(isAr ? 'تعذر إنشاء الدور: ' : 'Failed to create role: ' + (res.error || 'unknown'), 'error');
      return;
    }
    await logAudit('create', 'roles', res.role, { role: createForm.role });
    show(t('saveSuccess'), 'success');
    setCreating(false);
    setCreateForm({ role: '', name_ar: '', name_en: '', scope: 'global', branch_id: '', description_ar: '', description_en: '' });
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const res = await deleteRole(deleting);
    if (!res.success) {
      if (res.error === 'ROLE_IN_USE') show(isAr ? 'الدور مستخدم من قبل أحد الموظفين ولا يمكن حذفه' : 'Role is assigned to users and cannot be deleted', 'error');
      else if (res.error === 'SYSTEM_ROLE') show(isAr ? 'لا يمكن حذف الأدوار النظامية' : 'System roles cannot be deleted', 'error');
      else if (res.error === 'PERMISSION_DENIED') show(isAr ? 'ليس لديك صلاحية حذف هذا الدور' : 'You do not have permission to delete this role', 'error');
      else show(isAr ? 'تعذر حذف الدور: ' : 'Failed to delete role: ' + (res.error || 'unknown'), 'error');
      return;
    }
    await logAudit('delete', 'roles', deleting, { role: deleting });
    show(t('deleteSuccess'), 'success');
    setDeleting(null);
  };

  if (loading) {
    return (
      <Card className="p-10 text-center text-ui-subtle">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600 mx-auto mb-3" />
        <p className="text-sm">{isAr ? 'جارٍ تحميل الأدوار...' : 'Loading roles...'}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-ui-text mb-2 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-brand-600 dark:text-brand-400" /> {t('rolesTab')}
            </h3>
            <p className="text-sm text-ui-subtle dark:text-ui-subtle">
              {isAr
                ? 'تُحفظ الصلاحيات في قاعدة البيانات وتُطبَّق فورًا على جميع المستخدمين أصحاب الدور. الأدوار الإدارية (مدير عام / مالك) تملك كل الصلاحيات تلقائيًا.'
                : 'Permissions are stored in the database and apply immediately to every user with that role. Admin roles (Super Admin / Owner) always have full access.'}
            </p>
          </div>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="w-4 h-4" /> {isAr ? 'دور جديد' : 'New role'}
          </Button>
        </div>
      </Card>

      {roles.map((role) => {
        const def = rolesList.find((r) => r.role === role);
        const system = !!ROLE_META[role as Role];
        const admin = isAdminRole(role as Role);
        const custom = !system;
        const list = drafts[role] ?? rolePermissionsMap[role] ?? [];
        const count = list.length;
        return (
          <Card key={role} className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="font-semibold text-ui-text">{roleMeta[role]?.[lang] || role}</h4>
                  {def?.scope === 'branch' && (
                    <span className="px-2 py-0.5 rounded-full text-xs bg-ui-info-soft text-ui-info">
                      {isAr ? 'فرع' : 'Branch'} {branches.find((b) => b.id === def.branch_id)?.name || ''}
                    </span>
                  )}
                </div>
                <p className="text-xs text-ui-subtle dark:text-ui-subtle mt-0.5">
                  {count} / {ALL_PERMISSIONS.length} {isAr ? 'صلاحية' : 'permissions'} · <code className="text-ui-subtle">{role}</code>
                </p>
              </div>
              <div className="flex items-center gap-2">
                {admin ? (
                  <span className="px-3 py-1.5 rounded-lg bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400 text-xs font-medium">
                    {isAr ? 'كامل الصلاحيات تلقائيًا' : 'Full access by default'}
                  </span>
                ) : (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setAll(role, true)}>{t('all')}</Button>
                    <Button size="sm" variant="outline" onClick={() => setAll(role, false)}>{t('none')}</Button>
                    <Button size="sm" onClick={() => save(role)} disabled={savingRole === role}>
                      <Save className="w-4 h-4" /> {savingRole === role ? '...' : t('save')}
                    </Button>
                  </>
                )}
                {custom && (
                  <Button size="sm" variant="danger" onClick={() => setDeleting(role)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>

            {admin ? (
              <p className="text-sm text-ui-subtle">{isAr ? 'لا يمكن تقييد هذا الدور.' : 'This role cannot be restricted.'}</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {PERMISSION_GROUPS.map((group) => {
                  const groupAll = group.permissions.every((p) => list.includes(p));
                  const groupSome = group.permissions.some((p) => list.includes(p));
                  return (
                    <div key={group.key} className="border border-ui-border rounded-xl overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-2 bg-ui-page-alt/60">
                        <label className="flex items-center gap-2.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={groupAll}
                            ref={(el) => { if (el) el.indeterminate = groupSome && !groupAll; }}
                            onChange={() => {
                              const value = !groupAll;
                              setDrafts((prev) => {
                                const base = new Set(prev[role] ?? rolePermissionsMap[role] ?? []);
                                group.permissions.forEach((p) => { if (value) base.add(p); else base.delete(p); });
                                return { ...prev, [role]: [...base] };
                              });
                            }}
                            className="w-4 h-4 rounded border-ui-border text-brand-600 focus:ring-brand-500"
                          />
                          <span className="font-semibold text-sm text-ui-text">{group[lang]}</span>
                        </label>
                      </div>
                      <div className="px-3 py-2 space-y-1.5">
                        {group.permissions.map((perm) => (
                          <label key={perm} className="flex items-center gap-2.5 cursor-pointer py-0.5">
                            <input
                              type="checkbox"
                              checked={list.includes(perm)}
                              onChange={() => toggle(role, perm)}
                              className="w-4 h-4 rounded border-ui-border text-brand-600 focus:ring-brand-500"
                            />
                            <span className="text-sm text-ui-muted">{PERMISSION_LABELS[perm]?.[lang] || perm}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        );
      })}
      <p className="text-xs text-ui-subtle px-1">{isAr ? 'الدور المبني من القاعدة: أي تغيير يظهر فورًا، بدون إعادة تسجيل دخول.' : 'DB-backed roles: changes apply immediately, no re-login needed.'}</p>

      {/* Create role modal */}
      <Modal open={creating} onClose={() => setCreating(false)} title={isAr ? 'دور جديد' : 'New role'}>
        <div className="space-y-4">
          <Input
            label={isAr ? 'الرمز (بالإنجليزية)' : 'Code (English)'}
            value={createForm.role}
            onChange={(e) => setCreateForm({ ...createForm, role: e.target.value.replace(/\s+/g, '_').toLowerCase() })}
            placeholder="floor_supervisor"
            autoComplete="off"
          />
          <Input label={isAr ? 'الاسم (عربي)' : 'Name (Arabic)'} value={createForm.name_ar} onChange={(e) => setCreateForm({ ...createForm, name_ar: e.target.value })} />
          <Input label={isAr ? 'الاسم (إنجليزي)' : 'Name (English)'} value={createForm.name_en} onChange={(e) => setCreateForm({ ...createForm, name_en: e.target.value })} />
          <Select label={isAr ? 'النطاق' : 'Scope'} value={createForm.scope} onChange={(e) => setCreateForm({ ...createForm, scope: e.target.value as RoleScope })}>
            <option value="global">{isAr ? 'عام (كل الفروع)' : 'Global (all branches)'}</option>
            <option value="branch">{isAr ? 'فرع محدد' : 'Branch-specific'}</option>
          </Select>
          {createForm.scope === 'branch' && (
            <Select label={t('branch')} value={createForm.branch_id} onChange={(e) => setCreateForm({ ...createForm, branch_id: e.target.value })}>
              <option value="">--</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{isAr ? b.name : (b.name_en || b.name)}</option>)}
            </Select>
          )}
          <Input label={isAr ? 'الوصف (عربي)' : 'Description (Arabic)'} value={createForm.description_ar} onChange={(e) => setCreateForm({ ...createForm, description_ar: e.target.value })} />
          <Input label={isAr ? 'الوصف (إنجليزي)' : 'Description (English)'} value={createForm.description_en} onChange={(e) => setCreateForm({ ...createForm, description_en: e.target.value })} />
          <div className="flex justify-end gap-2">
            <button onClick={() => setCreating(false)} className="px-4 py-2 rounded-lg bg-ui-page-alt text-ui-text text-sm font-medium">{t('cancel')}</button>
            <button onClick={submitCreate} className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium">{t('save')}</button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title={isAr ? 'حذف الدور' : 'Delete role'}
        message={isAr ? 'هل تريد حذف هذا الدور؟ لن يتمكن المستخدمون المرتبطون به من تسجيل الدخول.' : 'Delete this role? Users assigned to it will no longer be able to sign in.'}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
      />
    </div>
  );
}
