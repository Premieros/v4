import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Activity,
  Building2,
  CheckCircle2,
  Edit2,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Store,
  Users,
  XCircle,
  UserPlus,
  Lock,
  Unlock,
  Sliders,
  History,
} from 'lucide-react';
import { supabase, admin } from '@/api';
import { seedComprehensiveDemoData } from '@/lib/comprehensiveDemoSeeder';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { useSettings } from '@/context/SettingsContext';
import { useBranches } from '@/hooks/useBranches';
import { DesignSurface } from '@/components/design/DesignSurface';
import { DesignSearch } from '@/components/design/DesignSearch';
import { Button } from '@/components/Button';
import { Card } from '@/components/PageHeader';
import { Input, Textarea, Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { RolesTab } from './RolesTab';
import { formatDate, formatDateTime } from '@/lib/format';

interface TenantStats {
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  is_active: boolean;
  created_at: string;
  branch_count: number;
  user_count: number;
  total_branches: number;
  active_branches: number;
}

interface TenantUser {
  user_id: string;
  email: string;
  username: string;
  full_name: string;
  role: string;
  is_active: boolean;
  branch_id: string | null;
  branch_name: string | null;
  org_id: string | null;
  org_name: string | null;
  created_at: string;
}

interface AuditLogRow {
  id: string;
  action: string;
  entity: string;
  user_email: string | null;
  created_at: string;
  details: unknown;
}

type SuperTab =
  | 'tenants'
  | 'system_controls'
  | 'general'
  | 'branches_override'
  | 'roles'
  | 'users_audit'
  | 'health';

interface SuperAdminConsoleProps {
  defaultTab?: SuperTab;
}

export function SuperAdminConsolePage({ defaultTab }: SuperAdminConsoleProps = {}) {
  const [searchParams] = useSearchParams();
  const { lang } = useLanguage();
  const { show } = useToast();
  const ar = lang === 'ar';
  const { settings, branchSettingsMap, save, saveBranchSettings } = useSettings();
  const { branches } = useBranches();

  const queryTab = searchParams.get('tab') as SuperTab | null;

  const [activeTab, setActiveTab] = useState<SuperTab>(defaultTab || queryTab || 'tenants');

  // Tenants state
  const [tenants, setTenants] = useState<TenantStats[]>([]);
  const [loadingTenants, setLoadingTenants] = useState(false);

  // System Controls state (Allow New User Creation)
  const [allowNewUserCreation, setAllowNewUserCreation] = useState<boolean>(true);
  const [loadingUserCreationToggle, setLoadingUserCreationToggle] = useState<boolean>(false);
  const [userCreationAudit, setUserCreationAudit] = useState<AuditLogRow[]>([]);

  // Enterprise Store Settings state
  const [generalForm, setGeneralForm] = useState<Record<string, string | number | null | undefined>>({});
  const [savingGeneral, setSavingGeneral] = useState(false);

  // Branch Specific Customizations state
  const [targetBranchId, setTargetBranchId] = useState<string>(branches[0]?.id || '');
  const [branchForm, setBranchForm] = useState<Record<string, string | number | null | undefined>>({});
  const [savingBranchCustom, setSavingBranchCustom] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoConfirmOpen, setDemoConfirmOpen] = useState(false);

  // Users & Audit Log state
  const [userAuditSubTab, setUserAuditSubTab] = useState<'users' | 'audit'>('users');
  const [allUsers, setAllUsers] = useState<TenantUser[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [loadingUsersAudit, setLoadingUsersAudit] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [auditSearch, setAuditSearch] = useState('');
  const [editingUser, setEditingUser] = useState<TenantUser | null>(null);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [savingUser, setSavingUser] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  // Diagnostics & Health state
  const [healthStatus, setHealthStatus] = useState<Record<string, { ok: boolean; message: string }> | null>(null);
  const [healthRunning, setHealthRunning] = useState(false);

  // ─────────────────────────────────────────────────────────────
  // 1. Load System Settings & User Creation Controls
  // ─────────────────────────────────────────────────────────────
  const loadSystemControls = useCallback(async () => {
    try {
      const { data } = await admin.canCreateNewUser();
      if (data && typeof data.allowed === 'boolean') {
        setAllowNewUserCreation(data.allowed);
      } else {
        const { data: sData } = await supabase.from('system_settings').select('config').eq('id', 1).maybeSingle();
        if (sData?.config?.security && typeof sData.config.security.allow_new_user_creation === 'boolean') {
          setAllowNewUserCreation(sData.config.security.allow_new_user_creation);
        }
      }

      // Fetch audit logs for user creation toggle
      const { data: aData } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('action', 'TOGGLE_ALLOW_NEW_USER_CREATION')
        .order('created_at', { ascending: false })
        .limit(20);

      if (aData) {
        setUserCreationAudit(aData as AuditLogRow[]);
      }
    } catch (err) {
      console.warn('Failed to load system controls:', err);
    }
  }, []);

  const handleToggleUserCreation = async (nextAllowed: boolean) => {
    setLoadingUserCreationToggle(true);
    try {
      const { data, error } = await admin.toggleUserCreationSetting(nextAllowed);
      if (error || (data && !data.success)) {
        show(data?.message || (ar ? 'فشل تعديل إعداد إنشاء المستخدمين' : 'Failed to update user creation setting'), 'error');
        return;
      }
      setAllowNewUserCreation(nextAllowed);
      show(
        nextAllowed
          ? (ar ? 'تم تفعيل السماح بإنشاء المستخدمين الجدد بنجاح' : 'New user creation has been ENABLED')
          : (ar ? 'تم إيقاف إنشاء المستخدمين الجدد بنجاح' : 'New user creation has been DISABLED'),
        'success'
      );
      void loadSystemControls();
    } catch {
      show(ar ? 'حدث خطأ غير متوقع أثناء الحفظ' : 'Unexpected error saving setting', 'error');
    } finally {
      setLoadingUserCreationToggle(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // 2. Load Tenants & Organizations
  // ─────────────────────────────────────────────────────────────
  const loadTenants = useCallback(async () => {
    setLoadingTenants(true);
    try {
      const [orgsRes, brRes, memRes] = await Promise.all([
        supabase.from('organizations').select('*').order('created_at', { ascending: false }),
        supabase.from('branches').select('id, name, is_active, organization_id'),
        supabase.from('organization_members').select('organization_id, user_id, is_active'),
      ]);

      const orgs = orgsRes.data || [];
      const brs = brRes.data || [];
      const mems = memRes.data || [];

      const stats: TenantStats[] = orgs.map((o) => {
        const orgBranches = brs.filter((b) => b.organization_id === o.id);
        const orgMembers = mems.filter((m) => m.organization_id === o.id && m.is_active);

        return {
          organization_id: o.id,
          organization_name: o.name,
          organization_slug: o.slug,
          is_active: o.is_active ?? true,
          created_at: o.created_at,
          branch_count: orgBranches.length,
          user_count: orgMembers.length,
          total_branches: orgBranches.length,
          active_branches: orgBranches.filter((b) => b.is_active).length,
        };
      });

      setTenants(stats);
    } catch {
      // Ignored
    } finally {
      setLoadingTenants(false);
    }
  }, []);

  // ─────────────────────────────────────────────────────────────
  // 3. Load Users & Audit Logs
  // ─────────────────────────────────────────────────────────────
  const loadUsersAndAudit = useCallback(async () => {
    setLoadingUsersAudit(true);
    try {
      const [uRes, aRes, bRes, oRes, mRes] = await Promise.all([
        supabase.from('users').select('id, email, username, full_name, role, is_active, branch_id, created_at').order('created_at', { ascending: false }),
        supabase.from('audit_log').select('id, action, entity, user_email, created_at, details').order('created_at', { ascending: false }).limit(100),
        supabase.from('branches').select('id, name, organization_id'),
        supabase.from('organizations').select('id, name'),
        supabase.from('organization_members').select('user_id, organization_id').eq('is_active', true),
      ]);

      const branchMap = new Map((bRes.data || []).map((b) => [b.id, b]));
      const orgMap = new Map((oRes.data || []).map((o) => [o.id, o]));
      const memberMap = new Map((mRes.data || []).map((m) => [m.user_id, m.organization_id]));

      const computedUsers: TenantUser[] = (uRes.data || []).map((u) => {
        const branch = u.branch_id ? branchMap.get(u.branch_id) : undefined;
        const orgId = memberMap.get(u.id) || branch?.organization_id || null;
        const org = orgId ? orgMap.get(orgId) : undefined;
        return {
          user_id: u.id,
          email: u.email || '',
          username: u.username || '',
          full_name: u.full_name || '',
          role: u.role || 'cashier',
          is_active: u.is_active ?? true,
          branch_id: u.branch_id || null,
          branch_name: branch?.name || null,
          org_id: orgId,
          org_name: org?.name || null,
          created_at: u.created_at || new Date().toISOString(),
        };
      });

      setAllUsers(computedUsers);
      setAuditLogs((aRes.data || []) as AuditLogRow[]);
    } catch {
      // Ignored
    } finally {
      setLoadingUsersAudit(false);
    }
  }, []);

  // ─────────────────────────────────────────────────────────────
  // 4. Initial Settings Hydration
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (settings) {
      setGeneralForm({
        store_name: settings.store_name || '',
        store_address: settings.store_address || '',
        store_phone: settings.store_phone || '',
        logo_url: settings.logo_url || '',
        currency: settings.currency || 'EGP',
        tax_rate: settings.tax_rate ?? 14,
        tax_enabled: settings.tax_enabled ? '1' : '0',
        receipt_width_mm: settings.receipt_width_mm || 80,
        receipt_copies: settings.receipt_copies || 1,
        receipt_show_tax: settings.receipt_show_tax ? 1 : 0,
        receipt_show_qr: settings.receipt_show_qr ? 1 : 0,
        receipt_auto_print: settings.receipt_auto_print ? 1 : 0,
        receipt_header: settings.receipt_header || '',
        receipt_footer: settings.receipt_footer || '',
        pos_default_payment_method: settings.pos_default_payment_method || 'cash',
        pos_barcode_autofocus: settings.pos_barcode_autofocus ? 1 : 0,
        low_stock_threshold: settings.low_stock_threshold ?? 5,
      });
    }
  }, [settings]);

  useEffect(() => {
    if (targetBranchId) {
      const row = branchSettingsMap[targetBranchId] || null;
      setBranchForm({
        receipt_header: row?.receipt_header ?? '',
        receipt_footer: row?.receipt_footer ?? '',
        logo_url: row?.logo_url ?? '',
        tax_rate: row?.tax_rate ?? null,
        tax_enabled: row?.tax_enabled != null ? (row.tax_enabled ? '1' : '0') : null,
        currency: row?.currency ?? '',
        low_stock_threshold: row?.low_stock_threshold ?? null,
      });
    }
  }, [targetBranchId, branchSettingsMap]);

  // Tab change trigger
  useEffect(() => {
    if (activeTab === 'tenants') void loadTenants();
    if (activeTab === 'system_controls') void loadSystemControls();
    if (activeTab === 'users_audit') void loadUsersAndAudit();
  }, [activeTab, loadTenants, loadSystemControls, loadUsersAndAudit]);

  // ─────────────────────────────────────────────────────────────
  // 5. Actions Handlers
  // ─────────────────────────────────────────────────────────────
  const toggleOrgStatus = async (orgId: string, currentActive: boolean) => {
    try {
      const { error } = await supabase.from('organizations').update({ is_active: !currentActive }).eq('id', orgId);
      if (error) throw error;
      show(ar ? 'تم تحديث حالة المنظمة بنجاح' : 'Organization status updated', 'success');
      void loadTenants();
    } catch {
      show(ar ? 'فشل تحديث حالة المنظمة' : 'Failed to update organization status', 'error');
    }
  };

  const handleSaveGeneral = async () => {
    setSavingGeneral(true);
    try {
      await save({
        store_name: String(generalForm.store_name || ''),
        store_address: String(generalForm.store_address || ''),
        store_phone: String(generalForm.store_phone || ''),
        logo_url: String(generalForm.logo_url || ''),
        currency: String(generalForm.currency || 'EGP'),
        tax_rate: Number(generalForm.tax_rate) || 0,
        tax_enabled: generalForm.tax_enabled === '1',
        receipt_width_mm: Number(generalForm.receipt_width_mm) || 80,
        receipt_copies: Number(generalForm.receipt_copies) || 1,
        receipt_show_tax: Boolean(generalForm.receipt_show_tax),
        receipt_show_qr: Boolean(generalForm.receipt_show_qr),
        receipt_auto_print: Boolean(generalForm.receipt_auto_print),
        receipt_header: String(generalForm.receipt_header || ''),
        receipt_footer: String(generalForm.receipt_footer || ''),
        pos_default_payment_method: String(generalForm.pos_default_payment_method || 'cash'),
        pos_barcode_autofocus: Boolean(generalForm.pos_barcode_autofocus),
        low_stock_threshold: Number(generalForm.low_stock_threshold) || 5,
      });
      show(ar ? 'تم حفظ الإعدادات المركزية بنجاح' : 'Enterprise settings saved', 'success');
    } catch {
      show(ar ? 'فشل حفظ الإعدادات المركزية' : 'Failed to save enterprise settings', 'error');
    } finally {
      setSavingGeneral(false);
    }
  };

  const handleSaveBranchCustom = async () => {
    if (!targetBranchId) return;
    setSavingBranchCustom(true);
    try {
      await saveBranchSettings(targetBranchId, {
        receipt_header: branchForm.receipt_header ? String(branchForm.receipt_header) : null,
        receipt_footer: branchForm.receipt_footer ? String(branchForm.receipt_footer) : null,
        logo_url: branchForm.logo_url ? String(branchForm.logo_url) : null,
        currency: branchForm.currency ? String(branchForm.currency) : null,
        tax_rate: branchForm.tax_rate != null ? Number(branchForm.tax_rate) : null,
        tax_enabled: branchForm.tax_enabled != null ? branchForm.tax_enabled === '1' : null,
        low_stock_threshold: branchForm.low_stock_threshold != null ? Number(branchForm.low_stock_threshold) : null,
      });
      show(ar ? 'تم حفظ تخصيصات الفرع بنجاح' : 'Branch customization saved', 'success');
    } catch {
      show(ar ? 'فشل حفظ تخصيصات الفرع' : 'Failed to save branch customizations', 'error');
    } finally {
      setSavingBranchCustom(false);
    }
  };

  const handleSeedBranchDemo = async () => {
    if (!targetBranchId) return;
    setDemoBusy(true);
    try {
      await seedComprehensiveDemoData(targetBranchId);
      await admin.seedAllDemoData({ p_branch_id: targetBranchId });
      show(ar ? 'تم توليد باقة بيانات تجريبية كاملة بنجاح (منتجات، وصفات، مواد خام، طاولات)' : 'Branch demo data populated successfully', 'success');
      setDemoConfirmOpen(false);
    } catch {
      show(ar ? 'حدث خطأ أثناء توليد البيانات' : 'Error generating demo data', 'error');
    } finally {
      setDemoBusy(false);
    }
  };

  const handleUpdateUser = async () => {
    if (!editingUser) return;
    setSavingUser(true);
    try {
      const { error } = await supabase
        .from('users')
        .update({
          full_name: editingUser.full_name,
          role: editingUser.role,
          is_active: editingUser.is_active,
          branch_id: editingUser.branch_id,
        })
        .eq('id', editingUser.user_id);

      if (error) throw error;

      if (newPassword.trim()) {
        await admin.updateUserPassword({
          p_user_id: editingUser.user_id,
          p_new_password: newPassword.trim(),
        });
      }

      show(ar ? 'تم تحديث بيانات المستخدم بنجاح' : 'User updated successfully', 'success');
      setUserModalOpen(false);
      void loadUsersAndAudit();
    } catch {
      show(ar ? 'فشل تحديث بيانات المستخدم' : 'Failed to update user', 'error');
    } finally {
      setSavingUser(false);
    }
  };

  const runHealthChecks = async () => {
    setHealthRunning(true);
    const checks: Record<string, { ok: boolean; message: string }> = {};

    try {
      const dbCheck = await supabase.from('users').select('id', { count: 'exact', head: true });
      checks['database'] = {
        ok: !dbCheck.error,
        message: dbCheck.error ? dbCheck.error.message : ar ? 'اتصال قاعدة البيانات نشط وسليم' : 'Database connection healthy',
      };
    } catch (e) {
      checks['database'] = { ok: false, message: String(e) };
    }

    try {
      const authUser = (await supabase.auth.getUser()).data.user;
      checks['auth'] = {
        ok: !!authUser,
        message: authUser ? `${ar ? 'المستخدم المصادق:' : 'Authenticated as:'} ${authUser.email}` : ar ? 'لا توجد جلسة نشطة' : 'No active session',
      };
    } catch (e) {
      checks['auth'] = { ok: false, message: String(e) };
    }

    try {
      const sysRes = await supabase.from('system_settings').select('id').limit(1);
      checks['system_settings'] = {
        ok: !sysRes.error,
        message: sysRes.error ? sysRes.error.message : ar ? 'جدول الإعدادات العامة متاح' : 'System settings accessible',
      };
    } catch (e) {
      checks['system_settings'] = { ok: false, message: String(e) };
    }

    setHealthStatus(checks);
    setHealthRunning(false);
  };

  const TABS: { key: SuperTab; label: string; icon: React.ReactNode }[] = [
    { key: 'tenants', label: ar ? 'المستأجرون والمنظمات' : 'Tenants & Organizations', icon: <Building2 className="w-4 h-4" /> },
    { key: 'system_controls', label: ar ? 'التحكم في النظام ومستخدمي المنصة' : 'System Controls & Users', icon: <Sliders className="w-4 h-4" /> },
    { key: 'general', label: ar ? 'إعدادات المنشأة والمتجر المركزية' : 'Enterprise Settings', icon: <Store className="w-4 h-4" /> },
    { key: 'branches_override', label: ar ? 'تخصيصات الفروع والبيانات التجريبية' : 'Branch Overrides & Demo', icon: <SlidersHorizontal className="w-4 h-4" /> },
    { key: 'roles', label: ar ? 'مصفوفة الأدوار والصلاحيات' : 'RBAC Roles & Matrix', icon: <ShieldCheck className="w-4 h-4" /> },
    { key: 'users_audit', label: ar ? 'المستخدمون وسجل التدقيق' : 'Users & Audit Log', icon: <Users className="w-4 h-4" /> },
    { key: 'health', label: ar ? 'صحة وتشخيص النظام' : 'System Diagnostics', icon: <Activity className="w-4 h-4" /> },
  ];

  const tenantStats = {
    totalTenants: tenants.length,
    activeTenants: tenants.filter((t) => t.is_active).length,
    totalBranches: tenants.reduce((sum, t) => sum + (t.total_branches ?? 0), 0),
    totalUsers: tenants.reduce((sum, t) => sum + (t.user_count ?? 0), 0),
  };

  return (
    <DesignSurface testId="super-admin-master-hub">
      {/* ── Main Top Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-ui-border pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-indigo-700 text-white shadow-md shadow-brand-500/20">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black tracking-tight text-ui-text sm:text-2xl">
                {ar ? 'لوحة تحكم المدير العام (Super Admin)' : 'Super Admin Command Center'}
              </h1>
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-500/10 px-2.5 py-0.5 text-xs font-bold text-brand-600 dark:text-brand-400">
                <Sparkles className="h-3 w-3" />
                {ar ? 'مدير النظام الكامل' : 'Full Control'}
              </span>
            </div>
            <p className="text-xs text-ui-subtle">
              {ar
                ? 'مركز إدارة جميع المنظمات، التحكم المركزي في إنشاء المستخدمين، الإعدادات العامة، الصلاحيات، وسجل التدقيق'
                : 'Centralized master hub for tenants, user registration controls, enterprise settings, permissions, and audit logs'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (activeTab === 'tenants') void loadTenants();
              if (activeTab === 'system_controls') void loadSystemControls();
              if (activeTab === 'users_audit') void loadUsersAndAudit();
              if (activeTab === 'health') void runHealthChecks();
            }}
          >
            <RefreshCw className={`w-4 h-4 ${loadingTenants || loadingUsersAudit || healthRunning ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{ar ? 'تحديث البيانات' : 'Refresh'}</span>
          </Button>
        </div>
      </div>

      {/* ── Master Tabs Bar ── */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 border-b border-ui-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap ${
              activeTab === t.key
                ? 'bg-brand-600 text-white shadow-sm shadow-brand-500/25'
                : 'bg-ui-page-alt text-ui-muted hover:bg-ui-border/50 hover:text-ui-text'
            }`}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* TAB 1: المستأجرون والمنظمات (Tenants)                          */}
      {/* ───────────────────────────────────────────────────────────── */}
      {activeTab === 'tenants' && (
        <div className="space-y-5 animate-fade-in">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: ar ? 'إجمالي المنظمات' : 'Total Tenants', value: tenantStats.totalTenants, icon: <Building2 className="w-5 h-5 text-brand-500" /> },
              { label: ar ? 'المنظمات النشطة' : 'Active Tenants', value: tenantStats.activeTenants, icon: <CheckCircle2 className="w-5 h-5 text-ui-success" /> },
              { label: ar ? 'إجمالي الفروع' : 'Total Branches', value: tenantStats.totalBranches, icon: <Store className="w-5 h-5 text-blue-500" /> },
              { label: ar ? 'إجمالي المستخدمين' : 'Total Users', value: tenantStats.totalUsers, icon: <Users className="w-5 h-5 text-purple-500" /> },
            ].map((st, i) => (
              <Card key={i} className="p-4 flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-ui-page-alt shrink-0">{st.icon}</div>
                <div>
                  <p className="text-xs text-ui-subtle">{st.label}</p>
                  <p className="text-xl font-black text-ui-text">{st.value}</p>
                </div>
              </Card>
            ))}
          </div>

          <Card className="overflow-hidden">
            <div className="p-4 border-b border-ui-border flex justify-between items-center">
              <div>
                <h3 className="text-base font-bold text-ui-text">{ar ? 'سجل المنظمات والمتاجر' : 'Organizations Directory'}</h3>
                <p className="text-xs text-ui-subtle">{ar ? 'قائمة بجميع المستأجرين والشركات المسجلة في النظام' : 'Manage multi-tenant accounts and their branch quotas'}</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm text-start">
                <thead className="bg-ui-page-alt border-b border-ui-border text-ui-muted">
                  <tr>
                    <th className="p-3 font-semibold text-start">{ar ? 'اسم المنظمة' : 'Organization'}</th>
                    <th className="p-3 font-semibold text-start">{ar ? 'الرمز (Slug)' : 'Slug'}</th>
                    <th className="p-3 font-semibold text-center">{ar ? 'عدد الفروع' : 'Branches'}</th>
                    <th className="p-3 font-semibold text-center">{ar ? 'المستخدمين' : 'Users'}</th>
                    <th className="p-3 font-semibold text-center">{ar ? 'الحالة' : 'Status'}</th>
                    <th className="p-3 font-semibold text-center">{ar ? 'تاريخ الإنشاء' : 'Created'}</th>
                    <th className="p-3 font-semibold text-end">{ar ? 'الإجراءات' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ui-border">
                  {tenants.map((t) => (
                    <tr key={t.organization_id} className="hover:bg-ui-page-alt/50 transition">
                      <td className="p-3 font-bold text-ui-text">{t.organization_name}</td>
                      <td className="p-3 font-mono text-ui-subtle">{t.organization_slug}</td>
                      <td className="p-3 text-center font-medium">{t.branch_count}</td>
                      <td className="p-3 text-center font-medium">{t.user_count}</td>
                      <td className="p-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${t.is_active ? 'bg-ui-success-soft text-ui-success' : 'bg-ui-danger-soft text-ui-danger'}`}>
                          {t.is_active ? (ar ? 'نشط' : 'Active') : (ar ? 'معطل' : 'Disabled')}
                        </span>
                      </td>
                      <td className="p-3 text-center text-ui-subtle">{formatDate(t.created_at, lang)}</td>
                      <td className="p-3 text-end">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void toggleOrgStatus(t.organization_id, t.is_active)}
                        >
                          {t.is_active ? (ar ? 'تعطيل' : 'Disable') : (ar ? 'تفعيل' : 'Enable')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* TAB 2: التحكم في النظام ومستخدمي المنصة (System Controls)      */}
      {/* ───────────────────────────────────────────────────────────── */}
      {activeTab === 'system_controls' && (
        <div className="space-y-6 max-w-4xl animate-fade-in">
          {/* User Registration Master Toggle */}
          <Card className="p-6 space-y-6 border-2 border-brand-500/20">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-ui-border">
              <div className="flex items-start gap-3">
                <div className="p-3 rounded-2xl bg-brand-500/10 text-brand-600 shrink-0 mt-1">
                  <UserPlus className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-ui-text">
                    {ar ? 'التحكم في إنشاء وتسجيل المستخدمين الجدد' : 'User Registration & Account Creation'}
                  </h3>
                  <p className="text-xs text-ui-subtle mt-1 max-w-xl">
                    {ar
                      ? 'مفتاح التحكم المركزي لسوبر أدمن لمنع أو السماح بإنشاء حسابات مستخدمين ومستأجرين جدد على مستوى المنصة بالكامل.'
                      : 'Master toggle to globally allow or block new tenant registrations and user creation across the entire platform.'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                    allowNewUserCreation
                      ? 'bg-ui-success-soft text-ui-success'
                      : 'bg-ui-danger-soft text-ui-danger'
                  }`}
                >
                  {allowNewUserCreation ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                  {allowNewUserCreation
                    ? (ar ? 'مفعّل (يُسمح بالتسجيل)' : 'ENABLED')
                    : (ar ? 'معطّل (يُمنع التسجيل)' : 'DISABLED')}
                </span>

                <Button
                  size="sm"
                  variant={allowNewUserCreation ? 'danger' : 'primary'}
                  disabled={loadingUserCreationToggle}
                  onClick={() => void handleToggleUserCreation(!allowNewUserCreation)}
                  className="min-w-[130px]"
                >
                  {loadingUserCreationToggle ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : allowNewUserCreation ? (
                    <>
                      <Lock className="w-4 h-4" />
                      <span>{ar ? 'إيقاف التسجيل' : 'Disable Creation'}</span>
                    </>
                  ) : (
                    <>
                      <Unlock className="w-4 h-4" />
                      <span>{ar ? 'تفعيل التسجيل' : 'Enable Creation'}</span>
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Explanatory Cards */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="p-4 rounded-2xl bg-ui-page-alt border border-ui-border">
                <div className="flex items-center gap-2 font-bold text-ui-text text-sm">
                  <ShieldCheck className="w-4 h-4 text-ui-success" />
                  <span>{ar ? 'حالة التفعيل (ON)' : 'When Enabled (ON)'}</span>
                </div>
                <p className="text-xs text-ui-subtle mt-2 leading-relaxed">
                  {ar
                    ? 'يستطيع الزوار وأصحاب المتاجر الجدد التسجيل من صفحة إنشاء الحساب /register، ويستطيع مدراء الفروع إضافة موظفين جدد وفقاً لصلاحياتهم.'
                    : 'New tenants can freely sign up on the registration page, and branch managers can invite staff according to their role permissions.'}
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-ui-page-alt border border-ui-border">
                <div className="flex items-center gap-2 font-bold text-ui-text text-sm">
                  <ShieldAlert className="w-4 h-4 text-ui-danger" />
                  <span>{ar ? 'حالة الإيقاف (OFF)' : 'When Disabled (OFF)'}</span>
                </div>
                <p className="text-xs text-ui-subtle mt-2 leading-relaxed">
                  {ar
                    ? 'يتم حظر جميع عمليات تسجيل الحسابات الجديدة فورياً على مستوى الخادم وقاعدة البيانات مع إظهار رسالة واضحة للمستخدم. فقط Super Admin يمكنه إدارة الحسابات.'
                    : 'All registration attempts are blocked immediately at the database level with a clear notice. Only Super Admins retain access to manage accounts.'}
                </p>
              </div>
            </div>

            {/* Audit History of Toggle */}
            {userCreationAudit.length > 0 && (
              <div className="pt-4 border-t border-ui-border space-y-3">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-ui-subtle" />
                  <h4 className="text-xs font-bold text-ui-text uppercase tracking-wider">
                    {ar ? 'سجل تغييرات حالة التسجيل' : 'Registration Toggle Audit Log'}
                  </h4>
                </div>

                <div className="divide-y divide-ui-border border border-ui-border rounded-xl overflow-hidden text-xs">
                  {userCreationAudit.map((log) => {
                    const details = (log.details as Record<string, unknown>) || {};
                    const isNewTrue = details.new_value === true;
                    return (
                      <div key={log.id} className="p-3 bg-ui-surface flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              isNewTrue ? 'bg-ui-success' : 'bg-ui-danger'
                            }`}
                          />
                          <span className="font-semibold text-ui-text">
                            {isNewTrue
                              ? (ar ? 'تم تفعيل إنشاء المستخدمين' : 'Enabled User Creation')
                              : (ar ? 'تم إيقاف إنشاء المستخدمين' : 'Disabled User Creation')}
                          </span>
                        </div>
                        <span className="text-ui-subtle font-mono">{formatDateTime(log.created_at, lang)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* TAB 3: إعدادات المنشأة والمتجر المركزية (Global Settings)     */}
      {/* ───────────────────────────────────────────────────────────── */}
      {activeTab === 'general' && (
        <div className="space-y-5 max-w-4xl animate-fade-in">
          <Card className="p-6 space-y-6">
            <div>
              <h3 className="text-lg font-black text-ui-text">{ar ? 'بيانات المنشأة والمقر الرئيسي' : 'Master Enterprise Information'}</h3>
              <p className="text-xs text-ui-subtle">{ar ? 'الإعدادات العامة الافتراضية المطبقة على النظام بالكامل' : 'Global defaults applied across all modules and branches'}</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label={ar ? 'اسم المتجر / المنشأة' : 'Store / Company Name'}
                value={generalForm.store_name || ''}
                onChange={(e) => setGeneralForm({ ...generalForm, store_name: e.target.value })}
              />
              <Input
                label={ar ? 'رقم الهاتف الرئيسي' : 'Main Contact Phone'}
                value={generalForm.store_phone || ''}
                onChange={(e) => setGeneralForm({ ...generalForm, store_phone: e.target.value })}
              />
              <div className="sm:col-span-2">
                <Input
                  label={ar ? 'عنوان المقر الرئيسي' : 'Headquarters Address'}
                  value={generalForm.store_address || ''}
                  onChange={(e) => setGeneralForm({ ...generalForm, store_address: e.target.value })}
                />
              </div>
              <Input
                label={ar ? 'رابط شعار المنشأة (Image URL)' : 'Logo Image URL'}
                value={generalForm.logo_url || ''}
                onChange={(e) => setGeneralForm({ ...generalForm, logo_url: e.target.value })}
                placeholder="https://..."
              />
              <Input
                label={ar ? 'العملة الافتراضية' : 'Default Currency'}
                value={generalForm.currency || ''}
                onChange={(e) => setGeneralForm({ ...generalForm, currency: e.target.value })}
              />
            </div>

            <div className="pt-4 border-t border-ui-border">
              <h4 className="font-bold text-ui-text mb-3">{ar ? 'إعدادات نقطة البيع والضريبة' : 'POS & Tax Configuration'}</h4>
              <div className="grid gap-4 sm:grid-cols-3">
                <Select
                  label={ar ? 'طريقة الدفع الافتراضية' : 'Default Payment Method'}
                  value={generalForm.pos_default_payment_method || 'cash'}
                  onChange={(e) => setGeneralForm({ ...generalForm, pos_default_payment_method: e.target.value })}
                  options={[
                    { value: 'cash', label: ar ? 'نقدي (Cash)' : 'Cash' },
                    { value: 'card', label: ar ? 'بطاقة (Card)' : 'Card' },
                    { value: 'transfer', label: ar ? 'تحويل بنكي / InstaPay' : 'Transfer' },
                    { value: 'credit', label: ar ? 'آجل (Credit)' : 'Credit' },
                  ]}
                />
                <Input
                  label={ar ? 'نسبة الضريبة (%)' : 'Tax Rate (%)'}
                  type="number"
                  step="0.1"
                  value={generalForm.tax_rate ?? 14}
                  onChange={(e) => setGeneralForm({ ...generalForm, tax_rate: parseFloat(e.target.value) || 0 })}
                />
                <Select
                  label={ar ? 'تفعيل الضريبة' : 'Tax Status'}
                  value={generalForm.tax_enabled || '1'}
                  onChange={(e) => setGeneralForm({ ...generalForm, tax_enabled: e.target.value })}
                  options={[
                    { value: '1', label: ar ? 'مفعلة' : 'Enabled' },
                    { value: '0', label: ar ? 'معطلة' : 'Disabled' },
                  ]}
                />
              </div>
            </div>

            <div className="pt-4 border-t border-ui-border">
              <h4 className="font-bold text-ui-text mb-3">{ar ? 'إعدادات الفاتورة والطباعة' : 'Receipt & Printer Defaults'}</h4>
              <div className="grid gap-4 sm:grid-cols-2">
                <Textarea
                  label={ar ? 'ترويسة الفاتورة' : 'Receipt Header'}
                  value={generalForm.receipt_header || ''}
                  onChange={(e) => setGeneralForm({ ...generalForm, receipt_header: e.target.value })}
                  rows={2}
                />
                <Textarea
                  label={ar ? 'تذييل الفاتورة' : 'Receipt Footer'}
                  value={generalForm.receipt_footer || ''}
                  onChange={(e) => setGeneralForm({ ...generalForm, receipt_footer: e.target.value })}
                  rows={2}
                />
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t border-ui-border">
              <Button onClick={() => void handleSaveGeneral()} disabled={savingGeneral}>
                {savingGeneral ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                <span>{ar ? 'حفظ الإعدادات المركزية' : 'Save Enterprise Settings'}</span>
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* TAB 4: تخصيصات الفروع والبيانات التجريبية                     */}
      {/* ───────────────────────────────────────────────────────────── */}
      {activeTab === 'branches_override' && (
        <div className="space-y-5 max-w-4xl animate-fade-in">
          <Card className="p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-ui-border">
              <div>
                <h3 className="text-lg font-black text-ui-text">{ar ? 'تخصيصات الفرع المحدد' : 'Branch Specific Settings'}</h3>
                <p className="text-xs text-ui-subtle">{ar ? 'تجاوز الإعدادات العامة لفرع معين (مثل شعار مخصص أو ترويسة فاتورة مختلفة)' : 'Override general settings for a specific branch'}</p>
              </div>

              <div className="w-64">
                <Select
                  label={ar ? 'اختر الفرع المراد تخصيصه' : 'Select Branch'}
                  value={targetBranchId}
                  onChange={(e) => setTargetBranchId(e.target.value)}
                  options={branches.map((b) => ({ value: b.id, label: b.name }))}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label={ar ? 'رابط شعار مخصص للفرع' : 'Custom Branch Logo URL'}
                value={branchForm.logo_url || ''}
                onChange={(e) => setBranchForm({ ...branchForm, logo_url: e.target.value })}
                placeholder="https://..."
              />
              <Input
                label={ar ? 'العملة الخاصة بالفرع' : 'Branch Currency'}
                value={branchForm.currency || ''}
                onChange={(e) => setBranchForm({ ...branchForm, currency: e.target.value })}
              />
              <Textarea
                label={ar ? 'ترويسة فاتورة الفرع' : 'Branch Receipt Header'}
                value={branchForm.receipt_header || ''}
                onChange={(e) => setBranchForm({ ...branchForm, receipt_header: e.target.value })}
                rows={2}
              />
              <Textarea
                label={ar ? 'تذييل فاتورة الفرع' : 'Branch Receipt Footer'}
                value={branchForm.receipt_footer || ''}
                onChange={(e) => setBranchForm({ ...branchForm, receipt_footer: e.target.value })}
                rows={2}
              />
            </div>

            <div className="flex justify-between items-center pt-4 border-t border-ui-border">
              <Button
                variant="outline"
                className="text-brand-600 border-brand-500/30 hover:bg-brand-500/10"
                onClick={() => setDemoConfirmOpen(true)}
                disabled={demoBusy}
              >
                {demoBusy ? <Loader2 className="w-4 h-4 animate-spin text-brand-500" /> : <Sparkles className="w-4 h-4 text-brand-500" />}
                <span>{ar ? 'توليد بيانات تجريبية كاملة لهذا الفرع' : 'Seed Branch Demo Data'}</span>
              </Button>

              <Button onClick={() => void handleSaveBranchCustom()} disabled={savingBranchCustom}>
                {savingBranchCustom ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                <span>{ar ? 'حفظ تخصيصات الفرع' : 'Save Branch Customizations'}</span>
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* TAB 5: مصفوفة الأدوار والصلاحيات (RBAC Roles)                 */}
      {/* ───────────────────────────────────────────────────────────── */}
      {activeTab === 'roles' && (
        <div className="animate-fade-in">
          <RolesTab />
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* TAB 6: المستخدمون وسجل التدقيق (Users & Audit Log)           */}
      {/* ───────────────────────────────────────────────────────────── */}
      {activeTab === 'users_audit' && (
        <div className="space-y-4 animate-fade-in">
          <div className="flex gap-2 border-b border-ui-border pb-3">
            <button
              onClick={() => setUserAuditSubTab('users')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                userAuditSubTab === 'users' ? 'bg-ui-text text-ui-page' : 'bg-ui-page-alt text-ui-subtle hover:text-ui-text'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>{ar ? `المستخدمون (${allUsers.length})` : `Users (${allUsers.length})`}</span>
            </button>
            <button
              onClick={() => setUserAuditSubTab('audit')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                userAuditSubTab === 'audit' ? 'bg-ui-text text-ui-page' : 'bg-ui-page-alt text-ui-subtle hover:text-ui-text'
              }`}
            >
              <Activity className="w-4 h-4" />
              <span>{ar ? 'سجل التدقيق والحركات (Audit Log)' : 'Audit Logs'}</span>
            </button>
          </div>

          {userAuditSubTab === 'users' && (
            <Card className="p-4 space-y-4">
              <div className="flex justify-between items-center gap-4">
                <DesignSearch
                  value={userSearch}
                  onChange={setUserSearch}
                  placeholder={ar ? 'بحث بالاسم، البريد أو الفرع...' : 'Search by name, email, or branch...'}
                />
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs sm:text-sm text-start">
                  <thead className="bg-ui-page-alt border-b border-ui-border text-ui-muted">
                    <tr>
                      <th className="p-3 font-semibold text-start">{ar ? 'الاسم' : 'Name'}</th>
                      <th className="p-3 font-semibold text-start">{ar ? 'البريد / المستخدم' : 'Email / User'}</th>
                      <th className="p-3 font-semibold text-start">{ar ? 'المنظمة' : 'Organization'}</th>
                      <th className="p-3 font-semibold text-start">{ar ? 'الفرع' : 'Branch'}</th>
                      <th className="p-3 font-semibold text-center">{ar ? 'الدور' : 'Role'}</th>
                      <th className="p-3 font-semibold text-center">{ar ? 'الحالة' : 'Status'}</th>
                      <th className="p-3 font-semibold text-end">{ar ? 'الإجراءات' : 'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ui-border">
                    {allUsers
                      .filter((u) => {
                        if (!userSearch) return true;
                        const q = userSearch.toLowerCase();
                        return u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.branch_name || '').toLowerCase().includes(q);
                      })
                      .map((u) => (
                        <tr key={u.user_id} className="hover:bg-ui-page-alt/50 transition">
                          <td className="p-3 font-bold text-ui-text">{u.full_name || '-'}</td>
                          <td className="p-3 text-ui-subtle">{u.email || u.username}</td>
                          <td className="p-3">{u.org_name || '-'}</td>
                          <td className="p-3">{u.branch_name || (ar ? 'جميع الفروع' : 'All')}</td>
                          <td className="p-3 text-center">
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-brand-500/10 text-brand-600">
                              {u.role}
                            </span>
                          </td>
                          <td className="p-3 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${u.is_active ? 'bg-ui-success-soft text-ui-success' : 'bg-ui-danger-soft text-ui-danger'}`}>
                              {u.is_active ? (ar ? 'نشط' : 'Active') : (ar ? 'معطل' : 'Inactive')}
                            </span>
                          </td>
                          <td className="p-3 text-end">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditingUser(u);
                                setNewPassword('');
                                setUserModalOpen(true);
                              }}
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                              <span>{ar ? 'تعديل' : 'Edit'}</span>
                            </Button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {userAuditSubTab === 'audit' && (
            <Card className="p-4 space-y-4">
              <DesignSearch
                value={auditSearch}
                onChange={setAuditSearch}
                placeholder={ar ? 'بحث في السجل...' : 'Search logs...'}
              />
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-start">
                  <thead className="bg-ui-page-alt border-b border-ui-border text-ui-muted">
                    <tr>
                      <th className="p-3 font-semibold text-start">{ar ? 'الوقت' : 'Timestamp'}</th>
                      <th className="p-3 font-semibold text-start">{ar ? 'الحدث' : 'Action'}</th>
                      <th className="p-3 font-semibold text-start">{ar ? 'الكيان' : 'Entity'}</th>
                      <th className="p-3 font-semibold text-start">{ar ? 'المستخدم' : 'User'}</th>
                      <th className="p-3 font-semibold text-start">{ar ? 'التفاصيل' : 'Details'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ui-border">
                    {auditLogs
                      .filter((a) => {
                        if (!auditSearch) return true;
                        const q = auditSearch.toLowerCase();
                        return a.action.toLowerCase().includes(q) || (a.user_email || '').toLowerCase().includes(q);
                      })
                      .map((a) => (
                        <tr key={a.id} className="hover:bg-ui-page-alt/50 font-mono">
                          <td className="p-3 text-ui-subtle whitespace-nowrap">{formatDateTime(a.created_at, lang)}</td>
                          <td className="p-3 font-bold text-ui-text">{a.action}</td>
                          <td className="p-3 text-ui-muted">{a.entity}</td>
                          <td className="p-3 text-ui-subtle">{a.user_email || '-'}</td>
                          <td className="p-3 text-ui-subtle max-w-xs truncate">{JSON.stringify(a.details)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* TAB 7: صحة وتشخيص النظام (Diagnostics)                        */}
      {/* ───────────────────────────────────────────────────────────── */}
      {activeTab === 'health' && (
        <div className="space-y-5 max-w-3xl animate-fade-in">
          <Card className="p-6 space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-base font-bold text-ui-text">{ar ? 'الفحص الذاتي للنظام' : 'System Health Check'}</h3>
                <p className="text-xs text-ui-subtle">{ar ? 'التحقق من جاهزية الاتصالات وقواعد البيانات' : 'Verify active connections and storage endpoints'}</p>
              </div>
              <Button onClick={() => void runHealthChecks()} disabled={healthRunning}>
                <Activity className={`w-4 h-4 ${healthRunning ? 'animate-spin' : ''}`} />
                <span>{ar ? 'تشغيل الفحص' : 'Run Diagnostics'}</span>
              </Button>
            </div>

            {healthStatus && (
              <div className="space-y-3 pt-3 border-t border-ui-border">
                {Object.entries(healthStatus).map(([k, v]) => (
                  <div key={k} className="p-3 rounded-xl bg-ui-page-alt flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {v.ok ? <CheckCircle2 className="w-5 h-5 text-ui-success" /> : <XCircle className="w-5 h-5 text-ui-danger" />}
                      <span className="font-bold text-ui-text uppercase text-xs">{k}</span>
                    </div>
                    <span className="text-xs text-ui-subtle">{v.message}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Edit User Modal */}
      {userModalOpen && editingUser && (
        <Modal
          isOpen={userModalOpen}
          onClose={() => setUserModalOpen(false)}
          title={ar ? 'تعديل بيانات المستخدم' : 'Edit User Profile'}
        >
          <div className="space-y-4">
            <Input
              label={ar ? 'الاسم الكامل' : 'Full Name'}
              value={editingUser.full_name}
              onChange={(e) => setEditingUser({ ...editingUser, full_name: e.target.value })}
            />
            <Select
              label={ar ? 'الدور الوظيفي' : 'Role'}
              value={editingUser.role}
              onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value })}
              options={[
                { value: 'admin', label: 'Admin (مدير فرع)' },
                { value: 'cashier', label: 'Cashier (كاشير)' },
                { value: 'kitchen', label: 'Kitchen Staff (طاقم المطبخ)' },
                { value: 'inventory_manager', label: 'Inventory Manager (أمين مستودع)' },
                { value: 'accountant', label: 'Accountant (محاسب)' },
                { value: 'waiter', label: 'Waiter (نادل)' },
                { value: 'super_admin', label: 'Super Admin (المدير العام)' },
              ]}
            />
            <Select
              label={ar ? 'الفرع المخصص' : 'Assigned Branch'}
              value={editingUser.branch_id || ''}
              onChange={(e) => setEditingUser({ ...editingUser, branch_id: e.target.value || null })}
              options={[
                { value: '', label: ar ? 'جميع الفروع (بدون تقييد)' : 'All Branches (Unrestricted)' },
                ...branches.map((b) => ({ value: b.id, label: b.name })),
              ]}
            />
            <Input
              label={ar ? 'تعيين كلمة مرور جديدة (اتركه فارغاً للتخطي)' : 'Reset Password (optional)'}
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
            />
            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="user_active"
                checked={editingUser.is_active}
                onChange={(e) => setEditingUser({ ...editingUser, is_active: e.target.checked })}
                className="rounded border-ui-border text-brand-600 focus:ring-brand-500"
              />
              <label htmlFor="user_active" className="text-sm font-semibold text-ui-text">
                {ar ? 'الحساب نشط ويستطيع تسجيل الدخول' : 'Account is active'}
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-ui-border">
              <Button variant="outline" onClick={() => setUserModalOpen(false)}>
                {ar ? 'إلغاء' : 'Cancel'}
              </Button>
              <Button onClick={() => void handleUpdateUser()} disabled={savingUser}>
                {savingUser ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                <span>{ar ? 'حفظ التعديلات' : 'Save Changes'}</span>
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Demo Data Confirmation */}
      <ConfirmDialog
        isOpen={demoConfirmOpen}
        onClose={() => setDemoConfirmOpen(false)}
        onConfirm={() => void handleSeedBranchDemo()}
        title={ar ? 'توليد بيانات تجريبية للفرع' : 'Seed Branch Demo Data'}
        message={
          ar
            ? 'سيتم توليد بيانات متكاملة تجريبية (منتجات، فئات، وصفات، طاولات، عملاء، وموردين) للفرع المحدد. هل تريد المتابعة؟'
            : 'This will seed comprehensive demo products, recipes, tables, customers, and suppliers for the selected branch. Continue?'
        }
        confirmLabel={ar ? 'تأكيد التوليد' : 'Confirm Seed'}
        cancelLabel={ar ? 'إلغاء' : 'Cancel'}
      />
    </DesignSurface>
  );
}
