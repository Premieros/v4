import { useMemo } from 'react';
import { Grid3x3, MapPin, Plus, Trash2, Users } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { Card } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { formatCurrency } from '@/lib/format';
import type { DiningArea, DiningTable, Order } from '@/lib/types';
import { STATUS_STYLES } from '../../utils/orderTypes';

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

interface TableFloorPlanProps {
  areas: DiningArea[];
  tables: DiningTable[];
  ordersByTable: Record<string, Order[]>;
  canManage: boolean;
  currency: string;
  onSelectTable: (table: DiningTable) => void;
  onAddTable: (areaId?: string) => void;
  onDeleteArea: (area: DiningArea) => void;
}

export function TableFloorPlan({ areas, tables, ordersByTable, canManage, currency, onSelectTable, onAddTable, onDeleteArea }: TableFloorPlanProps) {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';

  const renderCanvas = useMemo(() => (tablesInArea: DiningTable[]) => {
    const positions = resolvePositions(tablesInArea);
    const maxW = positions.reduce((m, p) => Math.max(m, p.left + p.width), 0) + 20;
    const maxH = positions.reduce((m, p) => Math.max(m, p.top + p.height), 0) + 20;
    return (
      <div className="overflow-auto rounded-xl bg-ui-page border border-ui-border">
        <div className="relative" style={{ width: Math.max(maxW, 900), height: Math.max(maxH, 380) }}>
          {positions.map(({ table, left, top, width, height }) => {
            const st = STATUS_STYLES[table.status] || STATUS_STYLES.vacant;
            const tableOrders = ordersByTable[table.id] || [];
            const order = tableOrders[0];
            return (
              <button
                key={table.id}
                onClick={() => onSelectTable(table)}
                className={`absolute rounded-xl border-2 shadow-sm p-2 flex flex-col items-center justify-center transition-all hover:shadow-card-hover hover:-translate-y-0.5 active:scale-[0.98] ${st.card}`}
                style={{ left, top, width, height }}
              >
                <span className="text-sm font-bold text-ui-text truncate max-w-full">{table.name}</span>
                <span className="flex items-center gap-1 text-[10px] text-ui-muted">
                  <Users className="w-3 h-3" /> {table.capacity}
                </span>
                {order && (
                  <span className={`mt-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold truncate max-w-full ${st.badge}`}>
                    {order.order_number} · {formatCurrency(order.total, currency, lang)}{tableOrders.length > 1 ? ` +${tableOrders.length - 1}` : ''}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }, [ordersByTable, onSelectTable, currency, lang]);

  if (areas.length === 0 && tables.length === 0) {
    return (
      <Card className="p-16 text-center text-ui-subtle">
        <Grid3x3 className="w-16 h-16 mx-auto mb-4 opacity-30" />
        <p className="text-lg font-medium">{isAr ? 'لا توجد مناطق أو طاولات بعد' : 'No areas or tables yet'}</p>
        {canManage && (
          <Button className="mt-4" onClick={() => onAddTable()}>
            <Plus className="w-4 h-4" /> {t('addArea')}
          </Button>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {areas.map((area) => {
        const areaTables = tables.filter((tb) => tb.area_id === area.id);
        if (areaTables.length === 0) return null;
        return (
          <Card key={area.id} className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-ui-text flex items-center gap-2">
                <MapPin className="w-4 h-4 text-ui-accent" />
                {area.name}
                <span className="text-xs font-normal text-ui-subtle">({areaTables.length})</span>
              </h3>
              {canManage && (
                <div className="flex items-center gap-1">
                  <button onClick={() => onAddTable(area.id)} className="p-1.5 rounded-lg text-ui-subtle hover:text-ui-accent hover:bg-ui-page-alt" title={t('addTable')}>
                    <Plus className="w-4 h-4" />
                  </button>
                  <button onClick={() => onDeleteArea(area)} className="p-1.5 rounded-lg text-ui-subtle hover:text-ui-danger hover:bg-ui-danger/10" title={isAr ? 'حذف المنطقة' : 'Delete area'}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
            {renderCanvas(areaTables)}
          </Card>
        );
      })}
      {(() => {
        const loose = tables.filter((tb) => !tb.area_id);
        if (loose.length === 0) return null;
        return (
          <Card key="loose" className="p-4">
            <h3 className="text-sm font-bold text-ui-text mb-3 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-ui-subtle" />
              {isAr ? 'طاولات بدون منطقة' : 'Tables without area'}
            </h3>
            {renderCanvas(loose)}
          </Card>
        );
      })()}
    </div>
  );
}
