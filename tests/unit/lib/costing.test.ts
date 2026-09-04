import { describe, it, expect } from 'vitest';
import {
  safeDiv, weightedAvgCost, foodCostPct, grossMargin, marginPct, variancePct,
} from '@/lib/costing';

describe('costing helpers', () => {
  it('safeDiv returns 0 for zero/invalid denominator', () => {
    expect(safeDiv(10, 0)).toBe(0);
    expect(safeDiv(10, NaN)).toBe(0);
    expect(safeDiv(10, Infinity)).toBe(0);
    expect(safeDiv(0, 5)).toBe(0);
    expect(safeDiv(10, 4)).toBe(2.5);
  });

  it('weightedAvgCost computes weighted average rounded to 2dp', () => {
    expect(weightedAvgCost([10, 5], [10, 20])).toBe(13.33);
    expect(weightedAvgCost([0, 5], [10, 20])).toBe(20);
    expect(weightedAvgCost([0, 0], [10, 20])).toBe(0);
  });

  it('foodCostPct returns 0 when price is missing and clamps negative', () => {
    expect(foodCostPct(4, 0)).toBe(0);
    expect(foodCostPct(4, 10)).toBe(40);
    expect(foodCostPct(-2, 10)).toBe(0);
  });

  it('grossMargin is price minus cost', () => {
    expect(grossMargin(4, 10)).toBe(6);
    expect(grossMargin(12, 10)).toBe(-2);
  });

  it('marginPct is gross margin over price', () => {
    expect(marginPct(6, 10)).toBe(40);
    expect(marginPct(6, 0)).toBe(0);
  });

  it('variancePct reports deviation relative to theoretical', () => {
    expect(variancePct(12, 10)).toBe(20);
    expect(variancePct(8, 10)).toBe(-20);
    expect(variancePct(5, 0)).toBe(0);
  });
});
