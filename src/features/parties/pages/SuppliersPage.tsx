import { useState } from 'react';
import { Plus, Edit2, Trash2, Download, Trophy } from 'lucide-react';
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
import { Input, Select, Textarea } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatDate, formatCurrency } from '@/lib/format';
import { exportToExcel } from '@/lib/excel';
import { logAudit } from '@/lib/audit';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import { useSettings } from '@/context/SettingsContext';
import { useBranches } from '@/hooks/useBranches';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import { useGuidedWorkflow } from '@/core/guard';
import type { Supplier, SupplierEvaluationRow } from '@/lib/types';

export function SuppliersPage() {
  const { t, lang } = useLanguage();
  const { show } = useToast();
  const can = useCan();
  const branchFilter = useBranchFilter();
  const { guidedContext, completePrerequisiteAndReturn } = useGuidedWorkflow();
  const { rows: items, loading, total, hasMore, loadMore, loadingMore, refresh: reloadSuppliers } = usePaginatedRows<Supplier>({
    table: 'suppliers',
    select: '*',
    order: { column: 'created_at', ascending: false },
    branch_id: branchFilter,
    pageSize: 100,
  });
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showEvaluation, setShowEvaluation] = useState(false);
  const [evaluation, setEvaluation] = useState<SupplierEvaluationRow[]>([]);
  const [evLoading, setEvLoading] = useState(false);
  const { effectiveSettings } = useSettings();
  const { branches } = useBranches();
  const currency = effectiveSettings(branchFilter)?.currency || 'EGP';
  const [form, setForm] = useState({ name: '', name_en: '', phone: '', email: '', address: '', tax_number: '', balance: 0, notes: '', branch_id: '' });

  const filtered = items.filter((s) => !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.phone?.includes(search));
  const openAdd = () => { setEditing(null); setForm({ name: '', name_en: '', phone: '', email: '', address: '', tax_number: '', balance: 0, notes: '', branch_id: branchFilter || '' }); setModalOpen(true); };
  const openEdit = (s: Supplier) => { setEditing(s); setForm({ name: s.name, name_en: s.name_en || '', phone: s.phone || '', email: s.email || '', address: s.address || '', tax_number: s.tax_number || '', balance: s.balance, notes: s.notes || '', branch_id: s.branch_id || branchFilter || '' }); setModalOpen(true); };

  const save = async () => {
    if (!form.name) { show(t('required'), 'error'); return; }
    const payload = { ...form, branch_id: branchFilter || form.branch_id || null };
    if (editing) {
      const { error } = await supabase.from('suppliers').update(payload).eq('id', editing.id);
      if (error) { show(error.message, 'error'); return; }
      await logAudit('update', 'suppliers', editing.id);
    } else {
      const { error } = await supabase.from('suppliers').insert(payload);
      if (error) { show(error.message, 'error'); return; }
      await logAudit('create', 'suppliers');
    }
    show(t('saveSuccess'), 'success');
    setModalOpen(false);
    reloadSuppliers();

    if (!editing && guidedContext?.missingStep.key.includes('supplier')) {
      setTimeout(() => {
        completePrerequisiteAndReturn();
      }, 500);
    }
  };

  const remove = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('suppliers').delete().eq('id', deleteId);
    if (error) show(error.message, 'error');
    else { show(t('deleteSuccess'), 'success'); await logAudit('delete', 'suppliers', deleteId); }
    setDeleteId(null);
    reloadSuppliers();
  };

  const handleExport = () => exportToExcel(items.map((s) => ({ Name: s.name, Phone: s.phone || '', Email: s.email || '', Address: s.address || '', TaxNumber: s.tax_number || '', Balance: s.balance })), 'suppliers');

  const loadEvaluation = async () => {
    setEvLoading(true);
    const { data } = await api.procurement.getSupplierEvaluation({ p_branch_id: branchFilter || null });
    setEvaluation(((data as SupplierEvaluationRow[]) || []).map((r) => ({ ...r, id: r.supplier_id })));
    setEvLoading(false);
  };

  const toggleEvaluation = () => {
    const next = !showEvaluation;
    setShowEvaluation(next);
    if (next) loadEvaluation();
  };

  const columns: Column<Supplier>[] = [
    { key: 'name', header: t('name'), render: (s) => <span className="font-medium text-ui-text">{s.name}</span> },
    { key: 'phone', header: t('phone'), render: (s) => s.phone || '-' },
    { key: 'email', header: t('emailField'), render: (s) => s.email || '-' },
    { key: 'address', header: t('address'), render: (s) => s.address || '-' },
    { key: 'balance', header: t('amount'), render: (s) => <span className={s.balance > 0 ? 'text-ui-danger font-medium' : ''}>{formatCurrency(s.balance, currency, lang)}</span> },
    { key: 'actions', header: t('actions'), render: (s) => (
      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
        {can('suppliers.manage') && (
          <button onClick={() => openEdit(s)} className="p-1.5 rounded-md hover:bg-ui-info-soft text-ui-info"><Edit2 className="w-4 h-4" /></button>
        )}
        {can('suppliers.manage') && (
          <button onClick={() => setDeleteId(s.id)} className="p-1.5 rounded-md hover:bg-ui-danger-soft text-ui-danger"><Trash2 className="w-4 h-4" /></button>
        )}
      </div>
    )},
  ];

  const evaluationColumns: Column<SupplierEvaluationRow>[] = [
    { key: 'supplier_name', header: t('supplier'), render: (r) => <span className="font-medium text-ui-text">{r.supplier_name}</span> },
    { key: 'orders_count', header: t('ordersCount'), render: (r) => r.orders_count },
    { key: 'total_purchased', header: t('totalPurchases'), render: (r) => <span className="font-semibold">{formatCurrency(r.total_purchased, currency, lang)}</span> },
    { key: 'total_returned', header: t('totalReturned'), render: (r) => formatCurrency(r.total_returned, currency, lang) },
    { key: 'return_rate', header: t('returnRate'), render: (r) => `${r.return_rate}%` },
    { key: 'avg_order_value', header: t('avgOrderValue'), render: (r) => formatCurrency(r.avg_order_value, currency, lang) },
    { key: 'quotations_count', header: t('quotationsCount'), render: (r) => r.quotations_count },
    { key: 'last_purchase_at', header: t('lastPurchaseAt'), render: (r) => (r.last_purchase_at ? formatDate(r.last_purchase_at, lang) : '-') },
  ];

  return (
    <DesignSurface testId="suppliers-page">
      <DesignPageHeader title={t('suppliers')} actions={
        <>
          {can('suppliers.manage') && (
            <Button variant="outline" size="sm" onClick={handleExport} data-testid="suppliers-export"><Download className="w-4 h-4" /> {t('exportExcel')}</Button>
          )}
          {can('purchases.evaluation') && (
            <Button variant="outline" size="sm" onClick={toggleEvaluation} data-testid="suppliers-evaluation"><Trophy className="w-4 h-4" /> {t('supplierEvaluation')}</Button>
          )}
          {can('suppliers.manage') && (
            <Button size="sm" onClick={openAdd} data-testid="suppliers-add"><Plus className="w-4 h-4" /> {t('add')}</Button>
          )}
        </>
      } />
      {showEvaluation ? (
        <DesignPanel testId="suppliers-evaluation-panel">
          <DataTable columns={evaluationColumns} data={evaluation} loading={evLoading} emptyMessage={t('noData')} />
        </DesignPanel>
      ) : (
        <>
          <DesignPanel testId="suppliers-search-panel">
            <DesignSearch value={search} onChange={setSearch} placeholder={t('search')} label={t('search')} testId="suppliers-search" />
          </DesignPanel>
          <DesignPanel testId="suppliers-table-panel">
            <DataTable columns={columns} data={filtered} loading={loading} emptyMessage={t('noData')} onRowClick={can('suppliers.manage') ? openEdit : undefined} />
            <DesignPagination loaded={items.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
          </DesignPanel>
        </>
      )}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? t('edit') : t('add')}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <Input label={t('nameEn')} value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} />
            <Input label={t('phone')} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <Input label={t('emailField')} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <Input label={t('address')} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            <Input label="Tax Number" value={form.tax_number} onChange={(e) => setForm({ ...form, tax_number: e.target.value })} />
          </div>
          {!branchFilter && (
            <Select label={t('branch')} value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
              <option value="">--</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          )}
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
