import { useState } from 'react';
import { ShoppingCart, Minus, Plus, X, Pause, ChefHat, Banknote, Printer, Percent, UtensilsCrossed, Clock, Check, Trash2, User } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { formatCurrency } from '@/lib/format';
import type { CartItem, Customer, DiningTable, OrderItem, OrderType } from '@/lib/types';
import type { KitchenSendItem } from '../../types';
import { computeSentState } from '../../utils/sentState';
import { formatClockTime, timeAgo } from '../../utils/timeAgo';
import { deriveCartStage } from '../../utils/orderStage';
import { ORDER_TYPES } from '../../utils/orderTypes';
import { orderTypeLabel } from '../../utils/format';
import { OrderTypePill } from './OrderTypePill';
import { OrderStageBadge } from './OrderStageBadge';

interface CurrentOrderPanelProps {
  cart: CartItem[];
  currency: string;
  subtotal: number;
  discountValue: number;
  discountType: 'amount' | 'percent';
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  completing: boolean;
  orderLoading: boolean;
  kitchenSending: boolean;
  orderType: OrderType;
  activeOrderNumber: string | null;
  activeOrderId: string | null;
  activeTable: DiningTable | null;
  guestCount: number | null;
  customerId: string;
  customerById: Record<string, Customer>;
  orderNotes: string;
  activeOrderCreatedAt: string | null;
  orderItems: OrderItem[];
  sentOrderItemIds: Set<string>;
  sessionSent: KitchenSendItem[];
  canDiscount?: boolean;
  canDeleteItem?: boolean;
  onSwitchOrderType: (ot: OrderType) => void;
  onGuestCountChange: (n: number | null) => void;
  onDiscountTypeChange: (v: 'amount' | 'percent') => void;
  onDiscountAmountChange: (v: number) => void;
  onUpdateQty: (productId: string, delta: number) => void;
  onSetQty: (productId: string, qty: number) => void;
  onRemove: (productId: string) => void;
  onClear: () => void;
  onSetItemDiscount: (productId: string, discount: number) => void;
  onHold: () => void;
  onSendKitchen: () => void;
  onPrint: () => void;
  onPay: () => void;
  onAddItem?: () => void;
  onConfigureItem?: (item: CartItem) => void;
  onOpenCustomerModal?: () => void;
  onOpenTableModal?: () => void;
  onVoidItem?: (item: CartItem, sentQty: number) => void;
}

export function CurrentOrderPanel({
  cart,
  currency,
  subtotal,
  discountValue,
  discountType,
  discountAmount,
  total,
  completing,
  orderLoading,
  kitchenSending,
  orderType,
  activeOrderNumber,
  activeOrderId,
  activeTable,
  guestCount,
  customerId,
  customerById,
  orderNotes,
  activeOrderCreatedAt,
  orderItems,
  sentOrderItemIds,
  sessionSent,
  canDiscount = true,
  canDeleteItem = true,
  onSwitchOrderType,
  onGuestCountChange,
  onDiscountTypeChange,
  onDiscountAmountChange,
  onUpdateQty,
  onRemove,
  onClear,
  onHold,
  onSendKitchen,
  onPrint,
  onPay,
  onConfigureItem,
  onOpenCustomerModal,
  onOpenTableModal,
  onVoidItem,
}: CurrentOrderPanelProps) {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';
  const [showDiscount, setShowDiscount] = useState(false);

  const sentState = computeSentState(cart, orderItems, sentOrderItemIds, sessionSent);
  const newCount = cart.filter((i) => (sentState[i.product.id]?.newQty || 0) > 0).length;
  const allSent = cart.length > 0 && newCount === 0;
  const ago = activeOrderCreatedAt ? timeAgo(activeOrderCreatedAt) : null;
  const stage = deriveCartStage(cart, sentState, false);

  const empty = cart.length === 0;
  const currentCustomer = customerId ? customerById[customerId] : null;

  return (
    <div className="flex flex-col h-full min-h-0 bg-ui-surface">
      {/* Top Header */}
      <div className="px-3 py-2.5 border-b border-ui-border flex-shrink-0 space-y-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-ui-primary-soft flex items-center justify-center">
            <ShoppingCart className="w-4 h-4 text-ui-accent" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black text-ui-text truncate">
              {activeOrderNumber ? `#${activeOrderNumber}` : t('newOrder')}
            </p>
            <p className="text-[11px] text-ui-subtle">
              {cart.length} {isAr ? 'صنف' : 'items'}
            </p>
          </div>
          <OrderStageBadge stage={stage} />
          {activeOrderId && !empty && canDeleteItem && (
            <button
              onClick={onClear}
              aria-label={isAr ? 'مسح الطلب' : 'Clear order'}
              className="text-[11px] text-ui-danger hover:text-ui-danger hover:bg-ui-danger/10 px-2 py-1 rounded-lg transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Order Type & Context Chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {activeOrderNumber ? (
            <OrderTypePill type={orderType} />
          ) : (
            <div className="flex items-center gap-1 rounded-xl bg-ui-page-alt p-1">
              {ORDER_TYPES.map((ot) => {
                const active = ot === orderType;
                return (
                  <button
                    key={ot}
                    type="button"
                    data-testid={`pos-switch-type-${ot}`}
                    aria-pressed={active}
                    onClick={() => onSwitchOrderType(ot)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-black transition-colors ${
                      active
                        ? 'bg-ui-primary text-ui-primary-fg shadow-ui-sm'
                        : 'text-ui-muted hover:text-ui-text'
                    }`}
                  >
                    {orderTypeLabel(t, ot)}
                  </button>
                );
              })}
            </div>
          )}

          {/* Table Selector Pill */}
          {orderType === 'dine_in' && (
            <button
              type="button"
              onClick={onOpenTableModal}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-ui-page-alt text-[11px] font-bold text-ui-muted hover:text-ui-text hover:bg-ui-primary-soft transition"
            >
              <UtensilsCrossed className="w-3 h-3 text-ui-success" />
              <span className="truncate max-w-[110px]">
                {activeTable?.name || (isAr ? 'اختر طاولة' : 'Select table')}
              </span>
            </button>
          )}

          {/* Customer Selector Pill */}
          <button
            type="button"
            onClick={onOpenCustomerModal}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-ui-page-alt text-[11px] font-bold text-ui-muted hover:text-ui-text hover:bg-ui-primary-soft transition"
          >
            <User className="w-3 h-3 text-ui-accent" />
            <span className="truncate max-w-[110px]">
              {currentCustomer?.name || (isAr ? 'عميل عام' : 'General')}
            </span>
          </button>

          {/* Guests count for dine-in */}
          {orderType === 'dine_in' && (
            <label className="flex items-center gap-1 text-[11px] text-ui-muted">
              {isAr ? 'أفراد' : 'Guests'}:
              <input
                type="number"
                min={1}
                value={guestCount || ''}
                placeholder="0"
                onChange={(e) => onGuestCountChange(parseInt(e.target.value) || null)}
                className="w-12 px-1.5 py-1 rounded-lg border border-ui-border bg-ui-surface-raised text-center text-xs font-bold text-ui-text focus:outline-none focus:ring-1 focus:ring-ui-ring"
              />
            </label>
          )}

          {activeOrderCreatedAt && (
            <span className="flex items-center gap-1 text-[11px] text-ui-subtle ms-auto">
              <Clock className="w-3 h-3" />
              {formatClockTime(activeOrderCreatedAt, lang)}
              {ago && <span className="hidden xl:inline">· {ago.n != null ? `${ago.n} ${t(ago.key)}` : t(ago.key)}</span>}
            </span>
          )}
          {orderNotes && (
            <div className="w-full text-[11px] text-ui-subtle bg-ui-page-alt px-2 py-1 rounded-lg truncate">
              {orderNotes}
            </div>
          )}
        </div>
      </div>

      {/* Cart Items List */}
      <div className="flex-1 overflow-y-auto px-2.5 py-2">
        {empty ? (
          <div className="flex flex-col items-center justify-center h-full text-ui-subtle">
            <div className="w-20 h-20 rounded-full bg-ui-page-alt flex items-center justify-center mb-3">
              <ShoppingCart className="w-10 h-10 text-ui-subtle" />
            </div>
            <p className="text-sm font-medium">{t('emptyCart')}</p>
            <p className="text-xs text-ui-subtle mt-1">
              {isAr ? 'اضغط على المنتج لإضافته' : 'Tap a product to add it'}
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {cart.map((item) => {
              const st = sentState[item.product.id] || { sentQty: 0, newQty: item.quantity, sent: false, partial: false };
              return (
                <div
                  key={item.product.id}
                  className="flex items-center gap-2 p-2 rounded-xl bg-ui-page-alt hover:bg-ui-page-alt/80 transition-colors group"
                >
                  <div
                    onClick={() => onConfigureItem?.(item)}
                    className="flex-1 min-w-0 cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-xs font-black text-ui-text hover:text-ui-accent">
                        {item.product.name}
                      </p>
                      {st.sent && (
                        <span title={isAr ? 'تم الإرسال للمطبخ' : 'Sent to kitchen'}>
                          <Check className="w-3 h-3 text-ui-success shrink-0" />
                        </span>
                      )}
                    </div>
                    {item.modifiers?.length ? (
                      <p className="mt-0.5 truncate text-[10px] text-ui-subtle">
                        {item.modifiers.map((m) => m.name.replace('note:', '📝 ')).join(' · ')}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      data-testid={`pos-cart-qty-decrease-${item.product.id}`}
                      aria-label={isAr ? `تقليل كمية ${item.product.name}` : `Decrease quantity ${item.product.name}`}
                      onClick={() => {
                        if (st.sentQty > 0 && item.quantity <= st.sentQty && onVoidItem) {
                          onVoidItem(item, st.sentQty);
                        } else {
                          onUpdateQty(item.product.id, -1);
                        }
                      }}
                      className="h-7 w-7 rounded-lg border border-ui-border flex items-center justify-center text-ui-text hover:bg-ui-surface active:scale-95"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span
                      data-testid={`pos-cart-qty-${item.product.id}`}
                      className="w-6 text-center text-xs font-black text-ui-text"
                    >
                      {item.quantity}
                    </span>
                    <button
                      data-testid={`pos-cart-qty-increase-${item.product.id}`}
                      aria-label={isAr ? `زيادة كمية ${item.product.name}` : `Increase quantity ${item.product.name}`}
                      onClick={() => onUpdateQty(item.product.id, 1)}
                      className="h-7 w-7 rounded-lg bg-ui-accent text-ui-primary-fg flex items-center justify-center hover:bg-ui-accent/90 active:scale-95 shadow-ui-sm"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <span className="w-20 text-end text-xs font-black text-ui-text">
                    {formatCurrency(item.quantity * item.unit_price - (item.discount_amount || 0), currency, lang)}
                  </span>

                  {canDeleteItem && (
                    <button
                      onClick={() => {
                        if (st.sentQty > 0 && onVoidItem) {
                          onVoidItem(item, st.sentQty);
                        } else {
                          onRemove(item.product.id);
                        }
                      }}
                      aria-label={isAr ? `حذف ${item.product.name}` : `Remove ${item.product.name}`}
                      className="p-1 text-ui-subtle hover:text-ui-danger transition"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Totals & Action Bar */}
      <div className="border-t border-ui-border p-3 flex-shrink-0 space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-ui-page-alt p-2">
            <p className="text-[10px] text-ui-subtle">{t('subtotal')}</p>
            <p className="text-xs font-black">{formatCurrency(subtotal, currency, lang)}</p>
          </div>
          <div className="rounded-xl bg-ui-page-alt p-2">
            <p className="text-[10px] text-ui-subtle">{t('discount')}</p>
            <p data-testid="pos-discount-value" className="text-xs font-black">
              {formatCurrency(discountValue, currency, lang)}
            </p>
          </div>
          <div className="rounded-xl bg-ui-primary-soft p-2">
            <p className="text-[10px] text-ui-subtle">{t('total')}</p>
            <p data-testid="pos-total-value" className="text-sm font-black text-ui-accent">
              {formatCurrency(total, currency, lang)}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          {canDiscount && (
            <button
              data-testid="pos-action-discount"
              aria-label={isAr ? 'الخصم (F6)' : 'Discount (F6)'}
              title={isAr ? 'الخصم (F6)' : 'Discount (F6)'}
              onClick={() => setShowDiscount(!showDiscount)}
              className={`flex-1 rounded-xl py-2 text-xs font-black transition ${
                showDiscount ? 'bg-ui-primary text-ui-primary-fg shadow-ui-sm' : 'bg-ui-page-alt text-ui-text hover:bg-ui-page-alt/80'
              }`}
            >
              <Percent className="mx-auto h-4 w-4" />
            </button>
          )}
          <button
            data-testid="pos-action-hold"
            aria-label={isAr ? 'تعليق الطلب (F4)' : 'Hold order (F4)'}
            title={isAr ? 'تعليق الطلب (F4)' : 'Hold order (F4)'}
            onClick={onHold}
            disabled={empty || orderLoading}
            className="flex-1 rounded-xl bg-ui-page-alt py-2 text-xs font-black disabled:opacity-40 hover:bg-ui-page-alt/80 transition text-ui-text"
          >
            <Pause className="mx-auto h-4 w-4" />
          </button>
          <button
            data-testid="pos-action-send-kitchen"
            aria-label={isAr ? 'إرسال للمطبخ' : 'Send to kitchen'}
            title={isAr ? 'إرسال للمطبخ' : 'Send to kitchen'}
            onClick={onSendKitchen}
            disabled={empty || kitchenSending || allSent}
            className="flex-1 rounded-xl bg-ui-page-alt py-2 text-xs font-black disabled:opacity-40 hover:bg-ui-page-alt/80 transition text-ui-text"
          >
            <ChefHat className="mx-auto h-4 w-4" />
          </button>
          <button
            data-testid="pos-action-print"
            aria-label={isAr ? 'طباعة (F9)' : 'Print (F9)'}
            title={isAr ? 'طباعة (F9)' : 'Print (F9)'}
            onClick={onPrint}
            disabled={empty}
            className="flex-1 rounded-xl bg-ui-page-alt py-2 text-xs font-black disabled:opacity-40 hover:bg-ui-page-alt/80 transition text-ui-text"
          >
            <Printer className="mx-auto h-4 w-4" />
          </button>
          <button
            data-testid="pos-action-pay"
            aria-label={isAr ? 'الدفع (F8)' : 'Pay (F8)'}
            onClick={onPay}
            disabled={empty || completing}
            className="flex-[2] rounded-xl bg-ui-success py-2 text-xs font-black text-ui-primary-fg disabled:opacity-40 hover:bg-ui-success/90 transition shadow-ui-md"
          >
            <Banknote className="mx-auto h-4 w-4 inline me-1" />
            {isAr ? 'الدفع' : 'Pay'}
          </button>
        </div>

        {/* Discount Drawer */}
        {showDiscount && (
          <div data-testid="pos-discount-editor" className="rounded-xl border border-ui-border p-2 bg-ui-page-alt space-y-1">
            <div className="flex gap-2">
              <button
                data-testid="pos-discount-percent"
                type="button"
                onClick={() => onDiscountTypeChange('percent')}
                className={`flex-1 rounded-lg p-2 text-xs font-black transition ${
                  discountType === 'percent'
                    ? 'bg-ui-primary text-ui-primary-fg shadow-ui-sm'
                    : 'bg-ui-surface text-ui-muted'
                }`}
              >
                %
              </button>
              <button
                data-testid="pos-discount-amount"
                type="button"
                onClick={() => onDiscountTypeChange('amount')}
                className={`flex-1 rounded-lg p-2 text-xs font-black transition ${
                  discountType === 'amount'
                    ? 'bg-ui-primary text-ui-primary-fg shadow-ui-sm'
                    : 'bg-ui-surface text-ui-muted'
                }`}
              >
                {currency}
              </button>
              <input
                data-testid="pos-discount-input"
                aria-label={isAr ? 'قيمة الخصم' : 'Discount value'}
                type="number"
                min={0}
                value={discountAmount || ''}
                onChange={(e) => onDiscountAmountChange(parseFloat(e.target.value) || 0)}
                className="w-24 rounded-lg border border-ui-border bg-ui-surface p-2 text-center text-xs font-bold text-ui-text"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
