import { ArrowLeft, Banknote, CreditCard, Smartphone, FileText, Tag, UtensilsCrossed, Users, CheckCircle2, Car, Bike } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { Button } from '@/components/Button';
import { formatCurrency } from '@/lib/format';
import type { PosPaymentMethod } from '@/lib/posMath';
import type { CartItem, Customer, DiningTable, OrderType } from '@/lib/types';
import { orderTypeLabel } from '../../utils/format';
import { parseCarNotes, parseDeliveryNotes } from '../../utils/orderLabels';

interface PaymentPanelProps {
  currentBranchName: string;
  orderType: OrderType;
  activeTable: DiningTable | null;
  activeOrderNumber: string | null;
  guestCount: number | null;
  onGuestCountChange: (n: number | null) => void;
  customerId: string;
  customers: Customer[];
  onCustomerChange: (id: string) => void;
  discountType: 'amount' | 'percent';
  discountAmount: number;
  onDiscountTypeChange: (v: 'amount' | 'percent') => void;
  onDiscountAmountChange: (v: number) => void;
  paymentMethod: PosPaymentMethod;
  onPaymentMethodChange: (m: PosPaymentMethod) => void;
  paidAmount: number;
  onPaidAmountChange: (v: number) => void;
  subtotal: number;
  discountValue: number;
  taxAmount: number;
  total: number;
  change: number;
  completing: boolean;
  canComplete: boolean;
  onComplete: () => void;
  onBack: () => void;
  currency: string;
  cart: CartItem[];
  orderNotes: string;
}

const METHODS: PosPaymentMethod[] = ['cash', 'card', 'transfer', 'credit'];
const ICONS: Record<PosPaymentMethod, React.ReactNode> = {
  cash: <Banknote className="h-6 w-6" />,
  card: <CreditCard className="h-6 w-6" />,
  transfer: <Smartphone className="h-6 w-6" />,
  credit: <FileText className="h-6 w-6" />,
};

export function PaymentPanel(p: PaymentPanelProps) {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';
  const round = Math.ceil((p.total || 0) / 50) * 50;
  const quick = [50, 100, 200, 500];
  const customerName = p.customerId ? p.customers.find((c) => c.id === p.customerId)?.name || '' : '';
  const plate = p.orderType === 'drive_thru' ? parseCarNotes(p.orderNotes).plate : '';
  const deliveryPhone = p.orderType === 'delivery' && !customerName ? parseDeliveryNotes(p.orderNotes).phone : '';

  return (
    <div className="flex h-full min-h-0 flex-col bg-ui-page">
      <div className="flex items-center justify-between border-b border-ui-border bg-ui-surface px-4 py-4">
        <button onClick={p.onBack} className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-ui-page-alt">
          <ArrowLeft className={`h-5 w-5 ${isAr ? '' : 'rotate-180'}`} />
        </button>
        <div className="text-center">
          <p className="text-xs font-bold text-ui-subtle">{t('payOrder')}</p>
          <p className="text-lg font-black text-ui-text">{p.activeOrderNumber ? `#${p.activeOrderNumber}` : ''}</p>
        </div>
        <div className="w-11" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-2xl space-y-4">
          <div className="rounded-3xl border border-ui-border bg-ui-surface p-5 shadow-ui-sm">
            <div className="flex flex-wrap items-center gap-3 text-sm font-black text-ui-text">
              <Tag className="h-5 w-5 text-ui-accent" />
              {p.currentBranchName}
              <span className="rounded-xl bg-ui-page-alt px-3 py-1.5">{orderTypeLabel(t, p.orderType)}</span>
              {p.activeTable && (
                <span className="flex items-center gap-1 rounded-xl bg-ui-success/10 px-3 py-1.5 text-ui-success">
                  <UtensilsCrossed className="h-4 w-4" />
                  {p.activeTable.name}
                </span>
              )}
              {plate && (
                <span className="flex items-center gap-1 rounded-xl bg-ui-info/10 px-3 py-1.5 text-ui-info">
                  <Car className="h-4 w-4" />
                  {plate}
                </span>
              )}
              {deliveryPhone && (
                <span className="flex items-center gap-1 rounded-xl bg-ui-info/10 px-3 py-1.5 text-ui-info">
                  <Bike className="h-4 w-4" />
                  {deliveryPhone}
                </span>
              )}
              {customerName && (
                <span className="flex items-center gap-1 rounded-xl bg-ui-page-alt px-3 py-1.5 text-ui-accent">
                  <Users className="h-4 w-4" />
                  {customerName}
                </span>
              )}
            </div>
            {p.orderType === 'dine_in' && (
              <label className="mt-4 flex items-center gap-2 text-xs font-bold text-ui-muted">
                <Users className="h-4 w-4" />
                {isAr ? 'عدد الأشخاص' : 'Guests'}
                <input
                  type="number"
                  min={1}
                  value={p.guestCount || ''}
                  onChange={(e) => p.onGuestCountChange(parseInt(e.target.value) || null)}
                  className="w-20 rounded-xl border border-ui-border bg-ui-surface-raised px-3 py-2 text-center text-ui-text"
                />
              </label>
            )}
          </div>

          <div data-testid="pos-payment-receipt" className="rounded-3xl border border-ui-border bg-ui-surface p-5 shadow-ui-sm">
            <p className="mb-1 text-xs font-black text-ui-muted">{isAr ? 'الفاتورة' : 'Receipt'}</p>
            {p.cart.length === 0 ? (
              <p className="py-6 text-center text-sm text-ui-muted">{t('emptyCart')}</p>
            ) : (
              <ul className="divide-y divide-ui-border/60">
                {p.cart.map((it) => {
                  const lineTotal = it.quantity * it.unit_price - (it.discount_amount || 0);
                  return (
                    <li key={it.product.id} className="flex items-start gap-2 py-2">
                      <span className="pt-0.5 text-xs font-black text-ui-subtle">{it.quantity}×</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-bold text-ui-text">{it.product.name}</p>
                        <p className="text-[10px] text-ui-subtle">
                          {formatCurrency(it.unit_price, p.currency, lang)}
                          {it.discount_amount > 0 && (
                            <span className="text-ui-danger">
                              {' '}−{formatCurrency(it.discount_amount, p.currency, lang)}
                            </span>
                          )}
                        </p>
                      </div>
                      <span className="pt-0.5 text-xs font-black">{formatCurrency(lineTotal, p.currency, lang)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div data-testid="pos-payment-totals" className="rounded-3xl border border-ui-border bg-ui-surface p-5 shadow-ui-sm">
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-ui-muted">{t('subtotal')}</span>
                <span className="font-bold">{formatCurrency(p.subtotal, p.currency, lang)}</span>
              </div>
              {p.discountValue > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-ui-muted">{t('discount')}</span>
                  <span className="font-bold text-ui-danger">−{formatCurrency(p.discountValue, p.currency, lang)}</span>
                </div>
              )}
              {p.taxAmount > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-ui-muted">{t('tax')}</span>
                  <span className="font-bold">{formatCurrency(p.taxAmount, p.currency, lang)}</span>
                </div>
              )}
              <div className="flex items-center justify-between border-t border-ui-border pt-2 text-base">
                <span className="font-black">{t('total')}</span>
                <span className="font-black text-ui-accent">{formatCurrency(p.total, p.currency, lang)}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {METHODS.map((m) => (
              <button
                data-testid={`pos-payment-method-${m}`}
                key={m}
                onClick={() => p.onPaymentMethodChange(m)}
                className={`flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border-2 bg-ui-surface text-sm font-black shadow-ui-sm transition active:scale-[.98] ${
                  p.paymentMethod === m ? 'border-ui-primary bg-ui-primary-soft text-ui-accent shadow-ui-lg' : 'border-ui-border text-ui-muted'
                }`}
              >
                {ICONS[m]}
                {t(m)}
                {p.paymentMethod === m && <CheckCircle2 className="h-4 w-4 text-ui-accent" />}
              </button>
            ))}
          </div>

          {p.paymentMethod !== 'credit' && (
            <div className="rounded-3xl border border-ui-border bg-ui-surface p-5 shadow-ui-sm">
              <label className="mb-2 block text-xs font-black text-ui-muted">{t('paid')}</label>
              <input
                type="number"
                value={p.paidAmount || ''}
                onChange={(e) => p.onPaidAmountChange(parseFloat(e.target.value) || 0)}
                className="h-16 w-full rounded-2xl border border-ui-border bg-ui-page-alt text-center text-3xl font-black text-ui-text outline-none focus:border-ui-primary focus:ring-2 focus:ring-ui-ring"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => p.onPaidAmountChange(p.total)} className="rounded-xl bg-ui-success/10 px-4 py-2.5 text-xs font-black text-ui-success">
                  {isAr ? 'بالضبط' : 'Exact'}
                </button>
                <button onClick={() => p.onPaidAmountChange(round)} className="rounded-xl bg-ui-page-alt px-4 py-2.5 text-xs font-black text-ui-muted">
                  {formatCurrency(round, p.currency, lang)}
                </button>
                {quick.map((v) => (
                  <button key={v} onClick={() => p.onPaidAmountChange(p.paidAmount + v)} className="rounded-xl bg-ui-page-alt px-4 py-2.5 text-xs font-black text-ui-muted">
                    +{v}
                  </button>
                ))}
              </div>
              {p.change > 0 && (
                <div className="mt-3 flex justify-between rounded-2xl bg-ui-success/10 p-4 text-sm font-black text-ui-success">
                  <span>{t('change')}</span>
                  <span>{formatCurrency(p.change, p.currency, lang)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-ui-border bg-ui-surface p-4">
        <div className="mx-auto max-w-2xl">
          <div className="mb-3 flex items-end justify-between">
            <span className="text-sm font-bold text-ui-muted">{t('total')}</span>
            <span className="text-3xl font-black text-ui-accent">{formatCurrency(p.total, p.currency, lang)}</span>
          </div>
          <Button
            data-testid="pos-payment-confirm"
            size="lg"
            className="w-full !min-h-14 !rounded-2xl !bg-ui-success text-lg font-black shadow-ui-xl"
            onClick={p.onComplete}
            disabled={p.completing || !p.canComplete}
          >
            {p.completing ? (isAr ? 'جاري المعالجة...' : 'Processing...') : isAr ? 'تأكيد الدفع' : 'Confirm Payment'}
          </Button>
        </div>
      </div>
    </div>
  );
}
