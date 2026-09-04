import { useState, useEffect, useCallback } from 'react';
import { Plus, Check, X, BarChart3, AlertCircle } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { DesignSurface, DesignPageHeader } from '@/components/design/DesignSurface';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Input, Select, Textarea } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import { supabase } from '@/api';
import type { WasteEntry, WasteCategory } from '@/lib/types';

const WASTE_TYPES = [
  { value: 'raw_material', ar: 'مادة خام', en: 'Raw Material' },
  { value: 'finished_good', ar: 'منتج نهائي', en: 'Finished Good' },
  { value: 'production', ar: 'إنتاج', en: 'Production' },
  { value: 'expired', ar: 'منتهي الصلاحية', en: 'Expired' },
  { value: 'damaged', ar: 'تالف', en: 'Damaged' },
] as const;

interface WasteForm {
  waste_category_id: string;
  waste_type: string;
  raw_material_id: string;
  product_id: string;
  inventory_unit_id: string;
  warehouse_id: string;
  quantity: number;
  unit_cost: number;
  reason: string;
}

interface RawMaterialOption { id: string; name: string; cost_price?: number; unit_id?: string; branch_id?: string; }
interface ProductOption { id: string; name: string; cost_price?: number; branch_id?: string; }
interface InventoryUnitOption { id: string; name: string; cost_price?: number; unit_type?: string; branch_id?: string; }
interface WarehouseOption { id: string; name: string; branch_id?: string; }

const EMPTY_FORM: WasteForm = {
  waste_category_id: '',
  waste_type: 'raw_material',
  raw_material_id: '',
  product_id: '',
  inventory_unit_id: '',
  warehouse_id: '',
  quantity: 1,
  unit_cost: 0,
  reason: '',
};

export function WasteCenterPage() {
  const { lang } = useLanguage();
  const { show } = useToast();
  const can = useCan();
  const branchFilter = useBranchFilter();
  const ar = lang === 'ar';
  const canViewWaste = can('waste.view');
  const canCreateWaste = can('waste.create');
  const canApproveWaste = can('waste.approve');

  const [entries, setEntries] = useState<WasteEntry[]>([]);
  const [categories, setCategories] = useState<WasteCategory[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterialOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [inventoryUnits, setInventoryUnits] = useState<InventoryUnitOption[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [form, setForm] = useState<WasteForm>(EMPTY_FORM);
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const catQ = supabase.from('waste_categories').select('*').eq('is_active', true).order('name');
      let entryQ = supabase
        .from('waste_entries')
        .select(`
          *,
          waste_category:waste_categories(*),
          raw_material:raw_materials(id, name),
          product:products(id, name),
          inventory_unit:inventory_units(id, name),
          warehouse:warehouses(id, name)
        `)
        .order('created_at', { ascending: false });
      if (branchFilter) entryQ = entryQ.eq('branch_id', branchFilter);

      let rmQ = supabase.from('raw_materials').select('id, name, cost_price, branch_id').eq('is_active', true).order('name');
      let prodQ = supabase.from('products').select('id, name, cost_price, branch_id').eq('is_active', true).order('name');
      let unitQ = supabase.from('inventory_units').select('id, name, cost_price, unit_type, branch_id').eq('is_active', true).order('name');
      let whQ = supabase.from('warehouses').select('id, name, branch_id').eq('is_active', true).order('name');

      if (branchFilter) {
        rmQ = rmQ.or(`branch_id.eq.${branchFilter},branch_id.is.null`);
        prodQ = prodQ.eq('branch_id', branchFilter);
        unitQ = unitQ.eq('branch_id', branchFilter);
        whQ = whQ.eq('branch_id', branchFilter);
      }

      const [catRes, entryRes, rmRes, prodRes, unitRes, whRes] = await Promise.all([catQ, entryQ, rmQ, prodQ, unitQ, whQ]);
      if (catRes.error) throw catRes.error;
      if (entryRes.error) throw entryRes.error;
      if (rmRes.error) throw rmRes.error;
      if (prodRes.error) throw prodRes.error;
      if (unitRes.error) throw unitRes.error;
      if (whRes.error) throw whRes.error;

      setCategories(catRes.data ?? []);
      setEntries((entryRes.data ?? []) as unknown as WasteEntry[]);
      setRawMaterials((rmRes.data as RawMaterialOption[]) ?? []);
      setProducts((prodRes.data as ProductOption[]) ?? []);
      setInventoryUnits((unitRes.data as InventoryUnitOption[]) ?? []);
      setWarehouses((whRes.data as WarehouseOption[]) ?? []);
    } catch (err) {
      show((ar ? 'خطأ في التحميل: ' : 'Load error: ') + String((err as Error).message ?? err), 'error');
    } finally {
      setLoading(false);
    }
  }, [ar, branchFilter, show]);

  useEffect(() => { void load(); }, [load]);

  const filtered = entries.filter((e) => {
    if (filterType && e.waste_type !== filterType) return false;
    if (filterStatus && e.status !== filterStatus) return false;
    return true;
  });

  const handleRawMaterialChange = (rmId: string) => {
    const selected = rawMaterials.find((m) => m.id === rmId);
    setForm((f) => ({ ...f, raw_material_id: rmId, product_id: '', inventory_unit_id: '', unit_cost: selected?.cost_price ? Number(selected.cost_price) : f.unit_cost }));
  };
  const handleProductChange = (pId: string) => {
    const selected = products.find((p) => p.id === pId);
    setForm((f) => ({ ...f, product_id: pId, raw_material_id: '', inventory_unit_id: '', unit_cost: selected?.cost_price ? Number(selected.cost_price) : f.unit_cost }));
  };
  const handleInventoryUnitChange = (uId: string) => {
    const selected = inventoryUnits.find((u) => u.id === uId);
    setForm((f) => ({ ...f, inventory_unit_id: uId, raw_material_id: '', product_id: '', unit_cost: selected?.cost_price ? Number(selected.cost_price) : f.unit_cost }));
  };

  const handleCreate = async () => {
    if (!canCreateWaste) { show(ar ? 'ليس لديك صلاحية تسجيل الهالك' : 'No waste-create permission', 'error'); return; }
    if (!branchFilter) { show(ar ? 'اختر الفرع أولاً من أعلى الصفحة' : 'Select a branch first', 'error'); return; }
    const targetCount = [form.raw_material_id, form.product_id, form.inventory_unit_id].filter(Boolean).length;
    if (!form.waste_category_id || !form.warehouse_id || form.quantity <= 0 || targetCount !== 1) {
      show(ar ? 'حدد الفئة والمخزن والصنف/الخامة والكمية' : 'Select category, warehouse, item/material and quantity', 'error');
      return;
    }

    try {
      const { error } = await supabase.rpc('create_waste_entry', {
        p_branch_id: branchFilter,
        p_waste_category_id: form.waste_category_id,
        p_waste_type: form.waste_type,
        p_quantity: Number(form.quantity),
        p_unit_cost: Number(form.unit_cost) || 0,
        p_reason: form.reason || null,
        p_raw_material_id: form.raw_material_id || null,
        p_product_id: form.product_id || null,
        p_inventory_unit_id: form.inventory_unit_id || null,
        p_warehouse_id: form.warehouse_id || null,
      });
      if (error) throw error;
      show(ar ? 'تم تسجيل طلب الهالك للمراجعة' : 'Waste request recorded for approval', 'success');
      setShowForm(false);
      setForm(EMPTY_FORM);
      void load();
    } catch (err) {
      show(String((err as Error).message ?? err), 'error');
    }
  };

  const handleApprove = async (id: string, approve: boolean) => {
    if (!canApproveWaste) { show(ar ? 'ليس لديك صلاحية اعتماد الهالك' : 'No waste-approval permission', 'error'); return; }
    let reason: string | null = null;
    if (!approve) {
      reason = prompt(ar ? 'سبب الرفض:' : 'Rejection reason:');
      if (reason === null) return;
    }
    try {
      const { error } = await supabase.rpc('approve_waste', {
        p_waste_id: id,
        p_approve: approve,
        p_rejection_reason: reason || null,
      });
      if (error) throw error;
      show(approve ? (ar ? 'تم الاعتماد وخصم المخزون' : 'Approved and stock deducted') : (ar ? 'تم الرفض بدون خصم' : 'Rejected without deduction'), 'success');
      void load();
    } catch (err) {
      show(String((err as Error).message ?? err), 'error');
    }
  };

  const typeLabel = (v: string) => WASTE_TYPES.find((w) => w.value === v)?.[ar ? 'ar' : 'en'] ?? v;
  const statusColor = (s: string) => s === 'approved' ? 'text-ui-success' : s === 'rejected' ? 'text-ui-danger' : 'text-ui-warning';

  const getItemName = (r: WasteEntry) => {
    const entryAny = r as unknown as { raw_material?: { name?: string }; product?: { name?: string }; inventory_unit?: { name?: string } };
    if (entryAny.raw_material?.name) return <span className="font-medium text-ui-text">{ar ? 'خامة: ' : 'Raw: '}{entryAny.raw_material.name}</span>;
    if (entryAny.product?.name) return <span className="font-medium text-ui-text">{ar ? 'منتج: ' : 'Product: '}{entryAny.product.name}</span>;
    if (entryAny.inventory_unit?.name) return <span className="font-medium text-ui-text">{ar ? 'وحدة: ' : 'Unit: '}{entryAny.inventory_unit.name}</span>;
    return <span className="text-ui-subtle">-</span>;
  };

  const baseColumns: Column<WasteEntry>[] = [
    { key: 'created_at', header: ar ? 'التاريخ' : 'Date', render: (r) => new Date(r.created_at).toLocaleDateString() },
    { key: 'item', header: ar ? 'المادة / المنتج' : 'Item / Material', render: getItemName },
    { key: 'waste_type', header: ar ? 'النوع' : 'Type', render: (r) => typeLabel(r.waste_type) },
    { key: 'waste_category', header: ar ? 'الفئة' : 'Category', render: (r) => (r as unknown as { waste_category?: { name?: string } }).waste_category?.name ?? '-' },
    { key: 'quantity', header: ar ? 'الكمية' : 'Qty' },
    { key: 'unit_cost', header: ar ? 'تكلفة الوحدة' : 'Unit Cost', render: (r) => Number(r.unit_cost).toLocaleString() },
    { key: 'total_cost', header: ar ? 'الإجمالي' : 'Total', render: (r) => Number(r.total_cost).toLocaleString() },
    { key: 'warehouse', header: ar ? 'المخزن' : 'Warehouse', render: (r) => (r as unknown as { warehouse?: { name?: string } }).warehouse?.name ?? '-' },
    { key: 'reason', header: ar ? 'السبب' : 'Reason', render: (r) => r.reason ?? '-' },
    {
      key: 'status', header: ar ? 'الحالة' : 'Status', render: (r) => (
        <span className={`font-bold ${statusColor(r.status)}`}>
          {r.status === 'approved' ? (ar ? 'معتمد' : 'Approved') : r.status === 'rejected' ? (ar ? 'مرفوض' : 'Rejected') : (ar ? 'قيد المراجعة' : 'Pending')}
        </span>
      ),
    },
  ];

  const columns: Column<WasteEntry>[] = canApproveWaste ? [
    ...baseColumns,
    {
      key: 'actions', header: ar ? 'إجراءات' : 'Actions', render: (r: WasteEntry) => r.status === 'pending' ? (
        <div className="flex gap-1">
          <button onClick={() => void handleApprove(r.id, true)} className="text-ui-success p-1 rounded hover:bg-emerald-50 dark:hover:bg-emerald-950/30" title={ar ? 'اعتماد وخصم' : 'Approve & deduct'}><Check className="h-4 w-4" /></button>
          <button onClick={() => void handleApprove(r.id, false)} className="text-ui-danger p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-950/30" title={ar ? 'رفض' : 'Reject'}><X className="h-4 w-4" /></button>
        </div>
      ) : null,
    },
  ] : baseColumns;

  return (
    <DesignSurface testId="waste-center">
      <DesignPageHeader
        title={ar ? 'مركز الهالك' : 'Waste Center'}
        subtitle={ar ? 'الهالك لا يخصم من المخزون إلا عند الاعتماد ومن المخزن المحدد داخل الفرع' : 'Waste deducts stock only after approval, from the selected branch warehouse.'}
      />
      <div className="space-y-4">
        {!branchFilter && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{ar ? 'اختر فرعًا أولاً. كل المخازن والأصناف والهالك ستتقيد بهذا الفرع.' : 'Select a branch first. Warehouses, items and waste are scoped to it.'}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {canCreateWaste && (
            <Button onClick={() => setShowForm(true)} disabled={!branchFilter}>
              <Plus className="h-4 w-4" /> {ar ? 'تسجيل طلب هالك' : 'Record Waste'}
            </Button>
          )}
          {canViewWaste && (
            <Button onClick={() => setShowReport(!showReport)} variant="outline">
              <BarChart3 className="h-4 w-4" /> {ar ? 'التقرير' : 'Report'}
            </Button>
          )}
          <Select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="w-40">
            <option value="">{ar ? 'كل الأنواع' : 'All Types'}</option>
            {WASTE_TYPES.map((wt) => <option key={wt.value} value={wt.value}>{ar ? wt.ar : wt.en}</option>)}
          </Select>
          <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="w-36">
            <option value="">{ar ? 'كل الحالات' : 'All Statuses'}</option>
            <option value="pending">{ar ? 'قيد المراجعة' : 'Pending'}</option>
            <option value="approved">{ar ? 'معتمد' : 'Approved'}</option>
            <option value="rejected">{ar ? 'مرفوض' : 'Rejected'}</option>
          </Select>
        </div>

        {showReport && canViewWaste && <WasteReport ar={ar} branchFilter={branchFilter} />}
        <DataTable columns={columns} data={filtered} loading={loading} />
      </div>

      <Modal open={showForm} onClose={() => setShowForm(false)} title={ar ? 'تسجيل هالك جديد' : 'Record Waste'} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select label={ar ? 'فئة الهالك' : 'Waste Category'} value={form.waste_category_id} onChange={(e) => setForm((f) => ({ ...f, waste_category_id: e.target.value }))} required>
              <option value="">{ar ? 'اختر فئة...' : 'Select Category...'}</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Select
              label={ar ? 'نوع الهالك' : 'Waste Type'}
              value={form.waste_type}
              onChange={(e) => {
                const newType = e.target.value;
                setForm((f) => ({ ...f, waste_type: newType, raw_material_id: '', product_id: '', inventory_unit_id: '' }));
              }}
            >
              {WASTE_TYPES.map((wt) => <option key={wt.value} value={wt.value}>{ar ? wt.ar : wt.en}</option>)}
            </Select>
          </div>

          {form.waste_type === 'raw_material' && (
            <Select label={ar ? 'الخامة' : 'Raw Material'} value={form.raw_material_id} onChange={(e) => handleRawMaterialChange(e.target.value)}>
              <option value="">{ar ? '-- اختر الخامة --' : '-- Select Raw Material --'}</option>
              {rawMaterials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          )}

          {(form.waste_type === 'finished_good' || form.waste_type === 'damaged' || form.waste_type === 'expired') && (
            <Select label={ar ? 'المنتج' : 'Product'} value={form.product_id} onChange={(e) => handleProductChange(e.target.value)}>
              <option value="">{ar ? '-- اختر المنتج --' : '-- Select Product --'}</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          )}

          {form.waste_type === 'production' && (
            <Select label={ar ? 'وحدة المخزون / الإنتاج' : 'Inventory Unit'} value={form.inventory_unit_id} onChange={(e) => handleInventoryUnitChange(e.target.value)}>
              <option value="">{ar ? '-- اختر الوحدة --' : '-- Select Unit --'}</option>
              {inventoryUnits.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Select label={ar ? 'مخزن الخصم' : 'Warehouse'} value={form.warehouse_id} onChange={(e) => setForm((f) => ({ ...f, warehouse_id: e.target.value }))} required>
              <option value="">{ar ? '-- اختر المخزن --' : '-- Select Warehouse --'}</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
            <Input label={ar ? 'الكمية' : 'Quantity'} type="number" step="0.01" min="0.01" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: parseFloat(e.target.value) || 0 }))} required />
            <Input label={ar ? 'تكلفة الوحدة' : 'Unit Cost'} type="number" step="0.01" min="0" value={form.unit_cost} onChange={(e) => setForm((f) => ({ ...f, unit_cost: parseFloat(e.target.value) || 0 }))} />
          </div>

          <div className="p-2 rounded-lg bg-ui-page-alt text-xs flex justify-between items-center">
            <span className="text-ui-muted">{ar ? 'إجمالي تكلفة الهالك:' : 'Calculated Cost:'}</span>
            <span className="font-bold text-ui-text text-sm">{(form.quantity * form.unit_cost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EGP</span>
          </div>

          <Textarea label={ar ? 'السبب / الملاحظات' : 'Reason / Notes'} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} rows={2} />

          <div className="flex justify-end gap-2 pt-2 border-t border-ui-border">
            <Button variant="outline" onClick={() => setShowForm(false)}>{ar ? 'إلغاء' : 'Cancel'}</Button>
            <Button onClick={() => void handleCreate()}>{ar ? 'حفظ للمراجعة' : 'Save for Approval'}</Button>
          </div>
        </div>
      </Modal>
    </DesignSurface>
  );
}

function WasteReport({ ar, branchFilter }: { ar: boolean; branchFilter: string | null }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const to = new Date().toISOString().slice(0, 10);
        const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
        const { data, error } = await supabase.rpc('get_waste_report', { p_branch_id: branchFilter, p_from_date: from, p_to_date: to });
        if (error) throw error;
        setRows((data ?? []) as Record<string, unknown>[]);
      } catch {
        // Optional summary; the detailed table remains the source of truth.
      }
      setLoading(false);
    })();
  }, [branchFilter]);

  if (loading) return <div className="text-ui-muted text-sm py-4">{ar ? 'جاري التحميل...' : 'Loading...'}</div>;
  if (!rows.length) return <div className="text-ui-muted text-sm py-4">{ar ? 'لا توجد بيانات' : 'No data'}</div>;

  return (
    <div className="rounded-2xl border border-ui-border bg-ui-surface p-4 shadow-ui-sm">
      <h3 className="font-bold text-ui-text mb-3">{ar ? 'تقرير آخر 30 يوم' : 'Last 30 Days Report'}</h3>
      <table className="w-full text-sm">
        <thead><tr className="border-b border-ui-border text-ui-muted">
          <th className="py-2 text-start">{ar ? 'الفئة' : 'Category'}</th>
          <th className="py-2 text-start">{ar ? 'النوع' : 'Type'}</th>
          <th className="py-2 text-end">{ar ? 'الكمية' : 'Qty'}</th>
          <th className="py-2 text-end">{ar ? 'التكلفة' : 'Cost'}</th>
          <th className="py-2 text-end">{ar ? 'عدد' : 'Count'}</th>
        </tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i} className="border-b border-ui-border">
            <td className="py-2">{String(r.waste_category)}</td>
            <td className="py-2">{String(r.waste_type)}</td>
            <td className="py-2 text-end">{Number(r.total_quantity).toLocaleString()}</td>
            <td className="py-2 text-end">{Number(r.total_cost).toLocaleString()}</td>
            <td className="py-2 text-end">{String(r.entry_count)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
