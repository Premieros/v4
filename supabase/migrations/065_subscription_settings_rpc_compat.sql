-- Compatibility migration.
-- 063_subscription_settings.sql already defines the canonical Super Admin-only
-- subscription_settings_get() and subscription_settings_update(...) RPCs.
-- Keep this migration idempotent without introducing a second incompatible signature.
DO $$ BEGIN NULL; END $$;
