import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, TrendingUp, ShoppingCart, Receipt, Package, BarChart3, CreditCard, Users, FileText, List, Layers, TrendingDown, AlertTriangle, FileDown, Printer, UserCheck, RotateCcw, Trash2 } from 'lucide-react';
import { supabase, costing } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { PageHeader, Card } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { formatCurrency, formatDate, todayISO } from '@/lib/format';
import { getBrandColor } from '@/lib/brandColor';
import { exportToExcelAdvanced } from '@/lib/excel';
import { downloadCSV, openPrintWindow } from '@/lib/reportExport';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { isAdminRole, useCan } from '@/lib/permissions';
import { useColumnPreferences } from '../useColumnPreferences';
import { ColumnPicker } from '../ColumnPicker';
import { useCustomReports } from '../useCustomReports';
import type { SavedReportConfig } from '../useCustomReports';
import { CustomReportBar } from '../CustomReportBar';
import { ReportFilterBar } from '../ReportFilterBar';
import { useBranches } from '@/hooks/useBranches';
import { useSettings } from '@/context/SettingsContext';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, Legend } from 'recharts';
import { applySalesFilters, applySaleItemFilters, applyPurchaseFilters, applyExpenseFilters, applyProductScopedFilters, REPORT_FILTER_DIMS, DATE_DRIVEN_REPORTS, ORDER_TYPE_OPTIONS, PAYMENT_METHOD_OPTIONS, SALE_STATUS_OPTIONS, type ReportFilters, type ReportFilterKey, type EqBuilder } from '../reportFilters';

type ReportType = 'sales' | 'purchases' | 'expenses' | 'profit' | 'inventory' | 'sales_by_payment' | 'sales_by_employee' | 'sales_by_product' | 'detailed_invoices' | 'component_consumption' | 'recipe_costs' | 'top_consumed_components' | 'top_consumed_products' | 'low_stock' | 'cashier_performance' | 'returns' | 'production_waste';

type FinancialReportType = 'trial_balance' | 'ledger' | 'income' | 'balance_sheet' | 'ar_aging' | 'ap_aging' | 'aging_summary' | 'cash_flow' | 'party_statement';

type PeriodKey = 'custom' | 'today' | 'yesterday' | 'last7' | 'last30' | 'this_month' | 'last_month' | 'this_year';

const PIE_COLORS = [getBrandColor(600), '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#10b981', '#ec4899', getBrandColor(500)];

interface ReportsPageProps {
  controlledReportType?: ReportType;
  onReportTypeChange?: (type: ReportType) => void;
}

export function ReportsPage({ controlledReportType, onReportTypeChange }: ReportsPageProps = {}) {
  /* REPORT-BRANCH-AUDIT-2026 */
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const can = useCan();
  const navigate = useNavigate();
  const branchFilter = useBranchFilter();
  const [reportType, setReportType] = useState<ReportType>('sales');

  useEffect(() => {
    if (controlledReportType) {
      setReportType((prev) => {
        if (prev !== controlledReportType) {
          setFilters({});
          onReportTypeChange?.(controlledReportType);
          return controlledReportType;
        }
        return prev;
      });
    }
  }, [controlledReportType, onReportTypeChange]);
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(todayISO());
  const [period, setPeriod] = useState<PeriodKey>('custom');
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [chartData, setChartData] = useState<{ name: string; value: number }[]>([]);
  const [summary, setSummary] = useState({ total: 0, count: 0 });
  const [loading, setLoading] = useState(false);
  const [adminBranchFilter, setAdminBranchFilter] = useState<string>('');
  const [filters, setFilters] = useState<ReportFilters>({});
  const [options, setOptions] = useState<{
    warehouses: { id: string; name: string; name_en: string | null }[];
    cashiers: { id: string; full_name: string | null; email: string | null }[];
    customers: { id: string; name: string; name_en: string | null }[];
    suppliers: { id: string; name: string; name_en: string | null }[];
    products: { id: string; name: string; name_en: string | null }[];
    categories: { id: string; name: string; name_en: string | null }[];
    tables: { id: string; name: string }[];
    expenseCategories: string[];
  }>({ warehouses: [], cashiers: [], customers: [], suppliers: [], products: [], categories: [], tables: [], expenseCategories: [] });
  const effectiveBranchFilter = isAdminRole(user?.role) ? (adminBranchFilter || null) : branchFilter;
  const { branches } = useBranches();
  const { effectiveSettings } = useSettings();
  const currency = effectiveSettings(effectiveBranchFilter)?.currency || 'EGP';
  const { visibleColumns, toggleColumn, showAllColumns } = useColumnPreferences(reportType);
  const { savedReports, saveReport, deleteReport } = useCustomReports();

  const filterQ = <T,>(q: T, f: ReportFilters, applier: (b: EqBuilder, x: ReportFilters) => EqBuilder): T =>
    applier(q as unknown as EqBuilder, f) as unknown as T;

  const financialTypes: { key: FinancialReportType; label: string }[] = [
    { key: 'trial_balance', label: t('trialBalance') },
    { key: 'ledger', label: t('generalLedger') },
    { key: 'income', label: t('incomeStatement') },
    { key: 'balance_sheet', label: t('balanceSheet') },
    { key: 'ar_aging', label: t('arAging') },
    { key: 'ap_aging', label: t('apAging') },
    { key: 'aging_summary', label: t('agingSummary') },
    { key: 'cash_flow', label: t('cashFlow') },
    { key: 'party_statement', label: t('partyStatement') },
  ];
  const canFinancial = can('reports.financial');

  function handleReportTypeSelect(value: string) {
    if (financialTypes.some((f) => f.key === value)) {
      navigate(`/financial-reports?view=${value}&from=${from}&to=${to}`);
      return;
    }
    setFilters({});
    setReportType(value as ReportType);
    onReportTypeChange?.(value as ReportType);
  }

  const handleSaveCustomReport = () => {
    const name = prompt(lang === 'ar' ? 'اسم التقرير:' : 'Report name:');
    if (!name?.trim()) return;
    saveReport(name.trim(), reportType, visibleColumns, filters);
  };

  const handleRestoreCustomReport = (config: SavedReportConfig) => {
    handleReportTypeSelect(config.reportType);
    setFilters(config.filters || {});
  };

  function applyPeriod(key: PeriodKey) {
    const now = new Date();
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const today = iso(now);
    let f = from;
    let t = today;
    if (key === 'today') {
      f = today;
    } else if (key === 'yesterday') {
      const y = new Date(now.getTime() - 86400000);
      f = iso(y);
      t = f;
    } else if (key === 'last7') {
      f = iso(new Date(now.getTime() - 6 * 86400000));
    } else if (key === 'last30') {
      f = iso(new Date(now.getTime() - 29 * 86400000));
    } else if (key === 'this_month') {
      f = iso(new Date(now.getFullYear(), now.getMonth(), 1));
    } else if (key === 'last_month') {
      f = iso(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      t = iso(new Date(now.getFullYear(), now.getMonth(), 0));
    } else if (key === 'this_year') {
      f = iso(new Date(now.getFullYear(), 0, 1));
    }
    setPeriod(key);
    setFrom(f);
    setTo(t);
  }

  useEffect(() => {
    (async () => {
      const [warehouses, cashiers, customers, suppliers, products, categories, tables] = await Promise.all([
        supabase.from('warehouses').select('id, name, name_en'),
        supabase.from('users').select('id, full_name, email'),
        supabase.from('customers').select('id, name, name_en'),
        supabase.from('suppliers').select('id, name, name_en'),
        supabase.from('products').select('id, name, name_en'),
        supabase.from('categories').select('id, name, name_en'),
        supabase.from('dining_tables').select('id, name'),
      ]);
      setOptions({
        warehouses: warehouses.data || [],
        cashiers: cashiers.data || [],
        customers: customers.data || [],
        suppliers: suppliers.data || [],
        products: products.data || [],
        categories: categories.data || [],
        tables: tables.data || [],
        expenseCategories: [],
      });
    })();
  }, []);

  useEffect(() => {
    if (reportType !== 'expenses') return;
    (async () => {
      const { data } = await supabase.from('expenses').select('category');
      const unique = Array.from(new Set((data || []).map((r) => String((r as Record<string, unknown>).category || '')).filter(Boolean)));
      setOptions((prev) => ({ ...prev, expenseCategories: unique }));
    })();
  }, [reportType]);

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportType, from, to, effectiveBranchFilter, filters]);

  async function loadReport() {
    setLoading(true);
    try {
      const fromTs = `${from}T00:00:00`;
      const toTs = `${to}T23:59:59`;

      if (reportType === 'sales') {
        let q = supabase.from('sales').select('id, invoice_number, total, created_at, customer:customers(name)').gte('created_at', fromTs).lte('created_at', toTs).order('created_at', { ascending: false }).limit(5000);
        if (effectiveBranchFilter) q = q.eq('branch_id', effectiveBranchFilter);
        q = filterQ(q, filters, applySalesFilters);
        const { data: sales } = await q;
        const rows = (sales || []).map((s: Record<string, unknown>) => ({ [lang === 'ar' ? 'الفاتورة' : 'Invoice']: s.invoice_number, [lang === 'ar' ? 'التاريخ' : 'Date']: formatDate(s.created_at as string, lang), [lang === 'ar' ? 'العميل' : 'Customer']: (s.customer as { name?: string })?.name || '', [lang === 'ar' ? 'الإجمالي' : 'Total']: Number(s.total) }));
        setData(rows);
        setChartData((sales || []).slice(0, 10).map((s: Record<string, unknown>) => ({ name: String(s.invoice_number), value: Number(s.total) })));
        setSummary({ total: (sales || []).reduce((s: number, r: Record<string, unknown>) => s + Number(r.total), 0), count: (sales || []).length });
      } else if (reportType === 'purchases') {
        let q = supabase.from('purchases').select('id, invoice_number, total, created_at, supplier:suppliers(name)').gte('created_at', fromTs).lte('created_at', toTs).order('created_at', { ascending: false }).limit(5000);
        if (effectiveBranchFilter) q = q.eq('branch_id', effectiveBranchFilter);
        q = filterQ(q, filters, applyPurchaseFilters);
        const { data: purchases } = await q;
        const rows = (purchases || []).map((p: Record<string, unknown>) => ({ [lang === 'ar' ? 'الفاتورة' : 'Invoice']: p.invoice_number, [lang === 'ar' ? 'التاريخ' : 'Date']: formatDate(p.created_at as string, lang), [lang === 'ar' ? 'المورد' : 'Supplier']: (p.supplier as { name?: string })?.name || '', [lang === 'ar' ? 'الإجمالي' : 'Total']: Number(p.total) }));
        setData(rows);
        setChartData((purchases || []).slice(0, 10).map((p: Record<string, unknown>) => ({ name: String(p.invoice_number), value: Number(p.total) })));
        setSummary({ total: (purchases || []).reduce((s: number, r: Record<string, unknown>) => s + Number(r.total), 0), count: (purchases || []).length });
      } else if (reportType === 'expenses') {
        let q = supabase.from('expenses').select('id, category, description, amount, expense_date').gte('expense_date', from).lte('expense_date', to).order('expense_date', { ascending: false }).limit(5000);
        if (effectiveBranchFilter) q = q.eq('branch_id', effectiveBranchFilter);
        q = filterQ(q, filters, applyExpenseFilters);
        const { data: expenses } = await q;
        const rows = (expenses || []).map((e: Record<string, unknown>) => ({ [lang === 'ar' ? 'التاريخ' : 'Date']: formatDate(e.expense_date as string, lang), [lang === 'ar' ? 'الفئة' : 'Category']: e.category || '', [lang === 'ar' ? 'الوصف' : 'Description']: e.description || '', [lang === 'ar' ? 'المبلغ' : 'Amount']: Number(e.amount) }));
        setData(rows);
        const catMap = new Map<string, number>();
        (expenses || []).forEach((e: Record<string, unknown>) => catMap.set(String(e.category || ''), (catMap.get(String(e.category || '')) || 0) + Number(e.amount)));
        setChartData(Array.from(catMap.entries()).map(([name, value]) => ({ name: name || (lang === 'ar' ? 'غير محدد' : 'Other'), value })));
        setSummary({ total: (expenses || []).reduce((s: number, r: Record<string, unknown>) => s + Number(r.amount), 0), count: (expenses || []).length });
      } else if (reportType === 'profit') {
        let salesQ = supabase.from('sales').select('total').gte('created_at', fromTs).lte('created_at', toTs);
        let purchasesQ = supabase.from('purchases').select('total').gte('created_at', fromTs).lte('created_at', toTs);
        let expensesQ = supabase.from('expenses').select('amount').gte('expense_date', from).lte('expense_date', to);
        if (effectiveBranchFilter) { salesQ = salesQ.eq('branch_id', effectiveBranchFilter); purchasesQ = purchasesQ.eq('branch_id', effectiveBranchFilter); expensesQ = expensesQ.eq('branch_id', effectiveBranchFilter); }
        salesQ = filterQ(salesQ, filters, applySalesFilters);
        purchasesQ = filterQ(purchasesQ, filters, applyPurchaseFilters);
        expensesQ = filterQ(expensesQ, filters, applyExpenseFilters);
        const [sales, purchases, expenses] = await Promise.all([salesQ, purchasesQ, expensesQ]);
        const totalSales = (sales.data || []).reduce((s, r) => s + Number(r.total), 0);
        const totalPurchases = (purchases.data || []).reduce((s, r) => s + Number(r.total), 0);
        const totalExpenses = (expenses.data || []).reduce((s, r) => s + Number(r.amount), 0);
        const profit = totalSales - totalPurchases - totalExpenses;
        setData([{ [lang === 'ar' ? 'الفترة' : 'Period']: `${from} - ${to}`, [lang === 'ar' ? 'المبيعات' : 'Sales']: totalSales, [lang === 'ar' ? 'المشتريات' : 'Purchases']: totalPurchases, [lang === 'ar' ? 'المصروفات' : 'Expenses']: totalExpenses, [lang === 'ar' ? 'الربح' : 'Profit']: profit }]);
        setChartData([
          { name: t('totalSales'), value: totalSales },
          { name: t('totalPurchases'), value: totalPurchases },
          { name: t('totalExpenses'), value: totalExpenses },
          { name: t('netProfit'), value: profit },
        ]);
        setSummary({ total: profit, count: 1 });
      } else if (reportType === 'inventory') {
        let inventoryQuery = supabase.from('inventory').select('quantity, product:products(name, barcode, low_stock_threshold), warehouse:warehouses(name)').order('updated_at', { ascending: false });
        if (effectiveBranchFilter) inventoryQuery = inventoryQuery.eq('branch_id', effectiveBranchFilter);
        inventoryQuery = filterQ(inventoryQuery, filters, applyProductScopedFilters);
        const { data: inv } = await inventoryQuery;
        const rows = (inv || []).map((i: Record<string, unknown>) => {
          const product = i.product as { name: string; barcode: string | null; low_stock_threshold: number };
          const warehouse = i.warehouse as { name: string };
          return { [lang === 'ar' ? 'المنتج' : 'Product']: product?.name || '', [lang === 'ar' ? 'الباركود' : 'Barcode']: product?.barcode || '', [lang === 'ar' ? 'المستودع' : 'Warehouse']: warehouse?.name || '', [lang === 'ar' ? 'الكمية' : 'Quantity']: Number(i.quantity) };
        });
        setData(rows);
        setChartData(rows.slice(0, 10).map((r) => ({ name: String(Object.values(r)[0]), value: Number(Object.values(r)[3]) })));
        setSummary({ total: rows.reduce((s, r) => s + Number(Object.values(r)[3]), 0), count: rows.length });
      } else if (reportType === 'sales_by_payment') {
        let q = supabase.from('sales').select('payment_method, total').gte('created_at', fromTs).lte('created_at', toTs);
        if (effectiveBranchFilter) q = q.eq('branch_id', effectiveBranchFilter);
        q = filterQ(q, filters, applySalesFilters);
        const { data: sales } = await q;
        const methodMap = new Map<string, { total: number; count: number }>();
        (sales || []).forEach((s: Record<string, unknown>) => {
          const method = String(s.payment_method || '');
          const existing = methodMap.get(method) || { total: 0, count: 0 };
          methodMap.set(method, { total: existing.total + Number(s.total), count: existing.count + 1 });
        });
        const METHOD_LABELS: Record<string, string> = { cash: t('cash'), card: t('card'), transfer: t('transfer'), credit: t('credit') };
        const rows = Array.from(methodMap.entries()).map(([method, data]) => ({
          [lang === 'ar' ? 'طريقة الدفع' : 'Payment Method']: METHOD_LABELS[method] || method,
          [lang === 'ar' ? 'الإجمالي' : 'Total']: data.total,
          [lang === 'ar' ? 'العدد' : 'Count']: data.count,
        }));
        setData(rows);
        setChartData(Array.from(methodMap.entries()).map(([method, data]) => ({ name: METHOD_LABELS[method] || method, value: data.total })));
        setSummary({ total: (sales || []).reduce((s: number, r: Record<string, unknown>) => s + Number(r.total), 0), count: (sales || []).length });
      } else if (reportType === 'sales_by_employee') {
        let q = supabase.from('sales').select('cashier_id, total, users:users!fk_sales_cashier(full_name, email)').gte('created_at', fromTs).lte('created_at', toTs);
        if (effectiveBranchFilter) q = q.eq('branch_id', effectiveBranchFilter);
        q = filterQ(q, filters, applySalesFilters);
        const { data: sales } = await q;
        const empMap = new Map<string, { name: string; total: number; count: number }>();
        (sales || []).forEach((s: Record<string, unknown>) => {
          const cashier = s.users as { full_name?: string; email?: string } | null;
          const name = cashier?.full_name || cashier?.email || (lang === 'ar' ? 'غير معروف' : 'Unknown');
          const existing = empMap.get(name) || { name, total: 0, count: 0 };
          empMap.set(name, { name, total: existing.total + Number(s.total), count: existing.count + 1 });
        });
        const rows = Array.from(empMap.values()).sort((a, b) => b.total - a.total).map((e) => ({
          [lang === 'ar' ? 'الموظف' : 'Employee']: e.name,
          [lang === 'ar' ? 'الإجمالي' : 'Total']: e.total,
          [lang === 'ar' ? 'الفواتير' : 'Invoices']: e.count,
          [lang === 'ar' ? 'متوسط الفاتورة' : 'Avg Invoice']: e.count > 0 ? Math.round(e.total / e.count) : 0,
        }));
        setData(rows);
        setChartData(Array.from(empMap.values()).sort((a, b) => b.total - a.total).slice(0, 10).map((e) => ({ name: e.name, value: e.total })));
        setSummary({ total: (sales || []).reduce((s: number, r: Record<string, unknown>) => s + Number(r.total), 0), count: (sales || []).length });
      } else if (reportType === 'sales_by_product') {
        let itemsQuery = supabase.from('sale_items').select('quantity, total, product:products(name), sale:sales(created_at, branch_id)');
        if (effectiveBranchFilter) itemsQuery = itemsQuery.eq('sale.branch_id', effectiveBranchFilter);
        itemsQuery = filterQ(itemsQuery, filters, applySaleItemFilters);
        const { data: items } = await itemsQuery.limit(10000);
        const filtered = (items || []).filter((item: Record<string, unknown>) => {
          const sale = item.sale as { created_at: string } | null;
          if (!sale) return false;
          return sale.created_at >= fromTs && sale.created_at <= toTs;
        });
        const prodMap = new Map<string, { name: string; quantity: number; total: number }>();
        filtered.forEach((item: Record<string, unknown>) => {
          const product = item.product as { name: string } | null;
          const name = product?.name || (lang === 'ar' ? 'غير معروف' : 'Unknown');
          const existing = prodMap.get(name) || { name, quantity: 0, total: 0 };
          prodMap.set(name, { name, quantity: existing.quantity + Number(item.quantity), total: existing.total + Number(item.total) });
        });
        const rows = Array.from(prodMap.values()).sort((a, b) => b.total - a.total).map((p) => ({
          [lang === 'ar' ? 'المنتج' : 'Product']: p.name,
          [lang === 'ar' ? 'الكمية' : 'Quantity']: p.quantity,
          [lang === 'ar' ? 'الإيراد' : 'Revenue']: p.total,
        }));
        setData(rows);
        setChartData(Array.from(prodMap.values()).sort((a, b) => b.total - a.total).slice(0, 10).map((p) => ({ name: p.name, value: p.total })));
        setSummary({ total: rows.reduce((s, r) => s + Number(Object.values(r)[2]), 0), count: rows.length });
      } else if (reportType === 'detailed_invoices') {
        let q = supabase.from('sales').select('id, invoice_number, total, paid_amount, payment_method, status, created_at, customer:customers(name), cashier:users!fk_sales_cashier(full_name)').gte('created_at', fromTs).lte('created_at', toTs).order('created_at', { ascending: false }).limit(5000);
        if (effectiveBranchFilter) q = q.eq('branch_id', effectiveBranchFilter);
        q = filterQ(q, filters, applySalesFilters);
        const { data: sales } = await q;
        const rows = (sales || []).map((s: Record<string, unknown>) => {
          const customer = s.customer as { name?: string } | null;
          const cashier = s.cashier as { full_name?: string } | null;
          return {
            [lang === 'ar' ? 'رقم الفاتورة' : 'Invoice']: s.invoice_number,
            [lang === 'ar' ? 'التاريخ' : 'Date']: formatDate(s.created_at as string, lang),
            [lang === 'ar' ? 'العميل' : 'Customer']: customer?.name || '-',
            [lang === 'ar' ? 'أمين الصندوق' : 'Cashier']: cashier?.full_name || '-',
            [lang === 'ar' ? 'طريقة الدفع' : 'Payment']: s.payment_method,
            [lang === 'ar' ? 'الإجمالي' : 'Total']: Number(s.total),
            [lang === 'ar' ? 'المدفوع' : 'Paid']: Number(s.paid_amount),
            [lang === 'ar' ? 'الحالة' : 'Status']: s.status,
          };
        });
        setData(rows);
        setChartData([]);
        setSummary({ total: rows.reduce((s, r) => s + Number(Object.values(r)[5] || 0), 0), count: rows.length });
      } else if (reportType === 'component_consumption') {
        let q = supabase.from('stock_transactions').select('product_id, quantity, unit_cost, created_at, product:products(name), warehouse:warehouses(name)').eq('component_flow', true).eq('transaction_type', 'sale').gte('created_at', fromTs).lte('created_at', toTs);
        if (effectiveBranchFilter) q = q.eq('branch_id', effectiveBranchFilter);
        q = filterQ(q, filters, applyProductScopedFilters);
        const { data: tx } = await q.limit(5000);
        const map = new Map<string, { name: string; qty: number; cost: number; count: number }>();
        (tx || []).forEach((t: Record<string, unknown>) => {
          const product = t.product as { name?: string } | null;
          const name = product?.name || (lang === 'ar' ? 'غير معروف' : 'Unknown');
          const e = map.get(name) || { name, qty: 0, cost: 0, count: 0 };
          const qty = -Number(t.quantity);
          e.qty += qty;
          e.cost += qty * Number(t.unit_cost || 0);
          e.count += 1;
          map.set(name, e);
        });
        const rows = Array.from(map.values()).sort((a, b) => b.qty - a.qty).map((e) => ({
          [lang === 'ar' ? 'المكوّن' : 'Component']: e.name,
          [lang === 'ar' ? 'الكمية المستهلكة' : 'Consumed Qty']: e.qty,
          [lang === 'ar' ? 'تكلفة الاستهلاك' : 'Consumption Cost']: e.cost,
          [lang === 'ar' ? 'عدد الحركات' : 'Movements']: e.count,
        }));
        setData(rows);
        setChartData(rows.slice(0, 10).map((r) => ({ name: String(Object.values(r)[0]), value: Number(Object.values(r)[1]) })));
        setSummary({ total: rows.reduce((s, r) => s + Number(Object.values(r)[2]), 0), count: rows.length });
      } else if (reportType === 'top_consumed_components') {
        let q = supabase.from('stock_transactions').select('product_id, quantity, product:products(name)').eq('component_flow', true).eq('transaction_type', 'sale').gte('created_at', fromTs).lte('created_at', toTs);
        if (effectiveBranchFilter) q = q.eq('branch_id', effectiveBranchFilter);
        q = filterQ(q, filters, applyProductScopedFilters);
        const { data: tx } = await q.limit(5000);
        const map = new Map<string, { name: string; qty: number }>();
        (tx || []).forEach((t: Record<string, unknown>) => {
          const product = t.product as { name?: string } | null;
          const name = product?.name || (lang === 'ar' ? 'غير معروف' : 'Unknown');
          const e = map.get(name) || { name, qty: 0 };
          e.qty += -Number(t.quantity);
          map.set(name, e);
        });
        const rows = Array.from(map.values()).sort((a, b) => b.qty - a.qty).map((p) => ({
          [lang === 'ar' ? 'المكوّن' : 'Component']: p.name,
          [lang === 'ar' ? 'الكمية المستهلكة' : 'Consumed Qty']: p.qty,
        }));
        setData(rows);
        setChartData(rows.slice(0, 10).map((p) => ({ name: String(p.name), value: Number(p.qty) })));
        setSummary({ total: rows.length, count: rows.length });
      } else if (reportType === 'top_consumed_products') {
        let itemsQuery = supabase.from('sale_items').select('quantity, product:products(name), sale:sales(created_at, branch_id)');
        if (effectiveBranchFilter) itemsQuery = itemsQuery.eq('sale.branch_id', effectiveBranchFilter);
        itemsQuery = filterQ(itemsQuery, filters, applySaleItemFilters);
        const { data: items } = await itemsQuery.limit(10000);
        const filtered = (items || []).filter((item: Record<string, unknown>) => {
          const sale = item.sale as { created_at: string } | null;
          if (!sale) return false;
          return sale.created_at >= fromTs && sale.created_at <= toTs;
        });
        const prodMap = new Map<string, { name: string; quantity: number }>();
        filtered.forEach((item: Record<string, unknown>) => {
          const product = item.product as { name: string } | null;
          const name = product?.name || (lang === 'ar' ? 'غير معروف' : 'Unknown');
          const existing = prodMap.get(name) || { name, quantity: 0 };
          existing.quantity += Number(item.quantity);
          prodMap.set(name, existing);
        });
        const rows = Array.from(prodMap.values()).sort((a, b) => b.quantity - a.quantity).map((p) => ({
          [lang === 'ar' ? 'المنتج' : 'Product']: p.name,
          [lang === 'ar' ? 'الكمية' : 'Quantity']: p.quantity,
        }));
        setData(rows);
        setChartData(rows.slice(0, 10).map((p) => ({ name: String(p.name), value: Number(p.quantity) })));
        setSummary({ total: rows.length, count: rows.length });
      } else if (reportType === 'recipe_costs') {
        // Manufacturing model (recipes -> recipe_items -> raw_materials), via
        // the branch-scoped get_costing_overview RPC (074). Supersedes the
        // legacy product_components BOM report. Actual recipe cost is the
        // branch-scoped recipe cost computed by the RPC.
        const res = await costing.getOverview({ p_branch_id: effectiveBranchFilter });
        if (res.error) { setData([]); setChartData([]); setSummary({ total: 0, count: 0 }); return; }
        const catName = filters.category
          ? options.categories.find((c) => c.id === filters.category)?.name ?? filters.category
          : '';
        const rows = (res.data || [])
          .filter((r) => r.recipe_item_count > 0)
          .filter((r) => !filters.product || r.product_id === filters.product)
          .filter((r) => !catName || r.category_name === catName)
          .map((r) => ({
            [lang === 'ar' ? 'المنتج' : 'Product']: r.product_name,
            [lang === 'ar' ? 'تكلفة الوصفة' : 'Recipe Cost']: Number(r.actual_cost),
            [lang === 'ar' ? 'سعر البيع' : 'Sale Price']: Number(r.sale_price),
            [lang === 'ar' ? 'الهامش' : 'Margin']: Number(r.sale_price) - Number(r.actual_cost),
          }))
          .sort((a, b) => Number(Object.values(b)[3]) - Number(Object.values(a)[3]));
        setData(rows);
        setChartData(rows.slice(0, 10).map((r) => ({ name: String(Object.values(r)[0]), value: Number(Object.values(r)[3]) })));
        setSummary({ total: rows.reduce((s, r) => s + Number(Object.values(r)[1]), 0), count: rows.length });
      } else if (reportType === 'low_stock') {
        let lowStockQuery = supabase.from('inventory').select('quantity, product:products(name, barcode, low_stock_threshold, product_type), warehouse:warehouses(name)');
        if (effectiveBranchFilter) lowStockQuery = lowStockQuery.eq('branch_id', effectiveBranchFilter);
        lowStockQuery = filterQ(lowStockQuery, filters, applyProductScopedFilters);
        const { data: inv } = await lowStockQuery;
        const rows = (inv || [])
          .map((i: Record<string, unknown>) => {
            const product = i.product as { name: string; barcode: string | null; low_stock_threshold: number } | null;
            const warehouse = i.warehouse as { name: string } | null;
            return { product, warehouse: warehouse?.name || '', qty: Number(i.quantity), threshold: product?.low_stock_threshold || 5, barcode: product?.barcode || '' };
          })
          .filter((r) => r.qty <= r.threshold)
          .map((r) => ({
            [lang === 'ar' ? 'المنتج' : 'Product']: r.product?.name || '-',
            [lang === 'ar' ? 'الباركود' : 'Barcode']: r.barcode,
            [lang === 'ar' ? 'المستودع' : 'Warehouse']: r.warehouse,
            [lang === 'ar' ? 'الكمية' : 'Quantity']: r.qty,
            [lang === 'ar' ? 'الحد الأدنى' : 'Low Stock Threshold']: r.threshold,
          }));
        setData(rows);
        setChartData(rows.slice(0, 10).map((r) => ({ name: String(Object.values(r)[0]), value: Number(Object.values(r)[3]) })));
        setSummary({ total: 0, count: rows.length });
      } else if (reportType === 'cashier_performance') {
        let q = supabase.from('sales').select('cashier_id, total, payment_method, status, created_at, users:users!fk_sales_cashier(full_name, email)').gte('created_at', fromTs).lte('created_at', toTs);
        if (effectiveBranchFilter) q = q.eq('branch_id', effectiveBranchFilter);
        const { data: sales } = await q;
        const empMap = new Map<string, { name: string; total: number; count: number; refundCount: number }>();
        (sales || []).forEach((s: Record<string, unknown>) => {
          const cashier = s.users as { full_name?: string; email?: string } | null;
          const name = cashier?.full_name || cashier?.email || (lang === 'ar' ? 'غير معروف' : 'Unknown');
          const existing = empMap.get(name) || { name, total: 0, count: 0, refundCount: 0 };
          existing.total += Number(s.total);
          existing.count += 1;
          if (s.status === 'refunded' || s.status === 'cancelled') existing.refundCount += 1;
          empMap.set(name, existing);
        });
        const rows = Array.from(empMap.values()).sort((a, b) => b.total - a.total).map((e) => ({
          [lang === 'ar' ? 'الموظف' : 'Employee']: e.name,
          [lang === 'ar' ? 'الفواتير' : 'Invoices']: e.count,
          [lang === 'ar' ? 'الإجمالي' : 'Total']: e.total,
          [lang === 'ar' ? 'متوسط الفاتورة' : 'Avg Order']: e.count > 0 ? Math.round(e.total / e.count) : 0,
          [lang === 'ar' ? 'المرتجعات' : 'Refunds']: e.refundCount,
          [lang === 'ar' ? 'نسبة المرتجعات' : 'Refund Rate']: e.count > 0 ? `${Math.round((e.refundCount / e.count) * 100)}%` : '0%',
        }));
        setData(rows);
        setChartData(Array.from(empMap.values()).sort((a, b) => b.total - a.total).slice(0, 10).map((e) => ({ name: e.name, value: e.total })));
        setSummary({ total: (sales || []).reduce((s: number, r: Record<string, unknown>) => s + Number(r.total), 0), count: (sales || []).length });
      } else if (reportType === 'returns') {
        let q = supabase.from('sales').select('id, invoice_number, total, status, created_at, customer:customers(name), cashier:users!fk_sales_cashier(full_name)').in('status', ['refunded', 'cancelled']).gte('created_at', fromTs).lte('created_at', toTs);
        if (effectiveBranchFilter) q = q.eq('branch_id', effectiveBranchFilter);
        const { data: returns } = await q;
        const STATUS_LABELS: Record<string, string> = { refunded: t('refunded'), cancelled: t('statusCancelled') };
        const rows = (returns || []).map((s: Record<string, unknown>) => {
          const customer = s.customer as { name?: string } | null;
          const cashier = s.cashier as { full_name?: string } | null;
          return {
            [lang === 'ar' ? 'رقم الفاتورة' : 'Invoice']: s.invoice_number,
            [lang === 'ar' ? 'التاريخ' : 'Date']: formatDate(s.created_at as string, lang),
            [lang === 'ar' ? 'العميل' : 'Customer']: customer?.name || '-',
            [lang === 'ar' ? 'أمين الصندوق' : 'Cashier']: cashier?.full_name || '-',
            [lang === 'ar' ? 'المبلغ' : 'Amount']: Number(s.total),
            [lang === 'ar' ? 'الحالة' : 'Status']: STATUS_LABELS[String(s.status)] || s.status,
          };
        });
        setData(rows);
        setChartData([]);
        setSummary({ total: rows.reduce((s, r) => s + Number(Object.values(r)[4] || 0), 0), count: rows.length });
      } else if (reportType === 'production_waste') {
        let q = supabase.from('waste_entries').select('id, created_at, quantity, unit_cost, total_cost, reason, product:products(name), branch:warehouses(name)').gte('created_at', fromTs).lte('created_at', toTs);
        if (effectiveBranchFilter) q = q.eq('branch_id', effectiveBranchFilter);
        const { data: waste } = await q;
        const rows = (waste || []).map((w: Record<string, unknown>) => {
          const product = w.product as { name?: string } | null;
          const branch = w.branch as { name?: string } | null;
          return {
            [lang === 'ar' ? 'المنتج' : 'Product']: product?.name || '-',
            [lang === 'ar' ? 'التاريخ' : 'Date']: formatDate(w.created_at as string, lang),
            [lang === 'ar' ? 'الكمية' : 'Quantity']: Number(w.quantity),
            [lang === 'ar' ? 'تكلفة الوحدة' : 'Unit Cost']: Number(w.unit_cost),
            [lang === 'ar' ? 'التكلفة الإجمالية' : 'Total Cost']: Number(w.total_cost),
            [lang === 'ar' ? 'السبب' : 'Reason']: w.reason || '-',
            [lang === 'ar' ? 'المستودع' : 'Warehouse']: branch?.name || '-',
          };
        });
        setData(rows);
        setChartData(rows.slice(0, 10).map((r) => ({ name: String(Object.values(r)[0]), value: Number(Object.values(r)[4]) })));
        setSummary({ total: rows.reduce((s, r) => s + Number(Object.values(r)[4]), 0), count: rows.length });
      }
    } finally { setLoading(false); }
  }

  const handleExportExcel = () => {
    void exportToExcelAdvanced({
      data,
      filename: `report_${reportType}_${from}_${to}`,
      sheetName: reportType,
      title: reportTypes.find(r => r.key === reportType)?.label ?? reportType,
      subtitle: `${from} — ${to}`,
      totalRow: summary.total ? { [lang === 'ar' ? 'الإجمالي' : 'Total']: summary.total, [lang === 'ar' ? 'العدد' : 'Count']: summary.count } : undefined,
      currencyColumns: [lang === 'ar' ? 'الإجمالي' : 'Total', lang === 'ar' ? 'المبلغ' : 'Amount', lang === 'ar' ? 'الربح' : 'Profit', lang === 'ar' ? 'المبيعات' : 'Sales', lang === 'ar' ? 'المشتريات' : 'Purchases', lang === 'ar' ? 'المصروفات' : 'Expenses', lang === 'ar' ? 'الإيراد' : 'Revenue', lang === 'ar' ? 'المدفوع' : 'Paid'],
      lang,
    });
  };
  const handleExportCSV = () => { downloadCSV(data, `report_${reportType}_${from}_${to}`); };

  const reportTypes: { key: ReportType; label: string; icon: React.ReactNode }[] = [
    { key: 'sales', label: t('salesReport'), icon: <TrendingUp className="w-4 h-4" /> },
    { key: 'sales_by_payment', label: t('salesByPayment'), icon: <CreditCard className="w-4 h-4" /> },
    { key: 'sales_by_employee', label: t('salesByEmployee'), icon: <Users className="w-4 h-4" /> },
    { key: 'sales_by_product', label: t('salesByProduct'), icon: <Package className="w-4 h-4" /> },
    { key: 'detailed_invoices', label: t('detailedInvoices'), icon: <List className="w-4 h-4" /> },
    { key: 'purchases', label: t('purchasesReport'), icon: <ShoppingCart className="w-4 h-4" /> },
    { key: 'expenses', label: t('expensesReport'), icon: <Receipt className="w-4 h-4" /> },
    { key: 'profit', label: t('profitReport'), icon: <BarChart3 className="w-4 h-4" /> },
    { key: 'inventory', label: t('inventoryReport'), icon: <Package className="w-4 h-4" /> },
    { key: 'component_consumption', label: t('componentConsumptionReport'), icon: <Layers className="w-4 h-4" /> },
    { key: 'recipe_costs', label: t('recipeCostReport'), icon: <FileText className="w-4 h-4" /> },
    { key: 'top_consumed_components', label: t('topConsumedComponentsReport'), icon: <TrendingDown className="w-4 h-4" /> },
    { key: 'top_consumed_products', label: t('topConsumedProductsReport'), icon: <Package className="w-4 h-4" /> },
    { key: 'low_stock', label: t('lowStockReport'), icon: <AlertTriangle className="w-4 h-4" /> },
    { key: 'cashier_performance', label: t('cashierPerformanceReport'), icon: <UserCheck className="w-4 h-4" /> },
    { key: 'returns', label: t('returnsReport'), icon: <RotateCcw className="w-4 h-4" /> },
    { key: 'production_waste', label: t('productionWasteReport'), icon: <Trash2 className="w-4 h-4" /> },
  ];

  const isPie = reportType === 'expenses' || reportType === 'profit' || reportType === 'sales_by_payment';

  const moneyKeys = [lang === 'ar' ? 'الإجمالي' : 'Total', lang === 'ar' ? 'المبلغ' : 'Amount', lang === 'ar' ? 'الربح' : 'Profit', lang === 'ar' ? 'المبيعات' : 'Sales', lang === 'ar' ? 'المشتريات' : 'Purchases', lang === 'ar' ? 'المصروفات' : 'Expenses', lang === 'ar' ? 'الإيراد' : 'Revenue', lang === 'ar' ? 'المدفوع' : 'Paid', lang === 'ar' ? 'متوسط الفاتورة' : 'Avg Invoice', lang === 'ar' ? 'متوسط الفاتورة' : 'Avg Order', lang === 'ar' ? 'تكلفة الاستهلاك' : 'Consumption Cost', lang === 'ar' ? 'تكلفة الوصفة' : 'Recipe Cost', lang === 'ar' ? 'سعر البيع' : 'Sale Price', lang === 'ar' ? 'الهامش' : 'Margin', lang === 'ar' ? 'تكلفة الوحدة' : 'Unit Cost', lang === 'ar' ? 'التكلفة الإجمالية' : 'Total Cost'];

  const showDate = DATE_DRIVEN_REPORTS.has(reportType);
  const allColumns = data.length > 0 ? Object.keys(data[0]) : [];
  const columns = visibleColumns ? allColumns.filter((c) => visibleColumns.includes(c)) : allColumns;
  const hiddenCount = visibleColumns ? allColumns.length - columns.length : 0;
  const ALL_LABEL = lang === 'ar' ? 'الكل' : 'All';
  const ORDER_TYPE_LABELS: Record<string, string> = { dine_in: t('dineIn'), takeaway: t('takeaway'), delivery: t('delivery'), drive_thru: t('driveThru') };
  const PAYMENT_METHOD_LABELS: Record<string, string> = { cash: t('cash'), card: t('card'), transfer: t('transfer'), credit: t('credit') };
  const STATUS_LABELS: Record<string, string> = { completed: t('statusCompleted'), refunded: t('refunded'), cancelled: t('statusCancelled'), pending: t('statusPending') };

  const filterLabel = (dim: ReportFilterKey): string => {
    const labels: Record<ReportFilterKey, string> = {
      warehouse: t('filterByWarehouse'),
      cashier: t('filterByCashier'),
      customer: t('filterByCustomer'),
      supplier: t('filterBySupplier'),
      buyer: t('filterByBuyer'),
      product: t('filterByProduct'),
      category: t('filterByCategory'),
      order_type: t('filterByOrderType'),
      payment_method: t('filterByPaymentMethod'),
      table: t('filterByTable'),
      status: t('filterByStatus'),
    };
    return labels[dim];
  };

  const allLabel = (dim: ReportFilterKey): string => {
    const labels: Partial<Record<ReportFilterKey, string>> = {
      warehouse: t('allWarehouses'),
      customer: t('allCustomers'),
      supplier: t('allSuppliers'),
      product: t('allProducts'),
      category: t('allCategories'),
      order_type: t('allOrderTypes'),
      payment_method: t('allPaymentMethods'),
      status: t('allStatuses'),
      table: t('allTables'),
    };
    return labels[dim] || ALL_LABEL;
  };

  const filterOptions = (dim: ReportFilterKey): { value: string; label: string }[] => {
    const name = (n: string, en: string | null) => (lang === 'ar' ? n : (en || n));
    switch (dim) {
      case 'order_type': return ORDER_TYPE_OPTIONS.map((v) => ({ value: v, label: ORDER_TYPE_LABELS[v] || v }));
      case 'payment_method': return PAYMENT_METHOD_OPTIONS.map((v) => ({ value: v, label: PAYMENT_METHOD_LABELS[v] || v }));
      case 'status': return SALE_STATUS_OPTIONS.map((v) => ({ value: v, label: STATUS_LABELS[v] || v }));
      case 'warehouse': return options.warehouses.map((w) => ({ value: w.id, label: name(w.name, w.name_en) }));
      case 'cashier':
      case 'buyer': return options.cashiers.map((u) => ({ value: u.id, label: u.full_name || u.email || '' }));
      case 'customer': return options.customers.map((c) => ({ value: c.id, label: name(c.name, c.name_en) }));
      case 'supplier': return options.suppliers.map((s) => ({ value: s.id, label: name(s.name, s.name_en) }));
      case 'product': return options.products.map((p) => ({ value: p.id, label: name(p.name, p.name_en) }));
      case 'category': return reportType === 'expenses'
        ? options.expenseCategories.map((c) => ({ value: c, label: c }))
        : options.categories.map((c) => ({ value: c.id, label: name(c.name, c.name_en) }));
      case 'table': return options.tables.map((tb) => ({ value: tb.id, label: tb.name }));
    }
  };

  const handlePrint = () => {
    const reportLabel = reportTypes.find((r) => r.key === reportType)?.label ?? reportType;
    const headers = data.length > 0 ? Object.keys(data[0]) : [];
    const rows = data.map((r) => headers.map((h) => {
      const value = r[h];
      if (typeof value === 'number' && moneyKeys.includes(h)) return formatCurrency(value, currency, lang);
      return String(value ?? '');
    }));
    openPrintWindow({ title: reportLabel, subtitle: `${from} - ${to}`, headers, rows, lang: lang as 'ar' | 'en' });
  };

  return (
    <div>
      <PageHeader title={t('reports')} actions={
        <div className="flex flex-wrap gap-2">
          <ColumnPicker
            columns={data.length > 0 ? Object.keys(data[0]) : []}
            visibleColumns={visibleColumns}
            onToggle={toggleColumn}
            onShowAll={showAllColumns}
            lang={lang}
            hiddenCount={hiddenCount}
          />
          {can('reports.export') && (
            <Button variant="outline" size="sm" onClick={handleExportExcel}><Download className="w-4 h-4" /> {t('exportExcel')}</Button>
          )}
          {can('reports.export') && (
            <Button variant="outline" size="sm" onClick={handleExportCSV}><FileDown className="w-4 h-4" /> {t('exportCsv')}</Button>
          )}
          {can('reports.print') && (
            <Button variant="outline" size="sm" onClick={handlePrint}><Printer className="w-4 h-4" /> {t('print')}</Button>
          )}
        </div>
      } />

      <CustomReportBar
        savedReports={savedReports}
        currentReportType={reportType}
        currentVisibleColumns={visibleColumns}
        currentFilters={filters}
        onSelect={handleRestoreCustomReport}
        onSave={handleSaveCustomReport}
        onDelete={deleteReport}
        lang={lang}
      />

      <ReportFilterBar
        reportType={reportType}
        filters={filters}
        onFilterChange={(dim, value) => setFilters(prev => ({ ...prev, [dim]: value }))}
        showDate={showDate}
        period={period}
        onPeriodChange={(key) => applyPeriod(key as PeriodKey)}
        from={from}
        to={to}
        onFromChange={(v) => { setFrom(v); setPeriod('custom'); }}
        onToChange={(v) => { setTo(v); setPeriod('custom'); }}
        showBranchFilter={isAdminRole(user?.role) && branches.length > 0}
        branches={branches}
        branchFilterValue={adminBranchFilter}
        onBranchFilterChange={setAdminBranchFilter}
        filterOptions={filterOptions}
        filterLabel={filterLabel}
        allLabel={allLabel}
        filterDimensions={REPORT_FILTER_DIMS[reportType]}
        total={summary.total}
        count={summary.count}
        currency={currency}
        lang={lang}
        financialTypes={canFinancial ? financialTypes : []}
        canFinancial={canFinancial}
        onFinancialSelect={(key) => navigate(`/financial-reports?view=${key}&from=${from}&to=${to}`)}
        reportTypes={reportTypes}
        onReportTypeChange={handleReportTypeSelect}
      />

      {chartData.length > 0 && (
        <Card className="mb-4 p-5 border-ui-border bg-ui-surface shadow-ui">
          <ResponsiveContainer width="100%" height={300}>
            {isPie ? (
              <PieChart>
                <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={(e: { name?: string }) => e.name || ''}>
                  {chartData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} formatter={(value) => formatCurrency(Number(value ?? 0), currency, lang)} />
                <Legend />
              </PieChart>
            ) : (
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} formatter={(value) => formatCurrency(Number(value ?? 0), currency, lang)} />
                <Bar dataKey="value" fill={getBrandColor(600)} radius={[4, 4, 0, 0]} />
              </BarChart>
            )}
          </ResponsiveContainer>
        </Card>
      )}

      <Card className="p-4 border-ui-border bg-ui-surface shadow-ui">
        {loading ? (
          <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" /></div>
        ) : data.length === 0 ? (
          <div className="text-center py-12 text-ui-subtle text-sm">{t('noData')}</div>
        ) : (
          <div className="overflow-x-auto">
            {data.length >= 5000 && (
              <div className="text-xs text-ui-warning bg-ui-warning-soft border border-ui-warning/20 rounded-lg px-3 py-2 mb-3">
                {lang === 'ar' ? 'تم عرض أول 5,000 سجل. استخدم الفلاتر لتضييق النتائج.' : 'Showing first 5,000 records. Use filters to narrow results.'}
              </div>
            )}
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ui-border">
                  {columns.map((key) => (
                    <th key={key} className="px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider">{key}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => (
                  <tr key={i} className="border-b border-ui-border/60 hover:bg-ui-page-alt">
                    {columns.map((key, j) => {
                      const val = row[key];
                      return (
                        <td key={j} className="px-4 py-3 text-ui-text">
                          {typeof val === 'number' && moneyKeys.includes(key)
                            ? formatCurrency(val, currency, lang)
                            : String(val)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
