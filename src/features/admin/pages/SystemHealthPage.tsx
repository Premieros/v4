import { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Database, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { supabase } from '@/api';
import { Card } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { useLanguage } from '@/context/LanguageContext';
import { AdminDataManagementPanel } from './AdminDataManagementPanel';

type Status = 'ok' | 'warning' | 'error' | 'checking';
type Check = { key: string; ar: string; en: string; status: Status; detail: string; count?: number };

const TARGETS = [
  ['system_settings', 'إعدادات النظام', 'System settings'],
  ['branches', 'الفروع', 'Branches'],
  ['users', 'المستخدمون', 'Users'],
  ['products', 'المنتجات', 'Products'],
  ['categories', 'الأقسام', 'Categories'],
  ['warehouses', 'المستودعات', 'Warehouses'],
  ['orders', 'الطلبات', 'Orders'],
  ['order_items', 'بنود الطلبات', 'Order items'],
  ['dining_tables', 'الطاولات', 'Dining tables'],
  ['shifts', 'الورديات', 'Shifts'],
  ['purchases', 'المشتريات', 'Purchases'],
  ['purchase_items', 'بنود المشتريات', 'Purchase items'],
] as const;

function icon(status: Status) {
  if (status === 'ok') return <CheckCircle2 className="h-5 w-5 text-ui-success" />;
  if (status === 'error') return <XCircle className="h-5 w-5 text-ui-danger" />;
  if (status === 'warning') return <AlertTriangle className="h-5 w-5 text-ui-warning" />;
  return <RefreshCw className="h-5 w-5 animate-spin text-brand-600" />;
}

export function SystemHealthPage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const [checks, setChecks] = useState<Check[]>([]);
  const [running, setRunning] = useState(false);
  const [finishedAt, setFinishedAt] = useState<string | null>(null);

  const runChecks = useCallback(async () => {
    setRunning(true);
    const base = TARGETS.map(([key, arName, enName]) => ({ key, ar: arName, en: enName, status: 'checking' as Status, detail: ar ? 'جارٍ الفحص...' : 'Checking...' }));
    setChecks(base);

    const connection = await supabase.auth.getSession();
    if (connection.error) {
      setChecks(base.map(c => ({ ...c, status: 'error', detail: ar ? connection.error?.message || 'فشل الاتصال' : connection.error?.message || 'Connection failed' })));
      setRunning(false);
      return;
    }

    const results = await Promise.all(TARGETS.map(async ([key, arName, enName]) => {
      const { count, error } = await supabase.from(key).select('*', { count: 'exact', head: true });
      if (error) return { key, ar: arName, en: enName, status: 'error' as Status, detail: error.message };
      return { key, ar: arName, en: enName, status: 'ok' as Status, detail: ar ? 'الوصول إلى الجدول يعمل' : 'Table access is working', count: count ?? 0 };
    }));

    setChecks(results);
    setFinishedAt(new Date().toLocaleString());
    setRunning(false);
  }, [ar]);

  useEffect(() => { void runChecks(); }, [runChecks]);

  const ok = checks.filter(c => c.status === 'ok').length;
  const errors = checks.filter(c => c.status === 'error').length;
  const warnings = checks.filter(c => c.status === 'warning').length;

  return (
    <div className="space-y-5 pb-10">
      <div className="rounded-3xl bg-gradient-to-br from-slate-950 via-navy-900 to-slate-800 p-6 text-white shadow-xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm text-ui-success"><ShieldCheck className="h-4 w-4" />System Health</div>
            <h1 className="text-3xl font-bold">{ar ? 'فحص سلامة النظام' : 'System Health Check'}</h1>
            <p className="mt-2 max-w-3xl text-sm text-ui-muted">{ar ? 'فحص اتصال قاعدة البيانات والوصول إلى الجداول الأساسية بدون إنشاء أو تعديل أي بيانات.' : 'Checks database connectivity and access to core tables without creating or changing data.'}</p>
          </div>
          <Button onClick={() => void runChecks()} disabled={running}><RefreshCw className={`h-4 w-4 ${running ? 'animate-spin' : ''}`} />{ar ? 'إعادة الفحص' : 'Run again'}</Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-5"><div className="text-sm text-ui-subtle">{ar ? 'يعمل' : 'Healthy'}</div><div className="mt-1 text-3xl font-bold text-ui-success">{ok}</div></Card>
        <Card className="p-5"><div className="text-sm text-ui-subtle">{ar ? 'تحذيرات' : 'Warnings'}</div><div className="mt-1 text-3xl font-bold text-ui-warning">{warnings}</div></Card>
        <Card className="p-5"><div className="text-sm text-ui-subtle">{ar ? 'أخطاء' : 'Errors'}</div><div className="mt-1 text-3xl font-bold text-ui-danger">{errors}</div></Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 border-b border-ui-border p-5 dark:border-navy-800"><Database className="h-5 w-5 text-brand-600" /><div><h2 className="font-bold">{ar ? 'فحوص قاعدة البيانات' : 'Database checks'}</h2><p className="text-xs text-ui-subtle">{finishedAt ? `${ar ? 'آخر فحص' : 'Last check'}: ${finishedAt}` : ''}</p></div></div>
        <div className="divide-y divide-slate-100 dark:divide-navy-800">
          {checks.map(check => (
            <div key={check.key} className="flex items-center gap-4 p-4">
              {icon(check.status)}
              <div className="min-w-0 flex-1"><div className="font-semibold">{ar ? check.ar : check.en}</div><div className="truncate text-xs text-ui-subtle">{check.detail}</div></div>
              {check.status === 'ok' && typeof check.count === 'number' && <div className="rounded-lg bg-ui-page-alt px-3 py-1 text-sm font-semibold dark:bg-navy-800">{check.count.toLocaleString()}</div>}
            </div>
          ))}
        </div>
      </Card>

      <AdminDataManagementPanel />

      <Card className="p-5"><div className="flex items-start gap-3"><Activity className="mt-0.5 h-5 w-5 text-brand-600" /><div><h3 className="font-bold">{ar ? 'ملاحظة' : 'Note'}</h3><p className="mt-1 text-sm text-ui-subtle">{ar ? 'هذه المرحلة تقيس الوصول والبنية فقط. أدوات إدارة البيانات أعلاه مقيدة بـ Super Admin وتعمل على الفرع المحدد فقط.' : 'This page checks access and structure. The data-management tools above are restricted to Super Admin and operate on the selected branch only.'}</p></div></div></Card>
    </div>
  );
}