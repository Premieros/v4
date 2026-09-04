import { useEffect, useState, useCallback } from 'react';
import { Eye, Scale, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/Toast';
import { DesignSurface, DesignPageHeader, DesignSearch, DesignPanel } from '@/components/design';
import { StatCard } from '@/components/PageHeader';
import { DataTable, type Column } from '@/components/DataTable';
import { Input, Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { logAudit } from '@/lib/audit';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import { isAdminRole } from '@/lib/permissions';
import { useSettings } from '@/context/SettingsContext';
import { useBranches } from '@/hooks/useBranches';
import type { JournalDto, ChartOfAccount } from '@/lib/types';

interface ManualLine {
  account_id: string;
  debit: string;
  credit: string;
  note: string;
}

const REF_TYPE_KEYS: Record<string, string> = {
  opening: 'entryOpening',
  purchase: 'entryPurchase',
  sale: 'entrySale',
  refund: 'entryRefund',
  production: 'entryProduction',
  waste: 'entryWaste',
  transfer: 'entryTransfer',
  adjustment: 'entryAdjustment',
  payment: 'receivePayment',
  manual: 'entryManual',
  supplier_payment: 'entrySupplierPayment',
  purchase_return: 'entryPurchaseReturn',
  treasury_deposit: 'entryTreasuryDeposit',
  treasury_withdrawal: 'entryTreasuryWithdrawal',
  expense: 'entryExpense',
  general: 'journal',
};

export function JournalPage() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const { show } = useToast();
  const branchFilter = useBranchFilter();
  const can = useCan();
  const { effectiveSettings } = useSettings();
  const { branches } = useBranches();
  const [items, setItems] = useState<JournalDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [refType, setRefType] = useState('');
  const [viewing, setViewing] = useState<JournalDto | null>(null);
  const [adminBranchFilter, setAdminBranchFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const effectiveBranchFilter = isAdminRole(user?.role) ? (adminBranchFilter || null) : branchFilter;
  const currency = effectiveSettings(effectiveBranchFilter)?.currency || 'EGP';
  const isAr = lang === 'ar';

  const [manualOpen, setManualOpen] = useState(false);
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [manualDesc, setManualDesc] = useState('');
  const [manualLines, setManualLines] = useState<ManualLine[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (effectiveBranchFilter) {
        const { data } = await api.accounting.getJournals( {
          p_branch_id: effectiveBranchFilter,
          p_from_date: from || null,
          p_to_date: to || null,
          p_reference_type: refType || null,
          p_search: search || null,
        });
        setItems((data as JournalDto[]) || []);
      } else {
        setItems([]);
      }
    } finally {
      setLoading(false);
    }
  }, [effectiveBranchFilter, from, to, refType, search]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (effectiveBranchFilter) {
      supabase.from('chart_of_accounts').select('id, code, name, name_en').eq('branch_id', effectiveBranchFilter).eq('is_active', true).order('code').then(({ data }) => {
        setAccounts((data as ChartOfAccount[]) || []);
      });
    } else {
      setAccounts([]);
    }
  }, [effectiveBranchFilter]);

  useEffect(() => {
    if (manualOpen && manualLines.length === 0) {
      setManualLines([{ account_id: '', debit: '', credit: '', note: '' }]);
    }
  }, [manualOpen, manualLines.length]);

  const refLabel = (type: string) => {
    const key = REF_TYPE_KEYS[type];
    if (!key) return type;
    return t(key as never);
  };

  const columns: Column<JournalDto>[] = [
    { key: 'entry_number', header: t('entryNumber'), render: (e) => <span className="font-mono font-semibold text-ui-text">{e.entry_number}</span> },
    { key: 'entry_date', header: t('date'), render: (e) => formatDateTime(e.entry_date, lang) },
    { key: 'reference_type', header: t('referenceType'), render: (e) => (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">{refLabel(e.reference_type)}</span>
    ) },
    { key: 'reference_number', header: t('invoice'), render: (e) => e.reference_number || '-' },
    { key: 'description', header: t('description'), render: (e) => e.description || '-' },
    { key: 'balance', header: t('balance'), render: (e) => {
      const ok = Math.abs(Number(e.debit_total) - Number(e.credit_total)) < 0.01;
      return ok ? <span className="inline-flex items-center gap-1 text-ui-success dark:text-ui-success text-xs font-semibold"><Scale className="w-3.5 h-3.5" />{formatCurrency(Number(e.debit_total), currency, lang)}</span> : <span className="text-ui-danger text-xs font-semibold">{t('notBalanced')}</span>;
    } },
    { key: 'actions', header: t('actions'), render: (e) => <Button size="sm" variant="outline" onClick={() => setViewing(e)}><Eye className="w-4 h-4" /> {t('view')}</Button> },
  ];

  const manualTotals = manualLines.reduce((acc, l) => ({
    debit: acc.debit + Number(l.debit || 0),
    credit: acc.credit + Number(l.credit || 0),
  }), { debit: 0, credit: 0 });
  const manualBalanced = Math.abs(manualTotals.debit - manualTotals.credit) < 0.01 && manualTotals.debit > 0;

  const addManualLine = () => setManualLines((ls) => [...ls, { account_id: '', debit: '', credit: '', note: '' }]);

  const submitManual = async () => {
    if (!manualDesc.trim()) { show(t('required'), 'error'); return; }
    const lines = manualLines
      .map((l) => ({
        account_code: accounts.find((a) => a.id === l.account_id)?.code || '',
        debit: Number(l.debit || 0),
        credit: Number(l.credit || 0),
        note: l.note || null,
      }))
      .filter((l) => (l.debit > 0 || l.credit > 0) && l.account_code);
    if (lines.length === 0) { show(t('required'), 'error'); return; }
    const db = lines.reduce((s, l) => s + l.debit, 0);
    const cr = lines.reduce((s, l) => s + l.credit, 0);
    if (Math.abs(db - cr) > 0.001) { show(t('journalUnbalanced'), 'error'); return; }

    setSaving(true);
    const { data, error } = await api.accounting.postManualJournal( {
      p_branch_id: effectiveBranchFilter,
      p_description: manualDesc.trim(),
      p_lines: lines,
    });
    setSaving(false);
    if (error) { show(error.message, 'error'); return; }
    const r = data as { success: boolean; error?: string; detail?: string; entry_id?: string; entry_number?: string } | null;
    if (!r?.success) { show(r?.detail || r?.error || t('error'), 'error'); return; }
    show(`${t('manualJournal')} ${r.entry_number || ''}`, 'success');
    await logAudit('create', 'journal_entries', r.entry_id, { entry_number: r.entry_number, amount: db });
    setManualOpen(false);
    setManualDesc('');
    setManualLines([]);
    load();
  };

  return (
    <DesignSurface testId="journal-page">
      <DesignPageHeader
        title={t('journalEntries')}
        subtitle={t('journal')}
        actions={can('accounts.manage') && (
          <Button size="sm" onClick={() => setManualOpen(true)}><Plus className="w-4 h-4" /> {t('postManualJournal')}</Button>
        )}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard title={t('journalEntries')} value={String(items.length)} icon={<Scale className="w-5 h-5" />} color="brand" />
        <StatCard title={t('totalDebit')} value={formatCurrency(items.reduce((s, e) => s + Number(e.debit_total), 0), currency, lang)} icon={<Scale className="w-5 h-5" />} color="blue" />
        <StatCard title={t('totalCredit')} value={formatCurrency(items.reduce((s, e) => s + Number(e.credit_total), 0), currency, lang)} icon={<Scale className="w-5 h-5" />} color="amber" />
        <StatCard title={t('balance')} value={formatCurrency(items.reduce((s, e) => s + Number(e.debit_total) - Number(e.credit_total), 0), currency, lang)} icon={<Scale className="w-5 h-5" />} color="green" />
      </div>

      <DesignPanel testId="journal-search-panel">
        <div className="flex flex-col sm:flex-row gap-4 items-end justify-between">
          <DesignSearch value={search} onChange={setSearch} className="flex-1 w-full" label={t('search')} placeholder={t('search')} testId="journal-search" />
          <div className="flex flex-wrap items-end gap-3">
            <Select label={t('referenceType')} value={refType} onChange={(e) => setRefType(e.target.value)}>
              <option value="">{t('allTypes')}</option>
              {Object.entries(REF_TYPE_KEYS).map(([value, key]) => <option key={value} value={value}>{t(key as never)}</option>)}
            </Select>
            <Input label={t('from')} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input label={t('to')} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            {isAdminRole(user?.role) && branches.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-ui-muted mb-1">{t('filterByBranch')}</label>
                <select value={adminBranchFilter} onChange={(e) => setAdminBranchFilter(e.target.value)}
                  className="px-3 py-2 rounded-lg text-sm border border-ui-border bg-ui-surface text-ui-text">
                  <option value="">{t('allBranches')}</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{isAr ? b.name : (b.name_en || b.name)}</option>)}
                </select>
              </div>
            )}
          </div>
        </div>
      </DesignPanel>

      <DesignPanel testId="journal-table-panel">
        <DataTable columns={columns} data={items} loading={loading} emptyMessage={t('noData')} />
      </DesignPanel>

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `${viewing.entry_number} - ${viewing.description || ''}` : ''} size="lg">
        {viewing && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-4 text-sm">
              <div><span className="text-ui-subtle">{t('date')}: </span><span className="font-medium text-ui-text">{formatDateTime(viewing.entry_date, lang)}</span></div>
              <div><span className="text-ui-subtle">{t('referenceType')}: </span><span className="font-medium text-ui-text">{refLabel(viewing.reference_type)} {viewing.reference_number || ''}</span></div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-ui-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ui-border bg-ui-page-alt/60">
                    <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('accountCode')}</th>
                    <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('accountName')}</th>
                    <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('debit')}</th>
                    <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('credit')}</th>
                    <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('notes')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(viewing.lines || []).map((l) => (
                    <tr key={l.id} className="border-b border-ui-border">
                      <td className="px-4 py-3 font-mono text-ui-text">{l.code}</td>
                      <td className="px-4 py-3 text-ui-text">{l.account_name}</td>
                      <td className="px-4 py-3 text-ui-text">{l.debit > 0 ? formatCurrency(l.debit, currency, lang) : '-'}</td>
                      <td className="px-4 py-3 text-ui-text">{l.credit > 0 ? formatCurrency(l.credit, currency, lang) : '-'}</td>
                      <td className="px-4 py-3 text-ui-subtle dark:text-ui-subtle">{l.note || '-'}</td>
                    </tr>
                  ))}
                  <tr className="bg-ui-page-alt/60 font-semibold text-ui-text">
                    <td className="px-4 py-3" colSpan={2}>{t('total')}</td>
                    <td className="px-4 py-3">{formatCurrency((viewing.lines || []).reduce((s, l) => s + Number(l.debit), 0), currency, lang)}</td>
                    <td className="px-4 py-3">{formatCurrency((viewing.lines || []).reduce((s, l) => s + Number(l.credit), 0), currency, lang)}</td>
                    <td className="px-4 py-3"></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setViewing(null)}>{t('close')}</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={manualOpen} onClose={() => { setManualOpen(false); setManualDesc(''); setManualLines([]); }} title={t('postManualJournal')} size="lg">
        <div className="space-y-4">
          <Input label={t('description')} value={manualDesc} onChange={(e) => setManualDesc(e.target.value)} placeholder={t('description')} />
          <div className="space-y-3">
            {manualLines.map((l, i) => (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end p-3 rounded-xl bg-ui-page-alt dark:bg-navy-800/60">
                <div className="sm:col-span-5">
                  <Select label={t('accountName')} value={l.account_id} onChange={(e) => setManualLines((ls) => ls.map((x, j) => j === i ? { ...x, account_id: e.target.value } : x))}>
                    <option value="">{t('selectAccount')}</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} - {isAr ? a.name : (a.name_en || a.name)}</option>)}
                  </Select>
                </div>
                <div className="sm:col-span-2">
                  <Input label={t('debit')} type="number" value={l.debit} onChange={(e) => setManualLines((ls) => ls.map((x, j) => j === i ? { ...x, debit: e.target.value } : x))} />
                </div>
                <div className="sm:col-span-2">
                  <Input label={t('credit')} type="number" value={l.credit} onChange={(e) => setManualLines((ls) => ls.map((x, j) => j === i ? { ...x, credit: e.target.value } : x))} />
                </div>
                <div className="sm:col-span-2">
                  <Input label={t('notes')} value={l.note} onChange={(e) => setManualLines((ls) => ls.map((x, j) => j === i ? { ...x, note: e.target.value } : x))} />
                </div>
                <div className="sm:col-span-1">
                  <Button variant="danger" size="sm" onClick={() => setManualLines((ls) => ls.length > 1 ? ls.filter((_, j) => j !== i) : ls)} disabled={manualLines.length === 1}><Trash2 className="w-4 h-4" /></Button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={addManualLine}><Plus className="w-4 h-4" /> {t('addLine')}</Button>
            <div className="text-sm">
              <span className="text-ui-subtle">{t('totalDebit')}: </span>
              <span className={`font-bold ${manualBalanced ? 'text-ui-success dark:text-ui-success' : 'text-ui-danger'}`}>{formatCurrency(manualTotals.debit, currency, lang)}</span>
              <span className="mx-2 text-ui-muted">|</span>
              <span className="text-ui-subtle">{t('totalCredit')}: </span>
              <span className={`font-bold ${manualBalanced ? 'text-ui-success dark:text-ui-success' : 'text-ui-danger'}`}>{formatCurrency(manualTotals.credit, currency, lang)}</span>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setManualOpen(false); setManualDesc(''); setManualLines([]); }}>{t('cancel')}</Button>
            <Button onClick={submitManual} disabled={saving}><Plus className="w-4 h-4" /> {saving ? t('loading') : t('postManualJournal')}</Button>
          </div>
        </div>
      </Modal>
    </DesignSurface>
  );
}
