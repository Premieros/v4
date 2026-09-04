import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { OrderTypePicker } from '@/features/pos/components/start/OrderTypePicker';

vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({
    lang: 'ar',
    t: (key: string) => key,
    setLang: vi.fn(),
    dir: 'rtl',
  }),
}));

describe('POS OrderTypePicker action contract', () => {
  it('exposes every order type as an independently actionable control', () => {
    const onSelect = vi.fn();
    const onActiveOrders = vi.fn();

    render(<OrderTypePicker onSelect={onSelect} onActiveOrders={onActiveOrders} />);

    expect(screen.getByTestId('pos-order-type-question')).toHaveTextContent('كيف سيتم تقديم هذا الطلب؟');

    for (const type of ['dine_in', 'drive_thru', 'delivery', 'takeaway']) {
      const button = screen.getByTestId(`pos-order-type-${type}`);
      expect(button).toBeEnabled();
      fireEvent.click(button);
      expect(onSelect).toHaveBeenLastCalledWith(type);
    }
  });

  it('keeps Active Orders as a distinct action', () => {
    const onSelect = vi.fn();
    const onActiveOrders = vi.fn();

    render(<OrderTypePicker onSelect={onSelect} onActiveOrders={onActiveOrders} />);

    fireEvent.click(screen.getByTestId('pos-active-orders'));

    expect(onActiveOrders).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
