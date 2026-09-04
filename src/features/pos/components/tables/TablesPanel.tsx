import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Grid3x3, MapPin, X, Users, Banknote, UtensilsCrossed, Plus, Settings2 } from 'lucide-react';
import { supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { formatCurrency } from '@/lib/format';
import type { DiningArea, DiningTable, Order } from '@/lib/types';
import { STATUS_STYLES } from '../../utils/orderTypes';
import { useCan } from '@/lib/permissions';

interface TablePos { table: DiningTable; left: number; top: number; width: number; height: number; }

function resolvePositions(tablesInArea: DiningTable[]): TablePos[] {
  const used = new Set<string>();
  return tablesInArea.map((tb) => {
    const l = tb.layout || { x: 0, y: 0, w: 120, h: 80 };
    let left = l.x || 0;
    const top = l.y || 0;
    let guard = 0;
    while (used.has(`${left},${top}`) && guard < 200) { left += 160; guard += 1; }
    used.add(`${left},${top}`);
    return {
      table: tb,
      left,
      top,
      width: Math.max(70, l.w || 120),
      height: Math.max(46, l.h || 80),
    };
  });
}

interface TablesPanelProps {
  open: boolean;
  onClose: () => void;
  tables: DiningTable[];
  ordersByTable: Record<string, Order[]>;
  currency: string;
  onResume: (order: Order) => void;
  onPay: (order: Order) => void;
  onStart: (table: DiningTable, guests: number) => void;
}

export function TablesPanel({ open, onClose, tables, ordersByTable, currency, onResume, onPay, onStart }: TablesPanelProps) {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';
  const navigate = useNavigate();
  const can = useCan();
  const canManage = can('floor_plan.manage');

  const [areas, setAreas] = useState<DiningArea[]>([]);
  const [selected, setSelected] = useState<DiningTable | null>(null);
  const [guests, setGuests] = useState(2);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    supabase.from('dining_areas').select('*').order('sort_order').then(({ data }) => {
      if (!cancelled) setAreas((data as DiningArea[]) || []);
    });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!selected) return;
    setGuests(selected.capacity || 2);
  }, [selected]);

  const occupiedCount = useMemo(() => tables.filter((tb) => tb.status === 'occupied').length, [tables]);

  const renderCanvas = (tablesInArea: DiningTable[]) => {
    const positions = resolvePositions(tablesInArea);
    const maxW = positions.reduce((m, p) => Math.max(m, p.left + p.width), 0) + 20;
    const maxH = positions.reduce((m, p) => Math.max(m, p.top + p.height), 0) + 20;
    return (
      <div className="overflow-auto rounded-xl bg-ui-page border border-ui-border">
        <div className="relative" style={{ width: Math.max(maxW, 900), height: Math.max(maxH, 300) }}>
          {positions.map(({ table, left, top, width, height }) => {
            const st = STATUS_STYLES[table.status] || STATUS_STYLES.vacant;
            const order = (ordersByTable[table.id] || [])[0];
            return (
              <button
                key={table.id}
                onClick={() => setSelected(table)}
                className={`absolute rounded-xl border-2 shadow-sm p-2 flex flex-col items-center justify-center transition-all hover:shadow-card-hover hover:-translate-y-0.5 active:scale-[0.98] ${st.card}`}
                style={{ left, top, width, height }}
              >
                <span className="text-sm font-bold text-ui-text truncate max-w-full">{table.name}</span>
                <span className="flex items-center gap-1 text-[10px] text-ui-muted">
                  <Users className="w-3 h-3" /> {table.capacity}
                </span>
                {order && (
                  <span className={`mt-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold truncate max-w-full ${st.badge}`}>
                    {order.order_number} · {formatCurrency(order.total, currency, lang)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const areaGroups = areas.map((a) => ({ area: a, tables: tables.filter((tb) => tb.area_id === a.id) }));
  const loose = tables.filter((tb) => !tb.area_id);

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
            <Grid3x3 className="w-4 h-4 text-ui-success" />
            {t('tables')}
            <span className="px-2 py-0.5 rounded-full bg-ui-success/10 text-ui-success text-[11px] font-bold">
              {occupiedCount} / {tables.length}
            </span>
          </h2>
          <div className="flex items-center gap-2">
            {canManage && (
              <button
                onClick={() => navigate('/floor-plan')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-ui-page-alt text-ui-muted text-xs font-bold hover:bg-ui-page-alt transition-all active:scale-95"
              >
                <Settings2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{t('manageTables')}</span>
              </button>
            )}
            <button onClick={onClose} className="p-2 rounded-lg text-ui-muted hover:bg-ui-page-alt transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {areaGroups.length === 0 && loose.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-ui-subtle">
              <Grid3x3 className="w-16 h-16 mb-4 opacity-30" />
              <p className="text-lg font-medium">{isAr ? 'لا توجد طاولات بعد' : 'No tables yet'}</p>
              {canManage && (
                <Button className="mt-4" onClick={() => navigate('/floor-plan')}>
                  <Plus className="w-4 h-4" /> {t('manageTables')}
                </Button>
              )}
            </div>
          ) : (
            <>
              {areaGroups.map(({ area, tables: areaTables }) =>
                areaTables.length === 0 ? null : (
                  <div key={area.id} className="space-y-2">
                    <h3 className="text-xs font-black text-ui-muted flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-ui-accent" />
                      {area.name}
                      <span className="text-[10px] font-normal text-ui-subtle">({areaTables.length})</span>
                    </h3>
                    {renderCanvas(areaTables)}
                  </div>
                )
              )}
              {loose.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-black text-ui-muted flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-ui-subtle" />
                    {isAr ? 'طاولات بدون منطقة' : 'Tables without area'}
                  </h3>
                  {renderCanvas(loose)}
                </div>
              )}
            </>
          )}
        </div>
      </aside>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.name || ''} size="md">
        {selected && (() => {
          const st = STATUS_STYLES[selected.status] || STATUS_STYLES.vacant;
          const tableOrders = ordersByTable[selected.id] || [];
          const area = areas.find((a) => a.id === selected.area_id);
          return (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${st.dot}`} />
                <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${st.badge}`}>{t(st.label)}</span>
                {area && <span className="text-xs text-ui-subtle">{area.name}</span>}
                <span className="text-xs text-ui-subtle flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {selected.capacity}</span>
              </div>

              {tableOrders.length > 0 ? (
                <div className="space-y-2">
                  {tableOrders.map((order) => (
                    <div key={order.id} className="rounded-xl border border-ui-border bg-ui-page-alt p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-ui-text">{order.order_number}</span>
                        <span className="text-sm font-bold text-ui-accent">{formatCurrency(order.total, currency, lang)}</span>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => { setSelected(null); onResume(order); }}>
                          <UtensilsCrossed className="w-3.5 h-3.5" /> {t('resumeOrder')}
                        </Button>
                        <Button size="sm" variant="success" onClick={() => { setSelected(null); onPay(order); }}>
                          <Banknote className="w-3.5 h-3.5" /> {t('payOrder')}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : selected.status === 'vacant' || selected.status === 'reserved' ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <label className="text-sm font-medium text-ui-muted">{t('guestCount')}:</label>
                    <input
                      type="number"
                      min={1}
                      value={guests || ''}
                      onChange={(e) => setGuests(parseInt(e.target.value) || 1)}
                      className="w-24 px-3 py-2 rounded-xl border border-ui-border bg-ui-surface-raised text-sm font-bold text-ui-text focus:ring-2 focus:ring-ui-ring"
                    />
                  </div>
                  <Button size="lg" className="w-full" onClick={() => { setSelected(null); onStart(selected, Math.max(1, guests)); }}>
                    <UtensilsCrossed className="w-5 h-5" /> {t('openOrder')}
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-ui-muted">{isAr ? 'هذه الطاولة غير متاحة حالياً.' : 'This table is not available right now.'}</p>
              )}
            </div>
          );
        })()}
      </Modal>
    </>
  );
}
