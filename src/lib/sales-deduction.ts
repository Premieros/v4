import { supabase } from '@/api/client';

export interface DeductionItem {
  product_id: string;
  quantity: number;
}

export interface UnitDeduction {
  unit_id: string;
  unit_name: string;
  quantity: number;
  unit_type: 'ready' | 'manufactured';
}

export interface RawMaterialDeduction {
  raw_material_id: string;
  raw_material_name: string;
  quantity: number;
  unit_id: string;
  unit_name: string;
}

export interface DeductionResult {
  units_deducted: UnitDeduction[];
  /** Raw materials are intentionally never mutated by sale deduction. */
  raw_materials_deducted: RawMaterialDeduction[];
  errors: string[];
}

/**
 * Unit-only sale deduction.
 *
 * All stock validation, FIFO locking, batch updates, and ledger entries are
 * executed atomically in the database RPC `deduct_sale_unit_inventory`.
 * Raw materials are consumed only by manufacturing operations.
 */
export async function deductSaleInventory(
  branch_id: string,
  warehouse_id: string,
  items: DeductionItem[],
  reference_id: string | null = null,
  reference_number: string | null = null,
): Promise<DeductionResult> {
  const empty: DeductionResult = {
    units_deducted: [],
    raw_materials_deducted: [],
    errors: [],
  };

  if (!items.length) return empty;

  const { data, error } = await supabase.rpc('deduct_sale_unit_inventory', {
    p_branch_id: branch_id,
    p_warehouse_id: warehouse_id,
    p_items: items,
    p_reference_id: reference_id,
    p_reference_number: reference_number,
  });

  if (error) {
    return {
      ...empty,
      errors: [`Failed to deduct unit inventory: ${error.message}`],
    };
  }

  const result = (data ?? {}) as {
    success?: boolean;
    units_deducted?: UnitDeduction[];
    raw_materials_deducted?: RawMaterialDeduction[];
    errors?: string[];
    error?: string;
    detail?: string;
  };

  if (!result.success) {
    return {
      units_deducted: result.units_deducted ?? [],
      raw_materials_deducted: [],
      errors: [result.error ?? result.detail ?? 'Unit sale deduction failed'],
    };
  }

  return {
    units_deducted: result.units_deducted ?? [],
    raw_materials_deducted: [],
    errors: result.errors ?? [],
  };
}

/**
 * Compute the cost of inventory_unit batches for margin calculation.
 */
export async function computeUnitStockCost(
  unit_id: string,
  branch_id: string,
): Promise<{ total_qty: number; total_cost: number; weighted_avg: number }> {
  const { data: batches } = await supabase
    .from('inventory_unit_batches')
    .select('quantity, unit_cost')
    .eq('unit_id', unit_id)
    .eq('branch_id', branch_id);

  if (!batches?.length) return { total_qty: 0, total_cost: 0, weighted_avg: 0 };

  let totalQty = 0;
  let totalCost = 0;
  for (const b of batches) {
    totalQty += Number(b.quantity);
    totalCost += Number(b.quantity) * Number(b.unit_cost);
  }

  return {
    total_qty: totalQty,
    total_cost: totalCost,
    weighted_avg: totalQty > 0 ? totalCost / totalQty : 0,
  };
}
