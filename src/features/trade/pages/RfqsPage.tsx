import { useEffect, useState } from 'react';
import { Plus, Trash2, Eye, Send, X, BadgeCheck, Scale, Check } from 'lucide-react';
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
import { formatDate, formatCurrency } from '@/lib/format';
import { useCan } from '@/lib/permissions';
import { useBranches } from '@/hooks/useBranches';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import { useSettings } from '@/context/SettingsContext';
import type { Supplier, Product, RawMaterial, RpcResult, RfqRow, RfqComparisonRow, ProcurementLineInput, PurchaseRequestRow } from '@/lib/types';

interface RfqFormItem {
  line_type: 'product' | 'raw';
  product_id: string;
  raw_material_id: string;
  quantity: number;
  unit_name: string;
  notes: string;
}

const EMPTY_LINE: RfqFormItem = { line_type: 'product', product_id: '', raw_material_id: '', unit_name: 'piece', quantity: 1, notes: '' };

interface QuotationFormItem {
  line_type: 'product' | 'raw';
  product_id: string;
  raw_material_id: string;
  quantity: number;
  unit_cost: number;
}

const EMPTY_QUOTE_LINE: QuotationFormItem = { line_type: 'product', product_id: '', raw_material_id: '', quantity: 1, unit_cost: 0 };

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-ui-page-alt text-ui-muted',
  sent: 'bg-ui-info-soft text-ui-info',
  received: 'bg-ui-warning-soft text-ui-warning',
  awarded: 'bg-ui-success-soft text-ui-success',
  cancelled: 'bg-ui-page-alt text-ui-muted',
};

export function RfqsPage() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const branchFilter = useBranchFilter();
  const { show } = useToast();
  const can = useCan();
  const { branches } = useBranches();
  const { effectiveSettings } = useSettings();
  const currency = effectiveSettings(branchFilter)?.currency || 'EGP';
  const { rows: items, loading, error, refresh } = usePaginatedRows<RfqRow>({
    table: 'rfqs',
    select: '*',
    order: { column: 'created_at', ascending: false },
    branch_id: branchFilter,
    pageSize: 100,
  });
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [requests, setRequests] = useState<PurchaseRequestRow[]>([]);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [quoteModal, setQuoteModal] = useState<RfqRow | null>(null);
  const [compareModal, setCompareModal] = useState<RfqRow | null>(null);
  const [comparison, setComparison] = useState<RfqComparisonRow[]>([]);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    branch_id: '',
    request_id: '',
    due_date: '',
    notes: '',
  });
  const [lineItems, setLineItems] = useState<RfqFormItem[]>([{ ...EMPTY_LINE }]);

  const [quoteForm, setQuoteForm] = useState({
    supplier_id: '',
    valid_until: '',
    delivery_days: '',
    notes: '',
  });
  const [quoteItems, setQuoteItems] = useState<QuotationFormItem[]>([{ ...EMPTY_QUOTE_LINE }]);

  async function loadMeta() {
    const [s, pr, rm, rq] = await Promise.all([
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('products').select('*').eq('is_active', true).order('name'),
      supabase.from('raw_materials').select('*').eq('is_active', true).order('name'),
      supabase.from('purchase_requests').select('*').eq('status', 'approved').order('request_number', { ascending: false }),
    ]);
    setSuppliers((s.data as Supplier[]) || []);
    setProducts((pr.data as Product[]) || []);
    setRawMaterials((rm.data as RawMaterial[]) || []);
    setRequests((rq.data as PurchaseRequestRow[]) || []);
  }
  useEffect(() => { loadMeta(); }, []);

  const filtered = items.filter((r) => !search || r.rfq_number.toLowerCase().includes(search.toLowerCase()));

  const openAdd = () => {
    setForm({ branch_id: user?.branch_id || '', request_id: '', due_date: '', notes: '' });
    setLineItems([{ ...EMPTY_LINE }]);
    setModalOpen(true);
  };

  const addLine = () => setLineItems([...lineItems, { ...EMPTY_LINE }]);
  const updateLine = (i: number, field: keyof RfqFormItem, value: string | number) => setLineItems(lineItems.map((l, idx) => idx === i ? { ...l, [field]: value } : l));
  const removeLine = (i: number) => setLineItems(lineItems.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!form.branch_id) { show(t('required') + ': ' + t('branch'), 'error'); return; }
    const validItems = lineItems.filter((l) => (l.line_type === 'product' ? l.product_id : l.raw_material_id) && l.quantity > 0);
    if (!form.request_id && validItems.length === 0) { show(t('required') + ': ' + t('addItem'), 'error'); return; }

    setSaving(true);
    const { data, error: err } = await api.procurement.createRfq({
      p_branch_id: form.branch_id,
      p_request_id: form.request_id || null,
      p_due_date: form.due_date || null,
      p_notes: form.notes || null,
      p_items: validItems.map((i): ProcurementLineInput => ({
        ...(i.line_type === 'product' ? { product_id: i.product_id } : { raw_material_id: i.raw_material_id }),
        quantity: i.quantity,
        unit_name: i.unit_name,
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
    const { data, error: err } = await api.procurement.updateRfqStatus({ p_rfq_id: id, p_status: status });
    if (err) { show(err.message, 'error'); return; }
    const result = data as RpcResult | null;
    if (!result?.success) { show(result?.detail || result?.error || t('error'), 'error'); return; }
    show(t('saveSuccess'), 'success');
    refresh();
  };

  const openQuote = (r: RfqRow) => {
    setQuoteForm({ supplier_id: '', valid_until: '', delivery_days: '', notes: '' });
    setQuoteItems([{ ...EMPTY_QUOTE_LINE }]);
    setQuoteModal(r);
  };

  const addQuoteLine = () => setQuoteItems([...quoteItems, { ...EMPTY_QUOTE_LINE }]);
  const updateQuoteLine = (i: number, field: keyof QuotationFormItem, value: string | number) => setQuoteItems(quoteItems.map((l, idx) => idx === i ? { ...l, [field]: value } : l));
  const removeQuoteLine = (i: number) => setQuoteItems(quoteItems.filter((_, idx) => idx !== i));

  const saveQuotation = async () => {
    if (!quoteModal) return;
    if (!quoteForm.supplier_id) { show(t('required') + ': ' + t('supplier'), 'error'); return; }
    const validItems = quoteItems.filter((l) => (l.line_type === 'product' ? l.product_id : l.raw_material_id) && l.quantity > 0);
    if (validItems.length === 0) { show(t('required') + ': ' + t('addItem'), 'error'); return; }

    setSaving(true);
    const { data, error: err } = await api.procurement.recordSupplierQuotation({
      p_rfq_id: quoteModal.id,
      p_supplier_id: quoteForm.supplier_id,
      p_valid_until: quoteForm.valid_until || null,
      p_delivery_days: quoteForm.delivery_days ? parseInt(quoteForm.delivery_days, 10) : null,
      p_notes: quoteForm.notes || null,
      p_items: validItems.map((i): ProcurementLineInput => ({
        ...(i.line_type === 'product' ? { product_id: i.product_id } : { raw_material_id: i.raw_material_id }),
        quantity: i.quantity,
        unit_cost: i.unit_cost,
      })),
    });
    setSaving(false);
    if (err) { show(err.message, 'error'); return; }
    const result = data as RpcResult | null;
    if (!result?.success) { show(result?.detail || result?.error || t('error'), 'error'); return; }
    show(t('saveSuccess'), 'success');
    setQuoteModal(null);
    refresh();
  };

  const selectQuotation = async (quotationId: string) => {
    const { data, error: err } = await api.procurement.selectSupplierQuotation({ p_quotation_id: quotationId });
    if (err) { show(err.message, 'error'); return; }
    const result = data as RpcResult | null;
    if (!result?.success) { show(result?.detail || result?.error || t('error'), 'error'); return; }
    show(t('saveSuccess'), 'success');
    refresh();
    if (compareModal) loadComparison(compareModal.id);
  };

  const loadComparison = async (rfqId: string) => {
    const { data, error: err } = await api.procurement.getRfqComparison({ p_rfq_id: rfqId });
    if (err) { show(err.message, 'error'); return; }
    setComparison((data as RfqComparisonRow[]) || []);
  };

  const openComparison = async (r: RfqRow) => {
    setCompareModal(r);
    await loadComparison(r.id);
  };

  const columns: Column<RfqRow>[] = [
    { key: 'rfq_number', header: t('rfqNumber'), render: (r) => <span className="font-medium text-ui-text">{r.rfq_number}</span> },
    { key: 'due_date', header: t('dueDate'), render: (r) => (r.due_date ? formatDate(r.due_date, lang) : '-') },
    { key: 'created_at', header: t('date'), render: (r) => formatDate(r.created_at, lang) },
    { key: 'status', header: t('status'), render: (r) => <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[r.status] || ''}`}>{t(r.status as keyof typeof import('@/lib/i18n').translations.ar)}</span> },
    { key: 'actions', header: t('actions'), render: (r) => (
      <div className="flex items-center gap-1 justify-end">
        {r.status === 'draft' && can('purchases.manage') && (
          <button title={t('submitRequest')} onClick={() => changeStatus(r.id, 'sent')} className="p-1.5 rounded-md hover:bg-ui-info-soft text-ui-info"><Send className="w-4 h-4" /></button>
        )}
        {['draft', 'sent', 'received'].includes(r.status) && can('purchases.manage') && (
          <button title={t('recordQuotation')} onClick={() => openQuote(r)} className="p-1.5 rounded-md hover:bg-ui-warning-soft text-ui-warning"><Plus className="w-4 h-4" /></button>
        )}
        {['sent', 'received'].includes(r.status) && can('purchases.manage') && (
          <button title={t('comparison')} onClick={() => openComparison(r)} className="p-1.5 rounded-md hover:bg-purple-50 dark:hover:bg-purple-900/20 text-purple-500"><Scale className="w-4 h-4" /></button>
        )}
        {r.status === 'received' && can('purchases.manage') && (
          <button title={t('createPurchaseOrder')} onClick={() => openComparison(r)} className="p-1.5 rounded-md hover:bg-ui-success-soft text-ui-success"><BadgeCheck className="w-4 h-4" /></button>
        )}
        {!['awarded', 'cancelled'].includes(r.status) && can('purchases.manage') && (
          <button title={t('cancel')} onClick={() => changeStatus(r.id, 'cancelled')} className="p-1.5 rounded-md hover:bg-ui-page-alt dark:hover:bg-ui-page-alt text-ui-subtle"><X className="w-4 h-4" /></button>
        )}
        {r.status === 'received' && can('purchases.manage') && (
          <button onClick={() => openComparison(r)} className="p-1.5 rounded-md hover:bg-ui-info-soft text-ui-info"><Eye className="w-4 h-4" /></button>
        )}
      </div>
    )},
  ];

  return (
    <DesignSurface testId="rfqs-page">
      <DesignPageHeader title={t('rfqs')} actions={
        can('purchases.manage') && <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4" /> {t('createRfq')}</Button>
      } />
      <DesignPanel testId="rfqs-search-panel">
        <DesignSearch value={search} onChange={setSearch} label={t('search')} placeholder={t('search')} testId="rfqs-search" />
      </DesignPanel>
      <DesignPanel testId="rfqs-table-panel">
        <DataTable columns={columns} data={filtered} loading={loading} error={error} emptyMessage={t('noData')} />
      </DesignPanel>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={t('createRfq')} size="xl">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Select label={t('branch')} value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })} required>
              <option value="">--</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
            <Select label={t('createRfqFromRequest')} value={form.request_id} onChange={(e) => setForm({ ...form, request_id: e.target.value })}>
              <option value="">--</option>
              {requests.map((r) => <option key={r.id} value={r.id}>{r.request_number}</option>)}
            </Select>
            <div>
              <label className="block text-xs font-medium text-ui-muted mb-1">{t('dueDate')}</label>
              <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className="w-full rounded-md border border-ui-border bg-ui-surface px-2 py-1.5 text-sm" />
            </div>
            <input type="text" placeholder={t('notes')} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full rounded-md border border-ui-border bg-ui-surface px-2 py-1.5 text-sm" />
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
                  <div className="col-span-4">
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
                  <input type="text" placeholder={t('notes')} value={l.notes} onChange={(e) => updateLine(i, 'notes', e.target.value)} className="col-span-3 rounded-md border border-ui-border bg-ui-surface px-2 py-1.5 text-sm" />
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

      <Modal open={!!quoteModal} onClose={() => setQuoteModal(null)} title={t('recordQuotation')} size="xl">
        {quoteModal && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Select label={t('supplier')} value={quoteForm.supplier_id} onChange={(e) => setQuoteForm({ ...quoteForm, supplier_id: e.target.value })} required>
                <option value="">--</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
              <div>
                <label className="block text-xs font-medium text-ui-muted mb-1">{t('validUntil')}</label>
                <input type="date" value={quoteForm.valid_until} onChange={(e) => setQuoteForm({ ...quoteForm, valid_until: e.target.value })} className="w-full rounded-md border border-ui-border bg-ui-surface px-2 py-1.5 text-sm" />
              </div>
              <input type="number" placeholder={t('deliveryDays')} value={quoteForm.delivery_days} onChange={(e) => setQuoteForm({ ...quoteForm, delivery_days: e.target.value })} className="rounded-md border border-ui-border bg-ui-surface px-2 py-1.5 text-sm" />
              <input type="text" placeholder={t('notes')} value={quoteForm.notes} onChange={(e) => setQuoteForm({ ...quoteForm, notes: e.target.value })} className="rounded-md border border-ui-border bg-ui-surface px-2 py-1.5 text-sm" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-ui-muted">{t('addItem')}</h3>
                <Button size="sm" variant="outline" onClick={addQuoteLine}><Plus className="w-4 h-4" /> {t('add')}</Button>
              </div>
              <div className="space-y-2">
                {quoteItems.map((l, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center">
                    <select value={l.line_type} onChange={(e) => updateQuoteLine(i, 'line_type', e.target.value)} className="col-span-2 rounded-md border border-ui-border bg-ui-surface px-2 py-1.5 text-sm">
                      <option value="product">{t('product')}</option>
                      <option value="raw">{t('rawMaterial')}</option>
                    </select>
                    <div className="col-span-4">
                      {l.line_type === 'product' ? (
                        <select value={l.product_id} onChange={(e) => updateQuoteLine(i, 'product_id', e.target.value)} className="w-full rounded-md border border-ui-border bg-ui-surface px-2 py-1.5 text-sm">
                          <option value="">--</option>
                          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      ) : (
                        <select value={l.raw_material_id} onChange={(e) => updateQuoteLine(i, 'raw_material_id', e.target.value)} className="w-full rounded-md border border-ui-border bg-ui-surface px-2 py-1.5 text-sm">
                          <option value="">--</option>
                          {rawMaterials.map((rm) => <option key={rm.id} value={rm.id}>{rm.name}</option>)}
                        </select>
                      )}
                    </div>
                    <input type="number" placeholder={t('quantity')} value={l.quantity || ''} onChange={(e) => updateQuoteLine(i, 'quantity', parseFloat(e.target.value) || 0)} className="col-span-2 rounded-md border border-ui-border bg-ui-surface px-2 py-1.5 text-sm" />
                    <input type="number" placeholder={t('unitCost')} step="0.01" value={l.unit_cost || ''} onChange={(e) => updateQuoteLine(i, 'unit_cost', parseFloat(e.target.value) || 0)} className="col-span-3 rounded-md border border-ui-border bg-ui-surface px-2 py-1.5 text-sm" />
                    <button onClick={() => removeQuoteLine(i)} className="col-span-1 p-1.5 text-ui-danger hover:bg-ui-danger-soft rounded-md"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-ui-border">
              <Button variant="secondary" onClick={() => setQuoteModal(null)}>{t('cancel')}</Button>
              <Button onClick={saveQuotation} disabled={saving}>{saving ? t('loading') : t('save')}</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!compareModal} onClose={() => setCompareModal(null)} title={`${t('comparison')} - ${compareModal?.rfq_number || ''}`} size="xl">
        {compareModal && (
          <div className="space-y-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-ui-border">
                <th className="text-start py-2 font-semibold text-ui-muted">{t('item')}</th>
                <th className="text-center py-2 font-semibold text-ui-muted">{t('quantity')}</th>
                <th className="text-center py-2 font-semibold text-ui-muted">{t('bestPrice')}</th>
                <th className="text-center py-2 font-semibold text-ui-muted">{t('averagePrice')}</th>
                <th className="text-center py-2 font-semibold text-ui-muted">{t('quotationCount')}</th>
                <th className="text-end py-2 font-semibold text-ui-muted">{t('actions')}</th>
              </tr></thead>
              <tbody>
                {comparison.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-ui-subtle">{t('noItemsYet')}</td></tr>}
                {comparison.map((row, idx) => (
                  <tr key={idx} className="border-b border-ui-border">
                    <td className="py-2 text-ui-text">{row.item_name}</td>
                    <td className="py-2 text-center text-ui-text">{row.requested_quantity}</td>
                    <td className="py-2 text-center font-semibold text-ui-success">{row.best_supplier_name ? `${row.best_supplier_name} (${formatCurrency(row.best_unit_cost ?? 0, currency, lang)})` : '-'}</td>
                    <td className="py-2 text-center text-ui-text">{row.avg_unit_cost != null ? formatCurrency(row.avg_unit_cost, currency, lang) : '-'}</td>
                    <td className="py-2 text-center text-ui-text">{row.quotation_count}</td>
                    <td className="py-2 text-end">
                      {row.quotations.map((q) => (
                        <div key={q.quotation_id} className="flex items-center justify-end gap-2 mb-1">
                          <span className="text-xs text-ui-subtle">{q.supplier_name} · {formatCurrency(q.unit_cost, currency, lang)}</span>
                          {can('purchases.manage') && compareModal.status === 'received' && q.status === 'received' && (
                            <button onClick={() => selectQuotation(q.quotation_id)} className="p-1 rounded-md hover:bg-ui-success-soft text-ui-success" title={t('selectQuotation')}>
                              <Check className="w-4 h-4" />
                            </button>
                          )}
                          {q.status === 'selected' && <BadgeCheck className="w-4 h-4 text-ui-success" />}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setCompareModal(null)}>{t('close')}</Button>
            </div>
          </div>
        )}
      </Modal>
    </DesignSurface>
  );
}
