import { supabase } from '@/api';

export interface RawMaterialStockInfo {
  raw_material_id: string;
  name: string;
  code: string;
  category: string;
  current_stock: number;
  min_stock: number;
  unit: string;
  avg_cost: number;
  status: 'ok' | 'low' | 'out_of_stock';
}

export interface RecipeItemComponent {
  raw_material_id?: string;
  inventory_unit_id?: string;
  raw_material_name: string;
  is_manufactured_unit?: boolean;
  quantity: number;
  wastage_percent: number;
  unit_cost: number;
  sub_ingredients?: {
    raw_material_id: string;
    raw_material_name: string;
    quantity: number;
    wastage_percent: number;
  }[];
}

export interface RecipeWithItems {
  recipe_id: string;
  product_id: string;
  product_name?: string;
  yield_quantity: number;
  items: RecipeItemComponent[];
}

export interface SellableProductStock {
  product_id: string;
  sellable_portions: number;
  limitingIngredient?: string;
  status: 'available' | 'low' | 'out';
}

/**
 * Fetches all raw materials and their current branch inventory
 */
export async function fetchBranchRawMaterialsStock(branchId: string): Promise<RawMaterialStockInfo[]> {
  try {
    const { data: materials, error: mErr } = await supabase
      .from('raw_materials')
      .select('id, name, code, category, min_stock, default_cost')
      .eq('branch_id', branchId)
      .eq('is_active', true)
      .order('name');

    if (mErr || !materials) return [];

    const { data: inv, error: iErr } = await supabase
      .from('raw_material_inventory')
      .select('raw_material_id, quantity, avg_cost, min_stock')
      .eq('branch_id', branchId);

    const invMap = new Map<string, { quantity: number; avg_cost: number; min_stock: number }>();
    if (!iErr && inv) {
      for (const row of inv as { raw_material_id: string; quantity: number; avg_cost: number; min_stock: number }[]) {
        invMap.set(row.raw_material_id, {
          quantity: Number(row.quantity) || 0,
          avg_cost: Number(row.avg_cost) || 0,
          min_stock: Number(row.min_stock) || 0,
        });
      }
    }

    return materials.map((m: { id: string; name: string; code: string; category: string; min_stock: number; default_cost: number }) => {
      const current = invMap.get(m.id);
      const stock = current?.quantity ?? 0;
      const minStock = current?.min_stock || m.min_stock || 0;
      let status: 'ok' | 'low' | 'out_of_stock' = 'ok';
      if (stock <= 0) status = 'out_of_stock';
      else if (stock <= minStock) status = 'low';

      return {
        raw_material_id: m.id,
        name: m.name,
        code: m.code,
        category: m.category || 'عام',
        current_stock: stock,
        min_stock: minStock,
        unit: 'وحدة',
        avg_cost: current?.avg_cost || m.default_cost || 0,
        status,
      };
    });
  } catch (err) {
    console.error('Error fetching raw materials stock:', err);
    return [];
  }
}

/**
 * Fetches recipes and their recipe_items for a branch
 */
export async function fetchBranchRecipes(branchId: string): Promise<RecipeWithItems[]> {
  try {
    const { data: recipes, error: rErr } = await supabase
      .from('recipes')
      .select('id, product_id, yield_quantity, is_active, products(name)')
      .eq('branch_id', branchId)
      .eq('is_active', true);

    if (rErr || !recipes) return [];

    const recipeIds = recipes.map((r: { id: string }) => r.id);
    if (recipeIds.length === 0) return [];

    const { data: items, error: iErr } = await supabase
      .from('recipe_items')
      .select('id, recipe_id, raw_material_id, inventory_unit_id, quantity, wastage_percent, raw_materials(name, default_cost), inventory_units(name, cost_price)')
      .in('recipe_id', recipeIds);

    if (iErr || !items) return [];

    // Find all inventory_units referenced to fetch their composing raw materials
    const unitIds = Array.from(
      new Set(
        items
          .map((it: { inventory_unit_id?: string | null }) => it.inventory_unit_id)
          .filter((id): id is string => Boolean(id))
      )
    );

    const subIngredientsMap = new Map<
      string,
      Array<{
        raw_material_id: string;
        raw_material_name: string;
        quantity: number;
        wastage_percent: number;
      }>
    >();

    if (unitIds.length > 0) {
      const { data: subRecipes } = await supabase
        .from('inventory_unit_recipes')
        .select('unit_id, raw_material_id, quantity, wastage_percent, raw_materials(name, default_cost)')
        .in('unit_id', unitIds);

      if (subRecipes) {
        for (const sub of subRecipes as unknown as {
          unit_id: string;
          raw_material_id: string;
          quantity: number;
          wastage_percent: number;
          raw_materials?: { name: string; default_cost: number };
        }[]) {
          const list = subIngredientsMap.get(sub.unit_id) || [];
          list.push({
            raw_material_id: sub.raw_material_id,
            raw_material_name: sub.raw_materials?.name || 'مادة خام',
            quantity: Number(sub.quantity) || 0,
            wastage_percent: Number(sub.wastage_percent) || 0,
          });
          subIngredientsMap.set(sub.unit_id, list);
        }
      }
    }

    const itemsByRecipe = new Map<string, RecipeWithItems['items']>();
    for (const it of items as unknown as {
      recipe_id: string;
      raw_material_id?: string | null;
      inventory_unit_id?: string | null;
      quantity: number;
      wastage_percent: number;
      raw_materials?: { name: string; default_cost: number } | null;
      inventory_units?: { name: string; cost_price: number } | null;
    }[]) {
      const list = itemsByRecipe.get(it.recipe_id) || [];
      const isManufactured = Boolean(it.inventory_unit_id);
      const name = isManufactured
        ? `وحدة مصنعة: ${it.inventory_units?.name || 'وحدة'}`
        : it.raw_materials?.name || 'خام';
      const cost = isManufactured
        ? Number(it.inventory_units?.cost_price) || 0
        : Number(it.raw_materials?.default_cost) || 0;

      list.push({
        raw_material_id: it.raw_material_id || undefined,
        inventory_unit_id: it.inventory_unit_id || undefined,
        raw_material_name: name,
        is_manufactured_unit: isManufactured,
        quantity: Number(it.quantity) || 0,
        wastage_percent: Number(it.wastage_percent) || 0,
        unit_cost: cost,
        sub_ingredients: it.inventory_unit_id
          ? subIngredientsMap.get(it.inventory_unit_id) || []
          : undefined,
      });
      itemsByRecipe.set(it.recipe_id, list);
    }

    return (recipes as unknown as { id: string; product_id: string; yield_quantity: number; products?: { name: string } | { name: string }[] }[]).map((r) => {
      const prodName = Array.isArray(r.products) ? r.products[0]?.name : r.products?.name;
      return {
        recipe_id: r.id,
        product_id: r.product_id,
        product_name: prodName || '',
        yield_quantity: Number(r.yield_quantity) || 1,
        items: itemsByRecipe.get(r.id) || [],
      };
    });
  } catch (err) {
    console.error('Error fetching recipes:', err);
    return [];
  }
}

/**
 * Computes sellable portion limit for each manufactured product based on raw materials stock
 */
export function computeManufacturedSellableStock(
  recipes: RecipeWithItems[],
  rawMaterialsStock: RawMaterialStockInfo[]
): Record<string, { portions: number; limitingIngredient?: string }> {
  const stockMap = new Map<string, number>();
  for (const rm of rawMaterialsStock) {
    stockMap.set(rm.raw_material_id, rm.current_stock);
  }

  const result: Record<string, { portions: number; limitingIngredient?: string }> = {};

  for (const recipe of recipes) {
    if (!recipe.items || recipe.items.length === 0) {
      result[recipe.product_id] = { portions: 0, limitingIngredient: 'لا توجد مكونات محددة' };
      continue;
    }

    let minPortions = Infinity;
    let bottleneck = '';
    const yieldQty = recipe.yield_quantity || 1;

    for (const item of recipe.items) {
      if (item.inventory_unit_id && item.sub_ingredients && item.sub_ingredients.length > 0) {
        // Composed Manufactured Unit: calculate based on each underlying raw material stock
        const unitMultiplier = (item.quantity * (1 + (item.wastage_percent || 0) / 100)) / yieldQty;

        for (const sub of item.sub_ingredients) {
          const available = stockMap.get(sub.raw_material_id) ?? 0;
          const requiredPerPortion = unitMultiplier * (sub.quantity * (1 + (sub.wastage_percent || 0) / 100));

          if (requiredPerPortion <= 0) continue;

          const portions = Math.floor(available / requiredPerPortion);
          if (portions < minPortions) {
            minPortions = portions;
            bottleneck = `${item.raw_material_name} (${sub.raw_material_name})`;
          }
        }
      } else if (item.raw_material_id) {
        // Direct Raw Material
        const available = stockMap.get(item.raw_material_id) ?? 0;
        const requiredPerPortion = (item.quantity * (1 + (item.wastage_percent || 0) / 100)) / yieldQty;

        if (requiredPerPortion <= 0) continue;

        const portions = Math.floor(available / requiredPerPortion);
        if (portions < minPortions) {
          minPortions = portions;
          bottleneck = item.raw_material_name;
        }
      }
    }

    const finalPortions = minPortions === Infinity ? 0 : Math.max(0, minPortions);
    result[recipe.product_id] = {
      portions: finalPortions,
      limitingIngredient: bottleneck,
    };
  }

  return result;
}
