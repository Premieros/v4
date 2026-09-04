import { useEffect, useState, useCallback } from 'react';
import { HandCoins, Phone, User, Building2 } from 'lucide-react';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { DesignSurface, DesignPageHeader, DesignSearch, DesignPanel, DesignPagination } from '@/components/design';
import { StatCard } from '@/components/PageHeader';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Input, Select, Textarea } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { logAudit } from '@/lib/audit';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { isAdminRole } from '@/lib/permissions';
import { useSettings } from '@/context/SettingsContext';
import { useBranches } from '@/hooks/useBranches';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import type { ArAgingRow, ApAgingRow, CustomerPayment, SupplierPayment } from '@/lib/types';

type Tab = 'ar' | 'ap';

export function PaymentsPage() {
  const { t, lang } = useLanguage();
  const { show } = useToast();
  const { user } = useAuth();
  const branchFilter = useBranchFilter();
  const { effectiveSettings } = useSettings();
  const { branches } = useBranches();
  const [tab, setTab] = useState<Tab>('ar');
  const [rows, setRows] = useState<ArAgingRow[]>([]);
  const [apRows, setApRows] = useState<ApAgingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [adminBranchFilter, setAdminBranchFilter] = useState('');
  const effectiveBranchFilter = isAdminRole(user?.role) ? (adminBranchFilter || null) : branchFilter;
  const currency = effectiveSettings(effectiveBranchFilter)?.currency || 'EGP';
  const isAr = lang === 'ar';
  const { rows: payments, loading: paymentsLoading, error: paymentsError, total: paymentsTotal, hasMore: paymentsHasMore, loadMore: loadMorePayments, loadingMore: loadingMorePayments, refresh: reloadPayments } = usePaginatedRows<CustomerPayment>({
    table: 'customer_payments',
    select: 'id, amount, payment_method, reference_number, notes, created_at, customer:customers(name)',
    order: { column: 'created_at', ascending: false },
    branch_id: effectiveBranchFilter,
    pageSize: 100,
    enabled: !!effectiveBranchFilter,
  });
  const { rows: supplierPayments, loading: supplierPaymentsLoading, error: supplierPaymentsError, total: supplierPaymentsTotal, hasMore: supplierPaymentsHasMore, loadMore: loadMoreSupplierPayments, loadingMore: loadingMoreSupplierPayments, refresh: reloadSupplierPayments } = usePaginatedRows<SupplierPayment>({
    table: 'supplier_payments',
    select: 'id, amount, payment_method, reference_number, notes, created_at, supplier:suppliers(name)',
    order: { column: 'created_at', ascending: false },
    branch_id: effectiveBranchFilter,
    pageSize: 100,
    enabled: !!effectiveBranchFilter,
  });

  const [collecting, setCollecting] = useState<ArAgingRow | null>(null);
  const [openInvoices, setOpenInvoices] = useState<{ id: string; invoice_number: string; open: number }[]>([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ sale_id: '', amount: '', payment_method: 'cash', notes: '' });

  const [paying, setPaying] = useState<ApAgingRow | null>(null);
  const [openApInvoices, setOpenApInvoices] = useState<{ id: string; invoice_number: string; open: number }[]>([]);
  const [apForm, setApForm] = useState({ purchase_id: '', amount: '', payment_method: 'cash', notes: '' });

  const loadAging = useCallback(async () => {
    setLoading(true);
    try {
      if (effectiveBranchFilter) {
        const asOf = new Date().toISOString().slice(0, 10);
        const [{ data: aging }, { data: apAging }] = await Promise.all([
          api.accounting.getArAging({ p_branch_id: effectiveBranchFilter, p_as_of: asOf }),
          api.accounting.getApAging({ p_branch_id: effectiveBranchFilter, p_as_of: asOf }),
        ]);
        setRows(((aging as ArAgingRow[]) || []).map((r) => ({ ...r, id: r.customer_id })));
        setApRows(((apAging as ApAgingRow[]) || []).map((r) => ({ ...r, id: r.supplier_id })));
      } else {
        setRows([]);
        setApRows([]);
      }
    } finally {
      setLoading(false);
    }
  }, [effectiveBranchFilter]);

  useEffect(() => { loadAging(); }, [loadAging]);

  const filtered = rows.filter((r) => !search || r.name.toLowerCase().includes(search.toLowerCase()) || (r.phone || '').includes(search));
  const filteredAp = apRows.filter((r) => !search || r.name.toLowerCase().includes(search.toLowerCase()) || (r.phone || '').includes(search));

  async function openCollect(row: ArAgingRow) {
    setCollecting(row);
    setForm({ sale_id: '', amount: String(row.open_amount), payment_method: 'cash', notes: '' });
    const { data } = await supabase
      .from('sales')
      .select('id, invoice_number, total, paid_amount, refunded_amount')
      .eq('customer_id', row.customer_id)
      .eq('branch_id', effectiveBranchFilter)
      .neq('status', 'returned')
      .order('created_at', { ascending: true });
    const inv = ((data as { id: string; invoice_number: string; total: number; paid_amount: number; refunded_amount: number | null }[]) || [])
      .map((s) => ({ id: s.id, invoice_number: s.invoice_number, open: Number(s.total) - Number(s.paid_amount) - Number(s.refunded_amount || 0) }))
      .filter((s) => s.open > 0);
    setOpenInvoices(inv);
  }

  async function openPay(row: ApAgingRow) {
    setPaying(row);
    setApForm({ purchase_id: '', amount: String(row.open_amount), payment_method: 'cash', notes: '' });
    const { data } = await supabase
      .from('purchases')
      .select('id, invoice_number, total, paid_amount, returned_amount')
      .eq('supplier_id', row.supplier_id)
      .eq('branch_id', effectiveBranchFilter)
      .eq('status', 'completed')
      .order('created_at', { ascending: true });
    const inv = ((data as { id: string; invoice_number: string; total: number; paid_amount: number; returned_amount: number | null }[]) || [])
      .map((s) => ({ id: s.id, invoice_number: s.invoice_number, open: Number(s.total) - Number(s.paid_amount) - Number(s.returned_amount || 0) }))
      .filter((s) => s.open > 0);
    setOpenApInvoices(inv);
  }

  const collect = async () => {
    if (!collecting) return;
    const amount = Number(form.amount);
    if (!amount || amount <= 0) { show(t('required'), 'error'); return; }
    setSaving(true);
    const { data, error } = await api.accounting.receivePayment( {
      p_customer_id: collecting.customer_id,
      p_branch_id: effectiveBranchFilter,
      p_amount: amount,
      p_payment_method: form.payment_method,
      p_sale_id: form.sale_id || null,
      p_notes: form.notes || null,
    });
    setSaving(false);
    if (error) { show(error.message, 'error'); return; }
    const r = data as { success: boolean; error?: string; detail?: string; reference_number?: string } | null;
    if (!r?.success) { show(r?.detail || r?.error || t('error'), 'error'); return; }
    show(`${t('collect')} ${formatCurrency(amount, currency, lang)} (${r.reference_number || ''})`, 'success');
    await logAudit('create', 'customer_payments', undefined, { customer_id: collecting.customer_id, amount });
    setCollecting(null);
    loadAging();
    reloadPayments();
  };

  const paySupplier = async () => {
    if (!paying) return;
    const amount = Number(apForm.amount);
    if (!amount || amount <= 0) { show(t('required'), 'error'); return; }
    setSaving(true);
    const { data, error } = await api.accounting.paySupplier( {
      p_supplier_id: paying.supplier_id,
      p_branch_id: effectiveBranchFilter,
      p_amount: amount,
      p_payment_method: apForm.payment_method,
      p_purchase_id: apForm.purchase_id || null,
      p_notes: apForm.notes || null,
    });
    setSaving(false);
    if (error) { show(error.message, 'error'); return; }
    const r = data as { success: boolean; error?: string; detail?: string; reference_number?: string } | null;
    if (!r?.success) { show(r?.detail || r?.error || t('error'), 'error'); return; }
    show(`${t('paySupplier')} ${formatCurrency(amount, currency, lang)} (${r.reference_number || ''})`, 'success');
    await logAudit('create', 'supplier_payments', undefined, { supplier_id: paying.supplier_id, amount });
    setPaying(null);
    loadAging();
    reloadSupplierPayments();
  };

  const columns: Column<ArAgingRow>[] = [
    { key: 'name', header: t('customer'), render: (r) => <span className="font-medium text-ui-text">{r.name}</span> },
    { key: 'phone', header: t('phone'), render: (r) => r.phone || '-' },
    { key: 'open_amount', header: t('openBalance'), render: (r) => <span className="font-semibold text-ui-danger">{formatCurrency(r.open_amount, currency, lang)}</span> },
    { key: 'bucket_0_30', header: t('days30'), render: (r) => formatCurrency(r.bucket_0_30, currency, lang) },
    { key: 'bucket_31_60', header: t('days60'), render: (r) => formatCurrency(r.bucket_31_60, currency, lang) },
    { key: 'bucket_61_90', header: t('days90'), render: (r) => formatCurrency(r.bucket_61_90, currency, lang) },
    { key: 'bucket_90_plus', header: t('days90Plus'), render: (r) => <span className={r.bucket_90_plus > 0 ? 'text-ui-danger font-semibold' : ''}>{formatCurrency(r.bucket_90_plus, currency, lang)}</span> },
    { key: 'actions', header: t('actions'), render: (r) => <Button size="sm" onClick={() => openCollect(r)}><HandCoins className="w-4 h-4" /> {t('collect')}</Button> },
  ];

  const apColumns: Column<ApAgingRow>[] = [
    { key: 'name', header: t('supplier'), render: (r) => <span className="font-medium text-ui-text">{r.name}</span> },
    { key: 'phone', header: t('phone'), render: (r) => r.phone || '-' },
    { key: 'open_amount', header: t('openBalance'), render: (r) => <span className="font-semibold text-ui-danger">{formatCurrency(r.open_amount, currency, lang)}</span> },
    { key: 'bucket_0_30', header: t('days30'), render: (r) => formatCurrency(r.bucket_0_30, currency, lang) },
    { key: 'bucket_31_60', header: t('days60'), render: (r) => formatCurrency(r.bucket_31_60, currency, lang) },
    { key: 'bucket_61_90', header: t('days90'), render: (r) => formatCurrency(r.bucket_61_90, currency, lang) },
    { key: 'bucket_90_plus', header: t('days90Plus'), render: (r) => <span className={r.bucket_90_plus > 0 ? 'text-ui-danger font-semibold' : ''}>{formatCurrency(r.bucket_90_plus, currency, lang)}</span> },
    { key: 'actions', header: t('actions'), render: (r) => <Button size="sm" onClick={() => openPay(r)}><HandCoins className="w-4 h-4" /> {t('paySupplier')}</Button> },
  ];

  const paymentColumns: Column<CustomerPayment>[] = [
    { key: 'created_at', header: t('date'), render: (p) => formatDateTime(p.created_at, lang) },
    { key: 'customer', header: t('customer'), render: (p) => p.customer?.name || '-' },
    { key: 'reference_number', header: t('entryNumber'), render: (p) => <span className="font-mono text-xs">{p.reference_number}</span> },
    { key: 'payment_method', header: t('paymentMethod'), render: (p) => ({ cash: t('cash'), card: t('card'), transfer: t('transfer'), credit: t('credit') })[p.payment_method] || p.payment_method },
    { key: 'amount', header: t('amount'), render: (p) => <span className="font-semibold text-ui-success dark:text-ui-success">{formatCurrency(p.amount, currency, lang)}</span> },
  ];

  const supplierPaymentColumns: Column<SupplierPayment>[] = [
    { key: 'created_at', header: t('date'), render: (p) => formatDateTime(p.created_at, lang) },
    { key: 'supplier', header: t('supplier'), render: (p) => p.supplier?.name || '-' },
    { key: 'reference_number', header: t('entryNumber'), render: (p) => <span className="font-mono text-xs">{p.reference_number}</span> },
    { key: 'payment_method', header: t('paymentMethod'), render: (p) => ({ cash: t('cash'), card: t('card'), transfer: t('transfer'), credit: t('credit') })[p.payment_method] || p.payment_method },
    { key: 'amount', header: t('amount'), render: (p) => <span className="font-semibold text-ui-success dark:text-ui-success">{formatCurrency(p.amount, currency, lang)}</span> },
  ];

  return (
    <DesignSurface testId="payments-page">
      <DesignPageHeader title={t('receivePayment')} subtitle={t('customerPayments')} />

      <div className="flex gap-2 mb-6">
        <button onClick={() => setTab('ar')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${tab === 'ar' ? 'bg-brand-600 text-white' : 'bg-ui-page-alt text-ui-muted hover:bg-ui-page-alt dark:hover:bg-ui-page-alt'}`}>
          <User className="w-4 h-4" /> {t('customerPayments')}
        </button>
        <button onClick={() => setTab('ap')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${tab === 'ap' ? 'bg-brand-600 text-white' : 'bg-ui-page-alt text-ui-muted hover:bg-ui-page-alt dark:hover:bg-ui-page-alt'}`}>
          <Building2 className="w-4 h-4" /> {t('supplierPayments')}
        </button>
      </div>

      {tab === 'ar' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard title={t('openBalance')} value={formatCurrency(rows.reduce((s, r) => s + Number(r.open_amount), 0), currency, lang)} icon={<HandCoins className="w-5 h-5" />} color="red" />
          <StatCard title={t('days30')} value={formatCurrency(rows.reduce((s, r) => s + Number(r.bucket_0_30), 0), currency, lang)} icon={<HandCoins className="w-5 h-5" />} color="amber" />
          <StatCard title={t('days90')} value={formatCurrency(rows.reduce((s, r) => s + Number(r.bucket_61_90), 0), currency, lang)} icon={<HandCoins className="w-5 h-5" />} color="blue" />
          <StatCard title={t('days90Plus')} value={formatCurrency(rows.reduce((s, r) => s + Number(r.bucket_90_plus), 0), currency, lang)} icon={<HandCoins className="w-5 h-5" />} color="purple" />
        </div>
      )}

      {tab === 'ap' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard title={t('apTotal')} value={formatCurrency(apRows.reduce((s, r) => s + Number(r.open_amount), 0), currency, lang)} icon={<Building2 className="w-5 h-5" />} color="red" />
          <StatCard title={t('days30')} value={formatCurrency(apRows.reduce((s, r) => s + Number(r.bucket_0_30), 0), currency, lang)} icon={<Building2 className="w-5 h-5" />} color="amber" />
          <StatCard title={t('days90')} value={formatCurrency(apRows.reduce((s, r) => s + Number(r.bucket_61_90), 0), currency, lang)} icon={<Building2 className="w-5 h-5" />} color="blue" />
          <StatCard title={t('days90Plus')} value={formatCurrency(apRows.reduce((s, r) => s + Number(r.bucket_90_plus), 0), currency, lang)} icon={<Building2 className="w-5 h-5" />} color="purple" />
        </div>
      )}

      <DesignPanel testId="payments-search-panel">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <DesignSearch value={search} onChange={setSearch} className="flex-1 w-full" label={t('search')} placeholder={t('search')} testId="payments-search" />
          {isAdminRole(user?.role) && branches.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-ui-muted">{t('filterByBranch')}</label>
              <select value={adminBranchFilter} onChange={(e) => setAdminBranchFilter(e.target.value)}
                className="px-3 py-2 rounded-lg text-sm border border-ui-border bg-ui-surface text-ui-text">
                <option value="">{t('allBranches')}</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{isAr ? b.name : (b.name_en || b.name)}</option>)}
              </select>
            </div>
          )}
        </div>
      </DesignPanel>

      {tab === 'ar' ? (
        <>
          <DesignPanel title={t('arAging')} testId="payments-ar-aging-panel">
            <DataTable columns={columns} data={filtered} loading={loading} error={paymentsError} emptyMessage={t('noData')} />
          </DesignPanel>

          <DesignPanel title={t('customerPayments')} testId="payments-ar-table-panel">
            <DataTable columns={paymentColumns} data={payments} loading={paymentsLoading} error={paymentsError} emptyMessage={t('noData')} />
            <DesignPagination loaded={payments.length} total={paymentsTotal} hasMore={paymentsHasMore} loadingMore={loadingMorePayments} onLoadMore={loadMorePayments} />
          </DesignPanel>
        </>
      ) : (
        <>
          <DesignPanel title={t('apAging')} testId="payments-ap-aging-panel">
            <DataTable columns={apColumns} data={filteredAp} loading={loading} error={supplierPaymentsError} emptyMessage={t('noData')} />
          </DesignPanel>

          <DesignPanel title={t('supplierPayments')} testId="payments-ap-table-panel">
            <DataTable columns={supplierPaymentColumns} data={supplierPayments} loading={supplierPaymentsLoading} error={supplierPaymentsError} emptyMessage={t('noData')} />
            <DesignPagination loaded={supplierPayments.length} total={supplierPaymentsTotal} hasMore={supplierPaymentsHasMore} loadingMore={loadingMoreSupplierPayments} onLoadMore={loadMoreSupplierPayments} />
          </DesignPanel>
        </>
      )}

      <Modal open={!!collecting} onClose={() => setCollecting(null)} title={collecting ? `${t('collect')} - ${collecting.name}` : ''}>
        {collecting && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-ui-page-alt dark:bg-navy-800/60">
              <div className="w-10 h-10 rounded-full bg-brand-100 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 flex items-center justify-center"><User className="w-5 h-5" /></div>
              <div>
                <p className="font-semibold text-ui-text">{collecting.name}</p>
                <p className="text-xs text-ui-subtle flex items-center gap-1"><Phone className="w-3 h-3" /> {collecting.phone || '-'}</p>
              </div>
              <div className="ms-auto text-end">
                <p className="text-xs text-ui-subtle">{t('openBalance')}</p>
                <p className="font-bold text-ui-danger">{formatCurrency(collecting.open_amount, currency, lang)}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label={t('amount')} type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
              <Select label={t('paymentMethod')} value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>
                <option value="cash">{t('cash')}</option>
                <option value="card">{t('card')}</option>
                <option value="transfer">{t('transfer')}</option>
              </Select>
            </div>
            {openInvoices.length > 0 && (
              <Select label={t('invoice')} value={form.sale_id} onChange={(e) => setForm({ ...form, sale_id: e.target.value })}>
                <option value="">{t('allInvoices')}</option>
                {openInvoices.map((s) => <option key={s.id} value={s.id}>{s.invoice_number} - {formatCurrency(s.open, currency, lang)}</option>)}
              </Select>
            )}
            <Textarea label={t('paymentNotes')} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setCollecting(null)}>{t('cancel')}</Button>
              <Button onClick={collect} disabled={saving}><HandCoins className="w-4 h-4" /> {saving ? t('loading') : t('collect')}</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!paying} onClose={() => setPaying(null)} title={paying ? `${t('paySupplier')} - ${paying.name}` : ''}>
        {paying && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-ui-page-alt dark:bg-navy-800/60">
              <div className="w-10 h-10 rounded-full bg-brand-100 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 flex items-center justify-center"><Building2 className="w-5 h-5" /></div>
              <div>
                <p className="font-semibold text-ui-text">{paying.name}</p>
                <p className="text-xs text-ui-subtle flex items-center gap-1"><Phone className="w-3 h-3" /> {paying.phone || '-'}</p>
              </div>
              <div className="ms-auto text-end">
                <p className="text-xs text-ui-subtle">{t('openBalance')}</p>
                <p className="font-bold text-ui-danger">{formatCurrency(paying.open_amount, currency, lang)}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label={t('amount')} type="number" value={apForm.amount} onChange={(e) => setApForm({ ...apForm, amount: e.target.value })} required />
              <Select label={t('paymentMethod')} value={apForm.payment_method} onChange={(e) => setApForm({ ...apForm, payment_method: e.target.value })}>
                <option value="cash">{t('cash')}</option>
                <option value="card">{t('card')}</option>
                <option value="transfer">{t('transfer')}</option>
              </Select>
            </div>
            {openApInvoices.length > 0 && (
              <Select label={t('invoice')} value={apForm.purchase_id} onChange={(e) => setApForm({ ...apForm, purchase_id: e.target.value })}>
                <option value="">{t('allInvoices')}</option>
                {openApInvoices.map((s) => <option key={s.id} value={s.id}>{s.invoice_number} - {formatCurrency(s.open, currency, lang)}</option>)}
              </Select>
            )}
            <Textarea label={t('paymentNotes')} value={apForm.notes} onChange={(e) => setApForm({ ...apForm, notes: e.target.value })} rows={2} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPaying(null)}>{t('cancel')}</Button>
              <Button onClick={paySupplier} disabled={saving}><HandCoins className="w-4 h-4" /> {saving ? t('loading') : t('paySupplier')}</Button>
            </div>
          </div>
        )}
      </Modal>
    </DesignSurface>
  );
}
