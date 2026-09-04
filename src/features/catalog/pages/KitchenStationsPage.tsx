import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit2, Trash2, GripVertical } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { DesignSurface, DesignPageHeader } from '@/components/design/DesignSurface';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useCan } from '@/lib/permissions';
import { catalog } from '@/api/domains/catalog';
import type { KitchenStation } from '@/lib/types';

interface StationForm {
  code: string;
  name_ar: string;
  name_en: string;
  sort_order: number;
}

const EMPTY_FORM: StationForm = { code: '', name_ar: '', name_en: '', sort_order: 0 };

export function KitchenStationsPage() {
  const { lang } = useLanguage();
  const { show } = useToast();
  const can = useCan();
  const ar = lang === 'ar';

  const [stations, setStations] = useState<KitchenStation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<StationForm>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<KitchenStation | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await catalog.listKitchenStations();
      setStations((data ?? []) as KitchenStation[]);
    } catch (err) { show(String((err as Error).message ?? err), 'error'); }
    finally { setLoading(false); }
  }, [show]);

  useEffect(() => { void load(); }, [load]);

  const handleSave = async () => {
    if (!form.code.trim() || !form.name_ar.trim()) {
      show(ar ? 'أكمل الحقول المطلوبة' : 'Fill required fields', 'error');
      return;
    }
    try {
      if (editingId) {
        await catalog.updateKitchenStation(editingId, { name_ar: form.name_ar, name_en: form.name_en, sort_order: form.sort_order });
      } else {
        await catalog.createKitchenStation({ code: form.code.trim().toLowerCase(), name_ar: form.name_ar, name_en: form.name_en, sort_order: form.sort_order });
      }
      show(ar ? 'تم الحفظ' : 'Saved', 'success');
      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      void load();
    } catch (err) { show(String((err as Error).message ?? err), 'error'); }
  };

  const handleToggle = async (s: KitchenStation) => {
    try {
      await catalog.updateKitchenStation(s.id, { is_active: !s.is_active });
      void load();
    } catch (err) { show(String((err as Error).message ?? err), 'error'); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await catalog.deleteKitchenStation(deleteTarget.id);
      show(ar ? 'تم الحذف' : 'Deleted', 'success');
      setDeleteTarget(null);
      void load();
    } catch (err) { show(String((err as Error).message ?? err), 'error'); }
  };

  const openEdit = (s: KitchenStation) => {
    setEditingId(s.id);
    setForm({ code: s.code, name_ar: s.name_ar, name_en: s.name_en ?? '', sort_order: s.sort_order });
    setShowForm(true);
  };

  const columns: Column<KitchenStation>[] = [
    { key: 'sort_order', header: '#', render: r => <span className="text-ui-muted"><GripVertical className="h-4 w-4 inline" /> {r.sort_order}</span> },
    { key: 'code', header: ar ? 'الكود' : 'Code', render: r => <code className="rounded bg-ui-muted px-1.5 py-0.5 text-xs">{r.code}</code> },
    { key: 'name_ar', header: ar ? 'الاسم عربي' : 'Name (AR)', render: r => r.name_ar },
    { key: 'name_en', header: ar ? 'الاسم إنجليزي' : 'Name (EN)', render: r => r.name_en },
    { key: 'is_active', header: ar ? 'نشط' : 'Active', render: r => (
      <button onClick={() => void handleToggle(r)} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.is_active ? 'bg-ui-success-soft text-ui-success' : 'bg-ui-page-alt text-ui-subtle'}`}>
        {r.is_active ? (ar ? 'نعم' : 'Yes') : (ar ? 'لا' : 'No')}
      </button>
    )},
  ];

  if (can('settings.manage')) {
    columns.push({
      key: 'actions', header: '', render: (r: KitchenStation) => (
        <div className="flex gap-1">
          <button onClick={() => openEdit(r)} className="text-ui-info hover:text-ui-info"><Edit2 className="h-4 w-4" /></button>
          <button onClick={() => setDeleteTarget(r)} className="text-ui-danger hover:text-ui-danger"><Trash2 className="h-4 w-4" /></button>
        </div>
      ),
    });
  }

  return (
    <DesignSurface testId="kitchen-stations">
      <DesignPageHeader title={ar ? 'محطات المطبخ' : 'Kitchen Stations'} subtitle={ar ? 'إدارة محطات شاشة المطبخ' : 'Manage kitchen display stations'} />
      <div className="space-y-4">
        {can('settings.manage') && (
          <Button onClick={() => { setEditingId(null); setForm(EMPTY_FORM); setShowForm(true); }}>
            <Plus className="h-4 w-4" /> {ar ? 'إضافة محطة' : 'Add Station'}
          </Button>
        )}
        <DataTable columns={columns} data={stations} loading={loading} />
      </div>

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editingId ? (ar ? 'تعديل محطة' : 'Edit Station') : (ar ? 'محطة جديدة' : 'New Station')}>
        <div className="space-y-3">
          <Input label={ar ? 'الكود (إنجليزي)' : 'Code'} value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} disabled={!!editingId} placeholder="grill, salad, ..." />
          <Input label={ar ? 'الاسم عربي' : 'Name (AR)'} value={form.name_ar} onChange={e => setForm(f => ({ ...f, name_ar: e.target.value }))} />
          <Input label={ar ? 'الاسم إنجليزي' : 'Name (EN)'} value={form.name_en} onChange={e => setForm(f => ({ ...f, name_en: e.target.value }))} />
          <Input label={ar ? 'ترتيب العرض' : 'Sort Order'} type="number" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: +e.target.value }))} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowForm(false)}>{ar ? 'إلغاء' : 'Cancel'}</Button>
            <Button onClick={() => void handleSave()}>{ar ? 'حفظ' : 'Save'}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={() => void handleDelete()} title={ar ? 'حذف المحطة' : 'Delete Station'} message={ar ? `هل تريد حذف "${deleteTarget?.name_ar}"؟` : `Delete "${deleteTarget?.name_en}"?`} />
    </DesignSurface>
  );
}
