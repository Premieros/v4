-- ============================================================================
-- Batch 2: Permissions + Super Admin Console
-- ============================================================================

-- ============================================================================
-- A. Branch Access Matrix: user_branch_access junction table
-- ============================================================================
-- Before: user_may_access_branch() gave org-wide access to ALL org members.
-- After:  non-admin/non-owner users only access branches they're explicitly
--         granted. Owners/admins retain full org-wide access.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_branch_access (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  branch_id  uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, branch_id)
);

ALTER TABLE public.user_branch_access ENABLE ROW LEVEL SECURITY;

-- Platform admin full access
DROP POLICY IF EXISTS auth_platform_admin_user_branch_access ON public.user_branch_access;
CREATE POLICY auth_platform_admin_user_branch_access ON public.user_branch_access
  FOR ALL USING (public.is_platform_admin());

-- Users can read their own grants
DROP POLICY IF EXISTS auth_select_own_user_branch_access ON public.user_branch_access;
CREATE POLICY auth_select_own_user_branch_access ON public.user_branch_access
  FOR SELECT USING (user_id = auth.uid());

-- Org owners/admins can manage grants for their org's users
DROP POLICY IF EXISTS auth_org_admin_manage_user_branch_access ON public.user_branch_access;
CREATE POLICY auth_org_admin_manage_user_branch_access ON public.user_branch_access
  FOR ALL USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.branches b
      WHERE b.id = user_branch_access.branch_id
        AND b.organization_id IN (SELECT public.user_organization_ids())
        AND EXISTS (
          SELECT 1 FROM public.organization_members om
          WHERE om.user_id = auth.uid()
            AND om.organization_id = b.organization_id
            AND om.membership_role IN ('owner', 'admin')
            AND om.is_active = true
        )
    )
  );

-- Grant authenticated read access
GRANT SELECT ON public.user_branch_access TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.user_branch_access TO authenticated;

-- ============================================================================
-- Seed: backfill user_branch_access from existing users.branch_id
-- ============================================================================
INSERT INTO public.user_branch_access (user_id, branch_id)
SELECT DISTINCT id, branch_id
FROM public.users
WHERE branch_id IS NOT NULL
ON CONFLICT (user_id, branch_id) DO NOTHING;

-- Also seed: org owners/admins get access to ALL branches in their orgs
INSERT INTO public.user_branch_access (user_id, branch_id)
SELECT DISTINCT om.user_id, b.id
FROM public.organization_members om
JOIN public.branches b ON b.organization_id = om.organization_id
WHERE om.membership_role IN ('owner', 'admin')
  AND om.is_active = true
  AND b.is_active = true
ON CONFLICT (user_id, branch_id) DO NOTHING;

-- ============================================================================
-- B. Tighten user_may_access_branch()
-- ============================================================================
-- Priority order:
-- 1. Platform admin (super_admin) → all branches
-- 2. User has explicit grant in user_branch_access → that branch
-- 3. Org owner/admin → all branches in their orgs
-- 4. Otherwise → denied
-- ============================================================================

CREATE OR REPLACE FUNCTION public.user_may_access_branch(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- Platform admin sees everything
    public.is_platform_admin()
    -- Explicit per-user branch grant
    OR EXISTS (
      SELECT 1 FROM public.user_branch_access uba
      WHERE uba.user_id = auth.uid()
        AND uba.branch_id = p_branch_id
    )
    -- Org owners/admins see all branches in their orgs
    OR EXISTS (
      SELECT 1 FROM public.branches b
      JOIN public.organization_members om
        ON om.organization_id = b.organization_id
      WHERE b.id = p_branch_id
        AND om.user_id = auth.uid()
        AND om.membership_role IN ('owner', 'admin')
        AND om.is_active = true
    )
    -- Legacy fallback: users.branch_id grants access to that branch.
    -- This keeps existing integration tests working while we migrate to
    -- the explicit user_branch_access model.
    OR EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.branch_id = p_branch_id
    )
    -- Legacy fallback: NULL branch for platform admin only (already covered above)
    OR (p_branch_id IS NULL AND public.is_platform_admin());
$$;

GRANT EXECUTE ON FUNCTION public.user_may_access_branch(uuid) TO authenticated;

-- ============================================================================
-- C. RPCs for branch access management
-- ============================================================================

-- Get all branches a user has access to (with org context)
CREATE OR REPLACE FUNCTION public.get_user_branch_access(p_user_id uuid)
RETURNS TABLE (
  branch_id   uuid,
  branch_name text,
  branch_name_en text,
  organization_id uuid,
  is_active   boolean,
  grant_source text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Explicit grants
  SELECT b.id, b.name, b.name_en, b.organization_id, b.is_active,
         'explicit'::text
  FROM public.user_branch_access uba
  JOIN public.branches b ON b.id = uba.branch_id
  WHERE uba.user_id = p_user_id
  UNION
  -- Org-wide access for owners/admins
  SELECT b.id, b.name, b.name_en, b.organization_id, b.is_active,
         'org_role'::text
  FROM public.branches b
  JOIN public.organization_members om ON om.organization_id = b.organization_id
  WHERE om.user_id = p_user_id
    AND om.membership_role IN ('owner', 'admin')
    AND om.is_active = true
    AND b.is_active = true
  ORDER BY 2;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_branch_access(uuid) TO authenticated;

-- Assign user to branch (explicit grant)
CREATE OR REPLACE FUNCTION public.assign_user_to_branch(
  p_user_id uuid,
  p_branch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_target_org uuid;
BEGIN
  -- Auth: caller must be platform admin or org owner/admin
  IF NOT public.is_platform_admin() THEN
    SELECT b.organization_id INTO v_target_org
    FROM public.branches b WHERE b.id = p_branch_id;

    IF NOT EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.user_id = v_caller_id
        AND om.organization_id = v_target_org
        AND om.membership_role IN ('owner', 'admin')
        AND om.is_active = true
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
    END IF;
  END IF;

  -- Verify branch exists
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_NOT_FOUND');
  END IF;

  -- Verify target user exists
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;

  -- Insert grant (ignore duplicate)
  INSERT INTO public.user_branch_access (user_id, branch_id)
  VALUES (p_user_id, p_branch_id)
  ON CONFLICT (user_id, branch_id) DO NOTHING;

  -- Audit
  PERFORM public.log_audit_action(
    'assign_branch', 'user_branch_access', NULL,
    jsonb_build_object('user_id', p_user_id, 'branch_id', p_branch_id),
    NULL, NULL, NULL
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_user_to_branch(uuid, uuid) TO authenticated;

-- Remove user from branch (revoke grant)
CREATE OR REPLACE FUNCTION public.remove_user_from_branch(
  p_user_id uuid,
  p_branch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_target_org uuid;
BEGIN
  -- Auth: caller must be platform admin or org owner/admin
  IF NOT public.is_platform_admin() THEN
    SELECT b.organization_id INTO v_target_org
    FROM public.branches b WHERE b.id = p_branch_id;

    IF NOT EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.user_id = v_caller_id
        AND om.organization_id = v_target_org
        AND om.membership_role IN ('owner', 'admin')
        AND om.is_active = true
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
    END IF;
  END IF;

  -- Cannot remove the last branch grant for an active user
  IF (
    SELECT count(*) FROM public.user_branch_access WHERE user_id = p_user_id
  ) <= 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'LAST_BRANCH');
  END IF;

  DELETE FROM public.user_branch_access
  WHERE user_id = p_user_id AND branch_id = p_branch_id;

  -- Audit
  PERFORM public.log_audit_action(
    'remove_branch', 'user_branch_access', NULL,
    jsonb_build_object('user_id', p_user_id, 'branch_id', p_branch_id),
    NULL, NULL, NULL
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_user_from_branch(uuid, uuid) TO authenticated;

-- Bulk set user's branch access (replaces all grants)
CREATE OR REPLACE FUNCTION public.set_user_branch_access(
  p_user_id uuid,
  p_branch_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_target_org uuid;
  v_branch_id uuid;
BEGIN
  -- Auth: caller must be platform admin or org owner/admin of ALL target branches
  IF NOT public.is_platform_admin() THEN
    FOREACH v_branch_id IN ARRAY p_branch_ids LOOP
      SELECT b.organization_id INTO v_target_org
      FROM public.branches b WHERE b.id = v_branch_id;

      IF NOT EXISTS (
        SELECT 1 FROM public.organization_members om
        WHERE om.user_id = v_caller_id
          AND om.organization_id = v_target_org
          AND om.membership_role IN ('owner', 'admin')
          AND om.is_active = true
      ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
      END IF;
    END LOOP;
  END IF;

  -- Must provide at least one branch
  IF array_length(p_branch_ids, 1) IS NULL OR array_length(p_branch_ids, 1) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'AT_LEAST_ONE_BRANCH');
  END IF;

  -- Replace all grants atomically
  DELETE FROM public.user_branch_access WHERE user_id = p_user_id;
  INSERT INTO public.user_branch_access (user_id, branch_id)
  SELECT p_user_id, unnest(p_branch_ids)
  ON CONFLICT DO NOTHING;

  -- Audit
  PERFORM public.log_audit_action(
    'set_branch_access', 'user_branch_access', NULL,
    jsonb_build_object('user_id', p_user_id, 'branch_ids', p_branch_ids),
    NULL, NULL, NULL
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_user_branch_access(uuid, uuid[]) TO authenticated;

-- ============================================================================
-- D. Super Admin Console RPCs
-- ============================================================================

-- Get all tenants with branch/user/subscription stats
CREATE OR REPLACE FUNCTION public.get_super_admin_tenant_stats()
RETURNS TABLE (
  organization_id   uuid,
  organization_name text,
  organization_slug text,
  is_active         boolean,
  created_at        timestamptz,
  branch_count      bigint,
  user_count        bigint,
  total_branches    bigint,
  active_branches   bigint,
  has_active_subscription boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    o.id,
    o.name,
    o.slug,
    o.is_active,
    o.created_at,
    (SELECT count(*) FROM public.branches b WHERE b.organization_id = o.id),
    (SELECT count(*) FROM public.organization_members om WHERE om.organization_id = o.id AND om.is_active = true),
    (SELECT count(*) FROM public.branches b WHERE b.organization_id = o.id),
    (SELECT count(*) FROM public.branches b WHERE b.organization_id = o.id AND b.is_active = true),
    EXISTS (
      SELECT 1 FROM public.branches b
      JOIN public.branch_subscriptions bs ON bs.branch_id = b.id
      WHERE b.organization_id = o.id
        AND bs.status = 'active'
        AND bs.current_period_ends_at > now()
    )
  FROM public.organizations o
  ORDER BY o.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_super_admin_tenant_stats() TO authenticated;

-- Get all users across all tenants (for super admin)
CREATE OR REPLACE FUNCTION public.get_super_admin_all_users(
  p_search text DEFAULT NULL
)
RETURNS TABLE (
  user_id     uuid,
  email       text,
  username    text,
  full_name   text,
  role        text,
  is_active   boolean,
  branch_id   uuid,
  branch_name text,
  org_id      uuid,
  org_name    text,
  created_at  timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.id, u.email, u.username, u.full_name, u.role, u.is_active,
    u.branch_id,
    b.name,
    om.organization_id,
    o.name,
    u.created_at
  FROM public.users u
  LEFT JOIN public.branches b ON b.id = u.branch_id
  LEFT JOIN public.organization_members om ON om.user_id = u.id AND om.is_active = true
  LEFT JOIN public.organizations o ON o.id = om.organization_id
  WHERE p_search IS NULL
     OR u.email ILIKE '%' || p_search || '%'
     OR u.username ILIKE '%' || p_search || '%'
     OR u.full_name ILIKE '%' || p_search || '%'
  ORDER BY u.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_super_admin_all_users(text) TO authenticated;

-- Toggle organization active status (super admin only)
CREATE OR REPLACE FUNCTION public.toggle_organization_status(
  p_org_id uuid,
  p_is_active boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  UPDATE public.organizations SET is_active = p_is_active WHERE id = p_org_id;

  PERFORM public.log_audit_action(
    CASE WHEN p_is_active THEN 'activate_organization' ELSE 'deactivate_organization' END,
    'organizations', p_org_id,
    jsonb_build_object('is_active', p_is_active),
    NULL, NULL, NULL
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.toggle_organization_status(uuid, boolean) TO authenticated;

-- ============================================================================
-- E. Client-side: update create_user to auto-grant branch access
-- ============================================================================

-- After a user is created with a branch_id, ensure they have an explicit
-- grant in user_branch_access for that branch.

CREATE OR REPLACE FUNCTION public._ensure_branch_access_after_user_create()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.branch_id IS NOT NULL THEN
    INSERT INTO public.user_branch_access (user_id, branch_id)
    VALUES (NEW.id, NEW.branch_id)
    ON CONFLICT (user_id, branch_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_branch_access ON public.users;
CREATE TRIGGER trg_ensure_branch_access
  AFTER INSERT ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public._ensure_branch_access_after_user_create();
