import { useEffect, useState } from 'react';
import { Plus, Trash2, Package, Edit2, AlertTriangle, Layers } from 'lucide-react';
import { supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { useCan } from '@/lib/permissions';
import { useSettings } from '@/context/SettingsContext';
import { DesignSurface, DesignPageHeader, DesignPanel } from '@/components/design';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatCurrency, formatNumber } from '@/lib/format';
import { logAudit } from '@/lib/audit';
import type { Product, ProductComponent } from '@/lib/types';

interface ComponentWithProduct extends ProductComponent {
  component_product?: Product;
}

export function ComponentsPage() {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';
  const { show } = useToast();
  const can = useCan();
  const { effectiveSettings } = useSettings();
  const currency = effectiveSettings()?.currency || 'EGP';
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [components, setComponents] = useState<ComponentWithProduct[]>([]);
  const [inventoryMap, setInventoryMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editModal, setEditModal] = useState<{ id: string; quantity: number } | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({ component_product_id: '', quantity: 1 });

  const manufacturedProducts = products.filter((p) => p.product_type === 'manufactured');

  const availableComponents = manufacturedProducts.filter(
    (p) => p.id !== selectedProductId && !components.some((c) => c.component_product_id === p.id)
  );

  async function loadProducts() {
    const { data: p } = await supabase.from('products').select('*').eq('is_active', true).order('name');
    setProducts((p as Product[]) || []);
    const { data: inv } = await supabase.from('inventory').select('product_id, quantity');
    const map: Record<string, number> = {};
    for (const r of (inv || []) as { product_id: string; quantity: number }[]) {
      map[r.product_id] = (map[r.product_id] || 0) + Number(r.quantity);
    }
    setInventoryMap(map);
    setLoading(false);
  }

  async function loadComponents(productId: string) {
    if (!productId) { setComponents([]); return; }
    const { data } = await supabase
      .from('product_components')
      .select('*, component_product:products(*)')
      .eq('product_id', productId)
      .order('created_at');
    setComponents((data as ComponentWithProduct[]) || []);
  }

  useEffect(() => { loadProducts(); }, []);
  useEffect(() => { if (selectedProductId) loadComponents(selectedProductId); }, [selectedProductId]);

  const addComponent = async () => {
    if (!selectedProductId || !form.component_product_id) { show(t('required'), 'error'); return; }
    if (form.quantity <= 0) { show(t('required'), 'error'); return; }
    const { error } = await supabase.from('product_components').insert({
      product_id: selectedProductId,
      component_product_id: form.component_product_id,
      quantity: form.quantity,
    });
    if (error) { show(error.message, 'error'); return; }
    await logAudit('create', 'product_components', undefined, { product_id: selectedProductId });
    show(t('saveSuccess'), 'success');
    setModalOpen(false);
    setForm({ component_product_id: '', quantity: 1 });
    loadComponents(selectedProductId);
  };

  const removeComponent = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('product_components').delete().eq('id', deleteId);
    if (error) show(error.message, 'error');
    else { show(t('deleteSuccess'), 'success'); await logAudit('delete', 'product_components', deleteId); }
    setDeleteId(null);
    loadComponents(selectedProductId);
  };

  const saveEditQty = async () => {
    if (!editModal) return;
    if (editModal.quantity <= 0) { show(t('required'), 'error'); return; }
    const { error } = await supabase.from('product_components').update({ quantity: editModal.quantity }).eq('id', editModal.id);
    if (error) { show(error.message, 'error'); return; }
    await logAudit('update', 'product_components', editModal.id, { quantity: editModal.quantity });
    show(t('saveSuccess'), 'success');
    setEditModal(null);
    loadComponents(selectedProductId);
  };

  const selectedProduct = products.find((p) => p.id === selectedProductId);
  const componentCost = components.reduce((sum, c) => {
    const price = c.component_product?.cost_price || 0;
    return sum + price * Number(c.quantity);
  }, 0);

  return (
    <DesignSurface testId="components-page">
      <DesignPageHeader title={t('components')} />

      <DesignPanel testId="components-panel">
        <div className="mb-4">
          <Select
            label={t('manufacturedOnly')}
            value={selectedProductId}
            onChange={(e) => setSelectedProductId(e.target.value)}
          >
            <option value="">-- {isAr ? 'اختر منتج مصنّع' : 'Select manufactured product'} --</option>
            {manufacturedProducts.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({formatCurrency(p.cost_price, currency, lang)})</option>
            ))}
          </Select>
        </div>

        {!loading && selectedProductId && (
          <>
            {components.length === 0 && (
              <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-ui-warning-soft border border-ui-warning/20  text-ui-warning text-sm">
                <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                <p>{isAr ? 'هذا المنتج مصنّع لكن لا توجد له وصفة — لن يمكن بيعه حتى تُضيف مكوناته.' : 'This product is manufactured but has no recipe — it cannot be sold until components are added.'}</p>
              </div>
            )}

            {/* Product info */}
            {selectedProduct && (
              <div className="flex items-center gap-4 mb-4 p-3 bg-ui-page-alt rounded-lg">
                <div className="w-10 h-10 rounded-lg bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center">
                  <Package className="w-5 h-5 text-brand-600 dark:text-brand-400" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-ui-text">{selectedProduct.name}</p>
                  <p className="text-xs text-ui-subtle">{isAr ? 'سعر البيع' : 'Sale Price'}: {formatCurrency(selectedProduct.sale_price, currency, lang)} | {isAr ? 'التكلفة' : 'Cost'}: {formatCurrency(selectedProduct.cost_price, currency, lang)}</p>
                </div>
                <div className="text-end">
                  <p className="text-xs text-ui-subtle">{isAr ? 'تكلفة المكونات' : 'Component Cost'}</p>
                  <p className={`font-bold ${componentCost > selectedProduct.sale_price ? 'text-ui-danger' : 'text-brand-600'}`}>
                    {formatCurrency(componentCost, currency, lang)}
                  </p>
                </div>
              </div>
            )}

            {/* Add button */}
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-ui-muted">
                {isAr ? 'المكونات' : 'Components'} ({components.length})
              </h3>
              <Button onClick={() => { setForm({ component_product_id: '', quantity: 1 }); setModalOpen(true); }} disabled={!availableComponents.length || !can('components.manage')}>
                <Plus className="w-4 h-4" /> {t('addComponent')}
              </Button>
            </div>

            {/* Components list */}
            {components.length === 0 ? (
              <div className="text-center py-12 text-ui-subtle">
                <Package className="w-12 h-12 mx-auto mb-2 opacity-30" />
                <p className="text-sm">{t('noComponents')}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {components.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 p-3 bg-ui-surface rounded-lg border border-ui-border">
                    <div className="w-10 h-10 rounded-lg bg-ui-page-alt flex items-center justify-center overflow-hidden">
                      {c.component_product?.image_url ? (
                        <img src={c.component_product.image_url} className="w-full h-full object-cover" alt="" />
                      ) : (
                        <Package className="w-5 h-5 text-ui-subtle" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ui-text truncate">{c.component_product?.name || '-'}</p>
                      <p className="text-xs text-ui-subtle">{formatCurrency(c.component_product?.cost_price || 0, currency, lang)} × {c.quantity}</p>
                    </div>
                    <div className="flex items-center gap-1 text-xs" title={t('componentStock')}>
                      <Layers className="w-3.5 h-3.5 text-ui-subtle" />
                      <span className={inventoryMap[c.component_product_id] > 0 ? 'text-brand-600 dark:text-brand-400 font-semibold' : 'text-ui-danger font-semibold'}>
                        {formatNumber(inventoryMap[c.component_product_id] || 0)}
                      </span>
                    </div>
                    <span className="text-sm font-bold text-brand-600 dark:text-brand-400">
                      {formatCurrency((c.component_product?.cost_price || 0) * Number(c.quantity), currency, lang)}
                    </span>
                    {can('components.manage') && (
                      <button onClick={() => setEditModal({ id: c.id, quantity: Number(c.quantity) })} className="p-2 text-ui-subtle hover:text-ui-info">
                        <Edit2 className="w-4 h-4" />
                      </button>
                    )}
                    {can('components.manage') && (
                      <button onClick={() => setDeleteId(c.id)} className="p-2 text-ui-subtle hover:text-ui-danger">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {!loading && !selectedProductId && (
          <div className="text-center py-16 text-ui-subtle">
            <Package className="w-16 h-16 mx-auto mb-3 opacity-30" />
            <p className="text-sm">{isAr ? 'اختر منتجاً مصنّعاً لإدارة مكوناته' : 'Select a manufactured product to manage its components'}</p>
          </div>
        )}
      </DesignPanel>

      {/* Edit Quantity Modal */}
      <Modal open={!!editModal} onClose={() => setEditModal(null)} title={t('editComponentQty')} size="sm">
        {editModal && (
          <div className="space-y-4">
            <Input
              label={t('componentQuantity')}
              type="number"
              value={editModal.quantity}
              onChange={(e) => setEditModal({ ...editModal, quantity: parseFloat(e.target.value) || 1 })}
              min={0.001}
            />
            <Button className="w-full" onClick={saveEditQty}>{t('save')}</Button>
          </div>
        )}
      </Modal>

      {/* Add Component Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={t('addComponent')} size="sm">
        <div className="space-y-4">
          <Select
            label={t('componentProduct')}
            value={form.component_product_id}
            onChange={(e) => setForm({ ...form, component_product_id: e.target.value })}
          >
            <option value="">-- {t('selectComponentProduct')} --</option>
            {availableComponents.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({formatCurrency(p.cost_price, currency, lang)})</option>
            ))}
          </Select>
          <Input
            label={t('componentQuantity')}
            type="number"
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: parseFloat(e.target.value) || 1 })}
            min={0.001}
          />
          <Button className="w-full" onClick={addComponent}>{t('save')}</Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={removeComponent}
        title={t('delete')}
        message={isAr ? 'هل أنت متأكد من حذف هذا المكون؟' : 'Are you sure you want to delete this component?'}
      />
    </DesignSurface>
  );
}
