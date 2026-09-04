import { useEffect, useState } from 'react';
import { Plus, Edit2, Boxes, Layers, Trash2 } from 'lucide-react';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { useCan } from '@/lib/permissions';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { DesignSurface, DesignPageHeader, DesignSearch, DesignPanel, DesignPagination } from '@/components/design';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatNumber, formatDate } from '@/lib/format';
import { logAudit } from '@/lib/audit';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import type { RawMaterial, RawMaterialInventory, RawMaterialBatch, Unit, Branch, RpcResult } from '@/lib/types';

type Tab = 'materials' | 'stock' | 'batches';

interface MaterialForm {
  id?: string;
  code: string;
  name: string;
  unit_id: string;
  category: string;
  min_stock: number;
  default_cost: number;
  description: string;
  is_active: boolean;
}

const EMPTY_FORM: MaterialForm = {
  code: '', name: '', unit_id: '', category: '',
  min_stock: 0, default_cost: 0, description: '', is_active: true,
};

export function RawMaterialsPage() {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';
  const { show } = useToast();
  const can = useCan();
  const branchFilter = useBranchFilter();

  const [tab, setTab] = useState<Tab>('materials');
  const { rows: materials, loading: materialsLoading, error, total, hasMore, loadMore, loadingMore, refresh: reloadMaterials } = usePaginatedRows<RawMaterial>({
    table: 'raw_materials',
    select: '*, unit:units(*)',
    order: { column: 'name', ascending: true },
    pageSize: 100,
  });
  const [inventory, setInventory] = useState<RawMaterialInventory[]>([]);
  const [batches, setBatches] = useState<RawMaterialBatch[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [stockBranch, setStockBranch] = useState(branchFilter || '');

  const [form, setForm] = useState<MaterialForm>(EMPTY_FORM);
  const [modalOpen, setModalOpen] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<RawMaterialInventory | null>(null);
  const [adjustQty, setAdjustQty] = useState(0);
  const [adjustReason, setAdjustReason] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  async function loadMeta() {
    setLoading(true);
    try {
      const [inv, b, u, br] = await Promise.all([
        supabase.from('raw_material_inventory').select('*, raw_material:raw_materials(*), branch:branches(*)').order('updated_at', { ascending: false }),
        supabase.from('raw_material_batches').select('*, raw_material:raw_materials(*), branch:branches(*)').order('created_at', { ascending: false }),
        supabase.from('measurement_units').select('*').eq('is_active', true).order('name'),
        supabase.from('branches').select('*').eq('is_active', true).order('name'),
      ]);
      setInventory((inv.data as RawMaterialInventory[]) || []);
      setBatches((b.data as RawMaterialBatch[]) || []);
      setUnits((u.data as Unit[]) || []);
      setBranches((br.data as Branch[]) || []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { loadMeta(); }, []);

  const branchLabel = (id: string | null | undefined) =>
    branches.find((br) => br.id === id)?.name || '-';
  const unitLabel = (id: string | null | undefined) =>
    units.find((u) => u.id === id)?.name || '-';

  const filteredMaterials = materials.filter((m) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return m.name.toLowerCase().includes(q) || (m.code || '').toLowerCase().includes(q) || (m.category || '').toLowerCase().includes(q);
  });

  const filteredStock = inventory.filter((i) => !stockBranch || i.branch_id === stockBranch);
  const filteredBatches = batches.filter((b) => !stockBranch || b.branch_id === stockBranch);

  const openAdd = () => { setForm(EMPTY_FORM); setModalOpen(true); };
  const openEdit = (m: RawMaterial) => {
    setForm({
      id: m.id, code: m.code, name: m.name, unit_id: m.unit_id || '',
      category: m.category || '', min_stock: Number(m.min_stock),
      default_cost: Number(m.default_cost), description: m.description || '',
      is_active: m.is_active,
    });
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.code.trim() || !form.name.trim()) { show(t('required'), 'error'); return; }
    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      unit_id: form.unit_id || null,
      category: form.category.trim() || null,
      min_stock: form.min_stock,
      default_cost: form.default_cost,
      description: form.description.trim() || null,
      is_active: form.is_active,
    };
    if (form.id) {
      const { error } = await supabase.from('raw_materials').update(payload).eq('id', form.id);
      if (error) { show(error.message, 'error'); return; }
      await logAudit('update', 'raw_materials', form.id);
      show(t('saveSuccess'), 'success');
    } else {
      const { data, error } = await supabase.from('raw_materials').insert(payload).select().single();
      if (error) { show(error.message, 'error'); return; }
      await logAudit('create', 'raw_materials', (data as RawMaterial)?.id);
      show(t('saveSuccess'), 'success');
    }
    setModalOpen(false);
    reloadMaterials();
  };

  const remove = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('raw_materials').delete().eq('id', deleteId);
    if (error) show(error.message, 'error');
    else { show(t('deleteSuccess'), 'success'); await logAudit('delete', 'raw_materials', deleteId); }
    setDeleteId(null);
    reloadMaterials();
  };

  const openAdjust = (inv: RawMaterialInventory) => {
    setAdjustTarget(inv);
    setAdjustQty(Number(inv.quantity));
    setAdjustReason('');
  };

  const saveAdjust = async () => {
    if (!adjustTarget) return;
    const { data, error } = await api.inventory.adjustRawStock({
      p_raw_material_id: adjustTarget.raw_material_id,
      p_branch_id: adjustTarget.branch_id,
      p_new_quantity: adjustQty,
      p_reason: adjustReason || null,
    });
    if (error) { show(error.message, 'error'); return; }
    const result = data as RpcResult | null;
    if (!result?.success) { show(result?.detail || result?.error || t('error'), 'error'); return; }
    await logAudit('update', 'raw_material_inventory', adjustTarget.id, { from: adjustTarget.quantity, to: adjustQty });
    show(t('saveSuccess'), 'success');
    setAdjustTarget(null);
    loadMeta();
  };

  const materialColumns: Column<RawMaterial>[] = [
    { key: 'name', header: t('materialName'), render: (m) => (
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-ui-success-soft  flex items-center justify-center text-xs font-bold text-ui-success dark:text-ui-success">
          {m.name[0]}
        </div>
        <div>
          <p className="font-medium text-ui-text">{m.name}</p>
          {m.code && <p className="text-xs text-ui-subtle">{m.code}</p>}
        </div>
      </div>
    )},
    { key: 'unit', header: t('unit'), render: (m) => unitLabel(m.unit_id) },
    { key: 'category', header: t('category'), render: (m) => m.category || '-' },
    { key: 'min_stock', header: t('minStock'), render: (m) => formatNumber(Number(m.min_stock)) },
    { key: 'default_cost', header: t('defaultCost'), render: (m) => formatNumber(Number(m.default_cost), 2) },
    { key: 'is_active', header: t('status'), render: (m) => (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${m.is_active ? 'bg-ui-success-soft text-ui-success' : 'bg-ui-page-alt text-ui-subtle dark:text-ui-subtle'}`}>
        {m.is_active ? t('active') : t('inactive')}
      </span>
    )},
    { key: 'actions', header: t('actions'), render: (m) => (
      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
        {can('raw_materials.manage') && (
          <button onClick={() => openEdit(m)} className="p-1.5 rounded-md hover:bg-ui-info-soft text-ui-info" title={t('edit')}>
            <Edit2 className="w-4 h-4" />
          </button>
        )}
        {can('raw_materials.manage') && (
          <button onClick={() => setDeleteId(m.id)} className="p-1.5 rounded-md hover:bg-ui-danger-soft text-ui-danger" title={t('delete')}>
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    )},
  ];

  const stockColumns: Column<RawMaterialInventory>[] = [
    { key: 'material', header: t('rawMaterial'), render: (i) => i.raw_material?.name || '-' },
    { key: 'branch', header: t('branch'), render: (i) => branchLabel(i.branch_id) },
    { key: 'quantity', header: t('quantity'), render: (i) => (
      <span className={`font-semibold ${Number(i.quantity) < Number(i.min_stock) ? 'text-ui-danger' : 'text-ui-text'}`}>
        {formatNumber(Number(i.quantity))}
      </span>
    )},
    { key: 'avg_cost', header: t('avgCost'), render: (i) => formatNumber(Number(i.avg_cost), 2) },
    { key: 'actions', header: t('actions'), render: (i) => (
      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
        {can('raw_materials.manage') && (
          <button onClick={() => openAdjust(i)} className="p-1.5 rounded-md hover:bg-ui-info-soft text-ui-info" title={t('adjustRawStock')}>
            <Edit2 className="w-4 h-4" />
          </button>
        )}
      </div>
    )},
  ];

  const batchColumns: Column<RawMaterialBatch>[] = [
    { key: 'material', header: t('rawMaterial'), render: (b) => b.raw_material?.name || '-' },
    { key: 'branch', header: t('branch'), render: (b) => branchLabel(b.branch_id) },
    { key: 'batch_number', header: t('batchNumber'), render: (b) => b.batch_number || '-' },
    { key: 'quantity', header: t('quantity'), render: (b) => formatNumber(Number(b.quantity)) },
    { key: 'unit_cost', header: t('unitCost'), render: (b) => formatNumber(Number(b.unit_cost), 2) },
    { key: 'expiry_date', header: t('expiryDate'), render: (b) => b.expiry_date ? formatDate(b.expiry_date, lang) : '-' },
    { key: 'source_type', header: t('sourceType'), render: (b) => b.source_type },
  ];

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'materials', label: t('rawMaterials'), icon: <Boxes className="w-4 h-4" /> },
    { key: 'stock', label: t('stockByBranch'), icon: <Layers className="w-4 h-4" /> },
    { key: 'batches', label: t('batches'), icon: <Layers className="w-4 h-4" /> },
  ];

  return (
    <DesignSurface testId="raw-materials-page">
      <DesignPageHeader title={t('rawMaterials')} subtitle={isAr ? 'إدارة المواد الخام وأرصدتها ودفعاتها' : 'Manage raw materials, stock and batches'} actions={
        can('raw_materials.manage') ? (
          <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4" /> {t('addRawMaterial')}</Button>
        ) : undefined
      } />

      <div className="flex flex-wrap gap-2 mb-4">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
              tab === tb.key
                ? 'bg-ui-primary text-ui-primary-fg shadow-lg shadow-ui-primary/25 scale-[1.02]'
                : 'liquid-glass text-ui-text hover:border-ui-primary/40 hover:bg-ui-surface/90'
            }`}
          >
            {tb.icon}
            {tb.label}
          </button>
        ))}
      </div>

      {tab !== 'materials' && (
        <DesignPanel testId="raw-materials-branch-panel">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <Select value={stockBranch} onChange={(e) => setStockBranch(e.target.value)} label={t('branch')} className="sm:w-64">
              <option value="">{t('all')} - {t('branches')}</option>
              {branches.map((br) => <option key={br.id} value={br.id}>{br.name}</option>)}
            </Select>
          </div>
        </DesignPanel>
      )}

      {tab === 'materials' && (
        <DesignPanel testId="raw-materials-search-panel">
          <DesignSearch value={search} onChange={setSearch} label={t('search')} placeholder={t('search')} testId="raw-materials-search" />
        </DesignPanel>
      )}

      <DesignPanel testId="raw-materials-table-panel">
        {tab === 'materials' && (
          <>
            <DataTable columns={materialColumns} data={filteredMaterials} loading={materialsLoading} error={error} emptyMessage={t('noData')} />
            <DesignPagination loaded={materials.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
          </>
        )}
        {tab === 'stock' && (
          <DataTable columns={stockColumns} data={filteredStock} loading={loading} error={error} emptyMessage={t('noData')} />
        )}
        {tab === 'batches' && (
          <DataTable columns={batchColumns} data={filteredBatches} loading={loading} error={error} emptyMessage={t('noData')} />
        )}
      </DesignPanel>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={form.id ? t('editRawMaterial') : t('addRawMaterial')} size="lg">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label={t('materialName')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label={t('code')} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="RM-001" />
          <Select label={t('unit')} value={form.unit_id} onChange={(e) => setForm({ ...form, unit_id: e.target.value })}>
            <option value="">-</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.symbol || u.code})</option>)}
          </Select>
          <Input label={t('category')} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <Input label={t('minStock')} type="number" step="0.0001" value={form.min_stock} onChange={(e) => setForm({ ...form, min_stock: parseFloat(e.target.value) || 0 })} />
          <Input label={t('defaultCost')} type="number" step="0.01" value={form.default_cost} onChange={(e) => setForm({ ...form, default_cost: parseFloat(e.target.value) || 0 })} />
          <div className="sm:col-span-2">
            <Input label={t('description')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm text-ui-muted">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              className="w-4 h-4 rounded border-ui-border text-brand-600 focus:ring-brand-500" />
            {t('active')}
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</Button>
          <Button onClick={save}>{t('save')}</Button>
        </div>
      </Modal>

      <Modal open={!!adjustTarget} onClose={() => setAdjustTarget(null)} title={t('adjustRawStock')} size="sm">
        {adjustTarget && (
          <div className="space-y-4">
            <div>
              <p className="text-sm text-ui-subtle">{t('rawMaterial')}</p>
              <p className="font-medium text-ui-text">{adjustTarget.raw_material?.name}</p>
            </div>
            <div>
              <p className="text-sm text-ui-subtle">{t('branch')}</p>
              <p className="font-medium text-ui-text">{branchLabel(adjustTarget.branch_id)}</p>
            </div>
            <Input label={t('quantity')} type="number" step="0.0001" value={adjustQty} onChange={(e) => setAdjustQty(parseFloat(e.target.value) || 0)} />
            <Input label={t('reason')} value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder={isAr ? 'مثال: جرد، تالف، تصحيح' : 'e.g. count, damaged, correction'} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setAdjustTarget(null)}>{t('cancel')}</Button>
              <Button onClick={saveAdjust}>{t('save')}</Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={remove} title={t('delete')} message={t('confirmDelete')} confirmLabel={t('delete')} cancelLabel={t('cancel')} />
    </DesignSurface>
  );
}
