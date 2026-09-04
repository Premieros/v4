import { useState, useRef } from 'react';
import { Plus, Edit2, Trash2, Download, Upload } from 'lucide-react';
import { supabase } from '@/api';
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
import { formatCurrency } from '@/lib/format';
import { exportToExcel, importFromExcel } from '@/lib/excel';
import { logAudit } from '@/lib/audit';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import { useSettings } from '@/context/SettingsContext';
import { useBranches } from '@/hooks/useBranches';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import type { Customer } from '@/lib/types';

export function CustomersPage() {
  const { t, lang } = useLanguage();
  const { show } = useToast();
  const can = useCan();
  const branchFilter = useBranchFilter();
  const { rows: items, loading, total, hasMore, loadMore, loadingMore, refresh: reloadCustomers } = usePaginatedRows<Customer>({
    table: 'customers',
    select: '*',
    order: { column: 'created_at', ascending: false },
    branch_id: branchFilter,
    pageSize: 100,
  });
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const { effectiveSettings } = useSettings();
  const { branches } = useBranches();
  const currency = effectiveSettings(branchFilter)?.currency || 'EGP';
  const [form, setForm] = useState({ name: '', name_en: '', phone: '', email: '', address: '', tax_number: '', balance: 0, notes: '', branch_id: '' });

  const filtered = items.filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.phone?.includes(search));
  const openAdd = () => { setEditing(null); setForm({ name: '', name_en: '', phone: '', email: '', address: '', tax_number: '', balance: 0, notes: '', branch_id: branchFilter || '' }); setModalOpen(true); };
  const openEdit = (c: Customer) => { setEditing(c); setForm({ name: c.name, name_en: c.name_en || '', phone: c.phone || '', email: c.email || '', address: c.address || '', tax_number: c.tax_number || '', balance: c.balance, notes: c.notes || '', branch_id: c.branch_id || branchFilter || '' }); setModalOpen(true); };

  const save = async () => {
    if (!form.name) { show(t('required'), 'error'); return; }
    const payload = { ...form, branch_id: branchFilter || form.branch_id || null };
    if (editing) {
      const { error } = await supabase.from('customers').update(payload).eq('id', editing.id);
      if (error) { show(error.message, 'error'); return; }
      await logAudit('update', 'customers', editing.id);
    } else {
      const { error } = await supabase.from('customers').insert(payload);
      if (error) { show(error.message, 'error'); return; }
      await logAudit('create', 'customers');
    }
    show(t('saveSuccess'), 'success');
    setModalOpen(false);
    reloadCustomers();
  };

  const remove = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('customers').delete().eq('id', deleteId);
    if (error) show(error.message, 'error');
    else { show(t('deleteSuccess'), 'success'); await logAudit('delete', 'customers', deleteId); }
    setDeleteId(null);
    reloadCustomers();
  };

  const handleExport = () => exportToExcel(items.map((c) => ({ Name: c.name, Phone: c.phone || '', Email: c.email || '', Address: c.address || '', TaxNumber: c.tax_number || '', Balance: c.balance })), 'customers');

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rows = await importFromExcel(file);
      const payload = rows.map((r) => ({ name: String(r.Name || r.name || ''), phone: String(r.Phone || r.phone || ''), email: String(r.Email || r.email || ''), address: String(r.Address || r.address || ''), tax_number: String(r.TaxNumber || ''), balance: Number(r.Balance || 0), branch_id: branchFilter || branches[0]?.id || null })).filter((r) => r.name);
      const { error } = await supabase.from('customers').insert(payload);
      if (error) show(error.message, 'error');
      else { show(`${payload.length} ${t('import')} OK`, 'success'); reloadCustomers(); }
    } catch (err) { show(String(err), 'error'); }
  };

  const columns: Column<Customer>[] = [
    { key: 'name', header: t('name'), render: (c) => <span className="font-medium text-ui-text">{c.name}</span> },
    { key: 'phone', header: t('phone'), render: (c) => c.phone || '-' },
    { key: 'email', header: t('emailField'), render: (c) => c.email || '-' },
    { key: 'address', header: t('address'), render: (c) => c.address || '-' },
    { key: 'balance', header: t('amount'), render: (c) => <span className={c.balance > 0 ? 'text-ui-danger font-medium' : ''}>{formatCurrency(c.balance, currency, lang)}</span> },
    { key: 'actions', header: t('actions'), render: (c) => (
      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
        {can('customers.manage') && (
          <button onClick={() => openEdit(c)} className="p-1.5 rounded-md hover:bg-ui-info-soft text-ui-info"><Edit2 className="w-4 h-4" /></button>
        )}
        {can('customers.manage') && (
          <button onClick={() => setDeleteId(c.id)} className="p-1.5 rounded-md hover:bg-ui-danger-soft text-ui-danger"><Trash2 className="w-4 h-4" /></button>
        )}
      </div>
    )},
  ];

  return (
    <DesignSurface testId="customers-page">
      <DesignPageHeader title={t('customers')} actions={
        <>
          {can('customers.manage') && (
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} data-testid="customers-import" />
          )}
          {can('customers.manage') && (
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} data-testid="customers-import-button"><Upload className="w-4 h-4" /> {t('importExcel')}</Button>
          )}
          {can('customers.manage') && (
            <Button variant="outline" size="sm" onClick={handleExport} data-testid="customers-export"><Download className="w-4 h-4" /> {t('exportExcel')}</Button>
          )}
          {can('customers.manage') && (
            <Button size="sm" onClick={openAdd} data-testid="customers-add"><Plus className="w-4 h-4" /> {t('add')}</Button>
          )}
        </>
      } />
      <DesignPanel testId="customers-search-panel">
        <DesignSearch value={search} onChange={setSearch} placeholder={t('search')} label={t('search')} testId="customers-search" />
      </DesignPanel>
      <DesignPanel testId="customers-table-panel">
        <DataTable columns={columns} data={filtered} loading={loading} emptyMessage={t('noData')} onRowClick={openEdit} />
        <DesignPagination loaded={items.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
      </DesignPanel>
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
