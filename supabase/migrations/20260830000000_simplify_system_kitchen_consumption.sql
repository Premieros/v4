-- Migration 20260830000000_simplify_system_kitchen_consumption.sql
-- 1. Remove Manufacturing & Subscription dependencies
-- 2. Direct Kitchen Inventory Consumption (Recipe Ingredients & Stocked Products)
-- 3. Idempotency & Quantity Delta Adjustments for Kitchen Sends
-- 4. Central Super Admin User Creation Toggle with Server-side Enforcement & Audit Logging

-- -----------------------------------------------------------------------------
-- 1. Order Inventory Consumption Tracking Table (Idempotency & Delta Ledger)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_inventory_consumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  raw_material_id uuid REFERENCES public.raw_materials(id) ON DELETE SET NULL,
  warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  consumed_quantity numeric(14,4) NOT NULL DEFAULT 0,
  reversed_quantity numeric(14,4) NOT NULL DEFAULT 0,
  unit_cost numeric(14,4) DEFAULT 0,
  status text NOT NULL DEFAULT 'consumed', -- 'consumed', 'reversed', 'adjusted'
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_order_item_consumption UNIQUE (order_item_id, raw_material_id)
);

ALTER TABLE public.order_inventory_consumptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_order_inventory_consumptions" ON public.order_inventory_consumptions;
CREATE POLICY "auth_all_order_inventory_consumptions" ON public.order_inventory_consumptions
  FOR ALL TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id())
  WITH CHECK (is_pos_admin() OR branch_id = get_branch_id());

CREATE INDEX IF NOT EXISTS idx_order_inv_consump_order ON public.order_inventory_consumptions(order_id);
CREATE INDEX IF NOT EXISTS idx_order_inv_consump_branch ON public.order_inventory_consumptions(branch_id);

-- -----------------------------------------------------------------------------
-- 2. System Controls: Allow New User Creation Setting
-- -----------------------------------------------------------------------------
-- Ensure system_settings has security.allow_new_user_creation = true by default
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'system_settings') THEN
    UPDATE public.system_settings
    SET config = jsonb_set(
      COALESCE(config, '{}'::jsonb),
      '{security,allow_new_user_creation}',
      COALESCE(config->'security'->'allow_new_user_creation', 'true'::jsonb),
      true
    )
    WHERE id = 1;
  END IF;
END $$;

-- RPC to check if new user creation is globally allowed
CREATE OR REPLACE FUNCTION public.can_create_new_user()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed boolean := true;
  v_config jsonb;
BEGIN
  -- Super admin can always manage users
  IF is_super_admin() THEN
    RETURN jsonb_build_object('allowed', true, 'is_super_admin', true);
  END IF;

  SELECT config INTO v_config FROM public.system_settings WHERE id = 1;
  IF v_config IS NOT NULL AND v_config->'security' ? 'allow_new_user_creation' THEN
    v_allowed := COALESCE((v_config->'security'->>'allow_new_user_creation')::boolean, true);
  END IF;

  IF NOT v_allowed THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'error', 'USER_CREATION_DISABLED',
      'message', 'تم إيقاف إنشاء المستخدمين الجدد بواسطة Super Admin'
    );
  END IF;

  RETURN jsonb_build_object('allowed', true);
END;
$$;

-- Super Admin RPC to toggle user creation setting and record audit log
CREATE OR REPLACE FUNCTION public.toggle_user_creation_setting(p_allowed boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_value boolean := true;
  v_config jsonb;
BEGIN
  IF NOT is_super_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED_SUPER_ADMIN_ONLY', 'message', 'فقط Super Admin يمكنه تعديل هذا الإعداد');
  END IF;

  SELECT config INTO v_config FROM public.system_settings WHERE id = 1;
  IF v_config IS NOT NULL AND v_config->'security' ? 'allow_new_user_creation' THEN
    v_old_value := COALESCE((v_config->'security'->>'allow_new_user_creation')::boolean, true);
  END IF;

  UPDATE public.system_settings
  SET config = jsonb_set(
    COALESCE(config, '{}'::jsonb),
    '{security,allow_new_user_creation}',
    to_jsonb(p_allowed),
    true
  ),
  updated_by = auth.uid(),
  updated_at = now()
  WHERE id = 1;

  -- Record audit log if audit_log table exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_logs') THEN
    INSERT INTO public.audit_logs (
      action,
      entity,
      entity_id,
      user_id,
      details,
      created_at
    ) VALUES (
      'TOGGLE_ALLOW_NEW_USER_CREATION',
      'system_settings',
      '1',
      auth.uid(),
      jsonb_build_object(
        'old_value', v_old_value,
        'new_value', p_allowed,
        'changed_by', auth.uid(),
        'timestamp', now()
      ),
      now()
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'allow_new_user_creation', p_allowed,
    'old_value', v_old_value
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Atomic & Idempotent Kitchen Inventory Consumption RPC
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_order_kitchen_inventory(
  p_order_id uuid,
  p_sent_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_item record;
  v_recipe record;
  v_recipe_item record;
  v_warehouse_id uuid;
  v_existing_consumption record;
  v_delta numeric(14,4);
  v_reversal_delta numeric(14,4);
  v_yield numeric(14,4);
  v_multiplier numeric(14,4);
  v_ingredient_deduct numeric(14,4);
  v_current_rm_stock numeric(14,4);
  v_current_inv_stock numeric(14,4);
  v_items_processed integer := 0;
  v_has_recipe boolean;
  v_now timestamptz := now();
  v_send_row record;
BEGIN
  -- 1. Fetch and lock order
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
  END IF;

  -- 2. Resolve active warehouse for branch
  SELECT id INTO v_warehouse_id FROM public.warehouses
  WHERE branch_id = v_order.branch_id AND is_active = true
  ORDER BY is_default DESC NULLS LAST, created_at ASC
  LIMIT 1;

  -- 3. Iterate over order items
  FOR v_item IN
    SELECT * FROM public.order_items WHERE order_id = p_order_id
  LOOP
    IF v_item.product_id IS NULL OR v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
      CONTINUE;
    END IF;

    -- Check if product has an active recipe
    SELECT * INTO v_recipe FROM public.recipes
    WHERE product_id = v_item.product_id
      AND (branch_id = v_order.branch_id OR branch_id IS NULL)
      AND is_active = true
    LIMIT 1;

    v_has_recipe := (v_recipe.id IS NULL = false);

    IF v_has_recipe THEN
      -- Process Recipe Ingredients deduction
      v_yield := COALESCE(v_recipe.yield_quantity, 1);
      IF v_yield <= 0 THEN v_yield := 1; END IF;

      FOR v_recipe_item IN
        SELECT * FROM public.recipe_items WHERE recipe_id = v_recipe.id
      LOOP
        -- Check existing consumption for this order item and raw material
        SELECT * INTO v_existing_consumption
        FROM public.order_inventory_consumptions
        WHERE order_item_id = v_item.id
          AND raw_material_id = v_recipe_item.raw_material_id;

        IF v_existing_consumption.id IS NULL THEN
          -- First time sending this item
          v_delta := v_item.quantity;
          v_multiplier := v_delta / v_yield;
          v_ingredient_deduct := v_recipe_item.quantity * v_multiplier * (1 + COALESCE(v_recipe_item.wastage_percent, 0) / 100);

          -- Deduct from raw material inventory
          UPDATE public.raw_material_inventory
          SET quantity = GREATEST(0, quantity - v_ingredient_deduct),
              updated_at = v_now
          WHERE raw_material_id = v_recipe_item.raw_material_id
            AND branch_id = v_order.branch_id;

          -- Log to raw_material_movements
          INSERT INTO public.raw_material_movements (
            material_id,
            warehouse_id,
            movement_type,
            quantity,
            reference_id,
            branch_id,
            created_at
          ) VALUES (
            v_recipe_item.raw_material_id,
            v_warehouse_id,
            'KITCHEN_CONSUMPTION',
            -v_ingredient_deduct,
            p_order_id,
            v_order.branch_id,
            v_now
          );

          -- Insert tracking consumption
          INSERT INTO public.order_inventory_consumptions (
            order_id,
            order_item_id,
            product_id,
            raw_material_id,
            warehouse_id,
            branch_id,
            consumed_quantity,
            status,
            created_at,
            updated_at
          ) VALUES (
            p_order_id,
            v_item.id,
            v_item.product_id,
            v_recipe_item.raw_material_id,
            v_warehouse_id,
            v_order.branch_id,
            v_item.quantity,
            'consumed',
            v_now,
            v_now
          );

          v_items_processed := v_items_processed + 1;

        ELSE
          -- Item was already sent previously; check for delta modifications
          IF v_item.quantity > v_existing_consumption.consumed_quantity THEN
            -- Quantity increased (e.g. 2 -> 3)
            v_delta := v_item.quantity - v_existing_consumption.consumed_quantity;
            v_multiplier := v_delta / v_yield;
            v_ingredient_deduct := v_recipe_item.quantity * v_multiplier * (1 + COALESCE(v_recipe_item.wastage_percent, 0) / 100);

            UPDATE public.raw_material_inventory
            SET quantity = GREATEST(0, quantity - v_ingredient_deduct),
                updated_at = v_now
            WHERE raw_material_id = v_recipe_item.raw_material_id
              AND branch_id = v_order.branch_id;

            INSERT INTO public.raw_material_movements (
              material_id,
              warehouse_id,
              movement_type,
              quantity,
              reference_id,
              branch_id,
              created_at
            ) VALUES (
              v_recipe_item.raw_material_id,
              v_warehouse_id,
              'KITCHEN_CONSUMPTION',
              -v_ingredient_deduct,
              p_order_id,
              v_order.branch_id,
              v_now
            );

            UPDATE public.order_inventory_consumptions
            SET consumed_quantity = v_item.quantity,
                updated_at = v_now
            WHERE id = v_existing_consumption.id;

            v_items_processed := v_items_processed + 1;

          ELSIF v_item.quantity < v_existing_consumption.consumed_quantity THEN
            -- Quantity decreased (e.g. 3 -> 2): Reverse delta
            v_reversal_delta := v_existing_consumption.consumed_quantity - v_item.quantity;
            v_multiplier := v_reversal_delta / v_yield;
            v_ingredient_deduct := v_recipe_item.quantity * v_multiplier * (1 + COALESCE(v_recipe_item.wastage_percent, 0) / 100);

            -- Return to raw material inventory
            UPDATE public.raw_material_inventory
            SET quantity = quantity + v_ingredient_deduct,
                updated_at = v_now
            WHERE raw_material_id = v_recipe_item.raw_material_id
              AND branch_id = v_order.branch_id;

            INSERT INTO public.raw_material_movements (
              material_id,
              warehouse_id,
              movement_type,
              quantity,
              reference_id,
              branch_id,
              created_at
            ) VALUES (
              v_recipe_item.raw_material_id,
              v_warehouse_id,
              'KITCHEN_CONSUMPTION_REVERSAL',
              v_ingredient_deduct,
              p_order_id,
              v_order.branch_id,
              v_now
            );

            UPDATE public.order_inventory_consumptions
            SET consumed_quantity = v_item.quantity,
                reversed_quantity = reversed_quantity + v_reversal_delta,
                updated_at = v_now
            WHERE id = v_existing_consumption.id;

            v_items_processed := v_items_processed + 1;
          END IF;
        END IF;
      END LOOP;

    ELSE
      -- Stocked Ready Product deduction
      SELECT * INTO v_existing_consumption
      FROM public.order_inventory_consumptions
      WHERE order_item_id = v_item.id
        AND raw_material_id IS NULL;

      IF v_existing_consumption.id IS NULL THEN
        -- First send: deduct full item quantity
        IF v_warehouse_id IS NOT NULL THEN
          UPDATE public.inventory
          SET quantity = GREATEST(0, quantity - v_item.quantity),
              updated_at = v_now
          WHERE product_id = v_item.product_id
            AND warehouse_id = v_warehouse_id;

          INSERT INTO public.inventory_movements (
            product_id,
            warehouse_id,
            movement_type,
            quantity,
            reference_id,
            branch_id,
            created_at
          ) VALUES (
            v_item.product_id,
            v_warehouse_id,
            'KITCHEN_CONSUMPTION',
            -v_item.quantity,
            p_order_id,
            v_order.branch_id,
            v_now
          );
        END IF;

        INSERT INTO public.order_inventory_consumptions (
          order_id,
          order_item_id,
          product_id,
          raw_material_id,
          warehouse_id,
          branch_id,
          consumed_quantity,
          status,
          created_at,
          updated_at
        ) VALUES (
          p_order_id,
          v_item.id,
          v_item.product_id,
          NULL,
          v_warehouse_id,
          v_order.branch_id,
          v_item.quantity,
          'consumed',
          v_now,
          v_now
        );

        v_items_processed := v_items_processed + 1;

      ELSE
        -- Delta modifications for stocked ready product
        IF v_item.quantity > v_existing_consumption.consumed_quantity THEN
          v_delta := v_item.quantity - v_existing_consumption.consumed_quantity;

          IF v_warehouse_id IS NOT NULL THEN
            UPDATE public.inventory
            SET quantity = GREATEST(0, quantity - v_delta),
                updated_at = v_now
            WHERE product_id = v_item.product_id
              AND warehouse_id = v_warehouse_id;

            INSERT INTO public.inventory_movements (
              product_id,
              warehouse_id,
              movement_type,
              quantity,
              reference_id,
              branch_id,
              created_at
            ) VALUES (
              v_item.product_id,
              v_warehouse_id,
              'KITCHEN_CONSUMPTION',
              -v_delta,
              p_order_id,
              v_order.branch_id,
              v_now
            );
          END IF;

          UPDATE public.order_inventory_consumptions
          SET consumed_quantity = v_item.quantity,
              updated_at = v_now
          WHERE id = v_existing_consumption.id;

          v_items_processed := v_items_processed + 1;

        ELSIF v_item.quantity < v_existing_consumption.consumed_quantity THEN
          v_reversal_delta := v_existing_consumption.consumed_quantity - v_item.quantity;

          IF v_warehouse_id IS NOT NULL THEN
            UPDATE public.inventory
            SET quantity = quantity + v_reversal_delta,
                updated_at = v_now
            WHERE product_id = v_item.product_id
              AND warehouse_id = v_warehouse_id;

            INSERT INTO public.inventory_movements (
              product_id,
              warehouse_id,
              movement_type,
              quantity,
              reference_id,
              branch_id,
              created_at
            ) VALUES (
              v_item.product_id,
              v_warehouse_id,
              'KITCHEN_CONSUMPTION_REVERSAL',
              v_reversal_delta,
              p_order_id,
              v_order.branch_id,
              v_now
            );
          END IF;

          UPDATE public.order_inventory_consumptions
          SET consumed_quantity = v_item.quantity,
              reversed_quantity = reversed_quantity + v_reversal_delta,
              updated_at = v_now
          WHERE id = v_existing_consumption.id;

          v_items_processed := v_items_processed + 1;
        END IF;
      END IF;
    END IF;

    -- Record in order_kitchen_sends for history if not already inserted
    IF NOT EXISTS (SELECT 1 FROM public.order_kitchen_sends WHERE order_item_id = v_item.id) THEN
      INSERT INTO public.order_kitchen_sends (
        branch_id,
        order_id,
        order_item_id,
        sent_at,
        sent_by
      ) VALUES (
        v_order.branch_id,
        p_order_id,
        v_item.id,
        v_now,
        p_sent_by
      );
    END IF;
  END LOOP;

  -- Update dining table to occupied if attached
  IF v_order.table_id IS NOT NULL THEN
    UPDATE public.dining_tables
    SET status = 'occupied', updated_at = v_now
    WHERE id = v_order.table_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'items_processed', v_items_processed
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Order Cancellation Inventory Reversal RPC
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_order_kitchen_consumption(
  p_order_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_cons record;
  v_now timestamptz := now();
  v_count integer := 0;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
  END IF;

  FOR v_cons IN
    SELECT * FROM public.order_inventory_consumptions
    WHERE order_id = p_order_id AND status = 'consumed' AND consumed_quantity > 0
  LOOP
    IF v_cons.raw_material_id IS NOT NULL THEN
      -- Return recipe ingredient
      UPDATE public.raw_material_inventory
      SET quantity = quantity + v_cons.consumed_quantity,
          updated_at = v_now
      WHERE raw_material_id = v_cons.raw_material_id
        AND branch_id = v_order.branch_id;

      INSERT INTO public.raw_material_movements (
        material_id,
        warehouse_id,
        movement_type,
        quantity,
        reference_id,
        branch_id,
        notes,
        created_at
      ) VALUES (
        v_cons.raw_material_id,
        v_cons.warehouse_id,
        'KITCHEN_CONSUMPTION_REVERSAL',
        v_cons.consumed_quantity,
        p_order_id,
        v_order.branch_id,
        COALESCE(p_reason, 'Order canceled before preparation'),
        v_now
      );
    ELSIF v_cons.product_id IS NOT NULL AND v_cons.warehouse_id IS NOT NULL THEN
      -- Return ready stocked product
      UPDATE public.inventory
      SET quantity = quantity + v_cons.consumed_quantity,
          updated_at = v_now
      WHERE product_id = v_cons.product_id
        AND warehouse_id = v_cons.warehouse_id;

      INSERT INTO public.inventory_movements (
        product_id,
        warehouse_id,
        movement_type,
        quantity,
        reference_id,
        branch_id,
        notes,
        created_at
      ) VALUES (
        v_cons.product_id,
        v_cons.warehouse_id,
        'KITCHEN_CONSUMPTION_REVERSAL',
        v_cons.consumed_quantity,
        p_order_id,
        v_order.branch_id,
        COALESCE(p_reason, 'Order canceled before preparation'),
        v_now
      );
    END IF;

    UPDATE public.order_inventory_consumptions
    SET status = 'reversed',
        reversed_quantity = consumed_quantity,
        consumed_quantity = 0,
        updated_at = v_now
    WHERE id = v_cons.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'reversed_items_count', v_count
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. Override Feature Gating & Subscription Restriction Functions
-- (Eliminates plan limits and subscription expiration so tenants have full RBAC access)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_feature_access(
  p_tenant_id uuid DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_feature_key text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'allowed', true,
    'feature_key', p_feature_key,
    'plan_id', 'full_enterprise',
    'plan_name', 'Enterprise Standard',
    'status', 'active',
    'limit_value', -1,
    'is_unlimited', true,
    'source', 'direct_access'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.can_create_user(p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_check jsonb;
BEGIN
  v_check := public.can_create_new_user();
  IF NOT (v_check->>'allowed')::boolean THEN
    RETURN v_check;
  END IF;
  RETURN jsonb_build_object('allowed', true, 'current', 0, 'limit', -1);
END;
$$;

CREATE OR REPLACE FUNCTION public.can_create_branch(p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object('allowed', true, 'current', 0, 'limit', -1);
END;
$$;

CREATE OR REPLACE FUNCTION public.can_create_warehouse(p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object('allowed', true, 'current', 0, 'limit', -1);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_tenant_subscription_details(p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'status', 'active',
    'plan_name', 'Full Enterprise Access',
    'days_left', 9999,
    'expired', false,
    'tier', 'enterprise'
  );
END;
$$;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION public.can_create_new_user() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.toggle_user_creation_setting(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_order_kitchen_inventory(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_order_kitchen_consumption(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_feature_access(uuid, uuid, text, uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.can_create_user(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.can_create_branch(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.can_create_warehouse(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_subscription_details(uuid) TO authenticated, anon;
