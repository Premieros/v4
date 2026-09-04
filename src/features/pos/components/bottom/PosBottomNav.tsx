import type { ReactNode } from 'react';
import { ListOrdered, Bike, Table2, Zap } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import type { PosPanelId } from '../topbar/PosTopBar';
import type { ActiveCategory } from '../orders/ActiveOrdersDrawer';

interface PosBottomNavProps {
  disabled?: boolean;
  panel: PosPanelId;
  category: ActiveCategory;
  counts: { activeOrders: number; deliveryOrders: number; takeawayOrders: number; occupiedTables: number };
  onOpenOrders: (c: ActiveCategory) => void;
  onOpenTables: () => void;
}

export function PosBottomNav({ disabled = false, panel, category, counts, onOpenOrders, onOpenTables }: PosBottomNavProps) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';

  const items: Array<{ key: string; icon: ReactNode; label: string; count: number; active: boolean; onClick: () => void; testId: string; ariaLabel: string | undefined }> = [
    { key: 'orders', icon: <ListOrdered className="h-5 w-5" />, label: ar ? 'الطلبات' : 'Orders', count: counts.activeOrders, active: panel === 'orders' && category === 'all', onClick: () => onOpenOrders('all'), testId: 'pos-nav-orders', ariaLabel: ar ? 'الطلبات النشطة' : 'Active orders' },
    { key: 'delivery', icon: <Bike className="h-5 w-5" />, label: ar ? 'التوصيل' : 'Delivery', count: counts.deliveryOrders, active: panel === 'orders' && category === 'delivery', onClick: () => onOpenOrders('delivery'), testId: 'pos-nav-delivery', ariaLabel: undefined },
    { key: 'tables', icon: <Table2 className="h-5 w-5" />, label: ar ? 'الطاولات' : 'Tables', count: counts.occupiedTables, active: panel === 'tables', onClick: onOpenTables, testId: 'pos-nav-tables', ariaLabel: undefined },
    { key: 'quick', icon: <Zap className="h-5 w-5" />, label: ar ? 'سريع' : 'Quick', count: counts.takeawayOrders, active: panel === 'orders' && category === 'quick', onClick: () => onOpenOrders('quick'), testId: 'pos-nav-quick', ariaLabel: undefined },
  ];

  return (
    <nav aria-label={ar ? 'التنقل داخل شاشة البيع' : 'POS navigation'} className="fixed inset-x-0 bottom-0 z-[35] border-t border-ui-border bg-ui-surface/95 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
      <div className="grid grid-cols-4">
        {items.map((it) => (
          <button key={it.key} type="button" disabled={disabled} data-testid={it.testId} aria-label={it.ariaLabel} onClick={it.onClick} className={`relative flex h-14 flex-col items-center justify-center gap-0.5 transition-colors disabled:opacity-50 ${it.active ? 'text-ui-accent' : 'text-ui-muted hover:text-ui-text'}`}>
            <span className="relative">
              {it.icon}
              {it.count > 0 && <span className={`absolute -top-2 -end-2.5 min-w-4 rounded-full px-1 text-center text-[9px] font-black leading-4 ${it.active ? 'bg-ui-accent text-ui-primary-fg' : 'bg-ui-page-alt text-ui-muted'}`}>{it.count}</span>}
            </span>
            <span className="text-[10px] font-black">{it.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
