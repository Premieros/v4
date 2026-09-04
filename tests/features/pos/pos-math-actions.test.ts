import { describe, expect, it } from 'vitest';
import { computeLineDiscount, computePosTotals } from '@/lib/posMath';

describe('POS calculation action contracts', () => {
  it('calculates line discounts independently of UI position', () => {
    expect(computeLineDiscount(100, 10)).toBe(10);
    expect(computeLineDiscount(100, 150)).toBe(100);
  });

  it('keeps totals deterministic for cart, discount, tax and payment', () => {
    const totals = computePosTotals({
      items: [
        { quantity: 2, unit_price: 100, discount_amount: 0 },
        { quantity: 1, unit_price: 50, discount_amount: 5 },
      ],
      discountType: 'amount',
      discountAmount: 10,
      taxRate: 14,
      taxEnabled: true,
      paidAmount: 250,
      paymentMethod: 'cash',
    });

    expect(totals.subtotal).toBe(245);
    expect(totals.discountValue).toBe(10);
    expect(totals.taxableAmount).toBe(235);
    expect(totals.taxAmount).toBe(32.9);
    expect(totals.total).toBe(267.9);
    expect(totals.change).toBe(0);
  });
});
