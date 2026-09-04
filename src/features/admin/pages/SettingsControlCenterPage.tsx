import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Palette,
  Languages,
  CreditCard,
  Store,
  Users,
  ShieldAlert,
  Sparkles,
  Save,
  Check,
  Loader2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';
import { useBranches } from '@/hooks/useBranches';
import { useToast } from '@/components/Toast';
import { Card } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { Input, Select, Textarea } from '@/components/Input';
import { logAudit } from '@/lib/audit';
import { findUiTheme, UI_THEMES } from '@/lib/themes';
import { formatCurrency, formatDate } from '@/lib/format';
import type { BranchSettings, SubscriptionPlan, SubscriptionStatus } from '@/lib/types';
import { APP_ROUTES } from '@/core/navigation/routes';

type SettingsTab = 'branch_profile' | 'branch_subscription' | 'branch_staff' | 'appearance' | 'language';

interface UserRow {
  id: string;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
}

export function SettingsControlCenterPage() {
  const { user } = useAuth();
  const { t, lang, setLang } = useLanguage();
  const { theme, setTheme, setUiTheme } = useTheme();
  const { branchSettingsMap, saveBranchSettings } = useSettings();
  const { branches } = useBranches();
  const { show } = useToast();
  const isAr = lang === 'ar';

  const isSuperAdmin = user?.role === 'super_admin' || user?.role === 'owner';

  // Section tabs
  const [active, setActive] = useState<SettingsTab>('branch_profile');
  const [saving, setSaving] = useState(false);

  // Branch override / edit state
  const myBranchId = user?.branch_id || (branches[0]?.id ?? '');
  const [selectedBranchId, setSelectedBranchId] = useState<string>(myBranchId);
  const [branchForm, setBranchForm] = useState<Partial<BranchSettings>>({});

  // Branch subscription state
  const [branchSubStatus, setBranchSubStatus] = useState<SubscriptionStatus | null>(null);
  const [publicPlans, setPublicPlans] = useState<SubscriptionPlan[]>([]);
  const [gatewaySettings, setGatewaySettings] = useState<{
    instapay_id: string | null;
    beneficiary_name: string | null;
    qr_code_url: string | null;
    instructions_ar: string | null;
    instructions_en: string | null;
  } | null>(null);
  const [selectedUpgradePlan, setSelectedUpgradePlan] = useState<SubscriptionPlan | null>(null);
  const [upgradeCycle, setUpgradeCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [paymentRef, setPaymentRef] = useState('');
  const [receiptUrl, setReceiptUrl] = useState('');
  const [submittingPayment, setSubmittingPayment] = useState(false);

  // Branch staff state
  const [branchStaff, setBranchStaff] = useState<UserRow[]>([]);
  const [loadingStaff, setLoadingStaff] = useState(false);

  // Load branch specific form data
  const targetBranchId = selectedBranchId || myBranchId;
  useEffect(() => {
    if (targetBranchId) {
      const row = branchSettingsMap[targetBranchId] || null;
      setBranchForm({
        branch_id: targetBranchId,
        receipt_header: row?.receipt_header ?? '',
        receipt_footer: row?.receipt_footer ?? '',
        logo_url: row?.logo_url ?? '',
        tax_rate: row?.tax_rate ?? null,
        tax_enabled: row?.tax_enabled ?? null,
        currency: row?.currency ?? '',
        low_stock_threshold: row?.low_stock_threshold ?? null,
      });
    }
  }, [targetBranchId, branchSettingsMap]);

  // Load branch subscription data & public plans
  const loadBranchSubData = useCallback(async () => {
    if (!targetBranchId) return;
    const [stRes, plansRes, sRes] = await Promise.all([
      api.subscriptions.status({ p_branch_id: targetBranchId }),
      api.subscriptions.listPlans(),
      supabase.rpc('subscription_settings_get'),
    ]);
    if (!stRes.error && stRes.data) setBranchSubStatus(stRes.data);
    if (!plansRes.error && plansRes.data) setPublicPlans(plansRes.data);
    if (!sRes.error && sRes.data) setGatewaySettings(sRes.data as never);
  }, [targetBranchId]);

  // Load branch staff
  const loadBranchStaff = useCallback(async () => {
    if (!targetBranchId) return;
    setLoadingStaff(true);
    const { data, error } = await supabase
      .from('users')
      .select('id, full_name, email, role, is_active')
      .eq('branch_id', targetBranchId)
      .order('full_name');
    setLoadingStaff(false);
    if (!error && data) {
      setBranchStaff(data as UserRow[]);
    }
  }, [targetBranchId]);

  const currentPlan = useMemo(
    () => publicPlans.find((p) => p.id === branchSubStatus?.plan_id),
    [publicPlans, branchSubStatus?.plan_id]
  );

  const daysRemaining = useMemo(() => {
    if (!branchSubStatus?.current_period_ends_at) return 0;
    const diff = new Date(branchSubStatus.current_period_ends_at).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }, [branchSubStatus?.current_period_ends_at]);

  useEffect(() => {
    if (active === 'branch_subscription') void loadBranchSubData();
    if (active === 'branch_staff') void loadBranchStaff();
  }, [active, loadBranchSubData, loadBranchStaff]);

  const pickTheme = (key: string) => {
    const p = findUiTheme(key);
    if (!p) return;
    setUiTheme(key);
    setTheme(p.mode);
  };

  const saveBranchSpecific = async () => {
    if (!targetBranchId) return;
    setSaving(true);
    const patch: Partial<BranchSettings> = {
      receipt_header: branchForm.receipt_header || null,
      receipt_footer: branchForm.receipt_footer || null,
      logo_url: branchForm.logo_url || null,
      tax_rate: branchForm.tax_rate != null && !Number.isNaN(branchForm.tax_rate) ? branchForm.tax_rate : null,
      tax_enabled: branchForm.tax_enabled ?? null,
      currency: branchForm.currency || null,
      low_stock_threshold:
        branchForm.low_stock_threshold != null && !Number.isNaN(branchForm.low_stock_threshold)
          ? branchForm.low_stock_threshold
          : null,
    };
    const ok = await saveBranchSettings(targetBranchId, patch);
    if (ok) {
      await logAudit('update', 'branch_settings', targetBranchId);
      show(isAr ? 'تم حفظ إعدادات الفرع بنجاح' : 'Branch settings saved successfully', 'success');
    } else {
      show(isAr ? 'فشل حفظ إعدادات الفرع' : 'Failed to save branch settings', 'error');
    }
    setSaving(false);
  };

  // Submit payment for branch manager
  const submitBranchPayment = async () => {
    if (!selectedUpgradePlan || !targetBranchId) return;
    setSubmittingPayment(true);
    const price =
      upgradeCycle === 'yearly'
        ? selectedUpgradePlan.yearly_price_egp
        : selectedUpgradePlan.monthly_price_egp;

    const { data, error } = await supabase.rpc('submit_instapay_payment', {
      p_branch_id: targetBranchId,
      p_plan_id: selectedUpgradePlan.id,
      p_amount: price,
      p_billing_period: upgradeCycle,
      p_reference: paymentRef || null,
      p_receipt_url: receiptUrl || null,
    });

    setSubmittingPayment(false);
    if (error || !(data as { success?: boolean })?.success) {
      show((data as { error?: string })?.error || error?.message || 'Payment submission failed', 'error');
      return;
    }

    show(
      isAr
        ? 'تم إرسال إشعار الدفع بنجاح! سيتم تفعيل الباقة فور مراجعة التحويل'
        : 'Payment proof submitted! Subscription will be activated upon review',
      'success'
    );
    setSelectedUpgradePlan(null);
    setPaymentRef('');
    setReceiptUrl('');
    void loadBranchSubData();
  };

  const SECTIONS: { key: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { key: 'branch_profile', label: isAr ? 'بيانات الفرع والطباعة' : 'Branch Profile & Receipts', icon: <Store className="w-4 h-4" /> },
    { key: 'branch_subscription', label: isAr ? 'اشتراك الفرع والترقية' : 'Branch Subscription', icon: <CreditCard className="w-4 h-4" /> },
    { key: 'branch_staff', label: isAr ? 'طاقم عمل الفرع' : 'Branch Staff', icon: <Users className="w-4 h-4" /> },
    { key: 'appearance', label: isAr ? 'المظهر والثيم' : 'Appearance & Theme', icon: <Palette className="w-4 h-4" /> },
    { key: 'language', label: isAr ? 'اللغة والتوطين' : 'Language', icon: <Languages className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-6">
      {/* Super Admin Notice Banner */}
      {isSuperAdmin && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-gradient-to-r from-brand-600/15 via-indigo-600/10 to-transparent border border-brand-500/30">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <p className="font-bold text-sm text-ui-text">
                {isAr ? 'أنت مسجل بصلاحية المدير العام (Super Admin)' : 'You are logged in as Super Admin'}
              </p>
              <p className="text-xs text-ui-subtle">
                {isAr
                  ? 'لإدارة كافة إعدادات المنشأة المركزية، المنظمات، الأسعار والاشتراكات، والصلاحيات الكاملة، تفضل بزيارة لوحة المدير العام'
                  : 'Manage master enterprise settings, tenant organizations, subscription pricing, and full RBAC matrix in the Super Admin hub'}
              </p>
            </div>
          </div>
          <Link to={APP_ROUTES.superAdmin}>
            <Button size="sm" className="whitespace-nowrap">
              <Sparkles className="w-4 h-4" />
              <span>{isAr ? 'لوحة تحكم المدير العام' : 'Super Admin Hub'}</span>
            </Button>
          </Link>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-ui-border pb-4">
        <div>
          <h1 className="text-2xl font-black text-ui-text tracking-tight">{t('settings')}</h1>
          <p className="text-xs text-ui-subtle mt-0.5">
            {isAr ? 'إدارة وتخصيص إعدادات الفرع، الإيصالات، المظهر، واشتراك المنشأة' : 'Manage branch configurations, receipts, appearance, and subscriptions'}
          </p>
        </div>

        {branches.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-ui-subtle">{isAr ? 'الفرع:' : 'Branch:'}</span>
            <div className="w-52">
              <Select
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {isAr ? b.name : b.name_en || b.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        )}
      </div>

      {/* Navigation and Content Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {/* Sidebar Tabs */}
        <div className="space-y-1 md:col-span-1">
          {SECTIONS.map((sec) => (
            <button
              key={sec.key}
              onClick={() => setActive(sec.key)}
              className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-semibold transition text-start ${
                active === sec.key
                  ? 'bg-brand-600 text-white shadow-sm shadow-brand-500/20'
                  : 'bg-ui-surface hover:bg-ui-page-alt text-ui-muted hover:text-ui-text border border-ui-border/50'
              }`}
            >
              {sec.icon}
              <span>{sec.label}</span>
            </button>
          ))}
        </div>

        {/* Tab Content Panel */}
        <div className="md:col-span-3 space-y-6">
          {/* TAB: Branch Profile & Receipts */}
          {active === 'branch_profile' && (
            <Card className="p-6 space-y-6">
              <div>
                <h2 className="text-lg font-bold text-ui-text">{isAr ? 'بيانات وطباعة إيصالات الفرع' : 'Branch Profile & Receipts'}</h2>
                <p className="text-xs text-ui-subtle">{isAr ? 'تخصيص الإيصالات والطباعة الحرارية الخاصة بهذا الفرع' : 'Customize receipt texts and thermal layout for this branch'}</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label={isAr ? 'شعار خاص بهذا الفرع (رابط صورة)' : 'Branch Logo Image URL'}
                  value={branchForm.logo_url || ''}
                  onChange={(e) => setBranchForm({ ...branchForm, logo_url: e.target.value })}
                  placeholder="https://..."
                />
                <Input
                  label={isAr ? 'نسبة الضريبة الخاصة بالفرع (%)' : 'Branch Tax Rate (%)'}
                  type="number"
                  step="0.1"
                  value={branchForm.tax_rate ?? ''}
                  onChange={(e) => setBranchForm({ ...branchForm, tax_rate: e.target.value ? Number(e.target.value) : null })}
                  placeholder={isAr ? 'اتركه فارغاً لاستخدام الافتراضي' : 'Leave empty to inherit'}
                />
                <div className="sm:col-span-2">
                  <Textarea
                    label={isAr ? 'ترويسة إيصال الفرع (Header)' : 'Branch Receipt Header'}
                    rows={2}
                    value={branchForm.receipt_header || ''}
                    onChange={(e) => setBranchForm({ ...branchForm, receipt_header: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Textarea
                    label={isAr ? 'تذييل إيصال الفرع (Footer)' : 'Branch Receipt Footer'}
                    rows={2}
                    value={branchForm.receipt_footer || ''}
                    onChange={(e) => setBranchForm({ ...branchForm, receipt_footer: e.target.value })}
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-ui-border flex justify-end">
                <Button onClick={saveBranchSpecific} disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>{isAr ? 'حفظ إعدادات الفرع' : 'Save Branch Profile'}</span>
                </Button>
              </div>
            </Card>
          )}

          {/* TAB: Branch Subscription */}
          {active === 'branch_subscription' && (
            <div className="space-y-6">
              {/* Current Status Card */}
              <Card className="p-6 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-ui-text">{isAr ? 'حالة اشتراك الفرع الحالي' : 'Branch Subscription Status'}</h2>
                    <p className="text-xs text-ui-subtle">{isAr ? 'تفاصيل الباقة والمميزات المتاحة لهذا الفرع' : 'Current tier and expiration details'}</p>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold ${
                      branchSubStatus?.status === 'active'
                        ? 'bg-ui-success-soft text-ui-success'
                        : branchSubStatus?.status === 'trial'
                        ? 'bg-ui-info-soft text-ui-info'
                        : 'bg-ui-danger-soft text-ui-danger'
                    }`}
                  >
                    {branchSubStatus?.status === 'active'
                      ? isAr ? 'اشتراك نشط' : 'Active Plan'
                      : branchSubStatus?.status === 'trial'
                      ? isAr ? 'فترة تجريبية' : 'Trial Mode'
                      : isAr ? 'منتهي / مطلوب التجديد' : 'Past Due / Expired'}
                  </span>
                </div>

                <div className="grid gap-4 sm:grid-cols-3 p-4 bg-ui-page rounded-2xl border border-ui-border">
                  <div>
                    <p className="text-xs text-ui-subtle">{isAr ? 'اسم الباقة:' : 'Current Plan:'}</p>
                    <p className="text-base font-bold text-ui-text">
                      {currentPlan
                        ? isAr ? currentPlan.name_ar : currentPlan.name_en || currentPlan.name_ar
                        : isAr ? 'الباقة الأساسية' : 'Standard'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-ui-subtle">{isAr ? 'تاريخ الانتهاء:' : 'Expires At:'}</p>
                    <p className="text-base font-bold text-ui-text">
                      {branchSubStatus?.current_period_ends_at ? formatDate(branchSubStatus.current_period_ends_at, lang) : '-'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-ui-subtle">{isAr ? 'الأيام المتبقية:' : 'Days Left:'}</p>
                    <p className="text-base font-bold text-brand-600">
                      {daysRemaining} {isAr ? 'يوم' : 'days'}
                    </p>
                  </div>
                </div>
              </Card>

              {/* Plans & Upgrade via InstaPay */}
              <Card className="p-6 space-y-4">
                <h3 className="text-base font-bold text-ui-text">{isAr ? 'ترقية أو تجديد الباقة عبر InstaPay' : 'Renew or Upgrade Plan via InstaPay'}</h3>

                {/* Gateway Instructions */}
                {gatewaySettings && (
                  <div className="p-4 rounded-2xl bg-brand-500/10 border border-brand-500/20 space-y-3">
                    <div className="flex items-center gap-2 font-bold text-brand-600 dark:text-brand-400">
                      <CreditCard className="w-5 h-5" />
                      <span>{isAr ? 'بيانات التحويل عبر InstaPay' : 'InstaPay Payment Details'}</span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 text-xs">
                      <div>
                        <span className="text-ui-subtle">{isAr ? 'معرّف أو رقم InstaPay:' : 'InstaPay ID:'} </span>
                        <span className="font-mono font-bold text-ui-text">{gatewaySettings.instapay_id || '-'}</span>
                      </div>
                      <div>
                        <span className="text-ui-subtle">{isAr ? 'اسم المستفيد:' : 'Beneficiary:'} </span>
                        <span className="font-bold text-ui-text">{gatewaySettings.beneficiary_name || '-'}</span>
                      </div>
                    </div>
                    {gatewaySettings.instructions_ar && (
                      <p className="text-xs text-ui-muted pt-2 border-t border-brand-500/20 whitespace-pre-line">
                        {isAr ? gatewaySettings.instructions_ar : gatewaySettings.instructions_en || gatewaySettings.instructions_ar}
                      </p>
                    )}
                  </div>
                )}

                {/* Plans Selection */}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {publicPlans.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => setSelectedUpgradePlan(p)}
                      className={`p-4 rounded-2xl border-2 cursor-pointer transition ${
                        selectedUpgradePlan?.id === p.id
                          ? 'border-brand-600 bg-brand-500/5'
                          : 'border-ui-border hover:border-ui-border/80'
                      }`}
                    >
                      <h4 className="font-bold text-ui-text">{isAr ? p.name_ar : p.name_en || p.name_ar}</h4>
                      <p className="text-xl font-black text-ui-text my-2">
                        {formatCurrency(p.monthly_price_egp, 'EGP', lang)} <span className="text-xs text-ui-subtle font-normal">/ {isAr ? 'شهر' : 'mo'}</span>
                      </p>
                      <p className="text-xs text-ui-subtle">
                        {isAr ? 'أو سنوي:' : 'Yearly:'} {formatCurrency(p.yearly_price_egp, 'EGP', lang)}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Submit Receipt Form */}
                {selectedUpgradePlan && (
                  <div className="p-4 rounded-2xl border border-ui-border bg-ui-page space-y-4 animate-fade-in">
                    <h4 className="font-bold text-sm text-ui-text">
                      {isAr ? `تأكيد طلب الاشتراك في باقة: ${selectedUpgradePlan.name_ar}` : `Submit Payment for: ${selectedUpgradePlan.name_en || selectedUpgradePlan.name_ar}`}
                    </h4>

                    <div className="flex gap-4 text-xs font-semibold">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="cycle"
                          checked={upgradeCycle === 'monthly'}
                          onChange={() => setUpgradeCycle('monthly')}
                        />
                        <span>{isAr ? `شهري (${selectedUpgradePlan.monthly_price_egp} ج.م)` : `Monthly (${selectedUpgradePlan.monthly_price_egp} EGP)`}</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="cycle"
                          checked={upgradeCycle === 'yearly'}
                          onChange={() => setUpgradeCycle('yearly')}
                        />
                        <span>{isAr ? `سنوي (${selectedUpgradePlan.yearly_price_egp} ج.م)` : `Yearly (${selectedUpgradePlan.yearly_price_egp} EGP)`}</span>
                      </label>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        label={isAr ? 'الرقم المرجعي للإشعار (Reference No.)' : 'Transaction Reference'}
                        value={paymentRef}
                        onChange={(e) => setPaymentRef(e.target.value)}
                        placeholder="e.g. 123456789"
                      />
                      <Input
                        label={isAr ? 'رابط صورة إيصال التحويل (Receipt URL)' : 'Receipt Image URL'}
                        value={receiptUrl}
                        onChange={(e) => setReceiptUrl(e.target.value)}
                        placeholder="https://..."
                      />
                    </div>

                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => setSelectedUpgradePlan(null)}>
                        {isAr ? 'إلغاء' : 'Cancel'}
                      </Button>
                      <Button size="sm" onClick={submitBranchPayment} disabled={submittingPayment}>
                        {submittingPayment ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        <span>{isAr ? 'إرسال إشعار الدفع' : 'Submit Proof'}</span>
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            </div>
          )}

          {/* TAB: Branch Staff */}
          {active === 'branch_staff' && (
            <Card className="p-6 space-y-4">
              <div>
                <h2 className="text-lg font-bold text-ui-text">{isAr ? 'طاقم عمل الفرع' : 'Branch Staff'}</h2>
                <p className="text-xs text-ui-subtle">{isAr ? 'الموظفون المعينون للعمل في هذا الفرع' : 'Team members assigned to this branch location'}</p>
              </div>

              {loadingStaff ? (
                <div className="flex justify-center p-8">
                  <Loader2 className="w-6 h-6 animate-spin text-brand-500" />
                </div>
              ) : branchStaff.length === 0 ? (
                <p className="text-sm text-ui-subtle italic py-4">{isAr ? 'لا يوجد موظفون مسجلون على هذا الفرع حالياً' : 'No staff assigned'}</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-ui-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-ui-border bg-ui-page-alt text-start">
                        <th className="p-3 font-semibold text-ui-subtle">{isAr ? 'الاسم' : 'Name'}</th>
                        <th className="p-3 font-semibold text-ui-subtle">{isAr ? 'البريد الإلكتروني' : 'Email'}</th>
                        <th className="p-3 font-semibold text-ui-subtle">{isAr ? 'الدور الوظيفي' : 'Role'}</th>
                        <th className="p-3 font-semibold text-ui-subtle">{isAr ? 'الحالة' : 'Status'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {branchStaff.map((s) => (
                        <tr key={s.id} className="border-b border-ui-border/50 hover:bg-ui-page-alt/50">
                          <td className="p-3 font-bold text-ui-text">{s.full_name || '-'}</td>
                          <td className="p-3 text-xs text-ui-subtle font-mono">{s.email}</td>
                          <td className="p-3">
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-brand-500/10 text-brand-600">
                              {s.role}
                            </span>
                          </td>
                          <td className="p-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                                s.is_active ? 'bg-ui-success-soft text-ui-success' : 'bg-ui-danger-soft text-ui-danger'
                              }`}
                            >
                              {s.is_active ? (isAr ? 'نشط' : 'Active') : (isAr ? 'معطل' : 'Disabled')}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {/* TAB: Appearance */}
          {active === 'appearance' && (
            <Card className="p-6 space-y-6">
              <div>
                <h2 className="text-lg font-bold text-ui-text">{isAr ? 'المظهر وسمات الواجهة' : 'Appearance & Themes'}</h2>
                <p className="text-xs text-ui-subtle">{isAr ? 'اختر السمة واللون المفضل لواجهة الاستخدام' : 'Select your preferred visual style and theme mode'}</p>
              </div>

              {/* Mode Toggle */}
              <div>
                <p className="text-xs font-bold text-ui-text mb-2">{isAr ? 'وضع الإضاءة:' : 'Theme Mode:'}</p>
                <div className="flex gap-2">
                  <Button
                    variant={theme === 'light' ? 'primary' : 'outline'}
                    size="sm"
                    onClick={() => setTheme('light')}
                  >
                    {isAr ? 'الوضع النهاري (Light)' : 'Light'}
                  </Button>
                  <Button
                    variant={theme === 'dark' ? 'primary' : 'outline'}
                    size="sm"
                    onClick={() => setTheme('dark')}
                  >
                    {isAr ? 'الوضع الليلي (Dark)' : 'Dark'}
                  </Button>
                </div>
              </div>

              {/* Curated Themes */}
              <div>
                <p className="text-xs font-bold text-ui-text mb-2">{isAr ? 'سمات الواجهة المصممة بعناية:' : 'Curated Themes:'}</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {UI_THEMES.map((th) => (
                    <button
                      key={th.key}
                      onClick={() => pickTheme(th.key)}
                      className="p-3 rounded-xl border border-ui-border bg-ui-page hover:border-brand-500/50 flex items-center justify-between text-start transition"
                    >
                      <span className="text-xs font-bold text-ui-text">{isAr ? th.ar : th.en}</span>
                      <span className="text-[10px] text-ui-subtle px-1.5 py-0.5 rounded bg-ui-surface">
                        {th.mode}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </Card>
          )}

          {/* TAB: Language */}
          {active === 'language' && (
            <Card className="p-6 space-y-4">
              <div>
                <h2 className="text-lg font-bold text-ui-text">{isAr ? 'لغة واجهة الاستخدام' : 'Language & Localization'}</h2>
                <p className="text-xs text-ui-subtle">{isAr ? 'اختر اللغة المفضلة للنظام' : 'Select interface language'}</p>
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  variant={lang === 'ar' ? 'primary' : 'outline'}
                  onClick={() => setLang('ar')}
                  className="w-32"
                >
                  العربية
                </Button>
                <Button
                  variant={lang === 'en' ? 'primary' : 'outline'}
                  onClick={() => setLang('en')}
                  className="w-32"
                >
                  English
                </Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
