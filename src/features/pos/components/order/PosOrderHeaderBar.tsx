import { useMemo } from 'react';
import {
  Utensils,
  Clock,
  ArrowRightLeft,
  ChefHat,
  Banknote,
  Pause,
  Trash2,
  ShoppingBag,
  Bike,
  LayoutGrid,
  Boxes,
  Lock,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { formatCurrency } from '@/lib/format';
import type { DiningTable, OrderItem, OrderType } from '@/lib/types';
import type { OrderKitchenSend } from '../../types';
import { orderTypeLabel } from '../../utils/format';

interface PosOrderHeaderBarProps {
  orderNumber: string | null;
  orderId: string | null;
  activeTable: DiningTable | null;
  orderType: OrderType;
  itemsCount: number;
  total: number;
  currency: string;
  createdAt: string | null;
  kitchenSends: OrderKitchenSend[];
  orderItems: OrderItem[];
  kitchenSending: boolean;
  completing: boolean;
  canDiscount?: boolean;
  canDeleteItem?: boolean;
  hasUnsentItems: boolean;
  isOrderOwner?: boolean;
  orderCashierName?: string | null;
  onOpenTablesView?: () => void;
  onOpenRawMaterials?: () => void;
  onOpenTransferModal?: () => void;
  onHoldOrder: () => void;
  onSendKitchen: () => void;
  onOpenDiscount?: () => void;
  onPay: () => void;
  onClear: () => void;
  onNewOrder: () => void;
}

export function PosOrderHeaderBar({
  orderNumber,
  activeTable,
  orderType,
  itemsCount,
  total,
  currency,
  createdAt,
  kitchenSends,
  kitchenSending,
  completing,
  canDeleteItem = true,
  hasUnsentItems,
  isOrderOwner = true,
  orderCashierName,
  onOpenTablesView,
  onOpenRawMaterials,
  onOpenTransferModal,
  onHoldOrder,
  onSendKitchen,
  onPay,
  onClear,
}: PosOrderHeaderBarProps) {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';

  const elapsedText = useMemo(() => {
    if (!createdAt) return null;
    const diff = Math.max(1, Math.round((Date.now() - new Date(createdAt).getTime()) / (1000 * 60)));
    return isAr ? `منذ ${diff} دقيقة` : `${diff}m ago`;
  }, [createdAt, isAr]);

  const hasSent = kitchenSends.length > 0;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ui-border bg-ui-page px-3 py-2 text-xs select-none">
      {/* Left info: Table / Order / Items / Total / Time */}
      <div className="flex items-center gap-2 flex-wrap min-w-0">
        {/* Table or Order Type Badge */}
        {activeTable ? (
          <div className="flex items-center gap-1.5 rounded-xl bg-ui-primary px-2.5 py-1 text-ui-primary-fg font-black shadow-ui-xs shrink-0">
            <Utensils className="h-3.5 w-3.5" />
            <span>{activeTable.name}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 rounded-xl bg-ui-page-alt border border-ui-border px-2.5 py-1 text-ui-text font-black shrink-0">
            {orderType === 'delivery' ? <Bike className="h-3.5 w-3.5" /> : <ShoppingBag className="h-3.5 w-3.5" />}
            <span>{orderTypeLabel(t, orderType)}</span>
          </div>
        )}

        {/* Order Number */}
        <div className="flex items-center gap-1 text-ui-text font-black">
          <span>{orderNumber ? `#${orderNumber}` : t('newOrder')}</span>
        </div>

        <span className="text-ui-muted">·</span>

        {/* Items Count & Total */}
        <span className="text-ui-muted font-bold">
          {itemsCount} {isAr ? 'صنف' : 'items'}
        </span>

        <span className="text-ui-muted">·</span>

        <span className="text-ui-text font-black tabular-nums">
          {formatCurrency(total, currency, lang)}
        </span>

        {/* Elapsed Time */}
        {elapsedText && (
          <>
            <span className="text-ui-muted">·</span>
            <span className="flex items-center gap-1 text-ui-subtle font-semibold">
              <Clock className="h-3 w-3" />
              {elapsedText}
            </span>
          </>
        )}

        {/* Kitchen Send Status Pill */}
        {hasSent && (
          <span
            className={`flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-black border ${
              hasUnsentItems
                ? 'bg-amber-500/15 text-amber-700 border-amber-500/30 animate-pulse'
                : 'bg-sky-500/10 text-sky-600 border-sky-500/20'
            }`}
          >
            <ChefHat className="h-3 w-3" />
            {hasUnsentItems ? (isAr ? 'تعديلات جديدة' : 'New Additions') : (isAr ? 'تم الإرسال' : 'Sent to Kitchen')}
          </span>
        )}

        {/* Order Ownership Lock Pill */}
        {!isOrderOwner && (
          <span className="flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-black bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30">
            <Lock className="h-3 w-3 text-rose-600" />
            <span>{isAr ? `مقفل للكاشير: ${orderCashierName || 'آخر'}` : `Locked to: ${orderCashierName || 'Cashier'}`}</span>
          </span>
        )}
      </div>

      {/* Right Quick Action Buttons */}
      <div className="flex items-center gap-1.5 flex-wrap shrink-0">
        {/* Fullscreen Tables Selector Toggle */}
        {onOpenTablesView && (
          <button
            type="button"
            onClick={onOpenTablesView}
            title={isAr ? 'عرض الطاولات والطلبات السريعة' : 'View Tables & Quick Orders'}
            className="flex items-center gap-1.5 rounded-xl border border-ui-border bg-ui-surface hover:bg-ui-page-alt px-2.5 py-1.5 font-black text-ui-text hover:border-ui-primary hover:text-ui-primary transition active:scale-95 shadow-ui-xs"
          >
            <LayoutGrid className="h-3.5 w-3.5 text-ui-primary" />
            <span className="hidden sm:inline">{isAr ? 'الطاولات' : 'Tables'}</span>
          </button>
        )}

        {/* Raw & Manufactured Materials Monitor Toggle */}
        {onOpenRawMaterials && (
          <button
            type="button"
            onClick={onOpenRawMaterials}
            title={isAr ? 'رصد الخامات والمواد المصنعة وتوفر المكونات' : 'Raw Materials & Manufactured Products Stock'}
            className="flex items-center gap-1.5 rounded-xl border border-ui-border bg-ui-surface hover:bg-ui-page-alt px-2.5 py-1.5 font-black text-ui-text hover:border-emerald-500 hover:text-emerald-600 transition active:scale-95 shadow-ui-xs"
          >
            <Boxes className="h-3.5 w-3.5 text-emerald-600" />
            <span className="hidden sm:inline">{isAr ? 'رصد الخامات' : 'Materials'}</span>
          </button>
        )}

        {/* Table Transfer button (if order is linked to a table) */}
        {activeTable && onOpenTransferModal && (
          <button
            type="button"
            onClick={onOpenTransferModal}
            title={isAr ? 'نقل الطلب إلى طاولة أخرى' : 'Transfer order'}
            className="flex items-center gap-1 rounded-xl border border-ui-border bg-ui-surface px-2.5 py-1.5 font-black text-ui-text hover:border-ui-primary hover:text-ui-primary hover:bg-ui-primary-soft transition active:scale-95 shadow-ui-xs"
          >
            <ArrowRightLeft className="h-3.5 w-3.5 text-ui-primary" />
            <span className="hidden sm:inline">{isAr ? 'نقل الطاولة' : 'Transfer'}</span>
          </button>
        )}

        {/* Hold order button */}
        {itemsCount > 0 && (
          <button
            type="button"
            onClick={onHoldOrder}
            title={isAr ? 'تعليق الطلب واستئنافه لاحقاً' : 'Hold order'}
            className="flex items-center gap-1 rounded-xl border border-ui-border bg-ui-surface px-2.5 py-1.5 font-black text-ui-text hover:bg-ui-page-alt transition active:scale-95 shadow-ui-xs"
          >
            <Pause className="h-3.5 w-3.5 text-amber-600" />
            <span className="hidden sm:inline">{isAr ? 'تعليق' : 'Hold'}</span>
          </button>
        )}

        {/* Send to Kitchen button */}
        {itemsCount > 0 && (
          <button
            type="button"
            onClick={onSendKitchen}
            disabled={kitchenSending || (!hasUnsentItems && hasSent)}
            title={isAr ? 'إرسال التعديلات الجديدة للمطبخ' : 'Send to kitchen'}
            className={`flex items-center gap-1 rounded-xl px-2.5 py-1.5 font-black text-xs transition active:scale-95 shadow-ui-xs ${
              hasUnsentItems || !hasSent
                ? 'bg-amber-500 text-white hover:bg-amber-600 shadow-amber-500/20'
                : 'bg-ui-page-alt text-ui-muted cursor-not-allowed'
            }`}
          >
            <ChefHat className="h-3.5 w-3.5" />
            <span>
              {kitchenSending
                ? isAr
                  ? 'جارٍ الإرسال...'
                  : 'Sending...'
                : hasSent && hasUnsentItems
                ? isAr
                  ? 'إرسال الجديد'
                  : 'Send New'
                : isAr
                ? 'إرسال للمطبخ'
                : 'Kitchen'}
            </span>
          </button>
        )}

        {/* Pay / Checkout button */}
        {itemsCount > 0 && (
          <button
            type="button"
            onClick={onPay}
            disabled={completing}
            title={isAr ? 'إتمام الحساب والدفع' : 'Proceed to payment'}
            className="flex items-center gap-1 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 px-3 py-1.5 font-black text-xs transition active:scale-95 shadow-ui-xs"
          >
            <Banknote className="h-3.5 w-3.5" />
            <span>{isAr ? 'دفع' : 'Pay'}</span>
          </button>
        )}

        {/* Clear / New Order */}
        {itemsCount > 0 && canDeleteItem && (
          <button
            type="button"
            onClick={onClear}
            title={isAr ? 'مسح الأصناف الحالية' : 'Clear order'}
            className="flex items-center justify-center h-8 w-8 rounded-xl text-ui-danger hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 transition"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
