import { useEffect, useState, useRef, useCallback } from 'react';
import { Plus, Edit2, Trash2, Download, Upload, Barcode as BarcodeIcon, QrCode } from 'lucide-react';
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
import { formatCurrency, formatNumber } from '@/lib/format';
import { exportToExcel, importFromExcel } from '@/lib/excel';
import { renderBarcode, generateQRCodeDataURL } from '@/lib/barcode';
import { logAudit } from '@/lib/audit';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import { useSettings } from '@/context/SettingsContext';
import { useBranches } from '@/hooks/useBranches';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import type { Product, Category, ProductUnit, ProductComponentInput } from '@/lib/types';

const UNIT_NAMES = ['piece', 'carton', 'box', 'pack', 'kg', 'liter', 'meter', 'gram'];

export function ProductsPage() {
  const { t, lang } = useLanguage();
  const { show } = useToast();
  const can = useCan();
  const branchFilter = useBranchFilter();
  const { rows: products, loading, total, hasMore, loadMore, loadingMore, refresh: reloadProducts } = usePaginatedRows<Product>({
    table: 'products',
    select: '*, category:categories(*)',
    order: { column: 'created_at', ascending: false },
    branch_id: branchFilter,
    pageSize: 100,
  });
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [barcodeModal, setBarcodeModal] = useState<Product | null>(null);
  const [qrModal, setQrModal] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const barcodeCanvasRef = useRef<HTMLCanvasElement>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const { effectiveSettings } = useSettings();
  const { branches } = useBranches();
  const currency = effectiveSettings(branchFilter)?.currency || 'EGP';

  const [form, setForm] = useState({
    name: '', name_en: '', barcode: '', sku: '', category_id: '', description: '',
    cost_price: 0, sale_price: 0, wholesale_price: 0, image_url: '', is_active: true, low_stock_threshold: 5, min_stock: 0, max_stock: 0, reorder_point: 0, product_type: 'ready' as 'ready' | 'manufactured',
    branch_id: '',
  });
  const [units, setUnits] = useState<ProductUnit[]>([]);
  const [productComponents, setProductComponents] = useState<ProductComponentInput[]>([]);
  const [stockComponents, setStockComponents] = useState<{ product_id: string; name: string; total: number; cost_price: number }[]>([]);
  const [componentSel, setComponentSel] = useState('');
  const [componentQty, setComponentQty] = useState(1);

  const loadStockComponents = useCallback(async () => {
    let invQuery = supabase.from('inventory').select('product_id, quantity, product:products(id, name, cost_price, is_active)');
    if (branchFilter) {
      const { data: whs } = await supabase.from('warehouses').select('id').eq('branch_id', branchFilter).eq('is_active', true);
      const ids = ((whs as { id: string }[] | null) || []).map((w) => w.id);
      if (ids.length === 0) { setStockComponents([]); return; }
      invQuery = invQuery.in('warehouse_id', ids);
    }
    const { data } = await invQuery;
    const totals: Record<string, { name: string; cost_price: number; total: number }> = {};
    for (const row of ((data || []) as unknown as { product_id: string; quantity: number; product: { id: string; name: string; cost_price: number; is_active: boolean } | null }[])) {
      if (!row.product || !row.product.is_active) continue;
      const t = totals[row.product_id] || { name: row.product.name, cost_price: row.product.cost_price, total: 0 };
      t.total += Number(row.quantity) || 0;
      totals[row.product_id] = t;
    }
    setStockComponents(
      Object.entries(totals)
        .filter(([, v]) => v.total > 0)
        .map(([product_id, v]) => ({ product_id, name: v.name, total: v.total, cost_price: v.cost_price }))
        .sort((a, b) => a.name.localeCompare(b.name))
    );
  }, [branchFilter]);

  const loadMeta = useCallback(async () => {
    let cq = supabase.from('categories').select('*');
    if (branchFilter) cq = cq.eq('branch_id', branchFilter);
    const { data: c } = await cq.order('name');
    setCategories((c as Category[]) || []);
    await loadStockComponents();
  }, [branchFilter, loadStockComponents]);

  useEffect(() => { loadMeta(); }, [loadMeta]);

  const filtered = products.filter((p) =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.barcode?.includes(search) || p.sku?.includes(search)
  );

  const availableToAdd = stockComponents.filter(
    (s) => s.product_id !== editing?.id && !productComponents.some((c) => c.component_product_id === s.product_id)
  );

  const openAdd = () => {
    window.location.hash = '/products/setup';
  };

  const openEdit = async (p: Product) => {
    setEditing(p);
    setForm({ name: p.name, name_en: p.name_en || '', barcode: p.barcode || '', sku: p.sku || '', category_id: p.category_id || '', description: p.description || '', cost_price: p.cost_price, sale_price: p.sale_price, wholesale_price: p.wholesale_price, image_url: p.image_url || '', is_active: p.is_active, low_stock_threshold: p.low_stock_threshold, min_stock: p.min_stock ?? 0, max_stock: p.max_stock ?? 0, reorder_point: p.reorder_point ?? 0, product_type: p.product_type || 'ready', branch_id: p.branch_id || branchFilter || '' });
    const [u, comps] = await Promise.all([
      supabase.from('product_units').select('*').eq('product_id', p.id),
      supabase.from('product_components').select('component_product_id, quantity').eq('product_id', p.id),
    ]);
    setUnits((u.data as ProductUnit[]) || [{ id: '', product_id: p.id, unit_name: 'piece', unit_name_en: 'piece', conversion_factor: 1, sale_price: p.sale_price, cost_price: p.cost_price, barcode: p.barcode || '', is_base: true, created_at: '' }]);
    setProductComponents(((comps.data as { component_product_id: string; quantity: number }[] | null) || []).map((c) => ({ component_product_id: c.component_product_id, quantity: Number(c.quantity) || 1 })));
    setComponentSel('');
    setComponentQty(1);
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.name) { show(t('required') + ': ' + t('name'), 'error'); return; }
    if (form.product_type === 'manufactured' && productComponents.length === 0) {
      show(t('manufacturedRequiresComponents'), 'error');
      return;
    }
    const payload = { ...form, category_id: form.category_id || null, branch_id: form.branch_id || branchFilter || null };
    const unitPayload = units.filter(u => u.unit_name).map((u) => ({
      unit_name: u.unit_name,
      unit_name_en: u.unit_name_en || u.unit_name,
      conversion_factor: u.conversion_factor,
      sale_price: u.sale_price,
      cost_price: u.cost_price,
      barcode: u.barcode || null,
      is_base: u.is_base,
    }));
    let pid: string;
    if (editing) {
      const { error } = await supabase.from('products').update(payload).eq('id', editing.id);
      if (error) { show(error.message, 'error'); return; }
      pid = editing.id;
      const { error: unitError } = await api.catalog.replaceProductUnits({ p_product_id: editing.id, p_units: unitPayload });
      if (unitError) { show(unitError.message, 'error'); return; }
      await logAudit('update', 'products', editing.id, { name: form.name });
    } else {
      const { data, error } = await supabase.from('products').insert(payload).select().single();
      if (error) { show(error.message, 'error'); return; }
      pid = (data as { id: string }).id;
      if (unitPayload.length > 0) {
        const { error: unitError } = await api.catalog.replaceProductUnits({ p_product_id: pid, p_units: unitPayload });
        if (unitError) { show(unitError.message, 'error'); return; }
      }
      await logAudit('create', 'products', pid, { name: form.name });
    }
    const { error: compDelError } = await supabase.from('product_components').delete().eq('product_id', pid);
    if (compDelError) { show(compDelError.message, 'error'); return; }
    if (form.product_type === 'manufactured' && productComponents.length > 0) {
      const { error: compInsError } = await supabase.from('product_components').insert(
        productComponents.map((c) => ({ product_id: pid, component_product_id: c.component_product_id, quantity: c.quantity }))
      );
      if (compInsError) { show(compInsError.message, 'error'); return; }
    }
    show(t('saveSuccess'), 'success');
    setModalOpen(false);
    reloadProducts();
  };

  const addComponentRow = () => {
    if (!componentSel) { show(t('required'), 'error'); return; }
    setProductComponents([...productComponents, { component_product_id: componentSel, quantity: componentQty > 0 ? componentQty : 1 }]);
    setComponentSel('');
    setComponentQty(1);
  };

  const updateComponentQty = (i: number, qty: number) =>
    setProductComponents(productComponents.map((c, idx) => (idx === i ? { ...c, quantity: qty > 0 ? qty : 1 } : c)));

  const removeComponentRow = (i: number) =>
    setProductComponents(productComponents.filter((_, idx) => idx !== i));

  const remove = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('products').delete().eq('id', deleteId);
    if (error) show(error.message, 'error');
    else { show(t('deleteSuccess'), 'success'); await logAudit('delete', 'products', deleteId); }
    setDeleteId(null);
    reloadProducts();
  };

  const handleExport = () => {
    exportToExcel(products.map(p => ({
      Name: p.name, NameEn: p.name_en || '', Barcode: p.barcode || '', SKU: p.sku || '',
      ProductType: p.product_type || 'ready',
      CostPrice: p.cost_price, SalePrice: p.sale_price, WholesalePrice: p.wholesale_price,
      Category: p.category?.name || '', Active: p.is_active, LowStockThreshold: p.low_stock_threshold,
      MinStock: p.min_stock ?? 0, MaxStock: p.max_stock ?? 0, ReorderPoint: p.reorder_point ?? 0,
    })), 'products');
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rows = await importFromExcel(file);
      const payload = rows.map((r) => ({
        name: String(r.Name || r.name || ''),
        name_en: String(r.NameEn || r.name_en || ''),
        barcode: String(r.Barcode || r.barcode || ''),
        sku: String(r.SKU || r.sku || ''),
        product_type: String(r.ProductType || r.product_type || 'ready') === 'manufactured' ? 'manufactured' as const : 'ready' as const,
        cost_price: Number(r.CostPrice || r.cost_price || 0),
        sale_price: Number(r.SalePrice || r.sale_price || 0),
        wholesale_price: Number(r.WholesalePrice || r.wholesale_price || 0),
        is_active: true,
        low_stock_threshold: Number(r.LowStockThreshold || 5),
        min_stock: Number(r.MinStock || r.min_stock || 0),
        max_stock: Number(r.MaxStock || r.max_stock || 0),
        reorder_point: Number(r.ReorderPoint || r.reorder_point || 0),
        branch_id: branchFilter || branches[0]?.id || null,
      })).filter(r => r.name);
      if (payload.length === 0) { show('No valid rows', 'error'); return; }
      const { error } = await supabase.from('products').insert(payload);
      if (error) show(error.message, 'error');
      else { show(`${payload.length} ${t('import')} OK`, 'success'); reloadProducts(); }
    } catch (err) {
      show(String(err), 'error');
    }
  };

  const showBarcode = (p: Product) => {
    setBarcodeModal(p);
    setTimeout(() => {
      if (barcodeCanvasRef.current) renderBarcode(barcodeCanvasRef.current, p.barcode || p.id);
    }, 100);
  };

  const showQR = async (p: Product) => {
    const url = await generateQRCodeDataURL(JSON.stringify({ id: p.id, name: p.name, barcode: p.barcode, price: p.sale_price }));
    setQrDataUrl(url);
    setQrModal(p.id);
  };

  const addUnit = () => setUnits([...units, { id: '', product_id: '', unit_name: 'box', unit_name_en: 'box', conversion_factor: 10, sale_price: 0, cost_price: 0, barcode: '', is_base: false, created_at: '' }]);
  const updateUnit = (i: number, field: keyof ProductUnit, value: string | number | boolean) => setUnits(units.map((u, idx) => idx === i ? { ...u, [field]: value } : u));
  const removeUnit = (i: number) => setUnits(units.filter((_, idx) => idx !== i));

  const columns: Column<Product>[] = [
    { key: 'name', header: t('productName'), render: (p) => (
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-lg bg-ui-page-alt flex items-center justify-center flex-shrink-0">
          {p.image_url ? <img src={p.image_url} alt="" className="w-full h-full rounded-lg object-cover" /> : <BarcodeIcon className="w-4 h-4 text-ui-subtle" />}
        </div>
        <div>
          <p className="font-medium text-ui-text">{p.name}</p>
          <p className="text-xs text-ui-subtle">{p.barcode || '-'}</p>
        </div>
        {p.product_type === 'manufactured' && (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">{t('manufactured')}</span>
        )}
      </div>
    )},
    { key: 'category', header: t('category'), render: (p) => p.category?.name || '-' },
    { key: 'cost_price', header: t('costPrice'), render: (p) => formatCurrency(p.cost_price, currency, lang) },
    { key: 'sale_price', header: t('salePrice'), render: (p) => <span className="font-semibold text-brand-600 dark:text-brand-400">{formatCurrency(p.sale_price, currency, lang)}</span> },
    { key: 'wholesale_price', header: t('wholesalePrice'), render: (p) => formatCurrency(p.wholesale_price, currency, lang) },
    { key: 'is_active', header: t('status'), render: (p) => (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${p.is_active ? 'bg-ui-success-soft text-ui-success' : 'bg-ui-page-alt text-ui-subtle dark:text-ui-subtle'}`}>
        {p.is_active ? t('active') : t('inactive')}
      </span>
    )},
    { key: 'actions', header: t('actions'), render: (p) => (
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => showBarcode(p)} className="p-1.5 rounded-md hover:bg-ui-page-alt dark:hover:bg-ui-page-alt text-ui-subtle" title={t('barcode')}><BarcodeIcon className="w-4 h-4" /></button>
        <button onClick={() => showQR(p)} className="p-1.5 rounded-md hover:bg-ui-page-alt dark:hover:bg-ui-page-alt text-ui-subtle" title={t('generateQR')}><QrCode className="w-4 h-4" /></button>
        {can('products.manage') && (
          <button onClick={() => openEdit(p)} className="p-1.5 rounded-md hover:bg-ui-info-soft text-ui-info" title={t('edit')}><Edit2 className="w-4 h-4" /></button>
        )}
        {can('products.manage') && (
          <button onClick={() => setDeleteId(p.id)} className="p-1.5 rounded-md hover:bg-ui-danger-soft text-ui-danger" title={t('delete')}><Trash2 className="w-4 h-4" /></button>
        )}
      </div>
    )},
  ];

  return (
    <DesignSurface testId="products-page">
      <DesignPageHeader
        title={t('products')}
        actions={
          <>
            {can('products.import') && (
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} data-testid="products-import" />
            )}
            {can('products.import') && (
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} data-testid="products-import-button"><Upload className="w-4 h-4" /> {t('importExcel')}</Button>
            )}
            {can('products.export') && (
              <Button variant="outline" size="sm" onClick={handleExport} data-testid="products-export"><Download className="w-4 h-4" /> {t('exportExcel')}</Button>
            )}
            {can('products.manage') && (
              <Button size="sm" onClick={openAdd} data-testid="products-add"><Plus className="w-4 h-4" /> {t('add')}</Button>
            )}
          </>
        }
      />

      <DesignPanel testId="products-search-panel">
        <DesignSearch value={search} onChange={setSearch} placeholder={t('search')} label={t('search')} testId="products-search" />
      </DesignPanel>

      <DesignPanel testId="products-table-panel">
        <DataTable columns={columns} data={filtered} loading={loading} emptyMessage={t('noData')} onRowClick={can('products.manage') ? openEdit : undefined} />
        <DesignPagination loaded={products.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
      </DesignPanel>

      {/* Add/Edit Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? t('edit') : t('add')} size="xl">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label={t('productName')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <Input label={t('nameEn')} value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} />
            <Input label={t('barcode')} value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
            <Input label={t('sku')} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
            <Select label={t('category')} value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
              <option value="">--</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <div>
              <label className="block text-sm font-medium text-ui-muted mb-1">{t('productType')}</label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setForm({ ...form, product_type: 'ready' })} className={`px-3 py-2.5 rounded-xl text-sm font-medium border transition-colors ${form.product_type === 'ready' ? 'bg-brand-600 text-white border-brand-600' : 'bg-ui-surface border-ui-border text-ui-text hover:border-brand-400'}`}>
                  {t('withoutIngredients')}
                </button>
                <button type="button" onClick={() => setForm({ ...form, product_type: 'manufactured' })} className={`px-3 py-2.5 rounded-xl text-sm font-medium border transition-colors ${form.product_type === 'manufactured' ? 'bg-purple-600 text-white border-purple-600' : 'bg-ui-surface border-ui-border text-ui-text hover:border-purple-400'}`}>
                  {t('withIngredients')}
                </button>
              </div>
            </div>
            {!branchFilter && (
              <Select label={t('branch')} value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
                <option value="">--</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            )}
            <Input label={t('image') + ' URL'} value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} />
            <Input label={t('costPrice')} type="number" step="0.01" value={form.cost_price || ''} onChange={(e) => setForm({ ...form, cost_price: parseFloat(e.target.value) || 0 })} />
            <Input label={t('salePrice')} type="number" step="0.01" value={form.sale_price || ''} onChange={(e) => setForm({ ...form, sale_price: parseFloat(e.target.value) || 0 })} />
            <Input label={t('wholesalePrice')} type="number" step="0.01" value={form.wholesale_price || ''} onChange={(e) => setForm({ ...form, wholesale_price: parseFloat(e.target.value) || 0 })} />
            <Input label={t('lowStockThreshold')} type="number" value={form.low_stock_threshold || ''} onChange={(e) => setForm({ ...form, low_stock_threshold: parseInt(e.target.value) || 0 })} />
            <Input label={t('minStock')} type="number" step="0.0001" value={form.min_stock || ''} onChange={(e) => setForm({ ...form, min_stock: parseFloat(e.target.value) || 0 })} />
            <Input label={t('maxStock')} type="number" step="0.0001" value={form.max_stock || ''} onChange={(e) => setForm({ ...form, max_stock: parseFloat(e.target.value) || 0 })} />
            <Input label={t('reorderPoint')} type="number" step="0.0001" value={form.reorder_point || ''} onChange={(e) => setForm({ ...form, reorder_point: parseFloat(e.target.value) || 0 })} />
          </div>
          <Textarea label={t('description')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />

          {/* Components (manufactured products) */}
          {form.product_type === 'manufactured' && (
            <div className="rounded-xl border border-purple-200 dark:border-purple-800/50 bg-purple-50/40 dark:bg-purple-900/10 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-ui-muted">{t('components')}</h3>
              </div>

              {productComponents.length === 0 && (
                <p className="text-sm text-ui-subtle dark:text-ui-subtle">{t('selectComponent')}</p>
              )}

              <div className="space-y-2">
                {productComponents.map((c, i) => {
                  const info = stockComponents.find((s) => s.product_id === c.component_product_id);
                  return (
                    <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-ui-surface border border-ui-border">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-ui-text truncate">{info?.name || c.component_product_id}</p>
                        <p className="text-xs text-ui-subtle">{t('availableStock')}: {formatNumber(info?.total || 0)}</p>
                      </div>
                      <Input label={t('usageQuantityPerUnit')} type="number" min={1} step="0.01" value={c.quantity || ''} onChange={(e) => updateComponentQty(i, parseFloat(e.target.value) || 1)} className="w-32" />
                      <button onClick={() => removeComponentRow(i)} className="p-2 rounded-md text-ui-danger hover:bg-ui-danger-soft"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  );
                })}
              </div>

              {stockComponents.length > 0 ? (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex-1 min-w-[200px]">
                    <Select label={t('addComponent')} value={componentSel} onChange={(e) => setComponentSel(e.target.value)}>
                      <option value="">--</option>
                      {availableToAdd.map((s) => (
                        <option key={s.product_id} value={s.product_id}>{s.name} ({formatNumber(s.total)})</option>
                      ))}
                    </Select>
                  </div>
                  <Input label={t('usageQuantityPerUnit')} type="number" min={1} step="0.01" value={componentQty || ''} onChange={(e) => setComponentQty(parseFloat(e.target.value) || 1)} className="w-32" />
                  <Button size="sm" onClick={addComponentRow}><Plus className="w-4 h-4" /> {t('addComponent')}</Button>
                </div>
              ) : (
                <p className="text-sm text-ui-warning">{t('noAvailableComponents')}</p>
              )}
            </div>
          )}

          {/* Units */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-ui-muted">{t('units')}</h3>
              <Button size="sm" variant="outline" onClick={addUnit}><Plus className="w-4 h-4" /> {t('add')}</Button>
            </div>
            <div className="space-y-2">
              {units.map((u, i) => (
                <div key={i} className="grid grid-cols-2 sm:grid-cols-6 gap-2 items-end p-2 rounded-lg bg-ui-page-alt">
                  <div>
                    <label className="text-xs text-ui-subtle">{t('unitName')}</label>
                    <select value={u.unit_name} onChange={(e) => updateUnit(i, 'unit_name', e.target.value)} className="w-full rounded-md border border-ui-border bg-ui-surface px-2 py-1.5 text-sm">
                      {UNIT_NAMES.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  <Input label={t('conversionFactor')} type="number" step="0.0001" value={u.conversion_factor || ''} onChange={(e) => updateUnit(i, 'conversion_factor', parseFloat(e.target.value) || 1)} />
                  <Input label={t('salePrice')} type="number" step="0.01" value={u.sale_price || ''} onChange={(e) => updateUnit(i, 'sale_price', parseFloat(e.target.value) || 0)} />
                  <Input label={t('costPrice')} type="number" step="0.01" value={u.cost_price || ''} onChange={(e) => updateUnit(i, 'cost_price', parseFloat(e.target.value) || 0)} />
                  <Input label={t('barcode')} value={u.barcode || ''} onChange={(e) => updateUnit(i, 'barcode', e.target.value)} />
                  <button onClick={() => removeUnit(i)} className="p-2 rounded-md text-ui-danger hover:bg-ui-danger-soft"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</Button>
            <Button onClick={save}>{t('save')}</Button>
          </div>
        </div>
      </Modal>

      {/* Barcode Modal */}
      <Modal open={!!barcodeModal} onClose={() => setBarcodeModal(null)} title={t('barcode')} size="sm">
        {barcodeModal && (
          <div className="flex flex-col items-center gap-4">
            <p className="font-medium text-ui-text">{barcodeModal.name}</p>
            <canvas ref={barcodeCanvasRef} className="rounded-lg bg-ui-surface p-2" />
            <Button variant="outline" onClick={() => window.print()}><BarcodeIcon className="w-4 h-4" /> {t('print')}</Button>
          </div>
        )}
      </Modal>

      {/* QR Modal */}
      <Modal open={!!qrModal} onClose={() => setQrModal(null)} title={t('generateQR')} size="sm">
        {qrDataUrl && (
          <div className="flex flex-col items-center gap-4">
            <img src={qrDataUrl} alt="QR Code" className="w-48 h-48 rounded-lg" />
            <Button variant="outline" onClick={() => window.print()}><QrCode className="w-4 h-4" /> {t('print')}</Button>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={remove}
        title={t('delete')}
        message={t('confirmDelete')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
      />
    </DesignSurface>
  );
}