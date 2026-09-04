import { useEffect, useState } from 'react';
import { Plus, Trash2, Eye, Send, Check, X, FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useToast } from '@/components/Toast';
import { DesignSurface, DesignPageHeader, DesignSearch, DesignPanel } from '@/components/design';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { formatDate } from '@/lib/format';
import { useCan } from '@/lib/permissions';
import { useBranches } from '@/hooks/useBranches';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import type { Supplier, Product, RawMaterial, RpcResult, PurchaseRequestRow, ProcurementLineInput } from '@/lib/types';

interface RequestFormItem {
  line_type: 'product' | 'raw';
  product_id: string;
  raw_material_id: string;
  quantity: number;
  unit_name: string;
  estimated_cost: number;
  notes: string;
}

const EMPTY_LINE: RequestFormItem = { line_type: 'product', product_id: '', raw_material_id: '', unit_name: 'piece', quantity: 1, estimated_cost: 0, notes: '' };

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-ui-page-alt text-ui-muted',
  submitted: 'bg-ui-info-soft text-ui-info',
  approved: 'bg-ui-success-soft text-ui-success',
  rejected: 'bg-ui-danger-soft text-ui-danger',
  ordered: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  cancelled: 'bg-ui-page-alt text-ui-muted',
};

export function PurchaseRequestsPage() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const branchFilter = useBranchFilter();
  const { show } = useToast();
  const can = useCan();
  const navigate = useNavigate();
  const { branches } = useBranches();
  const { rows: items, loading, error, refresh } = usePaginatedRows<PurchaseRequestRow & { supplier?: Supplier }>({
    table: 'purchase_requests',
    select: '*, supplier:suppliers(name)',
    order: { column: 'created_at', ascending: false },
    branch_id: branchFilter,
    pageSize: 100,
  });
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [viewModal, setViewModal] = useState<PurchaseRequestRow | null>(null);
  const [viewItems, setViewItems] = useState<{ name: string; quantity: number; estimated_cost: number | null }[]>([]);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    branch_id: '',
    supplier_id: '',
    priority: 'normal',
    expected_date: '',
    notes: '',
  });
  const [lineItems, setLineItems] = useState<RequestFormItem[]>([{ ...EMPTY_LINE }]);

  async function loadMeta() {
    const [s, pr, rm] = await Promise.all([
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('products').select('*').eq('is_active', true).order('name'),
      supabase.from('raw_materials').select('*').eq('is_active', true).order('name'),
    ]);
    setSuppliers((s.data as Supplier[]) || []);
    setProducts((pr.data as Product[]) || []);
    setRawMaterials((rm.data as RawMaterial[]) || []);
  }
  useEffect(() => { loadMeta(); }, []);

  const filtered = items.filter((r) => !search || r.request_number.toLowerCase().includes(search.toLowerCase()) || (r.supplier?.name || '').toLowerCase().includes(search.toLowerCase()));

  const openAdd = () => {
    setForm({ branch_id: user?.branch_id || '', supplier_id: '', priority: 'normal', expected_date: '', notes: '' });
    setLineItems([{ ...EMPTY_LINE }]);
    setModalOpen(true);
  };

  const addLine = () => setLineItems([...lineItems, { ...EMPTY_LINE }]);
  const updateLine = (i: number, field: keyof RequestFormItem, value: string | number) => setLineItems(lineItems.map((l, idx) => idx === i ? { ...l, [field]: value } : l));
  const removeLine = (i: number) => setLineItems(lineItems.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!form.branch_id) { show(t('required') + ': ' + t('branch'), 'error'); return; }
    const validItems = lineItems.filter((l) => (l.line_type === 'product' ? l.product_id : l.raw_material_id) && l.quantity > 0);
    if (validItems.length === 0) { show(t('required') + ': ' + t('addItem'), 'error'); return; }

    setSaving(true);
    const { data, error: err } = await api.procurement.createPurchaseRequest({
      p_branch_id: form.branch_id,
      p_supplier_id: form.supplier_id || null,
      p_priority: form.priority,
      p_expected_date: form.expected_date || null,
      p_notes: form.notes || null,
      p_items: validItems.map((i): ProcurementLineInput => ({
        ...(i.line_type === 'product' ? { product_id: i.product_id } : { raw_material_id: i.raw_material_id }),
        quantity: i.quantity,
        unit_name: i.unit_name,
        estimated_cost: i.estimated_cost || undefined,
        notes: i.notes || null,
      })),
    });
    setSaving(false);
    if (err) { show(err.message, 'error'); return; }
    const result = data as RpcResult | null;
    if (!result?.success) { show(result?.detail || result?.error || t('error'), 'error'); return; }
    show(t('saveSuccess'), 'success');
    setModalOpen(false);
    refresh();
  };

  const changeStatus = async (id: string, status: string) => {
    const { data, error: err } = await api.procurement.updatePurchaseRequestStatus({ p_request_id: id, p_status: status });
    if (err) { show(err.message, 'error'); return; }
    const result = data as RpcResult | null;
    if (!result?.success) { show(result?.detail || result?.error || t('error'), 'error'); return; }
    show(t('saveSuccess'), 'success');
    refresh();
  };

  const createRfqFromRequest = async (r: PurchaseRequestRow) => {
    const { data, error: err } = await api.procurement.createRfq({ p_branch_id: r.branch_id, p_request_id: r.id });
    if (err) { show(err.message, 'error'); return; }
    const result = data as (RpcResult & { rfq_id?: string }) | null;
    if (!result?.success) { show(result?.detail || result?.error || t('error'), 'error'); return; }
    show(t('saveSuccess'), 'success');
    navigate('/purchases/rfqs');
  };

  const viewRequest = async (r: PurchaseRequestRow) => {
    setViewModal(r);
    const { data } = await supabase.from('purchase_request_items').select('*, product:products(name), raw_material:raw_materials(name)').eq('request_id', r.id);
    setViewItems((data || []).map((i: Record<string, unknown>) => ({
      name: (i.product as { name: string })?.name || (i.raw_material as { name: string })?.name || '-',
      quantity: Number(i.quantity),
      estimated_cost: i.estimated_cost != null ? Number(i.estimated_cost) : null,
    })));
  };

  const columns: Column<PurchaseRequestRow & { supplier?: Supplier }>[] = [
    { key: 'request_number', header: t('requestNumber'), render: (r) => <span className="font-medium text-ui-text">{r.request_number}</span> },
    { key: 'supplier', header: t('supplier'), render: (r) => r.supplier?.name || '-' },
    { key: 'priority', header: t('priority'), render: (r) => <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-ui-warning-soft text-ui-warning capitalize">{t(`priority${r.priority.charAt(0).toUpperCase() + r.priority.slice(1)}` as keyof typeof import('@/lib/i18n').translations.ar)}</span> },
    { key: 'expected_date', header: t('expectedDate'), render: (r) => (r.expected_date ? formatDate(r.expected_date, lang) : '-') },
    { key: 'created_at', header: t('date'), render: (r) => formatDate(r.created_at, lang) },
    { key: 'status', header: t('status'), render: (r) => <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[r.status] || ''}`}>{t(r.status as keyof typeof import('@/lib/i18n').translations.ar)}</span> },
    { key: 'actions', header: t('actions'), render: (r) => (
      <div className="flex items-center gap-1 justify-end">
        {r.status === 'draft' && can('purchases.manage') && (
          <button title={t('submitRequest')} onClick={() => changeStatus(r.id, 'submitted')} className="p-1.5 rounded-md hover:bg-ui-info-soft text-ui-info"><Send className="w-4 h-4" /></button>
        )}
        {r.status === 'submitted' && can('purchases.manage') && (
          <>
            <button title={t('approveRequest')} onClick={() => changeStatus(r.id, 'approved')} className="p-1.5 rounded-md hover:bg-ui-success-soft text-ui-success"><Check className="w-4 h-4" /></button>
            <button title={t('rejectRequest')} onClick={() => changeStatus(r.id, 'rejected')} className="p-1.5 rounded-md hover:bg-ui-danger-soft text-ui-danger"><X className="w-4 h-4" /></button>
          </>
        )}
        {r.status === 'approved' && can('purchases.rfq') && (
          <button title={t('createRfqFromRequest')} onClick={() => createRfqFromRequest(r)} className="p-1.5 rounded-md hover:bg-purple-50 dark:hover:bg-purple-900/20 text-purple-500"><FileText className="w-4 h-4" /></button>
        )}
        {(r.status === 'draft' || r.status === 'submitted') && can('purchases.manage') && (
          <button title={t('cancel')} onClick={() => changeStatus(r.id, 'cancelled')} className="p-1.5 rounded-md hover:bg-ui-page-alt dark:hover:bg-ui-page-alt text-ui-subtle"><X className="w-4 h-4" /></button>
        )}
        <button onClick={() => viewRequest(r)} className="p-1.5 rounded-md hover:bg-ui-info-soft text-ui-info"><Eye className="w-4 h-4" /></button>
      </div>
    )},
  ];

  return (
    <DesignSurface testId="purchase-requests-page">
      <DesignPageHeader title={t('purchaseRequests')} actions={
        can('purchases.manage') && <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4" /> {t('createRequest')}</Button>
      } />
      <DesignPanel testId="purchase-requests-search-panel">
        <DesignSearch value={search} onChange={setSearch} label={t('search')} placeholder={t('search')} testId="purchase-requests-search" />
      </DesignPanel>
      <DesignPanel testId="purchase-requests-table-panel">
        <DataTable columns={columns} data={filtered} loading={loading} error={error} emptyMessage={t('noData')} onRowClick={viewRequest} />
      </DesignPanel>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={t('createRequest')} size="xl">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Select label={t('branch')} value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })} required>
              <option value="">--</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
            <Select label={t('supplier')} value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
              <option value="">--</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
            <Select label={t('priority')} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              <option value="low">{t('priorityLow')}</option>
              <option value="normal">{t('priorityNormal')}</option>
              <option value="high">{t('priorityHigh')}</option>
              <option value="urgent">{t('priorityUrgent')}</option>
            </Select>
            <div>
              <label className="block text-xs font-medium text-ui-muted mb-1">{t('expectedDate')}</label>
              <input type="date" value={form.expected_date} onChange={(e) => setForm({ ...form, expected_date: e.target.value })} className="w-full rounded-md border border-ui-border bg-ui-surface px-2 py-1.5 text-sm" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-ui-muted">{t('addItem')}</h3>
              <Button size="sm" variant="outline" onClick={addLine}><Plus className="w-4 h-4" /> {t('add')}</Button>
            </div>
            <div className="space-y-2">
              {lineItems.map((l, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <select value={l.line_type} onChange={(e) => updateLine(i, 'line_type', e.target.value)} className="col-span-2 rounded-md border border-ui-border bg-ui-surface px-2 py-1.5 text-sm">
                    <option value="product">{t('product')}</option>
                    <option value="raw">{t('rawMaterial')}</option>
                  </select>
                  <div className="col-span-3">
                    {l.line_type === 'product' ? (
                      <select value={l.product_id} onChange={(e) => updateLine(i, 'product_id', e.target.value)} className="w-full rounded-md border border-ui-border bg-ui-surface px-2 py-1.5 text-sm">
                        <option value="">--</option>
                        {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    ) : (
                      <select value={l.raw_material_id} onChange={(e) => updateLine(i, 'raw_material_id', e.target.value)} className="w-full rounded-md border border-ui-border bg-ui-surface px-2 py-1.5 text-sm">
                        <option value="">--</option>
                        {rawMaterials.map((rm) => <option key={rm.id} value={rm.id}>{rm.name}</option>)}
                      </select>
                    )}
                  </div>
                  <input type="number" placeholder={t('quantity')} value={l.quantity || ''} onChange={(e) => updateLine(i, 'quantity', parseFloat(e.target.value) || 0)} className="col-span-2 rounded-md border border-ui-border bg-ui-surface px-2 py-1.5 text-sm" />
                  <input type="number" placeholder={t('estimatedCost')} step="0.01" value={l.estimated_cost || ''} onChange={(e) => updateLine(i, 'estimated_cost', parseFloat(e.target.value) || 0)} className="col-span-2 rounded-md border border-ui-border bg-ui-surface px-2 py-1.5 text-sm" />
                  <input type="text" placeholder={t('notes')} value={l.notes} onChange={(e) => updateLine(i, 'notes', e.target.value)} className="col-span-2 rounded-md border border-ui-border bg-ui-surface px-2 py-1.5 text-sm" />
                  <button onClick={() => removeLine(i)} className="col-span-1 p-1.5 text-ui-danger hover:bg-ui-danger-soft rounded-md"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-ui-border">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</Button>
            <Button onClick={save} disabled={saving}>{saving ? t('loading') : t('save')}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!viewModal} onClose={() => setViewModal(null)} title={t('requestNumber')} size="lg">
        {viewModal && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-ui-subtle">{t('requestNumber')}: </span><span className="font-medium">{viewModal.request_number}</span></div>
              <div><span className="text-ui-subtle">{t('status')}: </span><span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[viewModal.status] || ''}`}>{t(viewModal.status as keyof typeof import('@/lib/i18n').translations.ar)}</span></div>
              <div><span className="text-ui-subtle">{t('supplier')}: </span><span className="font-medium">{(viewModal as PurchaseRequestRow & { supplier?: Supplier }).supplier?.name || '-'}</span></div>
              <div><span className="text-ui-subtle">{t('date')}: </span><span className="font-medium">{formatDate(viewModal.created_at, lang)}</span></div>
            </div>
            <div className="border-t border-ui-border pt-3">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-ui-border">
                  <th className="text-start py-2 font-semibold text-ui-muted">{t('productName')}</th>
                  <th className="text-center py-2 font-semibold text-ui-muted">{t('quantity')}</th>
                  <th className="text-end py-2 font-semibold text-ui-muted">{t('estimatedCost')}</th>
                </tr></thead>
                <tbody>
                  {viewItems.map((i, idx) => (
                    <tr key={idx} className="border-b border-ui-border">
                      <td className="py-2 text-ui-text">{i.name}</td>
                      <td className="py-2 text-center text-ui-text">{i.quantity}</td>
                      <td className="py-2 text-end text-ui-text">{i.estimated_cost ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>
    </DesignSurface>
  );
}
