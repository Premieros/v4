import { useEffect, useMemo, useState } from 'react';
import { Layers, AlertTriangle, Clock } from 'lucide-react';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { useCan } from '@/lib/permissions';
import { useAuth } from '@/context/AuthContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { DesignSurface, DesignPageHeader, DesignSearch, DesignPanel, DesignPagination } from '@/components/design';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { formatNumber, formatDate } from '@/lib/format';
import { daysUntilExpiry, expiryStatus } from '@/lib/inventoryExpiry';
import { logAudit } from '@/lib/audit';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import type { Product, Warehouse, Branch } from '@/lib/types';

interface BatchRow {
  id: string;
  product_id: string;
  warehouse_id: string;
  branch_id: string;
  batch_number: string | null;
  quantity: number;
  unit_cost: number;
  production_date: string | null;
  expiry_date: string | null;
  source_type: string;
  source_id: string | null;
  created_at: string;
  product?: Product | null;
  warehouse?: Warehouse | null;
  branch?: Branch | null;
}

export function InventoryBatchesPage() {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';
  const { show } = useToast();
  const can = useCan();
  const { user } = useAuth();
  const branchFilter = useBranchFilter();

  const { rows: batches, loading, error, total, hasMore, loadMore, loadingMore, refresh: reloadBatches } = usePaginatedRows<BatchRow>({
    table: 'inventory_batches',
    select: '*, product:products(*), warehouse:warehouses(*), branch:branches(*)',
    order: { column: 'expiry_date', ascending: true },
    pageSize: 100,
  });

  const [branches, setBranches] = useState<Branch[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [branchId, setBranchId] = useState(branchFilter || '');
  const [warehouseId, setWarehouseId] = useState('');
  const [filter, setFilter] = useState('all'); // all | expiring | expired

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({
    branch_id: '', warehouse_id: '', product_id: '', quantity: '1', unit_cost: '0',
    batch_number: '', production_date: '', expiry_date: '', source_type: 'opening', notes: '',
  });

  const sourceOptions: { key: string; label: string }[] = [
    { key: 'opening', label: t('sourceOpening') },
    { key: 'purchase', label: t('sourcePurchase') },
    { key: 'production', label: t('sourceProduction') },
    { key: 'batch', label: t('sourceBatch') },
  ];

  const visibleBranches = branchFilter ? branches.filter((b) => b.id === branchFilter) : branches;

  async function loadMeta() {
    const [br, wh, pr] = await Promise.all([
      supabase.from('branches').select('*').eq('is_active', true).order('name'),
      supabase.from('warehouses').select('*').eq('is_active', true).order('name'),
      supabase.from('products').select('*').eq('is_active', true).order('name'),
    ]);
    setBranches((br.data as Branch[]) || []);
    setWarehouses((wh.data as Warehouse[]) || []);
    setProducts((pr.data as Product[]) || []);
  }
  useEffect(() => { loadMeta(); }, []);

  const rowsWithStatus = useMemo(() => batches.map((b) => ({ ...b, days: daysUntilExpiry(b.expiry_date) })), [batches]);

  const filtered = rowsWithStatus.filter((b) => {
    if (branchId && b.branch_id !== branchId) return false;
    if (warehouseId && b.warehouse_id !== warehouseId) return false;
    if (filter === 'expiring' && (b.days === null || b.days > 90 || b.days < 0)) return false;
    if (filter === 'expired' && (b.days === null || b.days >= 0)) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (b.batch_number || '').toLowerCase().includes(q)
      || (b.product?.name || '').toLowerCase().includes(q)
      || (b.product?.barcode || '').toLowerCase().includes(q);
  });

  const expiredCount = rowsWithStatus.filter((b) => b.days !== null && b.days < 0).length;
  const expiringCount = rowsWithStatus.filter((b) => b.days !== null && b.days >= 0 && b.days <= 90).length;

  const openAdd = () => {
    setForm({
      branch_id: user?.branch_id || branchFilter || '',
      warehouse_id: '', product_id: '', quantity: '1', unit_cost: '0',
      batch_number: '', production_date: '', expiry_date: '', source_type: 'opening', notes: '',
    });
    setAddOpen(true);
  };

  const saveBatch = async () => {
    if (!form.branch_id || !form.warehouse_id || !form.product_id) { show(t('required'), 'error'); return; }
    const qty = parseFloat(form.quantity);
    if (!qty || qty <= 0) { show(t('required') + ': ' + t('batchQty'), 'error'); return; }
    const { data, error: err } = await api.inventory.addInventoryBatch({
      p_product_id: form.product_id,
      p_warehouse_id: form.warehouse_id,
      p_branch_id: form.branch_id,
      p_quantity: qty,
      p_unit_cost: parseFloat(form.unit_cost) || 0,
      p_batch_number: form.batch_number || null,
      p_production_date: form.production_date || null,
      p_expiry_date: form.expiry_date || null,
      p_source_type: form.source_type,
      p_notes: form.notes || null,
    });
    if (err) { show(err.message, 'error'); return; }
    const result = data as { success?: boolean; error?: string; detail?: string } | null;
    if (!result?.success) { show(result?.detail || result?.error || t('error'), 'error'); return; }
    show(t('batchSaved'), 'success');
    await logAudit('create', 'inventory_batches', undefined, { product_id: form.product_id, batch_number: form.batch_number, quantity: qty });
    setAddOpen(false);
    reloadBatches();
  };

  const statusPill = (days: number | null) => {
    const s = expiryStatus(days);
    if (!s) return <span className="text-xs text-ui-subtle">-</span>;
    const expired = s.state === 'expired';
    const label = expired ? t('batchStatusExpired') : t('batchStatusExpiring');
    const icon = expired ? <AlertTriangle className="w-3 h-3" /> : <Clock className="w-3 h-3" />;
    const cls = expired ? 'bg-ui-danger-soft text-ui-danger' : 'bg-ui-warning-soft text-ui-warning';
    return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{icon} {label}</span>;
  };

  const sourcePill = (source: string) => {
    const label = sourceOptions.find((s) => s.key === source)?.label || source;
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-ui-page-alt text-ui-muted">{label}</span>;
  };

  const columns: Column<(BatchRow & { days: number | null })>[] = [
    { key: 'product', header: t('product'), render: (b) => (
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-ui-page-alt flex items-center justify-center text-xs font-bold text-ui-subtle">
          {(b.product?.name || '?')[0]}
        </div>
        <div>
          <p className="font-medium text-ui-text">{b.product?.name || '-'}</p>
          <p className="text-xs text-ui-subtle">{b.product?.barcode || ''}</p>
        </div>
      </div>
    )},
    { key: 'batch_number', header: t('batchNumber'), render: (b) => b.batch_number || '-' },
    { key: 'warehouse', header: t('warehouse'), render: (b) => b.warehouse?.name || '-' },
    { key: 'quantity', header: t('quantity'), render: (b) => formatNumber(Number(b.quantity)) },
    { key: 'unit_cost', header: t('unitCost'), render: (b) => formatNumber(Number(b.unit_cost), 2) },
    { key: 'production_date', header: t('productionDate'), render: (b) => (b.production_date ? formatDate(b.production_date, lang) : '-') },
    { key: 'expiry_date', header: t('expiryDate'), render: (b) => (b.expiry_date ? formatDate(b.expiry_date, lang) : '-') },
    { key: 'status', header: t('status'), render: (b) => statusPill(b.days) },
    { key: 'source_type', header: t('batchSource'), render: (b) => sourcePill(b.source_type) },
  ];

  return (
    <DesignSurface testId="inventory-batches-page">
      <DesignPageHeader title={t('inventoryBatches')} subtitle={isAr ? 'إدارة الدفعات وتواريخ الصلاحية (FIFO)' : 'Manage lots/batches and expiry tracking (FIFO)'} actions={
        can('inventory.manage') && (
          <Button size="sm" onClick={openAdd}><Layers className="w-4 h-4" /> {t('newBatch')}</Button>
        )
      } />

      <DesignPanel testId="batches-expiry-summary">
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="rounded-ui-lg border border-ui-border bg-ui-page p-4">
            <p className="text-xs font-medium text-ui-subtle uppercase tracking-wide">{t('expiredBatches')}</p>
            <p className="mt-1 text-2xl font-bold text-ui-danger">{expiredCount}</p>
          </div>
          <div className="rounded-ui-lg border border-ui-border bg-ui-page p-4">
            <p className="text-xs font-medium text-ui-subtle uppercase tracking-wide">{t('expiringBatches')}</p>
            <p className="mt-1 text-2xl font-bold text-ui-warning">{expiringCount}</p>
          </div>
          <div className="rounded-ui-lg border border-ui-border bg-ui-page p-4">
            <p className="text-xs font-medium text-ui-subtle uppercase tracking-wide">{t('totalValue')}</p>
            <p className="mt-1 text-2xl font-bold text-ui-text">{formatNumber(rowsWithStatus.reduce((s, b) => s + Number(b.quantity) * Number(b.unit_cost), 0), 2)}</p>
          </div>
        </div>
      </DesignPanel>

      <DesignPanel testId="batches-search-panel">
        <div className="flex flex-col sm:flex-row gap-3">
          <DesignSearch value={search} onChange={setSearch} className="flex-1" label={t('search')} placeholder={t('search')} testId="batches-search" />
          <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="sm:w-40">
            <option value="all">{t('all')}</option>
            <option value="expiring">{t('expiringBatches')}</option>
            <option value="expired">{t('expiredBatches')}</option>
          </Select>
          <Select value={branchId} onChange={(e) => { setBranchId(e.target.value); setWarehouseId(''); }} className="sm:w-44">
            <option value="">{t('allBranches')}</option>
            {visibleBranches.map((br) => <option key={br.id} value={br.id}>{br.name}</option>)}
          </Select>
          <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="sm:w-44">
            <option value="">{t('all')} - {t('warehouses')}</option>
            {warehouses.filter((w) => !branchId || w.branch_id === branchId).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        </div>
      </DesignPanel>

      <DesignPanel testId="batches-table-panel">
        <DataTable columns={columns} data={filtered} loading={loading} error={error} emptyMessage={t('noData')} />
        <DesignPagination loaded={batches.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
      </DesignPanel>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title={t('newBatch')} size="lg">
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <Select label={t('branch')} value={form.branch_id} onChange={(e) => { setForm({ ...form, branch_id: e.target.value, warehouse_id: '' }); }}>
              <option value="">{t('branch')}</option>
              {visibleBranches.map((br) => <option key={br.id} value={br.id}>{br.name}</option>)}
            </Select>
            <Select label={t('warehouse')} value={form.warehouse_id} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}>
              <option value="">{t('warehouse')}</option>
              {warehouses.filter((w) => !form.branch_id || w.branch_id === form.branch_id).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </div>
          <Select label={t('product')} value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}>
            <option value="">{t('product')}</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <div className="grid sm:grid-cols-3 gap-3">
            <Input label={t('batchQty')} type="number" step="0.0001" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
            <Input label={t('unitCost')} type="number" step="0.01" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} />
            <Select label={t('batchSource')} value={form.source_type} onChange={(e) => setForm({ ...form, source_type: e.target.value })}>
              {sourceOptions.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </Select>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <Input label={t('batchNumber')} value={form.batch_number} onChange={(e) => setForm({ ...form, batch_number: e.target.value })} placeholder={isAr ? 'رقم الدفعة' : 'Batch number'} />
            <Input label={t('productionDate')} type="date" value={form.production_date} onChange={(e) => setForm({ ...form, production_date: e.target.value })} />
            <Input label={t('expiryDate')} type="date" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} />
          </div>
          <Input label={t('notes')} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={isAr ? 'ملاحظات' : 'Notes'} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAddOpen(false)}>{t('cancel')}</Button>
            <Button onClick={saveBatch}>{t('save')}</Button>
          </div>
        </div>
      </Modal>
    </DesignSurface>
  );
}
