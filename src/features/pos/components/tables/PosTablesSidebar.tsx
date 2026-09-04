import { useState, useMemo, useEffect } from 'react';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Utensils,
  Bike,
  ShoppingBag,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { supabase } from '@/api';
import type { DiningArea, DiningTable, Order, OrderItem } from '@/lib/types';
import type { OrderKitchenSend } from '../../types';
import { TableCard } from './TableCard';

interface PosTablesSidebarProps {
  tables: DiningTable[];
  ordersByTable: Record<string, Order[]>;
  itemsByOrder: Record<string, OrderItem[]>;
  kitchenSendsByOrder: Record<string, OrderKitchenSend[]>;
  currency: string;
  activeTableId: string | null;
  activeOrderId: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSelectTable: (table: DiningTable) => void;
  onTransferOrder?: (order: Order, table: DiningTable) => void;
  onSelectTakeaway?: () => void;
  onSelectDelivery?: () => void;
  activeOrderType?: string;
}

type TabType = 'all' | 'indoor' | 'outdoor' | 'takeaway' | 'delivery';
type StatusFilter = 'all' | 'vacant' | 'open' | 'sent' | 'new_additions';

export function PosTablesSidebar({
  tables,
  ordersByTable,
  itemsByOrder,
  kitchenSendsByOrder,
  currency,
  activeTableId,
  collapsed,
  onToggleCollapse,
  onSelectTable,
  onTransferOrder,
  onSelectTakeaway,
  onSelectDelivery,
  activeOrderType,
}: PosTablesSidebarProps) {
  const { lang } = useLanguage();
  const isAr = lang === 'ar';

  const [areas, setAreas] = useState<DiningArea[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('dining_areas')
      .select('*')
      .order('sort_order')
      .then(({ data }) => {
        if (!cancelled && data) setAreas(data as DiningArea[]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Compute operational overview stats
  const stats = useMemo(() => {
    let vacant = 0;
    let open = 0;
    let sent = 0;
    let newAdditions = 0;

    for (const table of tables) {
      const orders = ordersByTable[table.id] || [];
      const ord = orders[0];
      if (!ord || table.status === 'vacant') {
        vacant++;
      } else {
        const sends = kitchenSendsByOrder[ord.id] || [];
        const items = itemsByOrder[ord.id] || [];
        const sentIds = new Set(sends.map((s) => s.order_item_id));
        const sentCount = items.filter((it) => sentIds.has(it.id)).length;
        const unsentCount = items.length - sentCount;

        if (sentCount > 0 && unsentCount > 0) {
          newAdditions++;
        } else if (sentCount > 0 && unsentCount === 0) {
          sent++;
        } else {
          open++;
        }
      }
    }

    return { vacant, open, sent, newAdditions, total: tables.length };
  }, [tables, ordersByTable, kitchenSendsByOrder, itemsByOrder]);

  // Filter tables by tab (Indoor vs Outdoor), search query, and operational status
  const filteredTables = useMemo(() => {
    return tables.filter((tb) => {
      // 1. Tab filtering
      if (activeTab === 'indoor' || activeTab === 'outdoor') {
        const areaName = areas.find((a) => a.id === tb.area_id)?.name?.toLowerCase() || '';
        const tableName = tb.name.toLowerCase();
        const isOutdoor =
          areaName.includes('outdoor') ||
          areaName.includes('خارج') ||
          areaName.includes('تراس') ||
          areaName.includes('terrace') ||
          areaName.includes('patio') ||
          tableName.includes('outdoor') ||
          tableName.includes('خارج');

        if (activeTab === 'outdoor' && !isOutdoor) return false;
        if (activeTab === 'indoor' && isOutdoor) return false;
      }

      // 2. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchesName = tb.name.toLowerCase().includes(q);
        const ord = (ordersByTable[tb.id] || [])[0];
        const matchesOrder = ord?.order_number?.toLowerCase().includes(q);
        if (!matchesName && !matchesOrder) return false;
      }

      // 3. Status filter
      if (statusFilter !== 'all') {
        const ord = (ordersByTable[tb.id] || [])[0];
        const isVacant = !ord || tb.status === 'vacant';
        if (statusFilter === 'vacant') return isVacant;

        if (isVacant) return false;

        const sends = kitchenSendsByOrder[ord.id] || [];
        const items = itemsByOrder[ord.id] || [];
        const sentIds = new Set(sends.map((s) => s.order_item_id));
        const sentCount = items.filter((it) => sentIds.has(it.id)).length;
        const unsentCount = items.length - sentCount;

        if (statusFilter === 'new_additions') return sentCount > 0 && unsentCount > 0;
        if (statusFilter === 'sent') return sentCount > 0 && unsentCount === 0;
        if (statusFilter === 'open') return sentCount === 0;
      }

      return true;
    });
  }, [tables, areas, activeTab, searchQuery, statusFilter, ordersByTable, kitchenSendsByOrder, itemsByOrder]);

  if (collapsed) {
    return (
      <aside className="w-14 shrink-0 border-e border-ui-border bg-ui-surface flex flex-col items-center py-3 select-none transition-all">
        <button
          type="button"
          onClick={onToggleCollapse}
          title={isAr ? 'توسيع شريط الطاولات' : 'Expand tables sidebar'}
          className="h-10 w-10 rounded-xl bg-ui-page hover:bg-ui-page-alt border border-ui-border flex items-center justify-center text-ui-text transition shadow-ui-xs"
        >
          {isAr ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
        </button>

        {/* Quick status dots in mini strip */}
        <div className="mt-4 flex flex-col items-center gap-3">
          <div
            title={isAr ? `${stats.vacant} طاولة متاحة` : `${stats.vacant} vacant`}
            className="flex flex-col items-center"
          >
            <span className="h-3 w-3 rounded-full bg-emerald-500 shadow-sm" />
            <span className="text-[10px] font-black text-ui-text mt-0.5">{stats.vacant}</span>
          </div>

          <div
            title={isAr ? `${stats.open} طلب مفتوح` : `${stats.open} open`}
            className="flex flex-col items-center"
          >
            <span className="h-3 w-3 rounded-full bg-amber-500 shadow-sm" />
            <span className="text-[10px] font-black text-ui-text mt-0.5">{stats.open}</span>
          </div>

          <div
            title={isAr ? `${stats.sent} مرسلة للمطبخ` : `${stats.sent} in kitchen`}
            className="flex flex-col items-center"
          >
            <span className="h-3 w-3 rounded-full bg-sky-500 shadow-sm" />
            <span className="text-[10px] font-black text-ui-text mt-0.5">{stats.sent}</span>
          </div>

          {stats.newAdditions > 0 && (
            <div
              title={isAr ? `${stats.newAdditions} طلبات بها تعديلات جديدة` : `${stats.newAdditions} new additions`}
              className="flex flex-col items-center animate-bounce"
            >
              <span className="h-3 w-3 rounded-full bg-amber-500 shadow-sm" />
              <span className="text-[10px] font-black text-amber-600 mt-0.5">{stats.newAdditions}</span>
            </div>
          )}
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-[320px] md:w-[350px] lg:w-[380px] shrink-0 border-e border-ui-border bg-ui-surface flex flex-col select-none transition-all h-full min-h-0">
      {/* Top Header: Title, Stats summary, and Collapse Button */}
      <div className="p-3 border-b border-ui-border flex-shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-xl bg-ui-primary-soft text-ui-accent flex items-center justify-center">
              <Utensils className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-xs font-black text-ui-text">
                {isAr ? 'الطاولات والطلبات المفتوحة' : 'Tables & Open Orders'}
              </h2>
              <p className="text-[10px] text-ui-subtle">
                {stats.total} {isAr ? 'طاولة بالصالة' : 'Total tables'} · {stats.vacant} {isAr ? 'متاحة' : 'vacant'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onToggleCollapse}
            title={isAr ? 'تصغير الشريط لتوسيع شاشة المنتجات' : 'Collapse tables'}
            className="h-8 w-8 rounded-xl bg-ui-page hover:bg-ui-page-alt border border-ui-border flex items-center justify-center text-ui-muted hover:text-ui-text transition"
          >
            {isAr ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        {/* Quick status summary pills */}
        <div className="flex items-center gap-1.5 flex-wrap text-[10px] font-bold">
          <button
            type="button"
            onClick={() => setStatusFilter(statusFilter === 'vacant' ? 'all' : 'vacant')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-lg border transition ${
              statusFilter === 'vacant'
                ? 'bg-emerald-500/20 text-emerald-700 border-emerald-500/40 ring-1 ring-emerald-500'
                : 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 hover:bg-emerald-500/15'
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span>{stats.vacant} {isAr ? 'متاحة' : 'vacant'}</span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter(statusFilter === 'open' ? 'all' : 'open')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-lg border transition ${
              statusFilter === 'open'
                ? 'bg-amber-500/20 text-amber-700 border-amber-500/40 ring-1 ring-amber-500'
                : 'bg-amber-500/10 text-amber-600 border-amber-500/20 hover:bg-amber-500/15'
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            <span>{stats.open} {isAr ? 'مفتوحة' : 'open'}</span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter(statusFilter === 'sent' ? 'all' : 'sent')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-lg border transition ${
              statusFilter === 'sent'
                ? 'bg-sky-500/20 text-sky-700 border-sky-500/40 ring-1 ring-sky-500'
                : 'bg-sky-500/10 text-sky-600 border-sky-500/20 hover:bg-sky-500/15'
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
            <span>{stats.sent} {isAr ? 'بالمطبخ' : 'sent'}</span>
          </button>

          {stats.newAdditions > 0 && (
            <button
              type="button"
              onClick={() => setStatusFilter(statusFilter === 'new_additions' ? 'all' : 'new_additions')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-lg border animate-pulse transition ${
                statusFilter === 'new_additions'
                  ? 'bg-amber-500/25 text-amber-700 border-amber-500/50 ring-1 ring-amber-500'
                  : 'bg-amber-500/15 text-amber-700 border-amber-500/30'
              }`}
            >
              <Sparkles className="h-2.5 w-2.5 text-amber-600" />
              <span>{stats.newAdditions} {isAr ? 'تعديل جديد' : 'modified'}</span>
            </button>
          )}
        </div>

        {/* Tabs: Indoor / Outdoor / Takeaway / Delivery */}
        <div className="flex items-center gap-1 rounded-xl bg-ui-page-alt p-1">
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`flex-1 rounded-lg py-1 text-[11px] font-black transition ${
              activeTab === 'all'
                ? 'bg-ui-surface text-ui-text shadow-ui-xs'
                : 'text-ui-muted hover:text-ui-text'
            }`}
          >
            {isAr ? 'الكل' : 'All'}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('indoor')}
            className={`flex-1 rounded-lg py-1 text-[11px] font-black transition ${
              activeTab === 'indoor'
                ? 'bg-ui-surface text-ui-text shadow-ui-xs'
                : 'text-ui-muted hover:text-ui-text'
            }`}
          >
            {isAr ? 'داخلية' : 'Indoor'}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('outdoor')}
            className={`flex-1 rounded-lg py-1 text-[11px] font-black transition ${
              activeTab === 'outdoor'
                ? 'bg-ui-surface text-ui-text shadow-ui-xs'
                : 'text-ui-muted hover:text-ui-text'
            }`}
          >
            {isAr ? 'خارجية' : 'Outdoor'}
          </button>

          {onSelectTakeaway && (
            <button
              type="button"
              onClick={onSelectTakeaway}
              className={`flex-1 flex items-center justify-center gap-0.5 rounded-lg py-1 text-[11px] font-black transition ${
                activeOrderType === 'takeaway'
                  ? 'bg-ui-primary text-ui-primary-fg shadow-ui-xs'
                  : 'text-ui-muted hover:text-ui-text'
              }`}
            >
              <ShoppingBag className="h-3 w-3" />
              <span className="hidden xl:inline">{isAr ? 'سفري' : 'Takeaway'}</span>
            </button>
          )}

          {onSelectDelivery && (
            <button
              type="button"
              onClick={onSelectDelivery}
              className={`flex-1 flex items-center justify-center gap-0.5 rounded-lg py-1 text-[11px] font-black transition ${
                activeOrderType === 'delivery'
                  ? 'bg-ui-primary text-ui-primary-fg shadow-ui-xs'
                  : 'text-ui-muted hover:text-ui-text'
              }`}
            >
              <Bike className="h-3 w-3" />
              <span className="hidden xl:inline">{isAr ? 'توصيل' : 'Delivery'}</span>
            </button>
          )}
        </div>

        {/* Search input */}
        <div className="relative">
          <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ui-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={isAr ? 'بحث برقم الطاولة أو الطلب...' : 'Search table or order #...'}
            className="w-full rounded-xl border border-ui-border bg-ui-page ps-8 pe-3 py-1.5 text-xs text-ui-text placeholder:text-ui-muted focus:border-ui-primary focus:outline-none"
          />
        </div>
      </div>

      {/* Tables Grid List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5 min-h-0">
        {filteredTables.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {filteredTables.map((table) => {
              const orders = ordersByTable[table.id] || [];
              const isSelected = activeTableId === table.id;
              return (
                <TableCard
                  key={table.id}
                  table={table}
                  orders={orders}
                  itemsByOrder={itemsByOrder}
                  kitchenSendsByOrder={kitchenSendsByOrder}
                  currency={currency}
                  isSelected={isSelected}
                  onSelect={onSelectTable}
                  onTransfer={onTransferOrder}
                />
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center text-xs text-ui-muted">
            <Utensils className="h-8 w-8 text-ui-border mb-2" />
            <p className="font-bold">{isAr ? 'لا توجد طاولات مطابقة' : 'No tables match criteria'}</p>
            {(searchQuery || statusFilter !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setStatusFilter('all');
                }}
                className="mt-2 text-[11px] font-bold text-ui-primary hover:underline"
              >
                {isAr ? 'إعادة ضبط التصفية' : 'Reset filters'}
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
