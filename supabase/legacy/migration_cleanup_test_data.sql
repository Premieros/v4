-- Migration: Cleanup test data & invoices
-- Run this in the Supabase SQL Editor (or via run.js) to remove ALL test data.
--
-- DELETES: every sale/purchase invoice + items, shifts, stock transactions,
-- audit log, and the fake seed master data (customers, suppliers, categories,
-- products, test warehouses).
-- KEEPS: users, branches, roles, settings, Alexandria warehouses, and resets
-- the document serial counters back to 1 so real invoices start at -00001.

BEGIN;

-- ============ 1. SHIFTS ============
DELETE FROM public.shift_operations;
DELETE FROM public.shift_operations_legacy_20260801_180124;
DELETE FROM public.shifts_legacy_20260801_180124;
DELETE FROM public.shifts;

-- ============ 2. INVOICES ============
DELETE FROM public.sale_items;
DELETE FROM public.purchase_items;
DELETE FROM public.sales;
DELETE FROM public.purchases;

-- ============ 3. STOCK / PRODUCTS / MASTER DATA ============
DELETE FROM public.stock_transactions;
DELETE FROM public.inventory;
DELETE FROM public.product_components;
DELETE FROM public.product_units;
DELETE FROM public.branch_products;
DELETE FROM public.products;
DELETE FROM public.categories;
DELETE FROM public.customers;
DELETE FROM public.suppliers;

-- ============ 4. TEST WAREHOUSES (seed fake UUIDs) ============
DELETE FROM public.warehouses WHERE id::text LIKE 'a0000001-%';

-- ============ 5. AUDIT LOG (all test activity) ============
TRUNCATE TABLE public.audit_log;

-- ============ 6. RESET SERIAL COUNTERS ============
UPDATE public.document_sequences SET next_value = 1;

COMMIT;
