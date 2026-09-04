-- ============================================================================
-- 042. Realtime publication for POS live counters
-- ----------------------------------------------------------------------------
-- The POS header strip shows live counters (occupied tables / held / delivery /
-- takeaway). It subscribes via supabase.channel('pos-live-summary') to
-- postgres_changes on orders and dining_tables. Those tables must be members of
-- the supabase_realtime publication, otherwise the browser subscription is
-- rejected. The publication may not exist in some self-hosted / CI setups, so
-- this migration is guarded and idempotent (no-op on Postgres without the
-- supabase_realtime publication).
--
-- NOTE: on hosted Supabase the project owner should also enable realtime for
-- these tables via the dashboard (Database > Replication) or this same SQL; the
-- guard here only makes sure the migration never breaks existing deployments.
-- ============================================================================

DO $$
DECLARE
  pub_exists boolean;
  tbl text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) INTO pub_exists;

  IF pub_exists THEN
    FOREACH tbl IN ARRAY ARRAY['public.orders', 'public.dining_tables'] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables pt
        WHERE pt.pubname = 'supabase_realtime'
          AND pt.schemaname || '.' || pt.tablename = tbl
      ) THEN
        EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE ' || tbl;
      END IF;
    END LOOP;
  END IF;
END $$;
