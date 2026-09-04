import { describe, expect, it } from 'vitest';
import { computePosTotals, computeLineDiscount } from '@/lib/posMath';

describe('computeLineDiscount', () => {
  it('clamps negative discounts to zero', () => {
    expect(computeLineDiscount(100, -5)).toBe(0);
  });

  it('clamps discounts above the line total', () => {
    expect(computeLineDiscount(50, 200)).toBe(50);
  });

  it('rounds to two decimals', () => {
    expect(computeLineDiscount(10, 3.333)).toBe(3.33);
  });

  it('returns zero for missing discount', () => {
    expect(computeLineDiscount(10, 0)).toBe(0);
    expect(computeLineDiscount(10, NaN)).toBe(0);
  });
});

describe('computePosTotals', () => {
  const items = [
    { quantity: 2, unit_price: 50, discount_amount: 10 },
    { quantity: 1, unit_price: 100, discount_amount: 0 },
  ];

  it('computes subtotal as qty*price minus line discounts', () => {
    const r = computePosTotals({ items, discountType: 'amount', discountAmount: 0, taxRate: 14, taxEnabled: false, paidAmount: 0, paymentMethod: 'cash' });
    expect(r.subtotal).toBe(190);
    expect(r.total).toBe(190);
  });

  it('applies a fixed (amount) discount to the subtotal', () => {
    const r = computePosTotals({ items, discountType: 'amount', discountAmount: 30, taxRate: 0, taxEnabled: false, paidAmount: 0, paymentMethod: 'cash' });
    expect(r.discountValue).toBe(30);
    expect(r.taxableAmount).toBe(160);
    expect(r.total).toBe(160);
  });

  it('applies a percent discount based on the subtotal', () => {
    const r = computePosTotals({ items, discountType: 'percent', discountAmount: 10, taxRate: 0, taxEnabled: false, paidAmount: 0, paymentMethod: 'cash' });
    expect(r.discountValue).toBe(19);
    expect(r.total).toBe(171);
  });

  it('computes tax only when tax is enabled', () => {
    const r = computePosTotals({ items, discountType: 'amount', discountAmount: 0, taxRate: 14, taxEnabled: true, paidAmount: 0, paymentMethod: 'cash' });
    expect(r.taxAmount).toBe(26.6);
    expect(r.total).toBeCloseTo(216.6);
  });

  it('ignores tax rate when tax is disabled', () => {
    const r = computePosTotals({ items, discountType: 'amount', discountAmount: 0, taxRate: 14, taxEnabled: false, paidAmount: 0, paymentMethod: 'cash' });
    expect(r.taxAmount).toBe(0);
    expect(r.total).toBe(190);
  });

  it('tax applies after the discount', () => {
    const r = computePosTotals({ items, discountType: 'percent', discountAmount: 10, taxRate: 14, taxEnabled: true, paidAmount: 0, paymentMethod: 'cash' });
    expect(r.taxableAmount).toBe(171);
    expect(r.taxAmount).toBe(23.94);
    expect(r.total).toBeCloseTo(194.94);
  });

  it('change is zero for credit sales regardless of paid amount', () => {
    const r = computePosTotals({ items, discountType: 'amount', discountAmount: 0, taxRate: 0, taxEnabled: false, paidAmount: 500, paymentMethod: 'credit' });
    expect(r.change).toBe(0);
  });

  it('change is paid minus total for cash and clamps to zero', () => {
    const over = computePosTotals({ items, discountType: 'amount', discountAmount: 0, taxRate: 0, taxEnabled: false, paidAmount: 200, paymentMethod: 'cash' });
    expect(over.change).toBe(10);
    const under = computePosTotals({ items, discountType: 'amount', discountAmount: 0, taxRate: 0, taxEnabled: false, paidAmount: 50, paymentMethod: 'cash' });
    expect(under.change).toBe(0);
  });

  it('empty cart totals to zero', () => {
    const r = computePosTotals({ items: [], discountType: 'amount', discountAmount: 0, taxRate: 14, taxEnabled: true, paidAmount: 0, paymentMethod: 'card' });
    expect(r).toEqual({ subtotal: 0, discountValue: 0, taxableAmount: 0, taxAmount: 0, total: 0, change: 0 });
  });
});
