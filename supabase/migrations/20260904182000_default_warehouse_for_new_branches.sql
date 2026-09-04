-- Ensure every branch gets a deterministic default warehouse not only during
-- the historical backfill, but also when its first warehouse is created later.

CREATE OR REPLACE FUNCTION public.enforce_default_warehouse()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- The first active warehouse of a branch becomes its default automatically.
  -- This keeps guided POS/kitchen/waste flows deterministic for newly-created
  -- branches while still allowing an explicit default selection later.
  IF NEW.branch_id IS NOT NULL
     AND NEW.is_active = true
     AND NEW.is_default = false
     AND NOT EXISTS (
       SELECT 1
       FROM public.warehouses w
       WHERE w.branch_id = NEW.branch_id
         AND w.id <> NEW.id
         AND w.is_active = true
         AND w.is_default = true
     ) THEN
    NEW.is_default := true;
  END IF;

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
