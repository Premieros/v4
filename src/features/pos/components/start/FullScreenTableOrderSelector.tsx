import { useMemo, useState } from 'react';
import {
  Zap,
  Bike,
  Utensils,
  Search,
  Users,
  ArrowRight,
  Building2,
} from 'lucide-react';
import type { DiningTable, Order } from '@/lib/types';
import { formatCurrency } from '@/lib/format';
import { useLanguage } from '@/context/LanguageContext';

interface Props {
  tables: DiningTable[];
  ordersByTable: Record<string, Order[]>;
  currency: string;
  branchName: string;
  onSelectTakeaway: () => void;
  onSelectDelivery: () => void;
  onSelectTable: (table: DiningTable) => void;
  onResumeOrder: (orderId: string) => void;
  onBackToProducts?: () => void;
}

export function FullScreenTableOrderSelector({
  tables,
  ordersByTable,
  currency,
  branchName,
  onSelectTakeaway,
  onSelectDelivery,
  onSelectTable,
  onResumeOrder,
  onBackToProducts,
}: Props) {
  const { lang } = useLanguage();
  const isAr = lang === 'ar';

  const [filter, setFilter] = useState<'all' | 'vacant' | 'occupied'>('all');
  const [search, setSearch] = useState('');

  const stats = useMemo(() => {
    let vacant = 0;
    let occupied = 0;
    for (const t of tables) {
      const ords = ordersByTable[t.id] || [];
      if (t.status === 'occupied' || ords.length > 0) occupied++;
      else vacant++;
    }
    return { total: tables.length, vacant, occupied };
  }, [tables, ordersByTable]);

  const filteredTables = useMemo(() => {
    return tables.filter((t) => {
      const ords = ordersByTable[t.id] || [];
      const isOccupied = t.status === 'occupied' || ords.length > 0;

      if (filter === 'vacant' && isOccupied) return false;
      if (filter === 'occupied' && !isOccupied) return false;

      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const matchesName = t.name.toLowerCase().includes(q);
        const matchesNumber = t.name.replace(/\D/g, '').includes(q);
        return matchesName || matchesNumber;
      }
      return true;
    });
  }, [tables, ordersByTable, filter, search]);

  return (
    <div
      dir={isAr ? 'rtl' : 'ltr'}
      className="flex-1 flex flex-col h-full bg-ui-page text-ui-text overflow-hidden"
    >
      {/* Top Banner: Quick Actions (Takeaway / Delivery / Tables) */}
      <div className="flex-shrink-0 p-4 sm:p-6 bg-ui-surface border-b border-ui-border shadow-sm">
        <div className="max-w-7xl mx-auto flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-xl bg-ui-primary/10 text-ui-primary">
                  <Utensils className="w-5 h-5" />
                </span>
                <h1 className="text-xl sm:text-2xl font-black text-ui-text tracking-tight">
                  {isAr ? 'بدء طلب جديد' : 'Start New Order'}
                </h1>
              </div>
              <p className="text-xs sm:text-sm text-ui-subtle mt-0.5 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5" />
                <span>{branchName || (isAr ? 'الفرع الرئيسي' : 'Main Branch')}</span>
                <span>•</span>
                <span>{isAr ? 'اختر طاولة للطلب المحلي أو حدد طلب سريع/ديلفري' : 'Select a table or choose quick order / delivery'}</span>
              </p>
            </div>

            {/* Quick Order Buttons */}
            <div className="flex items-center gap-3">
              {onBackToProducts && (
                <button
                  type="button"
                  onClick={onBackToProducts}
                  className="flex items-center gap-2 px-4 py-3 rounded-2xl border border-ui-border bg-ui-surface hover:bg-ui-page-alt text-ui-text font-bold text-xs shadow-sm transition-all"
                >
                  <ArrowRight className={`w-4 h-4 ${isAr ? '' : 'rotate-180'}`} />
                  <span>{isAr ? 'العودة للمنتجات والسلة' : 'Back to Products'}</span>
                </button>
              )}

              <button
                data-testid="pos-quick-takeaway-btn"
                type="button"
                onClick={onSelectTakeaway}
                className="group relative flex items-center gap-3 px-5 py-3 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-black shadow-lg shadow-orange-500/20 active:scale-95 transition-all"
              >
                <div className="p-1.5 rounded-xl bg-white/20">
                  <Zap className="w-5 h-5" />
                </div>
                <div className="text-start">
                  <span className="text-sm block leading-tight">{isAr ? 'طلب سريع (تيك أواي)' : 'Quick Takeaway'}</span>
                  <span className="text-[10px] font-normal opacity-90">{isAr ? 'استلام فوري' : 'Instant pickup'}</span>
                </div>
              </button>

              <button
                data-testid="pos-quick-delivery-btn"
                type="button"
                onClick={onSelectDelivery}
                className="group relative flex items-center gap-3 px-5 py-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-black shadow-lg shadow-emerald-600/20 active:scale-95 transition-all"
              >
                <div className="p-1.5 rounded-xl bg-white/20">
                  <Bike className="w-5 h-5" />
                </div>
                <div className="text-start">
                  <span className="text-sm block leading-tight">{isAr ? 'طلب توصيل (ديلفري)' : 'Delivery Order'}</span>
                  <span className="text-[10px] font-normal opacity-90">{isAr ? 'توصيل للمنازل' : 'Doorstep dispatch'}</span>
                </div>
              </button>
            </div>
          </div>

          {/* Table Filters & Live Stats Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-ui-border/60">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setFilter('all')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  filter === 'all'
                    ? 'bg-ui-primary text-ui-primary-fg shadow-sm'
                    : 'bg-ui-page-alt text-ui-muted hover:text-ui-text'
                }`}
              >
                {isAr ? `كل الطاولات (${stats.total})` : `All Tables (${stats.total})`}
              </button>
              <button
                onClick={() => setFilter('vacant')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                  filter === 'vacant'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-ui-page-alt text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                {isAr ? `طاولات فارغة (${stats.vacant})` : `Vacant (${stats.vacant})`}
              </button>
              <button
                onClick={() => setFilter('occupied')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                  filter === 'occupied'
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'bg-ui-page-alt text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-rose-400" />
                {isAr ? `طاولات مشغولة (${stats.occupied})` : `Occupied (${stats.occupied})`}
              </button>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ui-muted" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={isAr ? 'ابحث عن طاولة...' : 'Search table number...'}
                className="w-full ps-9 pe-4 py-1.5 text-xs rounded-xl border border-ui-border bg-ui-page text-ui-text placeholder:text-ui-subtle focus:outline-none focus:border-ui-primary"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main 50 Tables Grid */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3 sm:gap-4">
            {filteredTables.map((table) => {
              const activeOrders = ordersByTable[table.id] || [];
              const isOccupied = table.status === 'occupied' || activeOrders.length > 0;
              const primaryOrder = activeOrders[0];

              return (
                <div
                  key={table.id}
                  onClick={() => {
                    if (isOccupied && primaryOrder) {
                      onResumeOrder(primaryOrder.id);
                    } else {
                      onSelectTable(table);
                    }
                  }}
                  className={`group relative flex flex-col justify-between p-4 rounded-2xl border transition-all cursor-pointer select-none text-start shadow-sm hover:shadow-md active:scale-95 ${
                    isOccupied
                      ? 'border-rose-300 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/20 hover:border-rose-500'
                      : 'border-ui-border bg-ui-surface hover:border-ui-primary hover:bg-ui-primary-soft/30'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-base font-black text-ui-text group-hover:text-ui-primary transition-colors block">
                        {table.name}
                      </span>
                      <span className="text-[11px] text-ui-subtle flex items-center gap-1 mt-0.5">
                        <Users className="w-3 h-3" />
                        <span>{table.capacity || 4} {isAr ? 'أفراد' : 'seats'}</span>
                      </span>
                    </div>

                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black border ${
                        isOccupied
                          ? 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 border-rose-200'
                          : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-200'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${isOccupied ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                      {isOccupied ? (isAr ? 'مشغولة' : 'Occupied') : (isAr ? 'فارغة' : 'Vacant')}
                    </span>
                  </div>

                  {/* Occupied info or Vacant CTA */}
                  <div className="mt-4 pt-3 border-t border-ui-border/60">
                    {isOccupied && primaryOrder ? (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs font-bold text-rose-600 dark:text-rose-400">
                          <span>{isAr ? 'الحساب الحالي:' : 'Current bill:'}</span>
                          <span>{formatCurrency(primaryOrder.total || 0, currency, lang)}</span>
                        </div>
                        <span className="text-[10px] text-ui-subtle block truncate">
                          {isAr ? `طلب #${primaryOrder.order_number}` : `Order #${primaryOrder.order_number}`}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between text-xs font-bold text-ui-muted group-hover:text-ui-primary transition-colors">
                        <span>{isAr ? 'فتح طلب' : 'Open Order'}</span>
                        <ArrowRight className={`w-3.5 h-3.5 transition-transform ${isAr ? 'rotate-180 group-hover:-translate-x-1' : 'group-hover:translate-x-1'}`} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
