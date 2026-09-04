import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, PackagePlus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { DesignSurface, DesignPageHeader, DesignPanel } from '@/components/design';
import { Button } from '@/components/Button';
import { Input, Select, Textarea } from '@/components/Input';
import { useCan } from '@/lib/permissions';
import { generateBarcode } from '@/lib/format';
import { logAudit } from '@/lib/audit';
import { useGuidedWorkflow } from '@/core/guard';
import { useUserBranches } from '@/hooks/useUserBranches';
import type { Category, Product } from '@/lib/types';

export function ProductSetupWizardPage() {
  const navigate = useNavigate();
  const { t, lang } = useLanguage();
  const { show } = useToast();
  const can = useCan();
  const { guidedContext, completePrerequisiteAndReturn } = useGuidedWorkflow();
  const { accessibleBranches, activeBranchId, loading: branchesLoading } = useUserBranches();
  const isAr = lang === 'ar';

  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState({
    name: '',
    name_en: '',
    barcode: generateBarcode(),
    sku: '',
    category_id: '',
    branch_id: activeBranchId || '',
    description: '',
    cost_price: 0,
    sale_price: 0,
    wholesale_price: 0,
    low_stock_threshold: 5,
    min_stock: 0,
    max_stock: 0,
    reorder_point: 0,
    product_type: 'ready' as 'ready' | 'manufactured',
    is_active: true,
  });

  useEffect(() => {
    if (!form.branch_id && activeBranchId) {
      setForm((current) => ({ ...current, branch_id: activeBranchId }));
    }
  }, [activeBranchId, form.branch_id]);

  useEffect(() => {
    void (async () => {
      if (!form.branch_id) {
        setCategories([]);
        return;
      }
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .eq('branch_id', form.branch_id)
        .order('name');
      if (error) {
        setCategories([]);
        return;
      }
      setCategories((data as Category[]) || []);
    })();
  }, [form.branch_id]);

  const branchName = useMemo(
    () => accessibleBranches.find((branch) => branch.id === form.branch_id)?.name || '',
    [accessibleBranches, form.branch_id]
  );

  const save = async () => {
    if (!can('products.manage') || saving) return;
    if (!form.name.trim()) {
      show(isAr ? 'اسم المنتج مطلوب' : 'Product name is required', 'error');
      return;
    }
    if (!form.branch_id) {
      show(isAr ? 'اختر فرعًا مسموحًا قبل إنشاء المنتج' : 'Select an allowed branch before creating the product', 'error');
      return;
    }
    if (!accessibleBranches.some((branch) => branch.id === form.branch_id)) {
      show(isAr ? 'الفرع المختار غير مصرح لك به' : 'The selected branch is not granted to you', 'error');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        name_en: form.name_en.trim() || null,
        barcode: form.barcode.trim() || null,
        sku: form.sku.trim() || null,
        category_id: form.category_id || null,
        branch_id: form.branch_id,
        description: form.description.trim() || null,
        cost_price: Number(form.cost_price) || 0,
        sale_price: Number(form.sale_price) || 0,
        wholesale_price: Number(form.wholesale_price) || 0,
        low_stock_threshold: Number(form.low_stock_threshold) || 0,
        min_stock: Number(form.min_stock) || 0,
        max_stock: Number(form.max_stock) || 0,
        reorder_point: Number(form.reorder_point) || 0,
        product_type: form.product_type,
        is_active: form.is_active,
      };

      // Product setup creates one entity only. Units, recipes and components are
      // managed independently from their dedicated screens.
      const { data, error } = await supabase.from('products').insert(payload).select().single();
      if (error) throw error;
      const productId = (data as Product).id;

      await logAudit('create', 'products', productId, {
        name: form.name.trim(),
        branch_id: form.branch_id,
        product_type: form.product_type,
      });

      show(t('saveSuccess'), 'success');
      if (guidedContext?.missingStep.key.includes('product')) {
        completePrerequisiteAndReturn();
      } else {
        navigate('/products');
      }
    } catch (error) {
      show(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DesignSurface testId="product-setup-wizard-page">
      <DesignPageHeader
        title={isAr ? 'إضافة منتج' : 'Add Product'}
        subtitle={isAr
          ? 'إنشاء المنتج فقط. الوحدات والمكونات والوصفات تُدار من شاشاتها المستقلة.'
          : 'Create the product only. Units, components and recipes are managed in their dedicated screens.'}
        actions={
          <Button variant="outline" size="sm" onClick={() => navigate('/products')}>
            <ChevronLeft className="w-4 h-4" />
            {isAr ? 'العودة للمنتجات' : 'Back to products'}
          </Button>
        }
      />

      <DesignPanel>
        <div className="flex items-center gap-2 mb-6">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm bg-brand-600 text-white">
            <span className="w-6 h-6 rounded-full flex items-center justify-center bg-white/20">
              <PackagePlus className="w-4 h-4" />
            </span>
            {isAr ? 'بيانات المنتج' : 'Product data'}
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm bg-ui-success-soft text-ui-success">
            <Check className="w-4 h-4" />
            {isAr ? 'كيان مستقل' : 'Independent entity'}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input label={t('productName')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Input label={t('nameEn')} value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} />
          <Input label={t('barcode')} value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
          <Input label={t('sku')} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />

          <Select
            label={t('branch')}
            value={form.branch_id}
            onChange={(e) => setForm({ ...form, branch_id: e.target.value, category_id: '' })}
            disabled={branchesLoading || accessibleBranches.length === 0}
          >
            <option value="">--</option>
            {accessibleBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </Select>

          <Select label={t('category')} value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} disabled={!form.branch_id}>
            <option value="">--</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </Select>

          <Select label={isAr ? 'نوع المنتج' : 'Product type'} value={form.product_type} onChange={(e) => setForm({ ...form, product_type: e.target.value as 'ready' | 'manufactured' })}>
            <option value="ready">{isAr ? 'جاهز' : 'Ready'}</option>
            <option value="manufactured">{isAr ? 'مصنّع' : 'Manufactured'}</option>
          </Select>

          <Input label={t('costPrice')} type="number" step="0.01" value={form.cost_price || ''} onChange={(e) => setForm({ ...form, cost_price: Number(e.target.value) || 0 })} />
          <Input label={t('salePrice')} type="number" step="0.01" value={form.sale_price || ''} onChange={(e) => setForm({ ...form, sale_price: Number(e.target.value) || 0 })} />
          <Input label={t('wholesalePrice')} type="number" step="0.01" value={form.wholesale_price || ''} onChange={(e) => setForm({ ...form, wholesale_price: Number(e.target.value) || 0 })} />
          <Input label={t('lowStockThreshold')} type="number" min="0" value={form.low_stock_threshold} onChange={(e) => setForm({ ...form, low_stock_threshold: Number(e.target.value) || 0 })} />
          <Input label={t('minStock')} type="number" min="0" value={form.min_stock} onChange={(e) => setForm({ ...form, min_stock: Number(e.target.value) || 0 })} />
          <Input label={t('maxStock')} type="number" min="0" value={form.max_stock} onChange={(e) => setForm({ ...form, max_stock: Number(e.target.value) || 0 })} />
          <Input label={t('reorderPoint')} type="number" min="0" value={form.reorder_point} onChange={(e) => setForm({ ...form, reorder_point: Number(e.target.value) || 0 })} />
        </div>

        <div className="mt-4">
          <Textarea label={t('description')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
        </div>

        <div className="mt-4 rounded-xl border border-ui-border bg-ui-page-alt p-3 text-sm text-ui-muted">
          {isAr
            ? `الفرع: ${branchName || 'غير محدد'}. بعد إنشاء المنتج، اربط الوحدات من شاشة الوحدات وأدر المكونات من شاشة المكونات.`
            : `Branch: ${branchName || 'Not selected'}. After creation, manage units and components from their dedicated screens.`}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="outline" onClick={() => navigate('/products')}>{t('cancel')}</Button>
          <Button onClick={save} disabled={saving || branchesLoading || accessibleBranches.length === 0}>
            <PackagePlus className="w-4 h-4" />
            {saving ? (isAr ? 'جارٍ الحفظ...' : 'Saving...') : t('save')}
          </Button>
        </div>
      </DesignPanel>
    </DesignSurface>
  );
}
