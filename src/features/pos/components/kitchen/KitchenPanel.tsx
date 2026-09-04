import { useMemo } from 'react';
import { ChefHat, X, Clock, Send, UtensilsCrossed } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import type { DiningTable, Order, OrderItem } from '@/lib/types';
import type { OrderKitchenSend } from '../../types';
import { orderTypeLabel } from '../../utils/format';
import { deriveOrderState } from '../../utils/orderState';
import { formatClockTime, timeAgo } from '../../utils/timeAgo';
import { OrderStatusBadge } from '../order/OrderStatusBadge';

interface KitchenPanelProps {
  open: boolean;
  onClose: () => void;
  orders: Order[];
  itemsByOrder: Record<string, OrderItem[]>;
  kitchenSendsByOrder: Record<string, OrderKitchenSend[]>;
  tableById: Record<string, DiningTable>;
  productNames: Record<string, string>;
}

export function KitchenPanel({ open, onClose, orders, itemsByOrder, kitchenSendsByOrder, tableById, productNames }: KitchenPanelProps) {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';

  const itemById = useMemo(() => {
    const map: Record<string, OrderItem> = {};
    for (const list of Object.values(itemsByOrder)) for (const it of list) map[it.id] = it;
    return map;
  }, [itemsByOrder]);

  const withSends = orders.filter((o) => (kitchenSendsByOrder[o.id]?.length || 0) > 0);
  const awaiting = orders.filter((o) => (kitchenSendsByOrder[o.id]?.length || 0) === 0 && o.status === 'open');

  const renderOrder = (order: Order) => {
    const sends = kitchenSendsByOrder[order.id] || [];
    const firstSent = sends.length > 0 ? sends.map((s) => s.sent_at).sort()[0] : null;
    const ago = firstSent ? timeAgo(firstSent) : null;
    return (
      <div key={order.id} className="p-3 rounded-xl border border-ui-border bg-ui-page-alt space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-black text-ui-text">{order.order_number}</span>
            <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-ui-page-alt text-ui-muted">
              {orderTypeLabel(t, order.order_type)}
            </span>
            {order.table_id && tableById[order.table_id] && (
              <span className="shrink-0 text-[11px] font-semibold text-ui-success">
                {tableById[order.table_id].name}
              </span>
            )}
          </div>
          <OrderStatusBadge state={deriveOrderState(order, sends.length > 0)} />
        </div>

        {firstSent && ago && (
          <div className="flex items-center gap-1.5 text-[11px] text-ui-subtle">
            <Clock className="w-3 h-3" />
            {isAr
              ? `أُرسل ${ago.n != null ? `${ago.n} ${t(ago.key)}` : t(ago.key)}`
              : `Sent ${ago.n != null ? `${ago.n} ${t(ago.key)}` : t(ago.key)}`}
          </div>
        )}

        <div className="space-y-1">
          {sends.map((send) => {
            const item = itemById[send.order_item_id];
            const name = item?.product_id ? (productNames[item.product_id] || '—') : '—';
            return (
              <div key={send.id} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 min-w-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-ui-warning shrink-0" />
                  <span className="truncate font-medium text-ui-text">{name}</span>
                  <span className="shrink-0 text-[11px] font-bold text-ui-warning">× {Number(item?.quantity ?? 0)}</span>
                </span>
                <span className="shrink-0 text-[11px] text-ui-subtle tabular-nums">{formatClockTime(send.sent_at, lang)}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <>
      {open && <div className="fixed inset-0 top-16 z-40 bg-ui-text/40 backdrop-blur-[1px]" onClick={onClose} />}
      <aside
        className={`fixed top-16 bottom-0 z-50 w-[360px] max-w-[88vw] bg-ui-surface border-s border-ui-border shadow-ui-xl transition-transform duration-300 flex flex-col end-0 ${
          open ? 'translate-x-0' : isAr ? '-translate-x-full' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-ui-border flex-shrink-0">
          <h2 className="text-sm font-bold text-ui-text flex items-center gap-2">
            <ChefHat className="w-4 h-4 text-ui-warning" />
            {t('kitchen')}
            <span className="px-2 py-0.5 rounded-full bg-ui-warning/10 text-ui-warning text-[11px] font-bold">{withSends.length}</span>
          </h2>
          <button onClick={onClose} className="p-2 rounded-lg text-ui-muted hover:bg-ui-page-alt transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2.5 space-y-4">
          <section className="space-y-2">
            <h3 className="text-[11px] font-black text-ui-subtle uppercase tracking-wider flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5" /> {t('inKitchen')} ({withSends.length})
            </h3>
            {withSends.length === 0 ? (
              <div className="text-center py-8 text-ui-subtle">
                <ChefHat className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">{isAr ? 'لا توجد أطباق في المطبخ' : 'No dishes in the kitchen'}</p>
              </div>
            ) : (
              withSends.map(renderOrder)
            )}
          </section>

          {awaiting.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-[11px] font-black text-ui-subtle uppercase tracking-wider flex items-center gap-1.5">
                <UtensilsCrossed className="w-3.5 h-3.5" /> {isAr ? 'بانتظار الإرسال' : 'Awaiting send'} ({awaiting.length})
              </h3>
              {awaiting.map(renderOrder)}
            </section>
          )}
        </div>
      </aside>
    </>
  );
}
