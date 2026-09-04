import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  CreditCard,
  Copy,
  Loader2,
  Upload,
  Building2,
  Users,
  Warehouse,
  Lock,
  Sparkles,
  ShieldAlert,
} from 'lucide-react';
import * as api from '@/api';
import { formatDate } from '@/lib/format';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { isAdminRole } from '@/lib/permissions';
import { Button } from '@/components/Button';
import { useToast } from '@/components/Toast';
import { APP_ROUTES } from '@/core/navigation/routes';
import {
  SubscriptionService,
  type Plan,
  type TenantSubscriptionDetails,
} from '@/services/subscription';
import { PlanComparisonTable } from '@/components/subscription/PlanComparisonTable';

type Period = 'monthly' | 'yearly';
type SubscriptionSettings = {
  instapay_id: string | null;
  beneficiary_name: string | null;
  qr_code_url: string | null;
  instructions_ar: string | null;
  instructions_en: string | null;
  allow_monthly: boolean;
  allow_yearly: boolean;
};

export function SubscriptionPage() {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const { show } = useToast();
  const isAr = lang === 'ar';

  const [details, setDetails] = useState<TenantSubscriptionDetails | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [settings, setSettings] = useState<SubscriptionSettings | null>(null);
  const [period, setPeriod] = useState<Period>('monthly');
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [reference, setReference] = useState('');
  const [receiptUrl, setReceiptUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      setLoading(true);
      const [tenantData, publicPlans] = await Promise.all([
        SubscriptionService.getTenantSubscriptionDetails(),
        SubscriptionService.getPublicPlans(),
      ]);

      setDetails(tenantData);
      setPlans(publicPlans);

      // Fetch gateway settings with resilient fallback
      try {
        const settingsResult = await api.supabase.rpc('subscription_settings_get');
        if (!settingsResult.error && settingsResult.data) {
          setSettings(settingsResult.data as SubscriptionSettings);
        } else {
          const { data: directSettings } = await api.supabase
            .from('subscription_settings')
            .select('*')
            .limit(1)
            .maybeSingle();
          if (directSettings) {
            setSettings(directSettings as SubscriptionSettings);
          }
        }
      } catch {
        const { data: directSettings } = await api.supabase
          .from('subscription_settings')
          .select('*')
          .limit(1)
          .maybeSingle();
        if (directSettings) {
          setSettings(directSettings as SubscriptionSettings);
        }
      }
    } catch (err) {
      console.error('Failed to load subscription data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const sub = details?.subscription;
  const status = sub?.status || 'none';
  const isSuspended = status === 'suspended';
  const isExpired =
    status === 'expired' ||
    (status === 'trialing' && sub?.trial_ends_at && new Date(sub.trial_ends_at).getTime() < Date.now()) ||
    (status === 'active' && sub?.current_period_end && new Date(sub.current_period_end).getTime() < Date.now());

  const daysLeft = useMemo(() => {
    if (!sub?.trial_ends_at && !sub?.current_period_end) return null;
    const targetDate = sub.status === 'trialing' ? sub.trial_ends_at : sub.current_period_end;
    if (!targetDate) return null;
    return Math.max(0, Math.ceil((new Date(targetDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
  }, [sub]);

  const instapay = settings?.instapay_id?.trim() || '';

  const submitPayment = async () => {
    if (!selectedPlan) return;
    setSubmitting(true);

    const priceObj = selectedPlan.prices?.find((p) => p.billing_cycle === period) || selectedPlan.prices?.[0];
    const amount = priceObj?.price || (period === 'monthly' ? 299 : 2990);
    let success = false;
    let errMessage = '';

    try {
      const { data, error } = await api.supabase.rpc('submit_instapay_payment', {
        p_branch_id: user?.branch_id || null,
        p_plan_id: selectedPlan.id,
        p_amount: amount,
        p_billing_period: period,
        p_reference: reference || null,
        p_receipt_url: receiptUrl || null,
      });

      if (!error && (data as { success?: boolean })?.success) {
        success = true;
      } else {
        errMessage = (data as { error?: string })?.error || error?.message || '';
      }
    } catch {
      // RPC fallback
    }

    if (!success) {
      // Direct table insert fallback
      try {
        const { error: insErr } = await api.supabase.from('subscription_payments').insert({
          branch_id: user?.branch_id || null,
          plan_id: selectedPlan.id,
          amount,
          billing_period: period,
          reference: reference || null,
          receipt_url: receiptUrl || null,
          status: 'pending',
          submitted_at: new Date().toISOString(),
        });
        if (!insErr) {
          success = true;
        } else {
          errMessage = insErr.message;
        }
      } catch (fbErr) {
        errMessage = fbErr instanceof Error ? fbErr.message : 'Submission failed';
      }
    }

    setSubmitting(false);
    if (!success) {
      show(errMessage || (isAr ? 'تعذر إرسال الطلب' : 'Payment submission failed'), 'error');
      return;
    }
    show(isAr ? 'تم إرسال طلب التحويل للمراجعة بنجاح' : 'Transfer submitted for review', 'success');
    setSelectedPlan(null);
    setReference('');
    setReceiptUrl('');
    loadData();
  };

  const copyInstaPay = async () => {
    if (!instapay) {
      return show(
        isAr ? 'لم يتم ضبط حساب InstaPay بعد' : 'InstaPay account is not configured yet',
        'error'
      );
    }
    await navigator.clipboard.writeText(instapay);
    show(isAr ? 'تم نسخ حساب InstaPay' : 'InstaPay account copied', 'success');
  };

  if (loading) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-ui-primary" />
      </div>
    );
  }

  const isOwner = isAdminRole(user?.role);
  if (!isOwner) {
    return (
      <div className="max-w-xl mx-auto my-12 p-8 bg-ui-card border border-ui-border rounded-2xl shadow-sm text-center">
        <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-ui-text mb-2">
          {isAr ? 'صفحة مخصصة لمالك المنشأة فقط' : 'Owner Access Only'}
        </h2>
        <p className="text-sm text-ui-text-muted leading-relaxed mb-6 max-w-md mx-auto">
          {isAr
            ? 'عذراً، إدارة وتجديد اشتراكات المنشأة متاحة حصرياً لمالك الحساب والمدير العام.'
            : 'Subscription management and billing are restricted to the account owner and super administrator.'}
        </p>
        <Button onClick={() => window.location.href = APP_ROUTES.dashboard}>
          {isAr ? 'العودة للرئيسية' : 'Return to Dashboard'}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      {/* Hero Header */}
      <div className="rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 p-6 md:p-8 text-white shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 bg-ui-primary/20 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-300">
              <CreditCard className="h-4 w-4" />
              <span>{isAr ? 'إدارة الاشتراك والتراخيص' : 'Subscription & Licenses'}</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight">
              {details?.plan?.name || (isAr ? 'الاشتراك الحالي' : 'Current Plan')}
            </h1>
            <p className="mt-1.5 text-sm text-slate-300 max-w-xl">
              {details?.plan?.description ||
                (isAr
                  ? 'تحكم في خطة المنشأة والمميزات المتاحة وحدود الاستخدام والفروع.'
                  : 'Manage organization plan, enabled features, usage limits and branches.')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div
              className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-bold shadow-sm ${
                isSuspended
                  ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                  : isExpired
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
              }`}
            >
              {isSuspended ? (
                <ShieldAlert className="h-4 w-4 text-red-400" />
              ) : isExpired ? (
                <AlertTriangle className="h-4 w-4 text-amber-400" />
              ) : (
                <BadgeCheck className="h-4 w-4 text-emerald-400" />
              )}
              <span>
                {isSuspended
                  ? isAr ? 'معلق' : 'Suspended'
                  : isExpired
                  ? isAr ? 'منتهي' : 'Expired'
                  : status === 'trialing'
                  ? isAr ? 'فترة تجريبية' : 'Free Trial'
                  : isAr ? 'اشتراك نشط' : 'Active'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Expiration or Suspension Alert */}
      {isExpired && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-amber-900 dark:text-amber-200 flex items-start gap-4">
          <AlertTriangle className="h-6 w-6 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="font-bold text-base mb-1">
              {isAr ? 'انتهت صلاحية اشتراك المنشأة' : 'Organization Subscription Expired'}
            </h4>
            <p className="text-sm opacity-90 leading-relaxed">
              {isAr
                ? 'يرجى تجديد الاشتراك أو الترقية لخطة جديدة للاستمرار في الاستفادة من ميزات Premier دون انقطاع.'
                : 'Please renew your subscription or upgrade to a new plan to continue using Premier features.'}
            </p>
          </div>
        </div>
      )}

      {/* Usage & Limits Metrics */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="p-5 rounded-2xl border border-ui-border bg-ui-card flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center flex-shrink-0">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-ui-text-muted">
              {isAr ? 'الفروع المستخدمة' : 'Branches'}
            </p>
            <p className="text-xl font-bold text-ui-text mt-0.5">
              {details?.usage?.branches_count ?? 1}{' '}
              <span className="text-xs font-normal text-ui-text-muted">
                / {isAr ? 'متاح حسب الخطة' : 'per plan'}
              </span>
            </p>
          </div>
        </div>

        <div className="p-5 rounded-2xl border border-ui-border bg-ui-card flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center flex-shrink-0">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-ui-text-muted">
              {isAr ? 'المستخدمين وطواقم العمل' : 'Active Users'}
            </p>
            <p className="text-xl font-bold text-ui-text mt-0.5">
              {details?.usage?.users_count ?? 1}{' '}
              <span className="text-xs font-normal text-ui-text-muted">
                / {isAr ? 'متاح حسب الخطة' : 'per plan'}
              </span>
            </p>
          </div>
        </div>

        <div className="p-5 rounded-2xl border border-ui-border bg-ui-card flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-purple-500/10 text-purple-600 flex items-center justify-center flex-shrink-0">
            <Warehouse className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-ui-text-muted">
              {status === 'trialing' ? (isAr ? 'متبقي في التجربة' : 'Trial Remaining') : (isAr ? 'صلاحية الخطة' : 'Plan Period')}
            </p>
            <p className="text-xl font-bold text-ui-text mt-0.5">
              {daysLeft !== null
                ? `${daysLeft} ${isAr ? 'يوم' : 'days'}`
                : sub?.current_period_end
                ? formatDate(sub.current_period_end, lang)
                : '—'}
            </p>
          </div>
        </div>
      </div>

      {/* Feature Catalog for Current Plan */}
      <div className="p-6 rounded-2xl border border-ui-border bg-ui-card space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-ui-text flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-ui-primary" />
              <span>{isAr ? 'الميزات المتاحة في خطتك الحالية' : 'Features in Your Current Plan'}</span>
            </h2>
            <p className="text-xs text-ui-text-muted mt-1">
              {isAr
                ? 'قائمة الخصائص المشمولة والمقفولة في حساب منشأتك وفقاً للخطة الحالية'
                : 'List of enabled and locked capabilities according to your current plan'}
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {details?.features?.map((f) => (
            <div
              key={f.key}
              className={`p-3.5 rounded-xl border flex items-start justify-between gap-3 transition-all ${
                f.enabled
                  ? 'border-emerald-500/20 bg-emerald-500/5 dark:bg-emerald-950/10'
                  : 'border-ui-border/60 bg-ui-muted/30 opacity-70'
              }`}
            >
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-sm text-ui-text">{f.name}</span>
                </div>
                {f.description && (
                  <p className="text-xs text-ui-text-muted leading-tight">{f.description}</p>
                )}
              </div>

              <div className="flex-shrink-0 mt-0.5">
                {f.enabled ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                    {f.limit_value !== null && f.limit_value !== -1
                      ? `حتى ${f.limit_value}`
                      : isAr ? 'مفعّل' : 'Active'}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-ui-muted text-ui-text-muted">
                    <Lock className="w-3 h-3" />
                    <span>{isAr ? 'مقفول' : 'Locked'}</span>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Plan Matrix & Upgrades */}
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-ui-text">
            {isAr ? 'ترقية الخطة والمقارنة الكاملة' : 'Compare Plans & Upgrade'}
          </h2>
          <p className="text-sm text-ui-text-muted mt-0.5">
            {isAr
              ? 'قارن بين الخطط المتاحة واختر الخطة الأنسب لحجم نشاطك'
              : 'Compare available tiers and choose the plan that best fits your business'}
          </p>
        </div>

        <PlanComparisonTable
          plans={plans}
          currentPlanSlug={details?.plan?.slug}
          onSelectPlan={(plan) => setSelectedPlan(plan)}
        />
      </div>

      {/* Payment Modal */}
      {selectedPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl bg-ui-card border border-ui-border p-6 shadow-2xl space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-xl font-bold text-ui-text">
                  {isAr ? 'طلب اشتراك / ترقية الخطة' : 'Subscription Upgrade Request'}
                </h3>
                <p className="text-xs text-ui-text-muted mt-1">
                  {isAr ? 'الخطة المختارة' : 'Selected Plan'}:{' '}
                  <span className="font-bold text-ui-text">{selectedPlan.name}</span>
                </p>
              </div>
              <button
                onClick={() => setSelectedPlan(null)}
                className="w-8 h-8 rounded-full bg-ui-muted hover:bg-ui-border text-ui-text flex items-center justify-center font-bold"
              >
                ✕
              </button>
            </div>

            {/* Cycle Selector */}
            <div className="flex bg-ui-muted p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setPeriod('monthly')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  period === 'monthly'
                    ? 'bg-ui-card text-ui-text shadow-sm'
                    : 'text-ui-text-muted'
                }`}
              >
                شهري
              </button>
              <button
                type="button"
                onClick={() => setPeriod('yearly')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  period === 'yearly'
                    ? 'bg-ui-card text-ui-text shadow-sm'
                    : 'text-ui-text-muted'
                }`}
              >
                سنوي (خصم شهرين)
              </button>
            </div>

            {/* InstaPay Transfer Info */}
            <div className="p-4 rounded-2xl bg-ui-page border border-ui-border space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-ui-text-muted">
                  {isAr ? 'المبلغ المطلوب' : 'Amount'}
                </span>
                <span className="text-2xl font-black text-ui-text">
                  {period === 'monthly'
                    ? selectedPlan.prices?.find((p) => p.billing_cycle === 'monthly')?.price ?? 299
                    : selectedPlan.prices?.find((p) => p.billing_cycle === 'yearly')?.price ?? 2990}{' '}
                  EGP
                </span>
              </div>

              <div className="p-3 rounded-xl bg-ui-card border border-ui-border flex items-center justify-between">
                <div>
                  <p className="text-[11px] text-ui-text-muted">حساب InstaPay المعتمد</p>
                  <p className="font-mono font-bold text-sm text-ui-text break-all">
                    {instapay || (isAr ? 'لم يتم ضبط الحساب' : 'Not configured')}
                  </p>
                  {settings?.beneficiary_name && (
                    <p className="text-[11px] text-ui-text-muted mt-0.5">
                      {settings.beneficiary_name}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={copyInstaPay}
                  disabled={!instapay}
                  className="p-2 rounded-lg bg-ui-muted hover:bg-ui-border text-ui-text transition-colors"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>

              {settings?.qr_code_url && (
                <img
                  src={settings.qr_code_url}
                  alt="InstaPay QR"
                  className="mx-auto h-36 w-36 rounded-xl border object-contain bg-white p-1"
                />
              )}
            </div>

            {/* Reference Inputs */}
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-ui-text mb-1 block">
                  {isAr ? 'رقم مرجع التحويل أو اسم المحوّل' : 'Transfer Reference'}
                </label>
                <input
                  type="text"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder={isAr ? 'مثال: IP-948271 أو اسم صاحب المحفظة' : 'e.g. Reference code'}
                  className="w-full rounded-xl border border-ui-border bg-ui-page p-2.5 text-sm text-ui-text"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-ui-text mb-1 block">
                  {isAr ? 'رابط صورة الإيصال (اختياري)' : 'Receipt Image URL (optional)'}
                </label>
                <input
                  type="text"
                  value={receiptUrl}
                  onChange={(e) => setReceiptUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full rounded-xl border border-ui-border bg-ui-page p-2.5 text-sm text-ui-text"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setSelectedPlan(null)}
                  className="flex-1"
                >
                  {isAr ? 'إلغاء' : 'Cancel'}
                </Button>
                <Button
                  onClick={submitPayment}
                  disabled={submitting || !instapay}
                  className="flex-1"
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  <span>{isAr ? 'إرسال طلب التفعيل' : 'Submit for Review'}</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
