-- CI-only fixture: integration tests exercise order/RLS behavior on a disposable Postgres.
-- The production subscription guard is tested separately. This fixture sets a
-- local-database-only flag so process_sale can exercise its normal business logic
-- without a real subscription fixture masking unrelated integration tests.
-- The flag is never enabled by production migrations or a real Supabase project.
ALTER DATABASE postgres SET app.ci_subscription_bypass = 'on';

-- create_order also has a BEFORE INSERT subscription trigger. Disable that trigger
-- only inside the disposable CI database; production remains fully guarded.
DO $$
DECLARE
  trigger_name text;
BEGIN
  SELECT t.tgname
    INTO trigger_name
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_proc p ON p.oid = t.tgfoid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'orders'
    AND p.proname = 'guard_order_subscription'
    AND NOT t.tgisinternal
  LIMIT 1;

  IF trigger_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.orders DISABLE TRIGGER %I', trigger_name);
  END IF;
END $$;
