-- ============================================================================
-- 034. Per-branch settings table
-- ----------------------------------------------------------------------------
-- The Settings page overrides the global settings row per branch (NULL column
-- = fall back to the global value). This table previously existed only in the
-- archived legacy migration (supabase/legacy/migration_audit_fixes.sql, never
-- applied on fresh builds), so a canonical fresh build had NO branch_settings
-- table and SettingsContext (supabase.from('branch_settings')) failed at
-- runtime. This restores it in the canonical chain.
--
-- Isolation model (matches the app's permission gate on /settings):
--   * SELECT: admins see every branch; staff see only their own branch.
--   * INSERT/UPDATE/DELETE: admins, or a user holding 'settings.manage' for
--     their OWN branch (can_permission is SECURITY DEFINER + STABLE).
-- Additive + idempotent. Table-level privileges come automatically from the
-- ALTER DEFAULT PRIVILEGES set in 032_db_grants.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.branch_settings (
  branch_id uuid PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
  receipt_header text,
  receipt_footer text,
  logo_url text,
  tax_rate numeric(5,2),
  tax_enabled boolean,
  currency text,
  low_stock_threshold numeric(12,2),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.branch_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_branch_settings" ON public.branch_settings;
CREATE POLICY "auth_select_branch_settings" ON public.branch_settings FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());

DROP POLICY IF EXISTS "auth_write_branch_settings" ON public.branch_settings;
CREATE POLICY "auth_write_branch_settings" ON public.branch_settings FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR (can_permission('settings.manage') AND branch_id = get_branch_id()));

DROP POLICY IF EXISTS "auth_write_branch_settings_upd" ON public.branch_settings;
CREATE POLICY "auth_write_branch_settings_upd" ON public.branch_settings FOR UPDATE TO authenticated
  USING (is_pos_admin() OR (can_permission('settings.manage') AND branch_id = get_branch_id()))
  WITH CHECK (is_pos_admin() OR (can_permission('settings.manage') AND branch_id = get_branch_id()));

DROP POLICY IF EXISTS "auth_write_branch_settings_del" ON public.branch_settings;
CREATE POLICY "auth_write_branch_settings_del" ON public.branch_settings FOR DELETE TO authenticated
  USING (is_pos_admin() OR (can_permission('settings.manage') AND branch_id = get_branch_id()));
