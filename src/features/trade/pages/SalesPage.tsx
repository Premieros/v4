import { useEffect, useState } from 'react';
import { Trash2, FileText, Edit2, RotateCcw } from 'lucide-react';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { DesignSurface, DesignPageHeader, DesignSearch, DesignPanel, DesignPagination } from '@/components/design';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Select, Textarea } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { logAudit } from '@/lib/audit';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import { useSettings } from '@/context/SettingsContext';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import type { Customer } from '@/lib/types';

interface SaleRow {
  id: string;
  invoice_number: string;
  total: number;
  paid_amount: number;
  refunded_amount: number;
  payment_method: string;
  status: string;
  notes: string | null;
  created_at: string;
  customer_id: string | null;
  customer?: { name: string } | null;
  sale_items?: { id: string; product_id: string | null; unit_name: string; quantity: number; unit_price: number; discount_amount: number; refunded_quantity: number; refunded_amount: number; total: number; product?: { name: string } | null }[];
}

export function SalesPage() {
  const { t, lang } = useLanguage();
  const { show } = useToast();
  const branchFilter = useBranchFilter();
  const can = useCan();
  const { rows: items, loading, error, total, hasMore, loadMore, loadingMore, refresh: reloadSales } = usePaginatedRows<SaleRow>({
    table: 'sales',
    select: 'id, invoice_number, total, paid_amount, refunded_amount, payment_method, status, notes, created_at, customer_id, customer:customers(name), sale_items(id, product_id, unit_name, quantity, unit_price, discount_amount, refunded_quantity, refunded_amount, total, product:products(name))',
    order: { column: 'created_at', ascending: false },
    branch_id: branchFilter,
    pageSize: 100,
  });
  const [search, setSearch] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteSelectedConfirm, setDeleteSelectedConfirm] = useState(false);
  const { effectiveSettings } = useSettings();
  const currency = effectiveSettings(branchFilter)?.currency || 'EGP';
  const [viewSale, setViewSale] = useState<SaleRow | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [editForm, setEditForm] = useState({ customer_id: '', payment_method: '', status: '', notes: '' });
  const [refundSale, setRefundSale] = useState<SaleRow | null>(null);
  const [refundQty, setRefundQty] = useState<Record<string, string>>({});
  const [refundReason, setRefundReason] = useState('');
  const [refunding, setRefunding] = useState(false);
  const isAr = lang === 'ar';

  async function loadMeta() {
    const { data: customersRes } = await supabase.from('customers').select('*').order('name');
    setCustomers((customersRes as Customer[]) || []);
  }
  useEffect(() => { loadMeta(); }, []);

  const filtered = items.filter((i) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      i.invoice_number?.toLowerCase().includes(s) ||
      i.customer?.name?.toLowerCase().includes(s) ||
      i.status?.toLowerCase().includes(s)
    );
  });

  const openViewSale = (sale: SaleRow) => {
    setViewSale(sale);
    setEditForm({
      customer_id: sale.customer_id || '',
      payment_method: sale.payment_method,
      status: sale.status,
      notes: sale.notes || '',
    });
  };

  const openRefund = (sale: SaleRow) => {
    setRefundSale(sale);
    setRefundReason('');
    const qty: Record<string, string> = {};
    for (const item of sale.sale_items || []) {
      qty[item.id] = String(item.quantity - (item.refunded_quantity || 0));
    }
    setRefundQty(qty);
  };

  const refundLineTotal = (item: NonNullable<SaleRow['sale_items']>[number]): number => {
    const q = Math.max(0, Math.min(parseFloat(refundQty[item.id] || '0') || 0, item.quantity - (item.refunded_quantity || 0)));
    return Math.round((item.total || 0) * q / (item.quantity || 1) * 100) / 100;
  };

  const refundTotal = () => {
    let sum = 0;
    for (const item of refundSale?.sale_items || []) sum += refundLineTotal(item);
    return Math.round(sum * 100) / 100;
  };

  const submitRefund = async () => {
    if (!refundSale) return;
    const p_items: { sale_item_id: string; quantity: number }[] = [];
    for (const item of refundSale.sale_items || []) {
      const q = Math.max(0, Math.min(parseFloat(refundQty[item.id] || '0') || 0, item.quantity - (item.refunded_quantity || 0)));
      if (q > 0) p_items.push({ sale_item_id: item.id, quantity: q });
    }
    if (p_items.length === 0) { show(isAr ? 'اختر كمية للمرتجع' : 'Choose a quantity to refund', 'error'); return; }
    setRefunding(true);
    const { data, error } = await api.trade.processRefund({
      p_sale_id: refundSale.id,
      p_items,
      p_reason: refundReason.trim() || null,
    });
    setRefunding(false);
    if (error) { show(error.message, 'error'); return; }
    const result = data as { success: boolean; error?: string; detail?: string; refunded_amount?: number } | null;
    if (!result?.success) {
      show(`${isAr ? 'فشل المرتجع' : 'Refund failed'}: ${result?.detail || result?.error || 'unknown'}`, 'error');
      return;
    }
    await logAudit('update', 'sales', refundSale.id, { refunded_amount: result.refunded_amount, reason: refundReason });
    show(`${isAr ? 'تمت المعاملة' : 'Refunded'} ${formatCurrency(result.refunded_amount || 0, currency, lang)}`, 'success');
    setRefundSale(null);
    reloadSales();
  };

  const saveSaleEdit = async () => {
    if (!viewSale) return;
    const { error } = await supabase.from('sales').update({
      customer_id: editForm.customer_id || null,
      payment_method: editForm.payment_method,
      status: editForm.status,
      notes: editForm.notes || null,
    }).eq('id', viewSale.id);
    if (error) { show(error.message, 'error'); return; }
    await logAudit('update', 'sales', viewSale.id);
    show(t('saveSuccess'), 'success');
    setViewSale(null);
    reloadSales();
  };

  const remove = async () => {
    if (!deleteId) return;
    const sale = items.find((i) => i.id === deleteId);
    if (sale?.status === 'completed') {
      show(t('cannotDeleteCompleted'), 'error');
      setDeleteId(null);
      return;
    }
    try {
      await supabase.from('sale_items').delete().eq('sale_id', deleteId);
      const { error } = await supabase.from('sales').delete().eq('id', deleteId);
      if (error) { show(error.message, 'error'); return; }
      await logAudit('delete', 'sales', deleteId);
      show(t('deleteSuccess'), 'success');
    } catch (err: unknown) {
      show(err instanceof Error ? err.message : 'Error', 'error');
    }
    setDeleteId(null);
    reloadSales();
  };

  const removeSelected = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const deletable = items.filter((i) => ids.includes(i.id) && i.status !== 'completed').map((i) => i.id);
    const blocked = ids.length - deletable.length;
    for (const id of deletable) {
      await supabase.from('sale_items').delete().eq('sale_id', id);
      await supabase.from('sales').delete().eq('id', id);
      await logAudit('delete', 'sales', id);
    }
    if (blocked > 0) show(t('cannotDeleteCompleted'), 'error');
    else show(t('deleteSuccess'), 'success');
    setSelectedIds(new Set());
    setDeleteSelectedConfirm(false);
    reloadSales();
  };

  const PAYMENT_LABELS: Record<string, string> = { cash: t('cash'), card: t('card'), transfer: t('transfer'), credit: t('credit') };

  const columns: Column<SaleRow>[] = [
    { key: 'invoice_number', header: t('invoiceNumber'), render: (r) => (
      <div className="flex items-center gap-2">
        <FileText className="w-4 h-4 text-brand-500" />
        <span className="font-medium text-ui-text">{r.invoice_number}</span>
      </div>
    )},
    { key: 'created_at', header: t('date'), render: (r) => <span className="text-sm text-ui-subtle">{formatDateTime(r.created_at, lang)}</span> },
    { key: 'customer', header: t('customer'), render: (r) => r.customer?.name || '-' },
    { key: 'total', header: t('total'), render: (r) => <span className="font-semibold text-ui-text">{formatCurrency(r.total, currency, lang)}</span> },
    { key: 'paid_amount', header: isAr ? 'المدفوع' : 'Paid', render: (r) => formatCurrency(r.paid_amount, currency, lang) },
    { key: 'payment_method', header: isAr ? 'طريقة الدفع' : 'Payment', render: (r) => (
      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-ui-page-alt text-ui-muted">
        {PAYMENT_LABELS[r.payment_method] || r.payment_method}
      </span>
    )},
    { key: 'status', header: t('status'), render: (r) => (
      <div className="flex items-center gap-1.5">
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
          r.status === 'completed' ? 'bg-ui-success-soft text-ui-success' :
          r.status === 'returned' ? 'bg-ui-danger-soft text-ui-danger' :
          'bg-ui-warning-soft text-ui-warning'
        }`}>
          {r.status}
        </span>
        {r.refunded_amount > 0 && r.status !== 'returned' && (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-ui-warning-soft text-ui-warning">
            {isAr ? `مرتجع ${formatCurrency(r.refunded_amount, currency, lang)}` : `Refunded ${formatCurrency(r.refunded_amount, currency, lang)}`}
          </span>
        )}
      </div>
    )},
    { key: 'actions', header: t('actions'), render: (r) => (
      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
        {can('refunds.approve') && (
          <button onClick={() => openViewSale(r)} className="p-1.5 rounded-md hover:bg-ui-info-soft text-ui-info" title={t('edit')}>
            <Edit2 className="w-4 h-4" />
          </button>
        )}
        {can('refunds.approve') && r.status !== 'returned' && (r.refunded_amount || 0) < r.total && (
          <button onClick={() => openRefund(r)} className="p-1.5 rounded-md hover:bg-ui-warning-soft text-ui-warning" title={isAr ? 'مرتجع' : 'Refund'}>
            <RotateCcw className="w-4 h-4" />
          </button>
        )}
        {can('refunds.approve') && r.status !== 'completed' && (
          <button onClick={() => setDeleteId(r.id)} className="p-1.5 rounded-md hover:bg-ui-danger-soft text-ui-danger" title={t('delete')}>
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    )},
  ];

  return (
    <DesignSurface testId="sales-page">
      <DesignPageHeader title={t('salesInvoices')} actions={
        <>
          {selectedIds.size > 0 && (
            <Button variant="danger" size="sm" onClick={() => setDeleteSelectedConfirm(true)} data-testid="sales-delete-selected">
              <Trash2 className="w-4 h-4" /> {t('deleteSelected')} ({selectedIds.size})
            </Button>
          )}
        </>
      } />

      <DesignPanel testId="sales-search-panel">
        <DesignSearch value={search} onChange={setSearch} label={t('search')}
          placeholder={isAr ? 'بحث برقم الفاتورة أو اسم العميل...' : 'Search by invoice number or customer...'} testId="sales-search" />
      </DesignPanel>

      <DesignPanel testId="sales-table-panel">
        <DataTable columns={columns} data={filtered} loading={loading} error={error} emptyMessage={t('noData')}
          onRowClick={openViewSale} showCheckbox selectedIds={selectedIds} onSelectionChange={setSelectedIds} />
        <DesignPagination loaded={items.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
      </DesignPanel>

      {/* Sale Detail / Edit Modal */}
      <Modal open={!!viewSale} onClose={() => setViewSale(null)} title={isAr ? 'تفاصيل الفاتورة' : 'Invoice Details'} size="lg">
        {viewSale && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-ui-page-alt rounded-lg">
              <FileText className="w-8 h-8 text-brand-500" />
              <div>
                <p className="font-bold text-lg text-ui-text">{viewSale.invoice_number}</p>
                <p className="text-sm text-ui-subtle">{formatDateTime(viewSale.created_at, lang)}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Select label={t('customer')} value={editForm.customer_id} onChange={(e) => setEditForm({ ...editForm, customer_id: e.target.value })}>
                <option value="">--</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              <Select label={isAr ? 'طريقة الدفع' : 'Payment Method'} value={editForm.payment_method} onChange={(e) => setEditForm({ ...editForm, payment_method: e.target.value })}>
                <option value="cash">{t('cash')}</option>
                <option value="card">{t('card')}</option>
                <option value="transfer">{t('transfer')}</option>
                <option value="credit">{t('credit')}</option>
              </Select>
              <Select label={t('status')} value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>
                <option value="completed">{isAr ? 'مكتملة' : 'Completed'}</option>
                <option value="pending">{isAr ? 'قيد الانتظار' : 'Pending'}</option>
                <option value="returned">{isAr ? 'مرتجعة' : 'Returned'}</option>
              </Select>
              <div />
            </div>
            <Textarea label={t('notes')} value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} rows={2} />

            {viewSale.sale_items && viewSale.sale_items.length > 0 && (
              <div>
                <h4 className="font-semibold text-ui-muted mb-2">{isAr ? 'أصناف الفاتورة' : 'Invoice Items'}</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-ui-border">
                        <th className="px-3 py-2 text-start text-xs font-medium text-ui-subtle">{t('productName')}</th>
                        <th className="px-3 py-2 text-start text-xs font-medium text-ui-subtle">{isAr ? 'الكمية' : 'Qty'}</th>
                        <th className="px-3 py-2 text-start text-xs font-medium text-ui-subtle">{isAr ? 'السعر' : 'Price'}</th>
                        <th className="px-3 py-2 text-start text-xs font-medium text-ui-subtle">{t('total')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewSale.sale_items.map((item) => (
                        <tr key={item.id} className="border-b border-ui-border">
                          <td className="px-3 py-2 text-ui-text">{item.product?.name || '-'}</td>
                          <td className="px-3 py-2 text-ui-muted">{item.quantity}</td>
                          <td className="px-3 py-2 text-ui-muted">{formatCurrency(item.unit_price, currency, lang)}</td>
                          <td className="px-3 py-2 font-medium text-ui-text">{formatCurrency(item.total, currency, lang)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="bg-ui-page-alt rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm"><span>{t('total')}</span><span className="font-bold text-brand-600">{formatCurrency(viewSale.total, currency, lang)}</span></div>
              <div className="flex justify-between text-sm"><span>{isAr ? 'المدفوع' : 'Paid'}</span><span>{formatCurrency(viewSale.paid_amount, currency, lang)}</span></div>
              {viewSale.total - viewSale.paid_amount > 0 && (
                <div className="flex justify-between text-sm text-ui-danger"><span>{isAr ? 'المتبقي' : 'Remaining'}</span><span>{formatCurrency(viewSale.total - viewSale.paid_amount, currency, lang)}</span></div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setViewSale(null)}>{t('cancel')}</Button>
              <Button onClick={saveSaleEdit}>{t('save')}</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Refund Modal */}
      <Modal open={!!refundSale} onClose={() => setRefundSale(null)} title={isAr ? 'مرتجع الفاتورة' : 'Invoice Refund'} size="lg">
        {refundSale && (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-ui-page-alt rounded-lg">
              <div>
                <p className="font-bold text-lg text-ui-text">{refundSale.invoice_number}</p>
                <p className="text-sm text-ui-subtle">{formatDateTime(refundSale.created_at, lang)}</p>
              </div>
              <span className="text-sm text-ui-subtle">{isAr ? 'إجمالي الفاتورة' : 'Invoice total'}: <b>{formatCurrency(refundSale.total, currency, lang)}</b></span>
            </div>

            <div className="overflow-x-auto border border-ui-border rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ui-border bg-ui-page-alt/60">
                    <th className="px-3 py-2 text-start text-xs font-medium text-ui-subtle">{t('productName')}</th>
                    <th className="px-3 py-2 text-start text-xs font-medium text-ui-subtle">{isAr ? 'كمية المرتجع' : 'Refund Qty'}</th>
                    <th className="px-3 py-2 text-start text-xs font-medium text-ui-subtle">{isAr ? 'قيمة المرتجع' : 'Refund Value'}</th>
                  </tr>
                </thead>
                <tbody>
                  {refundSale.sale_items?.map((item) => {
                    const remaining = item.quantity - (item.refunded_quantity || 0);
                    return (
                      <tr key={item.id} className="border-b border-ui-border">
                        <td className="px-3 py-2">
                          <p className="text-ui-text">{item.product?.name || '-'}</p>
                          <p className="text-xs text-ui-subtle">{isAr ? 'الكمية المبيعة' : 'Sold'}: {item.quantity}{item.refunded_quantity > 0 ? ` · ${isAr ? 'مرتجع' : 'refunded'}: ${item.refunded_quantity}` : ''}</p>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={0}
                            max={remaining}
                            step="any"
                            value={refundQty[item.id] ?? ''}
                            onChange={(e) => setRefundQty({ ...refundQty, [item.id]: e.target.value })}
                            className="w-24 px-2 py-1.5 rounded-lg border border-ui-border bg-ui-surface text-sm text-ui-text focus:outline-none focus:ring-2 focus:ring-ui-primary"
                          />
                        </td>
                        <td className="px-3 py-2 font-medium text-ui-text">{formatCurrency(refundLineTotal(item), currency, lang)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <Textarea label={isAr ? 'سبب المرتجع (اختياري)' : 'Refund reason (optional)'} value={refundReason} onChange={(e) => setRefundReason(e.target.value)} rows={2} />

            <div className="flex justify-between items-center bg-ui-danger-soft rounded-lg px-4 py-3">
              <span className="font-semibold text-ui-danger">{isAr ? 'قيمة المرتجع الإجمالية' : 'Total refund'}</span>
              <span className="font-bold text-lg text-ui-danger">{formatCurrency(refundTotal(), currency, lang)}</span>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRefundSale(null)}>{t('cancel')}</Button>
              <Button onClick={submitRefund} disabled={refunding}>
                <RotateCcw className="w-4 h-4" /> {refunding ? '...' : (isAr ? 'تأكيد المرتجع' : 'Confirm Refund')}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={remove}
        title={t('deleteSale')} message={t('confirmDeleteSale')} confirmLabel={t('delete')} cancelLabel={t('cancel')} />
      <ConfirmDialog open={deleteSelectedConfirm} onClose={() => setDeleteSelectedConfirm(false)} onConfirm={removeSelected}
        title={t('deleteSelected')} message={t('confirmDeleteAll')} confirmLabel={t('delete')} cancelLabel={t('cancel')} />
    </DesignSurface>
  );
}
