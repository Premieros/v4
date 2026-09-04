import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Edit2, Trash2, Download, Upload, Barcode as BarcodeIcon, QrCode, Layers, Package } from 'lucide-react';
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
import { renderBarcode, generateQRCodeDataURL } from '@/lib/barcode';
import { logAudit } from '@/lib/audit';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import { useSettings } from '@/context/SettingsContext';
import { APP_ROUTES } from '@/core/navigation/routes';
import { useUserBranches } from '@/hooks/useUserBranches';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import type { Product, Category } from '@/lib/types';

const EMPTY_FORM = {
  name: '',
  name_en: '',
  barcode: '',
  sku: '',
  category_id: '',
  description: '',
  cost_price: 0,
  sale_price: 0,
  wholesale_price: 0,
  image_url: '',
  is_active: true,
  low_stock_threshold: 5,
  min_stock: 0,
  max_stock: 0,
  reorder_point: 0,
  product_type: 'ready' as 'ready' | 'manufactured',
  branch_id: '',
};

export function ProductsPage() {
  const navigate = useNavigate();
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';
  const { show } = useToast();
  const can = useCan();
  const branchFilter = useBranchFilter();
  const { accessibleBranches, activeBranchId } = useUserBranches();
  const { effectiveSettings } = useSettings();
  const currency = effectiveSettings(branchFilter)?.currency || 'EGP';

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
  const [qrModal, setQrModal] = useState<Product | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const fileRef = useRef<HTMLInputElement>(null);
  const barcodeCanvasRef = useRef<HTMLCanvasElement>(null);

  const branchMap = useMemo(
    () => new Map(accessibleBranches.map((branch) => [branch.id, branch.name])),
    [accessibleBranches]
  );

  useEffect(() => {
    void (async () => {
      let query = supabase.from('categories').select('*').order('name');
      if (branchFilter) query = query.eq('branch_id', branchFilter);
      const { data, error } = await query;
      if (error) {
        setCategories([]);
        return;
      }
      setCategories((data as Category[]) || []);
    })();
  }, [branchFilter]);

  const filtered = products.filter((product) => {
    if (!search) return true;
    const needle = search.toLowerCase();
    return product.name.toLowerCase().includes(needle)
      || product.name_en?.toLowerCase().includes(needle)
      || product.barcode?.includes(search)
      || product.sku?.toLowerCase().includes(needle);
  });

  const openAdd = () => navigate(`${APP_ROUTES.products}/setup`);

  const openEdit = (product: Product) => {
    if (!can('products.manage')) return;
    setEditing(product);
    setForm({
      name: product.name,
      name_en: product.name_en || '',
      barcode: product.barcode || '',
      sku: product.sku || '',
      category_id: product.category_id || '',
      description: product.description || '',
      cost_price: Number(product.cost_price) || 0,
      sale_price: Number(product.sale_price) || 0,
      wholesale_price: Number(product.wholesale_price) || 0,
      image_url: product.image_url || '',
      is_active: product.is_active,
      low_stock_threshold: Number(product.low_stock_threshold) || 0,
      min_stock: Number(product.min_stock) || 0,
      max_stock: Number(product.max_stock) || 0,
      reorder_point: Number(product.reorder_point) || 0,
      product_type: product.product_type || 'ready',
      branch_id: product.branch_id,
    });
    setModalOpen(true);
  };

  const save = async () => {
    if (!editing || !can('products.manage')) return;
    if (!form.name.trim()) {
      show(t('required') + ': ' + t('name'), 'error');
      return;
    }
    if (!form.branch_id || !accessibleBranches.some((branch) => branch.id === form.branch_id)) {
      show(isAr ? 'لا يمكن تعديل منتج خارج الفروع الممنوحة لك' : 'You cannot edit a product outside your granted branches', 'error');
      return;
    }

    const allowedCategories = categories.filter((category) => category.branch_id === form.branch_id);
    if (form.category_id && !allowedCategories.some((category) => category.id === form.category_id)) {
      show(isAr ? 'التصنيف لا ينتمي إلى فرع المنتج' : 'The category does not belong to the product branch', 'error');
      return;
    }

    const payload = {
      name: form.name.trim(),
      name_en: form.name_en.trim() || null,
      barcode: form.barcode.trim() || null,
      sku: form.sku.trim() || null,
      category_id: form.category_id || null,
      description: form.description.trim() || null,
      cost_price: Number(form.cost_price) || 0,
      sale_price: Number(form.sale_price) || 0,
      wholesale_price: Number(form.wholesale_price) || 0,
      image_url: form.image_url.trim() || null,
      is_active: form.is_active,
      low_stock_threshold: Number(form.low_stock_threshold) || 0,
      min_stock: Number(form.min_stock) || 0,
      max_stock: Number(form.max_stock) || 0,
      reorder_point: Number(form.reorder_point) || 0,
      product_type: form.product_type,
    };

    // Product editing changes the product entity only. Unit links, recipes and
    // components are deliberately managed by their dedicated modules.
    const { error } = await supabase.from('products').update(payload).eq('id', editing.id).eq('branch_id', form.branch_id);
    if (error) {
      show(error.message, 'error');
      return;
    }

    await logAudit('update', 'products', editing.id, { name: payload.name, branch_id: form.branch_id });
    show(t('saveSuccess'), 'success');
    setModalOpen(false);
    setEditing(null);
    await reloadProducts();
  };

  const remove = async () => {
    if (!deleteId || !can('products.manage')) return;
    const product = products.find((item) => item.id === deleteId);
    if (!product || !accessibleBranches.some((branch) => branch.id === product.branch_id)) {
      show(isAr ? 'لا يمكن حذف منتج خارج الفروع الممنوحة لك' : 'You cannot delete a product outside your granted branches', 'error');
      setDeleteId(null);
      return;
    }

    const { error } = await supabase.from('products').delete().eq('id', deleteId).eq('branch_id', product.branch_id);
    if (error) show(error.message, 'error');
    else {
      show(t('deleteSuccess'), 'success');
      await logAudit('delete', 'products', deleteId, { branch_id: product.branch_id });
    }
    setDeleteId(null);
    await reloadProducts();
  };

  const handleExport = () => {
    exportToExcel(products.map((product) => ({
      Name: product.name,
      NameEn: product.name_en || '',
      Barcode: product.barcode || '',
      SKU: product.sku || '',
      ProductType: product.product_type || 'ready',
      CostPrice: product.cost_price,
      SalePrice: product.sale_price,
      WholesalePrice: product.wholesale_price,
      Category: product.category?.name || '',
      Branch: branchMap.get(product.branch_id) || '',
      Active: product.is_active,
      LowStockThreshold: product.low_stock_threshold,
      MinStock: product.min_stock ?? 0,
      MaxStock: product.max_stock ?? 0,
      ReorderPoint: product.reorder_point ?? 0,
    })), 'products');
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !can('products.import')) return;

    const targetBranchId = branchFilter || activeBranchId;
    if (!targetBranchId || !accessibleBranches.some((branch) => branch.id === targetBranchId)) {
      show(isAr ? 'اختر فرعًا مسموحًا قبل الاستيراد' : 'Select an allowed branch before importing', 'error');
      return;
    }

    try {
      const rows = await importFromExcel(file);
      const payload = rows.map((row) => ({
        name: String(row.Name || row.name || '').trim(),
        name_en: String(row.NameEn || row.name_en || '').trim() || null,
        barcode: String(row.Barcode || row.barcode || '').trim() || null,
        sku: String(row.SKU || row.sku || '').trim() || null,
        product_type: String(row.ProductType || row.product_type || 'ready') === 'manufactured' ? 'manufactured' as const : 'ready' as const,
        cost_price: Number(row.CostPrice || row.cost_price || 0),
        sale_price: Number(row.SalePrice || row.sale_price || 0),
        wholesale_price: Number(row.WholesalePrice || row.wholesale_price || 0),
        is_active: true,
        low_stock_threshold: Number(row.LowStockThreshold || 5),
        min_stock: Number(row.MinStock || row.min_stock || 0),
        max_stock: Number(row.MaxStock || row.max_stock || 0),
        reorder_point: Number(row.ReorderPoint || row.reorder_point || 0),
        branch_id: targetBranchId,
      })).filter((row) => row.name);

      if (payload.length === 0) {
        show(isAr ? 'لا توجد صفوف صالحة للاستيراد' : 'No valid rows to import', 'error');
        return;
      }

      const { error } = await supabase.from('products').insert(payload);
      if (error) {
        show(error.message, 'error');
        return;
      }

      await logAudit('import', 'products', undefined, { count: payload.length, branch_id: targetBranchId });
      show(`${payload.length} ${t('import')} OK`, 'success');
      await reloadProducts();
    } catch (error) {
      show(error instanceof Error ? error.message : String(error), 'error');
    }
  };

  const showBarcode = (product: Product) => {
    setBarcodeModal(product);
    setTimeout(() => {
      if (barcodeCanvasRef.current) renderBarcode(barcodeCanvasRef.current, product.barcode || product.id);
    }, 100);
  };

  const showQR = async (product: Product) => {
    setQrDataUrl(await generateQRCodeDataURL(JSON.stringify({
      id: product.id,
      name: product.name,
      barcode: product.barcode,
      price: product.sale_price,
    })));
    setQrModal(product);
  };

  const columns: Column<Product>[] = [
    {
      key: 'name',
      header: t('productName'),
      render: (product) => (
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-ui-page-alt flex items-center justify-center flex-shrink-0 overflow-hidden">
            {product.image_url
              ? <img src={product.image_url} alt="" className="w-full h-full object-cover" />
              : <Package className="w-4 h-4 text-ui-subtle" />}
          </div>
          <div className="min-w-0">
            <p className="font-medium text-ui-text truncate">{product.name}</p>
            <p className="text-xs text-ui-subtle">{product.barcode || '-'}</p>
          </div>
        </div>
      ),
    },
    { key: 'category', header: t('category'), render: (product) => product.category?.name || '-' },
    { key: 'branch', header: t('branch'), render: (product) => branchMap.get(product.branch_id) || '-' },
    { key: 'cost_price', header: t('costPrice'), render: (product) => formatCurrency(product.cost_price, currency, lang) },
    { key: 'sale_price', header: t('salePrice'), render: (product) => <span className="font-semibold text-brand-600 dark:text-brand-400">{formatCurrency(product.sale_price, currency, lang)}</span> },
    {
      key: 'is_active',
      header: t('status'),
      render: (product) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${product.is_active ? 'bg-ui-success-soft text-ui-success' : 'bg-ui-page-alt text-ui-subtle'}`}>
          {product.is_active ? t('active') : t('inactive')}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('actions'),
      render: (product) => (
        <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
          <button onClick={() => showBarcode(product)} className="p-1.5 rounded-md hover:bg-ui-page-alt text-ui-subtle" title={t('barcode')}><BarcodeIcon className="w-4 h-4" /></button>
          <button onClick={() => void showQR(product)} className="p-1.5 rounded-md hover:bg-ui-page-alt text-ui-subtle" title={t('generateQR')}><QrCode className="w-4 h-4" /></button>
          {can('products.manage') && <button onClick={() => openEdit(product)} className="p-1.5 rounded-md hover:bg-ui-info-soft text-ui-info" title={t('edit')}><Edit2 className="w-4 h-4" /></button>}
          {can('products.manage') && <button onClick={() => setDeleteId(product.id)} className="p-1.5 rounded-md hover:bg-ui-danger-soft text-ui-danger" title={t('delete')}><Trash2 className="w-4 h-4" /></button>}
        </div>
      ),
    },
  ];

  const editCategories = categories.filter((category) => category.branch_id === form.branch_id);

  return (
    <DesignSurface testId="products-page">
      <DesignPageHeader
        title={t('products')}
        subtitle={isAr ? 'إدارة بيانات المنتجات فقط؛ الوحدات والمكونات مستقلة.' : 'Manage product data only; units and components are independent.'}
        actions={
          <>
            {can('raw_materials.view') && (
              <Button variant="outline" size="sm" onClick={() => navigate(APP_ROUTES.inventoryUnits)}>
                <Package className="w-4 h-4" /> {isAr ? 'الوحدات' : 'Units'}
              </Button>
            )}
            {can('components.view') && (
              <Button variant="outline" size="sm" onClick={() => navigate(APP_ROUTES.components)}>
                <Layers className="w-4 h-4" /> {t('components')}
              </Button>
            )}
            {can('products.import') && <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} data-testid="products-import" />}
            {can('products.import') && <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} data-testid="products-import-button"><Upload className="w-4 h-4" /> {t('importExcel')}</Button>}
            {can('products.export') && <Button variant="outline" size="sm" onClick={handleExport} data-testid="products-export"><Download className="w-4 h-4" /> {t('exportExcel')}</Button>}
            {can('products.manage') && <Button size="sm" onClick={openAdd} data-testid="products-add"><Plus className="w-4 h-4" /> {t('add')}</Button>}
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

      <Modal open={modalOpen} onClose={() => { setModalOpen(false); setEditing(null); }} title={t('edit')} size="lg">
        <div className="space-y-4 max-h-[75vh] overflow-y-auto">
          <div className="rounded-xl border border-ui-border bg-ui-page-alt p-3 text-sm text-ui-muted">
            {isAr ? 'هذه النافذة تعدّل المنتج فقط. لا يتم إنشاء أو حذف وحدات أو مكونات أو وصفات هنا.' : 'This dialog edits the product only. It never creates or deletes units, components or recipes.'}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label={t('productName')} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
            <Input label={t('nameEn')} value={form.name_en} onChange={(event) => setForm({ ...form, name_en: event.target.value })} />
            <Input label={t('barcode')} value={form.barcode} onChange={(event) => setForm({ ...form, barcode: event.target.value })} />
            <Input label={t('sku')} value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} />
            <Select label={t('category')} value={form.category_id} onChange={(event) => setForm({ ...form, category_id: event.target.value })}>
              <option value="">--</option>
              {editCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </Select>
            <Select label={isAr ? 'نوع المنتج' : 'Product type'} value={form.product_type} onChange={(event) => setForm({ ...form, product_type: event.target.value as 'ready' | 'manufactured' })}>
              <option value="ready">{isAr ? 'جاهز' : 'Ready'}</option>
              <option value="manufactured">{isAr ? 'مصنّع' : 'Manufactured'}</option>
            </Select>
            <Input label={t('branch')} value={branchMap.get(form.branch_id) || form.branch_id} disabled />
            <Input label={t('image') + ' URL'} value={form.image_url} onChange={(event) => setForm({ ...form, image_url: event.target.value })} />
            <Input label={t('costPrice')} type="number" step="0.01" value={form.cost_price || ''} onChange={(event) => setForm({ ...form, cost_price: Number(event.target.value) || 0 })} />
            <Input label={t('salePrice')} type="number" step="0.01" value={form.sale_price || ''} onChange={(event) => setForm({ ...form, sale_price: Number(event.target.value) || 0 })} />
            <Input label={t('wholesalePrice')} type="number" step="0.01" value={form.wholesale_price || ''} onChange={(event) => setForm({ ...form, wholesale_price: Number(event.target.value) || 0 })} />
            <Input label={t('lowStockThreshold')} type="number" min="0" value={form.low_stock_threshold} onChange={(event) => setForm({ ...form, low_stock_threshold: Number(event.target.value) || 0 })} />
            <Input label={t('minStock')} type="number" min="0" step="0.0001" value={form.min_stock} onChange={(event) => setForm({ ...form, min_stock: Number(event.target.value) || 0 })} />
            <Input label={t('maxStock')} type="number" min="0" step="0.0001" value={form.max_stock} onChange={(event) => setForm({ ...form, max_stock: Number(event.target.value) || 0 })} />
            <Input label={t('reorderPoint')} type="number" min="0" step="0.0001" value={form.reorder_point} onChange={(event) => setForm({ ...form, reorder_point: Number(event.target.value) || 0 })} />
          </div>

          <Textarea label={t('description')} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={3} />

          <label className="flex items-center gap-2 text-sm text-ui-text">
            <input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} />
            {t('active')}
          </label>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setModalOpen(false); setEditing(null); }}>{t('cancel')}</Button>
            <Button onClick={save}>{t('save')}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!barcodeModal} onClose={() => setBarcodeModal(null)} title={barcodeModal?.name || t('barcode')} size="sm">
        <div className="flex justify-center p-4"><canvas ref={barcodeCanvasRef} /></div>
      </Modal>

      <Modal open={!!qrModal} onClose={() => { setQrModal(null); setQrDataUrl(''); }} title={qrModal?.name || t('generateQR')} size="sm">
        <div className="flex justify-center p-4">{qrDataUrl && <img src={qrDataUrl} alt="QR" className="w-56 h-56" />}</div>
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
