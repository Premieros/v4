import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Trash2 } from 'lucide-react';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/Toast';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import { DesignSurface, DesignPageHeader, DesignSearch, DesignPanel } from '@/components/design';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Input, Select, Textarea } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { formatNumber } from '@/lib/format';
import { exportToExcel } from '@/lib/excel';
import { APP_ROUTES } from '@/core/navigation/routes';
import {
  buildProductReorderLines,
  buildRawReorderLines,
  reorderLinesToProcurementItems,
  type ReorderLine,
} from '@/lib/reorder';
import type { LowStockAlertRow, Warehouse, Supplier } from '@/lib/types';

export function LowStockAlertsPage() {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';
  const { show } = useToast();
  const branchFilter = useBranchFilter();

  const [rows, setRows] = useState<LowStockAlertRow[]>([]);
  const [summary, setSummary] = useState<{ out_count?: number; low_count?: number; ok_count?: number }>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [branchId, setBranchId] = useState(branchFilter || '');
  const [warehouseId, setWarehouseId] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const { user } = useAuth();
  const can = useCan();
  const navigate = useNavigate();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [reorderOpen, setReorderOpen] = useState(false);
  const [reorderItems, setReorderItems] = useState<ReorderLine[]>([]);
  const [qtyOverride, setQtyOverride] = useState<Record<string, number>>({});
  const [loadingReorder, setLoadingReorder] = useState(false);
  const [savingReorder, setSavingReorder] = useState(false);
  const [reorderForm, setReorderForm] = useState({
    branch_id: '',
    supplier_id: '',
    priority: 'normal',
    expected_date: '',
    notes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [br, wh, sp] = await Promise.all([
      supabase.from('branches').select('id, name').eq('is_active', true).order('name'),
      supabase.from('warehouses').select('*').eq('is_active', true).order('name'),
      supabase.from('suppliers').select('*').order('name'),
    ]);
    if (br.error) { setError(br.error.message); setLoading(false); show(br.error.message, 'error'); return; }
    const b = (br.data as { id: string; name: string }[] | null) || [];
    setBranches(b);
    setWarehouses((wh.data as Warehouse[]) || []);
    setSuppliers((sp.data as Supplier[]) || []);
    let effBranch = branchId;
    if (!effBranch && b.length === 1) { effBranch = b[0].id; setBranchId(effBranch); }

    const [alerts, sum] = await Promise.all([
      api.inventory.getLowStockAlerts({ p_branch_id: effBranch || null, p_warehouse_id: warehouseId || null }),
      api.inventory.getLowStockSummary({ p_branch_id: effBranch || null, p_warehouse_id: warehouseId || null }),
    ]);
    if (alerts.error || sum.error) { setError(alerts.error?.message || sum.error?.message || t('error')); setLoading(false); return; }
    setRows(alerts.data || []);
    setSummary(sum.data || {});
    setLoading(false);
  }, [branchId, warehouseId, show, t]);

  useEffect(() => { load(); }, [load]);

  const filtered = rows.map((r) => ({
    ...r,
    id: `${r.product_id}-${r.warehouse_id || 'n/a'}`,
  })).filter((r) => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return r.product_name.toLowerCase().includes(q)
      || (r.barcode || '').toLowerCase().includes(q)
      || (r.warehouse_name || '').toLowerCase().includes(q);
  });

  const visibleBranches = branchFilter ? branches.filter((b) => b.id === branchFilter) : branches;

  const handleExport = () => {
    exportToExcel(filtered.map((r) => ({
      Product: r.product_name, Barcode: r.barcode || '', SKU: r.sku || '',
      Warehouse: r.warehouse_name || '', Quantity: r.quantity,
      ReorderPoint: r.reorder_point, LowStockThreshold: r.low_stock_threshold,
      Shortage: r.shortage_qty, Status: r.status,
    })), 'low-stock-alerts');
  };

  const loadReorder = useCallback(async (branchId: string) => {
    if (!branchId) return;
    setLoadingReorder(true);
    const [alerts, rawRes] = await Promise.all([
      api.inventory.getLowStockAlerts({ p_branch_id: branchId, p_warehouse_id: null }),
      supabase
        .from('raw_material_inventory')
        .select('raw_material_id, quantity, min_stock, raw_material:raw_materials(id, name, code, min_stock, default_cost, is_active, unit:units(name))')
        .eq('branch_id', branchId),
    ]);
    const alertRows = alerts.data || [];
    const productIds = alertRows.map((r) => r.product_id);
    const costMap: Record<string, number> = {};
    if (productIds.length > 0) {
      const { data: costs } = await supabase.from('products').select('id, cost_price').in('id', productIds);
      for (const c of (costs as { id: string; cost_price: number }[] | null) || []) costMap[c.id] = Number(c.cost_price) || 0;
    }
    const productLines = buildProductReorderLines(alertRows).map((l) => ({
      ...l,
      estimated_cost: costMap[l.product_id || ''] || 0,
    }));
    const rawRows = ((rawRes.data || []) as unknown as {
      raw_material_id: string;
      quantity: number;
      min_stock: number;
      raw_material: { id: string; name: string; code: string | null; min_stock: number; default_cost: number; is_active: boolean; unit: { name: string } | null } | null;
    }[]).filter((r) => r.raw_material && r.raw_material.is_active !== false).map((r) => ({
      raw_material_id: r.raw_material_id,
      name: r.raw_material!.name,
      unit_name: r.raw_material!.unit?.name || null,
      quantity: Number(r.quantity) || 0,
      min_stock: Number(r.raw_material!.min_stock) || Number(r.min_stock) || 0,
      default_cost: Number(r.raw_material!.default_cost) || 0,
    }));
    const rawLines = buildRawReorderLines(rawRows);
    const lines = [...productLines, ...rawLines];
    setReorderItems(lines);
    setQtyOverride(Object.fromEntries(lines.map((l) => [l.key, l.suggested_qty])));
    setLoadingReorder(false);
  }, []);

  const openReorder = () => {
    const effBranch = branchId || user?.branch_id || branches[0]?.id || '';
    if (!effBranch) { show(t('required') + ': ' + t('branch'), 'error'); return; }
    setReorderForm({ branch_id: effBranch, supplier_id: '', priority: 'normal', expected_date: '', notes: '' });
    setReorderOpen(true);
    loadReorder(effBranch);
  };

  const changeReorderBranch = (next: string) => {
    setReorderForm((f) => ({ ...f, branch_id: next, supplier_id: '' }));
    setReorderItems([]);
    setQtyOverride({});
    if (next) loadReorder(next);
  };

  const updateQty = (key: string, value: number) => setQtyOverride((prev) => ({ ...prev, [key]: value }));

  const removeReorderLine = (key: string) => {
    setReorderItems((items) => items.filter((l) => l.key !== key));
    setQtyOverride((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const submitReorder = async () => {
    if (!reorderForm.branch_id) { show(t('required') + ': ' + t('branch'), 'error'); return; }
    const items = reorderLinesToProcurementItems(reorderItems, qtyOverride);
    if (items.length === 0) { show(t('required') + ': ' + t('addItem'), 'error'); return; }
    setSavingReorder(true);
    const { data, error: err } = await api.procurement.createPurchaseRequest({
      p_branch_id: reorderForm.branch_id,
      p_supplier_id: reorderForm.supplier_id || null,
      p_priority: reorderForm.priority,
      p_expected_date: reorderForm.expected_date || null,
      p_notes: reorderForm.notes || null,
      p_items: items,
    });
    setSavingReorder(false);
    if (err) { show(err.message, 'error'); return; }
    const result = data as { success?: boolean; error?: string; detail?: string; request_number?: string } | null;
    if (!result?.success) { show(result?.detail || result?.error || t('error'), 'error'); return; }
    show(`${t('createRequest')}: ${result.request_number || ''}`, 'success');
    setReorderOpen(false);
    navigate(APP_ROUTES.purchaseRequests);
  };

  const statusPill = (status: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      out: { label: t('statusOut'), cls: 'bg-ui-danger-soft text-ui-danger' },
      low: { label: t('statusLow'), cls: 'bg-ui-warning-soft text-ui-warning' },
      ok: { label: t('statusOk'), cls: 'bg-ui-success-soft text-ui-success  dark:text-ui-success' },
    };
    const s = map[status] || map.ok;
    return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.cls}`}>{s.label}</span>;
  };

  const columns: Column<LowStockAlertRow & { id: string }>[] = [
    { key: 'product', header: t('product'), render: (r) => (
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-ui-page-alt flex items-center justify-center text-xs font-bold text-ui-subtle">
          {r.product_name[0]}
        </div>
        <div>
          <p className="font-medium text-ui-text">{r.product_name}</p>
          <p className="text-xs text-ui-subtle">{r.barcode || r.sku || ''}</p>
        </div>
      </div>
    )},
    { key: 'warehouse', header: t('warehouse'), render: (r) => r.warehouse_name || '-' },
    { key: 'quantity', header: t('quantity'), render: (r) => (
      <span className={`font-semibold ${r.status === 'out' ? 'text-ui-danger' : r.status === 'low' ? 'text-ui-warning' : 'text-ui-text'}`}>
        {formatNumber(Number(r.quantity))}
      </span>
    )},
    { key: 'reorder', header: t('reorderPoint'), render: (r) => formatNumber(Number(r.reorder_point || r.low_stock_threshold)) },
    { key: 'shortage', header: t('shortageQty'), render: (r) => (
      <span className="font-semibold text-ui-danger">{formatNumber(Number(r.shortage_qty))}</span>
    )},
    { key: 'status', header: t('status'), render: (r) => statusPill(r.status) },
  ];

  return (
    <DesignSurface testId="low-stock-alerts-page">
      <DesignPageHeader title={t('lowStockAlerts')} subtitle={isAr ? 'تنبيهات إعادة الطلب للمنتجات المنخفضة أو النافدة' : 'Reorder alerts for low or out-of-stock products'} actions={
        <>
          {can('purchases.manage') && (
            <Button size="sm" onClick={openReorder} data-testid="low-stock-reorder"><RefreshCw className="w-4 h-4" /> {t('reorder')}</Button>
          )}
          <Button variant="outline" size="sm" onClick={handleExport}>{t('exportExcel')}</Button>
        </>
      } />

      <DesignPanel testId="alerts-summary-panel">
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="rounded-ui-lg border border-ui-border bg-ui-page p-4">
            <p className="text-xs font-medium text-ui-subtle uppercase tracking-wide">{t('statusOut')}</p>
            <p className="mt-1 text-2xl font-bold text-ui-danger">{summary.out_count ?? 0}</p>
          </div>
          <div className="rounded-ui-lg border border-ui-border bg-ui-page p-4">
            <p className="text-xs font-medium text-ui-subtle uppercase tracking-wide">{t('statusLow')}</p>
            <p className="mt-1 text-2xl font-bold text-ui-warning">{summary.low_count ?? 0}</p>
          </div>
          <div className="rounded-ui-lg border border-ui-border bg-ui-page p-4">
            <p className="text-xs font-medium text-ui-subtle uppercase tracking-wide">{t('statusOk')}</p>
            <p className="mt-1 text-2xl font-bold text-ui-success dark:text-ui-success">{summary.ok_count ?? 0}</p>
          </div>
        </div>
      </DesignPanel>

      <DesignPanel testId="alerts-search-panel">
        <div className="flex flex-col sm:flex-row gap-3">
          <DesignSearch value={search} onChange={setSearch} className="flex-1" label={t('search')} placeholder={t('search')} testId="alerts-search" />
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="sm:w-36">
            <option value="all">{t('all')}</option>
            <option value="out">{t('statusOut')}</option>
            <option value="low">{t('statusLow')}</option>
          </Select>
          <Select value={branchId} onChange={(e) => { setBranchId(e.target.value); setWarehouseId(''); }} className="sm:w-44">
            <option value="">{t('allBranches')}</option>
            {visibleBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="sm:w-44">
            <option value="">{t('all')} - {t('warehouses')}</option>
            {warehouses.filter((w) => !branchId || w.branch_id === branchId).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        </div>
      </DesignPanel>

      <DesignPanel testId="alerts-table-panel">
        <DataTable columns={columns} data={filtered} loading={loading} error={error} emptyMessage={t('noData')} />
      </DesignPanel>

      <Modal open={reorderOpen} onClose={() => setReorderOpen(false)} title={`${t('reorder')} — ${t('createRequest')}`} size="2xl">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Select label={t('branch')} value={reorderForm.branch_id} onChange={(e) => changeReorderBranch(e.target.value)}>
              <option value="">--</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
            <Select label={t('supplier')} value={reorderForm.supplier_id} onChange={(e) => setReorderForm({ ...reorderForm, supplier_id: e.target.value })}>
              <option value="">{t('all')}</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
            <Select label={t('priority')} value={reorderForm.priority} onChange={(e) => setReorderForm({ ...reorderForm, priority: e.target.value })}>
              <option value="low">{t('priorityLow')}</option>
              <option value="normal">{t('priorityNormal')}</option>
              <option value="high">{t('priorityHigh')}</option>
              <option value="urgent">{t('priorityUrgent')}</option>
            </Select>
            <Input label={t('expectedDate')} type="date" value={reorderForm.expected_date} onChange={(e) => setReorderForm({ ...reorderForm, expected_date: e.target.value })} />
          </div>

          <div className="rounded-xl border border-ui-border overflow-hidden">
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-ui-page-alt text-xs text-ui-subtle dark:text-ui-subtle">
                  <tr>
                    <th className="px-3 py-2 text-start font-medium">{t('type')}</th>
                    <th className="px-3 py-2 text-start font-medium">{t('name')}</th>
                    <th className="px-3 py-2 text-start font-medium">{t('availableStock')}</th>
                    <th className="px-3 py-2 text-start font-medium">{t('minStock')} / {t('maxStock')}</th>
                    <th className="px-3 py-2 text-start font-medium">{t('suggestedQty')}</th>
                    <th className="px-3 py-2 text-start font-medium">{t('quantity')}</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {loadingReorder && (
                    <tr><td colSpan={7} className="px-3 py-6 text-center text-ui-subtle">{t('loading')}</td></tr>
                  )}
                  {!loadingReorder && reorderItems.length === 0 && (
                    <tr><td colSpan={7} className="px-3 py-6 text-center text-ui-subtle">{t('noData')}</td></tr>
                  )}
                  {!loadingReorder && reorderItems.map((l) => (
                    <tr key={l.key} className="border-t border-ui-border">
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${l.item_type === 'raw' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' : 'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400'}`}>
                          {l.item_type === 'raw' ? t('rawMaterial') : t('product')}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-medium text-ui-text">{l.name}</td>
                      <td className="px-3 py-2 text-ui-muted">{formatNumber(l.on_hand)}</td>
                      <td className="px-3 py-2 text-ui-subtle">{formatNumber(l.min_stock)}{l.max_stock > 0 ? ` / ${formatNumber(l.max_stock)}` : ''}</td>
                      <td className="px-3 py-2 text-ui-subtle">{formatNumber(l.suggested_qty)}</td>
                      <td className="px-3 py-2">
                        <Input type="number" step="0.0001" value={qtyOverride[l.key] ?? ''} onChange={(e) => updateQty(l.key, parseFloat(e.target.value) || 0)} className="w-28" />
                      </td>
                      <td className="px-3 py-2 text-end">
                        <button onClick={() => removeReorderLine(l.key)} className="p-1.5 rounded-md hover:bg-ui-danger-soft text-ui-danger" title={t('remove')}><Trash2 className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <Textarea label={t('notes')} value={reorderForm.notes} onChange={(e) => setReorderForm({ ...reorderForm, notes: e.target.value })} rows={2} />

          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setReorderOpen(false)}>{t('cancel')}</Button>
            <Button size="sm" onClick={submitReorder} disabled={savingReorder || loadingReorder} data-testid="low-stock-reorder-submit">
              {savingReorder ? t('loading') : t('createRequest')}
            </Button>
          </div>
        </div>
      </Modal>
    </DesignSurface>
  );
}
