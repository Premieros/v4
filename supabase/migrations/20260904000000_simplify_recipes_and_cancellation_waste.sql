-- =============================================================================
-- Migration: Simplify Recipe, Manufactured Units, Kitchen Deduction & Cancellation Waste
-- 1. Recipe items support both direct raw materials and manufactured units
-- 2. Atomic kitchen consumption consumes raw materials for direct ingredients AND manufactured units
-- 3. Cancellation handles both Non-Waste (return to branch warehouse stock) and Waste (record in waste_entries with approval)
-- =============================================================================

ALTER TABLE public.recipe_items 
  ADD COLUMN IF NOT EXISTS inventory_unit_id uuid REFERENCES public.inventory_units(id) ON DELETE CASCADE;

ALTER TABLE public.recipe_items 
  ALTER COLUMN raw_material_id DROP NOT NULL;

ALTER TABLE public.order_inventory_consumptions 
  ADD COLUMN IF NOT EXISTS inventory_unit_id uuid REFERENCES public.inventory_units(id) ON DELETE SET NULL;

ALTER TABLE public.waste_entries 
  ALTER COLUMN waste_category_id DROP NOT NULL;

-- -----------------------------------------------------------------------------
-- 1. Unified Kitchen Inventory Consumption
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
  v_sub_recipe_item record;
  v_existing_consumption record;
  v_warehouse_id uuid;
  v_yield numeric;
  v_multiplier numeric;
  v_ingredient_deduct numeric;
  v_delta numeric;
  v_reversal_delta numeric;
  v_items_processed integer := 0;
  v_now timestamptz := now();
BEGIN
  -- 1. Load Order
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
  END IF;

  -- 2. Resolve default branch warehouse
  SELECT id INTO v_warehouse_id
  FROM public.warehouses
  WHERE branch_id = v_order.branch_id AND is_active = true
  ORDER BY is_default DESC, created_at ASC
  LIMIT 1;

  -- 3. Process each item in order
  FOR v_item IN
    SELECT oi.*, p.product_type, p.name AS product_name
    FROM public.order_items oi
    JOIN public.products p ON p.id = oi.product_id
    WHERE oi.order_id = p_order_id
  LOOP
    -- Check if product has a recipe in this branch or global
    SELECT * INTO v_recipe
    FROM public.recipes
    WHERE product_id = v_item.product_id
      AND (branch_id = v_order.branch_id OR branch_id IS NULL)
      AND is_active = true
    ORDER BY (branch_id = v_order.branch_id) DESC
    LIMIT 1;

    IF v_recipe.id IS NOT NULL THEN
      v_yield := COALESCE(v_recipe.yield_quantity, 1);
      IF v_yield <= 0 THEN v_yield := 1; END IF;

      -- Loop over each recipe component (can be raw_material or manufactured unit)
      FOR v_recipe_item IN
        SELECT * FROM public.recipe_items WHERE recipe_id = v_recipe.id
      LOOP
        -- CASE A: Direct Raw Material
        IF v_recipe_item.raw_material_id IS NOT NULL THEN
          SELECT * INTO v_existing_consumption
          FROM public.order_inventory_consumptions
          WHERE order_item_id = v_item.id
            AND raw_material_id = v_recipe_item.raw_material_id
            AND (inventory_unit_id IS NULL OR inventory_unit_id = v_recipe_item.inventory_unit_id);

          IF v_existing_consumption.id IS NULL THEN
            -- First deduction
            v_multiplier := v_item.quantity / v_yield;
            v_ingredient_deduct := v_recipe_item.quantity * v_multiplier * (1 + COALESCE(v_recipe_item.wastage_percent, 0) / 100);

            -- Deduct from raw_material_inventory of branch
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

            INSERT INTO public.order_inventory_consumptions (
              order_id,
              order_item_id,
              product_id,
              raw_material_id,
              inventory_unit_id,
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
              NULL,
              v_warehouse_id,
              v_order.branch_id,
              v_ingredient_deduct,
              'consumed',
              v_now,
              v_now
            );

            v_items_processed := v_items_processed + 1;

          ELSE
            -- Delta handling if order item quantity was modified
            IF v_item.quantity > v_existing_consumption.consumed_quantity THEN
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
              SET consumed_quantity = consumed_quantity + v_ingredient_deduct,
                  updated_at = v_now
              WHERE id = v_existing_consumption.id;

              v_items_processed := v_items_processed + 1;
            END IF;
          END IF;

        -- CASE B: Manufactured Unit (وحدة مصنعة تتكون من عدة خامات)
        ELSIF v_recipe_item.inventory_unit_id IS NOT NULL THEN
          -- Deduct all raw materials composing this manufactured unit
          FOR v_sub_recipe_item IN
            SELECT * FROM public.inventory_unit_recipes WHERE unit_id = v_recipe_item.inventory_unit_id
          LOOP
            SELECT * INTO v_existing_consumption
            FROM public.order_inventory_consumptions
            WHERE order_item_id = v_item.id
              AND raw_material_id = v_sub_recipe_item.raw_material_id
              AND inventory_unit_id = v_recipe_item.inventory_unit_id;

            IF v_existing_consumption.id IS NULL THEN
              -- Total unit quantity needed = item.qty * recipe_item.qty * (1 + waste)
              -- Total raw material = total units * sub.qty * (1 + sub_waste)
              v_multiplier := v_item.quantity / v_yield;
              v_ingredient_deduct := (v_recipe_item.quantity * v_multiplier * (1 + COALESCE(v_recipe_item.wastage_percent, 0) / 100))
                                      * (v_sub_recipe_item.quantity * (1 + COALESCE(v_sub_recipe_item.wastage_percent, 0) / 100));

              UPDATE public.raw_material_inventory
              SET quantity = GREATEST(0, quantity - v_ingredient_deduct),
                  updated_at = v_now
              WHERE raw_material_id = v_sub_recipe_item.raw_material_id
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
                v_sub_recipe_item.raw_material_id,
                v_warehouse_id,
                'KITCHEN_CONSUMPTION',
                -v_ingredient_deduct,
                p_order_id,
                v_order.branch_id,
                v_now
              );

              INSERT INTO public.order_inventory_consumptions (
                order_id,
                order_item_id,
                product_id,
                raw_material_id,
                inventory_unit_id,
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
                v_sub_recipe_item.raw_material_id,
                v_recipe_item.inventory_unit_id,
                v_warehouse_id,
                v_order.branch_id,
                v_ingredient_deduct,
                'consumed',
                v_now,
                v_now
              );

              v_items_processed := v_items_processed + 1;
            END IF;
          END LOOP;
        END IF;

      END LOOP;

    ELSE
      -- Stocked Ready Product
      SELECT * INTO v_existing_consumption
      FROM public.order_inventory_consumptions
      WHERE order_item_id = v_item.id
        AND raw_material_id IS NULL;

      IF v_existing_consumption.id IS NULL THEN
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
          inventory_unit_id,
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
          NULL,
          v_warehouse_id,
          v_order.branch_id,
          v_item.quantity,
          'consumed',
          v_now,
          v_now
        );

        v_items_processed := v_items_processed + 1;
      END IF;
    END IF;

    -- Record sent items history
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
-- 2. Unified Order Cancellation with Waste & Return Handling
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_order_with_inventory_handling(
  p_order_id uuid,
  p_is_waste boolean DEFAULT false,
  p_reason text DEFAULT NULL,
  p_cancelled_by uuid DEFAULT NULL,
  p_approved_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_cons record;
  v_item_cost numeric;
  v_total_waste_cost numeric := 0;
  v_now timestamptz := now();
  v_count integer := 0;
  v_waste_cat_id uuid;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
  END IF;

  -- Resolve default waste category if waste
  IF p_is_waste THEN
    SELECT id INTO v_waste_cat_id
    FROM public.waste_categories
    WHERE is_active = true
    ORDER BY (name ILIKE '%هالك%' OR name ILIKE '%مطبخ%' OR name ILIKE '%إنتاج%') DESC
    LIMIT 1;
  END IF;

  -- Process all consumed ingredients
  FOR v_cons IN
    SELECT * FROM public.order_inventory_consumptions
    WHERE order_id = p_order_id AND status = 'consumed' AND consumed_quantity > 0
  LOOP
    IF NOT p_is_waste THEN
      -- Case 1: NOT WASTE -> Return to stock in branch warehouse
      IF v_cons.raw_material_id IS NOT NULL THEN
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
          COALESCE(p_reason, 'Order canceled before prep - returned to stock'),
          v_now
        );
      ELSIF v_cons.product_id IS NOT NULL AND v_cons.warehouse_id IS NOT NULL THEN
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
          COALESCE(p_reason, 'Order canceled before prep - returned to stock'),
          v_now
        );
      END IF;

      UPDATE public.order_inventory_consumptions
      SET status = 'reversed',
          reversed_quantity = consumed_quantity,
          consumed_quantity = 0,
          updated_at = v_now
      WHERE id = v_cons.id;

    ELSE
      -- Case 2: IS WASTE -> Retain deduction, log to waste_entries
      v_item_cost := 0;

      IF v_cons.raw_material_id IS NOT NULL THEN
        SELECT COALESCE(default_cost, 0) INTO v_item_cost
        FROM public.raw_materials
        WHERE id = v_cons.raw_material_id;

        INSERT INTO public.waste_entries (
          branch_id,
          waste_category_id,
          waste_type,
          raw_material_id,
          inventory_unit_id,
          product_id,
          quantity,
          unit_cost,
          total_cost,
          reason,
          warehouse_id,
          status,
          approved_by,
          approved_at,
          created_by,
          created_at,
          updated_at
        ) VALUES (
          v_order.branch_id,
          v_waste_cat_id,
          'raw_material',
          v_cons.raw_material_id,
          v_cons.inventory_unit_id,
          v_cons.product_id,
          v_cons.consumed_quantity,
          v_item_cost,
          (v_cons.consumed_quantity * v_item_cost),
          COALESCE(p_reason, 'هالك مطبخ ناتج عن إلغاء طلب'),
          v_cons.warehouse_id,
          CASE WHEN p_approved_by IS NOT NULL THEN 'approved' ELSE 'pending' END,
          p_approved_by,
          CASE WHEN p_approved_by IS NOT NULL THEN v_now ELSE NULL END,
          COALESCE(p_cancelled_by, p_approved_by),
          v_now,
          v_now
        );

        v_total_waste_cost := v_total_waste_cost + (v_cons.consumed_quantity * v_item_cost);

      ELSIF v_cons.product_id IS NOT NULL THEN
        SELECT COALESCE(cost_price, 0) INTO v_item_cost
        FROM public.products
        WHERE id = v_cons.product_id;

        INSERT INTO public.waste_entries (
          branch_id,
          waste_category_id,
          waste_type,
          raw_material_id,
          inventory_unit_id,
          product_id,
          quantity,
          unit_cost,
          total_cost,
          reason,
          warehouse_id,
          status,
          approved_by,
          approved_at,
          created_by,
          created_at,
          updated_at
        ) VALUES (
          v_order.branch_id,
          v_waste_cat_id,
          'product',
          NULL,
          NULL,
          v_cons.product_id,
          v_cons.consumed_quantity,
          v_item_cost,
          (v_cons.consumed_quantity * v_item_cost),
          COALESCE(p_reason, 'هالك مطبخ ناتج عن إلغاء طلب'),
          v_cons.warehouse_id,
          CASE WHEN p_approved_by IS NOT NULL THEN 'approved' ELSE 'pending' END,
          p_approved_by,
          CASE WHEN p_approved_by IS NOT NULL THEN v_now ELSE NULL END,
          COALESCE(p_cancelled_by, p_approved_by),
          v_now,
          v_now
        );

        v_total_waste_cost := v_total_waste_cost + (v_cons.consumed_quantity * v_item_cost);
      END IF;

      UPDATE public.order_inventory_consumptions
      SET status = 'wasted',
          updated_at = v_now
      WHERE id = v_cons.id;
    END IF;

    v_count := v_count + 1;
  END LOOP;

  -- Update order status
  UPDATE public.orders
  SET status = 'cancelled',
      notes = CASE 
        WHEN notes IS NULL OR notes = '' THEN 'تم الإلغاء: ' || COALESCE(p_reason, '')
        ELSE notes || E'\n' || 'تم الإلغاء: ' || COALESCE(p_reason, '')
      END,
      updated_at = v_now
  WHERE id = p_order_id;

  -- Free table if order was on a dining table
  IF v_order.table_id IS NOT NULL THEN
    UPDATE public.dining_tables
    SET status = 'vacant', updated_at = v_now
    WHERE id = v_order.table_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'is_waste', p_is_waste,
    'processed_count', v_count,
    'total_waste_cost', v_total_waste_cost
  );
END;
$$;

-- Keep reverse_order_kitchen_consumption calling cancel_order_with_inventory_handling
CREATE OR REPLACE FUNCTION public.reverse_order_kitchen_consumption(
  p_order_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.cancel_order_with_inventory_handling(p_order_id, false, p_reason, NULL, NULL);
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_order_kitchen_inventory(uuid, uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.cancel_order_with_inventory_handling(uuid, boolean, text, uuid, uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.reverse_order_kitchen_consumption(uuid, text) TO authenticated, anon;
