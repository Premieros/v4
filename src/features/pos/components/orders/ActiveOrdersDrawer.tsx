import { useEffect, useMemo, useState } from 'react';
import { Search, X, UtensilsCrossed, Banknote, Play, Trash2, ListOrdered, Car, Bike } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { formatCurrency } from '@/lib/format';
import type { Customer, DiningTable, Order, OrderItem } from '@/lib/types';
import type { OrderKitchenSend } from '../../types';
import { stageOfOrder, type OrderStage } from '../../utils/orderStage';
import { orderContextText } from '../../utils/orderLabels';
import { timeAgo } from '../../utils/timeAgo';
import { OrderTypePill } from '../order/OrderTypePill';
import { OrderStageBadge } from '../order/OrderStageBadge';

interface ActiveOrdersDrawerProps {
  open: boolean;
  onClose: () => void;
  initialCategory?: ActiveCategory;
  orders: Order[];
  itemsByOrder: Record<string, OrderItem[]>;
  kitchenSendsByOrder: Record<string, OrderKitchenSend[]>;
  tableById: Record<string, DiningTable>;
  customerById: Record<string, Customer>;
  currency: string;
  onResume: (order: Order) => void;
  onPay: (order: Order) => void;
  onCancel: (order: Order) => void;
}

type ActiveCategory = 'all' | 'tables' | 'cars' | 'delivery' | 'quick' | 'kitchen' | 'held' | 'ready';
export type { ActiveCategory };

export function ActiveOrdersDrawer({
  open, onClose, initialCategory, orders, itemsByOrder, kitchenSendsByOrder, tableById, customerById, currency,
  onResume, onPay, onCancel,
}: ActiveOrdersDrawerProps) {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';
  const [category, setCategory] = useState<ActiveCategory>('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (open) { setCategory(initialCategory || 'all'); setQuery(''); }
  }, [open, initialCategory]);

  const stageMap = useMemo(() => {
    const map: Record<string, OrderStage> = {};
    for (const o of orders) map[o.id] = stageOfOrder(o, itemsByOrder, kitchenSendsByOrder);
    return map;
  }, [orders, itemsByOrder, kitchenSendsByOrder]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((o) => {
      const stage = stageMap[o.id] || 'open';
      switch (category) {
        case 'tables': if (o.order_type !== 'dine_in') return false; break;
        case 'cars': if (o.order_type !== 'drive_thru') return false; break;
        case 'delivery': if (o.order_type !== 'delivery') return false; break;
        case 'quick': if (o.order_type !== 'takeaway') return false; break;
        case 'kitchen': if (stage !== 'kitchen') return false; break;
        case 'held': if (o.status !== 'held') return false; break;
        case 'ready': if (stage !== 'ready') return false; break;
        default: break;
      }
      if (!q) return true;
      const ctx = orderContextText(o, tableById, customerById).toLowerCase();
      return o.order_number.toLowerCase().includes(q) || ctx.includes(q);
    });
  }, [orders, category, query, stageMap, tableById, customerById]);

  const filterChips: Array<{ id: ActiveCategory; label: string; icon?: React.ReactNode }> = [
    { id: 'all', label: isAr ? 'الكل' : 'All' },
    { id: 'tables', label: t('tables') },
    { id: 'cars', label: t('cars'), icon: <Car className="w-3 h-3" /> },
    { id: 'delivery', label: t('delivery'), icon: <Bike className="w-3 h-3" /> },
    { id: 'quick', label: t('quick') },
    { id: 'kitchen', label: t('kitchen') },
    { id: 'held', label: t('heldOrders') },
    { id: 'ready', label: t('ready') },
  ];

  const counts = useMemo(() => {
    const c: Record<ActiveCategory, number> = { all: orders.length, tables: 0, cars: 0, delivery: 0, quick: 0, kitchen: 0, held: 0, ready: 0 };
    for (const o of orders) {
      const stage = stageMap[o.id] || 'open';
      if (o.order_type === 'dine_in') c.tables += 1;
      else if (o.order_type === 'drive_thru') c.cars += 1;
      else if (o.order_type === 'delivery') c.delivery += 1;
      else c.quick += 1;
      if (stage === 'kitchen') c.kitchen += 1;
      if (o.status === 'held') c.held += 1;
      if (stage === 'ready') c.ready += 1;
    }
    return c;
  }, [orders, stageMap]);

  return (
    <>
      {open && <div className="fixed inset-0 top-16 z-40 bg-ui-text/40 backdrop-blur-[1px]" onClick={onClose} />}
      <aside
        className={`fixed top-16 bottom-0 z-50 w-[380px] max-w-[92vw] bg-ui-surface border-s border-ui-border shadow-ui-xl transition-transform duration-300 flex flex-col end-0 ${
          open ? 'translate-x-0' : isAr ? '-translate-x-full' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-ui-border flex-shrink-0">
          <h2 className="text-sm font-bold text-ui-text flex items-center gap-2">
            <ListOrdered className="w-4 h-4 text-ui-accent" />
            {t('activeOrders')}
            <span className="px-2 py-0.5 rounded-full bg-ui-primary-soft text-ui-accent text-[11px] font-bold">{orders.length}</span>
          </h2>
          <button onClick={onClose} className="p-2 rounded-lg text-ui-muted hover:bg-ui-page-alt transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-3 py-2.5 space-y-2 border-b border-ui-border flex-shrink-0">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {filterChips.map((c) => (
              <button
                key={c.id}
                onClick={() => setCategory(c.id)}
                className={`whitespace-nowrap flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${
                  category === c.id
                    ? 'bg-ui-primary text-ui-primary-fg shadow-ui-sm'
                    : 'bg-ui-page-alt text-ui-muted hover:bg-ui-page-alt'
                }`}
              >
                {c.icon}
                {c.label}
                {counts[c.id] > 0 && category !== c.id && (
                  <span className={`px-1 rounded-full text-[9px] ${category === c.id ? 'bg-ui-primary-fg/25' : 'bg-ui-border'}`}>{counts[c.id]}</span>
                )}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-ui-subtle" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={isAr ? 'بحث برقم الطلب أو السياق...' : 'Search order # or context...'}
              className="w-full ps-9 pe-3 py-2 rounded-xl border border-ui-border bg-ui-page-alt text-sm text-ui-text placeholder:text-ui-subtle focus:outline-none focus:ring-2 focus:ring-ui-ring"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
          {filtered.length === 0 ? (
            <div className="text-center py-14 text-ui-subtle">
              <UtensilsCrossed className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">{t('noOpenOrders')}</p>
            </div>
          ) : (
            filtered.map((order) => {
              const stage = stageMap[order.id] || 'open';
              const itemCount = (itemsByOrder[order.id] || []).reduce((s, i) => s + Number(i.quantity), 0);
              const ago = timeAgo(order.created_at);
              const ctx = orderContextText(order, tableById, customerById);
              const ready = stage === 'ready';
              return (
                <div key={order.id} className="p-3 rounded-xl border border-ui-border bg-ui-page-alt hover:border-ui-accent transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-black text-ui-text shrink-0">{order.order_number}</span>
                      <OrderTypePill type={order.order_type} />
                      {ctx && (
                        <span className="shrink-0 text-[11px] font-semibold text-ui-muted truncate max-w-[110px]">
                          {ctx}
                        </span>
                      )}
                    </div>
                    <span className="text-sm font-bold text-ui-accent shrink-0">
                      {formatCurrency(order.total, currency, lang)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 mt-1.5 text-[11px] text-ui-subtle">
                    <OrderStageBadge stage={stage} />
                    <span>
                      {isAr
                        ? `${itemCount} صنف · ${ago.n != null ? `${ago.n} ${t(ago.key)}` : t(ago.key)}`
                        : `${itemCount} items · ${ago.n != null ? `${ago.n} ${t(ago.key)}` : t(ago.key)}`}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 mt-2">
                    <button
                      onClick={() => (ready ? onPay(order) : onResume(order))}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all active:scale-95 ${
                        ready
                          ? 'bg-ui-success text-ui-primary-fg'
                          : 'bg-ui-primary text-ui-primary-fg'
                      }`}
                    >
                      {ready ? <Banknote className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      {ready ? t('payOrder') : t('resumeOrder')}
                    </button>
                    {!ready && (
                      <button
                        onClick={() => onPay(order)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-ui-success text-ui-primary-fg text-[11px] font-bold transition-all active:scale-95"
                      >
                        <Banknote className="w-3.5 h-3.5" />
                        {t('payOrder')}
                      </button>
                    )}
                    {order.status === 'held' && (
                      <button
                        onClick={() => onCancel(order)}
                        className="ms-auto p-1.5 rounded-lg text-ui-subtle hover:text-ui-danger hover:bg-ui-danger/10 transition-colors"
                        title={t('cancelOrder')}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </>
  );
}
