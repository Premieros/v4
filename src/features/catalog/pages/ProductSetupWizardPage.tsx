import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, PackagePlus, Plus, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { DesignSurface, DesignPageHeader, DesignPanel } from '@/components/design';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useBranches } from '@/hooks/useBranches';
import { useCan } from '@/lib/permissions';
import { generateBarcode } from '@/lib/format';
import { logAudit } from '@/lib/audit';
import { useGuidedWorkflow } from '@/core/guard';
import type { Category, Product, InventoryUnit } from '@/lib/types';

type SetupUnit = { id: string; mode: 'existing' | 'new'; name: string; code: string; unit_type: 'ready' | 'manufactured'; quantity: number; cost_price: number; sale_price: number; recipe: { raw_material_id: string; quantity: number; wastage_percent: number }[] };
type RawMaterial = { id: string; name: string; is_active: boolean; cost_price?: number };
const emptyUnit = (): SetupUnit => ({ id: '', mode: 'new', name: '', code: '', unit_type: 'ready', quantity: 1, cost_price: 0, sale_price: 0, recipe: [] });

export function ProductSetupWizardPage() {
  const navigate = useNavigate();
  const { t, lang } = useLanguage(); const { show } = useToast(); const branchFilter = useBranchFilter(); const { branches } = useBranches(); const can = useCan();
  const { guidedContext, completePrerequisiteAndReturn } = useGuidedWorkflow();
  const isAr = lang === 'ar'; const [step, setStep] = useState(1); const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]); const [existingUnits, setExistingUnits] = useState<InventoryUnit[]>([]); const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [form, setForm] = useState({ name: '', name_en: '', barcode: generateBarcode(), sku: '', category_id: '', branch_id: branchFilter || '', cost_price: 0, sale_price: 0, wholesale_price: 0, is_active: true });
  const [units, setUnits] = useState<SetupUnit[]>([emptyUnit()]);

  useEffect(() => { void (async () => { let cq = supabase.from('categories').select('*').order('name'); if (branchFilter) cq = cq.eq('branch_id', branchFilter); const [cats, us, ms] = await Promise.all([cq, supabase.from('inventory_units').select('*').eq('is_active', true).order('name'), supabase.from('raw_materials').select('id,name,is_active,cost_price').eq('is_active', true).order('name')]); setCategories((cats.data as Category[]) || []); setExistingUnits((us.data as InventoryUnit[]) || []); setRawMaterials((ms.data as RawMaterial[]) || []); })(); }, [branchFilter]);
  const branchId = form.branch_id || branchFilter || branches[0]?.id || ''; const totalUnitCount = useMemo(() => units.reduce((s, u) => s + Number(u.quantity || 0), 0), [units]);
  const updateUnit = (i: number, patch: Partial<SetupUnit>) => setUnits((p) => p.map((u, x) => x === i ? { ...u, ...patch } : u));
  const addUnit = () => setUnits((p) => [...p, emptyUnit()]); const removeUnit = (i: number) => setUnits((p) => p.length === 1 ? p : p.filter((_, x) => x !== i));
  const addRecipe = (i: number) => updateUnit(i, { recipe: [...units[i].recipe, { raw_material_id: '', quantity: 1, wastage_percent: 0 }] });
  const updateRecipe = (ui: number, ri: number, patch: Partial<SetupUnit['recipe'][number]>) => updateUnit(ui, { recipe: units[ui].recipe.map((r, x) => x === ri ? { ...r, ...patch } : r) });
  const removeRecipe = (ui: number, ri: number) => updateUnit(ui, { recipe: units[ui].recipe.filter((_, x) => x !== ri) });

  const validateStep = () => {
    if (step === 1 && (!form.name.trim() || !branchId)) { show(isAr ? 'أكمل اسم المنتج والفرع' : 'Complete the product name and branch', 'error'); return false; }
    if (step === 2) {
      if (units.length === 0 || units.some((u) => (!u.id && !u.name.trim()) || u.quantity <= 0)) { show(isAr ? 'أكمل بيانات الوحدات' : 'Complete all unit data', 'error'); return false; }
      const duplicateIds = units.filter((u) => u.id).map((u) => u.id).filter((id, i, a) => a.indexOf(id) !== i);
      if (duplicateIds.length) { show(isAr ? 'لا يمكن ربط نفس الوحدة أكثر من مرة' : 'The same unit cannot be linked more than once', 'error'); return false; }
    }
    if (step === 3 && units.some((u) => u.mode === 'new' && u.unit_type === 'manufactured' && (!u.recipe.length || u.recipe.some((r) => !r.raw_material_id || r.quantity <= 0)))) { show(isAr ? 'أكمل Recipe لكل وحدة مصنّعة' : 'Complete every manufactured-unit recipe', 'error'); return false; }
    return true;
  };

  const save = async () => {
    if (!can('products.manage') || saving) return;
    if (!validateStep()) return;
    setSaving(true);
    try {
      const derivedProductType = units.some((u) => u.unit_type === 'manufactured') ? 'manufactured' : 'ready';
      const { data: p, error: pe } = await supabase.from('products').insert({ name: form.name.trim(), name_en: form.name_en.trim() || null, barcode: form.barcode || null, sku: form.sku.trim() || null, category_id: form.category_id || null, branch_id: branchId, cost_price: Number(form.cost_price) || 0, sale_price: Number(form.sale_price) || 0, wholesale_price: Number(form.wholesale_price) || 0, is_active: form.is_active, product_type: derivedProductType }).select().single();
      if (pe) throw pe;
      const productId = (p as Product).id;
      for (const unit of units) {
        let unitId = unit.id;
        if (unit.mode === 'new') {
          const { data: u, error: ue } = await supabase.from('inventory_units').insert({ code: unit.code.trim() || `${form.barcode || 'UNIT'}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: unit.name.trim(), name_en: unit.name.trim(), unit_type: unit.unit_type, branch_id: branchId, cost_price: Number(unit.cost_price) || 0, sale_price: Number(unit.sale_price) || 0, is_active: true }).select().single();
          if (ue) throw ue;
          unitId = (u as InventoryUnit).id;
          if (unit.unit_type === 'manufactured') {
            const { error: re } = await supabase.from('inventory_unit_recipes').insert(unit.recipe.map((r) => ({ unit_id: unitId, raw_material_id: r.raw_material_id, quantity: Number(r.quantity), wastage_percent: Number(r.wastage_percent) || 0 })));
            if (re) throw re;
          }
          await logAudit('create', 'inventory_units', unitId, { name: unit.name, unit_type: unit.unit_type });
        }
        const { error: le } = await supabase.from('product_unit_links').insert({ product_id: productId, unit_id: unitId, quantity: Number(unit.quantity) });
        if (le) throw le;
      }
      await logAudit('create', 'products', productId, { name: form.name, unit_count: totalUnitCount, product_type: derivedProductType });
      show(t('saveSuccess'), 'success');
      if (guidedContext?.missingStep.key.includes('product')) {
        setTimeout(() => {
          completePrerequisiteAndReturn();
        }, 500);
      } else {
        navigate('/products');
      }
    } catch (e) { show(e instanceof Error ? e.message : String(e), 'error'); } finally { setSaving(false); }
  };

  return <DesignSurface testId="product-setup-wizard-page"><DesignPageHeader title={isAr ? 'إضافة منتج متكامل' : 'Complete Product Setup'} subtitle={isAr ? 'المنتج ← الوحدات ← طريقة الحصول عليها ← Recipe' : 'Product → Units → Sourcing → Recipe'} actions={<Button variant="outline" size="sm" onClick={() => navigate('/products')}><ChevronLeft className="w-4 h-4" />{isAr ? 'العودة للمنتجات' : 'Back to products'}</Button>} /><DesignPanel>
    <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1">{[['1', isAr ? 'المنتج' : 'Product'], ['2', isAr ? 'الوحدات' : 'Units'], ['3', isAr ? 'المكونات وRecipe' : 'Components & Recipe'], ['4', isAr ? 'مراجعة' : 'Review']].map(([n, label]) => { const active = Number(n) === step; const done = Number(n) < step; return <div key={n} className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm whitespace-nowrap ${active ? 'bg-brand-600 text-white' : done ? 'bg-ui-success-soft text-ui-success' : 'bg-ui-page-alt text-ui-subtle'}`}><span className="w-6 h-6 rounded-full flex items-center justify-center bg-white/20">{done ? <Check className="w-4 h-4" /> : n}</span>{label}</div>; })}</div>
    {step === 1 && <div className="grid grid-cols-1 md:grid-cols-2 gap-4"><Input label={t('productName')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /><Input label={t('nameEn')} value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} /><Input label={t('barcode')} value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} /><Input label={t('sku')} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /><Select label={t('category')} value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}><option value="">--</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>{!branchFilter && <Select label={t('branch')} value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}><option value="">--</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}<Input label={t('costPrice')} type="number" step="0.01" value={form.cost_price || ''} onChange={(e) => setForm({ ...form, cost_price: Number(e.target.value) || 0 })} /><Input label={t('salePrice')} type="number" step="0.01" value={form.sale_price || ''} onChange={(e) => setForm({ ...form, sale_price: Number(e.target.value) || 0 })} /><Input label={t('wholesalePrice')} type="number" step="0.01" value={form.wholesale_price || ''} onChange={(e) => setForm({ ...form, wholesale_price: Number(e.target.value) || 0 })} /></div>}
    {step === 2 && <div className="space-y-4">{units.map((u, i) => <div key={i} className="rounded-xl border border-ui-border p-4 space-y-3"><div className="grid grid-cols-1 md:grid-cols-4 gap-3"><Select label={isAr ? 'الوحدة' : 'Unit'} value={u.mode === 'existing' ? `existing:${u.id}` : 'new'} onChange={(e) => { const v = e.target.value; if (v === 'new') updateUnit(i, { mode: 'new', id: '', name: '', code: '', unit_type: 'ready', recipe: [] }); else { const id = v.replace('existing:', ''); const f = existingUnits.find((x) => x.id === id); updateUnit(i, { mode: 'existing', id, name: f?.name || '', code: f?.code || '', unit_type: f?.unit_type || 'ready', cost_price: f?.cost_price || 0, sale_price: f?.sale_price || 0, recipe: [] }); } }}><option value="new">{isAr ? 'إنشاء وحدة جديدة' : 'Create new unit'}</option>{existingUnits.map((x) => <option key={x.id} value={`existing:${x.id}`}>{x.name} · {x.unit_type}</option>)}</Select><Input label={isAr ? 'الكمية المستخدمة' : 'Quantity used'} type="number" min="0.0001" step="0.0001" value={u.quantity} onChange={(e) => updateUnit(i, { quantity: Number(e.target.value) || 1 })} />{u.mode === 'new' && <Select label={isAr ? 'طريقة الحصول على الوحدة' : 'Unit sourcing'} value={u.unit_type} onChange={(e) => updateUnit(i, { unit_type: e.target.value as 'ready' | 'manufactured' })}><option value="ready">{isAr ? 'وحدة جاهزة' : 'Ready unit'}</option><option value="manufactured">{isAr ? 'وحدة مصنّعة' : 'Manufactured unit'}</option></Select>}<div className="flex items-end justify-end"><Button variant="outline" size="sm" onClick={() => removeUnit(i)} disabled={units.length === 1}><Trash2 className="w-4 h-4" />{isAr ? 'حذف' : 'Remove'}</Button></div></div>{u.mode === 'new' && <div className="grid grid-cols-1 md:grid-cols-3 gap-3"><Input label={isAr ? 'اسم الوحدة' : 'Unit name'} value={u.name} onChange={(e) => updateUnit(i, { name: e.target.value })} required /><Input label={isAr ? 'كود الوحدة' : 'Unit code'} value={u.code} onChange={(e) => updateUnit(i, { code: e.target.value })} /><Input label={t('costPrice')} type="number" step="0.01" value={u.cost_price || ''} onChange={(e) => updateUnit(i, { cost_price: Number(e.target.value) || 0 })} /></div>}{u.mode === 'existing' && <p className="text-xs text-ui-success">{isAr ? 'وحدة موجودة — سيتم ربطها فقط دون تكرار.' : 'Existing unit — linked without duplication.'}</p>}</div>)}<Button variant="outline" onClick={addUnit}><Plus className="w-4 h-4" />{isAr ? 'إضافة وحدة أخرى' : 'Add another unit'}</Button></div>}
    {step === 3 && <div className="space-y-4">{units.map((u, i) => <div key={i} className="rounded-xl border border-ui-border p-4"><div className="flex items-center justify-between mb-3"><div><p className="font-semibold">{u.name || existingUnits.find((x) => x.id === u.id)?.name}</p><p className="text-xs text-ui-subtle">{u.unit_type === 'manufactured' ? (isAr ? 'مصنّعة' : 'Manufactured') : (isAr ? 'جاهزة' : 'Ready')} · × {u.quantity}</p></div></div>{u.unit_type === 'manufactured' ? <div className="rounded-lg bg-purple-50/60 dark:bg-purple-900/10 border border-purple-200 dark:border-purple-800/40 p-3"><div className="space-y-2">{u.recipe.map((r, ri) => <div key={ri} className="grid grid-cols-[1fr_120px_100px_36px] gap-2 items-end"><Select value={r.raw_material_id} onChange={(e) => updateRecipe(i, ri, { raw_material_id: e.target.value })}><option value="">{isAr ? 'اختر المادة الخام' : 'Select raw material'}</option>{rawMaterials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select><Input label={isAr ? 'الكمية' : 'Qty'} type="number" min="0.0001" step="0.0001" value={r.quantity} onChange={(e) => updateRecipe(i, ri, { quantity: Number(e.target.value) || 0 })} /><Input label="Waste %" type="number" min="0" step="0.01" value={r.wastage_percent} onChange={(e) => updateRecipe(i, ri, { wastage_percent: Number(e.target.value) || 0 })} /><button onClick={() => removeRecipe(i, ri)} className="p-2 text-ui-danger"><Trash2 className="w-4 h-4" /></button></div>)}</div><Button variant="outline" size="sm" className="mt-3" onClick={() => addRecipe(i)}><Plus className="w-4 h-4" />{isAr ? 'إضافة مكون' : 'Add ingredient'}</Button></div> : <p className="text-sm text-ui-success">{isAr ? 'الوحدة الجاهزة تدخل المخزون مباشرة ولا تحتاج Recipe.' : 'Ready units enter stock directly and need no recipe.'}</p>}</div>)}</div>}
    {step === 4 && <div className="space-y-4"><div className="rounded-xl bg-brand-50 dark:bg-brand-900/10 border border-brand-200 dark:border-brand-800/40 p-5"><p className="text-lg font-bold">{form.name}</p><div className="mt-3 space-y-3">{units.map((u, i) => <div key={i} className="rounded-lg border border-brand-100 dark:border-brand-800/40 bg-white/50/20 p-3"><div className="flex items-center justify-between text-sm"><span>{u.name || existingUnits.find((x) => x.id === u.id)?.name}</span><span className="font-semibold">× {u.quantity}</span></div>{u.unit_type === 'manufactured' && <div className="mt-2 space-y-1 text-xs text-ui-subtle">{u.recipe.length ? u.recipe.map((r, ri) => { const material = rawMaterials.find((m) => m.id === r.raw_material_id); return <div key={ri} className="flex items-center justify-between"><span>{material?.name || r.raw_material_id}</span><span>{r.quantity} · {r.wastage_percent}%</span></div>; }) : <span>{isAr ? 'Recipe غير مكتملة' : 'Recipe incomplete'}</span>}</div>}</div>)}</div></div><p className="text-sm text-ui-subtle">{isAr ? 'حفظ الوحدة المصنّعة لا ينتج مخزونًا. الإنتاج الفعلي يتم لاحقًا من أوامر الإنتاج.' : 'Saving a manufactured unit does not produce stock. Actual production happens later through production orders.'}</p></div>}
    <div className="flex justify-between gap-2 mt-6 pt-4 border-t border-ui-border"><Button variant="secondary" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1 || saving}><ChevronLeft className="w-4 h-4" />{isAr ? 'السابق' : 'Back'}</Button>{step < 4 ? <Button onClick={() => validateStep() && setStep((s) => s + 1)}><ChevronRight className="w-4 h-4" />{isAr ? 'التالي' : 'Next'}</Button> : <Button onClick={save} disabled={saving}><PackagePlus className="w-4 h-4" />{saving ? (isAr ? 'جارٍ الحفظ...' : 'Saving...') : (isAr ? 'حفظ المنتج بالكامل' : 'Save complete product')}</Button>}</div>
  </DesignPanel></DesignSurface>;
}
