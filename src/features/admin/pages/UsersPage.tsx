import { useState } from 'react';
import { Edit2, Plus, Shield, Trash2 } from 'lucide-react';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { DesignSurface, DesignPageHeader } from '@/components/design/DesignSurface';
import { DesignSearch } from '@/components/design/DesignSearch';
import { DesignPanel } from '@/components/design/DesignPanel';
import { DesignPagination } from '@/components/design/DesignPagination';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatDate } from '@/lib/format';
import { logAudit } from '@/lib/audit';
import { useAuth } from '@/context/AuthContext';
import { useRoles } from '@/context/RolesContext';
import { isAdminRole, ROLE_META } from '@/lib/permissions';
import { useBranches } from '@/hooks/useBranches';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import type { AppUser, Role } from '@/lib/types';

const ADMIN_ROLES: Role[] = ['super_admin', 'owner'];

export function UsersPage() {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';
  const { show } = useToast();
  const { user: me } = useAuth();
  const { roleMeta, rolesList } = useRoles();
  const isAdmin = isAdminRole(me?.role);
  const { rows: items, loading, total, hasMore, loadMore, loadingMore, refresh: reloadUsers } = usePaginatedRows<AppUser>({
    table: 'users',
    select: '*',
    order: { column: 'created_at', ascending: false },
    branch_id: !isAdmin && me?.branch_id ? me.branch_id : null,
    pageSize: 100,
  });
  const { branches } = useBranches();
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [form, setForm] = useState({ full_name: '', username: '', role: 'cashier', branch_id: '', is_active: true });
  const [newPassword, setNewPassword] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [addModal, setAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ full_name: '', username: '', email: '', password: '', role: 'cashier', branch_id: '', is_active: true });
  const [branchAccessIds, setBranchAccessIds] = useState<string[]>([]);

  const filtered = items.filter((u) => !search || u.email.toLowerCase().includes(search.toLowerCase()) || u.username?.toLowerCase().includes(search.toLowerCase()) || u.full_name?.toLowerCase().includes(search.toLowerCase()));

  const openEdit = async (u: AppUser) => {
    setEditing(u);
    setForm({ full_name: u.full_name || '', username: u.username || '', role: u.role, branch_id: u.branch_id || '', is_active: u.is_active });
    setNewPassword('');
    if (isAdmin) {
      const { data } = await supabase.rpc('get_user_branch_access', { p_user_id: u.id });
      setBranchAccessIds(((data as { branch_id: string }[]) ?? []).map((r) => r.branch_id));
    } else {
      setBranchAccessIds(u.branch_id ? [u.branch_id] : []);
    }
    setModalOpen(true);
  };

  const openAdd = () => {
    setAddForm({ full_name: '', username: '', email: '', password: '', role: 'cashier', branch_id: isAdmin ? '' : (me?.branch_id || ''), is_active: true });
    setAddModal(true);
  };

  const createNewUser = async () => {
    const email = addForm.email.trim();
    const username = addForm.username.trim().toLowerCase();
    if (!addForm.full_name || !email || !username || !addForm.password) { show(t('required'), 'error'); return; }
    if (!/^\d{4}$/.test(addForm.password)) { show(t('pinInvalid'), 'error'); return; }
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(username)) { show(t('usernameInvalid'), 'error'); return; }
    if (!isAdmin && (addForm.role === 'super_admin' || addForm.role === 'owner')) {
      show(t('noPermissionToCreateUser'), 'error'); return;
    }
    const { data, error } = await api.admin.createUser( {
      p_email: email,
      p_password: addForm.password,
      p_full_name: addForm.full_name,
      p_role: addForm.role,
      p_branch_id: addForm.branch_id || null,
      p_is_active: addForm.is_active,
      p_username: username,
    });
    if (error) { show(`${t('unknownErrorCreatingUser')}: ${error.message}`, 'error'); return; }
    const result = data as { success: boolean; error?: string; detail?: string; user_id?: string } | null;
    if (!result?.success) {
      if (result?.error === 'PERMISSION_DENIED') show(t('noPermissionToCreateUser'), 'error');
      else if (result?.error === 'EMAIL_TAKEN') show(t('emailAlreadyUsed'), 'error');
      else if (result?.error === 'USERNAME_TAKEN') show(t('usernameTaken'), 'error');
      else show(`${t('unknownErrorCreatingUser')}: ${result?.detail || 'unknown'}`, 'error');
      return;
    }
    await logAudit('create', 'users', result.user_id, { email });
    show(t('saveSuccess'), 'success');
    setAddModal(false);
    reloadUsers();
  };

  const save = async () => {
    if (!editing) return;
    if (!isAdmin && (form.role === 'super_admin' || form.role === 'owner')) { show(t('noPermissionToCreateUser'), 'error'); return; }
    const isAdminTarget = ADMIN_ROLES.includes(editing.role as Role);
    const demoting = isAdminTarget && !ADMIN_ROLES.includes(form.role as Role);
    const deactivating = isAdminTarget && editing.is_active && !form.is_active;
    if (demoting || deactivating) {
      const otherAdmins = items.filter((u) => u.id !== editing.id && ADMIN_ROLES.includes(u.role as Role) && u.is_active).length;
      if (otherAdmins === 0) { show(t('lastAdminWarning'), 'error'); return; }
    }
    const username = form.username.trim().toLowerCase();
    if (!username || !/^[a-z0-9][a-z0-9._-]*$/.test(username)) { show(t('usernameInvalid'), 'error'); return; }
    const payload = { full_name: form.full_name, username, role: form.role, branch_id: form.branch_id || null, is_active: form.is_active };
    const { error } = await supabase.from('users').update(payload).eq('id', editing.id);
    if (error) { show(error.message, 'error'); return; }
    if (newPassword) {
      if (newPassword.length < 4 || (newPassword.length === 4 && !/^\d{4}$/.test(newPassword))) { show(t('weakPassword'), 'error'); return; }
      const { data: pwData, error: pwError } = await api.admin.updateUserPassword( { p_user_id: editing.id, p_new_password: newPassword });
      if (pwError) { show(`${t('unknownErrorCreatingUser')}: ${pwError.message}`, 'error'); return; }
      const pwResult = pwData as { success: boolean; error?: string; detail?: string } | null;
      if (!pwResult?.success) {
        if (pwResult?.error === 'PERMISSION_DENIED') show(t('noPermissionToCreateUser'), 'error');
        else if (pwResult?.error === 'WEAK_PASSWORD') show(t('weakPassword'), 'error');
        else show(`${t('unknownErrorCreatingUser')}: ${pwResult?.detail || 'unknown'}`, 'error');
        return;
      }
    }
    await logAudit('update', 'users', editing.id, { ...payload, password_changed: !!newPassword });
    if (isAdmin && editing.id) {
      await supabase.rpc('set_user_branch_access', { p_user_id: editing.id, p_branch_ids: branchAccessIds.length > 0 ? branchAccessIds : [editing.branch_id].filter(Boolean) });
    }
    show(t('saveSuccess'), 'success');
    setModalOpen(false);
    setNewPassword('');
    reloadUsers();
  };

  const remove = async () => {
    if (!deleteId) return;
    const target = items.find((u) => u.id === deleteId);
    const { data, error } = await api.admin.deleteUser( { p_user_id: deleteId });
    if (error) { show(`${t('unknownErrorDeletingUser')}: ${error.message}`, 'error'); return; }
    const result = data as { success: boolean; error?: string; detail?: string } | null;
    if (!result?.success) {
      if (result?.error === 'PERMISSION_DENIED') show(t('noPermissionToDeleteUser'), 'error');
      else if (result?.error === 'LAST_ADMIN') show(t('lastAdminWarning'), 'error');
      else show(`${t('unknownErrorDeletingUser')}: ${result?.detail || 'unknown'}`, 'error');
      return;
    }
    await logAudit('delete', 'users', deleteId, { email: target?.email });
    show(t('deleteSuccess'), 'success');
    reloadUsers();
  };

  const roleOptions = (() => {
    const all = rolesList.length > 0 ? rolesList.filter((r) => r.is_active).map((r) => r.role) : Object.keys(ROLE_META);
    return isAdmin ? all : all.filter((r) => {
      if (ADMIN_ROLES.includes(r as Role)) return false;
      const def = rolesList.find((x) => x.role === r);
      return !def || def.scope === 'global' || def.branch_id === (me?.branch_id ?? null);
    });
  })();

  const columns: Column<AppUser>[] = [
    { key: 'username', header: t('username'), render: (u) => <span className="font-medium text-ui-text">{u.username || '-'}</span> },
    { key: 'email', header: t('email'), render: (u) => <span className="text-ui-muted">{u.email}</span> },
    { key: 'full_name', header: t('fullName'), render: (u) => u.full_name || '-' },
    { key: 'role', header: t('role'), render: (u) => (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400 capitalize">
        <Shield className="w-3 h-3" /> {roleMeta[u.role]?.[lang] || u.role}
      </span>
    )},
    { key: 'branch', header: t('branch'), render: (u) => branches.find((b) => b.id === u.branch_id)?.name || '-' },
    { key: 'is_active', header: t('status'), render: (u) => (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.is_active ? 'bg-ui-success-soft text-ui-success' : 'bg-ui-page-alt text-ui-subtle dark:text-ui-subtle'}`}>
        {u.is_active ? t('active') : t('inactive')}
      </span>
    )},
    { key: 'created_at', header: t('date'), render: (u) => formatDate(u.created_at) },
    { key: 'actions', header: t('actions'), render: (u) => (
      <div className="flex gap-1">
        <button onClick={() => openEdit(u)} className="p-1.5 rounded-md hover:bg-ui-info-soft text-ui-info" title={t('edit')}><Edit2 className="w-4 h-4" /></button>
        <button onClick={() => setDeleteId(u.id)} className="p-1.5 rounded-md hover:bg-ui-danger-soft text-ui-danger" title={t('deleteUser')}><Trash2 className="w-4 h-4" /></button>
      </div>
    )},
  ];

  return (
    <DesignSurface testId="users-page">
      <DesignPageHeader title={t('users')} actions={
        <Button size="sm" onClick={openAdd} data-testid="users-add"><Plus className="w-4 h-4" /> {t('addUser')}</Button>
      } />
      <DesignPanel testId="users-search-panel">
        <DesignSearch value={search} onChange={setSearch} placeholder={t('search')} label={t('search')} testId="users-search" />
      </DesignPanel>
      <DesignPanel testId="users-table-panel">
        <DataTable columns={columns} data={filtered} loading={loading} emptyMessage={t('noData')} />
        <DesignPagination loaded={items.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
      </DesignPanel>

      {/* Edit User Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={t('edit')}>
        {editing && (
          <div className="space-y-4">
            <div className="bg-ui-page-alt rounded-lg p-3">
              <p className="text-sm text-ui-subtle">{t('email')}</p>
              <p className="font-medium text-ui-text">{editing.email}</p>
            </div>
            <Input label={t('fullName')} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            <Input label={t('username')} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="off" />
            <Select label={t('role')} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {roleOptions.map((r) => <option key={r} value={r}>{roleMeta[r]?.[lang] || r}</option>)}
            </Select>
            <Select label={t('branch')} value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })} disabled={!isAdmin}>
              <option value="">--</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
            {isAdmin && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-ui-muted">{isAr ? 'صلاحيات الفروع' : 'Branch Access'}</p>
                <p className="text-xs text-ui-subtle">{isAr ? 'حدد الفروع التي يمكن للمستخدم الوصول إليها' : 'Select branches this user can access'}</p>
                <div className="max-h-40 overflow-y-auto space-y-1 border border-ui-border rounded-lg p-2">
                  {branches.map((b) => (
                    <label key={b.id} className="flex items-center gap-2 cursor-pointer text-sm py-1">
                      <input type="checkbox" checked={branchAccessIds.includes(b.id)} onChange={(e) => {
                        setBranchAccessIds(e.target.checked ? [...branchAccessIds, b.id] : branchAccessIds.filter((id) => id !== b.id));
                      }} className="rounded" />
                      <span>{b.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <Select label={t('status')} value={form.is_active ? '1' : '0'} onChange={(e) => setForm({ ...form, is_active: e.target.value === '1' })}>
              <option value="1">{t('active')}</option>
              <option value="0">{t('inactive')}</option>
            </Select>
            <Input label={t('pinChangeHint')} type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder={t('leaveBlankToKeepPassword')} inputMode="numeric" maxLength={4} />
            <div className="flex justify-end gap-2">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 rounded-lg bg-ui-page-alt text-ui-text text-sm font-medium">{t('cancel')}</button>
              <button onClick={save} className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium">{t('save')}</button>
            </div>
          </div>
        )}
      </Modal>

      {/* Add User Modal */}
      <Modal open={addModal} onClose={() => setAddModal(false)} title={t('addUser')}>
        <div className="space-y-4">
          <Input label={t('fullName')} value={addForm.full_name} onChange={(e) => setAddForm({ ...addForm, full_name: e.target.value })} required />
          <Input label={t('username')} value={addForm.username} onChange={(e) => setAddForm({ ...addForm, username: e.target.value })} required autoComplete="off" placeholder={isAr ? '��� ��������' : 'username'} />
          <Input label={t('email')} type="email" value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} required placeholder="email@example.com" />
          <Input label={t('pin')} type="password" value={addForm.password} onChange={(e) => setAddForm({ ...addForm, password: e.target.value.replace(/\D/g, '').slice(0, 4) })} required inputMode="numeric" maxLength={4} placeholder="1234" />
          <Select label={t('role')} value={addForm.role} onChange={(e) => setAddForm({ ...addForm, role: e.target.value })}>
            {roleOptions.map((r) => <option key={r} value={r}>{roleMeta[r]?.[lang] || r}</option>)}
          </Select>
          <Select label={t('branch')} value={addForm.branch_id} onChange={(e) => setAddForm({ ...addForm, branch_id: e.target.value })} disabled={!isAdmin}>
            <option value="">--</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <Select label={t('status')} value={addForm.is_active ? '1' : '0'} onChange={(e) => setAddForm({ ...addForm, is_active: e.target.value === '1' })}>
            <option value="1">{t('active')}</option>
            <option value="0">{t('inactive')}</option>
          </Select>
          <div className="flex justify-end gap-2">
            <button onClick={() => setAddModal(false)} className="px-4 py-2 rounded-lg bg-ui-page-alt text-ui-text text-sm font-medium">{t('cancel')}</button>
            <button onClick={createNewUser} className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium">{t('save')}</button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={remove} title={t('deleteUser')} message={t('confirmDeleteUser')} confirmLabel={t('delete')} cancelLabel={t('cancel')} />
    </DesignSurface>
  );
}
