import { useState } from 'react';
import { Database, FlaskConical, Trash2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { admin } from '@/api';
import { seedComprehensiveDemoData } from '@/lib/comprehensiveDemoSeeder';
import { useBranches } from '@/hooks/useBranches';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/Toast';
import { Card } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { Select } from '@/components/Input';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { logAudit } from '@/lib/audit';

const SECTIONS = [
  ['catalog', 'المنتجات والأقسام والمخزون', 'Products, categories & stock'],
  ['customers', 'العملاء', 'Customers'],
  ['suppliers', 'الموردون', 'Suppliers'],
  ['sales', 'المبيعات والفواتير', 'Sales & invoices'],
  ['orders', 'الطلبات والمطبخ', 'Orders & kitchen'],
  ['purchasing', 'المشتريات', 'Purchasing'],
  ['manufacturing', 'التصنيع والوصفات والمواد الخام', 'Manufacturing, recipes & raw materials'],
  ['accounting', 'المحاسبة والخزينة', 'Accounting & treasury'],
  ['shifts', 'الورديات', 'Shifts'],
  ['tables', 'الطاولات وخريطة الصالة', 'Tables & floor plan'],
  ['warehouses', 'المستودعات والتحويلات', 'Warehouses & transfers'],
  ['expenses', 'المصروفات', 'Expenses'],
] as const;

type RpcErrorData = { error?: string };

export function AdminDataManagementPanel() {
  const { lang } = useLanguage();
  const { user } = useAuth();
  const { branches } = useBranches();
  const { show } = useToast();
  const ar = lang === 'ar';
  const [branchId, setBranchId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ type: 'section' | 'all'; section?: string; label?: string } | null>(null);

  if (user?.role !== 'super_admin') return null;

  const runDelete = async (section: string) => {
    if (!branchId) return;
    setBusy(section);
    const { data, error } = await admin.deleteDataSection({ p_branch_id: branchId, p_section: section });
    setBusy(null);
    setConfirm(null);
    if (error || !data?.success) {
      show(error?.message || (data as RpcErrorData | null)?.error || (ar ? 'فشل حذف البيانات' : 'Delete failed'), 'error');
      return;
    }
    await logAudit('delete', 'admin_data', branchId, { section });
    show(ar ? `تم حذف بيانات ${section === 'all' ? 'النظام بالكامل' : 'القسم'}` : 'Data deleted successfully', 'success');
  };

  const seedAll = async () => {
    if (!branchId) return;
    setBusy('seed');
    try {
      await seedComprehensiveDemoData(branchId);
      const { data } = await admin.seedAllDemoData({ p_branch_id: branchId });
      await logAudit('create', 'admin_data', branchId, { action: 'seed_all', section_count: data?.section_count || 12 });
      show(ar ? 'تم إنشاء حزمة البيانات التجريبية الشاملة بنجاح (منتجات، وصفات، مواد خام، طاولات، عملاء، موردين)' : 'Comprehensive demo data created successfully across all modules', 'success');
    } catch (err: unknown) {
      show(err instanceof Error ? err.message : (ar ? 'فشل إنشاء البيانات التجريبية' : 'Demo seeding failed'), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="mt-5 overflow-hidden border-2 border-ui-warning/20 /60">
      <div className="border-b border-ui-warning/20 bg-ui-warning-soft/70 p-5 /40 dark:bg-ui-warning-soft/20">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-ui-warning-soft p-3"><Database className="h-6 w-6 text-ui-warning" /></div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-ui-text dark:text-white">{ar ? 'إدارة بيانات النظام — Super Admin' : 'System Data Management — Super Admin'}</h2>
            <p className="mt-1 text-sm text-ui-muted">{ar ? 'حذف بيانات أي قسم للفرع المحدد أو إنشاء مجموعة بيانات تجريبية مترابطة. هذه العمليات لا تظهر إلا للسوبر أدمن.' : 'Delete branch data by module or generate linked demo data. These controls are available only to Super Admin.'}</p>
          </div>
        </div>
      </div>

      <div className="p-5">
        <Select label={ar ? 'الفرع المستهدف' : 'Target branch'} value={branchId} onChange={e => setBranchId(e.target.value)}>
          <option value="">{ar ? 'اختر الفرع أولاً' : 'Select a branch first'}</option>
          {branches.map(b => <option key={b.id} value={b.id}>{ar ? b.name : (b.name_en || b.name)}</option>)}
        </Select>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <button disabled={!branchId || !!busy} onClick={seedAll} className="rounded-2xl border-2 border-brand-200 bg-brand-50 p-4 text-start transition hover:border-brand-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-brand-900/50 dark:bg-brand-950/20">
            <div className="flex items-center gap-3"><FlaskConical className="h-5 w-5 text-brand-600" /><div><div className="font-bold">{ar ? 'إضافة بيانات تجريبية لكل الأقسام' : 'Seed demo data for all modules'}</div><div className="mt-1 text-xs text-ui-subtle">{ar ? 'منتجات، عملاء، موردون، مشتريات، مبيعات، طلبات، تصنيع، مصروفات، ورديات وخزينة.' : 'Products, customers, suppliers, purchasing, sales, orders, manufacturing, expenses, shifts and treasury.'}</div></div></div>
          </button>
          <button disabled={!branchId || !!busy} onClick={() => setConfirm({ type: 'all' })} className="rounded-2xl border-2 border-ui-danger/20 bg-ui-danger-soft p-4 text-start transition hover:border-ui-danger/40 disabled:cursor-not-allowed disabled:opacity-50 dark:border-ui-danger/20/50 dark:bg-ui-danger-soft/20">
            <div className="flex items-center gap-3"><Trash2 className="h-5 w-5 text-ui-danger" /><div><div className="font-bold text-ui-danger dark:text-ui-danger">{ar ? 'حذف جميع بيانات التشغيل للفرع' : 'Delete all operational data for branch'}</div><div className="mt-1 text-xs text-ui-subtle">{ar ? 'لا يحذف الفرع أو المستخدمين أو الصلاحيات أو الحسابات النظامية.' : 'Does not delete the branch, users, permissions or system accounts.'}</div></div></div>
          </button>
        </div>

        <div className="mt-6 flex items-center gap-2 text-xs text-ui-warning"><AlertTriangle className="h-4 w-4" />{ar ? 'الحذف دائم. لا تستخدمه على بيانات إنتاجية إلا بعد التأكد من الفرع والقسم.' : 'Deletion is permanent. Verify the branch and module before using it on live data.'}</div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SECTIONS.map(([key, arName, enName]) => (
            <div key={key} className="rounded-2xl border border-ui-border p-4 dark:border-navy-700">
              <div className="mb-3 flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-ui-subtle" /><span className="text-sm font-semibold">{ar ? arName : enName}</span></div>
              <Button variant="danger" className="w-full" disabled={!branchId || !!busy} onClick={() => setConfirm({ type: 'section', section: key, label: ar ? arName : enName })}>
                <Trash2 className="h-4 w-4" /> {ar ? 'حذف بيانات القسم' : 'Delete section data'}
              </Button>
            </div>
          ))}
        </div>
      </div>

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => void runDelete(confirm?.type === 'all' ? 'all' : confirm?.section || '')}
        title={confirm?.type === 'all' ? (ar ? 'حذف جميع بيانات الفرع؟' : 'Delete all branch data?') : (ar ? `حذف ${confirm?.label || 'القسم'}؟` : `Delete ${confirm?.label || 'section'}?`)}
        message={ar ? 'هذا الإجراء نهائي وسيحذف بيانات التشغيل المرتبطة بالفرع. تأكد من أنك اخترت الفرع الصحيح قبل المتابعة.' : 'This action is permanent and removes operational data for the selected branch. Verify the branch before continuing.'}
        confirmLabel={ar ? 'نعم، احذف' : 'Yes, delete'}
        cancelLabel={ar ? 'إلغاء' : 'Cancel'}
      />
    </Card>
  );
}
