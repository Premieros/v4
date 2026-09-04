import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Scale, BookOpen, TrendingUp, PieChart, Clock, Download, BadgeCheck, BadgeAlert, Landmark, ArrowLeftRight, Receipt } from 'lucide-react';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { DesignSurface, DesignPageHeader, DesignPanel } from '@/components/design';
import { Card } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { formatCurrency, todayISO, formatDate } from '@/lib/format';
import { exportToExcel } from '@/lib/excel';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { isAdminRole } from '@/lib/permissions';
import { useSettings } from '@/context/SettingsContext';
import { useBranches } from '@/hooks/useBranches';
import type {
  TrialBalanceRow, GeneralLedgerRow, TrialBalanceSummary,
  IncomeStatementResult, BalanceSheetResult, ArAgingRow, ApAgingRow,
  AgingSummaryResult, CashFlowRow, PartyStatementResult,
  Customer, Supplier, ChartOfAccount,
} from '@/lib/types';

type View = 'trial_balance' | 'ledger' | 'income' | 'balance_sheet' | 'ar_aging' | 'ap_aging' | 'aging_summary' | 'cash_flow' | 'party_statement';

export function FinancialReportsPage() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const branchFilter = useBranchFilter();
  const isAr = lang === 'ar';
  const [searchParams] = useSearchParams();

  const requestedView = searchParams.get('view');
  const validViews: View[] = ['trial_balance', 'ledger', 'income', 'balance_sheet', 'ar_aging', 'ap_aging', 'aging_summary', 'cash_flow', 'party_statement'];
  const initialView = validViews.includes(requestedView as View) ? (requestedView as View) : 'trial_balance';

  const [view, setView] = useState<View>(initialView);
  const [from, setFrom] = useState(() => searchParams.get('from') || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => searchParams.get('to') || todayISO());
  const [loading, setLoading] = useState(false);
  const { effectiveSettings } = useSettings();
  const { branches } = useBranches();
  const [adminBranchFilter, setAdminBranchFilter] = useState('');
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [accountId, setAccountId] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [partySide, setPartySide] = useState<'ar' | 'ap'>('ar');
  const [partyId, setPartyId] = useState('');
  const effectiveBranchFilter = isAdminRole(user?.role) ? (adminBranchFilter || null) : branchFilter;
  const currency = effectiveSettings(effectiveBranchFilter)?.currency || 'EGP';

  const [tb, setTb] = useState<TrialBalanceRow[]>([]);
  const [tbSummary, setTbSummary] = useState<TrialBalanceSummary | null>(null);
  const [gl, setGl] = useState<GeneralLedgerRow[]>([]);
  const [income, setIncome] = useState<IncomeStatementResult | null>(null);
  const [sheet, setSheet] = useState<BalanceSheetResult | null>(null);
  const [arAging, setArAging] = useState<ArAgingRow[]>([]);
  const [apAging, setApAging] = useState<ApAgingRow[]>([]);
  const [agingSummary, setAgingSummary] = useState<AgingSummaryResult | null>(null);
  const [cashFlow, setCashFlow] = useState<CashFlowRow[]>([]);
  const [partyStmt, setPartyStmt] = useState<PartyStatementResult | null>(null);

  useEffect(() => {
    if (effectiveBranchFilter) {
      supabase.from('chart_of_accounts').select('id, code, name, name_en').eq('branch_id', effectiveBranchFilter).order('code').then(({ data }) => {
        setAccounts((data as ChartOfAccount[]) || []);
        setAccountId((prev) => prev || (data?.[0]?.id as string) || '');
      });
      supabase.from('customers').select('id, name, phone').eq('branch_id', effectiveBranchFilter).order('name').then(({ data }) => setCustomers((data as Customer[]) || []));
      supabase.from('suppliers').select('id, name, phone').eq('branch_id', effectiveBranchFilter).order('name').then(({ data }) => setSuppliers((data as Supplier[]) || []));
    } else {
      setAccounts([]);
      setAccountId('');
      setCustomers([]);
      setSuppliers([]);
    }
  }, [effectiveBranchFilter]);

  const load = useCallback(async () => {
    if (!effectiveBranchFilter) {
      setTb([]); setTbSummary(null); setGl([]); setIncome(null); setSheet(null);
      setArAging([]); setApAging([]); setAgingSummary(null); setCashFlow([]); setPartyStmt(null);
      return;
    }
    setLoading(true);
    try {
      if (view === 'trial_balance') {
        const [{ data }, { data: summary }] = await Promise.all([
          api.reporting.getTrialBalance({ p_branch_id: effectiveBranchFilter, p_to_date: to }),
          api.reporting.getTrialBalanceSummary({ p_branch_id: effectiveBranchFilter, p_to_date: to }),
        ]);
        setTb((data as TrialBalanceRow[]) || []);
        setTbSummary((summary as TrialBalanceSummary) || null);
      } else if (view === 'ledger') {
        const { data } = await api.reporting.getGeneralLedger( {
          p_branch_id: effectiveBranchFilter,
          p_account_id: accountId || null,
          p_from_date: from,
          p_to_date: to,
        });
        setGl((data as GeneralLedgerRow[]) || []);
      } else if (view === 'income') {
        const { data } = await api.reporting.getIncomeStatement( { p_branch_id: effectiveBranchFilter, p_from_date: from, p_to_date: to });
        setIncome((data as IncomeStatementResult) || null);
      } else if (view === 'balance_sheet') {
        const { data } = await api.reporting.getBalanceSheet( { p_branch_id: effectiveBranchFilter, p_as_of: to });
        setSheet((data as BalanceSheetResult) || null);
      } else if (view === 'ar_aging') {
        const { data } = await api.reporting.getArAging( { p_branch_id: effectiveBranchFilter, p_as_of: to });
        setArAging((data as ArAgingRow[]) || []);
      } else if (view === 'ap_aging') {
        const { data } = await api.reporting.getApAging( { p_branch_id: effectiveBranchFilter, p_as_of: to });
        setApAging((data as ApAgingRow[]) || []);
      } else if (view === 'aging_summary') {
        const { data } = await api.reporting.getAgingSummary( { p_branch_id: effectiveBranchFilter, p_as_of: to });
        setAgingSummary((data as AgingSummaryResult) || null);
      } else if (view === 'cash_flow') {
        const { data } = await api.reporting.getCashFlow( { p_branch_id: effectiveBranchFilter, p_from_date: from, p_to_date: to });
        setCashFlow((data as CashFlowRow[]) || []);
      } else if (view === 'party_statement') {
        const { data } = await api.reporting.getPartyStatement( {
          p_branch_id: effectiveBranchFilter,
          p_side: partySide,
          p_party_id: partyId || null,
          p_from_date: from || null,
          p_to_date: to || null,
        });
        setPartyStmt((data as PartyStatementResult) || null);
      }
    } finally {
      setLoading(false);
    }
  }, [effectiveBranchFilter, view, to, accountId, from, partySide, partyId]);

  useEffect(() => { load(); }, [load]);

  const views: { key: View; label: string; icon: React.ReactNode }[] = [
    { key: 'trial_balance', label: t('trialBalance'), icon: <Scale className="w-4 h-4" /> },
    { key: 'ledger', label: t('generalLedger'), icon: <BookOpen className="w-4 h-4" /> },
    { key: 'income', label: t('incomeStatement'), icon: <TrendingUp className="w-4 h-4" /> },
    { key: 'balance_sheet', label: t('balanceSheet'), icon: <PieChart className="w-4 h-4" /> },
    { key: 'ar_aging', label: t('arAging'), icon: <Clock className="w-4 h-4" /> },
    { key: 'ap_aging', label: t('apAging'), icon: <Landmark className="w-4 h-4" /> },
    { key: 'aging_summary', label: t('agingSummary'), icon: <PieChart className="w-4 h-4" /> },
    { key: 'cash_flow', label: t('cashFlow'), icon: <ArrowLeftRight className="w-4 h-4" /> },
    { key: 'party_statement', label: t('partyStatement'), icon: <Receipt className="w-4 h-4" /> },
  ];

  const exportData = () => {
    if (view === 'trial_balance') exportToExcel(tb.map((r) => ({ Code: r.code, Name: isAr ? r.name : (r.name_en || r.name), Type: r.account_type, Debit: r.debit, Credit: r.credit, Balance: r.balance })), `trial_balance_${to}`);
    else if (view === 'ledger') exportToExcel(gl.map((r) => ({ Date: r.entry_date, Entry: r.entry_number, Description: r.description || '', Reference: r.reference_number || '', Debit: r.debit, Credit: r.credit, Balance: r.balance })), `general_ledger_${to}`);
    else if (view === 'income' && income) exportToExcel([{ Item: t('revenue'), Amount: income.revenue }, { Item: t('grossProfit'), Amount: income.gross_profit }, { Item: t('netIncome'), Amount: income.net_income }], `income_statement_${to}`);
    else if (view === 'balance_sheet' && sheet) exportToExcel([{ Item: t('assets'), Amount: sheet.assets }, { Item: t('liabilities'), Amount: sheet.liabilities }, { Item: t('equity'), Amount: sheet.equity }], `balance_sheet_${to}`);
    else if (view === 'ar_aging') exportToExcel(arAging.map((r) => ({ Customer: r.name, Phone: r.phone || '', Open: r.open_amount, '0-30': r.bucket_0_30, '31-60': r.bucket_31_60, '61-90': r.bucket_61_90, '90+': r.bucket_90_plus })), `ar_aging_${to}`);
    else if (view === 'ap_aging') exportToExcel(apAging.map((r) => ({ Supplier: r.name, Phone: r.phone || '', Open: r.open_amount, '0-30': r.bucket_0_30, '31-60': r.bucket_31_60, '61-90': r.bucket_61_90, '90+': r.bucket_90_plus })), `ap_aging_${to}`);
    else if (view === 'aging_summary' && agingSummary) exportToExcel([{ Item: 'AR', Amount: agingSummary.ar_open }, { Item: 'AP', Amount: agingSummary.ap_open }], `aging_summary_${to}`);
    else if (view === 'cash_flow') exportToExcel(cashFlow.map((r) => ({ Account: r.account_name, Type: r.account_type, Inflow: r.inflow, Outflow: r.outflow, Net: r.net })), `cash_flow_${to}`);
    else if (view === 'party_statement' && partyStmt) exportToExcel(partyStmt.rows.map((r) => ({ Date: r.entry_date, Entry: r.entry_number, Description: r.description || '', Reference: r.reference_number || '', Debit: r.debit, Credit: r.credit, Balance: r.balance })), `party_statement_${to}`);
  };

  const summaryCard = (label: string, value: number, color = 'text-ui-text dark:text-white') => (
    <div className="bg-ui-page-alt/60 rounded-xl p-4">
      <p className="text-xs font-medium text-ui-subtle dark:text-ui-subtle">{label}</p>
      <p className={`text-lg font-bold mt-1 ${color}`}>{formatCurrency(value, currency, lang)}</p>
    </div>
  );

  const incomeRows: { label: string; value: number; bold?: boolean }[] = income ? [
    { label: t('revenue'), value: income.revenue },
    { label: t('discounts'), value: income.discount },
    { label: t('netRevenue'), value: income.net_revenue, bold: true },
    { label: t('cogs'), value: income.cogs },
    { label: t('grossProfit'), value: income.gross_profit, bold: true },
    { label: t('expenses'), value: income.expenses },
    { label: t('netIncome'), value: income.net_income, bold: true },
  ] : [];

  const tbTotals = tb.reduce((acc, r) => ({ debit: acc.debit + Number(r.debit), credit: acc.credit + Number(r.credit) }), { debit: 0, credit: 0 });

  const partyList = partySide === 'ar' ? customers : suppliers;

  return (
    <DesignSurface testId="financial-reports-page">
      <DesignPageHeader title={t('financialReports')} actions={<Button variant="outline" size="sm" onClick={exportData}><Download className="w-4 h-4" /> {t('exportExcel')}</Button>} />

      <DesignPanel testId="financial-reports-filters">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {views.map((v) => (
              <button key={v.key} data-report-type={v.key} onClick={() => setView(v.key)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${view === v.key ? 'bg-brand-600 text-white' : 'bg-ui-page-alt text-ui-muted hover:bg-ui-page-alt dark:hover:bg-ui-page-alt'}`}>
                {v.icon} {v.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-4">
            {(view === 'ledger' || view === 'income' || view === 'cash_flow') && <Input label={t('from')} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}
            <Input label={view === 'income' || view === 'ledger' || view === 'cash_flow' ? t('to') : t('asOf')} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            {view === 'ledger' && accounts.length > 0 && (
              <Select label={t('accountName')} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">{t('allAccounts')}</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} - {isAr ? a.name : (a.name_en || a.name)}</option>)}
              </Select>
            )}
            {view === 'party_statement' && (
              <>
                <Select label={t('referenceType')} value={partySide} onChange={(e) => { setPartySide(e.target.value as 'ar' | 'ap'); setPartyId(''); }}>
                  <option value="ar">{t('customer')}</option>
                  <option value="ap">{t('supplier')}</option>
                </Select>
                <Select label={t('selectParty')} value={partyId} onChange={(e) => setPartyId(e.target.value)}>
                  <option value="">{t('selectParty')}</option>
                  {partyList.map((p) => <option key={p.id} value={p.id}>{isAr ? p.name : (p.name)}</option>)}
                </Select>
              </>
            )}
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

      {loading ? (
        <DesignPanel testId="financial-reports-loading"><div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" /></div></DesignPanel>
      ) : !effectiveBranchFilter ? (
        <DesignPanel testId="financial-reports-placeholder"><div className="text-center py-12 text-ui-subtle text-sm">{t('filterByBranch')}</div></DesignPanel>
      ) : view === 'trial_balance' ? (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-6">
            {tbSummary?.balanced ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold bg-ui-success-soft text-ui-success  dark:text-ui-success"><BadgeCheck className="w-4 h-4" /> {t('balanced')}</span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold bg-ui-danger-soft text-ui-danger"><BadgeAlert className="w-4 h-4" /> {t('notBalanced')}</span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ui-border">
                  <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('accountCode')}</th>
                  <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('accountName')}</th>
                  <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('accountType')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('debit')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('credit')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('balance')}</th>
                </tr>
              </thead>
              <tbody>
                {tb.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-ui-subtle">{t('noData')}</td></tr>}
                {tb.map((r) => (
                  <tr key={r.code} className="border-b border-ui-border hover:bg-ui-page-alt/50">
                    <td className="px-4 py-3 font-mono text-ui-text">{r.code}</td>
                    <td className="px-4 py-3 text-ui-text">{isAr ? r.name : (r.name_en || r.name)}</td>
                    <td className="px-4 py-3 text-ui-subtle dark:text-ui-subtle">{r.account_type}</td>
                    <td className="px-4 py-3 text-end text-ui-text">{r.debit > 0 ? formatCurrency(r.debit, currency, lang) : '-'}</td>
                    <td className="px-4 py-3 text-end text-ui-text">{r.credit > 0 ? formatCurrency(r.credit, currency, lang) : '-'}</td>
                    <td className={`px-4 py-3 text-end font-semibold ${r.balance < 0 ? 'text-ui-danger' : 'text-ui-text'}`}>{formatCurrency(r.balance, currency, lang)}</td>
                  </tr>
                ))}
                {tb.length > 0 && (
                  <tr className="bg-ui-page-alt/60 font-semibold text-ui-text">
                    <td className="px-4 py-3" colSpan={3}>{t('total')}</td>
                    <td className="px-4 py-3 text-end">{formatCurrency(tbTotals.debit, currency, lang)}</td>
                    <td className="px-4 py-3 text-end">{formatCurrency(tbTotals.credit, currency, lang)}</td>
                    <td className="px-4 py-3 text-end">{formatCurrency(tbTotals.debit - tbTotals.credit, currency, lang)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : view === 'ledger' ? (
        <Card className="p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ui-border">
                  <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('date')}</th>
                  <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('entryNumber')}</th>
                  <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('description')}</th>
                  <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('reference')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('debit')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('credit')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('balance')}</th>
                </tr>
              </thead>
              <tbody>
                {gl.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-ui-subtle">{t('noData')}</td></tr>}
                {gl.map((r) => (
                  <tr key={r.line_id} className="border-b border-ui-border hover:bg-ui-page-alt/50">
                    <td className="px-4 py-3 text-ui-text">{r.entry_date}</td>
                    <td className="px-4 py-3 font-mono text-ui-text">{r.entry_number}</td>
                    <td className="px-4 py-3 text-ui-text">{r.description || '-'}</td>
                    <td className="px-4 py-3 text-ui-subtle dark:text-ui-subtle">{r.reference_number || '-'}</td>
                    <td className="px-4 py-3 text-end text-ui-text">{r.debit > 0 ? formatCurrency(r.debit, currency, lang) : '-'}</td>
                    <td className="px-4 py-3 text-end text-ui-text">{r.credit > 0 ? formatCurrency(r.credit, currency, lang) : '-'}</td>
                    <td className="px-4 py-3 text-end font-semibold text-ui-text">{formatCurrency(r.balance, currency, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : view === 'income' ? (
        <Card className="p-4">
          {income && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              {summaryCard(t('revenue'), income.revenue)}
              {summaryCard(t('cogs'), income.cogs)}
              {summaryCard(t('grossProfit'), income.gross_profit, 'text-brand-600 dark:text-brand-400')}
              {summaryCard(t('netIncome'), income.net_income, income.net_income >= 0 ? 'text-ui-success dark:text-ui-success' : 'text-ui-danger')}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {incomeRows.map((r) => (
                  <tr key={r.label} className={`border-b border-ui-border ${r.bold ? 'bg-ui-page-alt/60' : ''}`}>
                    <td className="px-4 py-3 text-ui-text font-medium">{r.label}</td>
                    <td className={`px-4 py-3 text-end ${r.bold ? 'font-bold text-ui-text dark:text-white' : 'text-ui-text'}`}>{formatCurrency(r.value, currency, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : view === 'balance_sheet' ? (
        <Card className="p-4">
          {sheet && (
            <>
              <div className="flex items-center gap-2 mb-6">
                {sheet.balanced ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold bg-ui-success-soft text-ui-success  dark:text-ui-success"><BadgeCheck className="w-4 h-4" /> {t('balanced')}</span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold bg-ui-danger-soft text-ui-danger"><BadgeAlert className="w-4 h-4" /> {t('notBalanced')}</span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {summaryCard(t('assets'), sheet.assets)}
                {summaryCard(t('liabilities'), sheet.liabilities)}
                {summaryCard(t('equity'), sheet.equity)}
                {summaryCard(t('capital'), sheet.capital)}
                {summaryCard(t('retainedEarnings'), sheet.retained)}
                {summaryCard(t('netIncome'), sheet.net_income, 'text-brand-600 dark:text-brand-400')}
              </div>
            </>
          )}
        </Card>
      ) : view === 'ar_aging' ? (
        <Card className="p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ui-border">
                  <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('customer')}</th>
                  <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('phone')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('openBalance')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('days30')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('days60')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('days90')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('days90Plus')}</th>
                </tr>
              </thead>
              <tbody>
                {arAging.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-ui-subtle">{t('noData')}</td></tr>}
                {arAging.map((r) => (
                  <tr key={r.customer_id} className="border-b border-ui-border hover:bg-ui-page-alt/50">
                    <td className="px-4 py-3 font-medium text-ui-text">{r.name}</td>
                    <td className="px-4 py-3 text-ui-subtle dark:text-ui-subtle">{r.phone || '-'}</td>
                    <td className="px-4 py-3 text-end font-semibold text-ui-danger">{formatCurrency(r.open_amount, currency, lang)}</td>
                    <td className="px-4 py-3 text-end text-ui-text">{formatCurrency(r.bucket_0_30, currency, lang)}</td>
                    <td className="px-4 py-3 text-end text-ui-text">{formatCurrency(r.bucket_31_60, currency, lang)}</td>
                    <td className="px-4 py-3 text-end text-ui-text">{formatCurrency(r.bucket_61_90, currency, lang)}</td>
                    <td className={`px-4 py-3 text-end ${r.bucket_90_plus > 0 ? 'text-ui-danger font-semibold' : 'text-ui-text'}`}>{formatCurrency(r.bucket_90_plus, currency, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : view === 'ap_aging' ? (
        <Card className="p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ui-border">
                  <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('supplier')}</th>
                  <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('phone')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('openBalance')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('days30')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('days60')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('days90')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('days90Plus')}</th>
                </tr>
              </thead>
              <tbody>
                {apAging.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-ui-subtle">{t('noData')}</td></tr>}
                {apAging.map((r) => (
                  <tr key={r.supplier_id} className="border-b border-ui-border hover:bg-ui-page-alt/50">
                    <td className="px-4 py-3 font-medium text-ui-text">{r.name}</td>
                    <td className="px-4 py-3 text-ui-subtle dark:text-ui-subtle">{r.phone || '-'}</td>
                    <td className="px-4 py-3 text-end font-semibold text-ui-danger">{formatCurrency(r.open_amount, currency, lang)}</td>
                    <td className="px-4 py-3 text-end text-ui-text">{formatCurrency(r.bucket_0_30, currency, lang)}</td>
                    <td className="px-4 py-3 text-end text-ui-text">{formatCurrency(r.bucket_31_60, currency, lang)}</td>
                    <td className="px-4 py-3 text-end text-ui-text">{formatCurrency(r.bucket_61_90, currency, lang)}</td>
                    <td className={`px-4 py-3 text-end ${r.bucket_90_plus > 0 ? 'text-ui-danger font-semibold' : 'text-ui-text'}`}>{formatCurrency(r.bucket_90_plus, currency, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : view === 'aging_summary' ? (
        <Card className="p-4">
          {agingSummary && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                {summaryCard(t('arTotal'), agingSummary.ar_open, 'text-ui-info')}
                {summaryCard(t('apTotal'), agingSummary.ap_open, 'text-ui-warning')}
                {summaryCard(t('openBalance'), agingSummary.ar_open + agingSummary.ap_open)}
                <div className="bg-ui-page-alt/60 rounded-xl p-4">
                  <p className="text-xs font-medium text-ui-subtle dark:text-ui-subtle">{t('asOf')}</p>
                  <p className="text-lg font-bold mt-1 text-ui-text dark:text-white">{formatDate(agingSummary.as_of, lang)}</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-ui-border">
                      <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('days30')}</th>
                      <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('days60')}</th>
                      <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('days90')}</th>
                      <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('days90Plus')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-ui-border">
                      <td className="px-4 py-3 font-medium text-ui-text">{t('arTotal')}</td>
                      <td className="px-4 py-3 text-end text-ui-text">{formatCurrency(agingSummary.ar['0_30'], currency, lang)}</td>
                      <td className="px-4 py-3 text-end text-ui-text">{formatCurrency(agingSummary.ar['31_60'], currency, lang)}</td>
                      <td className="px-4 py-3 text-end text-ui-text">{formatCurrency(agingSummary.ar['61_90'], currency, lang)}</td>
                      <td className="px-4 py-3 text-end text-ui-text">{formatCurrency(agingSummary.ar['90_plus'], currency, lang)}</td>
                    </tr>
                    <tr className="border-b border-ui-border">
                      <td className="px-4 py-3 font-medium text-ui-text">{t('apTotal')}</td>
                      <td className="px-4 py-3 text-end text-ui-text">{formatCurrency(agingSummary.ap['0_30'], currency, lang)}</td>
                      <td className="px-4 py-3 text-end text-ui-text">{formatCurrency(agingSummary.ap['31_60'], currency, lang)}</td>
                      <td className="px-4 py-3 text-end text-ui-text">{formatCurrency(agingSummary.ap['61_90'], currency, lang)}</td>
                      <td className="px-4 py-3 text-end text-ui-text">{formatCurrency(agingSummary.ap['90_plus'], currency, lang)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      ) : view === 'cash_flow' ? (
        <Card className="p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ui-border">
                  <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('accountName')}</th>
                  <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('accountType')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('inflow')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('outflow')}</th>
                  <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('netFlow')}</th>
                </tr>
              </thead>
              <tbody>
                {cashFlow.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-ui-subtle">{t('noData')}</td></tr>}
                {cashFlow.map((r) => (
                  <tr key={r.treasury_account_id} className="border-b border-ui-border hover:bg-ui-page-alt/50">
                    <td className="px-4 py-3 font-medium text-ui-text">{r.account_name}</td>
                    <td className="px-4 py-3 text-ui-subtle dark:text-ui-subtle">{r.account_type === 'cash' ? t('cash') : t('bank')}</td>
                    <td className="px-4 py-3 text-end text-ui-success dark:text-ui-success">{formatCurrency(r.inflow, currency, lang)}</td>
                    <td className="px-4 py-3 text-end text-ui-danger">{formatCurrency(r.outflow, currency, lang)}</td>
                    <td className={`px-4 py-3 text-end font-semibold ${r.net < 0 ? 'text-ui-danger' : 'text-ui-text'}`}>{formatCurrency(r.net, currency, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card className="p-4">
          {partyStmt && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                {summaryCard(t('openingBalance'), partyStmt.opening)}
                {summaryCard(t('runningBalance'), partyStmt.rows.length ? partyStmt.rows[partyStmt.rows.length - 1].balance : partyStmt.opening)}
                <div className="bg-ui-page-alt/60 rounded-xl p-4">
                  <p className="text-xs font-medium text-ui-subtle dark:text-ui-subtle">{t('asOf')}</p>
                  <p className="text-lg font-bold mt-1 text-ui-text dark:text-white">{formatDate(to, lang)}</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-ui-border">
                      <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('date')}</th>
                      <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('entryNumber')}</th>
                      <th className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('description')}</th>
                      <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('debit')}</th>
                      <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('credit')}</th>
                      <th className="px-4 py-3 text-end font-semibold text-ui-muted text-xs uppercase tracking-wider">{t('balance')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {partyStmt.rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-ui-subtle">{t('noData')}</td></tr>}
                    {partyStmt.rows.map((r) => (
                      <tr key={r.line_id} className="border-b border-ui-border hover:bg-ui-page-alt/50">
                        <td className="px-4 py-3 text-ui-muted">{formatDate(r.entry_date, lang)}</td>
                        <td className="px-4 py-3 font-mono text-ui-text">{r.entry_number}</td>
                        <td className="px-4 py-3 text-ui-text">{r.description || '-'}</td>
                        <td className="px-4 py-3 text-end text-ui-text">{r.debit > 0 ? formatCurrency(r.debit, currency, lang) : '-'}</td>
                        <td className="px-4 py-3 text-end text-ui-text">{r.credit > 0 ? formatCurrency(r.credit, currency, lang) : '-'}</td>
                        <td className="px-4 py-3 text-end font-semibold text-ui-text">{formatCurrency(r.balance, currency, lang)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      )}
    </DesignSurface>
  );
}
