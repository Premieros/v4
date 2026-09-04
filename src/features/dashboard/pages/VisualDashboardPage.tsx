import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowDown, ArrowUp, ArrowUpRight, BarChart3, ChevronDown, Clock3,
  CreditCard, Download, Filter, RefreshCw, RotateCcw, ShoppingBag, Tag, Trash2, Wallet,
} from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useActiveBranchId } from '@/lib/activeBranch';
import { isAdminRole } from '@/lib/permissions';
import { useBranches } from '@/hooks/useBranches';
import { useSettings } from '@/context/SettingsContext';
import { formatCurrency, formatNumber } from '@/lib/format';

type Range = 'today' | 'week' | 'month' | 'year';
type Sale = {
  id: string;
  invoice_number: string | null;
  total: number | null;
  paid_amount: number | null;
  payment_method: string | null;
  status: string | null;
  branch_id: string | null;
  created_at: string;
  order_type: string | null;
  refunded_amount?: number | null;
  discount_amount?: number | null;
  branch?: { name: string | null; name_en: string | null }[] | null;
};
type Inventory = { quantity: number | null; product: { name: string | null; low_stock_threshold: number | null }[] | null };
type SaleItem = { quantity: number | null; product: { name: string | null }[] | null };
type Point = { label: string; sales: number; previous: number };

const ranges: Record<Range, [string, string]> = {
  today: ['اليوم', 'Day'],
  week: ['7 أيام', 'Week'],
  month: ['30 يوم', 'Month'],
  year: ['السنة', 'Year'],
};
const orderLabels: Record<string, [string, string]> = {
  dine_in: ['الصالة', 'Dine-in'],
  takeaway: ['تيك أواي', 'Takeaway'],
  delivery: ['دليفري', 'Delivery'],
  car: ['سيارة', 'Car'],
  quick: ['سريع', 'Quick'],
};
const paymentLabels: Record<string, [string, string]> = {
  cash: ['نقدي', 'Cash'],
  card: ['بطاقة مدى', 'Mada'],
  visa: ['فيزا / ماستركارد', 'Visa / Mastercard'],
  bank: ['تحويل بنكي', 'Bank transfer'],
  instapay: ['InstaPay', 'InstaPay'],
  wallet: ['محفظة إلكترونية', 'Wallet'],
  other: ['أخرى', 'Other'],
};
const colors = ['#5b2bd8', '#2188e8', '#17b26a', '#f59e0b', '#ec4899'];

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-3xl border border-ui-border bg-ui-surface p-5 shadow-ui ${className}`}>{children}</section>;
}

function Empty({ ar }: { ar: boolean }) {
  return <div className="flex min-h-[150px] items-center justify-center text-sm text-ui-subtle">{ar ? 'لا توجد بيانات فعلية للفترة المحددة' : 'No actual data for the selected period'}</div>;
}

function windowFor(range: Range) {
  const end = new Date();
  const start = new Date(end);
  if (range === 'today') start.setHours(0, 0, 0, 0);
  if (range === 'week') start.setDate(start.getDate() - 6);
  if (range === 'month') start.setDate(start.getDate() - 29);
  if (range === 'year') start.setFullYear(start.getFullYear() - 1);
  const span = end.getTime() - start.getTime();
  return { start, end, previousStart: new Date(start.getTime() - span - (range === 'today' ? 86400000 : 0)), previousEnd: new Date(start) };
}

function summarize(rows: Sale[]) {
  return {
    sales: rows.reduce((s, r) => s + Number(r.total || 0), 0),
    payments: rows.reduce((s, r) => s + Number(r.paid_amount ?? r.total ?? 0), 0),
    returns: rows.reduce((s, r) => s + Number(r.refunded_amount || 0), 0),
    discounts: rows.reduce((s, r) => s + Number(r.discount_amount || 0), 0),
    orders: rows.length,
  };
}

function Metric({ testId, icon: Icon, title, value, previous, href, ar }: {
  testId: string;
  icon: typeof Wallet;
  title: string;
  value: string;
  previous: number;
  href: string;
  ar: boolean;
}) {
  const n = Number(value.replace(/[^0-9.-]+/g, '').replace(/,/g, '')) || 0;
  const change = previous > 0 ? ((n - previous) / previous) * 100 : null;
  const positive = (change ?? 0) >= 0;
  return (
    <Link data-testid={testId} to={href} className="group rounded-3xl border border-ui-border bg-ui-surface p-5 shadow-ui transition hover:-translate-y-0.5 hover:shadow-ui-lg">
      <div className="flex items-start justify-between">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-ui-primary-soft text-ui-primary"><Icon className="h-5 w-5" /></div>
        <ArrowUpRight className="h-4 w-4 text-ui-subtle transition group-hover:text-ui-primary" />
      </div>
      <p className="mt-5 text-sm font-semibold text-ui-muted">{title}</p>
      <p className="mt-1 text-3xl font-black tracking-tight text-ui-text">{value}</p>
      <div className="mt-2 flex items-center gap-2 text-xs">
        {change === null ? (
          <span className="text-ui-subtle">—</span>
        ) : (
          <span className={`inline-flex items-center gap-0.5 font-bold ${positive ? 'text-ui-success' : 'text-ui-danger'}`}>{positive ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}{Math.abs(change).toFixed(0)}%</span>
        )}
        <span className="text-ui-subtle">{ar ? 'مقارنة بالفترة السابقة' : 'vs previous period'}</span>
      </div>
    </Link>
  );
}

export function VisualDashboardPage() {
  const { lang } = useLanguage();
  const { user } = useAuth();
  const branchFilter = useBranchFilter();
  const { branches } = useBranches();
  const { effectiveSettings } = useSettings();
  const ar = lang === 'ar';
  const isAdmin = isAdminRole(user?.role);
  const [activeBranchId, setActiveBranchId] = useActiveBranchId();
  const [range, setRange] = useState<Range>('today');
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [orderTypeFilter, setOrderTypeFilter] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sales, setSales] = useState<Sale[]>([]);
  const [previousSales, setPreviousSales] = useState<Sale[]>([]);
  const [inventory, setInventory] = useState<Inventory[]>([]);
  const [items, setItems] = useState<SaleItem[]>([]);
  const [wasteRows, setWasteRows] = useState<{ waste_category: string; waste_type: string; total_quantity: number; total_cost: number; entry_count: number }[]>([]);
  const [quickStats, setQuickStats] = useState({ sales: 0, expenses: 0, profit: 0, lowStockCount: 0 });

  const effectiveBranch = isAdmin ? activeBranchId : branchFilter;
  const settings = effectiveSettings(effectiveBranch);
  const money = useCallback((n: number) => formatCurrency(n, settings?.currency || 'EGP', lang), [settings?.currency, lang]);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const w = windowFor(range);
      const saleFields = 'id,invoice_number,total,paid_amount,payment_method,status,branch_id,created_at,order_type,refunded_amount,discount_amount,branch:branches(name,name_en)';
      let q = supabase.from('sales').select(saleFields).gte('created_at', w.start.toISOString()).lte('created_at', w.end.toISOString()).order('created_at', { ascending: false }).limit(5000);
      let pq = supabase.from('sales').select(saleFields).gte('created_at', w.previousStart.toISOString()).lt('created_at', w.previousEnd.toISOString()).limit(5000);
      let iq = supabase.from('inventory').select('quantity,product:products(name,low_stock_threshold)').limit(5000);
      if (effectiveBranch) {
        q = q.eq('branch_id', effectiveBranch);
        pq = pq.eq('branch_id', effectiveBranch);
        iq = iq.eq('branch_id', effectiveBranch);
      }
      const [a, b, c] = await Promise.all([q, pq, iq]);
      if (a.error) throw a.error;
      if (b.error) throw b.error;
      if (c.error) throw c.error;
      const rows = (a.data || []) as unknown as Sale[];
      setSales(rows);
      setPreviousSales((b.data || []) as unknown as Sale[]);
      setInventory((c.data || []) as unknown as Inventory[]);
      if (rows.length) {
        const si = await supabase.from('sale_items').select('quantity,product:products(name)').in('sale_id', rows.map((r) => r.id)).limit(10000);
        setItems(si.error ? [] : ((si.data || []) as unknown as SaleItem[]));
      } else {
        setItems([]);
      }
      const wFrom = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const wTo = new Date().toISOString().slice(0, 10);
      const wr = await supabase.rpc('get_waste_report', { p_branch_id: effectiveBranch, p_from_date: wFrom, p_to_date: wTo });
      setWasteRows(wr.error ? [] : ((wr.data || []) as typeof wasteRows));
    } catch (e) {
      console.error('Dashboard load failed', e);
      setSales([]);
      setPreviousSales([]);
      setInventory([]);
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [range, effectiveBranch]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    (async () => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();
      const monthDateStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const monthDateEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;
      const [salesRes, expensesRes, inventoryRes] = await Promise.all([
        supabase.from('sales').select('total').gte('created_at', monthStart).lte('created_at', monthEnd),
        supabase.from('expenses').select('amount').gte('expense_date', monthDateStart).lte('expense_date', monthDateEnd),
        supabase.from('inventory').select('quantity, product:products(low_stock_threshold)'),
      ]);
      const totalSales = (salesRes.data || []).reduce((s: number, r: Record<string, unknown>) => s + Number(r.total || 0), 0);
      const totalExpenses = (expensesRes.data || []).reduce((s: number, r: Record<string, unknown>) => s + Number(r.amount || 0), 0);
      const lowStockCount = (inventoryRes.data || []).filter((r: Record<string, unknown>) => {
        const qty = Number(r.quantity || 0);
        const product = r.product as { low_stock_threshold?: number }[] | null;
        const threshold = Number(product?.[0]?.low_stock_threshold ?? 5);
        return qty <= threshold;
      }).length;
      setQuickStats({ sales: totalSales, expenses: totalExpenses, profit: totalSales - totalExpenses, lowStockCount });
    })();
  }, []);

  const filteredSales = useMemo(
    () => (orderTypeFilter ? sales.filter((r) => String(r.order_type || '').toLowerCase() === orderTypeFilter) : sales),
    [sales, orderTypeFilter],
  );
  const current = useMemo(() => summarize(filteredSales), [filteredSales]);
  const previous = useMemo(() => summarize(previousSales), [previousSales]);

  const chart = useMemo<Point[]>(() => {
    const w = windowFor(range);
    const cm = new Map<number, number>();
    const pm = new Map<number, number>();
    const key = (d: Date, base: Date) => range === 'today' ? d.getHours() : range === 'year' ? d.getFullYear() * 12 + d.getMonth() : Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(base.getFullYear(), base.getMonth(), base.getDate()).getTime()) / 86400000);
    filteredSales.forEach((r) => { const k = key(new Date(r.created_at), w.start); cm.set(k, (cm.get(k) || 0) + Number(r.total || 0)); });
    previousSales.forEach((r) => { const k = key(new Date(r.created_at), w.previousStart); pm.set(k, (pm.get(k) || 0) + Number(r.total || 0)); });
    const count = range === 'today' ? 24 : range === 'year' ? 12 : range === 'week' ? 7 : 30;
    return Array.from({ length: count }, (_, i) => {
      let label = String(i);
      if (range === 'today') label = `${String(i).padStart(2, '0')}:00`;
      else if (range === 'year') label = new Date(w.start.getFullYear(), w.start.getMonth() + i, 1).toLocaleDateString(ar ? 'ar-EG' : 'en-US', { month: 'short' });
      else { const d = new Date(w.start); d.setDate(w.start.getDate() + i); label = d.toLocaleDateString(ar ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'short' }); }
      const ck = range === 'year' ? w.start.getFullYear() * 12 + w.start.getMonth() + i : i;
      const pk = range === 'year' ? w.previousStart.getFullYear() * 12 + w.previousStart.getMonth() + i : i;
      return { label, sales: cm.get(ck) || 0, previous: pm.get(pk) || 0 };
    });
  }, [filteredSales, previousSales, range, ar]);

  const ordersByType = useMemo(() => Object.entries(filteredSales.reduce<Record<string, number>>((acc, r) => {
    const k = r.order_type || 'other';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 5), [filteredSales]);

  const payments = useMemo(() => {
    const m = new Map<string, number>();
    filteredSales.forEach((r) => { const k = (r.payment_method || 'other').toLowerCase(); m.set(k, (m.get(k) || 0) + Number(r.paid_amount ?? r.total ?? 0)); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [filteredSales]);

  const branchesTop = useMemo(() => {
    const m = new Map<string, { name: string; orders: number; sales: number }>();
    filteredSales.forEach((r) => {
      const b = r.branch?.[0];
      const name = ar ? b?.name || 'غير محدد' : b?.name_en || b?.name || 'Unknown';
      const x = m.get(name) || { name, orders: 0, sales: 0 };
      x.orders++;
      x.sales += Number(r.total || 0);
      m.set(name, x);
    });
    return [...m.values()].sort((a, b) => b.sales - a.sales).slice(0, 4);
  }, [filteredSales, ar]);

  const productsTop = useMemo(() => {
    const m = new Map<string, { name: string; quantity: number }>();
    items.forEach((r) => {
      const name = r.product?.[0]?.name || 'غير محدد';
      const x = m.get(name) || { name, quantity: 0 };
      x.quantity += Number(r.quantity || 0);
      m.set(name, x);
    });
    return [...m.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 4);
  }, [items]);

  const recent = filteredSales.slice(0, 4);
  const lowStock = useMemo(() => inventory.filter((r) => Number(r.quantity || 0) < Number(r.product?.[0]?.low_stock_threshold ?? settings?.low_stock_threshold ?? 5)).slice(0, 5), [inventory, settings?.low_stock_threshold]);

  return <div dir={ar ? 'rtl' : 'ltr'} className="min-h-[calc(100vh-64px)] bg-ui-page px-4 py-5 sm:px-7 sm:py-7" data-testid="dashboard-surface">
    <div className="mx-auto max-w-[1560px] space-y-6">

      {/* Greeting + Quick Actions */}
      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-black text-ui-text">{ar ? `مرحباً، ${user?.full_name || 'مدير النظام'}` : `Welcome back, ${user?.full_name || 'Admin'}`}</h1>
          <p className="mt-1 text-sm text-ui-muted">{ar ? 'نظرة سريعة على أداء عملك' : 'Quick overview of your business performance'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/pos" className="inline-flex items-center gap-2 rounded-xl bg-ui-primary px-4 py-2 text-sm font-bold text-ui-primary-fg shadow-ui-sm transition hover:bg-ui-primary-hover hover:shadow-ui-md">
            <ShoppingBag className="h-4 w-4" />{ar ? 'إنشاء بيع' : 'New Sale'}
          </Link>
          <Link to="/purchases" className="inline-flex items-center gap-2 rounded-xl border border-ui-border bg-ui-surface px-4 py-2 text-sm font-bold text-ui-text shadow-ui-sm transition hover:bg-ui-page-alt">
            {ar ? 'شراء' : 'Purchase'}
          </Link>
          <Link to="/production" className="inline-flex items-center gap-2 rounded-xl border border-ui-border bg-ui-surface px-4 py-2 text-sm font-bold text-ui-text shadow-ui-sm transition hover:bg-ui-page-alt">
            {ar ? 'إنتاج' : 'Production'}
          </Link>
        </div>
      </section>

      {/* Hero header with controls */}
      <section className="rounded-[32px] bg-gradient-to-br from-[#24114f] via-[#4b20a9] to-[#6d35df] p-6 text-white shadow-[0_20px_55px_rgba(75,32,169,0.25)] sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2 text-ui-primary"><BarChart3 className="h-4 w-4" /><span className="text-xs font-bold uppercase tracking-[0.18em]">Premier Control</span></div>
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl">{ar ? 'نظرة عامة على أعمالك' : 'Your business at a glance'}</h1>
            <p className="mt-2 max-w-2xl text-sm text-ui-primary/80">{ar ? 'مؤشرات واضحة وسريعة تساعدك على معرفة ما يحدث الآن.' : 'A focused command view for the numbers that matter now.'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white/10 p-1 backdrop-blur">
            {(Object.keys(ranges) as Range[]).map((r) => (
              <button key={r} onClick={() => setRange(r)} className={`rounded-xl px-4 py-2 text-sm font-bold ${range === r ? 'bg-ui-surface text-ui-primary' : 'text-white/80 hover:bg-white/10'}`}>{ranges[r][ar ? 0 : 1]}</button>
            ))}
            <button onClick={() => void load()} className="rounded-xl p-2 text-white/80 hover:bg-white/10" aria-label={ar ? 'تحديث' : 'Refresh'}><RefreshCw className={refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /></button>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {isAdmin && branches.length > 0 && (
            <select data-testid="dashboard-branch-filter" value={activeBranchId || ''} onChange={(e) => setActiveBranchId(e.target.value || null)} className="h-10 rounded-xl border border-white/25 bg-white/10 px-3 text-sm font-semibold text-white [&>option]:text-ui-text">
              <option value="">{ar ? 'كل الفروع' : 'All branches'}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{ar ? b.name : b.name_en || b.name}</option>)}
            </select>
          )}
          <button data-testid="dashboard-compare-toggle" onClick={() => setCompareEnabled((v) => !v)} aria-pressed={compareEnabled} className={`inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-bold ${compareEnabled ? 'border-white bg-ui-surface text-ui-primary' : 'border-white/25 text-white/85 hover:bg-white/10'}`}>
            <span className={`h-5 w-9 rounded-full p-0.5 ${compareEnabled ? 'bg-ui-primary' : 'bg-white/30'}`}><span className={`block h-4 w-4 rounded-full bg-ui-surface shadow transition ${compareEnabled ? 'translate-x-4' : ''}`} /></span>
            {ar ? 'مقارنة' : 'Compare'}
          </button>
          <div className="relative">
            <button data-testid="dashboard-filter-button" onClick={() => setFilterOpen((v) => !v)} aria-expanded={filterOpen} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/25 px-4 text-sm font-bold text-white/85 hover:bg-white/10"><Filter className="h-4 w-4" />{ar ? 'تصفية' : 'Filter'}</button>
            {filterOpen && (
              <div data-testid="dashboard-filter-menu" className="absolute end-0 top-12 z-30 w-64 rounded-2xl border border-ui-border bg-ui-surface p-2 shadow-ui-lg">
                <p className="mb-1 px-3 py-1 text-xs font-bold text-ui-subtle">{ar ? 'نوع الطلب' : 'Order type'}</p>
                {[['', ar ? 'الكل' : 'All'], ['dine_in', ar ? 'الصالة' : 'Dine-in'], ['takeaway', ar ? 'تيك أواي' : 'Takeaway'], ['delivery', ar ? 'دليفري' : 'Delivery'], ['car', ar ? 'سيارة' : 'Car'], ['quick', ar ? 'سريع' : 'Quick']].map(([value, label]) => (
                  <button key={value} onClick={() => { setOrderTypeFilter(value); setFilterOpen(false); }} className={`block w-full rounded-lg px-3 py-2 text-start text-sm ${orderTypeFilter === value ? 'bg-ui-primary-soft font-bold text-ui-primary' : 'text-ui-muted hover:bg-ui-page-alt'}`}>{label}</button>
                ))}
              </div>
            )}
          </div>
          <div className="relative">
            <button data-testid="dashboard-export-button" onClick={() => setExportOpen((v) => !v)} aria-expanded={exportOpen} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/25 px-4 text-sm font-bold text-white/85 hover:bg-white/10"><Download className="h-4 w-4" />{ar ? 'تصدير التقرير' : 'Export report'}<ChevronDown className="h-4 w-4" /></button>
            {exportOpen && (
              <div data-testid="dashboard-export-menu" className="absolute end-0 top-12 z-30 w-56 rounded-2xl border border-ui-border bg-ui-surface p-2 shadow-ui-lg">
                <Link to="/reports?reportType=sales" onClick={() => setExportOpen(false)} className="block rounded-lg px-3 py-2 text-sm text-ui-muted hover:bg-ui-page-alt">{ar ? 'تقرير المبيعات' : 'Sales report'}</Link>
                <Link to="/reports?reportType=sales_by_payment" onClick={() => setExportOpen(false)} className="block rounded-lg px-3 py-2 text-sm text-ui-muted hover:bg-ui-page-alt">{ar ? 'طرق الدفع' : 'Payment methods'}</Link>
                <Link to="/branches" onClick={() => setExportOpen(false)} className="block rounded-lg px-3 py-2 text-sm text-ui-muted hover:bg-ui-page-alt">{ar ? 'حسب الفرع' : 'By branch'}</Link>
              </div>
            )}
          </div>
        </div>
      </section>

      <Card>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-black text-ui-text">{ar ? 'ملخص سريع' : 'Quick Stats'}</h2>
                  <p className="mt-1 text-xs text-ui-subtle">{ar ? 'مؤشرات الشهر الحالي' : 'Current month highlights'}</p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-ui-border bg-ui-page-alt p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="h-3 w-3 rounded-full bg-ui-success" />
                    <span className="text-xs font-semibold text-ui-subtle">{ar ? 'مبيعات الشهر' : 'Sales this month'}</span>
                  </div>
                  <p className="text-xl font-black text-ui-text">{money(quickStats.sales)}</p>
                </div>
                <div className="rounded-2xl border border-ui-border bg-ui-page-alt p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="h-3 w-3 rounded-full bg-ui-danger" />
                    <span className="text-xs font-semibold text-ui-subtle">{ar ? 'مصروفات الشهر' : 'Expenses this month'}</span>
                  </div>
                  <p className="text-xl font-black text-ui-text">{money(quickStats.expenses)}</p>
                </div>
                <div className="rounded-2xl border border-ui-border bg-ui-page-alt p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="h-3 w-3 rounded-full bg-ui-primary" />
                    <span className="text-xs font-semibold text-ui-subtle">{ar ? 'هامش الربح' : 'Profit margin'}</span>
                  </div>
                  <p className="text-xl font-black text-ui-text">{money(quickStats.profit)}</p>
                </div>
                <div className="rounded-2xl border border-ui-border bg-ui-page-alt p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="h-3 w-3 rounded-full bg-ui-warning" />
                    <span className="text-xs font-semibold text-ui-subtle">{ar ? 'تنبيهات المخزون' : 'Low stock alerts'}</span>
                  </div>
                  <p className="text-xl font-black text-ui-text">{formatNumber(quickStats.lowStockCount, 0)}</p>
                </div>
              </div>
            </Card>

      {loading ? (
        <div className="flex h-72 items-center justify-center rounded-3xl border border-ui-border bg-ui-surface"><RefreshCw className="h-7 w-7 animate-spin text-ui-primary" /></div>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Metric testId="kpi-orders" icon={ShoppingBag} title={ar ? 'الطلبات' : 'Orders'} value={formatNumber(current.orders, 0)} previous={previous.orders} href="/reports?reportType=detailed_invoices" ar={ar} />
            <Metric testId="kpi-net-sales" icon={Wallet} title={ar ? 'إجمالي المبيعات' : 'Net sales'} value={money(current.sales)} previous={previous.sales} href="/reports?reportType=sales" ar={ar} />
            <Metric testId="kpi-net-payments" icon={CreditCard} title={ar ? 'إجمالي المدفوعات' : 'Net payments'} value={money(current.payments)} previous={previous.payments} href="/reports?reportType=sales_by_payment" ar={ar} />
            <Metric testId="kpi-returns" icon={RotateCcw} title={ar ? 'المبالغ المرتجعة' : 'Return amount'} value={money(current.returns)} previous={previous.returns} href="/reports?reportType=sales" ar={ar} />
            <Metric testId="kpi-discounts" icon={Tag} title={ar ? 'إجمالي الخصومات' : 'Discount amount'} value={money(current.discounts)} previous={previous.discounts} href="/reports?reportType=sales" ar={ar} />
          </section>

          <section className="grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.8fr)]">
            <Card>
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-black text-ui-text">{ar ? 'حركة المبيعات' : 'Sales performance'}</h2>
                  <p className="mt-1 text-xs text-ui-subtle">{ar ? 'توزيع المبيعات خلال الفترة' : 'Sales movement across the selected period'}</p>
                </div>
                <div className="flex items-center gap-3">
                  {compareEnabled && (
                    <span className="hidden items-center gap-2 text-xs text-ui-subtle sm:flex"><i className="h-0 w-7 border-t-2 border-dashed border-[#a98df0]" />{ar ? 'مبيعات سابقة' : 'Previous period'}</span>
                  )}
                  <span className="rounded-xl bg-ui-primary-soft px-3 py-2 text-xs font-bold text-ui-primary">{money(current.sales)}</span>
                </div>
              </div>
              <div className="h-[310px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chart}>
                    <defs>
                      <linearGradient id="premierArea" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6d35df" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="#6d35df" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} interval={range === 'today' ? 3 : 'preserveStartEnd'} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                    <Tooltip formatter={(v) => money(Number(v))} contentStyle={{ borderRadius: 16, border: '1px solid #e2e8f0', boxShadow: '0 12px 30px rgba(15,23,42,.1)' }} />
                    {compareEnabled && <Area type="monotone" dataKey="previous" stroke="#b7a5eb" strokeWidth={2} strokeDasharray="6 5" fill="none" />}
                    <Area type="monotone" dataKey="sales" stroke="#6d35df" strokeWidth={3} fill="url(#premierArea)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <div className="space-y-5">
              <Card>
                <div className="mb-4 flex items-center justify-between">
                  <div><h2 className="text-lg font-black text-ui-text">{ar ? 'أنواع الطلبات' : 'Order mix'}</h2><p className="mt-1 text-xs text-ui-subtle">{ar ? 'حسب الطلبات المسجلة' : 'By recorded orders'}</p></div>
                  <Clock3 className="h-5 w-5 text-ui-subtle" />
                </div>
                <div className="space-y-4">
                  {ordersByType.length ? ordersByType.map(([key, count]) => {
                    const label = orderLabels[key] || [key, key];
                    const pct = Math.round(count / Math.max(filteredSales.length, 1) * 100);
                    return <div key={key}>
                      <div className="mb-1 flex justify-between text-sm"><span className="font-bold text-ui-text">{ar ? label[0] : label[1]}</span><span className="font-bold text-ui-subtle">{count} · {pct}%</span></div>
                      <div className="h-2 overflow-hidden rounded-full bg-ui-page-alt"><div className="h-full rounded-full bg-gradient-to-r from-ui-primary to-ui-primary-active" style={{ width: `${pct}%` }} /></div>
                    </div>;
                  }) : <p className="py-8 text-center text-sm text-ui-subtle">{ar ? 'لا توجد بيانات' : 'No data yet'}</p>}
                </div>
              </Card>
              <Card>
                <div className="mb-4 flex items-center justify-between"><div><h2 className="text-lg font-black text-ui-text">{ar ? 'طرق الدفع' : 'Payment methods'}</h2><p className="mt-1 text-xs text-ui-subtle">{ar ? 'حسب الفترة المحددة' : 'For the selected period'}</p></div><CreditCard className="h-5 w-5 text-ui-subtle" /></div>
                <div className="space-y-4">
                  {payments.length ? payments.map(([key, amount], i) => {
                    const label = paymentLabels[key] || [key, key];
                    const pct = Math.round(amount / Math.max(current.payments, 1) * 100);
                    return <div key={key}>
                      <div className="mb-1 flex justify-between text-sm"><span className="font-bold text-ui-text">{ar ? label[0] : label[1]}</span><span className="font-bold text-ui-subtle">{money(amount)} · {pct}%</span></div>
                      <div className="h-2 overflow-hidden rounded-full bg-ui-page-alt"><div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: colors[i % colors.length] }} /></div>
                    </div>;
                  }) : <p className="py-8 text-center text-sm text-ui-subtle">{ar ? 'لا توجد بيانات' : 'No data yet'}</p>}
                </div>
              </Card>
            </div>
          </section>

          <section className="grid gap-5 xl:grid-cols-3">
            <Card className="overflow-hidden p-0">
              <div className="flex items-center justify-between border-b border-ui-border px-5 py-4"><h2 className="font-bold text-ui-text">{ar ? 'الفروع الأعلى مبيعًا' : 'Top selling branches'}</h2><Link to="/branches" className="text-xs font-bold text-ui-primary">{ar ? 'عرض جميع الفروع' : 'View all'}</Link></div>
              {branchesTop.length ? <table className="w-full text-sm">
                <thead className="bg-ui-page-alt text-xs text-ui-subtle"><tr><th className="px-5 py-3 text-start">#</th><th className="px-5 py-3 text-start">{ar ? 'الطلبات' : 'Orders'}</th><th className="px-5 py-3 text-start">{ar ? 'المبيعات' : 'Sales'}</th></tr></thead>
                <tbody>{branchesTop.map((r, i) => <tr key={r.name} className="border-t border-ui-border"><td className="px-5 py-3 font-bold">{i + 1}</td><td className="px-5 py-3">{r.orders}</td><td className="px-5 py-3 font-semibold">{money(r.sales)}</td></tr>)}</tbody>
              </table> : <Empty ar={ar} />}
            </Card>
            <Card className="overflow-hidden p-0">
              <div className="flex items-center justify-between border-b border-ui-border px-5 py-4"><h2 className="font-bold text-ui-text">{ar ? 'أكثر الأصناف مبيعًا' : 'Top selling items'}</h2><Link to="/reports?reportType=sales_by_product" className="text-xs font-bold text-ui-primary">{ar ? 'عرض جميع الأصناف' : 'View all'}</Link></div>
              {productsTop.length ? <table className="w-full text-sm">
                <thead className="bg-ui-page-alt text-xs text-ui-subtle"><tr><th className="px-5 py-3 text-start">#</th><th className="px-5 py-3 text-start">{ar ? 'الصنف' : 'Item'}</th><th className="px-5 py-3 text-start">{ar ? 'الكمية' : 'Qty'}</th></tr></thead>
                <tbody>{productsTop.map((r, i) => <tr key={r.name} className="border-t border-ui-border"><td className="px-5 py-3 font-bold">{i + 1}</td><td className="px-5 py-3 font-semibold">{r.name}</td><td className="px-5 py-3">{formatNumber(r.quantity, 0)}</td></tr>)}</tbody>
              </table> : <Empty ar={ar} />}
            </Card>
            <Card className="overflow-hidden p-0">
              <div className="flex items-center justify-between border-b border-ui-border px-5 py-4"><h2 className="font-bold text-ui-text">{ar ? 'أحدث الطلبات' : 'Recent orders'}</h2><Link to="/reports?reportType=detailed_invoices" className="text-xs font-bold text-ui-primary">{ar ? 'عرض الكل' : 'View all'}</Link></div>
              {recent.length ? <table className="w-full text-sm">
                <thead className="bg-ui-page-alt text-xs text-ui-subtle"><tr><th className="px-4 py-3 text-start">#</th><th className="px-4 py-3 text-start">{ar ? 'الفاتورة' : 'Invoice'}</th><th className="px-4 py-3 text-start">{ar ? 'المبلغ' : 'Amount'}</th></tr></thead>
                <tbody>{recent.map((r, i) => <tr key={r.id} className="border-t border-ui-border"><td className="px-4 py-3 font-bold">{i + 1}</td><td className="px-4 py-3">{r.invoice_number || '—'}</td><td className="px-4 py-3 font-semibold">{money(Number(r.total || 0))}</td></tr>)}</tbody>
              </table> : <Empty ar={ar} />}
            </Card>
          </section>

          {wasteRows.length > 0 && (() => {
            const totalWasteCost = wasteRows.reduce((s, r) => s + Number(r.total_cost || 0), 0);
            const totalWasteEntries = wasteRows.reduce((s, r) => s + Number(r.entry_count || 0), 0);
            return (
              <Card className="border-ui-danger/20 bg-ui-danger-soft p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 font-bold text-ui-danger"><Trash2 className="h-5 w-5" />{ar ? ' الهالك — آخر 30 يوم' : ' Waste — Last 30 Days'}</div>
                  <Link to="/waste-center" className="text-xs font-bold text-ui-danger">{ar ? 'عرض الكل' : 'View all'}</Link>
                </div>
                <div className="flex items-center gap-6 mb-3 text-sm">
                  <span className="text-ui-danger font-semibold">{ar ? 'الإجمالي:' : 'Total:'} {money(totalWasteCost)}</span>
                  <span className="text-ui-danger/70">{totalWasteEntries} {ar ? 'سجل' : 'entries'}</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {wasteRows.slice(0, 6).map((r, i) => (
                    <div key={i} className="rounded-xl bg-ui-surface p-2.5 shadow-ui-sm text-sm">
                      <p className="font-semibold truncate text-ui-text">{r.waste_category}</p>
                      <p className="text-ui-danger text-xs mt-0.5">{Number(r.total_quantity).toLocaleString()} — {money(Number(r.total_cost))}</p>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })()}

          {lowStock.length > 0 && (
            <Card className="border-ui-warning/20 bg-ui-warning-soft p-5">
              <div className="flex items-center gap-2 font-bold text-ui-warning"><AlertTriangle className="h-5 w-5" />{ar ? 'تنبيه المخزون المنخفض' : 'Low stock alert'}</div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {lowStock.map((r, i) => <Link key={i} to="/inventory" className="rounded-xl bg-ui-surface p-3 shadow-ui-sm"><p className="truncate text-sm font-semibold text-ui-text">{r.product?.[0]?.name || '—'}</p><p className="mt-1 text-xs text-ui-warning">{formatNumber(Number(r.quantity || 0), 2)} {ar ? 'متبقي' : 'remaining'}</p></Link>)}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  </div>;
}
