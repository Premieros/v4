-- ============================================================================
-- Roles table + role helpers (get_user_role / can_permission)
-- ----------------------------------------------------------------------------
-- The `roles` permission matrix and the two helper functions it backs were
-- defined by the legacy migration_audit_fixes.sql (now archived in legacy/).
-- The live D-series and manufacturing/accounting RPCs depend on all three, so
-- a fresh build must create them too. This file is additive and idempotent:
--   * roles table + RLS, seeded with the six base roles (ON CONFLICT DO NOTHING
--     preserves any edits made from Settings);
--   * get_user_role()  - the role of the current user;
--   * can_permission() - permission lookup in the roles matrix.
-- production_manager is inserted later by 010_manufacturing_schema.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.roles (
  role text PRIMARY KEY,
  name_ar text NOT NULL,
  name_en text NOT NULL,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_roles" ON public.roles;
CREATE POLICY "auth_select_roles" ON public.roles FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_write_roles" ON public.roles;
CREATE POLICY "auth_write_roles" ON public.roles FOR INSERT TO authenticated WITH CHECK (is_pos_admin());
DROP POLICY IF EXISTS "auth_write_roles_upd" ON public.roles;
CREATE POLICY "auth_write_roles_upd" ON public.roles FOR UPDATE TO authenticated USING (is_pos_admin()) WITH CHECK (is_pos_admin());
DROP POLICY IF EXISTS "auth_write_roles_del" ON public.roles;
CREATE POLICY "auth_write_roles_del" ON public.roles FOR DELETE TO authenticated USING (is_pos_admin());

INSERT INTO public.roles (role, name_ar, name_en, permissions) VALUES
  ('super_admin', 'مدير عام', 'Super Admin',
   '["dashboard.view","pos.sell","products.view","products.manage","products.assign","categories.view","categories.manage","components.view","components.manage","purchases.view","purchases.manage","inventory.view","inventory.manage","warehouses.view","warehouses.manage","customers.view","customers.manage","suppliers.view","suppliers.manage","expenses.view","expenses.manage","sales.view","refunds.approve","reports.view","shifts.view","shifts.open","shifts.close","shifts.manage","users.view","users.manage","audit.view","settings.manage","branches.manage"]'::jsonb),
  ('owner', 'مالك', 'Owner',
   '["dashboard.view","pos.sell","products.view","products.manage","products.assign","categories.view","categories.manage","components.view","components.manage","purchases.view","purchases.manage","inventory.view","inventory.manage","warehouses.view","warehouses.manage","customers.view","customers.manage","suppliers.view","suppliers.manage","expenses.view","expenses.manage","sales.view","refunds.approve","reports.view","shifts.view","shifts.open","shifts.close","shifts.manage","users.view","users.manage","audit.view","settings.manage","branches.manage"]'::jsonb),
  ('branch_manager', 'مدير فرع', 'Branch Manager',
   '["dashboard.view","pos.sell","products.view","products.manage","categories.view","categories.manage","components.view","components.manage","purchases.view","purchases.manage","inventory.view","inventory.manage","warehouses.view","warehouses.manage","customers.view","customers.manage","suppliers.view","suppliers.manage","expenses.view","expenses.manage","sales.view","refunds.approve","shifts.view","shifts.open","shifts.close","shifts.manage","reports.view","users.view","users.manage"]'::jsonb),
  ('cashier', 'أمين صندوق', 'Cashier',
   '["dashboard.view","pos.sell","products.view","customers.view","customers.manage","inventory.view","sales.view","shifts.view","shifts.open","shifts.close"]'::jsonb),
  ('warehouse_manager', 'مدير مخازن', 'Warehouse Manager',
   '["dashboard.view","products.view","products.manage","categories.view","categories.manage","components.view","components.manage","inventory.view","inventory.manage","warehouses.view","warehouses.manage","purchases.view","purchases.manage","suppliers.view","suppliers.manage","shifts.view"]'::jsonb),
  ('accountant', 'محاسب', 'Accountant',
   '["dashboard.view","sales.view","purchases.view","expenses.view","expenses.manage","inventory.view","customers.view","suppliers.view","reports.view","shifts.view"]'::jsonb)
ON CONFLICT (role) DO NOTHING;

-- Role of the current user (NULL for anonymous / unknown).
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $fn$
  SELECT role FROM public.users WHERE users.id = auth.uid();
$fn$;

-- Does the current user hold a dotted permission? Admins always pass.
CREATE OR REPLACE FUNCTION public.can_permission(p_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT is_pos_admin() OR EXISTS (
    SELECT 1 FROM public.users u
    JOIN public.roles r ON r.role = u.role
    WHERE u.id = auth.uid() AND r.permissions ? p_permission
  );
$fn$;
