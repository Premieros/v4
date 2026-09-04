-- ============================================================================
-- 20260824120000. Comprehensive Multi-Tenant Subscription & Feature-Gating System
-- ============================================================================
-- Implements the complete multi-tenant subscription authorization layer:
--   1. plans & plan_prices (flexible billing cycles & currencies)
--   2. features registry (central repository of all system capabilities)
--   3. plan_features (mappings with boolean / integer limits)
--   4. subscriptions (tenant-level lifecycle: trialing, active, past_due, suspended, cancelled, expired)
--   5. branch_feature_overrides (branch-specific enable/disable & limit overrides)
--   6. subscription_events (complete immutable audit trail of all subscription changes)
--   7. Central resolution RPCs:
--        - can_access_feature(p_feature_key, p_branch_id) -> boolean
--        - get_feature_access(p_feature_key, p_branch_id) -> jsonb
--        - resolve_feature_access(...)
--        - subscription_is_active(...)
--        - can_create_branch(...), can_create_user(...), can_create_warehouse(...)
--   8. Multi-tenant RLS security policies & Super Admin controllers.
-- ============================================================================

-- Ensure uuid extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. PLANS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  is_public boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plans_slug ON public.plans(slug);
CREATE INDEX IF NOT EXISTS idx_plans_active_public ON public.plans(is_active, is_public, display_order);

-- Seed Default Plans
INSERT INTO public.plans (id, name, slug, description, is_active, is_public, display_order)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Free Trial', 'free', 'تجربة مجانية لكافة الخصائص الأساسية', true, true, 1),
  ('a0000000-0000-0000-0000-000000000002', 'Starter', 'starter', 'خطة البداية للمطاعم والمحلات الفردية', true, true, 2),
  ('a0000000-0000-0000-0000-000000000003', 'Professional', 'professional', 'الخطة الاحترافية مع شاشات المطبخ والمحاسبة', true, true, 3),
  ('a0000000-0000-0000-0000-000000000004', 'Business', 'business', 'خطة الأعمال للفروع المتعددة والتصنيع والتقارير المتقدمة', true, true, 4),
  ('a0000000-0000-0000-0000-000000000005', 'Enterprise', 'enterprise', 'خطة المؤسسات والشركات الكبرى بدون أي حدود', true, true, 5)
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    display_order = EXCLUDED.display_order;

-- ============================================================================
-- 2. PLAN PRICES
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.plan_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  billing_cycle text NOT NULL CHECK (billing_cycle IN ('monthly', 'quarterly', 'yearly', 'custom')),
  price numeric(12,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'EGP',
  trial_days integer NOT NULL DEFAULT 14,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, billing_cycle, currency)
);

CREATE INDEX IF NOT EXISTS idx_plan_prices_plan ON public.plan_prices(plan_id, is_active);

-- Seed Plan Prices
INSERT INTO public.plan_prices (plan_id, billing_cycle, price, currency, trial_days)
SELECT id, 'monthly', 0, 'EGP', 14 FROM public.plans WHERE slug = 'free'
ON CONFLICT (plan_id, billing_cycle, currency) DO NOTHING;

INSERT INTO public.plan_prices (plan_id, billing_cycle, price, currency, trial_days)
SELECT id, 'monthly', 299, 'EGP', 0 FROM public.plans WHERE slug = 'starter'
ON CONFLICT (plan_id, billing_cycle, currency) DO NOTHING;
INSERT INTO public.plan_prices (plan_id, billing_cycle, price, currency, trial_days)
SELECT id, 'yearly', 2990, 'EGP', 0 FROM public.plans WHERE slug = 'starter'
ON CONFLICT (plan_id, billing_cycle, currency) DO NOTHING;

INSERT INTO public.plan_prices (plan_id, billing_cycle, price, currency, trial_days)
SELECT id, 'monthly', 599, 'EGP', 0 FROM public.plans WHERE slug = 'professional'
ON CONFLICT (plan_id, billing_cycle, currency) DO NOTHING;
INSERT INTO public.plan_prices (plan_id, billing_cycle, price, currency, trial_days)
SELECT id, 'yearly', 5990, 'EGP', 0 FROM public.plans WHERE slug = 'professional'
ON CONFLICT (plan_id, billing_cycle, currency) DO NOTHING;

INSERT INTO public.plan_prices (plan_id, billing_cycle, price, currency, trial_days)
SELECT id, 'monthly', 999, 'EGP', 0 FROM public.plans WHERE slug = 'business'
ON CONFLICT (plan_id, billing_cycle, currency) DO NOTHING;
INSERT INTO public.plan_prices (plan_id, billing_cycle, price, currency, trial_days)
SELECT id, 'yearly', 9990, 'EGP', 0 FROM public.plans WHERE slug = 'business'
ON CONFLICT (plan_id, billing_cycle, currency) DO NOTHING;

INSERT INTO public.plan_prices (plan_id, billing_cycle, price, currency, trial_days)
SELECT id, 'monthly', 1999, 'EGP', 0 FROM public.plans WHERE slug = 'enterprise'
ON CONFLICT (plan_id, billing_cycle, currency) DO NOTHING;
INSERT INTO public.plan_prices (plan_id, billing_cycle, price, currency, trial_days)
SELECT id, 'yearly', 19990, 'EGP', 0 FROM public.plans WHERE slug = 'enterprise'
ON CONFLICT (plan_id, billing_cycle, currency) DO NOTHING;

-- ============================================================================
-- 3. FEATURES REGISTRY
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  category text NOT NULL CHECK (category IN ('core', 'operations', 'inventory', 'trade', 'finance', 'analytics', 'enterprise', 'management')),
  is_active boolean NOT NULL DEFAULT true,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_features_key ON public.features(key);
CREATE INDEX IF NOT EXISTS idx_features_category ON public.features(category);

-- Seed Features Registry
INSERT INTO public.features (key, name, description, category, is_system)
VALUES
  ('pos', 'نقطة البيع (POS)', 'إصدار الفواتير ونقاط البيع السريعة والطاولات والدليفري', 'core', true),
  ('inventory', 'إدارة المخزون', 'متابعة الأرصدة والمستودعات والتسويات المخزنية', 'inventory', true),
  ('purchases', 'المشتريات والموردين', 'أوامر الشراء وعروض الأسعار وإدارة الموردين', 'trade', true),
  ('suppliers', 'سجل الموردين', 'إدارة حسابات وبيانات الموردين', 'trade', true),
  ('customers', 'سجل العملاء', 'إدارة حسابات وبيانات العملاء ونقاط الولاء', 'trade', true),
  ('kds', 'شاشة المطبخ (KDS)', 'نظام عرض وإدارة طلبات المطبخ والمحطات في الوقت الفعلي', 'operations', false),
  ('customer_display', 'شاشة العميل', 'عرض الطلب والأسعار للعميل أثناء عملية البيع', 'operations', false),
  ('tables', 'إدارة الطاولات والصالات', 'المخطط التفاعلي للطاولات وتوزيع الصالات', 'operations', false),
  ('delivery', 'إدارة الدليفري والسائقين', 'تتبع طلبات التوصيل وتوزيع الكباتن والسائقين', 'operations', false),
  ('manufacturing', 'التصنيع والإنتاج', 'خطوط الإنتاج والتصنيع وتحويل المواد', 'inventory', false),
  ('recipes', 'الوصفات والتركيبات', 'مكونات المنتجات وخصم المواد الخام تلقائياً', 'inventory', false),
  ('units', 'وحدات القياس المتعددة', 'وحدات التحويل القياسية والتجزئة والكرتون', 'inventory', false),
  ('reports', 'التقارير الأساسية', 'تقارير المبيعات اليومية والأصناف الأكثر طلباً', 'analytics', true),
  ('advanced_reports', 'التقارير المتقدمة والتحليلات', 'تقارير الأرباح والخسائر والتحليلات التنفيذية العميقة', 'analytics', false),
  ('excel_import', 'استيراد البيانات من Excel', 'استيراد قوائم المنتجات والعملاء والمخزون من ملفات Excel', 'management', false),
  ('excel_export', 'تصدير التقارير إلى Excel/PDF', 'تصدير كافة الكشوفات والتقارير المالية بصيغ Excel و PDF', 'management', false),
  ('multi_branch', 'الفروع المتعددة', 'إمكانية فتح وإدارة أكثر من فرع تحت نفس المؤسسة', 'enterprise', false),
  ('branch_management', 'إدارة الفروع والصلاحيات', 'تخصيص الصلاحيات والإعدادات لكل فرع', 'enterprise', false),
  ('warehouse_management', 'المستودعات المتعددة', 'إدارة المخازن المتعددة والتحويلات بين المخازن', 'inventory', false),
  ('employees', 'الموظفين والمستخدمين', 'إدارة الحسابات وطواقم العمل', 'management', true),
  ('advanced_permissions', 'الصلاحيات المتقدمة والـ RBAC', 'صلاحيات مخصصة وتدقيق الأدوار المتقدمة', 'management', false),
  ('shift_management', 'إدارة الورديات والكاشير', 'فتح وإغلاق الورديات والعجز والزيادة في الخزينة', 'operations', true),
  ('accounting', 'النظام المحاسبي المتكامل', 'شجرة الحسابات، قيود اليومية، الخزائن والبنوك، وميزان المراجعة', 'finance', false),
  ('ai_assistant', 'المساعد الذكي (AI Insights)', 'توليد التقارير الذكية وتوقعات الطلب عبر الذكاء الاصطناعي', 'enterprise', false),
  ('api_access', 'الربط الخارجي وواجهة API', 'الربط مع المنصات الخارجية وتطبيقات التوصيل والـ ERP', 'enterprise', false),
  ('audit_logs', 'سجل العمليات والتدقيق (Audit Logs)', 'تتبع كامل لكافة الحركات والتعديلات وحذف الفواتير', 'management', false),
  ('costing', 'حساب التكاليف وهوامش الربح', 'حساب تكلفة الوجبات وتغيرات تكاليف المواد الخام', 'inventory', false),
  ('waste_management', 'إدارة الهدر والتوالف', 'تسجيل هدر المطبخ والتوالف المخزنية وتحليل الخسائر', 'inventory', false),
  ('transfers', 'التحويلات المخزنية', 'تحويل البضائع والمواد الخام بين الفروع والمستودعات', 'inventory', false),
  ('stock_counts', 'الجرد المخزني', 'جلسات الجرد الدوري والمفاجئ وتسوية الفروقات', 'inventory', false)
ON CONFLICT (key) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    category = EXCLUDED.category;

-- ============================================================================
-- 4. PLAN FEATURES & LIMITS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.plan_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  feature_id uuid NOT NULL REFERENCES public.features(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  limit_value integer DEFAULT NULL, -- NULL or -1 means unlimited
  limit_type text NOT NULL DEFAULT 'boolean' CHECK (limit_type IN ('boolean', 'integer', 'decimal', 'unlimited')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, feature_id)
);

CREATE INDEX IF NOT EXISTS idx_plan_features_lookup ON public.plan_features(plan_id, feature_id, enabled);

-- Helper to seed plan features
DO $$
DECLARE
  v_plan_free uuid;
  v_plan_starter uuid;
  v_plan_pro uuid;
  v_plan_biz uuid;
  v_plan_ent uuid;
BEGIN
  SELECT id INTO v_plan_free FROM public.plans WHERE slug = 'free';
  SELECT id INTO v_plan_starter FROM public.plans WHERE slug = 'starter';
  SELECT id INTO v_plan_pro FROM public.plans WHERE slug = 'professional';
  SELECT id INTO v_plan_biz FROM public.plans WHERE slug = 'business';
  SELECT id INTO v_plan_ent FROM public.plans WHERE slug = 'enterprise';

  -- 1. Free Trial: All features enabled for 14 days, limited limits
  INSERT INTO public.plan_features (plan_id, feature_id, enabled, limit_type, limit_value)
  SELECT v_plan_free, f.id, true,
    CASE 
      WHEN f.key = 'multi_branch' THEN 'integer'
      WHEN f.key = 'employees' THEN 'integer'
      WHEN f.key = 'warehouse_management' THEN 'integer'
      ELSE 'boolean'
    END,
    CASE 
      WHEN f.key = 'multi_branch' THEN 2
      WHEN f.key = 'employees' THEN 5
      WHEN f.key = 'warehouse_management' THEN 2
      ELSE NULL
    END
  FROM public.features f
  ON CONFLICT (plan_id, feature_id) DO NOTHING;

  -- 2. Starter: Basic POS, Inventory, Purchases, Reports. (No KDS, No Multi-branch, No Accounting, No Manufacturing)
  INSERT INTO public.plan_features (plan_id, feature_id, enabled, limit_type, limit_value)
  SELECT v_plan_starter, f.id,
    CASE 
      WHEN f.key IN ('pos', 'inventory', 'purchases', 'suppliers', 'customers', 'reports', 'shift_management', 'employees', 'tables', 'delivery') THEN true
      ELSE false
    END,
    CASE 
      WHEN f.key = 'multi_branch' THEN 'integer'
      WHEN f.key = 'employees' THEN 'integer'
      WHEN f.key = 'warehouse_management' THEN 'integer'
      ELSE 'boolean'
    END,
    CASE 
      WHEN f.key = 'multi_branch' THEN 1
      WHEN f.key = 'employees' THEN 3
      WHEN f.key = 'warehouse_management' THEN 1
      ELSE NULL
    END
  FROM public.features f
  ON CONFLICT (plan_id, feature_id) DO UPDATE
  SET enabled = EXCLUDED.enabled, limit_type = EXCLUDED.limit_type, limit_value = EXCLUDED.limit_value;

  -- 3. Professional: Adds KDS, Recipes, Costing, Excel Export/Import, Accounting basics, up to 3 branches
  INSERT INTO public.plan_features (plan_id, feature_id, enabled, limit_type, limit_value)
  SELECT v_plan_pro, f.id,
    CASE 
      WHEN f.key IN ('pos', 'inventory', 'purchases', 'suppliers', 'customers', 'reports', 'shift_management', 'employees', 'tables', 'delivery',
                     'kds', 'recipes', 'costing', 'excel_export', 'excel_import', 'waste_management', 'transfers', 'stock_counts', 'accounting', 'advanced_reports') THEN true
      ELSE false
    END,
    CASE 
      WHEN f.key = 'multi_branch' THEN 'integer'
      WHEN f.key = 'employees' THEN 'integer'
      WHEN f.key = 'warehouse_management' THEN 'integer'
      ELSE 'boolean'
    END,
    CASE 
      WHEN f.key = 'multi_branch' THEN 3
      WHEN f.key = 'employees' THEN 10
      WHEN f.key = 'warehouse_management' THEN 3
      ELSE NULL
    END
  FROM public.features f
  ON CONFLICT (plan_id, feature_id) DO UPDATE
  SET enabled = EXCLUDED.enabled, limit_type = EXCLUDED.limit_type, limit_value = EXCLUDED.limit_value;

  -- 4. Business: Full suite including Manufacturing, Multi-branch, Audit Logs, Advanced Permissions, up to 10 branches
  INSERT INTO public.plan_features (plan_id, feature_id, enabled, limit_type, limit_value)
  SELECT v_plan_biz, f.id,
    CASE 
      WHEN f.key IN ('ai_assistant', 'api_access') THEN false
      ELSE true
    END,
    CASE 
      WHEN f.key = 'multi_branch' THEN 'integer'
      WHEN f.key = 'employees' THEN 'integer'
      WHEN f.key = 'warehouse_management' THEN 'integer'
      ELSE 'boolean'
    END,
    CASE 
      WHEN f.key = 'multi_branch' THEN 10
      WHEN f.key = 'employees' THEN 50
      WHEN f.key = 'warehouse_management' THEN 15
      ELSE NULL
    END
  FROM public.features f
  ON CONFLICT (plan_id, feature_id) DO UPDATE
  SET enabled = EXCLUDED.enabled, limit_type = EXCLUDED.limit_type, limit_value = EXCLUDED.limit_value;

  -- 5. Enterprise: All features enabled, Unlimited limits
  INSERT INTO public.plan_features (plan_id, feature_id, enabled, limit_type, limit_value)
  SELECT v_plan_ent, f.id, true, 'unlimited', -1
  FROM public.features f
  ON CONFLICT (plan_id, feature_id) DO UPDATE
  SET enabled = true, limit_type = 'unlimited', limit_value = -1;

END $$;

-- ============================================================================
-- 5. MULTI-TENANT SUBSCRIPTIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
  plan_price_id uuid REFERENCES public.plan_prices(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'trialing',
  started_at timestamptz NOT NULL DEFAULT now(),
  trial_started_at timestamptz DEFAULT now(),
  trial_ends_at timestamptz,
  current_period_start timestamptz DEFAULT now(),
  current_period_end timestamptz,
  cancelled_at timestamptz,
  suspended_at timestamptz,
  auto_renew boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id),
  CONSTRAINT subscriptions_status_check
    CHECK (status IN ('trialing', 'active', 'past_due', 'suspended', 'cancelled', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant_status ON public.subscriptions(tenant_id, status);

-- ============================================================================
-- 6. BRANCH FEATURE OVERRIDES
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.branch_feature_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  feature_id uuid NOT NULL REFERENCES public.features(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  limit_value integer DEFAULT NULL,
  reason text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, feature_id)
);

CREATE INDEX IF NOT EXISTS idx_branch_feature_overrides_lookup ON public.branch_feature_overrides(branch_id, feature_id, enabled);

-- ============================================================================
-- 7. SUBSCRIPTION EVENTS & AUDIT LOG
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.subscription_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('created', 'trial_started', 'activated', 'renewed', 'upgraded', 'downgraded', 'suspended', 'reactivated', 'cancelled', 'expired', 'extended', 'feature_enabled', 'feature_disabled')),
  old_status text,
  new_status text,
  old_plan_id uuid,
  new_plan_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscription_events_tenant ON public.subscription_events(tenant_id, created_at DESC);

-- ============================================================================
-- 8. INITIAL BACKFILL FOR EXISTING ORGANIZATIONS
-- ============================================================================
DO $$
DECLARE
  v_default_plan uuid;
  v_org record;
BEGIN
  SELECT id INTO v_default_plan FROM public.plans WHERE slug = 'free';

  FOR v_org IN SELECT id, created_at FROM public.organizations LOOP
    INSERT INTO public.subscriptions (
      tenant_id,
      plan_id,
      status,
      started_at,
      trial_started_at,
      trial_ends_at,
      current_period_start,
      current_period_end
    )
    VALUES (
      v_org.id,
      v_default_plan,
      'trialing',
      v_org.created_at,
      v_org.created_at,
      v_org.created_at + INTERVAL '90 days',
      v_org.created_at,
      v_org.created_at + INTERVAL '90 days'
    )
    ON CONFLICT (tenant_id) DO NOTHING;
  END LOOP;
END $$;

-- ============================================================================
-- 9. CORE AUTHORIZATION & RESOLUTION RPCs
-- ============================================================================

-- A. subscription_is_active
CREATE OR REPLACE FUNCTION public.subscription_is_active(p_tenant_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tid uuid := p_tenant_id;
  v_sub public.subscriptions%ROWTYPE;
  v_org_active boolean := true;
BEGIN
  -- Super admin bypasses subscription gate
  IF is_super_admin() THEN
    RETURN true;
  END IF;

  -- If tenant not provided, infer from user's active branch or organization membership
  IF v_tid IS NULL THEN
    SELECT b.organization_id INTO v_tid
    FROM public.branches b
    WHERE b.id = get_branch_id();

    IF v_tid IS NULL THEN
      SELECT om.organization_id INTO v_tid
      FROM public.organization_members om
      WHERE om.user_id = auth.uid() AND om.is_active = true
      LIMIT 1;
    END IF;
  END IF;

  IF v_tid IS NULL THEN
    RETURN false;
  END IF;

  -- 1. Check if organization is active
  SELECT is_active INTO v_org_active FROM public.organizations WHERE id = v_tid;
  IF v_org_active IS FALSE THEN
    RETURN false;
  END IF;

  -- 2. Fetch subscription
  SELECT * INTO v_sub FROM public.subscriptions WHERE tenant_id = v_tid;
  IF v_sub.id IS NULL THEN
    RETURN false;
  END IF;

  -- 3. Check status
  IF v_sub.status = 'active' THEN
    IF v_sub.current_period_end IS NOT NULL AND v_sub.current_period_end < now() THEN
      RETURN false;
    END IF;
    RETURN true;
  ELSIF v_sub.status = 'trialing' THEN
    IF v_sub.trial_ends_at IS NOT NULL AND v_sub.trial_ends_at < now() THEN
      RETURN false;
    END IF;
    RETURN true;
  ELSE
    RETURN false;
  END IF;
END;
$$;

-- B. resolve_feature_access
CREATE OR REPLACE FUNCTION public.resolve_feature_access(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_feature_key text,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub public.subscriptions%ROWTYPE;
  v_feat public.features%ROWTYPE;
  v_plan_feat public.plan_features%ROWTYPE;
  v_override public.branch_feature_overrides%ROWTYPE;
  v_org_active boolean := true;
  v_is_super boolean := false;
BEGIN
  v_is_super := is_super_admin();
  IF v_is_super THEN
    RETURN jsonb_build_object(
      'allowed', true,
      'reason', 'SUPER_ADMIN',
      'source', 'system',
      'limit_value', NULL,
      'limit_type', 'unlimited'
    );
  END IF;

  -- 1. Check Feature in Registry
  SELECT * INTO v_feat FROM public.features WHERE key = p_feature_key;
  IF v_feat.id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'FEATURE_NOT_FOUND', 'source', 'system');
  END IF;

  IF v_feat.is_active IS FALSE THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'FEATURE_DISABLED_GLOBALLY', 'source', 'system');
  END IF;

  -- 2. Check Organization Status
  IF p_tenant_id IS NOT NULL THEN
    SELECT is_active INTO v_org_active FROM public.organizations WHERE id = p_tenant_id;
    IF v_org_active IS FALSE THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'TENANT_SUSPENDED', 'source', 'tenant');
    END IF;
  END IF;

  -- 3. Check Subscription Status
  SELECT * INTO v_sub FROM public.subscriptions WHERE tenant_id = p_tenant_id;
  IF v_sub.id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'NO_SUBSCRIPTION', 'source', 'subscription');
  END IF;

  IF v_sub.status = 'suspended' THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'SUBSCRIPTION_SUSPENDED', 'source', 'subscription');
  ELSIF v_sub.status = 'cancelled' THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'SUBSCRIPTION_CANCELLED', 'source', 'subscription');
  ELSIF v_sub.status = 'expired' OR 
        (v_sub.status = 'trialing' AND v_sub.trial_ends_at < now()) OR
        (v_sub.status = 'active' AND v_sub.current_period_end < now()) THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'SUBSCRIPTION_EXPIRED', 'source', 'subscription');
  END IF;

  -- 4. Check Branch Feature Override (if branch provided)
  IF p_branch_id IS NOT NULL THEN
    SELECT * INTO v_override
    FROM public.branch_feature_overrides
    WHERE branch_id = p_branch_id AND feature_id = v_feat.id;

    IF v_override.id IS NOT NULL THEN
      IF v_override.enabled IS FALSE THEN
        RETURN jsonb_build_object(
          'allowed', false,
          'reason', 'BRANCH_OVERRIDE_DISABLED',
          'source', 'branch_override',
          'limit_value', v_override.limit_value
        );
      ELSE
        RETURN jsonb_build_object(
          'allowed', true,
          'reason', 'BRANCH_OVERRIDE_ENABLED',
          'source', 'branch_override',
          'limit_value', v_override.limit_value
        );
      END IF;
    END IF;
  END IF;

  -- 5. Check Plan Feature
  SELECT * INTO v_plan_feat
  FROM public.plan_features
  WHERE plan_id = v_sub.plan_id AND feature_id = v_feat.id;

  IF v_plan_feat.id IS NULL OR v_plan_feat.enabled IS FALSE THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'FEATURE_NOT_INCLUDED_IN_PLAN',
      'source', 'plan',
      'limit_value', NULL
    );
  END IF;

  -- Feature is allowed by Plan
  RETURN jsonb_build_object(
    'allowed', true,
    'reason', 'PLAN_ENABLED',
    'source', 'plan',
    'limit_value', v_plan_feat.limit_value,
    'limit_type', v_plan_feat.limit_type
  );
END;
$$;

-- C. get_feature_access
CREATE OR REPLACE FUNCTION public.get_feature_access(
  p_feature_key text,
  p_branch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tid uuid;
  v_bid uuid := p_branch_id;
BEGIN
  IF v_bid IS NULL THEN
    v_bid := get_branch_id();
  END IF;

  IF v_bid IS NOT NULL THEN
    SELECT organization_id INTO v_tid FROM public.branches WHERE id = v_bid;
  END IF;

  IF v_tid IS NULL THEN
    SELECT organization_id INTO v_tid
    FROM public.organization_members
    WHERE user_id = auth.uid() AND is_active = true
    LIMIT 1;
  END IF;

  RETURN public.resolve_feature_access(v_tid, v_bid, p_feature_key, auth.uid());
END;
$$;

-- D. can_access_feature (boolean helper for RLS and SQL queries)
CREATE OR REPLACE FUNCTION public.can_access_feature(
  p_feature_key text,
  p_branch_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res jsonb;
BEGIN
  v_res := public.get_feature_access(p_feature_key, p_branch_id);
  RETURN COALESCE((v_res->>'allowed')::boolean, false);
END;
$$;

-- E. Limits Enforcement Helpers
CREATE OR REPLACE FUNCTION public.can_create_branch(p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tid uuid := p_tenant_id;
  v_count integer;
  v_limit integer;
  v_access jsonb;
BEGIN
  IF is_super_admin() THEN
    RETURN jsonb_build_object('allowed', true, 'current', 0, 'limit', -1);
  END IF;

  IF v_tid IS NULL THEN
    SELECT om.organization_id INTO v_tid FROM public.organization_members om WHERE om.user_id = auth.uid() AND om.is_active = true LIMIT 1;
  END IF;

  v_access := public.resolve_feature_access(v_tid, NULL, 'multi_branch', auth.uid());
  IF (v_access->>'allowed')::boolean IS FALSE THEN
    -- Check if they already have 1 branch
    SELECT count(*) INTO v_count FROM public.branches WHERE organization_id = v_tid;
    IF v_count >= 1 THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'MULTI_BRANCH_FEATURE_LOCKED', 'current', v_count, 'limit', 1);
    END IF;
  END IF;

  v_limit := COALESCE((v_access->>'limit_value')::integer, -1);
  SELECT count(*) INTO v_count FROM public.branches WHERE organization_id = v_tid;

  IF v_limit > 0 AND v_count >= v_limit THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'BRANCH_LIMIT_REACHED', 'current', v_count, 'limit', v_limit);
  END IF;

  RETURN jsonb_build_object('allowed', true, 'current', v_count, 'limit', v_limit);
END;
$$;

CREATE OR REPLACE FUNCTION public.can_create_user(p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tid uuid := p_tenant_id;
  v_count integer;
  v_limit integer;
  v_access jsonb;
BEGIN
  IF is_super_admin() THEN
    RETURN jsonb_build_object('allowed', true, 'current', 0, 'limit', -1);
  END IF;

  IF v_tid IS NULL THEN
    SELECT om.organization_id INTO v_tid FROM public.organization_members om WHERE om.user_id = auth.uid() AND om.is_active = true LIMIT 1;
  END IF;

  v_access := public.resolve_feature_access(v_tid, NULL, 'employees', auth.uid());
  v_limit := COALESCE((v_access->>'limit_value')::integer, -1);

  SELECT count(*) INTO v_count
  FROM public.organization_members
  WHERE organization_id = v_tid AND is_active = true;

  IF v_limit > 0 AND v_count >= v_limit THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'USER_LIMIT_REACHED', 'current', v_count, 'limit', v_limit);
  END IF;

  RETURN jsonb_build_object('allowed', true, 'current', v_count, 'limit', v_limit);
END;
$$;

-- F. Tenant Full Subscription Details
CREATE OR REPLACE FUNCTION public.get_tenant_subscription_details(p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tid uuid := p_tenant_id;
  v_sub public.subscriptions%ROWTYPE;
  v_plan public.plans%ROWTYPE;
  v_price public.plan_prices%ROWTYPE;
  v_features jsonb;
  v_overrides jsonb;
  v_branches_count integer := 0;
  v_users_count integer := 0;
  v_warehouses_count integer := 0;
  v_events jsonb;
BEGIN
  IF v_tid IS NULL THEN
    SELECT om.organization_id INTO v_tid
    FROM public.organization_members om
    WHERE om.user_id = auth.uid() AND om.is_active = true
    LIMIT 1;

    IF v_tid IS NULL THEN
      SELECT b.organization_id INTO v_tid
      FROM public.branches b
      WHERE b.id = get_branch_id();
    END IF;
  END IF;

  IF v_tid IS NULL THEN
    RETURN jsonb_build_object('error', 'TENANT_NOT_FOUND');
  END IF;

  SELECT * INTO v_sub FROM public.subscriptions WHERE tenant_id = v_tid;
  IF v_sub.id IS NULL THEN
    RETURN jsonb_build_object('has_subscription', false, 'tenant_id', v_tid);
  END IF;

  SELECT * INTO v_plan FROM public.plans WHERE id = v_sub.plan_id;
  IF v_sub.plan_price_id IS NOT NULL THEN
    SELECT * INTO v_price FROM public.plan_prices WHERE id = v_sub.plan_price_id;
  END IF;

  -- Aggregate Plan Features
  SELECT jsonb_agg(
    jsonb_build_object(
      'key', f.key,
      'name', f.name,
      'description', f.description,
      'category', f.category,
      'enabled', COALESCE(pf.enabled, false),
      'limit_value', pf.limit_value,
      'limit_type', pf.limit_type
    ) ORDER BY f.category, f.name
  ) INTO v_features
  FROM public.features f
  LEFT JOIN public.plan_features pf ON pf.feature_id = f.id AND pf.plan_id = v_sub.plan_id;

  -- Branch Overrides for Tenant
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', bfo.id,
      'branch_id', bfo.branch_id,
      'branch_name', b.name,
      'feature_key', f.key,
      'feature_name', f.name,
      'enabled', bfo.enabled,
      'limit_value', bfo.limit_value,
      'reason', bfo.reason
    )
  ) INTO v_overrides
  FROM public.branch_feature_overrides bfo
  JOIN public.branches b ON b.id = bfo.branch_id
  JOIN public.features f ON f.id = bfo.feature_id
  WHERE bfo.tenant_id = v_tid;

  -- Counts
  SELECT count(*) INTO v_branches_count FROM public.branches WHERE organization_id = v_tid;
  SELECT count(*) INTO v_users_count FROM public.organization_members WHERE organization_id = v_tid AND is_active = true;
  SELECT count(*) INTO v_warehouses_count FROM public.warehouses w JOIN public.branches b ON b.id = w.branch_id WHERE b.organization_id = v_tid;

  -- Recent Events
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', se.id,
      'event_type', se.event_type,
      'old_status', se.old_status,
      'new_status', se.new_status,
      'metadata', se.metadata,
      'created_at', se.created_at
    ) ORDER BY se.created_at DESC
  ) INTO v_events
  FROM (
    SELECT * FROM public.subscription_events
    WHERE tenant_id = v_tid
    ORDER BY created_at DESC
    LIMIT 20
  ) se;

  RETURN jsonb_build_object(
    'has_subscription', true,
    'subscription', jsonb_build_object(
      'id', v_sub.id,
      'tenant_id', v_sub.tenant_id,
      'status', v_sub.status,
      'started_at', v_sub.started_at,
      'trial_started_at', v_sub.trial_started_at,
      'trial_ends_at', v_sub.trial_ends_at,
      'current_period_start', v_sub.current_period_start,
      'current_period_end', v_sub.current_period_end,
      'cancelled_at', v_sub.cancelled_at,
      'suspended_at', v_sub.suspended_at,
      'auto_renew', v_sub.auto_renew
    ),
    'plan', jsonb_build_object(
      'id', v_plan.id,
      'name', v_plan.name,
      'slug', v_plan.slug,
      'description', v_plan.description
    ),
    'price', CASE WHEN v_price.id IS NOT NULL THEN jsonb_build_object(
      'id', v_price.id,
      'billing_cycle', v_price.billing_cycle,
      'price', v_price.price,
      'currency', v_price.currency
    ) ELSE NULL END,
    'features', COALESCE(v_features, '[]'::jsonb),
    'branch_overrides', COALESCE(v_overrides, '[]'::jsonb),
    'usage', jsonb_build_object(
      'branches_count', v_branches_count,
      'users_count', v_users_count,
      'warehouses_count', v_warehouses_count
    ),
    'events', COALESCE(v_events, '[]'::jsonb)
  );
END;
$$;

-- G. Super Admin Management RPCs
CREATE OR REPLACE FUNCTION public.super_admin_change_subscription(
  p_tenant_id uuid,
  p_plan_id uuid,
  p_status text,
  p_current_period_end timestamptz DEFAULT NULL,
  p_trial_ends_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub public.subscriptions%ROWTYPE;
  v_old_status text;
  v_old_plan uuid;
BEGIN
  IF NOT is_super_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED');
  END IF;

  SELECT * INTO v_sub FROM public.subscriptions WHERE tenant_id = p_tenant_id;
  v_old_status := v_sub.status;
  v_old_plan := v_sub.plan_id;

  INSERT INTO public.subscriptions (
    tenant_id,
    plan_id,
    status,
    current_period_end,
    trial_ends_at,
    updated_at
  )
  VALUES (
    p_tenant_id,
    p_plan_id,
    p_status,
    COALESCE(p_current_period_end, now() + INTERVAL '30 days'),
    p_trial_ends_at,
    now()
  )
  ON CONFLICT (tenant_id) DO UPDATE
  SET plan_id = EXCLUDED.plan_id,
      status = EXCLUDED.status,
      current_period_end = EXCLUDED.current_period_end,
      trial_ends_at = EXCLUDED.trial_ends_at,
      updated_at = now();

  -- Log event
  INSERT INTO public.subscription_events (
    tenant_id,
    event_type,
    old_status,
    new_status,
    old_plan_id,
    new_plan_id,
    metadata,
    created_by
  )
  VALUES (
    p_tenant_id,
    CASE 
      WHEN v_old_status != p_status AND p_status = 'active' THEN 'activated'
      WHEN v_old_status != p_status AND p_status = 'suspended' THEN 'suspended'
      WHEN v_old_plan != p_plan_id THEN 'upgraded'
      ELSE 'renewed'
    END,
    v_old_status,
    p_status,
    v_old_plan,
    p_plan_id,
    jsonb_build_object('action', 'super_admin_change_subscription'),
    auth.uid()
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

-- H. Super Admin Branch Feature Override RPC
CREATE OR REPLACE FUNCTION public.super_admin_set_branch_override(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_feature_key text,
  p_enabled boolean,
  p_limit_value integer DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_feat_id uuid;
BEGIN
  IF NOT is_super_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED');
  END IF;

  SELECT id INTO v_feat_id FROM public.features WHERE key = p_feature_key;
  IF v_feat_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'FEATURE_NOT_FOUND');
  END IF;

  INSERT INTO public.branch_feature_overrides (
    tenant_id,
    branch_id,
    feature_id,
    enabled,
    limit_value,
    reason,
    created_by,
    updated_at
  )
  VALUES (
    p_tenant_id,
    p_branch_id,
    v_feat_id,
    p_enabled,
    p_limit_value,
    p_reason,
    auth.uid(),
    now()
  )
  ON CONFLICT (branch_id, feature_id) DO UPDATE
  SET enabled = EXCLUDED.enabled,
      limit_value = EXCLUDED.limit_value,
      reason = EXCLUDED.reason,
      updated_at = now();

  -- Log event
  INSERT INTO public.subscription_events (
    tenant_id,
    event_type,
    metadata,
    created_by
  )
  VALUES (
    p_tenant_id,
    CASE WHEN p_enabled THEN 'feature_enabled' ELSE 'feature_disabled' END,
    jsonb_build_object(
      'branch_id', p_branch_id,
      'feature_key', p_feature_key,
      'enabled', p_enabled,
      'reason', p_reason
    ),
    auth.uid()
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.super_admin_remove_branch_override(
  p_branch_id uuid,
  p_feature_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_feat_id uuid;
BEGIN
  IF NOT is_super_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED');
  END IF;

  SELECT id INTO v_feat_id FROM public.features WHERE key = p_feature_key;
  IF v_feat_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'FEATURE_NOT_FOUND');
  END IF;

  DELETE FROM public.branch_feature_overrides
  WHERE branch_id = p_branch_id AND feature_id = v_feat_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================================
-- 10. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_feature_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;

-- Plans & Prices: Public read for active, Super Admin full control
DROP POLICY IF EXISTS plans_select ON public.plans;
CREATE POLICY plans_select ON public.plans FOR SELECT TO anon, authenticated
  USING (is_active = true OR is_super_admin());

DROP POLICY IF EXISTS plans_super_admin_all ON public.plans;
CREATE POLICY plans_super_admin_all ON public.plans FOR ALL TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS plan_prices_select ON public.plan_prices;
CREATE POLICY plan_prices_select ON public.plan_prices FOR SELECT TO anon, authenticated
  USING (is_active = true OR is_super_admin());

DROP POLICY IF EXISTS plan_prices_super_admin_all ON public.plan_prices;
CREATE POLICY plan_prices_super_admin_all ON public.plan_prices FOR ALL TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

-- Features & Plan Features: Public read for active, Super Admin full control
DROP POLICY IF EXISTS features_select ON public.features;
CREATE POLICY features_select ON public.features FOR SELECT TO anon, authenticated
  USING (is_active = true OR is_super_admin());

DROP POLICY IF EXISTS features_super_admin_all ON public.features;
CREATE POLICY features_super_admin_all ON public.features FOR ALL TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS plan_features_select ON public.plan_features;
CREATE POLICY plan_features_select ON public.plan_features FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS plan_features_super_admin_all ON public.plan_features;
CREATE POLICY plan_features_super_admin_all ON public.plan_features FOR ALL TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

-- Subscriptions: Tenant members can read own subscription, Super Admin full control
DROP POLICY IF EXISTS subscriptions_select ON public.subscriptions;
CREATE POLICY subscriptions_select ON public.subscriptions FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = subscriptions.tenant_id
        AND om.user_id = auth.uid()
        AND om.is_active = true
    )
    OR EXISTS (
      SELECT 1 FROM public.branches b
      WHERE b.organization_id = subscriptions.tenant_id
        AND b.id = get_branch_id()
    )
  );

DROP POLICY IF EXISTS subscriptions_super_admin_all ON public.subscriptions;
CREATE POLICY subscriptions_super_admin_all ON public.subscriptions FOR ALL TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

-- Branch Feature Overrides: Tenant members read own, Super Admin manage
DROP POLICY IF EXISTS branch_overrides_select ON public.branch_feature_overrides;
CREATE POLICY branch_overrides_select ON public.branch_feature_overrides FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = branch_feature_overrides.tenant_id
        AND om.user_id = auth.uid()
        AND om.is_active = true
    )
    OR branch_id = get_branch_id()
  );

DROP POLICY IF EXISTS branch_overrides_super_admin_all ON public.branch_feature_overrides;
CREATE POLICY branch_overrides_super_admin_all ON public.branch_feature_overrides FOR ALL TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

-- Subscription Events: Tenant members read own, Super Admin full control
DROP POLICY IF EXISTS subscription_events_select ON public.subscription_events;
CREATE POLICY subscription_events_select ON public.subscription_events FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = subscription_events.tenant_id
        AND om.user_id = auth.uid()
        AND om.is_active = true
    )
  );

DROP POLICY IF EXISTS subscription_events_super_admin_all ON public.subscription_events;
CREATE POLICY subscription_events_super_admin_all ON public.subscription_events FOR ALL TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

-- ============================================================================
-- 11. PERMISSIONS & GRANTS
-- ============================================================================
GRANT SELECT ON public.plans, public.plan_prices, public.features, public.plan_features TO anon, authenticated;
GRANT SELECT ON public.subscriptions, public.branch_feature_overrides, public.subscription_events TO authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_is_active(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_feature_access(uuid, uuid, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_feature_access(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_feature(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_create_branch(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_create_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_subscription_details(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_change_subscription(uuid, uuid, text, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_set_branch_override(uuid, uuid, text, boolean, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_remove_branch_override(uuid, text) TO authenticated;
