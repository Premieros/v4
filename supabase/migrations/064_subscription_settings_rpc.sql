-- Compatibility migration.
-- Subscription settings schema and RPCs are defined canonically by 063_subscription_settings.sql.
-- This migration intentionally performs no schema mutation so fresh CI databases do not redefine
-- the singleton id column with a conflicting type.
DO $$ BEGIN NULL; END $$;
