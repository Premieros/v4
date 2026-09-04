export type PosPaymentMethod = 'cash' | 'card' | 'transfer' | 'credit';

export interface PosLine {
  quantity: number;
  unit_price: number;
  discount_amount: number;
}

export interface PosTotalsInput {
  items: PosLine[];
  discountType: 'amount' | 'percent';
  discountAmount: number;
  taxRate: number;
  taxEnabled: boolean;
  paidAmount: number;
  paymentMethod: PosPaymentMethod;
}

export interface PosTotals {
  subtotal: number;
  discountValue: number;
  taxableAmount: number;
  taxAmount: number;
  total: number;
  change: number;
}

export function computeLineDiscount(lineTotal: number, discount: number): number {
  return Math.round(Math.min(Math.max(discount || 0, 0), lineTotal) * 100) / 100;
}

export function computePosTotals(input: PosTotalsInput): PosTotals {
  const subtotal = input.items.reduce((s, i) => s + i.quantity * i.unit_price - i.discount_amount, 0);
  const discountValue = input.discountType === 'percent' ? (subtotal * input.discountAmount) / 100 : input.discountAmount;  const taxableAmount = subtotal - discountValue;
  const taxRate = input.taxEnabled ? input.taxRate || 0 : 0;
  const taxAmount = (taxableAmount * taxRate) / 100;
  const total = taxableAmount + taxAmount;
  const change = Math.max(0, (input.paymentMethod === 'credit' ? 0 : input.paidAmount || total) - total);
  return { subtotal, discountValue, taxableAmount, taxAmount, total, change };
}
