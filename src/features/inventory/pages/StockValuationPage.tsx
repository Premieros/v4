import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { DesignSurface, DesignPageHeader, DesignSearch, DesignPanel } from '@/components/design';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Select } from '@/components/Input';
import { formatNumber } from '@/lib/format';
import { exportToExcel } from '@/lib/excel';
import type { StockValuationRow, StockValuationSummaryRow, Warehouse } from '@/lib/types';

export function StockValuationPage() {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';
  const { show } = useToast();
  const branchFilter = useBranchFilter();

  const [rows, setRows] = useState<StockValuationRow[]>([]);
  const [summary, setSummary] = useState<StockValuationSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [branchId, setBranchId] = useState(branchFilter || '');
  const [warehouseId, setWarehouseId] = useState('');
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [br, wh] = await Promise.all([
      supabase.from('branches').select('id, name').eq('is_active', true).order('name'),
      supabase.from('warehouses').select('*').eq('is_active', true).order('name'),
    ]);
    if (br.error) { setError(br.error.message); setLoading(false); show(br.error.message, 'error'); return; }
    const b = (br.data as { id: string; name: string }[] | null) || [];
    setBranches(b);
    setWarehouses((wh.data as Warehouse[]) || []);
    let effBranch = branchId;
    if (!effBranch && b.length === 1) { effBranch = b[0].id; setBranchId(effBranch); }

    const [v, s] = await Promise.all([
      api.inventory.getStockValuation({ p_branch_id: effBranch || null, p_warehouse_id: warehouseId || null }),
      api.inventory.getStockValuationSummary({ p_branch_id: effBranch || null, p_warehouse_id: warehouseId || null }),
    ]);
    if (v.error || s.error) { setError(v.error?.message || s.error?.message || t('error')); setLoading(false); return; }
    setRows(v.data || []);
    setSummary(s.data || []);
    setLoading(false);
  }, [branchId, warehouseId, show, t]);

  useEffect(() => { load(); }, [load]);

  const filtered = rows.map((r) => ({
    ...r,
    id: `${r.product_id}-${r.warehouse_id}`,
  })).filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.product_name.toLowerCase().includes(q)
      || (r.barcode || '').toLowerCase().includes(q)
      || (r.warehouse_name || '').toLowerCase().includes(q);
  });

  const visibleBranches = branchFilter ? branches.filter((b) => b.id === branchFilter) : branches;

  const grandTotal = rows.reduce((s, r) => s + Number(r.total_value), 0);
  const grandQty = rows.reduce((s, r) => s + Number(r.quantity), 0);

  const handleExport = () => {
    exportToExcel(filtered.map((r) => ({
      Product: r.product_name, Barcode: r.barcode || '', SKU: r.sku || '',
      Warehouse: r.warehouse_name || '', Branch: r.branch_id, Quantity: r.quantity,
      UnitCost: r.unit_cost, TotalValue: r.total_value,
    })), 'stock-valuation');
  };

  const columns: Column<StockValuationRow & { id: string }>[] = [
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
    { key: 'quantity', header: t('quantity'), render: (r) => formatNumber(Number(r.quantity)) },
    { key: 'unit_cost', header: t('unitCost'), render: (r) => formatNumber(Number(r.unit_cost), 2) },
    { key: 'total_value', header: t('totalValue'), render: (r) => (
      <span className="font-semibold text-ui-text">{formatNumber(Number(r.total_value), 2)}</span>
    )},
  ];

  return (
    <DesignSurface testId="stock-valuation-page">
      <DesignPageHeader title={t('stockValuation')} subtitle={isAr ? 'تقييم المخزون (بالكلفة) حسب المنتج والمستودع' : 'Inventory valuation (at cost) by product and warehouse'} actions={
        <Button variant="outline" size="sm" onClick={handleExport}>{t('exportExcel')}</Button>
      } />

      <DesignPanel testId="valuation-summary-panel">
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="rounded-ui-lg border border-ui-border bg-ui-page p-4">
            <p className="text-xs font-medium text-ui-subtle uppercase tracking-wide">{t('grandTotal')}</p>
            <p className="mt-1 text-2xl font-bold text-ui-text">{formatNumber(grandTotal, 2)}</p>
          </div>
          <div className="rounded-ui-lg border border-ui-border bg-ui-page p-4">
            <p className="text-xs font-medium text-ui-subtle uppercase tracking-wide">{t('quantity')}</p>
            <p className="mt-1 text-2xl font-bold text-ui-text">{formatNumber(grandQty)}</p>
          </div>
        </div>
        {summary.length > 0 && (
          <div className="mt-3">
            <p className="text-sm font-medium text-ui-muted mb-2">{t('valuationByBranch')}</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {summary.map((s) => (
                <div key={s.branch_id} className="rounded-ui-lg border border-ui-border bg-ui-page-alt p-3">
                  <p className="text-sm font-medium text-ui-muted">{s.branch_name || '-'}</p>
                  <p className="text-xs text-ui-subtle">{formatNumber(Number(s.total_quantity))} {t('quantity')}</p>
                  <p className="text-base font-bold text-ui-text">{formatNumber(Number(s.total_value), 2)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </DesignPanel>

      <DesignPanel testId="valuation-search-panel">
        <div className="flex flex-col sm:flex-row gap-3">
          <DesignSearch value={search} onChange={setSearch} className="flex-1" label={t('search')} placeholder={t('search')} testId="valuation-search" />
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

      <DesignPanel testId="valuation-table-panel">
        <DataTable columns={columns} data={filtered} loading={loading} error={error} emptyMessage={t('noData')} />
      </DesignPanel>
    </DesignSurface>
  );
}
