-- Multi-tenant foundation
-- Company/Tenant sits above branches. Existing branch-scoped RLS remains intact
-- until tenant-aware branch access is adopted table-by-table.

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  membership_role text NOT NULL DEFAULT 'owner',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id),
  CONSTRAINT organization_members_role_check
    CHECK (membership_role IN ('owner', 'admin', 'manager', 'member'))
);

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_branches_organization_id ON public.branches (organization_id);
CREATE INDEX IF NOT EXISTS idx_organization_members_org ON public.organization_members (organization_id);
CREATE INDEX IF NOT EXISTS idx_organization_members_user ON public.organization_members (user_id);

-- Backfill an isolated organization for every existing branch. This is intentionally
-- one-to-one so existing customer data cannot become cross-tenant visible.
INSERT INTO public.organizations (id, name, slug)
SELECT b.id,
       COALESCE(NULLIF(btrim(b.name), ''), 'Organization ' || b.id::text),
       'org-' || replace(b.id::text, '-', '')
FROM public.branches b
WHERE b.organization_id IS NULL
ON CONFLICT (id) DO NOTHING;

UPDATE public.branches b
SET organization_id = b.id
WHERE b.organization_id IS NULL;

-- Existing branch users become members of the branch's organization.
INSERT INTO public.organization_members (organization_id, user_id, membership_role)
SELECT b.organization_id,
       u.id,
       CASE WHEN u.role IN ('owner', 'super_admin') THEN 'owner' ELSE 'member' END
FROM public.users u
JOIN public.branches b ON b.id = u.branch_id
WHERE b.organization_id IS NOT NULL
ON CONFLICT (organization_id, user_id) DO NOTHING;

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organizations_select ON public.organizations;
CREATE POLICY organizations_select ON public.organizations
  FOR SELECT TO authenticated
  USING (
    is_pos_admin()
    OR EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = organizations.id
        AND om.user_id = auth.uid()
        AND om.is_active
    )
  );

DROP POLICY IF EXISTS organizations_insert ON public.organizations;
CREATE POLICY organizations_insert ON public.organizations
  FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin());

DROP POLICY IF EXISTS organizations_update ON public.organizations;
CREATE POLICY organizations_update ON public.organizations
  FOR UPDATE TO authenticated
  USING (
    is_pos_admin()
    OR EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = organizations.id
        AND om.user_id = auth.uid()
        AND om.membership_role IN ('owner', 'admin')
        AND om.is_active
    )
  )
  WITH CHECK (
    is_pos_admin()
    OR EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = organizations.id
        AND om.user_id = auth.uid()
        AND om.membership_role IN ('owner', 'admin')
        AND om.is_active
    )
  );

DROP POLICY IF EXISTS organizations_delete ON public.organizations;
CREATE POLICY organizations_delete ON public.organizations
  FOR DELETE TO authenticated
  USING (is_pos_admin());

DROP POLICY IF EXISTS organization_members_select ON public.organization_members;
CREATE POLICY organization_members_select ON public.organization_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_pos_admin());

DROP POLICY IF EXISTS organization_members_insert ON public.organization_members;
CREATE POLICY organization_members_insert ON public.organization_members
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR is_pos_admin());

DROP POLICY IF EXISTS organization_members_update ON public.organization_members;
CREATE POLICY organization_members_update ON public.organization_members
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR is_pos_admin())
  WITH CHECK (user_id = auth.uid() OR is_pos_admin());

DROP POLICY IF EXISTS organization_members_delete ON public.organization_members;
CREATE POLICY organization_members_delete ON public.organization_members
  FOR DELETE TO authenticated
  USING (is_pos_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_members TO authenticated;

CREATE OR REPLACE FUNCTION public.user_organization_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
  FROM public.organization_members
  WHERE user_id = auth.uid() AND is_active;
$$;

CREATE OR REPLACE FUNCTION public.user_can_access_organization(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_pos_admin()
      OR EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE organization_id = p_organization_id
          AND user_id = auth.uid()
          AND is_active
      );
$$;

CREATE OR REPLACE FUNCTION public.user_branch_ids_for_organization(p_organization_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id
  FROM public.branches b
  WHERE b.organization_id = p_organization_id
    AND user_can_access_organization(p_organization_id);
$$;

GRANT EXECUTE ON FUNCTION public.user_organization_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_access_organization(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_branch_ids_for_organization(uuid) TO authenticated;

COMMENT ON TABLE public.organizations IS 'Top-level tenant/company for Premier SaaS.';
COMMENT ON TABLE public.organization_members IS 'Users belonging to a tenant/company.';
