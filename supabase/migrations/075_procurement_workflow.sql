-- =====================================================================
-- P0 Procurement Workflow: Purchase Request -> RFQ -> Supplier Quotation
-- -> Purchase Order (approval lifecycle) -> Receiving (GRN) -> Backorders
-- -> Payment (existing pay_supplier) + Supplier evaluation/history.
--
-- Additive-only. New tables and RPCs sit alongside the legacy
-- process_purchase quick path (unchanged). The PO reuses `purchases` so the
-- existing inventory/ledger/reporting chain stays intact:
--   * create_purchase_order  -> purchases with status 'draft' (no posting)
--   * update_purchase_order_status -> draft -> submitted -> approved
--   * receive_purchase_order -> GRN; inventory is added per receipt line;
--     when fully received the PO is posted to the ledger exactly like
--     process_purchase (inventory_fg/rm + vat_receivable + discount_received
--     + cash/bank + AP) via the idempotent _post_journal_entry.
--   * backorders = purchase_items.quantity - received_quantity.
--
-- All state transitions go through SECURITY DEFINER RPCs enforcing
-- is_pos_admin()/can_permission('purchases.manage') and branch isolation;
-- RLS policies below are a backstop and never weaken existing RLS.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Workflow columns on existing documents
-- ---------------------------------------------------------------------
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS request_id uuid;

ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS received_quantity numeric(14,4) NOT NULL DEFAULT 0;

-- Status CHECK on purchases (additive, only when existing rows comply).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchases_status_check'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.purchases
    WHERE status IS NULL OR status NOT IN (
      'draft', 'submitted', 'approved', 'completed', 'partial', 'returned', 'cancelled'
    )
  ) THEN
    ALTER TABLE public.purchases ADD CONSTRAINT purchases_status_check
      CHECK (status IN ('draft', 'submitted', 'approved', 'completed', 'partial', 'returned', 'cancelled'));
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. Purchase Requests
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchase_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number    text NOT NULL UNIQUE,
  branch_id         uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  supplier_id       uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'ordered', 'cancelled')),
  priority          text NOT NULL DEFAULT 'normal'
                    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  expected_date     date,
  notes             text,
  requested_by      uuid REFERENCES public.users(id),
  approved_by       uuid REFERENCES public.users(id),
  approved_at       timestamptz,
  created_by        uuid REFERENCES public.users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.purchase_requests IS 'طلبات الشراء (بداية سلسلة المشتريات)';
CREATE INDEX IF NOT EXISTS idx_purchase_requests_branch ON public.purchase_requests(branch_id, created_at);

-- FK from purchases.request_id (deferred until the table above exists).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchases_request_id_fk') THEN
    ALTER TABLE public.purchases ADD CONSTRAINT purchases_request_id_fk
      FOREIGN KEY (request_id) REFERENCES public.purchase_requests(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.purchase_request_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id        uuid NOT NULL REFERENCES public.purchase_requests(id) ON DELETE CASCADE,
  product_id        uuid REFERENCES public.products(id) ON DELETE SET NULL,
  raw_material_id   uuid REFERENCES public.raw_materials(id) ON DELETE SET NULL,
  quantity          numeric(14,4) NOT NULL CHECK (quantity > 0),
  unit_name         text NOT NULL DEFAULT 'piece',
  estimated_cost    numeric(12,2),
  notes             text,
  CONSTRAINT purchase_request_items_one_target CHECK (
    (product_id IS NOT NULL) <> (raw_material_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_purchase_request_items_request ON public.purchase_request_items(request_id);

INSERT INTO public.document_sequences (seq_type, next_value) VALUES ('purchase_request', 1)
ON CONFLICT (seq_type) DO NOTHING;

ALTER TABLE public.purchase_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS purchase_requests_select ON public.purchase_requests;
CREATE POLICY purchase_requests_select ON public.purchase_requests
  FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS purchase_requests_insert ON public.purchase_requests;
CREATE POLICY purchase_requests_insert ON public.purchase_requests
  FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR (can_permission('purchases.manage') AND branch_id = get_branch_id()));
DROP POLICY IF EXISTS purchase_requests_update ON public.purchase_requests;
CREATE POLICY purchase_requests_update ON public.purchase_requests
  FOR UPDATE TO authenticated
  USING (is_pos_admin() OR (can_permission('purchases.manage') AND branch_id = get_branch_id()))
  WITH CHECK (is_pos_admin() OR (can_permission('purchases.manage') AND branch_id = get_branch_id()));
DROP POLICY IF EXISTS purchase_requests_delete ON public.purchase_requests;
CREATE POLICY purchase_requests_delete ON public.purchase_requests
  FOR DELETE TO authenticated
  USING (is_pos_admin() OR (can_permission('purchases.manage') AND branch_id = get_branch_id()));

ALTER TABLE public.purchase_request_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS purchase_request_items_select ON public.purchase_request_items;
CREATE POLICY purchase_request_items_select ON public.purchase_request_items
  FOR SELECT TO authenticated
  USING (is_pos_admin() OR EXISTS (
    SELECT 1 FROM public.purchase_requests r
    WHERE r.id = request_id AND r.branch_id = get_branch_id()));
DROP POLICY IF EXISTS purchase_request_items_write ON public.purchase_request_items;
CREATE POLICY purchase_request_items_write ON public.purchase_request_items
  FOR ALL TO authenticated
  USING (is_pos_admin() OR (can_permission('purchases.manage') AND EXISTS (
    SELECT 1 FROM public.purchase_requests r
    WHERE r.id = request_id AND r.branch_id = get_branch_id())))
  WITH CHECK (is_pos_admin() OR (can_permission('purchases.manage') AND EXISTS (
    SELECT 1 FROM public.purchase_requests r
    WHERE r.id = request_id AND r.branch_id = get_branch_id())));

-- ---------------------------------------------------------------------
-- 2. RFQs
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rfqs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_number        text NOT NULL UNIQUE,
  branch_id         uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  request_id        uuid REFERENCES public.purchase_requests(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'sent', 'received', 'awarded', 'cancelled')),
  due_date          date,
  notes             text,
  created_by        uuid REFERENCES public.users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.rfqs IS 'طلبات عروض الأسعار (وسط سلسلة المشتريات)';
CREATE INDEX IF NOT EXISTS idx_rfqs_branch ON public.rfqs(branch_id, created_at);

CREATE TABLE IF NOT EXISTS public.rfq_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id            uuid NOT NULL REFERENCES public.rfqs(id) ON DELETE CASCADE,
  product_id        uuid REFERENCES public.products(id) ON DELETE SET NULL,
  raw_material_id   uuid REFERENCES public.raw_materials(id) ON DELETE SET NULL,
  quantity          numeric(14,4) NOT NULL CHECK (quantity > 0),
  unit_name         text NOT NULL DEFAULT 'piece',
  notes             text,
  CONSTRAINT rfq_items_one_target CHECK (
    (product_id IS NOT NULL) <> (raw_material_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_rfq_items_rfq ON public.rfq_items(rfq_id);

INSERT INTO public.document_sequences (seq_type, next_value) VALUES ('rfq', 1)
ON CONFLICT (seq_type) DO NOTHING;

ALTER TABLE public.rfqs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rfqs_select ON public.rfqs;
CREATE POLICY rfqs_select ON public.rfqs
  FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS rfqs_write ON public.rfqs;
CREATE POLICY rfqs_write ON public.rfqs
  FOR ALL TO authenticated
  USING (is_pos_admin() OR (can_permission('purchases.manage') AND branch_id = get_branch_id()))
  WITH CHECK (is_pos_admin() OR (can_permission('purchases.manage') AND branch_id = get_branch_id()));

ALTER TABLE public.rfq_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rfq_items_select ON public.rfq_items;
CREATE POLICY rfq_items_select ON public.rfq_items
  FOR SELECT TO authenticated
  USING (is_pos_admin() OR EXISTS (
    SELECT 1 FROM public.rfqs r
    WHERE r.id = rfq_id AND r.branch_id = get_branch_id()));
DROP POLICY IF EXISTS rfq_items_write ON public.rfq_items;
CREATE POLICY rfq_items_write ON public.rfq_items
  FOR ALL TO authenticated
  USING (is_pos_admin() OR (can_permission('purchases.manage') AND EXISTS (
    SELECT 1 FROM public.rfqs r
    WHERE r.id = rfq_id AND r.branch_id = get_branch_id())))
  WITH CHECK (is_pos_admin() OR (can_permission('purchases.manage') AND EXISTS (
    SELECT 1 FROM public.rfqs r
    WHERE r.id = rfq_id AND r.branch_id = get_branch_id())));

-- ---------------------------------------------------------------------
-- 3. Supplier Quotations
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.supplier_quotations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_number  text NOT NULL UNIQUE,
  branch_id         uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  rfq_id            uuid REFERENCES public.rfqs(id) ON DELETE SET NULL,
  supplier_id       uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'received'
                    CHECK (status IN ('draft', 'received', 'selected', 'rejected', 'expired')),
  valid_until       date,
  delivery_days     integer,
  total             numeric(14,2) NOT NULL DEFAULT 0,
  notes             text,
  created_by        uuid REFERENCES public.users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.supplier_quotations IS 'عروض أسعار الموردين';
CREATE INDEX IF NOT EXISTS idx_supplier_quotations_rfq ON public.supplier_quotations(rfq_id, supplier_id);

CREATE TABLE IF NOT EXISTS public.supplier_quotation_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id      uuid NOT NULL REFERENCES public.supplier_quotations(id) ON DELETE CASCADE,
  product_id        uuid REFERENCES public.products(id) ON DELETE SET NULL,
  raw_material_id   uuid REFERENCES public.raw_materials(id) ON DELETE SET NULL,
  quantity          numeric(14,4) NOT NULL CHECK (quantity > 0),
  unit_cost         numeric(12,2) NOT NULL DEFAULT 0,
  total             numeric(14,2) NOT NULL DEFAULT 0,
  CONSTRAINT supplier_quotation_items_one_target CHECK (
    (product_id IS NOT NULL) <> (raw_material_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_supplier_quotation_items_quote ON public.supplier_quotation_items(quotation_id);

INSERT INTO public.document_sequences (seq_type, next_value) VALUES ('supplier_quotation', 1)
ON CONFLICT (seq_type) DO NOTHING;

ALTER TABLE public.supplier_quotations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_quotations_select ON public.supplier_quotations;
CREATE POLICY supplier_quotations_select ON public.supplier_quotations
  FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS supplier_quotations_write ON public.supplier_quotations;
CREATE POLICY supplier_quotations_write ON public.supplier_quotations
  FOR ALL TO authenticated
  USING (is_pos_admin() OR (can_permission('purchases.manage') AND branch_id = get_branch_id()))
  WITH CHECK (is_pos_admin() OR (can_permission('purchases.manage') AND branch_id = get_branch_id()));

ALTER TABLE public.supplier_quotation_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_quotation_items_select ON public.supplier_quotation_items;
CREATE POLICY supplier_quotation_items_select ON public.supplier_quotation_items
  FOR SELECT TO authenticated
  USING (is_pos_admin() OR EXISTS (
    SELECT 1 FROM public.supplier_quotations q
    WHERE q.id = quotation_id AND q.branch_id = get_branch_id()));
DROP POLICY IF EXISTS supplier_quotation_items_write ON public.supplier_quotation_items;
CREATE POLICY supplier_quotation_items_write ON public.supplier_quotation_items
  FOR ALL TO authenticated
  USING (is_pos_admin() OR (can_permission('purchases.manage') AND EXISTS (
    SELECT 1 FROM public.supplier_quotations q
    WHERE q.id = quotation_id AND q.branch_id = get_branch_id())))
  WITH CHECK (is_pos_admin() OR (can_permission('purchases.manage') AND EXISTS (
    SELECT 1 FROM public.supplier_quotations q
    WHERE q.id = quotation_id AND q.branch_id = get_branch_id())));

-- ---------------------------------------------------------------------
-- 4. Receiving (GRN) + backorder tracking
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchase_receipts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number    text NOT NULL UNIQUE,
  purchase_id       uuid NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
  branch_id         uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  warehouse_id      uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
  received_by       uuid REFERENCES public.users(id),
  notes             text,
  received_at       timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.purchase_receipts IS 'إيصالات استلام المشتريات (GRN)';
CREATE INDEX IF NOT EXISTS idx_purchase_receipts_purchase ON public.purchase_receipts(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_receipts_branch ON public.purchase_receipts(branch_id, received_at);

CREATE TABLE IF NOT EXISTS public.purchase_receipt_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id         uuid NOT NULL REFERENCES public.purchase_receipts(id) ON DELETE CASCADE,
  purchase_item_id   uuid NOT NULL REFERENCES public.purchase_items(id) ON DELETE CASCADE,
  quantity_received  numeric(14,4) NOT NULL CHECK (quantity_received > 0),
  unit_cost          numeric(12,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_purchase_receipt_items_receipt ON public.purchase_receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_purchase_receipt_items_pitem ON public.purchase_receipt_items(purchase_item_id);

INSERT INTO public.document_sequences (seq_type, next_value) VALUES ('purchase_receipt', 1)
ON CONFLICT (seq_type) DO NOTHING;

ALTER TABLE public.purchase_receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS purchase_receipts_select ON public.purchase_receipts;
CREATE POLICY purchase_receipts_select ON public.purchase_receipts
  FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS purchase_receipts_write ON public.purchase_receipts;
CREATE POLICY purchase_receipts_write ON public.purchase_receipts
  FOR ALL TO authenticated
  USING (is_pos_admin() OR (can_permission('purchases.manage') AND branch_id = get_branch_id()))
  WITH CHECK (is_pos_admin() OR (can_permission('purchases.manage') AND branch_id = get_branch_id()));

ALTER TABLE public.purchase_receipt_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS purchase_receipt_items_select ON public.purchase_receipt_items;
CREATE POLICY purchase_receipt_items_select ON public.purchase_receipt_items
  FOR SELECT TO authenticated
  USING (is_pos_admin() OR EXISTS (
    SELECT 1 FROM public.purchase_receipts r
    WHERE r.id = receipt_id AND r.branch_id = get_branch_id()));
DROP POLICY IF EXISTS purchase_receipt_items_write ON public.purchase_receipt_items;
CREATE POLICY purchase_receipt_items_write ON public.purchase_receipt_items
  FOR ALL TO authenticated
  USING (is_pos_admin() OR (can_permission('purchases.manage') AND EXISTS (
    SELECT 1 FROM public.purchase_receipts r
    WHERE r.id = receipt_id AND r.branch_id = get_branch_id())))
  WITH CHECK (is_pos_admin() OR (can_permission('purchases.manage') AND EXISTS (
    SELECT 1 FROM public.purchase_receipts r
    WHERE r.id = receipt_id AND r.branch_id = get_branch_id())));

-- ---------------------------------------------------------------------
-- 5. create_purchase_request: draft request with optional line items
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_purchase_request(
  p_branch_id uuid,
  p_supplier_id uuid DEFAULT NULL,
  p_priority text DEFAULT 'normal',
  p_expected_date date DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_items jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_request_id uuid;
  v_number text;
  v_user_branch uuid;
  v_item jsonb;
  v_rows integer := 0;
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND NOT can_permission('purchases.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
        'detail', 'Purchase requests require the purchases.manage permission.');
    END IF;
    IF p_branch_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'MISSING_BRANCH');
    END IF;
    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND v_user_branch <> p_branch_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    v_number := (public.next_document_number('purchase_request')->>'number')::text;

    INSERT INTO public.purchase_requests
      (request_number, branch_id, supplier_id, status, priority, expected_date, notes, requested_by, created_by)
    VALUES (v_number, p_branch_id, p_supplier_id, 'draft', COALESCE(p_priority, 'normal'),
            p_expected_date, p_notes, auth.uid(), auth.uid())
    RETURNING id INTO v_request_id;

    IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
      FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
      LOOP
        IF (v_item->>'product_id') IS NULL AND (v_item->>'raw_material_id') IS NULL THEN
          RETURN jsonb_build_object('success', false, 'error', 'ITEM_MISSING_TYPE');
        END IF;
        INSERT INTO public.purchase_request_items
          (request_id, product_id, raw_material_id, quantity, unit_name, estimated_cost, notes)
        VALUES (v_request_id,
          NULLIF(v_item->>'product_id', '')::uuid,
          NULLIF(v_item->>'raw_material_id', '')::uuid,
          COALESCE((v_item->>'quantity')::numeric, 0),
          COALESCE(NULLIF(v_item->>'unit_name', ''), 'piece'),
          NULLIF(v_item->>'estimated_cost', '')::numeric,
          NULLIF(v_item->>'notes', ''));
        v_rows := v_rows + 1;
      END LOOP;
    END IF;

    RETURN jsonb_build_object('success', true, 'request_id', v_request_id,
      'request_number', v_number, 'items_added', v_rows);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.create_purchase_request(uuid, uuid, text, date, text, jsonb) TO authenticated;

-- ---------------------------------------------------------------------
-- 6. update_purchase_request_status: draft->submitted->approved/rejected/...
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_purchase_request_status(
  p_request_id uuid,
  p_status text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_request record;
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND NOT can_permission('purchases.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;
    SELECT * INTO v_request FROM public.purchase_requests WHERE id = p_request_id FOR UPDATE;
    IF v_request.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'REQUEST_NOT_FOUND');
    END IF;
    IF NOT is_pos_admin() AND get_branch_id() IS NOT NULL AND get_branch_id() <> v_request.branch_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;

    IF p_status = 'submitted' THEN
      IF v_request.status <> 'draft' THEN
        RETURN jsonb_build_object('success', false, 'error', 'BAD_TRANSITION', 'from', v_request.status, 'to', p_status);
      END IF;
    ELSIF p_status IN ('approved', 'rejected') THEN
      IF v_request.status <> 'submitted' THEN
        RETURN jsonb_build_object('success', false, 'error', 'BAD_TRANSITION', 'from', v_request.status, 'to', p_status);
      END IF;
    ELSIF p_status = 'cancelled' THEN
      IF v_request.status NOT IN ('draft', 'submitted') THEN
        RETURN jsonb_build_object('success', false, 'error', 'BAD_TRANSITION', 'from', v_request.status, 'to', p_status);
      END IF;
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS');
    END IF;

    UPDATE public.purchase_requests
    SET status = p_status,
        approved_by = CASE WHEN p_status = 'approved' THEN auth.uid() ELSE approved_by END,
        approved_at = CASE WHEN p_status = 'approved' THEN now() ELSE approved_at END
    WHERE id = p_request_id;

    RETURN jsonb_build_object('success', true, 'request_id', p_request_id, 'status', p_status);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.update_purchase_request_status(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 7. create_rfq: standalone or copied from an approved purchase request
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_rfq(
  p_branch_id uuid,
  p_request_id uuid DEFAULT NULL,
  p_due_date date DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_items jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_rfq_id uuid;
  v_number text;
  v_user_branch uuid;
  v_item record;
  v_rows integer := 0;
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND NOT can_permission('purchases.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;
    IF p_branch_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'MISSING_BRANCH');
    END IF;
    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND v_user_branch <> p_branch_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    v_number := (public.next_document_number('rfq')->>'number')::text;

    INSERT INTO public.rfqs (rfq_number, branch_id, request_id, status, due_date, notes, created_by)
    VALUES (v_number, p_branch_id, p_request_id, 'draft', p_due_date, p_notes, auth.uid())
    RETURNING id INTO v_rfq_id;

    IF p_request_id IS NOT NULL THEN
      -- Copy items from the (approved) purchase request.
      FOR v_item IN
        SELECT product_id, raw_material_id, quantity, unit_name, notes
        FROM public.purchase_request_items WHERE request_id = p_request_id
      LOOP
        INSERT INTO public.rfq_items (rfq_id, product_id, raw_material_id, quantity, unit_name, notes)
        VALUES (v_rfq_id, v_item.product_id, v_item.raw_material_id, v_item.quantity,
                COALESCE(v_item.unit_name, 'piece'), v_item.notes);
        v_rows := v_rows + 1;
      END LOOP;
    ELSIF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
      FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
      LOOP
        IF (v_item->>'product_id') IS NULL AND (v_item->>'raw_material_id') IS NULL THEN
          RETURN jsonb_build_object('success', false, 'error', 'ITEM_MISSING_TYPE');
        END IF;
        INSERT INTO public.rfq_items (rfq_id, product_id, raw_material_id, quantity, unit_name, notes)
        VALUES (v_rfq_id,
          NULLIF(v_item->>'product_id', '')::uuid,
          NULLIF(v_item->>'raw_material_id', '')::uuid,
          COALESCE((v_item->>'quantity')::numeric, 0),
          COALESCE(NULLIF(v_item->>'unit_name', ''), 'piece'),
          NULLIF(v_item->>'notes', ''));
        v_rows := v_rows + 1;
      END LOOP;
    END IF;

    RETURN jsonb_build_object('success', true, 'rfq_id', v_rfq_id,
      'rfq_number', v_number, 'items_added', v_rows);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.create_rfq(uuid, uuid, date, text, jsonb) TO authenticated;

-- ---------------------------------------------------------------------
-- 8. update_rfq_status: draft->sent->received; award/cancel handling
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_rfq_status(
  p_rfq_id uuid,
  p_status text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_rfq record;
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND NOT can_permission('purchases.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;
    SELECT * INTO v_rfq FROM public.rfqs WHERE id = p_rfq_id FOR UPDATE;
    IF v_rfq.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'RFQ_NOT_FOUND');
    END IF;
    IF NOT is_pos_admin() AND get_branch_id() IS NOT NULL AND get_branch_id() <> v_rfq.branch_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;

    IF p_status IN ('sent', 'received') THEN
      IF v_rfq.status NOT IN ('draft', 'sent', 'received') THEN
        RETURN jsonb_build_object('success', false, 'error', 'BAD_TRANSITION', 'from', v_rfq.status, 'to', p_status);
      END IF;
    ELSIF p_status = 'cancelled' THEN
      IF v_rfq.status IN ('awarded', 'cancelled') THEN
        RETURN jsonb_build_object('success', false, 'error', 'BAD_TRANSITION', 'from', v_rfq.status, 'to', p_status);
      END IF;
    ELSIF p_status = 'awarded' THEN
      IF NOT EXISTS (SELECT 1 FROM public.supplier_quotations q
                     WHERE q.rfq_id = p_rfq_id AND q.status = 'selected') THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_SELECTED_QUOTATION');
      END IF;
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS');
    END IF;

    UPDATE public.rfqs SET status = p_status WHERE id = p_rfq_id;
    RETURN jsonb_build_object('success', true, 'rfq_id', p_rfq_id, 'status', p_status);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.update_rfq_status(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 9. record_supplier_quotation: one supplier's reply to an RFQ
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_supplier_quotation(
  p_rfq_id uuid,
  p_supplier_id uuid,
  p_valid_until date DEFAULT NULL,
  p_delivery_days integer DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_items jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_rfq record;
  v_quotation_id uuid;
  v_number text;
  v_item jsonb;
  v_total numeric(14,2) := 0;
  v_rows integer := 0;
  v_unit_cost numeric(12,2);
  v_qty numeric(14,4);
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND NOT can_permission('purchases.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;
    SELECT * INTO v_rfq FROM public.rfqs WHERE id = p_rfq_id;
    IF v_rfq.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'RFQ_NOT_FOUND');
    END IF;
    IF NOT is_pos_admin() AND get_branch_id() IS NOT NULL AND get_branch_id() <> v_rfq.branch_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;
    IF v_rfq.status IN ('awarded', 'cancelled') THEN
      RETURN jsonb_build_object('success', false, 'error', 'RFQ_CLOSED', 'status', v_rfq.status);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = p_supplier_id AND branch_id = v_rfq.branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'SUPPLIER_NOT_IN_BRANCH');
    END IF;
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'EMPTY_ITEMS');
    END IF;

    v_number := (public.next_document_number('supplier_quotation')->>'number')::text;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      IF (v_item->>'product_id') IS NULL AND (v_item->>'raw_material_id') IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'ITEM_MISSING_TYPE');
      END IF;
      v_unit_cost := COALESCE((v_item->>'unit_cost')::numeric, 0);
      v_qty := COALESCE((v_item->>'quantity')::numeric, 0);
      v_total := v_total + v_unit_cost * v_qty;
    END LOOP;

    INSERT INTO public.supplier_quotations
      (quotation_number, branch_id, rfq_id, supplier_id, status, valid_until, delivery_days, total, notes, created_by)
    VALUES (v_number, v_rfq.branch_id, p_rfq_id, p_supplier_id, 'received',
            p_valid_until, p_delivery_days, round(v_total, 2), p_notes, auth.uid())
    RETURNING id INTO v_quotation_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_unit_cost := COALESCE((v_item->>'unit_cost')::numeric, 0);
      v_qty := COALESCE((v_item->>'quantity')::numeric, 0);
      INSERT INTO public.supplier_quotation_items
        (quotation_id, product_id, raw_material_id, quantity, unit_cost, total)
      VALUES (v_quotation_id,
        NULLIF(v_item->>'product_id', '')::uuid,
        NULLIF(v_item->>'raw_material_id', '')::uuid,
        v_qty, v_unit_cost, round(v_unit_cost * v_qty, 2));
      v_rows := v_rows + 1;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'quotation_id', v_quotation_id,
      'quotation_number', v_number, 'items_added', v_rows, 'total', round(v_total, 2));
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.record_supplier_quotation(uuid, uuid, date, integer, text, jsonb) TO authenticated;

-- ---------------------------------------------------------------------
-- 10. select_supplier_quotation: pick a winner, reject the rest, award the RFQ
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.select_supplier_quotation(
  p_quotation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_quote record;
  v_rfq record;
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND NOT can_permission('purchases.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;
    SELECT * INTO v_quote FROM public.supplier_quotations WHERE id = p_quotation_id FOR UPDATE;
    IF v_quote.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'QUOTATION_NOT_FOUND');
    END IF;
    IF NOT is_pos_admin() AND get_branch_id() IS NOT NULL AND get_branch_id() <> v_quote.branch_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;
    IF v_quote.status <> 'received' THEN
      RETURN jsonb_build_object('success', false, 'error', 'QUOTATION_NOT_RECEIVED', 'status', v_quote.status);
    END IF;

    IF v_quote.rfq_id IS NOT NULL THEN
      UPDATE public.supplier_quotations SET status = 'rejected'
      WHERE rfq_id = v_quote.rfq_id AND id <> v_quote.id AND status = 'received';
      SELECT * INTO v_rfq FROM public.rfqs WHERE id = v_quote.rfq_id;
      IF v_rfq.id IS NOT NULL AND v_rfq.status <> 'awarded' THEN
        UPDATE public.rfqs SET status = 'awarded' WHERE id = v_quote.rfq_id;
      END IF;
    END IF;

    UPDATE public.supplier_quotations SET status = 'selected' WHERE id = v_quote.id;

    RETURN jsonb_build_object('success', true, 'quotation_id', v_quote.id,
      'rfq_id', v_quote.rfq_id, 'status', 'selected');
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.select_supplier_quotation(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 11. get_rfq_comparison: per line item, quote from every supplier
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_rfq_comparison(p_rfq_id uuid)
RETURNS TABLE (
  item_id            uuid,
  item_type          text,
  item_name          text,
  requested_quantity numeric,
  best_supplier_id   uuid,
  best_supplier_name text,
  best_unit_cost     numeric(12,2),
  avg_unit_cost      numeric(12,2),
  quotation_count    bigint,
  quotations         jsonb
) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' STABLE
AS $function$
DECLARE
  v_branch uuid;
BEGIN
  SELECT r.branch_id INTO v_branch FROM public.rfqs r WHERE r.id = p_rfq_id;
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'RFQ_NOT_FOUND';
  END IF;
  IF NOT is_pos_admin() AND get_branch_id() <> v_branch THEN
    RAISE EXCEPTION 'BRANCH_MISMATCH';
  END IF;

  RETURN QUERY
    SELECT
      COALESCE(ri.product_id, ri.raw_material_id) AS item_id,
      CASE WHEN ri.product_id IS NOT NULL THEN 'product' ELSE 'raw_material' END AS item_type,
      COALESCE(NULLIF(btrim(p.name), ''), NULLIF(btrim(rm.name), ''), '?') AS item_name,
      ri.quantity AS requested_quantity,
      (array_agg(q.supplier_id ORDER BY ql.unit_cost ASC))[1] AS best_supplier_id,
      (array_agg(s.name ORDER BY ql.unit_cost ASC))[1] AS best_supplier_name,
      (array_agg(ql.unit_cost ORDER BY ql.unit_cost ASC))[1] AS best_unit_cost,
      round(AVG(ql.unit_cost), 2) AS avg_unit_cost,
      COUNT(ql.id) AS quotation_count,
      COALESCE(jsonb_agg(jsonb_build_object(
        'quotation_id', q.id,
        'supplier_id', q.supplier_id,
        'supplier_name', s.name,
        'unit_cost', ql.unit_cost,
        'quotation_number', q.quotation_number,
        'status', q.status
      )), '[]'::jsonb) AS quotations
    FROM public.rfq_items ri
    LEFT JOIN public.products p ON p.id = ri.product_id
    LEFT JOIN public.raw_materials rm ON rm.id = ri.raw_material_id
    LEFT JOIN public.supplier_quotation_items ql
      ON ql.product_id IS NOT DISTINCT FROM ri.product_id
     AND ql.raw_material_id IS NOT DISTINCT FROM ri.raw_material_id
    LEFT JOIN public.supplier_quotations q ON q.id = ql.quotation_id
    LEFT JOIN public.suppliers s ON s.id = q.supplier_id
    WHERE ri.rfq_id = p_rfq_id
      AND (q.id IS NULL OR q.status IN ('received', 'selected'))
    GROUP BY ri.id, ri.product_id, ri.raw_material_id, ri.quantity, p.name, rm.name
    ORDER BY 3 ASC;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.get_rfq_comparison(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 12. create_purchase_order: draft PO (direct or from a selected quotation)
--     No inventory/ledger posting happens at this stage.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_purchase_order(
  p_branch_id uuid,
  p_supplier_id uuid,
  p_warehouse_id uuid DEFAULT NULL,
  p_payment_method text DEFAULT 'cash',
  p_notes text DEFAULT NULL,
  p_items jsonb DEFAULT NULL,
  p_quotation_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_purchase_id uuid;
  v_number text;
  v_user_branch uuid;
  v_quote record;
  v_qitem record;
  v_item jsonb;
  v_unit_name text;
  v_total numeric(14,2) := 0;
  v_rows integer := 0;
  v_request_id uuid;
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND NOT can_permission('purchases.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
        'detail', 'Creating purchase orders requires the purchases.manage permission.');
    END IF;
    IF p_branch_id IS NULL OR p_supplier_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'MISSING_SUPPLIER_BRANCH');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = p_supplier_id AND branch_id = p_branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'SUPPLIER_NOT_IN_BRANCH');
    END IF;
    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND v_user_branch <> p_branch_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    IF p_quotation_id IS NOT NULL THEN
      SELECT * INTO v_quote FROM public.supplier_quotations WHERE id = p_quotation_id;
      IF v_quote.id IS NULL OR v_quote.status <> 'selected' THEN
        RETURN jsonb_build_object('success', false, 'error', 'QUOTATION_NOT_SELECTED');
      END IF;
      IF v_quote.branch_id <> p_branch_id OR v_quote.supplier_id <> p_supplier_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'QUOTATION_MISMATCH');
      END IF;
      SELECT r.request_id INTO v_request_id FROM public.rfqs r WHERE r.id = v_quote.rfq_id;
    END IF;

    v_number := (public.next_document_number('purchase')->>'number')::text;

    INSERT INTO public.purchases
      (invoice_number, supplier_id, branch_id, warehouse_id, buyer_id,
       subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status, notes, request_id)
    VALUES (v_number, p_supplier_id, p_branch_id, p_warehouse_id, auth.uid(),
      0, 0, 0, 0, 0, COALESCE(p_payment_method, 'cash'), 'draft', p_notes, v_request_id)
    RETURNING id INTO v_purchase_id;

    IF p_quotation_id IS NOT NULL THEN
      FOR v_qitem IN
        SELECT product_id, raw_material_id, quantity, unit_cost
        FROM public.supplier_quotation_items WHERE quotation_id = p_quotation_id
      LOOP
        IF v_qitem.product_id IS NOT NULL THEN
          v_unit_name := 'piece';
        ELSE
          SELECT COALESCE(u.symbol, u.name, 'وحدة') INTO v_unit_name
          FROM public.raw_materials rm LEFT JOIN public.units u ON u.id = rm.unit_id
          WHERE rm.id = v_qitem.raw_material_id;
        END IF;
        INSERT INTO public.purchase_items (purchase_id, product_id, raw_material_id, unit_name, quantity, unit_cost, total)
        VALUES (v_purchase_id, v_qitem.product_id, v_qitem.raw_material_id,
                COALESCE(v_unit_name, 'piece'), v_qitem.quantity, v_qitem.unit_cost,
                round(v_qitem.quantity * v_qitem.unit_cost, 2));
        v_total := v_total + v_qitem.quantity * v_qitem.unit_cost;
        v_rows := v_rows + 1;
      END LOOP;
    ELSIF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
      FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
      LOOP
        IF (v_item->>'product_id') IS NULL AND (v_item->>'raw_material_id') IS NULL THEN
          RETURN jsonb_build_object('success', false, 'error', 'ITEM_MISSING_TYPE');
        END IF;
        INSERT INTO public.purchase_items
          (purchase_id, product_id, raw_material_id, unit_name, quantity, unit_cost, total)
        VALUES (v_purchase_id,
          NULLIF(v_item->>'product_id', '')::uuid,
          NULLIF(v_item->>'raw_material_id', '')::uuid,
          COALESCE(NULLIF(v_item->>'unit_name', ''), 'piece'),
          COALESCE((v_item->>'quantity')::numeric, 0),
          COALESCE((v_item->>'unit_cost')::numeric, 0),
          round(COALESCE((v_item->>'quantity')::numeric, 0) * COALESCE((v_item->>'unit_cost')::numeric, 0), 2));
        v_rows := v_rows + 1;
      END LOOP;
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'EMPTY_ITEMS');
    END IF;

    UPDATE public.purchases SET total = round(v_total, 2), subtotal = round(v_total, 2)
    WHERE id = v_purchase_id;

    IF v_request_id IS NOT NULL THEN
      UPDATE public.purchase_requests SET status = 'ordered'
      WHERE id = v_request_id AND status = 'approved';
    END IF;

    RETURN jsonb_build_object('success', true, 'purchase_id', v_purchase_id,
      'invoice_number', v_number, 'items_added', v_rows);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.create_purchase_order(uuid, uuid, uuid, text, text, jsonb, uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 13. update_purchase_order_status: draft->submitted->approved/cancelled
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_purchase_order_status(
  p_purchase_id uuid,
  p_status text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_purchase record;
BEGIN
  BEGIN
    IF NOT is_pos_admin() AND NOT can_permission('purchases.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;
    SELECT * INTO v_purchase FROM public.purchases WHERE id = p_purchase_id FOR UPDATE;
    IF v_purchase.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'PURCHASE_NOT_FOUND');
    END IF;
    IF NOT is_pos_admin() AND get_branch_id() IS NOT NULL AND get_branch_id() <> v_purchase.branch_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;

    IF p_status = 'submitted' THEN
      IF v_purchase.status <> 'draft' THEN
        RETURN jsonb_build_object('success', false, 'error', 'BAD_TRANSITION', 'from', v_purchase.status, 'to', p_status);
      END IF;
    ELSIF p_status = 'approved' THEN
      IF v_purchase.status <> 'submitted' THEN
        RETURN jsonb_build_object('success', false, 'error', 'BAD_TRANSITION', 'from', v_purchase.status, 'to', p_status);
      END IF;
    ELSIF p_status = 'cancelled' THEN
      IF v_purchase.status NOT IN ('draft', 'submitted') THEN
        RETURN jsonb_build_object('success', false, 'error', 'BAD_TRANSITION', 'from', v_purchase.status, 'to', p_status);
      END IF;
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS');
    END IF;

    UPDATE public.purchases
    SET status = p_status,
        approved_by = CASE WHEN p_status = 'approved' THEN auth.uid() ELSE approved_by END,
        approved_at = CASE WHEN p_status = 'approved' THEN now() ELSE approved_at END
    WHERE id = p_purchase_id;

    RETURN jsonb_build_object('success', true, 'purchase_id', p_purchase_id, 'status', p_status);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.update_purchase_order_status(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 14. receive_purchase_order: GRN; adds inventory per received line and,
--     when the PO is fully received, posts the purchase journal.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_purchase_id uuid,
  p_receipt_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_purchase record;
  v_user_branch uuid;
  v_receipt_id uuid;
  v_number text;
  v_item jsonb;
  v_pitem record;
  v_qty numeric(14,4);
  v_res jsonb;
  v_stock numeric(14,4);
  v_stock_val numeric(14,2);
  v_new_cost numeric(12,2);
  v_fully_received boolean := true;
  v_rows integer := 0;
  v_goods_fg numeric(14,2) := 0;
  v_goods_rm numeric(14,2) := 0;
  v_lines jsonb := '[]'::jsonb;
  v_dr numeric(14,2) := 0;
  v_cr numeric(14,2) := 0;
  v_diff numeric(14,2);
  v_paid numeric(14,2);
  v_ap numeric(14,2);
BEGIN
  BEGIN
    IF p_receipt_items IS NULL OR jsonb_array_length(p_receipt_items) = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'EMPTY_RECEIPT');
    END IF;
    IF NOT is_pos_admin() AND NOT can_permission('purchases.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;
    SELECT * INTO v_purchase FROM public.purchases WHERE id = p_purchase_id FOR UPDATE;
    IF v_purchase.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'PURCHASE_NOT_FOUND');
    END IF;
    IF v_purchase.status NOT IN ('approved', 'submitted', 'partial') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_RECEIVABLE', 'status', v_purchase.status);
    END IF;
    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND v_user_branch <> v_purchase.branch_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    -- Validate every line against the ordered items before writing anything.
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_receipt_items)
    LOOP
      v_qty := COALESCE((v_item->>'quantity_received')::numeric, 0);
      IF v_qty <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUANTITY');
      END IF;
      SELECT * INTO v_pitem FROM public.purchase_items
      WHERE id = (v_item->>'purchase_item_id')::uuid;
      IF v_pitem.id IS NULL OR v_purchase.id <> (
        SELECT purchase_id FROM public.purchase_items WHERE id = (v_item->>'purchase_item_id')::uuid
      ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PURCHASE_ITEM_NOT_FOUND');
      END IF;
      IF v_qty > v_pitem.quantity - COALESCE(v_pitem.received_quantity, 0) THEN
        RETURN jsonb_build_object('success', false, 'error', 'OVER_RECEIPT',
          'purchase_item_id', v_item->>'purchase_item_id',
          'ordered', v_pitem.quantity, 'already_received', v_pitem.received_quantity, 'receiving', v_qty);
      END IF;
    END LOOP;

    v_number := (public.next_document_number('purchase_receipt')->>'number')::text;

    INSERT INTO public.purchase_receipts
      (receipt_number, purchase_id, branch_id, warehouse_id, received_by, notes)
    VALUES (v_number, p_purchase_id, v_purchase.branch_id, v_purchase.warehouse_id, auth.uid(),
            NULL)
    RETURNING id INTO v_receipt_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_receipt_items)
    LOOP
      v_qty := COALESCE((v_item->>'quantity_received')::numeric, 0);

      SELECT * INTO v_pitem FROM public.purchase_items WHERE id = (v_item->>'purchase_item_id')::uuid;

      INSERT INTO public.purchase_receipt_items (receipt_id, purchase_item_id, quantity_received, unit_cost)
      VALUES (v_receipt_id, v_pitem.id, v_qty, v_pitem.unit_cost);

      IF v_pitem.product_id IS NOT NULL THEN
        IF v_purchase.warehouse_id IS NULL THEN
          RETURN jsonb_build_object('success', false, 'error', 'WAREHOUSE_REQUIRED',
            'detail', 'Select a warehouse to receive product items.');
        END IF;
        v_res := public._product_inv_add(v_pitem.product_id, v_purchase.warehouse_id, v_purchase.branch_id,
          v_qty, v_pitem.unit_cost, NULL, NULL, NULL,
          'purchase', 'purchase', p_purchase_id, v_purchase.invoice_number, auth.uid());
        IF NOT (v_res->>'success')::boolean THEN
          RETURN v_res;
        END IF;

        SELECT COALESCE(SUM(b.quantity), 0), COALESCE(SUM(b.quantity * b.unit_cost), 0)
        INTO v_stock, v_stock_val
        FROM public.inventory_batches b WHERE b.product_id = v_pitem.product_id;
        v_new_cost := CASE WHEN v_stock > 0 THEN round(v_stock_val / v_stock, 2) ELSE v_pitem.unit_cost END;
        UPDATE public.products SET cost_price = v_new_cost, updated_at = now() WHERE id = v_pitem.product_id;

        v_goods_fg := round(v_goods_fg + v_qty * v_pitem.unit_cost, 2);
      ELSE
        v_res := public._raw_add(v_pitem.raw_material_id, v_purchase.branch_id,
          v_qty, v_pitem.unit_cost, NULL, NULL, NULL,
          'purchase', 'purchase', p_purchase_id, v_purchase.invoice_number, auth.uid());
        IF NOT (v_res->>'success')::boolean THEN
          RETURN v_res;
        END IF;
        v_goods_rm := round(v_goods_rm + v_qty * v_pitem.unit_cost, 2);
      END IF;

      UPDATE public.purchase_items
      SET received_quantity = COALESCE(received_quantity, 0) + v_qty
      WHERE id = v_pitem.id;

      v_rows := v_rows + 1;
    END LOOP;

    -- Any remaining ordered quantity means the PO is still on backorder.
    SELECT EXISTS (
      SELECT 1 FROM public.purchase_items
      WHERE purchase_id = p_purchase_id
        AND quantity - COALESCE(received_quantity, 0) > 0
    ) INTO v_fully_received;
    v_fully_received := NOT v_fully_received;

    -- ===== LEDGER POSTING (only when the PO is fully received) =====
    IF v_fully_received THEN
      v_paid := round(COALESCE(v_purchase.paid_amount, 0), 2);
      v_ap := round(COALESCE(v_purchase.total, 0) - v_paid, 2);

      IF v_goods_fg > 0 THEN
        v_lines := v_lines || jsonb_build_object('account_key', 'inventory_fg', 'debit', v_goods_fg, 'credit', 0, 'note', v_purchase.invoice_number);
        v_dr := v_dr + v_goods_fg;
      END IF;
      IF v_goods_rm > 0 THEN
        v_lines := v_lines || jsonb_build_object('account_key', 'inventory_rm', 'debit', v_goods_rm, 'credit', 0, 'note', v_purchase.invoice_number);
        v_dr := v_dr + v_goods_rm;
      END IF;
      IF COALESCE(v_purchase.tax_amount, 0) > 0 THEN
        v_lines := v_lines || jsonb_build_object('account_key', 'vat_receivable', 'debit', v_purchase.tax_amount, 'credit', 0);
        v_dr := v_dr + v_purchase.tax_amount;
      END IF;
      IF COALESCE(v_purchase.discount_amount, 0) > 0 THEN
        v_lines := v_lines || jsonb_build_object('account_key', 'discount_received', 'debit', 0, 'credit', v_purchase.discount_amount);
        v_cr := v_cr + v_purchase.discount_amount;
      END IF;
      IF v_paid > 0 THEN
        v_lines := v_lines || jsonb_build_object('account_key', CASE WHEN COALESCE(v_purchase.payment_method, 'cash') = 'cash' THEN 'cash' ELSE 'bank' END,
          'debit', 0, 'credit', v_paid, 'note', v_purchase.invoice_number);
        v_cr := v_cr + v_paid;
      END IF;
      IF v_ap > 0 THEN
        v_lines := v_lines || jsonb_build_object('account_key', 'ap', 'debit', 0, 'credit', v_ap,
          'supplier_id', v_purchase.supplier_id, 'note', v_purchase.invoice_number);
        v_cr := v_cr + v_ap;
      END IF;

      v_diff := round(v_dr - v_cr, 2);
      IF v_diff <> 0 THEN
        IF v_diff > 0 THEN
          v_lines := v_lines || jsonb_build_object('account_key', 'discount_received', 'debit', 0, 'credit', v_diff);
        ELSE
          v_lines := v_lines || jsonb_build_object('account_key', 'discount_received', 'debit', -v_diff, 'credit', 0);
        END IF;
      END IF;

      PERFORM public._post_journal_entry(v_purchase.branch_id, 'purchase', p_purchase_id,
        v_purchase.invoice_number, 'فاتورة شراء ' || v_purchase.invoice_number, v_lines);
    END IF;

    UPDATE public.purchases SET status = CASE WHEN v_fully_received THEN 'completed' ELSE 'partial' END
    WHERE id = p_purchase_id;

    RETURN jsonb_build_object('success', true, 'receipt_id', v_receipt_id,
      'receipt_number', v_number, 'items_received', v_rows,
      'fully_received', v_fully_received, 'status', CASE WHEN v_fully_received THEN 'completed' ELSE 'partial' END);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order(uuid, jsonb) TO authenticated;

-- ---------------------------------------------------------------------
-- 15. get_purchase_backorders: open lines awaiting receipt
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_purchase_backorders(p_branch_id uuid DEFAULT NULL)
RETURNS TABLE (
  purchase_id      uuid,
  invoice_number   text,
  supplier_id      uuid,
  supplier_name    text,
  purchase_item_id uuid,
  product_id       uuid,
  raw_material_id  uuid,
  item_name        text,
  item_type        text,
  unit_name        text,
  ordered_quantity numeric,
  received_quantity numeric,
  remaining        numeric,
  unit_cost        numeric(12,2),
  status           text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' STABLE
AS $function$
BEGIN
  IF p_branch_id IS NOT NULL AND NOT is_pos_admin()
     AND get_branch_id() IS NOT NULL AND get_branch_id() <> p_branch_id THEN
    RAISE EXCEPTION 'BRANCH_MISMATCH';
  END IF;
  RETURN QUERY
    SELECT
      pc.id, pc.invoice_number, pc.supplier_id, s.name,
      pi.id, pi.product_id, pi.raw_material_id,
      COALESCE(NULLIF(btrim(p.name), ''), NULLIF(btrim(rm.name), ''), '?'),
      CASE WHEN pi.product_id IS NOT NULL THEN 'product' ELSE 'raw_material' END,
      pi.unit_name, pi.quantity, COALESCE(pi.received_quantity, 0),
      pi.quantity - COALESCE(pi.received_quantity, 0),
      pi.unit_cost, pc.status
    FROM public.purchase_items pi
    JOIN public.purchases pc ON pc.id = pi.purchase_id
    JOIN public.suppliers s ON s.id = pc.supplier_id
    LEFT JOIN public.products p ON p.id = pi.product_id
    LEFT JOIN public.raw_materials rm ON rm.id = pi.raw_material_id
    WHERE pc.status IN ('approved', 'submitted', 'partial')
      AND pi.quantity - COALESCE(pi.received_quantity, 0) > 0
      AND (p_branch_id IS NULL OR pc.branch_id = p_branch_id)
      AND (is_pos_admin() OR pc.branch_id = get_branch_id())
    ORDER BY pc.created_at ASC;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.get_purchase_backorders(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 16. get_purchase_receipts: GRN list with PO + supplier context
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_purchase_receipts(p_branch_id uuid DEFAULT NULL)
RETURNS TABLE (
  receipt_id     uuid,
  receipt_number text,
  purchase_id    uuid,
  invoice_number text,
  supplier_id    uuid,
  supplier_name  text,
  branch_id      uuid,
  warehouse_id   uuid,
  received_by    uuid,
  received_at    timestamptz,
  notes          text,
  item_count     bigint,
  total_quantity numeric
) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' STABLE
AS $function$
BEGIN
  IF p_branch_id IS NOT NULL AND NOT is_pos_admin()
     AND get_branch_id() IS NOT NULL AND get_branch_id() <> p_branch_id THEN
    RAISE EXCEPTION 'BRANCH_MISMATCH';
  END IF;
  RETURN QUERY
    SELECT
      r.id, r.receipt_number, r.purchase_id, pc.invoice_number,
      pc.supplier_id, s.name, r.branch_id, r.warehouse_id, r.received_by, r.received_at, r.notes,
      COUNT(ri.id), COALESCE(SUM(ri.quantity_received), 0)
    FROM public.purchase_receipts r
    JOIN public.purchases pc ON pc.id = r.purchase_id
    JOIN public.suppliers s ON s.id = pc.supplier_id
    LEFT JOIN public.purchase_receipt_items ri ON ri.receipt_id = r.id
    WHERE (p_branch_id IS NULL OR r.branch_id = p_branch_id)
      AND (is_pos_admin() OR r.branch_id = get_branch_id())
    GROUP BY r.id, pc.invoice_number, pc.supplier_id, s.name
    ORDER BY r.received_at DESC;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.get_purchase_receipts(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 17. get_supplier_evaluation: supplier performance from real documents
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_supplier_evaluation(p_branch_id uuid DEFAULT NULL)
RETURNS TABLE (
  supplier_id      uuid,
  supplier_name    text,
  orders_count     bigint,
  total_purchased  numeric(14,2),
  total_returned   numeric(14,2),
  return_rate      numeric(10,2),
  avg_order_value  numeric(14,2),
  quotations_count bigint,
  last_purchase_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' STABLE
AS $function$
BEGIN
  IF p_branch_id IS NOT NULL AND NOT is_pos_admin()
     AND get_branch_id() IS NOT NULL AND get_branch_id() <> p_branch_id THEN
    RAISE EXCEPTION 'BRANCH_MISMATCH';
  END IF;
  RETURN QUERY
    SELECT
      s.id, s.name,
      COALESCE(pc.orders_count, 0),
      COALESCE(pc.total_purchased, 0),
      COALESCE(pc.total_returned, 0),
      COALESCE(pc.return_rate, 0),
      COALESCE(pc.avg_order_value, 0),
      COALESCE(q.quotations_count, 0),
      pc.last_purchase_at
    FROM public.suppliers s
    LEFT JOIN (
      SELECT p.supplier_id,
        COUNT(*) AS orders_count,
        SUM(p.total) AS total_purchased,
        SUM(p.returned_amount) AS total_returned,
        round(CASE WHEN COALESCE(SUM(p.total), 0) > 0
          THEN COALESCE(SUM(p.returned_amount), 0) * 100.0 / SUM(p.total)
          ELSE 0 END, 2) AS return_rate,
        AVG(p.total) AS avg_order_value,
        MAX(p.created_at) AS last_purchase_at
      FROM public.purchases p
      WHERE (p_branch_id IS NULL OR p.branch_id = p_branch_id)
      GROUP BY p.supplier_id
    ) pc ON pc.supplier_id = s.id
    LEFT JOIN (
      SELECT q.supplier_id, COUNT(*) AS quotations_count
      FROM public.supplier_quotations q
      WHERE (p_branch_id IS NULL OR q.branch_id = p_branch_id)
      GROUP BY q.supplier_id
    ) q ON q.supplier_id = s.id
    WHERE (p_branch_id IS NULL OR s.branch_id = p_branch_id)
      AND (is_pos_admin() OR s.branch_id = get_branch_id())
    ORDER BY COALESCE(pc.total_purchased, 0) DESC, s.name ASC;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.get_supplier_evaluation(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 18. Hardening: get_supplier_price_impact must respect branch isolation.
--     Signature is unchanged so existing callers keep working; the returned
--     rows are now restricted to the caller's branch (admins see all).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_supplier_price_impact(p_supplier_id uuid)
RETURNS TABLE (
  item_id          uuid,
  item_type        text,
  item_name        text,
  first_cost       numeric(12,2),
  last_cost        numeric(12,2),
  avg_cost         numeric(12,2),
  change_pct       numeric(10,2),
  purchase_count   bigint,
  last_purchased_at timestamptz
) LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE
AS $function$
  SELECT
    p.id,
    'product'::text AS item_type,
    COALESCE(NULLIF(btrim(p.name), ''), 'Product'),
    (array_agg(pi.unit_cost ORDER BY pc.created_at ASC))[1]::numeric(12,2),
    (array_agg(pi.unit_cost ORDER BY pc.created_at DESC))[1]::numeric(12,2),
    round(AVG(pi.unit_cost), 2)::numeric(12,2),
    round(CASE
      WHEN (array_agg(pi.unit_cost ORDER BY pc.created_at ASC))[1] > 0
      THEN ((array_agg(pi.unit_cost ORDER BY pc.created_at DESC))[1] - (array_agg(pi.unit_cost ORDER BY pc.created_at ASC))[1]) * 100.0
        / (array_agg(pi.unit_cost ORDER BY pc.created_at ASC))[1]
      ELSE 0 END, 2)::numeric(10,2),
    COUNT(*)::bigint,
    MAX(pc.created_at)::timestamptz
  FROM public.purchase_items pi
  JOIN public.purchases pc ON pc.id = pi.purchase_id
  JOIN public.products p ON p.id = pi.product_id
  WHERE pc.supplier_id = p_supplier_id
    AND pc.status = 'completed'
    AND pi.product_id IS NOT NULL
    AND (public.is_pos_admin() OR pc.branch_id = public.get_branch_id())
  GROUP BY p.id
  UNION ALL
  SELECT
    rm.id,
    'raw_material'::text AS item_type,
    COALESCE(NULLIF(btrim(rm.name), ''), 'Raw Material'),
    (array_agg(pi.unit_cost ORDER BY pc.created_at ASC))[1]::numeric(12,2),
    (array_agg(pi.unit_cost ORDER BY pc.created_at DESC))[1]::numeric(12,2),
    round(AVG(pi.unit_cost), 2)::numeric(12,2),
    round(CASE
      WHEN (array_agg(pi.unit_cost ORDER BY pc.created_at ASC))[1] > 0
      THEN ((array_agg(pi.unit_cost ORDER BY pc.created_at DESC))[1] - (array_agg(pi.unit_cost ORDER BY pc.created_at ASC))[1]) * 100.0
        / (array_agg(pi.unit_cost ORDER BY pc.created_at ASC))[1]
      ELSE 0 END, 2)::numeric(10,2),
    COUNT(*)::bigint,
    MAX(pc.created_at)::timestamptz
  FROM public.purchase_items pi
  JOIN public.purchases pc ON pc.id = pi.purchase_id
  JOIN public.raw_materials rm ON rm.id = pi.raw_material_id
  WHERE pc.supplier_id = p_supplier_id
    AND pc.status = 'completed'
    AND pi.raw_material_id IS NOT NULL
    AND (public.is_pos_admin() OR pc.branch_id = public.get_branch_id())
  GROUP BY rm.id
  ORDER BY 2 ASC, 3 ASC
$function$;
GRANT EXECUTE ON FUNCTION public.get_supplier_price_impact(uuid) TO authenticated;
