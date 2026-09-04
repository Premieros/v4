import { useEffect, useMemo, useState } from 'react';
import { Plus, Edit2, Trash2, ChefHat, Calculator } from 'lucide-react';
import { supabase } from '@/api';
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
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatCurrency, formatNumber } from '@/lib/format';
import { logAudit } from '@/lib/audit';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import type { Recipe, RawMaterial, Product, Branch } from '@/lib/types';

interface ItemForm {
  item_type: 'raw_material' | 'inventory_unit';
  raw_material_id: string;
  inventory_unit_id: string;
  quantity: number;
  wastage_percent: number;
}

const EMPTY_ITEM: ItemForm = {
  item_type: 'raw_material',
  raw_material_id: '',
  inventory_unit_id: '',
  quantity: 1,
  wastage_percent: 0,
};

export function RecipesPage() {
  const { t, lang } = useLanguage();
  const { show } = useToast();
  const can = useCan();
  const { user } = useAuth();
  const branchFilter = useBranchFilter();
  const isAr = lang === 'ar';

  const { rows: recipes, loading, error, total, hasMore, loadMore, loadingMore, refresh: reloadRecipes } = usePaginatedRows<Recipe>({
    table: 'recipes',
    select: '*, product:products(*), branch:branches(*)',
    order: { column: 'created_at', ascending: false },
    pageSize: 100,
  });
  const [products, setProducts] = useState<Product[]>([]);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [units, setUnits] = useState<{ id: string; name: string; cost_price: number }[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [search, setSearch] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Recipe | null>(null);
  const [form, setForm] = useState({
    product_id: '',
    branch_id: '',
    name: '',
    yield_quantity: 1,
    notes: '',
    is_active: true,
  });
  const [items, setItems] = useState<ItemForm[]>([{ ...EMPTY_ITEM }]);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  async function loadMeta() {
    const [pr, m, u, br] = await Promise.all([
      supabase.from('products').select('*').eq('product_type', 'manufactured').eq('is_active', true).order('name'),
      supabase.from('raw_materials').select('*').eq('is_active', true).order('name'),
      supabase.from('inventory_units').select('id, name, cost_price').eq('is_active', true).order('name'),
      supabase.from('branches').select('*').eq('is_active', true).order('name'),
    ]);
    setProducts((pr.data as Product[]) || []);
    setMaterials((m.data as RawMaterial[]) || []);
    setUnits((u.data as { id: string; name: string; cost_price: number }[]) || []);
    setBranches((br.data as Branch[]) || []);
  }
  useEffect(() => { loadMeta(); }, []);

  const filtered = recipes.filter((rc) => {
    if (branchFilter && rc.branch_id !== branchFilter) return false;
    if (!search) return true;
    return (rc.product?.name || '').toLowerCase().includes(search.toLowerCase()) || (rc.name || '').toLowerCase().includes(search.toLowerCase());
  });

  const openAdd = () => {
    setEditing(null);
    setForm({ product_id: '', branch_id: user?.branch_id || branchFilter || '', name: '', yield_quantity: 1, notes: '', is_active: true });
    setItems([{ ...EMPTY_ITEM }]);
    setModalOpen(true);
  };

  const openEdit = async (rc: Recipe) => {
    const { data } = await supabase.from('recipe_items')
      .select('*, raw_material:raw_materials(*), inventory_unit:inventory_units(*)')
      .eq('recipe_id', rc.id)
      .order('created_at');
    setEditing(rc);
    setForm({
      product_id: rc.product_id, branch_id: rc.branch_id, name: rc.name || '',
      yield_quantity: Number(rc.yield_quantity), notes: rc.notes || '', is_active: rc.is_active,
    });
    const fetched = ((data as unknown as { raw_material_id?: string; inventory_unit_id?: string; quantity: number; wastage_percent: number }[]) || []).map((it) => ({
      item_type: it.inventory_unit_id ? ('inventory_unit' as const) : ('raw_material' as const),
      raw_material_id: it.raw_material_id || '',
      inventory_unit_id: it.inventory_unit_id || '',
      quantity: Number(it.quantity),
      wastage_percent: Number(it.wastage_percent),
    }));
    setItems(fetched.length ? fetched : [{ ...EMPTY_ITEM }]);
    setModalOpen(true);
  };

  const addLine = () => setItems([...items, { ...EMPTY_ITEM }]);
  const updateLine = (i: number, field: keyof ItemForm, value: string | number) =>
    setItems(items.map((it, idx) => idx === i ? { ...it, [field]: value } : it));
  const removeLine = (i: number) => setItems(items.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!form.product_id) { show(t('required') + ': ' + t('selectProduct'), 'error'); return; }
    if (!form.branch_id) { show(t('required') + ': ' + t('branch'), 'error'); return; }
    const validItems = items.filter((it) => (it.raw_material_id || it.inventory_unit_id) && it.quantity > 0);
    if (validItems.length === 0) { show(t('required') + ': ' + t('recipeItems'), 'error'); return; }

    const payload = {
      product_id: form.product_id,
      branch_id: form.branch_id,
      name: form.name.trim() || null,
      yield_quantity: form.yield_quantity,
      notes: form.notes.trim() || null,
      is_active: form.is_active,
    };
    const itemRows = validItems.map((it) => ({
      raw_material_id: it.item_type === 'raw_material' ? (it.raw_material_id || null) : null,
      inventory_unit_id: it.item_type === 'inventory_unit' ? (it.inventory_unit_id || null) : null,
      quantity: it.quantity,
      wastage_percent: it.wastage_percent,
    }));

    if (editing) {
      const { error } = await supabase.from('recipes').update(payload).eq('id', editing.id);
      if (error) { show(error.message, 'error'); return; }
      const { error: delErr } = await supabase.from('recipe_items').delete().eq('recipe_id', editing.id);
      if (delErr) { show(delErr.message, 'error'); return; }
      if (itemRows.length > 0) {
        const { error: insErr } = await supabase.from('recipe_items').insert(itemRows.map((it) => ({ ...it, recipe_id: editing.id })));
        if (insErr) { show(insErr.message, 'error'); return; }
      }
      await logAudit('update', 'recipes', editing.id);
    } else {
      const { data, error } = await supabase.from('recipes').insert(payload).select().single();
      if (error) { show(error.message, 'error'); return; }
      const recipeId = (data as Recipe).id;
      const { error: insErr } = await supabase.from('recipe_items').insert(itemRows.map((it) => ({ ...it, recipe_id: recipeId })));
      if (insErr) { show(insErr.message, 'error'); return; }
      await logAudit('create', 'recipes', recipeId);
    }
    show(t('saveSuccess'), 'success');
    setModalOpen(false);
    reloadRecipes();
  };

  const remove = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('recipes').delete().eq('id', deleteId);
    if (error) show(error.message, 'error');
    else { show(t('deleteSuccess'), 'success'); await logAudit('delete', 'recipes', deleteId); }
    setDeleteId(null);
    reloadRecipes();
  };

  const calculatedCost = useMemo(() => {
    const rawCost = items.reduce((sum, it) => {
      let unitCost = 0;
      if (it.item_type === 'raw_material') {
        const mat = materials.find((m) => m.id === it.raw_material_id);
        unitCost = Number(mat?.default_cost || 0);
      } else {
        const u = units.find((un) => un.id === it.inventory_unit_id);
        unitCost = Number(u?.cost_price || 0);
      }
      if (!it.quantity || unitCost <= 0) return sum;
      const wastageMultiplier = 1 + (Number(it.wastage_percent || 0) / 100);
      return sum + (unitCost * Number(it.quantity) * wastageMultiplier);
    }, 0);
    const yieldQty = Math.max(1, Number(form.yield_quantity || 1));
    const costPerUnit = rawCost / yieldQty;
    const selectedProd = products.find((p) => p.id === form.product_id);
    const sellPrice = Number(selectedProd?.sale_price || 0);
    const foodCostRatio = sellPrice > 0 ? (costPerUnit / sellPrice) * 100 : 0;
    const margin = sellPrice > 0 ? ((sellPrice - costPerUnit) / sellPrice) * 100 : 0;
    return { rawCost, costPerUnit, sellPrice, foodCostRatio, margin };
  }, [items, materials, units, form.yield_quantity, form.product_id, products]);

  const columns: Column<Recipe>[] = [
    { key: 'product', header: t('product'), render: (rc) => (
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-xs font-bold text-purple-600 dark:text-purple-400">
          <ChefHat className="w-4 h-4" />
        </div>
        <div>
          <p className="font-medium text-ui-text">{rc.product?.name || '-'}</p>
          {rc.name && <p className="text-xs text-ui-subtle">{rc.name}</p>}
        </div>
      </div>
    )},
    { key: 'branch', header: t('branch'), render: (rc) => rc.branch?.name || '-' },
    { key: 'yield', header: t('yieldQuantity'), render: (rc) => formatNumber(Number(rc.yield_quantity)) },
    { key: 'is_active', header: t('status'), render: (rc) => (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${rc.is_active ? 'bg-ui-success-soft text-ui-success' : 'bg-ui-page-alt text-ui-subtle dark:text-ui-subtle'}`}>
        {rc.is_active ? t('active') : t('inactive')}
      </span>
    )},
    { key: 'actions', header: t('actions'), render: (rc) => (
      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
        {can('recipes.manage') && (
          <button onClick={() => openEdit(rc)} className="p-1.5 rounded-md hover:bg-ui-info-soft text-ui-info" title={t('edit')}>
            <Edit2 className="w-4 h-4" />
          </button>
        )}
        {can('recipes.manage') && (
          <button onClick={() => setDeleteId(rc.id)} className="p-1.5 rounded-md hover:bg-ui-danger-soft text-ui-danger" title={t('delete')}>
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    )},
  ];

  return (
    <DesignSurface testId="recipes-page">
      <DesignPageHeader title={t('recipes')} subtitle={isAr ? 'ربط المنتجات المصنّعة بمكوناتها من المواد الخام' : 'Link manufactured products to their raw material components'} actions={
        can('recipes.manage') ? (
          <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4" /> {t('addRecipe')}</Button>
        ) : undefined
      } />

      <DesignPanel testId="recipes-search-panel">
        <DesignSearch value={search} onChange={setSearch} label={t('search')} placeholder={t('search')} testId="recipes-search" />
      </DesignPanel>

      <DesignPanel testId="recipes-table-panel">
        <DataTable columns={columns} data={filtered} loading={loading} error={error} emptyMessage={t('noData')} />
        <DesignPagination loaded={recipes.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
      </DesignPanel>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? t('editRecipe') : t('addRecipe')} size="2xl">
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select label={t('product')} value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })} disabled={!!editing}>
              <option value="">{t('selectProduct')}</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Select label={t('branch')} value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })} disabled={!!branchFilter}>
              <option value="">{t('branch')}</option>
              {branches.map((br) => <option key={br.id} value={br.id}>{br.name}</option>)}
            </Select>
            <Input label={t('name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input label={t('yieldQuantity')} type="number" step="0.0001" value={form.yield_quantity} onChange={(e) => setForm({ ...form, yield_quantity: parseFloat(e.target.value) || 1 })} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-bold text-ui-muted">{t('recipeItems')}</p>
              <Button variant="outline" size="sm" onClick={addLine}><Plus className="w-4 h-4" /> {t('add')}</Button>
            </div>
            <div className="space-y-2">
              {items.map((it, idx) => (
                <div key={idx} className="grid grid-cols-[130px_1fr_100px_90px_36px] gap-2 items-end">
                  <Select
                    value={it.item_type}
                    onChange={(e) => updateLine(idx, 'item_type', e.target.value as 'raw_material' | 'inventory_unit')}
                  >
                    <option value="raw_material">{isAr ? 'مادة خام' : 'Raw Material'}</option>
                    <option value="inventory_unit">{isAr ? 'وحدة مصنعة' : 'Manufactured Unit'}</option>
                  </Select>

                  {it.item_type === 'raw_material' ? (
                    <Select
                      value={it.raw_material_id}
                      onChange={(e) => updateLine(idx, 'raw_material_id', e.target.value)}
                    >
                      <option value="">{t('selectRawMaterial')}</option>
                      {materials.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </Select>
                  ) : (
                    <Select
                      value={it.inventory_unit_id}
                      onChange={(e) => updateLine(idx, 'inventory_unit_id', e.target.value)}
                    >
                      <option value="">{isAr ? 'اختر وحدة مصنعة' : 'Select Manufactured Unit'}</option>
                      {units.map((u) => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </Select>
                  )}

                  <Input
                    type="number"
                    step="0.0001"
                    value={it.quantity}
                    onChange={(e) => updateLine(idx, 'quantity', parseFloat(e.target.value) || 0)}
                    placeholder={t('requiredQty')}
                  />
                  <Input
                    type="number"
                    step="0.01"
                    value={it.wastage_percent}
                    onChange={(e) => updateLine(idx, 'wastage_percent', parseFloat(e.target.value) || 0)}
                    placeholder={t('wastagePercent')}
                  />
                  <button
                    onClick={() => removeLine(idx)}
                    className="p-2 rounded-lg text-ui-danger hover:bg-ui-danger-soft"
                    title={t('delete')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Live Recipe Costing & Margin Engine Card */}
          <div className="liquid-glass rounded-xl p-4 border border-ui-border shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 rounded-lg bg-ui-primary-soft text-ui-primary">
                <Calculator className="w-4 h-4" />
              </div>
              <p className="text-sm font-bold text-ui-text">
                {isAr ? 'التحليل المالي المباشر للوصفة (Live Costing)' : 'Live Recipe Costing & Profitability'}
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div className="p-2.5 rounded-lg bg-ui-surface/60 border border-ui-border">
                <span className="text-xs text-ui-subtle block">{isAr ? 'إجمالي تكلفة المواد' : 'Total Batch Cost'}</span>
                <span className="text-sm font-bold text-ui-text">{formatCurrency(calculatedCost.rawCost)}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-ui-surface/60 border border-ui-border">
                <span className="text-xs text-ui-subtle block">{isAr ? 'تكلفة الوحدة الواحدة' : 'Cost Per Unit'}</span>
                <span className="text-sm font-bold text-ui-primary">{formatCurrency(calculatedCost.costPerUnit)}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-ui-surface/60 border border-ui-border">
                <span className="text-xs text-ui-subtle block">{isAr ? 'نسبة تكلفة الطعام' : 'Food Cost %'}</span>
                <span className={`text-sm font-bold ${calculatedCost.foodCostRatio > 35 ? 'text-ui-danger' : calculatedCost.foodCostRatio > 0 ? 'text-ui-success' : 'text-ui-subtle'}`}>
                  {calculatedCost.foodCostRatio > 0 ? `${formatNumber(calculatedCost.foodCostRatio, 1)}%` : '-'}
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-ui-surface/60 border border-ui-border">
                <span className="text-xs text-ui-subtle block">{isAr ? 'هامش الربح المتوقع' : 'Estimated Margin'}</span>
                <span className={`text-sm font-bold ${calculatedCost.margin >= 60 ? 'text-ui-success' : calculatedCost.margin > 0 ? 'text-ui-warning' : 'text-ui-subtle'}`}>
                  {calculatedCost.margin > 0 ? `${formatNumber(calculatedCost.margin, 1)}%` : '-'}
                </span>
              </div>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-ui-muted">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              className="w-4 h-4 rounded border-ui-border text-brand-600 focus:ring-brand-500" />
            {t('active')}
          </label>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</Button>
            <Button onClick={save}>{t('save')}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={remove} title={t('delete')} message={t('confirmDelete')} confirmLabel={t('delete')} cancelLabel={t('cancel')} />
    </DesignSurface>
  );
}
