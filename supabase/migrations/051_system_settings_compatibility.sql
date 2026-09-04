-- 051. Keep the existing centralized JSONB settings schema compatible with the System Control Center.
-- This migration is intentionally non-destructive: it preserves the existing config row.

CREATE TABLE IF NOT EXISTS public.system_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "system_settings_select_admin" ON public.system_settings;
CREATE POLICY "system_settings_select_admin" ON public.system_settings
  FOR SELECT TO authenticated
  USING (is_pos_admin());

DROP POLICY IF EXISTS "system_settings_insert_admin" ON public.system_settings;
CREATE POLICY "system_settings_insert_admin" ON public.system_settings
  FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin());

DROP POLICY IF EXISTS "system_settings_update_admin" ON public.system_settings;
CREATE POLICY "system_settings_update_admin" ON public.system_settings
  FOR UPDATE TO authenticated
  USING (is_pos_admin())
  WITH CHECK (is_pos_admin());

INSERT INTO public.system_settings (id, config)
VALUES (1, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.touch_system_settings()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  NEW.updated_by = auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_system_settings ON public.system_settings;
CREATE TRIGGER trg_touch_system_settings
BEFORE UPDATE ON public.system_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_system_settings();

-- Refresh PostgREST's schema cache after the compatibility migration.
NOTIFY pgrst, 'reload schema';
