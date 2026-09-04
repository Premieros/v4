import { useEffect, useMemo, useState } from 'react';
import { BookOpenText } from 'lucide-react';
import { supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { DesignSurface, DesignPageHeader, DesignSearch, DesignPanel, DesignPagination } from '@/components/design';
import { DataTable, type Column } from '@/components/DataTable';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import { Select } from '@/components/Input';
import { formatNumber, formatDateTime } from '@/lib/format';
import { exportToExcel } from '@/lib/excel';
import type { InventoryLedgerEntry, Warehouse } from '@/lib/types';

interface LedgerRow {
  id: string;
  entry: InventoryLedgerEntry;
}

export function InventoryLedgerPage() {
  const { t, lang } = useLanguage();
  const branchFilter = useBranchFilter();

  const { rows: rawRows, loading, error, total, hasMore, loadMore, loadingMore } = usePaginatedRows<InventoryLedgerEntry>({
    table: 'inventory_ledger',
    select: '*, product:products(*), raw_material:raw_materials(*), warehouse:warehouses(*)',
    order: { column: 'created_at', ascending: false },
    pageSize: 100,
  });
  const rows = useMemo<LedgerRow[]>(() => rawRows.map((entry) => ({ id: String(entry.id), entry })), [rawRows]);
  const [entryType, setEntryType] = useState('all');
  const [branchId, setBranchId] = useState(branchFilter || '');
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [search, setSearch] = useState('');

  const entryTypes: { key: string; label: string }[] = [
    { key: 'opening', label: t('entryOpening') },
    { key: 'purchase', label: t('entryPurchase') },
    { key: 'sale', label: t('entrySale') },
    { key: 'refund', label: t('entryRefund') },
    { key: 'production', label: t('entryProduction') },
    { key: 'waste', label: t('entryWaste') },
    { key: 'transfer', label: t('entryTransfer') },
    { key: 'adjustment', label: t('entryAdjustment') },
  ];

  async function loadBranches() {
    const br = await supabase.from('branches').select('id, name').eq('is_active', true).order('name');
    setBranches((br.data as { id: string; name: string }[]) || []);
  }
  useEffect(() => { loadBranches(); }, []);

  const filtered = rows.filter((r) => {
    const e = r.entry;
    if (entryType !== 'all' && e.entry_type !== entryType) return false;
    if (branchId && e.branch_id !== branchId) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (e.reference_number || '').toLowerCase().includes(q)
      || (e.product?.name || '').toLowerCase().includes(q)
      || (e.raw_material?.name || '').toLowerCase().includes(q)
      || (e.batch_number || '').toLowerCase().includes(q);
  });

  const handleExport = () => {
    exportToExcel(filtered.map((r) => ({
      Date: r.entry.created_at,
      Type: entryTypes.find((x) => x.key === r.entry.entry_type)?.label || r.entry.entry_type,
      Item: r.entry.product?.name || r.entry.raw_material?.name || '-',
      Reference: r.entry.reference_number || '',
      Batch: r.entry.batch_number || '',
      Quantity: r.entry.quantity,
      UnitCost: r.entry.unit_cost,
      TotalCost: r.entry.total_cost,
      Before: r.entry.before_qty ?? '',
      After: r.entry.after_qty ?? '',
    })), 'inventory-ledger');
  };

  const typePill = (type: string) => {
    const map: Record<string, string> = {
      opening: 'bg-ui-page-alt text-ui-muted',
      purchase: 'bg-ui-info-soft text-ui-info',
      sale: 'bg-ui-success-soft text-ui-success  dark:text-ui-success',
      refund: 'bg-ui-info-soft text-ui-info',
      production: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
      waste: 'bg-ui-warning-soft text-ui-warning',
      transfer: 'bg-ui-info-soft text-ui-info',
      adjustment: 'bg-ui-danger-soft text-ui-danger',
    };
    return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[type] || map.opening}`}>
      {entryTypes.find((x) => x.key === type)?.label || type}
    </span>;
  };

  const columns: Column<LedgerRow>[] = [
    { key: 'created_at', header: t('from'), render: (r) => (
      <div className="text-sm">
        <p className="text-ui-text">{formatDateTime(r.entry.created_at, lang)}</p>
        <p className="text-xs text-ui-subtle">#{r.entry.id}</p>
      </div>
    )},
    { key: 'entry_type', header: t('entryType'), render: (r) => typePill(r.entry.entry_type) },
    { key: 'item', header: t('product'), render: (r) => (
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-ui-page-alt flex items-center justify-center text-xs font-bold text-ui-subtle">
          <BookOpenText className="w-4 h-4" />
        </div>
        <div>
          <p className="font-medium text-ui-text">{r.entry.product?.name || r.entry.raw_material?.name || '-'}</p>
          {r.entry.product && <p className="text-xs text-purple-500 dark:text-purple-400">{t('product')}</p>}
          {r.entry.raw_material && <p className="text-xs text-ui-success dark:text-ui-success">{t('rawMaterial')}</p>}
        </div>
      </div>
    )},
    { key: 'warehouse', header: t('warehouse'), render: (r) => (r.entry.warehouse as Warehouse | undefined)?.name || '-' },
    { key: 'batch', header: t('batchNumber'), render: (r) => r.entry.batch_number || '-' },
    { key: 'quantity', header: t('quantity'), render: (r) => (
      <span className={`font-semibold ${r.entry.quantity >= 0 ? 'text-ui-success dark:text-ui-success' : 'text-ui-danger'}`}>
        {r.entry.quantity >= 0 ? '+' : ''}{formatNumber(Number(r.entry.quantity))}
      </span>
    )},
    { key: 'unit_cost', header: t('unitCost'), render: (r) => formatNumber(Number(r.entry.unit_cost), 2) },
    { key: 'total_cost', header: t('totalCost'), render: (r) => formatNumber(Number(r.entry.total_cost), 2) },
    { key: 'reference', header: t('referenceNumber'), render: (r) => r.entry.reference_number || '-' },
  ];

  return (
    <DesignSurface testId="inventory-ledger-page">
      <DesignPageHeader title={t('inventoryLedger')} subtitle={lang === 'ar' ? 'سجل كامل لحركات المخزون (منتجات ومواد خام)' : 'Full movement log for inventory (products and raw materials)'} actions={
        <button onClick={handleExport} className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border border-ui-border hover:bg-ui-page-alt dark:hover:bg-ui-surface text-ui-text transition-all">
          {t('exportExcel')}
        </button>
      } />

      <DesignPanel testId="inventory-ledger-search-panel">
        <div className="flex flex-col sm:flex-row gap-3">
          <DesignSearch value={search} onChange={setSearch} className="flex-1" label={t('search')} placeholder={t('search')} testId="inventory-ledger-search" />
          <Select value={entryType} onChange={(e) => setEntryType(e.target.value)} className="sm:w-48">
            <option value="all">{t('all')}</option>
            {entryTypes.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </Select>
          <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="sm:w-48">
            <option value="">{t('allBranches')}</option>
            {branches.map((br) => <option key={br.id} value={br.id}>{br.name}</option>)}
          </Select>
        </div>
      </DesignPanel>

      <DesignPanel testId="inventory-ledger-table-panel">
        <DataTable columns={columns} data={filtered} loading={loading} error={error} emptyMessage={t('noData')} />
        <DesignPagination loaded={rows.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
      </DesignPanel>
    </DesignSurface>
  );
}
