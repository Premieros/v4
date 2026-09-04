import { useEffect, useState } from 'react';
import { Edit2, AlertTriangle, Download, Trash2 } from 'lucide-react';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { useCan } from '@/lib/permissions';
import { DesignSurface, DesignPageHeader, DesignSearch, DesignPanel, DesignPagination } from '@/components/design';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatNumber } from '@/lib/format';
import { exportToExcel } from '@/lib/excel';
import { logAudit } from '@/lib/audit';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import type { Inventory, Warehouse } from '@/lib/types';

export function InventoryPage() {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';
  const { show } = useToast();
  const can = useCan();
  const { rows: items, loading, error, total, hasMore, loadMore, loadingMore, refresh: reloadInventory } = usePaginatedRows<Inventory>({
    table: 'inventory',
    select: '*, product:products(*), warehouse:warehouses(*)',
    order: { column: 'updated_at', ascending: false },
    pageSize: 100,
  });
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [componentIds, setComponentIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [filterWarehouse, setFilterWarehouse] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [adjustModal, setAdjustModal] = useState<Inventory | null>(null);
  const [adjustQty, setAdjustQty] = useState(0);
  const [adjustReason, setAdjustReason] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteSelectedConfirm, setDeleteSelectedConfirm] = useState(false);

  async function loadMeta() {
    const [wh, pc] = await Promise.all([
      supabase.from('warehouses').select('*').order('name'),
      supabase.from('product_components').select('component_product_id'),
    ]);
    setWarehouses((wh.data as Warehouse[]) || []);
    setComponentIds(new Set((pc.data || []).map((r: { component_product_id: string }) => r.component_product_id)));
  }
  useEffect(() => { loadMeta(); }, []);

  const filtered = items.filter((i) => {
    if (filterWarehouse && i.warehouse_id !== filterWarehouse) return false;
    if (filterType === 'components' && !componentIds.has(i.product_id)) return false;
    if (filterType === 'ready' && (i.product?.product_type !== 'ready' || componentIds.has(i.product_id))) return false;
    if (!search) return true;
    return i.product?.name.toLowerCase().includes(search.toLowerCase()) || i.product?.barcode?.includes(search);
  });

  const openAdjust = (inv: Inventory) => {
    setAdjustModal(inv);
    setAdjustQty(inv.quantity);
    setAdjustReason('');
  };

  const saveAdjust = async () => {
    if (!adjustModal) return;
    const { data, error } = await api.inventory.adjustStock({
      p_inventory_id: adjustModal.id,
      p_new_quantity: adjustQty,
      p_reason: adjustReason || null,
    });
    if (error) { show(error.message, 'error'); return; }
    const result = data as { success: boolean; error?: string; detail?: string } | null;
    if (!result?.success) { show(result?.detail || result?.error || t('error'), 'error'); return; }
    await logAudit('update', 'inventory', adjustModal.id, { from: adjustModal.quantity, to: adjustQty });
    show(t('saveSuccess'), 'success');
    setAdjustModal(null);
    reloadInventory();
  };

  const remove = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('inventory').delete().eq('id', deleteId);
    if (error) show(error.message, 'error');
    else { show(t('deleteSuccess'), 'success'); await logAudit('delete', 'inventory', deleteId); }
    setDeleteId(null);
    reloadInventory();
  };

  const removeSelected = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    for (const id of ids) {
      await supabase.from('inventory').delete().eq('id', id);
      await logAudit('delete', 'inventory', id);
    }
    show(t('deleteSuccess'), 'success');
    setSelectedIds(new Set());
    setDeleteSelectedConfirm(false);
    reloadInventory();
  };

  const handleExport = () => {
    exportToExcel(items.map((i) => ({
      Product: i.product?.name || '', Barcode: i.product?.barcode || '',
      Warehouse: i.warehouse?.name || '', Quantity: i.quantity,
      LowStockThreshold: i.product?.low_stock_threshold || 0,
    })), 'inventory');
  };

  const columns: Column<Inventory>[] = [
    { key: 'product', header: t('productName'), render: (i) => (
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-ui-page-alt flex items-center justify-center text-xs font-bold text-ui-subtle">
          {(i.product?.name || '?')[0]}
        </div>
        <div>
          <p className="font-medium text-ui-text">{i.product?.name || '-'}</p>
          <div className="flex items-center gap-1">
            <p className="text-xs text-ui-subtle">{i.product?.barcode || '-'}</p>
            {componentIds.has(i.product_id) && (
              <span className="px-1 py-0.5 rounded bg-ui-page-alt text-[10px] font-medium text-ui-subtle dark:text-ui-subtle">{t('component')}</span>
            )}
            {i.product?.product_type === 'manufactured' && (
              <span className="px-1 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-[10px] font-medium text-purple-700 dark:text-purple-400">{t('manufactured')}</span>
            )}
          </div>
        </div>
      </div>
    )},
    { key: 'warehouse', header: t('warehouse'), render: (i) => i.warehouse?.name || '-' },
    { key: 'quantity', header: t('quantity'), render: (i) => {
      const isLow = i.quantity < (i.product?.low_stock_threshold || 5);
      return (
        <div className="flex items-center gap-2">
          <span className={`font-semibold ${isLow ? 'text-ui-danger' : 'text-ui-text'}`}>{formatNumber(i.quantity)}</span>
          {isLow && <AlertTriangle className="w-4 h-4 text-ui-warning" />}
        </div>
      );
    }},
    { key: 'status', header: t('status'), render: (i) => {
      const isLow = i.quantity < (i.product?.low_stock_threshold || 5);
      const isOut = i.quantity <= 0;
      return (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
          isOut ? 'bg-ui-danger-soft text-ui-danger' :
          isLow ? 'bg-ui-warning-soft text-ui-warning' :
          'bg-ui-success-soft text-ui-success'
        }`}>
          {isOut ? t('outOfStock') : isLow ? t('lowStock') : t('inStock')}
        </span>
      );
    }},
    { key: 'actions', header: t('actions'), render: (i) => (
      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
        {can('inventory.manage') && (
          <button onClick={() => openAdjust(i)} className="p-1.5 rounded-md hover:bg-ui-info-soft text-ui-info" title={t('adjustStock')}>
            <Edit2 className="w-4 h-4" />
          </button>
        )}
        {can('inventory.manage') && (
          <button onClick={() => setDeleteId(i.id)} className="p-1.5 rounded-md hover:bg-ui-danger-soft text-ui-danger" title={t('delete')}>
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    )},
  ];

  return (
    <DesignSurface testId="inventory-page">
      <DesignPageHeader title={t('inventory')} actions={
        <>
          <Button variant="outline" size="sm" onClick={handleExport}><Download className="w-4 h-4" /> {t('exportExcel')}</Button>
          {can('inventory.manage') && selectedIds.size > 0 && (
            <Button variant="danger" size="sm" onClick={() => setDeleteSelectedConfirm(true)}>
              <Trash2 className="w-4 h-4" /> {t('deleteSelected')} ({selectedIds.size})
            </Button>
          )}
        </>
      } />

      <DesignPanel testId="inventory-search-panel">
        <div className="flex flex-col sm:flex-row gap-3">
          <DesignSearch value={search} onChange={setSearch} className="flex-1" label={t('search')} placeholder={t('search')} testId="inventory-search" />
          <Select value={filterWarehouse} onChange={(e) => setFilterWarehouse(e.target.value)} className="sm:w-48">
            <option value="">{t('all')} - {t('warehouses')}</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
          <Select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="sm:w-40">
            <option value="all">{t('all')}</option>
            <option value="ready">{t('readyProduct')}</option>
            <option value="components">{t('component')}</option>
          </Select>
        </div>
      </DesignPanel>

      <DesignPanel testId="inventory-table-panel">
        <DataTable columns={columns} data={filtered} loading={loading} error={error} emptyMessage={t('noData')}
          onRowClick={can('inventory.manage') ? openAdjust : undefined} showCheckbox={can('inventory.manage')} selectedIds={selectedIds} onSelectionChange={setSelectedIds} />
        <DesignPagination loaded={items.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
      </DesignPanel>

      <Modal open={!!adjustModal} onClose={() => setAdjustModal(null)} title={t('adjustStock')} size="sm">
        {adjustModal && (
          <div className="space-y-4">
            <div>
              <p className="text-sm text-ui-subtle">{t('productName')}</p>
              <p className="font-medium text-ui-text">{adjustModal.product?.name}</p>
            </div>
            <div>
              <p className="text-sm text-ui-subtle">{t('warehouse')}</p>
              <p className="font-medium text-ui-text">{adjustModal.warehouse?.name}</p>
            </div>
            <Input label={t('currentStock')} type="number" step="0.0001" value={adjustQty} onChange={(e) => setAdjustQty(parseFloat(e.target.value) || 0)} />
            <Input label={t('reason')} value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder={isAr ? '����: ��ϡ ���ݡ �����' : 'e.g. count, damaged, correction'} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setAdjustModal(null)}>{t('cancel')}</Button>
              <Button onClick={saveAdjust}>{t('save')}</Button>
            </div>
          </div>
        )}
      </Modal>
      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={remove} title={t('delete')} message={t('confirmDelete')} confirmLabel={t('delete')} cancelLabel={t('cancel')} />
      <ConfirmDialog open={deleteSelectedConfirm} onClose={() => setDeleteSelectedConfirm(false)} onConfirm={removeSelected}
        title={t('deleteSelected')} message={t('confirmDeleteAll')} confirmLabel={t('delete')} cancelLabel={t('cancel')} />
    </DesignSurface>
  );
}
