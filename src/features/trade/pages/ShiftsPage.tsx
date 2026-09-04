import { useEffect, useMemo, useState } from 'react';
import { Timer, Play, Square, Printer, FileText, CalendarCheck } from 'lucide-react';
import { supabase } from '@/api';
import * as api from '@/api';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import { useSettings } from '@/context/SettingsContext';
import { useBranches } from '@/hooks/useBranches';
import { DesignSurface, DesignPageHeader, DesignSearch, DesignPanel, DesignPagination } from '@/components/design';
import { DataTable, type Column } from '@/components/DataTable';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import { Button } from '@/components/Button';
import { Input, Textarea, Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { logAudit } from '@/lib/audit';
import type { Shift, RpcResult } from '@/lib/types';
import { fetchShiftClosingDetails, buildThermalZReportHtml, buildA4ZReportHtml } from '../services/shiftClosingReport';

interface ShiftUserRow { id: string; full_name: string | null; email: string | null; }

export function ShiftsPage() {
  const { t, lang } = useLanguage();
  const { show } = useToast();
  const { user } = useAuth();
  const branchFilter = useBranchFilter();
  const can = useCan();
  const isAr = lang === 'ar';

  const [branchSel, setBranchSel] = useState<string>(branchFilter || '');
  const { rows: items, loading, error, total, hasMore, loadMore, loadingMore, refresh: reloadShifts } = usePaginatedRows<Shift>({
    table: 'shifts',
    select: 'id, branch_id, cashier_id, opened_at, closed_at, opening_amount, expected_amount, actual_amount, difference, status, notes, created_at',
    order: { column: 'opened_at', ascending: false },
    branch_id: branchSel || branchFilter,
    pageSize: 100,
  });
  const [search, setSearch] = useState('');
  const { branches } = useBranches();
  const { effectiveSettings } = useSettings();
  const currency = effectiveSettings(branchSel || branchFilter)?.currency || 'EGP';
  const [users, setUsers] = useState<ShiftUserRow[]>([]);

  const [openModal, setOpenModal] = useState(false);
  const [openForm, setOpenForm] = useState({ opening_amount: 0, notes: '' });

  const [closeTarget, setCloseTarget] = useState<Shift | null>(null);
  const [closeForm, setCloseForm] = useState({ actual_amount: 0, notes: '' });
  const [printingId, setPrintingId] = useState<string | null>(null);

  const isCashier = user?.role === 'cashier';

  async function loadMeta() {
    const { data } = await supabase.from('users').select('id, full_name, email');
    setUsers((data as ShiftUserRow[]) || []);
  }
  useEffect(() => { loadMeta(); }, []);

  const joinedItems = useMemo(() => {
    const cashierById = new Map(users.map((u) => [u.id, u]));
    return items.map((s) => ({
      ...s,
      branch: branches.find((b) => b.id === s.branch_id),
      cashier: cashierById.get(s.cashier_id) as unknown as Shift['cashier'],
    }));
  }, [items, users, branches]);

  const openShift = async () => {
    if (!user?.branch_id) { show(t('selectBranchFirst'), 'error'); return; }
    const { data, error } = await api.shifts.open({
      p_branch_id: user.branch_id,
      p_opening_amount: openForm.opening_amount || 0,
      p_notes: openForm.notes || null,
    });
    if (error) { show(error.message, 'error'); return; }
    const res = data as RpcResult | null;
    if (!res?.success) {
      show(res?.detail || res?.error || t('error'), 'error');
      if (res?.error === 'SHIFT_ALREADY_OPEN') { setOpenModal(false); reloadShifts(); }
      return;
    }
    await logAudit('create', 'shifts', res.shift_id || '', { opening_amount: openForm.opening_amount });
    show(t('shiftOpened'), 'success');
    setOpenModal(false);
    setOpenForm({ opening_amount: 0, notes: '' });
    reloadShifts();
  };

  const closeShift = async () => {
    if (!closeTarget) return;
    const { data, error } = await api.shifts.close({
      p_shift_id: closeTarget.id,
      p_actual_amount: closeForm.actual_amount,
      p_notes: closeForm.notes || null,
    });
    if (error) { show(error.message, 'error'); return; }
    const res = data as RpcResult | null;
    if (!res?.success) { show(res?.detail || res?.error || t('error'), 'error'); return; }
    await logAudit('update', 'shifts', closeTarget.id, { expected: res.expected, actual: res.actual, difference: res.difference });
    show(t('shiftClosed'), 'success');
    setCloseTarget(null);
    setCloseForm({ actual_amount: 0, notes: '' });
    reloadShifts();
  };

  const handlePrintZReport = async (shift: Shift, format: 'thermal' | 'a4') => {
    setPrintingId(shift.id);
    try {
      const summary = await fetchShiftClosingDetails(shift.id, shift.branch_id);
      const html = format === 'thermal'
        ? buildThermalZReportHtml(summary, currency, lang)
        : buildA4ZReportHtml(summary, currency, lang);

      const w = window.open('', '_blank', format === 'thermal' ? 'width=380,height=600' : 'width=900,height=800');
      if (w) {
        w.document.write(html);
        w.document.close();
      }
    } catch (err: unknown) {
      show(err instanceof Error ? err.message : 'Error generating report', 'error');
    } finally {
      setPrintingId(null);
    }
  };

  const filtered = joinedItems.filter((i) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return i.id?.toLowerCase().includes(s) || i.cashier?.full_name?.toLowerCase().includes(s) || i.branch?.name?.toLowerCase().includes(s);
  });

  const columns: Column<Shift>[] = [
    { key: 'opened_at', header: t('openedAt'), render: (r) => <span className="text-sm text-ui-muted">{formatDateTime(r.opened_at, lang)}</span> },
    { key: 'branch', header: t('branch'), render: (r) => r.branch?.name || '-' },
    { key: 'cashier', header: t('cashier'), render: (r) => r.cashier?.full_name || r.cashier?.email || '-' },
    { key: 'status', header: t('shiftStatus'), render: (r) => (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
        r.status === 'open' ? 'bg-ui-success-soft text-ui-success' :
        'bg-ui-page-alt text-ui-muted'
      }`}>
        {t(r.status === 'open' ? 'open' : 'closed')}
      </span>
    )},
    { key: 'opening_amount', header: t('openingAmount'), render: (r) => <span className="text-sm">{formatCurrency(r.opening_amount, currency, lang)}</span> },
    { key: 'expected_amount', header: t('expectedAmount'), render: (r) => <span className="text-sm">{formatCurrency(r.expected_amount, currency, lang)}</span> },
    { key: 'actual_amount', header: t('actualAmount'), render: (r) => <span className="text-sm">{formatCurrency(r.actual_amount ?? 0, currency, lang)}</span> },
    { key: 'difference', header: t('difference'), render: (r) => (
      <span className={`text-sm font-semibold ${Math.abs(r.difference) > 0.009 ? 'text-ui-danger' : 'text-ui-success'}`}>
        {formatCurrency(r.difference, currency, lang)}
      </span>
    )},
    { key: 'closed_at', header: t('closedAt'), render: (r) => r.closed_at ? <span className="text-sm text-ui-subtle">{formatDateTime(r.closed_at, lang)}</span> : '-' },
    { key: 'actions', header: t('actions'), render: (r) => (
      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => handlePrintZReport(r, 'thermal')}
          disabled={printingId === r.id}
          className="p-1.5 rounded-md hover:bg-ui-info-soft text-ui-info transition"
          title={isAr ? 'طباعة إيصال Z-Report حراري' : 'Print Thermal Z-Report'}
        >
          <Printer className="w-4 h-4" />
        </button>
        <button
          onClick={() => handlePrintZReport(r, 'a4')}
          disabled={printingId === r.id}
          className="p-1.5 rounded-md hover:bg-ui-primary-soft text-ui-primary transition"
          title={isAr ? 'طباعة تقرير إغلاق A4 تفصيلي (المبيعات والمكونات)' : 'Print A4 Full Closing Report'}
        >
          <FileText className="w-4 h-4" />
        </button>
        {r.status === 'open' && can('shifts.close') && (
          <button
            onClick={() => { setCloseTarget(r); setCloseForm({ actual_amount: r.expected_amount, notes: '' }); }}
            className="p-1.5 rounded-md hover:bg-ui-danger-soft text-ui-danger transition"
            title={isAr ? 'إغلاق اليوم والوردية' : t('closeShift')}
          >
            <Square className="w-4 h-4" />
          </button>
        )}
      </div>
    )},
  ];

  const openShifts = items.filter((s) => s.status === 'open');

  return (
    <DesignSurface testId="shifts-page">
      <DesignPageHeader
        title={isAr ? 'إدارة وإغلاق الورديات واليومية' : t('shifts')}
        subtitle={isAr ? 'مراقبة الورديات، إغلاق اليومية، وطباعة تقارير Z-Report وتفاصيل المبيعات والمكونات' : 'Manage shifts, close day, and print comprehensive Z-reports with ingredients & sales'}
        actions={
          <div className="flex gap-2">
            {openShifts.length > 0 && (
              <Button
                variant="outline"
                onClick={() => handlePrintZReport(openShifts[0], 'a4')}
              >
                <CalendarCheck className="w-4 h-4" /> {isAr ? 'تقرير اليومية المباشر' : 'Live Daily Report'}
              </Button>
            )}
            {isCashier && can('shifts.open') && (
              <Button onClick={() => setOpenModal(true)}>
                <Play className="w-4 h-4" /> {t('openShift')}
              </Button>
            )}
          </div>
        }
      />

      {isCashier && openShifts.length > 0 && (
        <DesignPanel className="border-brand-200 dark:border-brand-800 bg-brand-50/50 dark:bg-brand-900/10" testId="shifts-open-banner">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3">
              <Timer className="w-6 h-6 text-brand-600 dark:text-brand-400" />
              <div>
                <p className="font-semibold text-brand-800 dark:text-brand-300">{t('open')} · {formatDateTime(openShifts[0].opened_at, lang)}</p>
                <p className="text-sm text-brand-700 dark:text-brand-400">{t('expectedAmount')}: {formatCurrency(openShifts[0].expected_amount, currency, lang)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => handlePrintZReport(openShifts[0], 'thermal')}>
                <Printer className="w-4 h-4" /> {isAr ? 'إيصال Z-Report' : 'Thermal Z-Report'}
              </Button>
              {can('shifts.close') && (
                <Button variant="danger" size="sm" onClick={() => { setCloseTarget(openShifts[0]); setCloseForm({ actual_amount: openShifts[0].expected_amount, notes: '' }); }}>
                  <Square className="w-4 h-4" /> {isAr ? 'إغلاق اليوم والوردية' : t('closeShift')}
                </Button>
              )}
            </div>
          </div>
        </DesignPanel>
      )}

      <DesignPanel testId="shifts-search-panel">
        <div className="flex flex-col sm:flex-row gap-3">
          <DesignSearch value={search} onChange={setSearch} className="flex-1" label={t('search')}
            placeholder={isAr ? 'بحث بالفرع أو الكاشير...' : 'Search by branch or cashier...'} testId="shifts-search" />
          {!branchFilter && (
            <Select label={t('filterByBranch')} value={branchSel} onChange={(e) => setBranchSel(e.target.value)} className="sm:w-64">
              <option value="">{t('allBranches')}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          )}
        </div>
      </DesignPanel>

      <DesignPanel testId="shifts-table-panel">
        <DataTable columns={columns} data={filtered} loading={loading} error={error} emptyMessage={t('noData')} />
        <DesignPagination loaded={items.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
      </DesignPanel>

      <Modal open={openModal} onClose={() => setOpenModal(false)} title={t('openShift')}>
        <div className="space-y-4">
          <div className="p-4 bg-ui-page-alt rounded-lg text-sm text-ui-muted">
            {isAr
              ? `الفرع: ${branches.find((b) => b.id === user?.branch_id)?.name || '-'}`
              : `Branch: ${branches.find((b) => b.id === user?.branch_id)?.name || '-'}`}
          </div>
          <Input type="number" min={0} step="0.01" label={t('openingAmount')} value={String(openForm.opening_amount)}
            onChange={(e) => setOpenForm({ ...openForm, opening_amount: Number(e.target.value) })} />
          <Textarea label={t('notes')} value={openForm.notes} onChange={(e) => setOpenForm({ ...openForm, notes: e.target.value })} rows={2} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpenModal(false)}>{t('cancel')}</Button>
            <Button onClick={openShift}><Play className="w-4 h-4" /> {t('openShift')}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!closeTarget} onClose={() => setCloseTarget(null)} title={isAr ? 'إغلاق اليوم والوردية (Z-Report)' : t('closeShift')}>
        {closeTarget && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-3 bg-ui-page-alt rounded-lg">
                <p className="text-xs text-ui-subtle mb-1">{t('openingAmount')}</p>
                <p className="font-semibold">{formatCurrency(closeTarget.opening_amount, currency, lang)}</p>
              </div>
              <div className="p-3 bg-ui-primary-soft rounded-lg">
                <p className="text-xs text-ui-subtle mb-1">{t('expectedAmount')}</p>
                <p className="font-semibold text-ui-primary">{formatCurrency(closeTarget.expected_amount, currency, lang)}</p>
              </div>
              <div className="p-3 bg-ui-page-alt rounded-lg">
                <p className="text-xs text-ui-subtle mb-1">{t('cashSales')}</p>
                <p className="font-semibold">{formatCurrency(closeTarget.expected_amount - closeTarget.opening_amount, currency, lang)}</p>
              </div>
            </div>

            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" className="flex-1" onClick={() => handlePrintZReport(closeTarget, 'thermal')}>
                <Printer className="w-4 h-4" /> {isAr ? 'معاينة إيصال Z-Report' : 'Preview Thermal'}
              </Button>
              <Button type="button" variant="outline" size="sm" className="flex-1" onClick={() => handlePrintZReport(closeTarget, 'a4')}>
                <FileText className="w-4 h-4" /> {isAr ? 'معاينة تقرير A4' : 'Preview A4'}
              </Button>
            </div>

            <Input type="number" min={0} step="0.01" label={isAr ? 'المبلغ الفعلي بالدرج (العد الفعلي) *' : t('actualAmount')} value={String(closeForm.actual_amount)}
              onChange={(e) => setCloseForm({ ...closeForm, actual_amount: Number(e.target.value) })} />
            <Textarea label={isAr ? 'ملاحظات إغلاق اليوم والوردية' : t('notes')} value={closeForm.notes} onChange={(e) => setCloseForm({ ...closeForm, notes: e.target.value })} rows={2} />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setCloseTarget(null)}>{t('cancel')}</Button>
              <Button variant="danger" onClick={closeShift}><Square className="w-4 h-4" /> {isAr ? 'تأكيد إغلاق اليوم والوردية' : t('closeShift')}</Button>
            </div>
          </div>
        )}
      </Modal>
    </DesignSurface>
  );
}

