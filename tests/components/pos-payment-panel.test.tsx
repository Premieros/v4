import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { Product, Customer } from '@/lib/types';
import { PaymentPanel } from '@/features/pos/components/checkout/PaymentPanel';
import { formatCurrency } from '@/lib/format';

// ---------------------------------------------------------------------------
// Payment / full receipt review (ERP-01 §5). Locks the redesign contract:
//   - the payment screen shows the COMPLETE receipt context before confirming
//     (order type, table/delivery/drive-thru context, customer, item lines
//     with quantities/prices/discounts, subtotal, discount, tax, total),
//   - the cashier never leaves the POS workspace to pay (single right-panel),
//   - the stable payment identities (pos-payment-method-*, pos-payment-confirm)
//     survive the redesign for the e2e suite.
// ---------------------------------------------------------------------------

const productA: Product = {
  id: 'prod-a',
  name: 'Koshari',
  name_en: 'Koshari',
  branch_id: 'br',
  sale_price: 100,
  cost_price: 40,
  is_active: true,
} as Product;

const productB: Product = {
  id: 'prod-b',
  name: 'Molokhia',
  name_en: 'Molokhia',
  branch_id: 'br',
  sale_price: 50,
  cost_price: 20,
  is_active: true,
} as Product;

const customer: Customer = {
  id: 'cus-1',
  name: 'Omar',
} as Customer;

const baseProps = {
  currentBranchName: 'Main Branch',
  orderType: 'takeaway' as const,
  activeTable: null,
  activeOrderNumber: 'ORD-1',
  guestCount: null,
  onGuestCountChange: () => {},
  customerId: '',
  customers: [] as Customer[],
  onCustomerChange: () => {},
  discountType: 'amount' as const,
  discountAmount: 0,
  onDiscountTypeChange: () => {},
  onDiscountAmountChange: () => {},
  paymentMethod: 'cash' as const,
  onPaymentMethodChange: () => {},
  paidAmount: 0,
  onPaidAmountChange: () => {},
  subtotal: 250,
  discountValue: 25,
  taxAmount: 11.25,
  total: 236.25,
  change: 0,
  completing: false,
  canComplete: true,
  onComplete: () => {},
  onBack: () => {},
  currency: 'EGP',
  cart: [
    { product: productA, unit_name: 'piece', quantity: 2, unit_price: 100, discount_amount: 0, bonus_quantity: 0 },
    { product: productB, unit_name: 'piece', quantity: 1, unit_price: 50, discount_amount: 10, bonus_quantity: 0 },
  ],
  orderNotes: '',
};

const lang = { lang: 'en' as const, t: (k: string) => k, dir: 'ltr' as const };

vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => lang }));

describe('PaymentPanel full receipt review (ERP-01 §5)', () => {
  it('renders the complete receipt: item lines, unit prices, discounts and totals', () => {
    render(<PaymentPanel {...baseProps} />);

    const preview = screen.getByTestId('pos-payment-receipt');
    expect(preview).toBeTruthy();

    // Products and quantities.
    expect(within(preview).getByText('Koshari')).toBeTruthy();
    expect(within(preview).getByText('Molokhia')).toBeTruthy();
    expect(within(preview).getByText('2×')).toBeTruthy();

    // Item prices and line totals (2 × 100 = 200; 1 × 50 − 10 = 40).
    expect(within(preview).getByText(formatCurrency(100, 'EGP', 'en'))).toBeTruthy();
    expect(within(preview).getByText(formatCurrency(200, 'EGP', 'en'))).toBeTruthy();
    expect(within(preview).getByText(formatCurrency(40, 'EGP', 'en'))).toBeTruthy();
    expect(within(preview).getByText(`−${formatCurrency(10, 'EGP', 'en')}`)).toBeTruthy();

    // Order-level breakdown.
    const totals = within(screen.getByTestId('pos-payment-totals'));
    expect(totals.getByText(formatCurrency(250, 'EGP', 'en'))).toBeTruthy();
    expect(totals.getByText(`−${formatCurrency(25, 'EGP', 'en')}`)).toBeTruthy();
    expect(totals.getByText(formatCurrency(11.25, 'EGP', 'en'))).toBeTruthy();
    expect(totals.getByText(formatCurrency(236.25, 'EGP', 'en'))).toBeTruthy();

    // Payment identities survive the redesign.
    expect(screen.getByTestId('pos-payment-method-cash')).toBeTruthy();
    expect(screen.getByTestId('pos-payment-method-card')).toBeTruthy();
    expect(screen.getByTestId('pos-payment-method-transfer')).toBeTruthy();
    expect(screen.getByTestId('pos-payment-method-credit')).toBeTruthy();
    expect(screen.getByTestId('pos-payment-confirm')).toBeTruthy();
  });

  it('shows the customer and delivery/drive-thru context when present', () => {
    const { rerender } = render(<PaymentPanel {...baseProps} customerId={customer.id} customers={[customer]} orderType="delivery" orderNotes="🛵 01000000000 | E2E Address | ring the bell" />);
    expect(screen.getByText('Omar')).toBeTruthy();
    rerender(<PaymentPanel {...baseProps} customerId="" customers={[]} orderType="delivery" orderNotes="🛵 01000000000 | E2E Address | ring the bell" />);
    expect(screen.getByText('01000000000')).toBeTruthy();
    rerender(<PaymentPanel {...baseProps} orderType="drive_thru" orderNotes="🚗 ABC-1234 | Drive Customer | 2" />);
    expect(screen.getByText('ABC-1234')).toBeTruthy();
  });

  it('credit payment keeps the workspace and hides the paid-amount input', () => {
    render(<PaymentPanel {...baseProps} paymentMethod="credit" />);
    expect(screen.queryByText('Exact')).toBeNull();
    expect(screen.getByTestId('pos-payment-method-credit')).toBeTruthy();
    expect(screen.getByTestId('pos-payment-confirm')).toBeTruthy();
  });

  it('shows change when paid exceeds the total', () => {
    render(<PaymentPanel {...baseProps} paidAmount={300} change={63.75} />);
    expect(screen.getByText(formatCurrency(63.75, 'EGP', 'en'))).toBeTruthy();
  });
});
