import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowUpRight, Boxes, Building2, CreditCard, Package, RefreshCw, ShoppingCart, Sparkles, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useActiveBranchId } from '@/lib/activeBranch';
import { isAdminRole } from '@/lib/permissions';
import { useSettings } from '@/context/SettingsContext';
import { formatCurrency, formatNumber } from '@/lib/format';

type Sale = { id: string; total: number | null; paid_amount: number | null; payment_method: string | null; order_type: string | null; branch_id: string | null; created_at: string };
type Stock = { quantity: number | null; branch_id: string | null };
type Range = 'today' | 'week' | 'month';

const rangeLabels: Record<Range, [string, string]> = { today: ['اليوم', 'Today'], week: ['7 أيام', '7 days'], month: ['30 يوم', '30 days'] };
const paymentLabels: Record<string, [string, string]> = { cash: ['نقدي', 'Cash'], card: ['بطاقة', 'Card'], visa: ['فيزا / ماستركارد', 'Visa / Mastercard'], bank: ['تحويل بنكي', 'Bank transfer'], wallet: ['محفظة', 'Wallet'], instapay: ['InstaPay', 'InstaPay'], other: ['أخرى', 'Other'] };
const orderLabels: Record<string, [string, string]> = { dine_in: ['الصالة', 'Dine-in'], takeaway: ['تيك أواي', 'Takeaway'], delivery: ['دليفري', 'Delivery'], car: ['سيارة', 'Car'], quick: ['سريع', 'Quick'], other: ['أخرى', 'Other'] };

function Card({ children, className = '' }: { children: ReactNode; className?: string }) { return <section className={`rounded-3xl border border-ui-border bg-ui-surface p-5 shadow-ui ${className}`}>{children}</section>; }
function Bar({ value, max }: { value: number; max: number }) { const width = Math.max(4, Math.min(100, (value / Math.max(max, 1)) * 100)); return <div className="h-2 overflow-hidden rounded-full bg-ui-page"><div className="h-full rounded-full bg-ui-primary" style={{ width: `${width}%` }} /></div>; }
function Empty({ ar }: { ar: boolean }) { return <p className="rounded-2xl bg-ui-page p-4 text-sm font-semibold text-ui-muted">{ar ? 'لا توجد بيانات للفترة المحددة.' : 'No data for the selected period.'}</p>; }

export function DashboardExecutiveInsightsV2() {
  const { lang } = useLanguage();
  const { user } = useAuth();
  const branchFilter = useBranchFilter();
  const { effectiveSettings } = useSettings();
  const [activeBranchId] = useActiveBranchId();
  const ar = lang === 'ar';
  const branchId = isAdminRole(user?.role) ? activeBranchId : branchFilter;
  const settings = effectiveSettings(branchId);
  const money = useCallback((value: number) => formatCurrency(value, settings?.currency || 'EGP', lang), [settings?.currency, lang]);
  const [range, setRange] = useState<Range>('today');
  const [sales, setSales] = useState<Sale[]>([]);
  const [stock, setStock] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const end = new Date();
      const start = new Date(end);
      if (range === 'today') start.setHours(0, 0, 0, 0);
      if (range === 'week') start.setDate(start.getDate() - 6);
      if (range === 'month') start.setDate(start.getDate() - 29);
      let salesQuery = supabase.from('sales').select('id,total,paid_amount,payment_method,order_type,branch_id,created_at').gte('created_at', start.toISOString()).lte('created_at', end.toISOString()).order('created_at', { ascending: false }).limit(5000);
      let inventoryQuery = supabase.from('inventory').select('quantity,branch_id').limit(5000);
      if (branchId) { salesQuery = salesQuery.eq('branch_id', branchId); inventoryQuery = inventoryQuery.eq('branch_id', branchId); }
      const [salesResult, inventoryResult] = await Promise.all([salesQuery, inventoryQuery]);
      if (salesResult.error) throw salesResult.error;
      if (inventoryResult.error) throw inventoryResult.error;
      setSales((salesResult.data || []) as Sale[]);
      setStock((inventoryResult.data || []) as Stock[]);
    } catch (error) {
      console.error('Executive dashboard load failed', error);
      setSales([]); setStock([]);
    } finally { setLoading(false); }
  }, [branchId, range]);

  useEffect(() => { void load(); }, [load]);

  const stats = useMemo(() => {
    const gross = sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
    const collected = sales.reduce((sum, sale) => sum + Number(sale.paid_amount ?? sale.total ?? 0), 0);
    return { gross, collected, orders: sales.length, average: sales.length ? gross / sales.length : 0 };
  }, [sales]);

  const payments = useMemo(() => {
    const totals = new Map<string, number>();
    sales.forEach((sale) => { const key = (sale.payment_method || 'other').toLowerCase(); totals.set(key, (totals.get(key) || 0) + Number(sale.paid_amount ?? sale.total ?? 0)); });
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [sales]);

  const orderTypes = useMemo(() => {
    const totals = new Map<string, number>();
    sales.forEach((sale) => { const key = sale.order_type || 'other'; totals.set(key, (totals.get(key) || 0) + 1); });
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [sales]);

  const lowStockCount = useMemo(() => {
    const threshold = Number(settings?.low_stock_threshold ?? 5);
    return stock.filter((item) => Number(item.quantity || 0) <= threshold).length;
  }, [settings?.low_stock_threshold, stock]);

  const metrics: Array<{ title: string; value: string; Icon: typeof ShoppingCart; href: string }> = [
    { title: ar ? 'إجمالي المبيعات' : 'Gross sales', value: money(stats.gross), Icon: ShoppingCart, href: '/reports' },
    { title: ar ? 'التحصيل' : 'Collected', value: money(stats.collected), Icon: Wallet, href: '/accounting' },
    { title: ar ? 'متوسط الطلب' : 'Average ticket', value: money(stats.average), Icon: CreditCard, href: '/pos' },
    { title: ar ? 'عدد الطلبات' : 'Orders', value: formatNumber(stats.orders), Icon: ShoppingCart, href: '/reports' },
  ];

  return (
    <section dir={ar ? 'rtl' : 'ltr'} className="space-y-6" data-testid="dashboard-executive-insights">
      <Card className="bg-ui-surface border-ui-border">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div><div className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-ui-primary" /><h2 className="text-xl font-black text-ui-text">{ar ? 'مركز الإدارة التنفيذي' : 'Executive Management Center'}</h2></div><p className="mt-1 text-sm text-ui-muted">{ar ? 'أداء المبيعات والمخزون والتنبيهات التشغيلية في مكان واحد' : 'Sales, inventory and operational insights in one place'}</p></div>
          <div className="flex gap-2">{(['today', 'week', 'month'] as Range[]).map((item) => <button key={item} type="button" onClick={() => setRange(item)} className={`rounded-xl px-4 py-2 text-sm font-bold ${range === item ? 'bg-ui-primary text-white' : 'bg-ui-page text-ui-muted'}`}>{rangeLabels[item][ar ? 0 : 1]}</button>)}<button type="button" onClick={() => void load()} className="rounded-xl border border-ui-border p-2 text-ui-text" title={ar ? 'تحديث' : 'Refresh'}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button></div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(({ title, value, Icon, href }) => <Link key={title} to={href} className="rounded-3xl border border-ui-border bg-ui-surface p-5 shadow-ui transition hover:-translate-y-0.5"><div className="flex items-center justify-between"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-ui-primary-soft text-ui-primary"><Icon className="h-5 w-5" /></div><ArrowUpRight className="h-4 w-4 text-ui-subtle" /></div><p className="mt-4 text-sm font-bold text-ui-muted">{title}</p><p className="mt-1 text-2xl font-black text-ui-text">{loading ? '—' : value}</p></Link>)}</div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card><div className="mb-5 flex items-center gap-2"><CreditCard className="h-5 w-5 text-ui-primary" /><h3 className="font-black text-ui-text">{ar ? 'طرق الدفع' : 'Payment mix'}</h3></div>{payments.length ? payments.map(([key, value]) => <div key={key} className="mb-4 last:mb-0"><div className="mb-1 flex justify-between text-sm"><span className="font-semibold text-ui-text">{paymentLabels[key]?.[ar ? 0 : 1] || key}</span><span className="font-bold text-ui-muted">{money(value)}</span></div><Bar value={value} max={payments[0][1]} /></div>) : <Empty ar={ar} />}</Card>
        <Card><div className="mb-5 flex items-center gap-2"><ShoppingCart className="h-5 w-5 text-ui-primary" /><h3 className="font-black text-ui-text">{ar ? 'قنوات الطلب' : 'Order channels'}</h3></div>{orderTypes.length ? orderTypes.map(([key, count], index) => <div key={key} className="mb-3 flex items-center gap-3"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-ui-primary-soft text-xs font-black text-ui-primary">{index + 1}</span><span className="flex-1 text-sm font-semibold text-ui-text">{orderLabels[key]?.[ar ? 0 : 1] || key}</span><span className="text-sm font-black text-ui-text">{formatNumber(count)}</span></div>) : <Empty ar={ar} />}</Card>
        <Card><div className="mb-5 flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-ui-warning" /><h3 className="font-black text-ui-text">{ar ? 'تنبيهات تشغيلية' : 'Operational alerts'}</h3></div><Link to="/inventory" className="flex items-center gap-3 rounded-2xl bg-ui-warning-soft0/10 p-3"><Boxes className="h-5 w-5 text-ui-warning" /><div className="flex-1"><p className="text-sm font-bold text-ui-text">{ar ? 'مخزون منخفض' : 'Low stock'}</p><p className="text-xs text-ui-muted">{formatNumber(lowStockCount)} {ar ? 'منتج يحتاج مراجعة' : 'items need review'}</p></div><ArrowUpRight className="h-4 w-4 text-ui-subtle" /></Link></Card>
      </div>

      <Card><div className="mb-4 flex items-center gap-2"><Sparkles className="h-5 w-5 text-ui-primary" /><div><h3 className="font-black text-ui-text">{ar ? 'إجراءات سريعة' : 'Quick actions'}</h3><p className="text-xs text-ui-subtle">{ar ? 'وصول مباشر لأهم الشاشات' : 'Direct access to key screens'}</p></div></div><div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">{[['/pos', 'نقطة البيع', 'POS'], ['/inventory', 'المخزون', 'Inventory'], ['/products', 'المنتجات', 'Products'], ['/purchases', 'المشتريات', 'Purchases'], ['/customers', 'العملاء', 'Customers'], ['/reports', 'التقارير', 'Reports'], ['/accounting', 'المحاسبة', 'Accounting'], ['/settings', 'الإعدادات', 'Settings']].map(([href, arLabel, enLabel]) => <Link key={href} to={href} className="rounded-2xl border border-ui-border bg-ui-page p-3 text-center text-sm font-bold text-ui-text transition hover:border-ui-primary hover:text-ui-primary">{ar ? arLabel : enLabel}</Link>)}</div></Card>

      <Card><div className="grid grid-cols-1 gap-4 md:grid-cols-3"><Link to="/inventory" className="rounded-2xl bg-ui-page p-4"><div className="flex items-center gap-2"><Package className="h-5 w-5 text-ui-primary" /><span className="font-black text-ui-text">{ar ? 'حالة المخزون' : 'Inventory status'}</span></div><p className="mt-2 text-sm text-ui-muted">{formatNumber(lowStockCount)} {ar ? 'أصناف تحت الحد الأدنى' : 'items below threshold'}</p></Link><Link to="/branches" className="rounded-2xl bg-ui-page p-4"><div className="flex items-center gap-2"><Building2 className="h-5 w-5 text-ui-primary" /><span className="font-black text-ui-text">{ar ? 'الفروع' : 'Branches'}</span></div><p className="mt-2 text-sm text-ui-muted">{ar ? 'مراجعة أداء الفروع وإدارتها' : 'Review branch performance and management'}</p></Link><Link to="/reports" className="rounded-2xl bg-ui-page p-4"><div className="flex items-center gap-2"><ArrowUpRight className="h-5 w-5 text-ui-primary" /><span className="font-black text-ui-text">{ar ? 'التقارير' : 'Reports'}</span></div><p className="mt-2 text-sm text-ui-muted">{ar ? 'تحليل أعمق للأداء' : 'Deeper performance analysis'}</p></Link></div></Card>
    </section>
  );
}
