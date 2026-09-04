import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  supabase: {
    rpc: rpcMock,
  },
}));

import { deductSaleInventory } from '@/lib/sales-deduction';

describe('اختبار إنقاص مخزون المنتجات ومكوناتها عند البيع (Product & Components Sales Deduction)', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('ينقص مخزون وحدات ومكونات المنتج بنجاح عند بيع كمية معينة', async () => {
    // محاكاة بيع وجبة تحتوي على مكونات: خبز (1)، قطعة برجر (1)، صوص خاص (2)
    rpcMock.mockResolvedValue({
      data: {
        success: true,
        units_deducted: [
          { unit_id: 'unit-bun', unit_name: 'Burger Bun', unit_type: 'ready', quantity: 3 },
          { unit_id: 'unit-patty', unit_name: 'Beef Patty', unit_type: 'manufactured', quantity: 3 },
          { unit_id: 'unit-sauce', unit_name: 'Signature Sauce', unit_type: 'manufactured', quantity: 6 },
        ],
        raw_materials_deducted: [],
        total_cost: 45.0,
        errors: [],
      },
      error: null,
    });

    const branchId = 'branch-main';
    const warehouseId = 'wh-kitchen';
    const saleItems = [
      { product_id: 'prod-burger-deluxe', quantity: 3 },
    ];

    const result = await deductSaleInventory(
      branchId,
      warehouseId,
      saleItems,
      'sale-uuid-101',
      'INV-2026-001',
    );

    expect(rpcMock).toHaveBeenCalledWith('deduct_sale_unit_inventory', {
      p_branch_id: branchId,
      p_warehouse_id: warehouseId,
      p_items: saleItems,
      p_reference_id: 'sale-uuid-101',
      p_reference_number: 'INV-2026-001',
    });

    // التحقق من إنقاص المكونات بالتناسب الدقيق (3 وجبات = 3 خبز، 3 لحم، 6 صوص)
    expect(result.units_deducted).toHaveLength(3);
    expect(result.units_deducted.find((u) => u.unit_id === 'unit-bun')?.quantity).toBe(3);
    expect(result.units_deducted.find((u) => u.unit_id === 'unit-patty')?.quantity).toBe(3);
    expect(result.units_deducted.find((u) => u.unit_id === 'unit-sauce')?.quantity).toBe(6);
    expect(result.errors).toHaveLength(0);
  });

  it('ينقص مكونات سلة تحتوي على عدة منتجات مختلفة في عملية بيع واحدة', async () => {
    rpcMock.mockResolvedValue({
      data: {
        success: true,
        units_deducted: [
          { unit_id: 'unit-espresso-shot', unit_name: 'Espresso Shot', unit_type: 'manufactured', quantity: 2 },
          { unit_id: 'unit-milk-cup', unit_name: 'Steamed Milk', unit_type: 'ready', quantity: 2 },
          { unit_id: 'unit-croissant', unit_name: 'Butter Croissant', unit_type: 'ready', quantity: 1 },
        ],
        raw_materials_deducted: [],
        total_cost: 28.5,
        errors: [],
      },
      error: null,
    });

    const result = await deductSaleInventory(
      'branch-1',
      'wh-1',
      [
        { product_id: 'prod-latte', quantity: 2 },
        { product_id: 'prod-croissant', quantity: 1 },
      ],
      'sale-102',
      'INV-002',
    );

    expect(result.units_deducted).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
  });

  it('يرفض عملية البيع ويعيد خطأ نفاذ المخزون إذا كانت كمية أحد المكونات غير كافية', async () => {
    rpcMock.mockResolvedValue({
      data: {
        success: false,
        error: 'INSUFFICIENT_UNIT_STOCK',
        unit_id: 'unit-patty',
        required: 5,
        available: 2,
        units_deducted: [],
        errors: ['INSUFFICIENT_UNIT_STOCK'],
      },
      error: null,
    });

    const result = await deductSaleInventory(
      'branch-1',
      'wh-1',
      [{ product_id: 'prod-burger', quantity: 5 }],
      'sale-103',
      'INV-003',
    );

    expect(result.units_deducted).toHaveLength(0);
    expect(result.errors).toContain('INSUFFICIENT_UNIT_STOCK');
  });

  it('يتعامل بشكل سليم مع السلة الفارغة دون إرسال طلب لقاعدة البيانات', async () => {
    const result = await deductSaleInventory('branch-1', 'wh-1', []);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(result.units_deducted).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('يضمن عدم استهلاك المواد الخام مباشرة عند البيع (المواد الخام تستهلك فقط عبر أوامر التصنيع)', async () => {
    rpcMock.mockResolvedValue({
      data: {
        success: true,
        units_deducted: [
          { unit_id: 'unit-cake-slice', unit_name: 'Cake Slice', unit_type: 'manufactured', quantity: 1 },
        ],
        raw_materials_deducted: [],
        errors: [],
      },
      error: null,
    });

    const result = await deductSaleInventory(
      'branch-1',
      'wh-1',
      [{ product_id: 'prod-cake', quantity: 1 }],
    );

    expect(result.raw_materials_deducted).toEqual([]);
    expect(result.units_deducted[0].unit_name).toBe('Cake Slice');
  });
});
