import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { DesignSurface, DesignPageHeader, DesignSearch, DesignPanel } from '@/components/design';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { formatCurrency, formatNumber, formatDate, formatDateTime } from '@/lib/format';
import { exportToExcel } from '@/lib/excel';
import { foodCostPct, marginPct, safeDiv, variancePct } from '@/lib/costing';
import type {
  CostingOverviewRow, OrderMarginRow, SupplierPriceImpactRow, ProductCostingDetail,
} from '@/lib/types';

type Tab = 'overview' | 'orders' | 'supplier';

export function CostingCenterPage() {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';
  const { show } = useToast();
  const branchFilter = useBranchFilter();

  const [tab, setTab] = useState<Tab>('overview');

  const [overview, setOverview] = useState<CostingOverviewRow[]>([]);
  const [orders, setOrders] = useState<OrderMarginRow[]>([]);
  const [supplierImpact, setSupplierImpact] = useState<SupplierPriceImpactRow[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [branchId, setBranchId] = useState(branchFilter || '');
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [detail, setDetail] = useState<ProductCostingDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadBranches = useCallback(async () => {
    const br = await supabase.from('branches').select('id, name').eq('is_active', true).order('name');
    if (br.error) { show(br.error.message, 'error'); return; }
    const b = (br.data as { id: string; name: string }[] | null) || [];
    setBranches(b);
    if (!branchId && b.length === 1) { setBranchId(b[0].id); }
  }, [branchId, show]);

  const loadSuppliers = useCallback(async () => {
    const sp = await supabase.from('suppliers').select('id, name').eq('is_active', true).order('name');
    if (sp.error) { show(sp.error.message, 'error'); return; }
    const s = (sp.data as { id: string; name: string }[] | null) || [];
    setSuppliers(s);
    if (s.length > 0) setSupplierId(s[0].id);
  }, [show]);

  const effBranch = useMemo(() => branchId || null, [branchId]);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await api.costing.getOverview({ p_branch_id: effBranch });
    if (res.error) { setError(res.error.message); setLoading(false); show(res.error.message, 'error'); return; }
    setOverview(res.data || []);
    setLoading(false);
  }, [effBranch, show]);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await api.costing.getOrderMargin({
      p_branch_id: effBranch,
      p_from: fromDate || null,
      p_to: toDate || null,
    });
    if (res.error) { setError(res.error.message); setLoading(false); show(res.error.message, 'error'); return; }
    setOrders(res.data || []);
    setLoading(false);
  }, [effBranch, fromDate, toDate, show]);

  const loadSupplierImpact = useCallback(async () => {
    if (!supplierId) { setSupplierImpact([]); return; }
    setLoading(true);
    setError(null);
    const res = await api.costing.getSupplierPriceImpact({ p_supplier_id: supplierId });
    if (res.error) { setError(res.error.message); setLoading(false); show(res.error.message, 'error'); return; }
    setSupplierImpact(res.data || []);
    setLoading(false);
  }, [supplierId, show]);

  useEffect(() => { loadBranches(); }, [loadBranches]);

  useEffect(() => { loadSuppliers(); }, [loadSuppliers]);

  useEffect(() => {
    if (tab === 'overview') loadOverview();
    else if (tab === 'orders') loadOrders();
    else if (tab === 'supplier') loadSupplierImpact();
  }, [tab, loadOverview, loadOrders, loadSupplierImpact]);

  const openDetail = async (productId: string) => {
    setDetailLoading(true);
    const res = await api.costing.getProductDetail({ p_product_id: productId, p_branch_id: effBranch });
    setDetailLoading(false);
    if (res.error) { show(res.error.message, 'error'); return; }
    if (res.data && res.data.success === false) { show(res.data.error || t('error'), 'error'); return; }
    setDetail(res.data || null);
  };

  const filteredOverview = useMemo(() => {
    const q = search.toLowerCase();
    return overview.filter((r) => !q
      || r.product_name.toLowerCase().includes(q)
      || (r.barcode || '').toLowerCase().includes(q)
      || (r.sku || '').toLowerCase().includes(q)
      || (r.category_name || '').toLowerCase().includes(q));
  }, [overview, search]);

  const stats = useMemo(() => {
    const count = filteredOverview.length;
    const fc = filteredOverview.map((r) => foodCostPct(r.actual_cost || r.theoretical_cost || r.unit_cost, r.sale_price));
    const avg = safeDiv(fc.reduce((s, v) => s + v, 0), fc.length);
    const worst = filteredOverview.reduce<CostingOverviewRow | null>((acc, r) => {
      const v = foodCostPct(r.actual_cost || r.theoretical_cost || r.unit_cost, r.sale_price);
      return !acc || v > foodCostPct(acc.actual_cost || acc.theoretical_cost || acc.unit_cost, acc.sale_price) ? r : acc;
    }, null);
    return { count, avg, worst };
  }, [filteredOverview]);

  const visibleBranches = branchFilter ? branches.filter((b) => b.id === branchFilter) : branches;

  const money = (v: number | undefined | null) => formatCurrency(Number(v || 0), 'EGP', lang);

  const pill = (label: string, cls: string) => (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{label}</span>
  );

  const marginPill = (v: number) => {
    if (v >= 40) return pill(`${formatNumber(v, 1)}%`, 'bg-ui-success-soft text-ui-success  dark:text-ui-success');
    if (v >= 20) return pill(`${formatNumber(v, 1)}%`, 'bg-ui-warning-soft text-ui-warning');
    return pill(`${formatNumber(v, 1)}%`, 'bg-ui-danger-soft text-ui-danger');
  };

  const overviewColumns: Column<CostingOverviewRow & { id: string }>[] = [
    { key: 'product', header: t('product'), render: (r) => (
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-ui-page-alt flex items-center justify-center text-xs font-bold text-ui-subtle">
          {r.product_name[0]}
        </div>
        <div>
          <p className="font-medium text-ui-text">{r.product_name}</p>
          <p className="text-xs text-ui-subtle">{r.barcode || r.sku || r.category_name || ''}</p>
        </div>
      </div>
    )},
    { key: 'sale', header: t('salePrice'), render: (r) => money(r.sale_price) },
    { key: 'unitCost', header: t('unitCost'), render: (r) => money(r.unit_cost) },
    { key: 'theoretical', header: t('theoreticalCost'), render: (r) => money(r.theoretical_cost) },
    { key: 'actual', header: t('actualCost'), render: (r) => money(r.actual_cost) },
    { key: 'margin', header: t('marginPct'), render: (r) => {
      const cost = r.actual_cost || r.theoretical_cost || r.unit_cost;
      return marginPill(marginPct(cost, r.sale_price));
    }},
    { key: 'variance', header: t('variance'), render: (r) => {
      if (!r.theoretical_cost && !r.actual_cost) return '-';
      return <span className="text-xs">{formatNumber(variancePct(r.actual_cost, r.theoretical_cost), 1)}%</span>;
    }},
  ];

  const orderColumns: Column<OrderMarginRow & { id: string }>[] = [
    { key: 'invoice', header: t('invoiceNumber'), render: (r) => <span className="font-medium">{r.invoice_number}</span> },
    { key: 'date', header: t('date'), render: (r) => formatDate(r.sale_date, lang) },
    { key: 'total', header: t('total'), render: (r) => money(r.total) },
    { key: 'discount', header: t('discountAmount'), render: (r) => money(r.discount_amount) },
    { key: 'cogs', header: t('unitCost'), render: (r) => money(r.cogs) },
    { key: 'margin', header: t('grossMargin'), render: (r) => (
      <span className={`font-semibold ${r.gross_margin >= 0 ? 'text-ui-success dark:text-ui-success' : 'text-ui-danger'}`}>
        {money(r.gross_margin)}
      </span>
    )},
    { key: 'marginPct', header: t('marginPct'), render: (r) => marginPill(marginPct(r.cogs, r.total - r.discount_amount)) },
  ];

  const supplierColumns: Column<SupplierPriceImpactRow & { id: string }>[] = [
    { key: 'item', header: t('item'), render: (r) => (
      <div>
        <p className="font-medium text-ui-text">{r.item_name}</p>
        <p className="text-xs text-ui-subtle">{r.item_type === 'product' ? t('product') : t('rawMaterial')}</p>
      </div>
    )},
    { key: 'first', header: t('firstCost'), render: (r) => money(r.first_cost) },
    { key: 'last', header: t('lastCost'), render: (r) => money(r.last_cost) },
    { key: 'avg', header: t('avgCost'), render: (r) => money(r.avg_cost) },
    { key: 'change', header: t('changePct'), render: (r) => (
      <span className={`font-semibold ${r.change_pct > 0 ? 'text-ui-danger' : r.change_pct < 0 ? 'text-ui-success dark:text-ui-success' : 'text-ui-muted'}`}>
        {r.change_pct > 0 ? '+' : ''}{formatNumber(r.change_pct, 1)}%
      </span>
    )},
    { key: 'count', header: t('purchaseCount'), render: (r) => formatNumber(r.purchase_count, 0) },
    { key: 'lastDate', header: t('lastUpdated'), render: (r) => r.last_purchased_at ? formatDate(r.last_purchased_at, lang) : '-' },
  ];

  const tabBtn = (key: Tab, label: string) => (
    <button
      onClick={() => setTab(key)}
      className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
        tab === key
          ? 'bg-ui-primary text-ui-primary-fg shadow-lg shadow-ui-primary/25 scale-[1.02]'
          : 'liquid-glass text-ui-text hover:border-ui-primary/40 hover:bg-ui-surface/90'
      }`}
    >
      {label}
    </button>
  );

  const handleExportOverview = () => {
    exportToExcel(filteredOverview.map((r) => ({
      Product: r.product_name, Barcode: r.barcode || '', SKU: r.sku || '',
      Category: r.category_name || '', Type: r.product_type,
      SalePrice: r.sale_price, UnitCost: r.unit_cost,
      TheoreticalCost: r.theoretical_cost, ActualCost: r.actual_cost,
    })), 'costing-overview');
  };

  const handleExportOrders = () => {
    exportToExcel(orders.map((r) => ({
      Invoice: r.invoice_number, Date: r.sale_date,
      Total: r.total, Discount: r.discount_amount, COGS: r.cogs, GrossMargin: r.gross_margin,
    })), 'order-margin');
  };

  const handleExportSupplier = () => {
    exportToExcel(supplierImpact.map((r) => ({
      Item: r.item_name, Type: r.item_type, FirstCost: r.first_cost, LastCost: r.last_cost,
      AvgCost: r.avg_cost, ChangePct: r.change_pct, PurchaseCount: r.purchase_count,
    })), 'supplier-price-impact');
  };

  return (
    <DesignSurface testId="costing-center-page">
      <DesignPageHeader
        title={t('costingCenter')}
        subtitle={isAr ? 'تكلفة المنتجات وربحية المبيعات وأثر أسعار الموردين' : 'Product costing, sales margin and supplier price impact'}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (tab === 'overview') handleExportOverview();
              else if (tab === 'orders') handleExportOrders();
              else if (tab === 'supplier') handleExportSupplier();
            }}
          >
            <Download className="w-4 h-4" /> {t('exportExcel')}
          </Button>
        }
      />

      <div className="flex gap-1.5 liquid-glass rounded-2xl p-1.5 w-fit mb-4" role="tablist">
        {tabBtn('overview', t('costingOverview'))}
        {tabBtn('orders', t('orderMargin'))}
        {tabBtn('supplier', t('supplierImpact'))}
      </div>

      {tab === 'overview' && (
        <>
          <DesignPanel testId="costing-summary-panel">
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="rounded-xl border border-ui-border bg-ui-surface/60 p-4 shadow-sm">
                <p className="text-xs font-medium text-ui-subtle uppercase tracking-wide">{t('product')}</p>
                <p className="mt-1 text-2xl font-bold text-ui-primary">{stats.count}</p>
              </div>
              <div className="rounded-xl border border-ui-border bg-ui-surface/60 p-4 shadow-sm">
                <p className="text-xs font-medium text-ui-subtle uppercase tracking-wide">{t('foodCostPct')}</p>
                <p className="mt-1 text-2xl font-bold text-ui-text">{formatNumber(stats.avg, 1)}%</p>
              </div>
              <div className="rounded-xl border border-ui-border bg-ui-surface/60 p-4 shadow-sm">
                <p className="text-xs font-medium text-ui-subtle uppercase tracking-wide">{isAr ? 'أعلى تكلفة نسبة' : 'Highest cost ratio'}</p>
                <p className="mt-1 truncate font-semibold text-ui-text">{stats.worst ? stats.worst.product_name : '-'}</p>
              </div>
            </div>
          </DesignPanel>

          <DesignPanel testId="costing-search-panel">
            <div className="flex flex-col sm:flex-row gap-3">
              <DesignSearch value={search} onChange={setSearch} className="flex-1" label={t('search')} placeholder={t('search')} testId="costing-search" />
              <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="sm:w-44">
                <option value="">{t('allBranches')}</option>
                {visibleBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </div>
          </DesignPanel>

          <DesignPanel testId="costing-table-panel">
            <DataTable
              columns={overviewColumns}
              data={filteredOverview.map((r) => ({ ...r, id: r.product_id }))}
              loading={loading}
              error={error}
              emptyMessage={t('noData')}
              onRowClick={(r) => openDetail(r.product_id)}
            />
          </DesignPanel>
        </>
      )}

      {tab === 'orders' && (
        <DesignPanel testId="order-margin-panel">
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="border border-ui-border rounded-lg px-3 py-2 bg-ui-page text-sm"
            />
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="border border-ui-border rounded-lg px-3 py-2 bg-ui-page text-sm"
            />
            <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="sm:w-44">
              <option value="">{t('allBranches')}</option>
              {visibleBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
            <Button size="sm" onClick={loadOrders}>{t('search')}</Button>
          </div>
          <DataTable
            columns={orderColumns}
            data={orders.map((r) => ({ ...r, id: r.sale_id }))}
            loading={loading}
            error={error}
            emptyMessage={t('noData')}
          />
        </DesignPanel>
      )}

      {tab === 'supplier' && (
        <DesignPanel testId="supplier-impact-panel">
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <Select value={supplierId} onChange={(e) => { setSupplierId(e.target.value); loadSupplierImpact(); }} className="sm:w-72">
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>
          <DataTable
            columns={supplierColumns}
            data={supplierImpact.map((r) => ({ ...r, id: `${r.item_type}-${r.item_id}` }))}
            loading={loading}
            error={error}
            emptyMessage={t('noData')}
          />
        </DesignPanel>
      )}

      <Modal open={detail !== null} onClose={() => setDetail(null)} title={detail?.product_name || t('costingCenter')} size="2xl">
        {detailLoading && <p className="text-sm text-ui-subtle">{t('loading')}</p>}
        {!detailLoading && detail && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="rounded-ui-lg border border-ui-border bg-ui-page p-3">
                <p className="text-xs text-ui-subtle">{t('salePrice')}</p>
                <p className="text-lg font-bold text-ui-text">{money(detail.sale_price)}</p>
              </div>
              <div className="rounded-ui-lg border border-ui-border bg-ui-page p-3">
                <p className="text-xs text-ui-subtle">{t('unitCost')}</p>
                <p className="text-lg font-bold text-ui-text">{money(detail.unit_cost)}</p>
              </div>
              <div className="rounded-ui-lg border border-ui-border bg-ui-page p-3">
                <p className="text-xs text-ui-subtle">{t('theoreticalCost')}</p>
                <p className="text-lg font-bold text-ui-text">{money(detail.theoretical_cost)}</p>
              </div>
              <div className="rounded-ui-lg border border-ui-border bg-ui-page p-3">
                <p className="text-xs text-ui-subtle">{t('actualCost')}</p>
                <p className="text-lg font-bold text-ui-text">{money(detail.actual_cost)}</p>
              </div>
              <div className="rounded-ui-lg border border-ui-border bg-ui-page p-3">
                <p className="text-xs text-ui-subtle">{t('foodCostPct')}</p>
                <p className="text-lg font-bold text-ui-text">
                  {formatNumber(foodCostPct(detail.actual_cost || detail.theoretical_cost || detail.unit_cost || 0, detail.sale_price || 0), 1)}%
                </p>
              </div>
              <div className="rounded-ui-lg border border-ui-border bg-ui-page p-3">
                <p className="text-xs text-ui-subtle">{t('marginPct')}</p>
                <p className="text-lg font-bold text-ui-text">
                  {formatNumber(marginPct(detail.actual_cost || detail.theoretical_cost || detail.unit_cost || 0, detail.sale_price || 0), 1)}%
                </p>
              </div>
            </div>

            {(detail.components?.length || 0) > 0 && (
              <div>
                <h3 className="text-sm font-bold text-ui-text mb-2">{t('components')}</h3>
                <div className="overflow-x-auto rounded-ui-lg border border-ui-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-ui-page-alt text-start text-xs text-ui-subtle">
                        <th className="px-3 py-2">{t('item')}</th>
                        <th className="px-3 py-2">{t('quantity')}</th>
                        <th className="px-3 py-2">{t('unitCost')}</th>
                        <th className="px-3 py-2">{t('total')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.components!.map((c) => (
                        <tr key={c.component_product_id} className="border-t border-ui-border">
                          <td className="px-3 py-2">{c.component_name}</td>
                          <td className="px-3 py-2">{formatNumber(c.quantity)}</td>
                          <td className="px-3 py-2">{money(c.unit_cost)}</td>
                          <td className="px-3 py-2">{money(c.line_cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {(detail.recipe_items?.length || 0) > 0 && (
              <div>
                <h3 className="text-sm font-bold text-ui-text mb-2">{t('recipeItems')}</h3>
                <div className="overflow-x-auto rounded-ui-lg border border-ui-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-ui-page-alt text-start text-xs text-ui-subtle">
                        <th className="px-3 py-2">{t('item')}</th>
                        <th className="px-3 py-2">{t('quantity')}</th>
                        <th className="px-3 py-2">{t('wastagePercent')}</th>
                        <th className="px-3 py-2">{t('unitCost')}</th>
                        <th className="px-3 py-2">{t('total')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.recipe_items!.map((c) => (
                        <tr key={c.raw_material_id} className="border-t border-ui-border">
                          <td className="px-3 py-2">{c.raw_material_name}</td>
                          <td className="px-3 py-2">{formatNumber(c.quantity)}</td>
                          <td className="px-3 py-2">{formatNumber(c.wastage_percent, 1)}%</td>
                          <td className="px-3 py-2">{money(c.unit_cost)}</td>
                          <td className="px-3 py-2">{money(c.line_cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {(detail.history?.length || 0) > 0 && (
              <div>
                <h3 className="text-sm font-bold text-ui-text mb-2">{t('costHistory')}</h3>
                <div className="overflow-x-auto rounded-ui-lg border border-ui-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-ui-page-alt text-start text-xs text-ui-subtle">
                        <th className="px-3 py-2">{t('date')}</th>
                        <th className="px-3 py-2">{t('oldCost')}</th>
                        <th className="px-3 py-2">{t('newCost')}</th>
                        <th className="px-3 py-2">{t('changedBy')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.history!.map((h) => (
                        <tr key={h.id} className="border-t border-ui-border">
                          <td className="px-3 py-2">{formatDateTime(h.changed_at, lang)}</td>
                          <td className="px-3 py-2">{money(h.old_cost)}</td>
                          <td className="px-3 py-2">{money(h.new_cost)}</td>
                          <td className="px-3 py-2">{h.changed_by || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </DesignSurface>
  );
}
