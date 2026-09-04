import { useEffect, useState, useCallback } from 'react';
import { Plus, Edit2, Trash2, Coins, Landmark } from 'lucide-react';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { DesignSurface, DesignPageHeader, DesignSearch, DesignPanel, DesignPagination } from '@/components/design';
import { StatCard } from '@/components/PageHeader';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatCurrency } from '@/lib/format';
import { logAudit } from '@/lib/audit';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import { isAdminRole } from '@/lib/permissions';
import { useSettings } from '@/context/SettingsContext';
import { useBranches } from '@/hooks/useBranches';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import type { ChartOfAccount, AccountType, TrialBalanceRow } from '@/lib/types';

const ACCOUNT_TYPES: { value: AccountType; labelKey: 'typeAsset' | 'typeLiability' | 'typeEquity' | 'typeIncome' | 'typeExpense' }[] = [
  { value: 'asset', labelKey: 'typeAsset' },
  { value: 'liability', labelKey: 'typeLiability' },
  { value: 'equity', labelKey: 'typeEquity' },
  { value: 'income', labelKey: 'typeIncome' },
  { value: 'expense', labelKey: 'typeExpense' },
];

export function AccountsPage() {
  const { t, lang } = useLanguage();
  const { show } = useToast();
  const { user } = useAuth();
  const branchFilter = useBranchFilter();
  const can = useCan();
  const { effectiveSettings } = useSettings();
  const { branches } = useBranches();
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ChartOfAccount | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [adminBranchFilter, setAdminBranchFilter] = useState('');
  const [form, setForm] = useState({ code: '', name: '', name_en: '', account_type: 'asset' as AccountType, is_active: true });

  const effectiveBranchFilter = isAdminRole(user?.role) ? (adminBranchFilter || null) : branchFilter;
  const currency = effectiveSettings(effectiveBranchFilter)?.currency || 'EGP';
  const isAr = lang === 'ar';
  const canManage = can('accounts.manage');
  const { rows: items, loading, error, total, hasMore, loadMore, loadingMore, refresh: reloadAccounts } = usePaginatedRows<ChartOfAccount>({
    table: 'chart_of_accounts',
    select: '*',
    order: { column: 'code', ascending: true },
    branch_id: effectiveBranchFilter,
    pageSize: 100,
    enabled: !!effectiveBranchFilter,
  });

  const loadBalances = useCallback(async () => {
    if (effectiveBranchFilter) {
      const { data: tb } = await api.accounting.getTrialBalance( { p_branch_id: effectiveBranchFilter, p_to_date: new Date().toISOString().slice(0, 10) });
      if (tb && Array.isArray(tb)) {
        const map: Record<string, number> = {};
        (tb as TrialBalanceRow[]).forEach((r) => { map[r.code] = Number(r.balance); });
        setBalances(map);
      }
    } else {
      setBalances({});
    }
  }, [effectiveBranchFilter]);
  useEffect(() => { loadBalances(); }, [loadBalances]);

  const filtered = items.filter((a) => !search || a.name.toLowerCase().includes(search.toLowerCase()) || a.name_en?.toLowerCase().includes(search.toLowerCase()) || a.code.toLowerCase().includes(search.toLowerCase()));

  const openAdd = () => { setEditing(null); setForm({ code: '', name: '', name_en: '', account_type: 'asset', is_active: true }); setModalOpen(true); };
  const openEdit = (a: ChartOfAccount) => { setEditing(a); setForm({ code: a.code, name: a.name, name_en: a.name_en || '', account_type: a.account_type, is_active: a.is_active }); setModalOpen(true); };

  const save = async () => {
    if (!form.code || !form.name) { show(t('required'), 'error'); return; }
    const payload = {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      name_en: form.name_en.trim() || null,
      account_type: form.account_type,
      is_active: form.is_active,
    };
    if (editing) {
      const { error } = await supabase.from('chart_of_accounts').update(payload).eq('id', editing.id);
      if (error) { show(error.message, 'error'); return; }
      await logAudit('update', 'chart_of_accounts', editing.id);
    } else {
      const { error } = await supabase.from('chart_of_accounts').insert({ ...payload, branch_id: effectiveBranchFilter || user?.branch_id || null });
      if (error) { show(error.message, 'error'); return; }
      await logAudit('create', 'chart_of_accounts');
    }
    show(t('saveSuccess'), 'success');
    setModalOpen(false);
    reloadAccounts();
  };

  const remove = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('chart_of_accounts').delete().eq('id', deleteId);
    if (error) show(error.message, 'error');
    else { show(t('deleteSuccess'), 'success'); await logAudit('delete', 'chart_of_accounts', deleteId); }
    setDeleteId(null);
    reloadAccounts();
  };

  const seedOpening = async () => {
    if (!effectiveBranchFilter) { show(t('filterByBranch'), 'error'); return; }
    setSeeding(true);
    const { data, error } = await api.accounting.seedOpeningBalances( { p_branch_id: effectiveBranchFilter });
    setSeeding(false);
    if (error) { show(error.message, 'error'); return; }
    const r = data as { success: boolean; error?: string; detail?: string; total?: number; skipped?: boolean } | null;
    if (!r?.success) {
      if (r?.error === 'OPENING_ALREADY_EXISTS') show(t('openingBalanceExists'), 'warning');
      else show(r?.detail || r?.error || t('error'), 'error');
      return;
    }
    show(r.skipped ? t('openingBalanceExists') : `${t('openingBalanceDone')} (${formatCurrency(r.total || 0, currency, lang)})`, 'success');
    reloadAccounts();
  };

  const typeLabel = (t: AccountType) => {
    const found = ACCOUNT_TYPES.find((x) => x.value === t);
    return found ? (isAr ? { typeAsset: 'أصل', typeLiability: 'التزام', typeEquity: 'حقوق ملكية', typeIncome: 'إيراد', typeExpense: 'مصروف' }[found.labelKey] : { typeAsset: 'Asset', typeLiability: 'Liability', typeEquity: 'Equity', typeIncome: 'Income', typeExpense: 'Expense' }[found.labelKey]) : t;
  };

  const columns: Column<ChartOfAccount>[] = [
    { key: 'code', header: t('accountCode'), render: (a) => <span className="font-mono font-semibold text-ui-text">{a.code}</span> },
    { key: 'name', header: t('accountName'), render: (a) => (
      <div className="flex items-center gap-2">
        <span className="font-medium text-ui-text">{isAr ? a.name : (a.name_en || a.name)}</span>
        {a.is_system && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gold-500/15 text-gold-600 dark:text-gold-400 font-bold">{t('systemAccount')}</span>}
      </div>
    ) },
    { key: 'account_type', header: t('accountType'), render: (a) => typeLabel(a.account_type) },
    { key: 'balance', header: t('balance'), render: (a) => {
      const b = balances[a.code];
      return <span className={b !== undefined && b < 0 ? 'text-ui-danger' : 'text-ui-text'}>{b !== undefined ? formatCurrency(Math.abs(b), currency, lang) : '-'}</span>;
    } },
    { key: 'is_active', header: t('status'), render: (a) => <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${a.is_active ? 'bg-ui-success-soft text-ui-success  dark:text-ui-success' : 'bg-ui-page-alt text-ui-subtle dark:bg-ui-page-alt dark:text-ui-subtle'}`}>{a.is_active ? t('active') : t('inactive')}</span> },
    { key: 'actions', header: t('actions'), render: (a) => (
      <div className="flex gap-1">
        {!a.is_system && canManage && (
          <>
            <button onClick={() => openEdit(a)} className="p-1.5 rounded-md hover:bg-ui-info-soft text-ui-info"><Edit2 className="w-4 h-4" /></button>
            <button onClick={() => setDeleteId(a.id)} className="p-1.5 rounded-md hover:bg-ui-danger-soft text-ui-danger"><Trash2 className="w-4 h-4" /></button>
          </>
        )}
      </div>
    ) },
  ];

  return (
    <DesignSurface testId="accounts-page">
      <DesignPageHeader title={t('chartOfAccounts')} subtitle={t('accounts')}
        actions={
          <>
            {canManage && (
              <Button size="sm" variant="outline" onClick={seedOpening} disabled={seeding || !effectiveBranchFilter}>
                <Coins className="w-4 h-4" /> {seeding ? t('loading') : t('seedOpeningBalances')}
              </Button>
            )}
            {canManage && <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4" /> {t('add')}</Button>}
          </>
        } />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard title={t('accounts')} value={String(items.length)} icon={<Landmark className="w-5 h-5" />} color="brand" />
        <StatCard title={t('typeAsset')} value={String(items.filter((a) => a.account_type === 'asset').length)} icon={<Landmark className="w-5 h-5" />} color="blue" />
        <StatCard title={t('typeLiability')} value={String(items.filter((a) => a.account_type === 'liability').length)} icon={<Landmark className="w-5 h-5" />} color="amber" />
        <StatCard title={t('typeExpense')} value={String(items.filter((a) => a.account_type === 'expense').length)} icon={<Landmark className="w-5 h-5" />} color="red" />
      </div>

      <DesignPanel testId="accounts-search-panel">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <DesignSearch value={search} onChange={setSearch} className="flex-1 w-full" label={t('search')} placeholder={t('search')} testId="accounts-search" />
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

      <DesignPanel testId="accounts-table-panel">
        <DataTable columns={columns} data={filtered} loading={loading} error={error} emptyMessage={t('noData')} />
        <DesignPagination loaded={items.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
      </DesignPanel>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? t('edit') : t('add')}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('accountCode')} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} disabled={!!editing?.is_system} required />
            <Select label={t('accountType')} value={form.account_type} onChange={(e) => setForm({ ...form, account_type: e.target.value as AccountType })} disabled={!!editing?.is_system}>
              {ACCOUNT_TYPES.map((at) => <option key={at.value} value={at.value}>{t(at.labelKey)}</option>)}
            </Select>
            <Input label={t('name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <Input label={t('nameEn')} value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} />
          </div>
          <Select label={t('status')} value={form.is_active ? '1' : '0'} onChange={(e) => setForm({ ...form, is_active: e.target.value === '1' })}>
            <option value="1">{t('active')}</option>
            <option value="0">{t('inactive')}</option>
          </Select>
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
