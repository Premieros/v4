import { useEffect, useState } from 'react';
import { Users, UtensilsCrossed, Banknote, Play } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { useLanguage } from '@/context/LanguageContext';
import { formatCurrency } from '@/lib/format';
import type { DiningTable, Order, OrderItem } from '@/lib/types';
import type { OrderKitchenSend } from '../../types';
import { STATUS_STYLES } from '../../utils/orderTypes';
import { stageOfOrder } from '../../utils/orderStage';
import { OrderStageBadge } from '../order/OrderStageBadge';
import { OrderTypePill } from '../order/OrderTypePill';

interface TableActionModalProps { table: DiningTable | null; onClose: () => void; orders: Order[]; itemsByOrder: Record<string, OrderItem[]>; kitchenSendsByOrder: Record<string, OrderKitchenSend[]>; currency: string; onStart: (guests: number) => void; onResume: (order: Order) => void; onPay: (order: Order) => void; }

export function TableActionModal({ table, onClose, orders, itemsByOrder, kitchenSendsByOrder, currency, onStart, onResume, onPay }: TableActionModalProps) {
  const { t, lang } = useLanguage(); const isAr = lang === 'ar'; const [guests, setGuests] = useState(2);
  useEffect(() => { if (table) setGuests(table.capacity || 2); }, [table]);
  if (!table) return null;
  const st = STATUS_STYLES[table.status] || STATUS_STYLES.vacant; const tableOrders = orders.filter((o) => o.table_id === table.id); const canStart = table.status === 'vacant' || table.status === 'reserved';
  return (<Modal open={!!table} onClose={onClose} title={table.name} size="md"><div className="space-y-4">
    <div className="flex items-center gap-2"><span className={`w-2.5 h-2.5 rounded-full ${st.dot}`} /><span className={`px-2.5 py-1 rounded-full text-xs font-bold ${st.badge}`}>{t(st.label)}</span><span className="text-xs text-ui-subtle flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {table.capacity}</span></div>
    {tableOrders.length > 0 ? <div className="space-y-2"><p className="text-xs font-bold text-ui-subtle">{isAr ? 'طلب موجود على الطاولة' : 'Existing order on this table'}</p>{tableOrders.map((order) => { const stage = stageOfOrder(order, itemsByOrder, kitchenSendsByOrder); const itemCount = (itemsByOrder[order.id] || []).reduce((s, i) => s + Number(i.quantity), 0); return <div key={order.id} className="rounded-xl border border-ui-border bg-ui-page-alt p-3 space-y-2"><div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 min-w-0"><span className="text-sm font-bold text-ui-text">{order.order_number}</span><OrderTypePill type={order.order_type as Order['order_type']} /><OrderStageBadge stage={stage} /></span><span className="text-sm font-bold text-ui-accent shrink-0">{formatCurrency(order.total, currency, lang)}</span></div><div className="text-[11px] text-ui-subtle">{isAr ? `${itemCount} صنف` : `${itemCount} items`}</div><div className="flex flex-wrap gap-2 pt-1"><Button size="sm" variant="outline" data-testid={`pos-table-${table.id}-resume-${order.id}`} onClick={() => { onClose(); onResume(order); }}><Play className="w-3.5 h-3.5" /> {t('resumeOrder')}</Button><Button size="sm" variant={stage === 'ready' ? 'success' : 'outline'} data-testid={`pos-table-${table.id}-pay-${order.id}`} onClick={() => { onClose(); onPay(order); }}><Banknote className="w-3.5 h-3.5" /> {t('payOrder')}</Button></div></div>; })}</div>
    : canStart ? <div className="space-y-3"><div className="flex items-center gap-3"><label className="text-sm font-medium text-ui-muted">{t('guestCount')}:</label><input data-testid={`pos-table-${table.id}-guest-count`} type="number" min={1} value={guests || ''} onChange={(e) => setGuests(parseInt(e.target.value) || 1)} className="w-24 px-3 py-2 rounded-xl border border-ui-border bg-ui-surface-raised text-sm font-bold text-ui-text focus:ring-2 focus:ring-ui-ring" /></div><Button size="lg" className="w-full" data-testid={`pos-table-${table.id}-start`} onClick={() => { onClose(); onStart(Math.max(1, guests)); }}><UtensilsCrossed className="w-5 h-5" /> {t('startOrder')}</Button></div>
    : <p className="text-sm text-ui-muted">{isAr ? 'هذه الطاولة غير متاحة حالياً.' : 'This table is not available right now.'}</p>}
  </div></Modal>);
}
