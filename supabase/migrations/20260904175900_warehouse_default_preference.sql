-- =============================================================================
-- One deterministic default warehouse per branch.
-- Used by guided POS/kitchen/raw-material flows whenever the user has not
-- explicitly selected a warehouse. Explicit warehouse selection always wins.
-- =============================================================================

ALTER TABLE public.warehouses
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

-- Preserve an already chosen default. For branches without one, choose the
-- oldest active warehouse deterministically so existing data keeps working.
WITH candidates AS (
  SELECT
    w.id,
    w.branch_id,
    row_number() OVER (
      PARTITION BY w.branch_id
      ORDER BY w.created_at NULLS LAST, w.id
    ) AS rn
  FROM public.warehouses w
  WHERE w.branch_id IS NOT NULL
    AND w.is_active = true
),
missing AS (
  SELECT DISTINCT c.branch_id
  FROM candidates c
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.warehouses d
    WHERE d.branch_id = c.branch_id
      AND d.is_default = true
  )
)
UPDATE public.warehouses w
SET is_default = true
FROM candidates c
JOIN missing m ON m.branch_id = c.branch_id
WHERE w.id = c.id
  AND c.rn = 1;

CREATE UNIQUE INDEX IF NOT EXISTS ux_warehouses_one_default_per_branch
  ON public.warehouses(branch_id)
  WHERE is_default = true AND branch_id IS NOT NULL;

-- If a caller marks another warehouse as default, clear the previous default
-- inside the same transaction before the unique index checks the final row.
CREATE OR REPLACE FUNCTION public.enforce_default_warehouse()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_default AND NEW.branch_id IS NOT NULL THEN
    UPDATE public.warehouses
    SET is_default = false
    WHERE branch_id = NEW.branch_id
      AND id <> NEW.id
      AND is_default = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_warehouses_default ON public.warehouses;
CREATE TRIGGER trg_warehouses_default
BEFORE INSERT OR UPDATE OF is_default, branch_id
ON public.warehouses
FOR EACH ROW
EXECUTE FUNCTION public.enforce_default_warehouse();
