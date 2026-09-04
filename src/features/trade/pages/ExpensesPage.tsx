import { useState } from 'react';
import { Plus, Edit2, Trash2, Download } from 'lucide-react';
import { supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useToast } from '@/components/Toast';
import { useCan } from '@/lib/permissions';
import { DesignSurface, DesignPageHeader, DesignSearch, DesignPanel, DesignPagination } from '@/components/design';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Input, Select, Textarea } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatCurrency, formatDate, todayISO } from '@/lib/format';
import { exportToExcel } from '@/lib/excel';
import { logAudit } from '@/lib/audit';
import { useSettings } from '@/context/SettingsContext';
import { useBranches } from '@/hooks/useBranches';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import type { Expense } from '@/lib/types';

const EXPENSE_CATEGORIES = ['rent', 'utilities', 'salaries', 'supplies', 'maintenance', 'marketing', 'transport', 'other'];

export function ExpensesPage() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const branchFilter = useBranchFilter();
  const { show } = useToast();
  const can = useCan();
  const { rows: items, loading, error, total, hasMore, loadMore, loadingMore, refresh: reloadExpenses } = usePaginatedRows<Expense>({
    table: 'expenses',
    order: { column: 'expense_date', ascending: false },
    branch_id: branchFilter,
    pageSize: 100,
  });
  const { effectiveSettings } = useSettings();
  const { branches } = useBranches();
  const currency = effectiveSettings(branchFilter)?.currency || 'EGP';
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({ category: '', description: '', amount: 0, branch_id: '', payment_method: 'cash', expense_date: todayISO(), notes: '' });

  const filtered = items.filter((e) => !search || e.description?.toLowerCase().includes(search.toLowerCase()) || e.category?.toLowerCase().includes(search.toLowerCase()));
  const openAdd = () => { setEditing(null); setForm({ category: '', description: '', amount: 0, branch_id: branchFilter || '', payment_method: 'cash', expense_date: todayISO(), notes: '' }); setModalOpen(true); };
  const openEdit = (e: Expense) => { setEditing(e); setForm({ category: e.category || '', description: e.description || '', amount: e.amount, branch_id: e.branch_id || '', payment_method: e.payment_method, expense_date: e.expense_date, notes: e.notes || '' }); setModalOpen(true); };

  const save = async () => {
    if (!form.amount || form.amount <= 0) { show(t('required') + ': ' + t('amount'), 'error'); return; }
    const base = { ...form, branch_id: branchFilter || form.branch_id || null };
    if (editing) {
      const { error } = await supabase.from('expenses').update(base).eq('id', editing.id);
      if (error) { show(error.message, 'error'); return; }
      await logAudit('update', 'expenses', editing.id);
    } else {
      const { error } = await supabase.from('expenses').insert({ ...base, created_by: user?.id || null });
      if (error) { show(error.message, 'error'); return; }
      await logAudit('create', 'expenses');
    }
    show(t('saveSuccess'), 'success');
    setModalOpen(false);
    reloadExpenses();
  };

  const remove = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('expenses').delete().eq('id', deleteId);
    if (error) show(error.message, 'error');
    else { show(t('deleteSuccess'), 'success'); await logAudit('delete', 'expenses', deleteId); }
    setDeleteId(null);
    reloadExpenses();
  };

  const handleExport = () => exportToExcel(items.map((e) => ({ Date: e.expense_date, Category: e.category || '', Description: e.description || '', Amount: e.amount, PaymentMethod: e.payment_method })), 'expenses');

  const columns: Column<Expense>[] = [
    { key: 'expense_date', header: t('date'), render: (e) => formatDate(e.expense_date, lang) },
    { key: 'category', header: t('expenseCategory'), render: (e) => <span className="capitalize">{e.category || '-'}</span> },
    { key: 'description', header: t('description'), render: (e) => e.description || '-' },
    { key: 'amount', header: t('amount'), render: (e) => <span className="font-semibold text-ui-danger">{formatCurrency(e.amount, currency, lang)}</span> },
    { key: 'payment_method', header: t('paymentMethod'), render: (e) => <span className="capitalize">{e.payment_method}</span> },
    { key: 'actions', header: t('actions'), render: (e) => (
      <div className="flex gap-1">
        {can('expenses.manage') && (
          <button onClick={() => openEdit(e)} className="p-1.5 rounded-md hover:bg-ui-info-soft text-ui-info"><Edit2 className="w-4 h-4" /></button>
        )}
        {can('expenses.manage') && (
          <button onClick={() => setDeleteId(e.id)} className="p-1.5 rounded-md hover:bg-ui-danger-soft text-ui-danger"><Trash2 className="w-4 h-4" /></button>
        )}
      </div>
    )},
  ];

  return (
    <DesignSurface testId="expenses-page">
      <DesignPageHeader title={t('expenses')} actions={
        <>
          <Button variant="outline" size="sm" onClick={handleExport}><Download className="w-4 h-4" /> {t('exportExcel')}</Button>
          {can('expenses.manage') && (
            <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4" /> {t('add')}</Button>
          )}
        </>
      } />
      <DesignPanel testId="expenses-search-panel">
        <DesignSearch value={search} onChange={setSearch} label={t('search')} placeholder={t('search')} testId="expenses-search" />
      </DesignPanel>
      <DesignPanel testId="expenses-table-panel">
        <DataTable columns={columns} data={filtered} loading={loading} error={error} emptyMessage={t('noData')} onRowClick={openEdit} />
        <DesignPagination loaded={items.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
      </DesignPanel>
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? t('edit') : t('add')}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Select label={t('expenseCategory')} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="">--</option>
              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}
            </Select>
            <Input label={t('expenseDate')} type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} required />
            <Input label={t('amount')} type="number" step="0.01" value={form.amount || ''} onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} required />
            <Select label={t('paymentMethod')} value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>
              <option value="cash">{t('cash')}</option>
              <option value="card">{t('card')}</option>
              <option value="transfer">{t('transfer')}</option>
            </Select>
            {!branchFilter && (
              <Select label={t('branch')} value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
                <option value="">--</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            )}
          </div>
          <Input label={t('description')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <Textarea label={t('notes')} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</Button>
            <Button onClick={save}>{t('save')}</Button>
          </div>
        </div>
      </Modal>
      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={remove} title={t('delete')} message={t('confirmDelete')} confirmLabel={t('delete')} cancelLabel={t('cancel')} />
    </DesignSurface>
  );
}
