-- Compatibility migration. The canonical subscription_settings schema is defined in 063.
-- The production repair is implemented idempotently in 067.
DO $$ BEGIN NULL; END $$;
