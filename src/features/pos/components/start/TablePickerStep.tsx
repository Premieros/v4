import { useEffect, useMemo, useState } from 'react';
import { Search, Users } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { formatCurrency } from '@/lib/format';
import type { DiningTable, Order, OrderItem } from '@/lib/types';
import type { OrderKitchenSend } from '../../types';
import { STATUS_STYLES } from '../../utils/orderTypes';
import { stageOfOrder } from '../../utils/orderStage';
import { OrderStageBadge } from '../order/OrderStageBadge';
import { TableActionModal } from './TableActionModal';

interface TablePickerStepProps { tables: DiningTable[]; ordersByTable: Record<string, Order[]>; itemsByOrder: Record<string, OrderItem[]>; kitchenSendsByOrder: Record<string, OrderKitchenSend[]>; currency: string; preselectedTableId: string | null; onStart: (table: DiningTable, guests: number) => void; onResume: (order: Order) => void; onPay: (order: Order) => void; }
type StatusFilter = 'all' | 'vacant' | 'occupied' | 'reserved';

export function TablePickerStep({ tables, ordersByTable, itemsByOrder, kitchenSendsByOrder, currency, preselectedTableId, onStart, onResume, onPay }: TablePickerStepProps) {
  const { t, lang } = useLanguage(); const isAr = lang === 'ar';
  const [query, setQuery] = useState(''); const [statusFilter, setStatusFilter] = useState<StatusFilter>('all'); const [selected, setSelected] = useState<DiningTable | null>(null);
  useEffect(() => { if (!preselectedTableId) return; const tb = tables.find((x) => x.id === preselectedTableId); if (tb) setSelected(tb); }, [preselectedTableId, tables]);
  const filtered = useMemo(() => { const q = query.trim().toLowerCase(); return tables.filter((tb) => { if (statusFilter !== 'all' && tb.status !== statusFilter) return false; if (!q) return true; return tb.name.toLowerCase().includes(q); }); }, [tables, statusFilter, query]);
  const chips: Array<{ id: StatusFilter; label: string }> = [{ id: 'all', label: isAr ? 'الكل' : 'All' }, { id: 'vacant', label: t('vacant') }, { id: 'occupied', label: t('occupied') }, { id: 'reserved', label: t('reserved') }];
  return (<>
    <div className="flex-1 overflow-y-auto p-4 sm:p-6"><div className="max-w-3xl mx-auto space-y-4">
      <div className="relative"><Search className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-ui-subtle" /><input data-testid="pos-table-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('searchTable')} className="w-full ps-9 pe-3 py-2.5 rounded-xl border border-ui-border bg-ui-surface-raised text-sm text-ui-text placeholder:text-ui-subtle focus:outline-none focus:ring-2 focus:ring-ui-ring" /></div>
      <div className="flex items-center gap-1.5 overflow-x-auto">{chips.map((c) => <button key={c.id} data-testid={`pos-table-filter-${c.id}`} onClick={() => setStatusFilter(c.id)} className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-bold transition-all ${statusFilter === c.id ? 'bg-ui-primary text-ui-primary-fg shadow-ui-sm' : 'bg-ui-page-alt text-ui-muted hover:bg-ui-page-alt'}`}>{c.label}</button>)}</div>
      {filtered.length === 0 ? <div className="text-center py-16 text-ui-subtle"><Search className="w-10 h-10 mx-auto mb-2 opacity-30" /><p className="text-sm">{isAr ? 'لا توجد طاولات مطابقة' : 'No matching tables'}</p></div> : <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{filtered.map((tb) => { const st = STATUS_STYLES[tb.status] || STATUS_STYLES.vacant; const tableOrders = ordersByTable[tb.id] || []; const order = tableOrders[0]; const stage = order ? stageOfOrder(order, itemsByOrder, kitchenSendsByOrder) : null; return <button key={tb.id} data-testid={`pos-table-${tb.id}`} onClick={() => setSelected(tb)} className={`relative rounded-2xl border-2 p-3.5 text-start transition-all active:scale-[0.98] ${st.card} ${tb.status === 'closed' ? 'opacity-60 cursor-not-allowed' : 'hover:shadow-ui-lg hover:-translate-y-0.5'}`}><div className="flex items-center justify-between gap-1"><span className="text-sm font-bold text-ui-text truncate">{tb.name}</span><span className={`shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${st.badge}`}>{t(st.label)}</span></div><div className="flex items-center gap-1 text-[11px] text-ui-muted mt-1"><Users className="w-3 h-3" /> {tb.capacity}</div>{order && <div className="mt-2 space-y-1 border-t border-ui-border/50 pt-2"><div className="flex items-center justify-between gap-1"><span className="text-[11px] font-black text-ui-text">{order.order_number}</span><span className="text-[11px] font-bold text-ui-accent">{formatCurrency(order.total, currency, lang)}</span></div>{stage && <OrderStageBadge stage={stage} className="scale-90 origin-start" />}</div>}</button>; })}</div>}
    </div></div>
    <TableActionModal table={selected} onClose={() => setSelected(null)} orders={selected ? ordersByTable[selected.id] || [] : []} itemsByOrder={itemsByOrder} kitchenSendsByOrder={kitchenSendsByOrder} currency={currency} onStart={(guests) => selected && onStart(selected, guests)} onResume={onResume} onPay={onPay} />
  </>);
}
