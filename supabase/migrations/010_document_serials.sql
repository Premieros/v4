-- Migration: Sequential document serials (invoices & purchase invoices)
-- Run this in the Supabase SQL Editor AFTER migration_pin_login.sql (or any setup).
--
-- Adds:
--   1. `document_sequences` — atomic counters per document type (`sale`, `purchase`).
--   2. `next_document_number(p_type)` — returns `<store_name>-<NNNNN>` serial that
--      increments atomically (never duplicated, even under concurrency).
--
-- The POS / Purchases pages call this RPC just before creating a document, so the
-- number shown on the invoice, the receipt and in the lists is the store name + a
-- continuous sequential number (e.g. "Premier-00001").

-- ============ 1. SEQUENCE COUNTERS ============
CREATE TABLE IF NOT EXISTS public.document_sequences (
  seq_type   text PRIMARY KEY,
  next_value bigint NOT NULL DEFAULT 1
);

-- Seed the two default counters (no-op if they already exist).
INSERT INTO public.document_sequences (seq_type, next_value)
VALUES ('sale', 1), ('purchase', 1)
ON CONFLICT (seq_type) DO NOTHING;

-- ============ 2. ATOMIC SERIAL GENERATOR ============
-- SECURITY DEFINER so `authenticated` callers can use the counter without direct
-- table access. Allocates the next number atomically (row UPDATE ... RETURNING),
-- so concurrent calls never collide. Falls back to a robust upsert if a counter
-- row is missing for a given type.
CREATE OR REPLACE FUNCTION public.next_document_number(p_type text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store text;
  v_num   bigint;
BEGIN
  IF p_type NOT IN ('sale', 'purchase') THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TYPE');
  END IF;

  LOOP
    UPDATE public.document_sequences
       SET next_value = next_value + 1
     WHERE seq_type = p_type
    RETURNING next_value - 1 INTO v_num;
    EXIT WHEN v_num IS NOT NULL;

    -- Counter row missing: create it (first number = 1) and retry.
    INSERT INTO public.document_sequences (seq_type, next_value)
    VALUES (p_type, 2)
    ON CONFLICT (seq_type) DO NOTHING;
  END LOOP;

  SELECT btrim(coalesce(store_name, '')) INTO v_store FROM public.settings LIMIT 1;
  IF v_store IS NULL OR v_store = '' THEN
    v_store := 'POS';
  END IF;

  RETURN jsonb_build_object('success', true, 'number', v_store || '-' || lpad(v_num::text, 5, '0'), 'raw', v_num);
END;
$$;

REVOKE ALL ON FUNCTION public.next_document_number(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.next_document_number(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.next_document_number(text) TO authenticated;

-- Refresh the PostgREST schema cache so the new RPC is callable immediately.
NOTIFY pgrst, 'reload schema';
