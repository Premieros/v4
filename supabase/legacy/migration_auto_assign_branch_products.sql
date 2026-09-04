-- Migration: Auto-assign new products to their home branch
-- Run this in the Supabase SQL Editor (or via run.js).
--
-- 1. Creates an AFTER INSERT trigger on products that automatically inserts
--    the new product into branch_products for its home branch
--    (NEW.branch_id, falling back to the creating user's branch).
-- 2. If no branch can be resolved the product is left unassigned; it can
--    still be assigned manually from BranchProductsPage.
-- 3. SECURITY DEFINER bypasses the is_pos_admin() INSERT policy so the
--    assignment works for any role that can create products.
-- 4. selling_price = NULL so process_sale uses the base unit price (the
--    per-branch override only applies when it is set and > 0).

BEGIN;

-- ---------- 1. AUTO-ASSIGN FUNCTION ----------
CREATE OR REPLACE FUNCTION auto_assign_branch_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch uuid;
BEGIN
  v_branch := COALESCE(NEW.branch_id, get_branch_id());

  IF v_branch IS NOT NULL THEN
    INSERT INTO branch_products (branch_id, product_id, is_active, selling_price, display_order)
    VALUES (v_branch, NEW.id, true, NULL, 0)
    ON CONFLICT (branch_id, product_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------- 2. TRIGGER ----------
DROP TRIGGER IF EXISTS trg_products_auto_assign_branch ON public.products;
CREATE TRIGGER trg_products_auto_assign_branch
AFTER INSERT ON public.products
FOR EACH ROW
EXECUTE FUNCTION auto_assign_branch_product();

COMMIT;
