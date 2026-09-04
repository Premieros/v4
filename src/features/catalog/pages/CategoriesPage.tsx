import { useState } from 'react';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import { supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { DesignSurface, DesignPageHeader } from '@/components/design/DesignSurface';
import { DesignPanel } from '@/components/design/DesignPanel';
import { DesignPagination } from '@/components/design/DesignPagination';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Input, Select, Textarea } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { logAudit } from '@/lib/audit';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import { useBranches } from '@/hooks/useBranches';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import type { Category } from '@/lib/types';

export function CategoriesPage() {
  const { t } = useLanguage();
  const { show } = useToast();
  const can = useCan();
  const branchFilter = useBranchFilter();
  const { rows: items, loading, total, hasMore, loadMore, loadingMore, refresh: reloadCategories } = usePaginatedRows<Category>({
    table: 'categories',
    select: '*',
    order: { column: 'created_at', ascending: false },
    branch_id: branchFilter,
    pageSize: 100,
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteSelectedConfirm, setDeleteSelectedConfirm] = useState(false);
  const { branches } = useBranches();
  const [form, setForm] = useState({ name: '', name_en: '', description: '', branch_id: '' });

  const openAdd = () => { setEditing(null); setForm({ name: '', name_en: '', description: '', branch_id: branchFilter || '' }); setModalOpen(true); };
  const openEdit = (c: Category) => { setEditing(c); setForm({ name: c.name, name_en: c.name_en || '', description: c.description || '', branch_id: c.branch_id || branchFilter || '' }); setModalOpen(true); };

  const save = async () => {
    if (!form.name) { show(t('required'), 'error'); return; }
    const payload = { ...form, branch_id: branchFilter || form.branch_id || null };
    if (editing) {
      const { error } = await supabase.from('categories').update(payload).eq('id', editing.id);
      if (error) { show(error.message, 'error'); return; }
      await logAudit('update', 'categories', editing.id);
    } else {
      const { error } = await supabase.from('categories').insert(payload);
      if (error) { show(error.message, 'error'); return; }
      await logAudit('create', 'categories');
    }
    show(t('saveSuccess'), 'success');
    setModalOpen(false);
    reloadCategories();
  };

  const remove = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('categories').delete().eq('id', deleteId);
    if (error) show(error.message, 'error');
    else { show(t('deleteSuccess'), 'success'); await logAudit('delete', 'categories', deleteId); }
    setDeleteId(null);
    reloadCategories();
  };

  const removeSelected = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    for (const id of ids) {
      await supabase.from('categories').delete().eq('id', id);
      await logAudit('delete', 'categories', id);
    }
    show(t('deleteSuccess'), 'success');
    setSelectedIds(new Set());
    setDeleteSelectedConfirm(false);
    reloadCategories();
  };

  const columns: Column<Category>[] = [
    { key: 'name', header: t('name'), render: (c) => <span className="font-medium text-ui-text">{c.name}</span> },
    { key: 'name_en', header: t('nameEn'), render: (c) => c.name_en || '-' },
    { key: 'description', header: t('description'), render: (c) => c.description || '-' },
    { key: 'actions', header: t('actions'), render: (c) => (
      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
        {can('categories.manage') && (
          <button onClick={() => openEdit(c)} className="p-1.5 rounded-md hover:bg-ui-info-soft text-ui-info"><Edit2 className="w-4 h-4" /></button>
        )}
        {can('categories.manage') && (
          <button onClick={() => setDeleteId(c.id)} className="p-1.5 rounded-md hover:bg-ui-danger-soft text-ui-danger"><Trash2 className="w-4 h-4" /></button>
        )}
      </div>
    )},
  ];

  return (
    <DesignSurface testId="categories-page">
      <DesignPageHeader title={t('categories')} actions={
        <>
          {selectedIds.size > 0 && can('categories.manage') && (
            <Button variant="danger" size="sm" onClick={() => setDeleteSelectedConfirm(true)} data-testid="categories-delete-selected">
              <Trash2 className="w-4 h-4" /> {t('deleteSelected')} ({selectedIds.size})
            </Button>
          )}
          {can('categories.manage') && (
            <Button size="sm" onClick={openAdd} data-testid="categories-add"><Plus className="w-4 h-4" /> {t('add')}</Button>
          )}
        </>
      } />
      <DesignPanel testId="categories-table-panel">
        <DataTable columns={columns} data={items} loading={loading} emptyMessage={t('noData')}
          onRowClick={can('categories.manage') ? openEdit : undefined} showCheckbox={can('categories.manage')} selectedIds={selectedIds} onSelectionChange={setSelectedIds} />
        <DesignPagination loaded={items.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
      </DesignPanel>
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? t('edit') : t('add')}>
        <div className="space-y-4">
          <Input label={t('name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Input label={t('nameEn')} value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} />
          <Textarea label={t('description')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
          {!branchFilter && (
            <Select label={t('branch')} value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
              <option value="">--</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</Button>
            <Button onClick={save}>{t('save')}</Button>
          </div>
        </div>
      </Modal>
      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={remove} title={t('delete')} message={t('confirmDelete')} confirmLabel={t('delete')} cancelLabel={t('cancel')} />
      <ConfirmDialog open={deleteSelectedConfirm} onClose={() => setDeleteSelectedConfirm(false)} onConfirm={removeSelected}
        title={t('deleteSelected')} message={t('confirmDeleteAll')} confirmLabel={t('delete')} cancelLabel={t('cancel')} />
    </DesignSurface>
  );
}
