-- 068. P0 security hardening — closes the audited branch-isolation gaps.
--
--   * process_sale:       was granted to `anon` (047/055). An anonymous caller
--                         has auth.uid() = NULL, so the branch guard
--                         (047/055) passed and a cross-branch write was
--                         possible. Restricted to authenticated + service_role.
--   * subscription_status: was granted to `anon` (058). It reads any branch's
--                         subscription state for a given branch_id. Restricted
--                         to authenticated + service_role.
--   * product_components:  SELECT policy was `USING (true)` (002), exposing the
--                         full recipe graph across branches. INSERT/UPDATE/
--                         DELETE were already gated (044); the SELECT policy is
--                         now scoped through the parent product's branch,
--                         mirroring the 044 pattern.
--
-- Behavior-preserving for legitimate users: the application only calls
-- process_sale and subscription_status from authenticated sessions
-- (src/api/modules.ts, src/context/AuthContext.tsx,
-- src/features/admin/pages/SubscriptionsAdminPage.tsx).

-- 1. process_sale: authenticated + service_role only -------------------------
REVOKE ALL ON FUNCTION public.process_sale(
  text, uuid, uuid, uuid, uuid, numeric, numeric, text, numeric, numeric,
  numeric, numeric, text, text, jsonb, uuid, text, uuid, uuid, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_sale(
  text, uuid, uuid, uuid, uuid, numeric, numeric, text, numeric, numeric,
  numeric, numeric, text, text, jsonb, uuid, text, uuid, uuid, integer
) FROM anon;
GRANT EXECUTE ON FUNCTION public.process_sale(
  text, uuid, uuid, uuid, uuid, numeric, numeric, text, numeric, numeric,
  numeric, numeric, text, text, jsonb, uuid, text, uuid, uuid, integer
) TO authenticated, service_role;

-- 2. subscription_status: authenticated + service_role only ------------------
REVOKE ALL ON FUNCTION public.subscription_status(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.subscription_status(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.subscription_status(uuid) TO authenticated, service_role;

-- 3. product_components SELECT: branch-scoped through the parent product ------
DROP POLICY IF EXISTS "auth_select_product_components" ON public.product_components;
CREATE POLICY "auth_select_product_components" ON public.product_components FOR SELECT TO authenticated
USING (
  is_pos_admin() OR EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = product_components.product_id
      AND p.branch_id = get_branch_id()
  )
);
