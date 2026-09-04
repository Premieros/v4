import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Plus, CheckCircle2, XCircle, ArrowLeftRight, Trash2 } from 'lucide-react';
import { supabase } from '@/api';
import * as api from '@/api';
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
import { formatDateTime } from '@/lib/format';
import { logAudit } from '@/lib/audit';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import { useOperationalGuard, PrerequisiteAlertBanner, PREREQUISITE_STEPS } from '@/core/guard';
import type { WarehouseTransfer, Warehouse, Product, Branch, RpcResult } from '@/lib/types';
interface TransferLine {
  product_id: string;
  quantity: number;
  unit_cost: number;
}

const EMPTY_LINE: TransferLine = { product_id: '', quantity: 1, unit_cost: 0 };

export function TransfersPage() {
  const { t, lang } = useLanguage();
  const { show } = useToast();
  const can = useCan();
  const { user } = useAuth();
  const branchFilter = useBranchFilter();
  const location = useLocation();
  const {
    guardTransfer,
    interceptDbError,
    startGuidance,
  } = useOperationalGuard();

  const { rows: transfers, loading, error, total, hasMore, loadMore, loadingMore, refresh: reloadTransfers } = usePaginatedRows<WarehouseTransfer>({
    table: 'warehouse_transfers',
    select: '*, from_warehouse:warehouses!warehouse_transfers_from_warehouse_id_fkey(*), to_warehouse:warehouses!warehouse_transfers_to_warehouse_id_fkey(*), branch:branches(*), requester:users!warehouse_transfers_requested_by_fkey(id, full_name, email)',
    order: { column: 'created_at', ascending: false },
    pageSize: 100,
  });
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [search, setSearch] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    from_warehouse_id: '', to_warehouse_id: '', branch_id: '', reason: '', notes: '',
  });
  const [lines, setLines] = useState<TransferLine[]>([{ ...EMPTY_LINE }]);

  const [rejectTarget, setRejectTarget] = useState<WarehouseTransfer | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  async function loadMeta() {
    const [w, pr, br] = await Promise.all([
      supabase.from('warehouses').select('*').eq('is_active', true).order('name'),
      supabase.from('products').select('*').eq('is_active', true).order('name'),
      supabase.from('branches').select('*').eq('is_active', true).order('name'),
    ]);
    setWarehouses((w.data as Warehouse[]) || []);
    setProducts((pr.data as Product[]) || []);
    setBranches((br.data as Branch[]) || []);
  }
  useEffect(() => { loadMeta(); }, []);

  // Restore draft if returning from guided prerequisite setup
  useEffect(() => {
    const state = location.state as { restoredDraft?: { form?: typeof form; lines?: TransferLine[] }; fromGuidance?: boolean } | null;
    if (state?.fromGuidance && state?.restoredDraft) {
      if (state.restoredDraft.form) setForm((prev) => ({ ...prev, ...state.restoredDraft?.form }));
      if (state.restoredDraft.lines) setLines(state.restoredDraft.lines);
      setModalOpen(true);
    }
  }, [location.state]);

  const filtered = transfers.filter((tr) => {
    if (branchFilter && tr.branch_id !== branchFilter) return false;
    if (!search) return true;
    return tr.transfer_number.toLowerCase().includes(search.toLowerCase())
      || (tr.from_warehouse?.name || '').toLowerCase().includes(search.toLowerCase())
      || (tr.to_warehouse?.name || '').toLowerCase().includes(search.toLowerCase());
  });

  const openAdd = () => {
    const allowed = guardTransfer({
      warehousesCount: warehouses.length,
      formData: { form, lines },
    });
    if (!allowed) return;

    setForm({
      from_warehouse_id: warehouses[0]?.id || '',
      to_warehouse_id: warehouses[1]?.id || '',
      branch_id: user?.branch_id || branchFilter || branches[0]?.id || '',
      reason: '',
      notes: '',
    });
    setLines([{ ...EMPTY_LINE }]);
    setModalOpen(true);
  };

  const lookupAvgCost = async (productId: string, warehouseId: string): Promise<number> => {
    if (!productId || !warehouseId) return 0;
    const { data } = await supabase.from('inventory_batches')
      .select('unit_cost, quantity')
      .eq('product_id', productId)
      .eq('warehouse_id', warehouseId);
    const rows = (data as { unit_cost: number; quantity: number }[]) || [];
    const totalQty = rows.reduce((s, r) => s + Number(r.quantity), 0);
    if (totalQty <= 0) return 0;
    return rows.reduce((s, r) => s + Number(r.unit_cost) * Number(r.quantity), 0) / totalQty;
  };

  const updateLineProduct = async (idx: number, productId: string) => {
    const linesCopy = lines.map((l) => ({ ...l }));
    linesCopy[idx].product_id = productId;
    const cost = await lookupAvgCost(productId, form.from_warehouse_id);
    linesCopy[idx].unit_cost = Number(cost.toFixed(2));
    setLines(linesCopy);
  };

  const updateLine = (idx: number, field: keyof TransferLine, value: string | number) =>
    setLines(lines.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  const addLine = () => setLines([...lines, { ...EMPTY_LINE }]);
  const removeLine = (idx: number) => setLines(lines.filter((_, i) => i !== idx));

  const createTransfer = async () => {
    const allowed = guardTransfer({
      warehousesCount: warehouses.length,
      formData: { form, lines },
    });
    if (!allowed) return;

    if (!form.from_warehouse_id || !form.to_warehouse_id || form.from_warehouse_id === form.to_warehouse_id) {
      show(t('required') + ': ' + t('fromWarehouse'), 'error');
      return;
    }
    if (!form.branch_id) { show(t('required') + ': ' + t('branch'), 'error'); return; }
    const validLines = lines.filter((l) => l.product_id && l.quantity > 0);
    if (validLines.length === 0) { show(t('required') + ': ' + t('transferItems'), 'error'); return; }

    const { data, error } = await api.inventory.createTransfer({
      p_from_warehouse_id: form.from_warehouse_id,
      p_to_warehouse_id: form.to_warehouse_id,
      p_branch_id: form.branch_id,
      p_items: validLines.map((l) => ({
        product_id: l.product_id,
        quantity: l.quantity,
        unit_cost: l.unit_cost,
      })),
      p_reason: form.reason || null,
      p_notes: form.notes || null,
    });
    if (error) {
      const handled = interceptDbError(error, 'transfer_create', 'التحويل المخزني', 'Warehouse Transfer', { form, lines });
      if (!handled) show(error.message, 'error');
      return;
    }
    const result = data as RpcResult | null;
    if (!result?.success) {
      const handled = interceptDbError(result?.detail || result?.error, 'transfer_create', 'التحويل المخزني', 'Warehouse Transfer', { form, lines });
      if (!handled) show(result?.detail || result?.error || t('error'), 'error');
      return;
    }
    await logAudit('create', 'warehouse_transfers', result.transfer_id, { number: result.transfer_number });
    show(t('saveSuccess'), 'success');
    setModalOpen(false);
    reloadTransfers();
  };

  const approve = async (tr: WarehouseTransfer) => {
    const { data, error } = await api.inventory.approveTransfer({ p_transfer_id: tr.id });
    if (error) { show(error.message, 'error'); return; }
    const result = data as RpcResult | null;
    if (!result?.success) { show(result?.detail || result?.error || t('error'), 'error'); return; }
    await logAudit('update', 'warehouse_transfers', tr.id, { action: 'approve' });
    show(t('saveSuccess'), 'success');
    reloadTransfers();
  };

  const openReject = (tr: WarehouseTransfer) => { setRejectTarget(tr); setRejectReason(''); };

  const doReject = async () => {
    if (!rejectTarget) return;
    const { data, error } = await api.inventory.rejectTransfer({
      p_transfer_id: rejectTarget.id,
      p_reason: rejectReason || null,
    });
    if (error) { show(error.message, 'error'); return; }
    const result = data as RpcResult | null;
    if (!result?.success) { show(result?.detail || result?.error || t('error'), 'error'); return; }
    await logAudit('update', 'warehouse_transfers', rejectTarget.id, { action: 'reject', reason: rejectReason });
    show(t('saveSuccess'), 'success');
    setRejectTarget(null);
    reloadTransfers();
  };

  const statusPill = (status: string) => {
    const map: Record<string, string> = {
      pending: 'bg-ui-warning-soft text-ui-warning',
      approved: 'bg-ui-success-soft text-ui-success',
      rejected: 'bg-ui-danger-soft text-ui-danger',
    };
    const label: Record<string, string> = {
      pending: t('statusPending'),
      approved: t('statusApproved'),
      rejected: t('statusRejected'),
    };
    return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[status] || map.pending}`}>{label[status] || status}</span>;
  };

  const columns: Column<WarehouseTransfer>[] = [
    { key: 'transfer_number', header: t('transferNumber'), render: (tr) => (
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-ui-info-soft flex items-center justify-center text-ui-info">
          <ArrowLeftRight className="w-4 h-4" />
        </div>
        <div>
          <p className="font-semibold text-ui-text">{tr.transfer_number}</p>
          {tr.reason && <p className="text-xs text-ui-subtle">{tr.reason}</p>}
        </div>
      </div>
    )},
    { key: 'from', header: t('fromWarehouse'), render: (tr) => tr.from_warehouse?.name || '-' },
    { key: 'to', header: t('toWarehouse'), render: (tr) => tr.to_warehouse?.name || '-' },
    { key: 'branch', header: t('branch'), render: (tr) => tr.branch?.name || '-' },
    { key: 'status', header: t('status'), render: (tr) => statusPill(tr.status) },
    { key: 'requested_at', header: t('requestedAt'), render: (tr) => formatDateTime(tr.requested_at, lang) },
    { key: 'actions', header: t('actions'), render: (tr) => (
      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
        {can('inventory.transfers.approve') && tr.status === 'pending' && (
          <button onClick={() => approve(tr)} className="p-1.5 rounded-md hover:bg-ui-success-soft text-ui-success" title={t('approveTransfer')}>
            <CheckCircle2 className="w-4 h-4" />
          </button>
        )}
        {can('inventory.transfers.approve') && tr.status === 'pending' && (
          <button onClick={() => openReject(tr)} className="p-1.5 rounded-md hover:bg-ui-danger-soft text-ui-danger" title={t('rejectTransfer')}>
            <XCircle className="w-4 h-4" />
          </button>
        )}
      </div>
    )},
  ];

  return (
    <DesignSurface testId="transfers-page">
      <DesignPageHeader title={t('warehouseTransfers')} subtitle={t('transfers')} actions={
        can('inventory.transfers') ? (
          <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4" /> {t('newTransfer')}</Button>
        ) : undefined
      } />

      {warehouses.length < 2 && !loading && (
        <PrerequisiteAlertBanner
          step={PREREQUISITE_STEPS.create_second_warehouse}
          onAction={() =>
            startGuidance(
              PREREQUISITE_STEPS.create_second_warehouse,
              'transfer_create',
              location.pathname,
              { form, lines },
              'التحويل المخزني',
              'Warehouse Transfers'
            )
          }
        />
      )}

      <DesignPanel testId="transfers-search-panel">
        <DesignSearch value={search} onChange={setSearch} label={t('search')} placeholder={t('search')} testId="transfers-search" />
      </DesignPanel>

      <DesignPanel testId="transfers-table-panel">
        <DataTable columns={columns} data={filtered} loading={loading} error={error} emptyMessage={t('noData')} />
        <DesignPagination loaded={transfers.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
      </DesignPanel>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={t('newTransfer')} size="lg">
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select label={t('fromWarehouse')} value={form.from_warehouse_id} onChange={(e) => setForm({ ...form, from_warehouse_id: e.target.value })}>
              <option value="">{t('fromWarehouse')}</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
            <Select label={t('toWarehouse')} value={form.to_warehouse_id} onChange={(e) => setForm({ ...form, to_warehouse_id: e.target.value })}>
              <option value="">{t('toWarehouse')}</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
            <Select label={t('branch')} value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })} disabled={!!branchFilter}>
              <option value="">{t('branch')}</option>
              {branches.map((br) => <option key={br.id} value={br.id}>{br.name}</option>)}
            </Select>
            <Input label={t('reason')} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-bold text-ui-muted">{t('transferItems')}</p>
              <Button variant="outline" size="sm" onClick={addLine}><Plus className="w-4 h-4" /> {t('add')}</Button>
            </div>
            <div className="space-y-2">
              {lines.map((l, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_110px_110px_36px] gap-2 items-end">
                  <Select value={l.product_id} onChange={(e) => updateLineProduct(idx, e.target.value)}>
                    <option value="">{t('selectProduct')}</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                  <Input type="number" step="0.0001" value={l.quantity} onChange={(e) => updateLine(idx, 'quantity', parseFloat(e.target.value) || 0)} placeholder={t('quantity')} />
                  <Input type="number" step="0.01" value={l.unit_cost} onChange={(e) => updateLine(idx, 'unit_cost', parseFloat(e.target.value) || 0)} placeholder={t('unitCost')} />
                  <button onClick={() => removeLine(idx)} className="p-2 rounded-lg text-ui-danger hover:bg-ui-danger-soft" title={t('delete')}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <Input label={t('notes')} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</Button>
            <Button onClick={createTransfer}>{t('save')}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!rejectTarget} onClose={() => setRejectTarget(null)} title={t('rejectTransfer')} size="sm">
        {rejectTarget && (
          <div className="space-y-4">
            <p className="text-sm text-ui-muted">{t('transferNumber')}: <b>{rejectTarget.transfer_number}</b></p>
            <Input label={t('rejectReason')} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRejectTarget(null)}>{t('cancel')}</Button>
              <Button variant="danger" onClick={doReject}>{t('rejectTransfer')}</Button>
            </div>
          </div>
        )}
      </Modal>
    </DesignSurface>
  );
}
