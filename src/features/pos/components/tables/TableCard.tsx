import { useMemo } from 'react';
import { Users, Clock, ChefHat, Sparkles, Utensils, ArrowRightLeft, ShoppingBag } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { formatCurrency } from '@/lib/format';
import type { DiningTable, Order, OrderItem } from '@/lib/types';
import type { OrderKitchenSend } from '../../types';

export type TableOperationalStatus = 'vacant' | 'open' | 'sent' | 'new_additions' | 'needs_action';

interface TableCardProps {
  table: DiningTable;
  orders: Order[];
  itemsByOrder: Record<string, OrderItem[]>;
  kitchenSendsByOrder: Record<string, OrderKitchenSend[]>;
  currency: string;
  isSelected: boolean;
  onSelect: (table: DiningTable) => void;
  onTransfer?: (order: Order, table: DiningTable) => void;
}

export function TableCard({
  table,
  orders,
  itemsByOrder,
  kitchenSendsByOrder,
  currency,
  isSelected,
  onSelect,
  onTransfer,
}: TableCardProps) {
  const { lang } = useLanguage();
  const isAr = lang === 'ar';

  const activeOrder = orders[0] || null;

  // Compute status and operational indicators
  const { label, badgeClass, cardBgClass, elapsedMinutes, hasUnsent, hasSent } = useMemo(() => {
    if (!activeOrder || table.status === 'vacant') {
      return {
        status: 'vacant' as TableOperationalStatus,
        label: isAr ? 'متاحة' : 'Available',
        badgeClass: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:bg-emerald-500/20 dark:text-emerald-400',
        cardBgClass: 'bg-ui-surface hover:border-emerald-500/50 hover:bg-emerald-500/5',
        elapsedMinutes: 0,
        hasUnsent: false,
        hasSent: false,
      };
    }

    const orderItems = itemsByOrder[activeOrder.id] || [];
    const kitchenSends = kitchenSendsByOrder[activeOrder.id] || [];
    const sentItemIds = new Set(kitchenSends.map((s) => s.order_item_id));
    const sentItemsCount = orderItems.filter((i) => sentItemIds.has(i.id)).length;
    const unsentItemsCount = orderItems.length - sentItemsCount;

    const createdAt = new Date(activeOrder.created_at).getTime();
    const now = Date.now();
    const elapsed = Math.max(1, Math.round((now - createdAt) / (1000 * 60)));

    if (activeOrder.status === 'held') {
      return {
        status: 'needs_action' as TableOperationalStatus,
        label: isAr ? 'معلق / يحتاج إجراء' : 'Held / Action',
        badgeClass: 'bg-rose-500/10 text-rose-600 border-rose-500/20 dark:bg-rose-500/20 dark:text-rose-400',
        cardBgClass: 'bg-ui-surface border-rose-500/30 hover:border-rose-500',
        elapsedMinutes: elapsed,
        hasUnsent: unsentItemsCount > 0,
        hasSent: sentItemsCount > 0,
      };
    }

    if (sentItemsCount > 0 && unsentItemsCount > 0) {
      return {
        status: 'new_additions' as TableOperationalStatus,
        label: isAr ? 'تعديلات جديدة' : 'New Additions',
        badgeClass: 'bg-amber-500/15 text-amber-600 border-amber-500/30 dark:bg-amber-500/25 dark:text-amber-400',
        cardBgClass: 'bg-ui-surface border-amber-500/40 hover:border-amber-500',
        elapsedMinutes: elapsed,
        hasUnsent: true,
        hasSent: true,
      };
    }

    if (sentItemsCount > 0 && unsentItemsCount === 0) {
      return {
        status: 'sent' as TableOperationalStatus,
        label: isAr ? 'تم الإرسال للمطبخ' : 'Sent to Kitchen',
        badgeClass: 'bg-sky-500/10 text-sky-600 border-sky-500/20 dark:bg-sky-500/20 dark:text-sky-400',
        cardBgClass: 'bg-ui-surface border-sky-500/30 hover:border-sky-500',
        elapsedMinutes: elapsed,
        hasUnsent: false,
        hasSent: true,
      };
    }

    return {
      status: 'open' as TableOperationalStatus,
      label: isAr ? 'طلب مفتوح' : 'Open Order',
      badgeClass: 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:bg-amber-500/20 dark:text-amber-400',
      cardBgClass: 'bg-ui-surface border-amber-500/30 hover:border-amber-500',
      elapsedMinutes: elapsed,
      hasUnsent: true,
      hasSent: false,
    };
  }, [activeOrder, table.status, kitchenSendsByOrder, itemsByOrder, isAr]);

  const orderItems = activeOrder ? itemsByOrder[activeOrder.id] || [] : [];
  const itemsTotalCount = orderItems.reduce((s, it) => s + (Number(it.quantity) || 0), 0);

  return (
    <div
      onClick={() => onSelect(table)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(table)}
      className={`group relative flex flex-col justify-between rounded-2xl border p-3 text-start transition-all cursor-pointer select-none ${cardBgClass} ${
        isSelected
          ? 'ring-2 ring-ui-primary ring-offset-2 border-ui-primary shadow-ui-md'
          : 'border-ui-border shadow-ui-xs hover:shadow-ui-sm'
      }`}
    >
      {/* Top row: Table name, capacity & Status badge */}
      <div className="flex items-start justify-between gap-1.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-black text-ui-text group-hover:text-ui-primary transition-colors truncate">
              {table.name}
            </span>
            <span className="flex items-center gap-0.5 text-[10px] font-bold text-ui-muted bg-ui-page px-1.5 py-0.5 rounded-md border border-ui-border shrink-0">
              <Users className="h-2.5 w-2.5" />
              {table.capacity || 2}
            </span>
          </div>
          {activeOrder && (
            <p className="text-[11px] font-bold text-ui-subtle mt-0.5 truncate">
              #{activeOrder.order_number}
            </p>
          )}
        </div>

        {/* Status Badge */}
        <span
          className={`shrink-0 rounded-lg border px-2 py-0.5 text-[10px] font-black tracking-tight flex items-center gap-1 ${badgeClass}`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full shrink-0 ${
              status === 'vacant'
                ? 'bg-emerald-500'
                : status === 'sent'
                ? 'bg-sky-500'
                : status === 'new_additions'
                ? 'bg-amber-500 animate-pulse'
                : status === 'needs_action'
                ? 'bg-rose-500'
                : 'bg-amber-500'
            }`}
          />
          {label}
        </span>
      </div>

      {/* Middle & Bottom details if there's an active order */}
      {activeOrder ? (
        <div className="mt-2.5 pt-2 border-t border-ui-border/70 space-y-1.5">
          {/* Items & Total amount */}
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-ui-muted flex items-center gap-1">
              <ShoppingBag className="h-3 w-3 text-ui-subtle" />
              {itemsTotalCount} {isAr ? 'صنف' : 'items'}
            </span>
            <span className="font-black text-ui-text text-xs tabular-nums">
              {formatCurrency(activeOrder.total, currency, lang)}
            </span>
          </div>

          {/* Duration & Kitchen/Unsent Indicators */}
          <div className="flex items-center justify-between text-[10px] text-ui-subtle">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3 text-ui-subtle shrink-0" />
              {isAr ? `${elapsedMinutes} دقيقة` : `${elapsedMinutes}m ago`}
            </span>

            <div className="flex items-center gap-1 shrink-0">
              {hasSent && (
                <span
                  title={isAr ? 'تم الإرسال للمطبخ' : 'Sent to kitchen'}
                  className="flex items-center gap-0.5 rounded-md bg-sky-500/10 text-sky-600 px-1 py-0.5 text-[9px] font-bold"
                >
                  <ChefHat className="h-2.5 w-2.5" />
                  {isAr ? 'المطبخ' : 'KDS'}
                </span>
              )}
              {hasUnsent && status === 'new_additions' && (
                <span
                  title={isAr ? 'توجد أصناف جديدة لم تُرسل بعد' : 'Unsent additions'}
                  className="flex items-center gap-0.5 rounded-md bg-amber-500/15 text-amber-700 px-1 py-0.5 text-[9px] font-bold"
                >
                  <Sparkles className="h-2.5 w-2.5 text-amber-600 animate-spin" />
                  {isAr ? 'جديد' : 'New'}
                </span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-2.5 pt-2 border-t border-ui-border/50 flex items-center justify-between text-[11px] text-ui-subtle">
          <span className="flex items-center gap-1 text-emerald-600 font-semibold">
            <Utensils className="h-3 w-3" />
            {isAr ? 'جاهزة للاستقبال' : 'Ready for guests'}
          </span>
          <span className="text-[10px] font-bold text-ui-primary opacity-0 group-hover:opacity-100 transition-opacity">
            {isAr ? 'فتح طلب +' : '+ Open'}
          </span>
        </div>
      )}

      {/* Quick transfer button on hover if table has an active order */}
      {activeOrder && onTransfer && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTransfer(activeOrder, table);
          }}
          title={isAr ? 'نقل الطلب إلى طاولة أخرى' : 'Transfer order to another table'}
          className="absolute top-2 end-2 hidden group-hover:flex items-center justify-center h-6 w-6 rounded-lg bg-ui-page hover:bg-ui-page-alt border border-ui-border text-ui-muted hover:text-ui-primary transition-colors shadow-ui-xs"
        >
          <ArrowRightLeft className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
