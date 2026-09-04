import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpcMock = vi.fn();

vi.mock('@/api/client', () => ({
  supabase: {
    rpc: rpcMock,
  },
}));

describe('sales deduction — unit inventory only', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('deducts units through the atomic RPC and never requests raw-material deduction', async () => {
    rpcMock.mockResolvedValue({
      data: {
        success: true,
        units_deducted: [
          { unit_id: 'unit-sauce', unit_name: 'Sauce', unit_type: 'manufactured', quantity: 2 },
        ],
        raw_materials_deducted: [],
        errors: [],
        total_cost: 40,
      },
      error: null,
    });

    const { deductSaleInventory } = await import('@/lib/sales-deduction');
    const result = await deductSaleInventory(
      'branch-1',
      'warehouse-1',
      [{ product_id: 'product-1', quantity: 2 }],
      'sale-1',
      'INV-1',
    );

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith('deduct_sale_unit_inventory', {
      p_branch_id: 'branch-1',
      p_warehouse_id: 'warehouse-1',
      p_items: [{ product_id: 'product-1', quantity: 2 }],
      p_reference_id: 'sale-1',
      p_reference_number: 'INV-1',
    });
    expect(result.units_deducted).toHaveLength(1);
    expect(result.units_deducted[0].unit_id).toBe('unit-sauce');
    expect(result.units_deducted[0].quantity).toBe(2);
    expect(result.raw_materials_deducted).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('returns the database failure without partial frontend deductions', async () => {
    rpcMock.mockResolvedValue({
      data: {
        success: false,
        error: 'INSUFFICIENT_UNIT_STOCK',
        units_deducted: [],
        raw_materials_deducted: [],
        errors: [],
      },
      error: null,
    });

    const { deductSaleInventory } = await import('@/lib/sales-deduction');
    const result = await deductSaleInventory('branch-1', 'warehouse-1', [
      { product_id: 'product-1', quantity: 2 },
    ]);

    expect(result.units_deducted).toHaveLength(0);
    expect(result.raw_materials_deducted).toHaveLength(0);
    expect(result.errors).toEqual(['INSUFFICIENT_UNIT_STOCK']);
  });
});
