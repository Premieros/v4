import { useEffect, useState, useCallback } from 'react';
import { Landmark, ArrowLeftRight, PiggyBank, HandCoins, Wallet } from 'lucide-react';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { DesignSurface, DesignPageHeader, DesignPanel, DesignPagination } from '@/components/design';
import { StatCard } from '@/components/PageHeader';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Input, Select, Textarea } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { logAudit } from '@/lib/audit';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import { isAdminRole } from '@/lib/permissions';
import { useSettings } from '@/context/SettingsContext';
import { useBranches } from '@/hooks/useBranches';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import type { TreasuryAccount, TreasuryBalance, TreasuryTransaction } from '@/lib/types';

type ModalType = 'transfer' | 'deposit' | 'withdrawal' | null;

export function TreasuryPage() {
  const { t, lang } = useLanguage();
  const { show } = useToast();
  const { user } = useAuth();
  const branchFilter = useBranchFilter();
  const can = useCan();
  const { effectiveSettings } = useSettings();
  const { branches } = useBranches();
  const isAr = lang === 'ar';

  const [balances, setBalances] = useState<TreasuryBalance[]>([]);
  const [accounts, setAccounts] = useState<TreasuryAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [adminBranchFilter, setAdminBranchFilter] = useState('');
  const effectiveBranchFilter = isAdminRole(user?.role) ? (adminBranchFilter || null) : branchFilter;
  const currency = effectiveSettings(effectiveBranchFilter)?.currency || 'EGP';
  const { rows: transactions, loading: txLoading, error: txError, total: txTotal, hasMore: txHasMore, loadMore: loadMoreTx, loadingMore: loadingMoreTx, refresh: reloadTx } = usePaginatedRows<TreasuryTransaction>({
    table: 'treasury_transactions',
    select: '*, from_account:treasury_accounts!from_account_id(account_name), to_account:treasury_accounts!to_account_id(account_name)',
    order: { column: 'created_at', ascending: false },
    branch_id: effectiveBranchFilter,
    pageSize: 100,
    enabled: !!effectiveBranchFilter,
  });

  const [modal, setModal] = useState<ModalType>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ from_account_id: '', to_account_id: '', account_id: '', amount: '', notes: '' });

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      if (effectiveBranchFilter) {
        const [{ data: bal }, { data: acc }] = await Promise.all([
          api.accounting.getTreasuryBalances({ p_branch_id: effectiveBranchFilter }),
          supabase.from('treasury_accounts').select('*').eq('branch_id', effectiveBranchFilter).order('account_type'),
        ]);
        setBalances((bal as TreasuryBalance[]) || []);
        setAccounts((acc as TreasuryAccount[]) || []);
      } else {
        setBalances([]);
        setAccounts([]);
      }
    } finally {
      setLoading(false);
    }
  }, [effectiveBranchFilter]);

  useEffect(() => { loadOverview(); }, [loadOverview]);

  const openModal = (m: Exclude<ModalType, null>) => {
    setForm({ from_account_id: '', to_account_id: '', account_id: '', amount: '', notes: '' });
    setModal(m);
  };

  const submit = async () => {
    const amount = Number(form.amount);
    if (!amount || amount <= 0) { show(t('required'), 'error'); return; }
    setSaving(true);
    let result: { data: unknown; error: { message: string } | null };
    if (modal === 'transfer') {
      if (!form.from_account_id || !form.to_account_id) { show(t('required'), 'error'); return; }
      result = await api.accounting.processTransfer({
        p_branch_id: effectiveBranchFilter,
        p_from_account_id: form.from_account_id,
        p_to_account_id: form.to_account_id,
        p_amount: amount,
        p_notes: form.notes || null,
      });
    } else if (modal === 'deposit') {
      if (!form.account_id) { show(t('required'), 'error'); return; }
      result = await api.accounting.processTreasuryDeposit({
        p_branch_id: effectiveBranchFilter,
        p_account_id: form.account_id,
        p_amount: amount,
        p_notes: form.notes || null,
      });
    } else {
      if (!form.account_id) { show(t('required'), 'error'); return; }
      result = await api.accounting.processTreasuryWithdrawal({
        p_branch_id: effectiveBranchFilter,
        p_account_id: form.account_id,
        p_amount: amount,
        p_notes: form.notes || null,
      });
    }
    setSaving(false);
    const { data, error } = result as { data: { success: boolean; error?: string; detail?: string; reference_number?: string } | null; error: { message: string } | null };
    if (error) { show(error.message, 'error'); return; }
    if (!data?.success) { show(data?.detail || data?.error || t('error'), 'error'); return; }
    show(`${formatCurrency(amount, currency, lang)} (${data.reference_number || ''})`, 'success');
    await logAudit('create', 'treasury_transactions', undefined, { type: modal, amount, reference: data.reference_number });
    setModal(null);
    loadOverview();
    reloadTx();
  };

  const totalCash = balances.filter((b) => b.account_type === 'cash').reduce((s, b) => s + Number(b.balance), 0);
  const totalBank = balances.filter((b) => b.account_type === 'bank').reduce((s, b) => s + Number(b.balance), 0);

  const balanceColumns: Column<TreasuryBalance>[] = [
    { key: 'account_name', header: t('accountName'), render: (b) => <span className="font-medium text-ui-text">{b.account_name}</span> },
    { key: 'account_type', header: t('accountType'), render: (b) => <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${b.account_type === 'cash' ? 'bg-ui-warning-soft text-ui-warning  text-ui-warning' : 'bg-ui-info-soft text-ui-info dark:text-ui-info'}`}>{b.account_type === 'cash' ? t('cash') : t('bank')}</span> },
    { key: 'account_number', header: t('accountCode'), render: (b) => <span className="font-mono text-xs">{b.code || '-'}</span> },
    { key: 'opening_balance', header: t('openingBalance'), render: (b) => formatCurrency(b.opening_balance, currency, lang) },
    { key: 'balance', header: t('balance'), render: (b) => <span className="font-semibold text-ui-success dark:text-ui-success">{formatCurrency(b.balance, currency, lang)}</span> },
  ];

  const txColumns: Column<TreasuryTransaction>[] = [
    { key: 'created_at', header: t('date'), render: (tx) => formatDateTime(tx.created_at, lang) },
    { key: 'transaction_type', header: t('referenceType'), render: (tx) => (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${tx.transaction_type === 'deposit' ? 'bg-ui-success-soft text-ui-success  dark:text-ui-success' : tx.transaction_type === 'withdrawal' ? 'bg-ui-danger-soft text-ui-danger  dark:text-ui-danger' : 'bg-ui-info-soft text-ui-info dark:text-ui-info'}`}>
        {{ transfer: t('transfer'), deposit: t('deposit'), withdrawal: t('withdrawal') }[tx.transaction_type]}
      </span>
    ) },
    { key: 'reference_number', header: t('entryNumber'), render: (tx) => <span className="font-mono text-xs">{tx.reference_number || '-'}</span> },
    { key: 'from', header: t('fromAccount'), render: (tx) => tx.from_account?.account_name || '-' },
    { key: 'to', header: t('toAccount'), render: (tx) => tx.to_account?.account_name || '-' },
    { key: 'amount', header: t('amount'), render: (tx) => <span className="font-semibold text-ui-text">{formatCurrency(tx.amount, currency, lang)}</span> },
  ];

  return (
    <DesignSurface testId="treasury-page">
      <DesignPageHeader
        title={t('treasury')}
        subtitle={t('treasuryTransactions')}
        actions={can('accounts.manage') && (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => openModal('deposit')}><PiggyBank className="w-4 h-4" /> {t('deposit')}</Button>
            <Button size="sm" variant="warning" onClick={() => openModal('withdrawal')}><HandCoins className="w-4 h-4" /> {t('withdrawal')}</Button>
            <Button size="sm" variant="outline" onClick={() => openModal('transfer')}><ArrowLeftRight className="w-4 h-4" /> {t('transfer')}</Button>
          </div>
        )}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard title={t('treasuryBalances')} value={formatCurrency(totalCash + totalBank, currency, lang)} icon={<Wallet className="w-5 h-5" />} color="brand" />
        <StatCard title={t('cash')} value={formatCurrency(totalCash, currency, lang)} icon={<HandCoins className="w-5 h-5" />} color="amber" />
        <StatCard title={t('bank')} value={formatCurrency(totalBank, currency, lang)} icon={<Landmark className="w-5 h-5" />} color="blue" />
        <StatCard title={t('treasuryAccounts')} value={String(balances.length)} icon={<PiggyBank className="w-5 h-5" />} color="purple" />
      </div>

      {isAdminRole(user?.role) && branches.length > 0 && (
        <DesignPanel testId="treasury-branch-panel">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-ui-muted">{t('filterByBranch')}</label>
            <select value={adminBranchFilter} onChange={(e) => setAdminBranchFilter(e.target.value)}
              className="px-3 py-2 rounded-lg text-sm border border-ui-border bg-ui-surface text-ui-text">
              <option value="">{t('allBranches')}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{isAr ? b.name : (b.name_en || b.name)}</option>)}
            </select>
          </div>
        </DesignPanel>
      )}

      <DesignPanel title={t('treasuryBalances')} testId="treasury-balances-panel">
        <DataTable columns={balanceColumns} data={balances} loading={loading} error={txError} emptyMessage={t('noData')} />
      </DesignPanel>

      <DesignPanel title={t('treasuryTransactions')} testId="treasury-transactions-panel">
        <DataTable columns={txColumns} data={transactions} loading={txLoading} error={txError} emptyMessage={t('noData')} />
        <DesignPagination loaded={transactions.length} total={txTotal} hasMore={txHasMore} loadingMore={loadingMoreTx} onLoadMore={loadMoreTx} />
      </DesignPanel>

      <Modal open={modal === 'transfer'} onClose={() => setModal(null)} title={t('transfer')}>
        <div className="space-y-4">
          <Select label={t('fromAccount')} value={form.from_account_id} onChange={(e) => setForm({ ...form, from_account_id: e.target.value })}>
            <option value="">{t('selectAccount')}</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.account_name}</option>)}
          </Select>
          <Select label={t('toAccount')} value={form.to_account_id} onChange={(e) => setForm({ ...form, to_account_id: e.target.value })}>
            <option value="">{t('selectAccount')}</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.account_name}</option>)}
          </Select>
          <Input label={t('amount')} type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          <Textarea label={t('notes')} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModal(null)}>{t('cancel')}</Button>
            <Button onClick={submit} disabled={saving}><ArrowLeftRight className="w-4 h-4" /> {saving ? t('loading') : t('transfer')}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={modal === 'deposit'} onClose={() => setModal(null)} title={t('deposit')}>
        <div className="space-y-4">
          <Select label={t('accountName')} value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}>
            <option value="">{t('selectAccount')}</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.account_name}</option>)}
          </Select>
          <Input label={t('amount')} type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          <Textarea label={t('notes')} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModal(null)}>{t('cancel')}</Button>
            <Button onClick={submit} disabled={saving}><PiggyBank className="w-4 h-4" /> {saving ? t('loading') : t('deposit')}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={modal === 'withdrawal'} onClose={() => setModal(null)} title={t('withdrawal')}>
        <div className="space-y-4">
          <Select label={t('accountName')} value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}>
            <option value="">{t('selectAccount')}</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.account_name}</option>)}
          </Select>
          <Input label={t('amount')} type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          <Textarea label={t('notes')} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModal(null)}>{t('cancel')}</Button>
            <Button variant="warning" onClick={submit} disabled={saving}><HandCoins className="w-4 h-4" /> {saving ? t('loading') : t('withdrawal')}</Button>
          </div>
        </div>
      </Modal>
    </DesignSurface>
  );
}
