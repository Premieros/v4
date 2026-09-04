import { useEffect, useState, useCallback } from 'react';
import { Plus, Eye, Link2, CheckCircle2, CircleDashed } from 'lucide-react';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { DesignSurface, DesignPageHeader, DesignPanel, DesignPagination } from '@/components/design';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { formatCurrency, formatDateTime, todayISO } from '@/lib/format';
import { logAudit } from '@/lib/audit';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import { isAdminRole } from '@/lib/permissions';
import { useSettings } from '@/context/SettingsContext';
import { useBranches } from '@/hooks/useBranches';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import type {
  BankReconciliation, ReconciliationDetail,
  TreasuryAccount,
} from '@/lib/types';

export function ReconciliationPage() {
  const { t, lang } = useLanguage();
  const { show } = useToast();
  const { user } = useAuth();
  const branchFilter = useBranchFilter();
  const can = useCan();
  const { effectiveSettings } = useSettings();
  const { branches } = useBranches();
  const isAr = lang === 'ar';

  const [accounts, setAccounts] = useState<TreasuryAccount[]>([]);
  const [adminBranchFilter, setAdminBranchFilter] = useState('');
  const effectiveBranchFilter = isAdminRole(user?.role) ? (adminBranchFilter || null) : branchFilter;
  const currency = effectiveSettings(effectiveBranchFilter)?.currency || 'EGP';
  const { rows: items, loading, error, total, hasMore, loadMore, loadingMore, refresh: reloadRecon } = usePaginatedRows<BankReconciliation>({
    table: 'bank_reconciliations',
    select: '*, treasury_account:treasury_accounts(account_name, account_type)',
    order: { column: 'created_at', ascending: false },
    branch_id: effectiveBranchFilter,
    pageSize: 100,
    enabled: !!effectiveBranchFilter,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createForm, setCreateForm] = useState({ treasury_account_id: '', statement_date: todayISO(), statement_balance: '' });

  const [detail, setDetail] = useState<ReconciliationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [lineForm, setLineForm] = useState({ statement_date: todayISO(), description: '', amount: '', reference: '' });
  const [addLineOpen, setAddLineOpen] = useState(false);
  const [matchSelections, setMatchSelections] = useState<Record<string, string>>({});

  const loadAccounts = useCallback(async () => {
    if (!effectiveBranchFilter) { setAccounts([]); return; }
    const { data: acc } = await supabase
      .from('treasury_accounts')
      .select('*')
      .eq('branch_id', effectiveBranchFilter)
      .eq('is_active', true)
      .order('account_type');
    setAccounts((acc as TreasuryAccount[]) || []);
  }, [effectiveBranchFilter]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    const { data, error } = await api.accounting.getBankReconciliation( { p_reconciliation_id: id });
    setDetailLoading(false);
    if (error) { show(error.message, 'error'); return; }
    const d = data as ReconciliationDetail;
    if (!d?.success) { show(d?.error || t('error'), 'error'); return; }
    setDetail(d);
    setMatchSelections({});
  };

  const createRecon = async () => {
    if (!createForm.treasury_account_id || !createForm.statement_balance) { show(t('required'), 'error'); return; }
    setSaving(true);
    const { data, error } = await api.accounting.createBankReconciliation( {
      p_branch_id: effectiveBranchFilter,
      p_treasury_account_id: createForm.treasury_account_id,
      p_statement_date: createForm.statement_date,
      p_statement_balance: Number(createForm.statement_balance),
    });
    setSaving(false);
    if (error) { show(error.message, 'error'); return; }
    const r = data as { success: boolean; error?: string; detail?: string; reconciliation_id?: string } | null;
    if (!r?.success) { show(r?.detail || r?.error || t('error'), 'error'); return; }
    show(t('reconciliation'), 'success');
    await logAudit('create', 'bank_reconciliations', r.reconciliation_id, { statement_balance: Number(createForm.statement_balance) });
    setCreateOpen(false);
    setCreateForm({ treasury_account_id: '', statement_date: todayISO(), statement_balance: '' });
    reloadRecon();
  };

  const addLine = async () => {
    if (!detail?.header || !lineForm.amount) { show(t('required'), 'error'); return; }
    setSaving(true);
    const { data, error } = await api.accounting.addStatementLine( {
      p_reconciliation_id: detail.header.id,
      p_statement_date: lineForm.statement_date,
      p_description: lineForm.description || null,
      p_amount: Number(lineForm.amount),
      p_reference: lineForm.reference || null,
    });
    setSaving(false);
    if (error) { show(error.message, 'error'); return; }
    const r = data as { success: boolean; error?: string; detail?: string } | null;
    if (!r?.success) { show(r?.detail || r?.error || t('error'), 'error'); return; }
    setAddLineOpen(false);
    setLineForm({ statement_date: todayISO(), description: '', amount: '', reference: '' });
    if (detail?.header) openDetail(detail.header.id);
  };

  const matchLine = async (lineId: string) => {
    const candidateId = matchSelections[lineId];
    if (!candidateId) { show(t('required'), 'error'); return; }
    setSaving(true);
    const { data, error } = await api.accounting.matchBankLine( {
      p_line_id: lineId,
      p_journal_entry_id: candidateId,
    });
    setSaving(false);
    if (error) { show(error.message, 'error'); return; }
    const r = data as { success: boolean; error?: string; detail?: string } | null;
    if (!r?.success) { show(r?.detail || r?.error || t('error'), 'error'); return; }
    show(t('matched'), 'success');
    if (detail?.header) openDetail(detail.header.id);
  };

  const complete = async () => {
    if (!detail?.header) return;
    setSaving(true);
    const { data, error } = await api.accounting.completeBankReconciliation( { p_reconciliation_id: detail.header.id });
    setSaving(false);
    if (error) { show(error.message, 'error'); return; }
    const r = data as { success: boolean; error?: string; detail?: string; difference?: number } | null;
    if (!r?.success) { show(r?.detail || r?.error || t('error'), 'error'); return; }
    show(t('complete'), 'success');
    await logAudit('update', 'bank_reconciliations', detail.header.id, { status: 'completed' });
    setDetail(null);
    reloadRecon();
  };

  const statusLabel = (s: string) => ({ open: t('reconOpen'), completed: t('reconCompleted'), cancelled: t('reconCancelled') })[s] || s;

  const columns: Column<BankReconciliation>[] = [
    { key: 'treasury_account', header: t('accountName'), render: (r) => <span className="font-medium text-ui-text">{r.treasury_account?.account_name || '-'}</span> },
    { key: 'statement_date', header: t('statementDate'), render: (r) => formatDateTime(r.statement_date, lang) },
    { key: 'statement_balance', header: t('statementBalance'), render: (r) => formatCurrency(r.statement_balance, currency, lang) },
    { key: 'book_balance', header: t('bookBalance'), render: (r) => formatCurrency(r.book_balance, currency, lang) },
    { key: 'difference', header: t('difference'), render: (r) => <span className={`font-semibold ${Math.abs(Number(r.difference)) > 0.001 ? 'text-ui-danger' : 'text-ui-success dark:text-ui-success'}`}>{formatCurrency(r.difference, currency, lang)}</span> },
    { key: 'status', header: t('status'), render: (r) => (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
        r.status === 'completed' ? 'bg-ui-success-soft text-ui-success  dark:text-ui-success' :
        r.status === 'open' ? 'bg-ui-warning-soft text-ui-warning  text-ui-warning' :
        'bg-ui-danger-soft text-ui-danger  dark:text-ui-danger'}`}>
        {statusLabel(r.status)}
      </span>
    ) },
    { key: 'actions', header: t('actions'), render: (r) => <Button size="sm" variant="outline" onClick={() => openDetail(r.id)}><Eye className="w-4 h-4" /> {t('view')}</Button> },
  ];

  const bankAccounts = accounts.filter((a) => a.account_type === 'bank');
  const availableCandidates = (detail?.book_candidates || []).filter((c) => !(detail?.statement_lines || []).some((l) => l.matched_journal_entry_id === c.id));

  return (
    <DesignSurface testId="reconciliation-page">
      <DesignPageHeader
        title={t('bankReconciliation')}
        subtitle={t('reconciliation')}
        actions={can('accounts.manage') && (
          <Button size="sm" onClick={() => { setCreateForm({ treasury_account_id: '', statement_date: todayISO(), statement_balance: '' }); setCreateOpen(true); }}><Plus className="w-4 h-4" /> {t('reconciliation')}</Button>
        )}
      />

      {isAdminRole(user?.role) && branches.length > 0 && (
        <DesignPanel testId="reconciliation-branch-panel">
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

      <DesignPanel testId="reconciliation-table-panel">
        <DataTable columns={columns} data={items} loading={loading} error={error} emptyMessage={t('noData')} />
        <DesignPagination loaded={items.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
      </DesignPanel>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t('reconciliation')}>
        <div className="space-y-4">
          <Select label={t('accountName')} value={createForm.treasury_account_id} onChange={(e) => setCreateForm({ ...createForm, treasury_account_id: e.target.value })}>
            <option value="">{t('selectAccount')}</option>
            {bankAccounts.length > 0 ? bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.account_name}</option>) : accounts.map((a) => <option key={a.id} value={a.id}>{a.account_name}</option>)}
          </Select>
          <Input label={t('statementDate')} type="date" value={createForm.statement_date} onChange={(e) => setCreateForm({ ...createForm, statement_date: e.target.value })} />
          <Input label={t('statementBalance')} type="number" value={createForm.statement_balance} onChange={(e) => setCreateForm({ ...createForm, statement_balance: e.target.value })} required />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>{t('cancel')}</Button>
            <Button onClick={createRecon} disabled={saving}><Plus className="w-4 h-4" /> {saving ? t('loading') : t('reconciliation')}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.header ? `${detail.header.account_name} - ${t('reconciliation')}` : ''} size="2xl">
        {detailLoading ? (
          <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" /></div>
        ) : detail?.header ? (
          <div className="space-y-5">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="bg-ui-page-alt/60 rounded-xl p-3">
                <p className="text-xs text-ui-subtle dark:text-ui-subtle">{t('statementBalance')}</p>
                <p className="font-bold text-ui-text dark:text-white mt-1">{formatCurrency(detail.header.statement_balance, currency, lang)}</p>
              </div>
              <div className="bg-ui-page-alt/60 rounded-xl p-3">
                <p className="text-xs text-ui-subtle dark:text-ui-subtle">{t('bookBalance')}</p>
                <p className="font-bold text-ui-text dark:text-white mt-1">{formatCurrency(detail.header.book_balance, currency, lang)}</p>
              </div>
              <div className="bg-ui-page-alt/60 rounded-xl p-3">
                <p className="text-xs text-ui-subtle dark:text-ui-subtle">{t('difference')}</p>
                <p className={`font-bold mt-1 ${Math.abs(Number(detail.header.difference)) > 0.001 ? 'text-ui-danger' : 'text-ui-success dark:text-ui-success'}`}>{formatCurrency(detail.header.difference, currency, lang)}</p>
              </div>
              <div className="bg-ui-page-alt/60 rounded-xl p-3">
                <p className="text-xs text-ui-subtle dark:text-ui-subtle">{t('status')}</p>
                <p className="font-bold mt-1">{statusLabel(detail.header.status)}</p>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-ui-text">{t('statementLines')}</h3>
              {detail.header.status === 'open' && (
                <Button size="sm" variant="outline" onClick={() => { setLineForm({ statement_date: todayISO(), description: '', amount: '', reference: '' }); setAddLineOpen(true); }}><Plus className="w-4 h-4" /> {t('addStatementLine')}</Button>
              )}
            </div>

            <div className="overflow-x-auto rounded-xl border border-ui-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ui-border bg-ui-page-alt/60">
                    <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('date')}</th>
                    <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('description')}</th>
                    <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('reference')}</th>
                    <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('amount')}</th>
                    <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('status')}</th>
                    <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.statement_lines.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-ui-subtle">{t('noData')}</td></tr>}
                  {detail.statement_lines.map((l) => (
                    <tr key={l.id} className="border-b border-ui-border">
                      <td className="px-4 py-3 text-ui-muted">{l.statement_date}</td>
                      <td className="px-4 py-3 text-ui-text">{l.description || '-'}</td>
                      <td className="px-4 py-3 font-mono text-xs text-ui-subtle dark:text-ui-subtle">{l.reference || '-'}</td>
                      <td className="px-4 py-3 text-end font-semibold text-ui-text">{formatCurrency(l.amount, currency, lang)}</td>
                      <td className="px-4 py-3">
                        {l.matched_journal_entry_id ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-ui-success-soft text-ui-success  dark:text-ui-success"><CheckCircle2 className="w-3.5 h-3.5" /> {t('matched')}</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-ui-page-alt text-ui-muted"><CircleDashed className="w-3.5 h-3.5" /> {t('unmatched')}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {detail?.header?.status === 'open' && !l.matched_journal_entry_id && (
                          <div className="flex items-center gap-2">
                            <select
                              value={matchSelections[l.id] || ''}
                              onChange={(e) => setMatchSelections((m) => ({ ...m, [l.id]: e.target.value }))}
                              className="px-2 py-1.5 rounded-lg text-xs border border-ui-border bg-ui-surface text-ui-text">
                              <option value="">{t('selectAccount')}</option>
                              {availableCandidates.map((c) => <option key={c.id} value={c.id}>{c.entry_number} - {formatCurrency(c.amount, currency, lang)}</option>)}
                            </select>
                            <Button size="sm" variant="outline" onClick={() => matchLine(l.id)} disabled={saving}><Link2 className="w-3.5 h-3.5" /></Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 className="text-sm font-bold text-ui-text">{t('bookCandidates')}</h3>
            <div className="overflow-x-auto rounded-xl border border-ui-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ui-border bg-ui-page-alt/60">
                    <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('entryNumber')}</th>
                    <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('date')}</th>
                    <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('description')}</th>
                    <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.book_candidates.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-ui-subtle">{t('noData')}</td></tr>}
                  {detail.book_candidates.map((c) => {
                    const isMatched = detail.statement_lines.some((l) => l.matched_journal_entry_id === c.id);
                    return (
                      <tr key={c.id} className={`border-b border-ui-border ${isMatched ? 'opacity-50' : ''}`}>
                        <td className="px-4 py-3 font-mono text-ui-text">{c.entry_number}</td>
                        <td className="px-4 py-3 text-ui-muted">{c.entry_date}</td>
                        <td className="px-4 py-3 text-ui-text">{c.description || '-'}</td>
                        <td className="px-4 py-3 text-end font-semibold text-ui-text">{formatCurrency(c.amount, currency, lang)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setDetail(null)}>{t('close')}</Button>
              {detail.header.status === 'open' && (
                <Button onClick={complete} disabled={saving}><CheckCircle2 className="w-4 h-4" /> {saving ? t('loading') : t('complete')}</Button>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center py-12 text-ui-subtle">{t('noData')}</div>
        )}
      </Modal>

      <Modal open={addLineOpen} onClose={() => setAddLineOpen(false)} title={t('addStatementLine')}>
        <div className="space-y-4">
          <Input label={t('statementDate')} type="date" value={lineForm.statement_date} onChange={(e) => setLineForm({ ...lineForm, statement_date: e.target.value })} />
          <Input label={t('statementDescription')} value={lineForm.description} onChange={(e) => setLineForm({ ...lineForm, description: e.target.value })} />
          <Input label={t('amount')} type="number" value={lineForm.amount} onChange={(e) => setLineForm({ ...lineForm, amount: e.target.value })} required />
          <Input label={t('reference')} value={lineForm.reference} onChange={(e) => setLineForm({ ...lineForm, reference: e.target.value })} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAddLineOpen(false)}>{t('cancel')}</Button>
            <Button onClick={addLine} disabled={saving}><Plus className="w-4 h-4" /> {saving ? t('loading') : t('addStatementLine')}</Button>
          </div>
        </div>
      </Modal>
    </DesignSurface>
  );
}
