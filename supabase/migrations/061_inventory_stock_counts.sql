-- P0 Inventory Lifecycle: stock counts, approval, variance and audited adjustments.
CREATE TABLE IF NOT EXISTS stock_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  warehouse_id uuid NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','applied','rejected')),
  count_type text NOT NULL DEFAULT 'cycle' CHECK (count_type IN ('full','partial','cycle')),
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  submitted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  applied_at timestamptz
);
ALTER TABLE stock_counts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_stock_counts_select" ON stock_counts FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_stock_counts_insert" ON stock_counts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_stock_counts_update" ON stock_counts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS stock_count_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_count_id uuid NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  system_quantity numeric(14,4) NOT NULL DEFAULT 0,
  counted_quantity numeric(14,4) NOT NULL DEFAULT 0,
  variance_quantity numeric(14,4) GENERATED ALWAYS AS (counted_quantity - system_quantity) STORED,
  unit_cost numeric(12,2) NOT NULL DEFAULT 0,
  variance_value numeric(16,2) GENERATED ALWAYS AS ((counted_quantity - system_quantity) * unit_cost) STORED,
  reason text,
  UNIQUE (stock_count_id, product_id)
);
ALTER TABLE stock_count_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_stock_count_items_select" ON stock_count_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_stock_count_items_insert" ON stock_count_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_stock_count_items_update" ON stock_count_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_stock_counts_branch_warehouse ON stock_counts(branch_id, warehouse_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_count_items_count ON stock_count_items(stock_count_id);

CREATE OR REPLACE FUNCTION apply_stock_count(p_stock_count_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count stock_counts%ROWTYPE;
  v_item stock_count_items%ROWTYPE;
  v_inv inventory%ROWTYPE;
  v_user_branch uuid;
  v_applied integer := 0;
BEGIN
  SELECT * INTO v_count FROM stock_counts WHERE id = p_stock_count_id FOR UPDATE;
  IF v_count.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','COUNT_NOT_FOUND'); END IF;
  IF v_count.status <> 'approved' THEN RETURN jsonb_build_object('success',false,'error','COUNT_NOT_APPROVED'); END IF;

  IF NOT is_pos_admin() THEN
    SELECT branch_id INTO v_user_branch FROM users WHERE id = auth.uid();
    IF v_user_branch IS NOT NULL AND v_user_branch <> v_count.branch_id THEN
      RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM stock_count_items WHERE stock_count_id = p_stock_count_id ORDER BY id FOR UPDATE
  LOOP
    SELECT * INTO v_inv FROM inventory WHERE product_id = v_item.product_id AND warehouse_id = v_count.warehouse_id FOR UPDATE;
    IF v_inv.id IS NULL THEN
      INSERT INTO inventory(product_id, warehouse_id, quantity)
      VALUES(v_item.product_id, v_count.warehouse_id, v_item.counted_quantity)
      RETURNING * INTO v_inv;
      INSERT INTO stock_transactions(product_id, warehouse_id, branch_id, transaction_type, component_flow, reference_type, reference_id, quantity, before_quantity, after_quantity, unit_cost, reason, created_by)
      VALUES(v_item.product_id, v_count.warehouse_id, v_count.branch_id, 'adjustment', false, 'stock_count', v_count.id, v_item.counted_quantity, 0, v_item.counted_quantity, v_item.unit_cost, COALESCE(v_item.reason,'stock_count'), auth.uid());
    ELSIF v_item.variance_quantity <> 0 THEN
      UPDATE inventory SET quantity = v_item.counted_quantity, updated_at = now() WHERE id = v_inv.id;
      INSERT INTO stock_transactions(product_id, warehouse_id, branch_id, transaction_type, component_flow, reference_type, reference_id, quantity, before_quantity, after_quantity, unit_cost, reason, created_by)
      VALUES(v_item.product_id, v_count.warehouse_id, v_count.branch_id, 'adjustment', false, 'stock_count', v_count.id, v_item.variance_quantity, v_inv.quantity, v_item.counted_quantity, v_item.unit_cost, COALESCE(v_item.reason,'stock_count'), auth.uid());
    END IF;
    v_applied := v_applied + 1;
  END LOOP;

  UPDATE stock_counts SET status='applied', applied_at=now() WHERE id=p_stock_count_id;
  RETURN jsonb_build_object('success',true,'items_applied',v_applied);
END;
$$;

REVOKE ALL ON FUNCTION apply_stock_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_stock_count(uuid) TO authenticated;
