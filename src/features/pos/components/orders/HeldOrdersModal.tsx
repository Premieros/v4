import { Pause, Play, Trash2, X, UtensilsCrossed, Car, Bike, ShoppingBag } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { formatCurrency } from '@/lib/format';
import type { Customer, DiningTable, Order, OrderItem } from '@/lib/types';
import { timeAgo } from '../../utils/timeAgo';
import { orderTypeLabel } from '../../utils/format';

interface HeldOrdersModalProps {
  isOpen: boolean;
  onClose: () => void;
  orders: Order[];
  itemsByOrder: Record<string, OrderItem[]>;
  tableById: Record<string, DiningTable>;
  customerById: Record<string, Customer>;
  currency: string;
  onResume: (order: Order) => void;
  onCancel: (order: Order) => void;
}

export function HeldOrdersModal({
  isOpen,
  onClose,
  orders,
  itemsByOrder,
  tableById,
  customerById,
  currency,
  onResume,
  onCancel,
}: HeldOrdersModalProps) {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';

  if (!isOpen) return null;

  const heldOrders = orders.filter((o) => o.status === 'held');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ui-text/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-ui-border bg-ui-surface shadow-ui-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ui-border px-6 py-4">
          <div className="flex items-center gap-2">
            <Pause className="h-5 w-5 text-ui-accent" />
            <h3 className="text-base font-black text-ui-text">
              {isAr ? 'الطلبات المعلقة' : 'Held Orders'} ({heldOrders.length})
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label={isAr ? 'إغلاق' : 'Close'}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-ui-subtle hover:bg-ui-page-alt"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {heldOrders.length === 0 ? (
            <div className="py-12 text-center text-ui-subtle">
              <Pause className="mx-auto mb-2 h-12 w-12 opacity-20" />
              <p className="text-sm font-bold">{isAr ? 'لا توجد طلبات معلقة حالياً' : 'No held orders at the moment'}</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {heldOrders.map((order) => {
                const items = itemsByOrder[order.id] || [];
                const table = order.table_id ? tableById[order.table_id] : null;
                const customer = order.customer_id ? customerById[order.customer_id] : null;
                const ago = order.created_at ? timeAgo(order.created_at) : null;

                return (
                  <div
                    key={order.id}
                    className="flex flex-col justify-between rounded-2xl border border-ui-border bg-ui-page-alt p-4 transition hover:border-ui-primary"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-black text-ui-text">
                          #{order.order_number}
                        </span>
                        <span className="flex items-center gap-1 rounded-lg bg-ui-surface px-2 py-0.5 text-[10px] font-black text-ui-muted border border-ui-border">
                          {order.order_type === 'dine_in' && <UtensilsCrossed className="h-3 w-3 text-ui-success" />}
                          {order.order_type === 'drive_thru' && <Car className="h-3 w-3 text-ui-info" />}
                          {order.order_type === 'delivery' && <Bike className="h-3 w-3 text-ui-info" />}
                          {order.order_type === 'takeaway' && <ShoppingBag className="h-3 w-3 text-ui-accent" />}
                          {orderTypeLabel(t, order.order_type)}
                        </span>
                      </div>

                      <div className="mt-2 space-y-1 text-xs text-ui-muted">
                        {table && (
                          <p className="flex items-center gap-1 font-bold text-ui-text">
                            <UtensilsCrossed className="h-3.5 w-3.5 text-ui-success" />
                            {table.name}
                          </p>
                        )}
                        {customer && (
                          <p className="font-bold text-ui-text">{customer.name}</p>
                        )}
                        <p className="text-[11px] text-ui-subtle">
                          {items.length} {isAr ? 'أصناف' : 'items'} ·{' '}
                          {ago ? (ago.n != null ? `${ago.n} ${t(ago.key)}` : t(ago.key)) : ''}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between border-t border-ui-border/60 pt-3">
                      <span className="text-base font-black text-ui-accent">
                        {formatCurrency(order.total, currency, lang)}
                      </span>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => onCancel(order)}
                          title={isAr ? 'إلغاء الطلب' : 'Cancel Order'}
                          className="flex h-8 w-8 items-center justify-center rounded-xl text-ui-subtle hover:bg-ui-danger/10 hover:text-ui-danger"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onResume(order);
                            onClose();
                          }}
                          className="flex items-center gap-1 rounded-xl bg-ui-primary px-3 py-1.5 text-xs font-black text-ui-primary-fg shadow-ui-sm hover:bg-ui-primary-hover"
                        >
                          <Play className="h-3.5 w-3.5 fill-current" />
                          <span>{isAr ? 'استرجاع' : 'Resume'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
