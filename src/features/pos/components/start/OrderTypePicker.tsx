import { Table2, Car, Bike, Zap, ListOrdered } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import type { OrderType } from '@/lib/types';
import { ORDER_TYPE_META } from '../../utils/orderLabels';

interface OrderTypePickerProps {
  onSelect: (type: OrderType) => void;
  onActiveOrders: () => void;
}

const ICONS = { table: Table2, car: Car, bike: Bike, zap: Zap } as const;

const CARDS: Array<{ type: OrderType; icon: keyof typeof ICONS; emoji: string; descAr: string; descEn: string }> = [
  { type: 'dine_in', icon: 'table', emoji: '🪑', descAr: 'داخل الصالة', descEn: 'Dine-in' },
  { type: 'drive_thru', icon: 'car', emoji: '🚗', descAr: 'الطلب من السيارة', descEn: 'Drive thru' },
  { type: 'delivery', icon: 'bike', emoji: '🛵', descAr: 'توصيل للعميل', descEn: 'Delivery' },
  { type: 'takeaway', icon: 'zap', emoji: '⚡', descAr: 'استلام سريع', descEn: 'Quick pickup' },
];

export function OrderTypePicker({ onSelect, onActiveOrders }: OrderTypePickerProps) {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';

  return (
    <div data-testid="pos-order-type-picker" className="flex-1 overflow-y-auto p-4 sm:p-8">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-6">
          <p className="text-2xl font-black text-ui-text">{t('chooseOrderType')}</p>
          <p data-testid="pos-order-type-question" className="text-sm text-ui-subtle mt-1">
            {isAr ? 'كيف سيتم تقديم هذا الطلب؟' : 'How will this order be served?'}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {CARDS.map((c) => {
            const meta = ORDER_TYPE_META[c.type];
            const Icon = ICONS[c.icon];
            return (
              <button
                key={c.type}
                data-testid={`pos-order-type-${c.type}`}
                onClick={() => onSelect(c.type)}
                className="group relative flex items-center gap-4 p-5 rounded-2xl border-2 border-ui-border bg-ui-surface hover:border-ui-primary hover:shadow-ui-lg transition-all active:scale-[0.98]"
              >
                <div className={`relative w-14 h-14 rounded-2xl flex items-center justify-center border ${meta.pill}`}>
                  <span className="absolute -top-2.5 -start-2.5 text-xl drop-shadow-sm" aria-hidden>{c.emoji}</span>
                  <Icon className="w-7 h-7" />
                </div>
                <div className="text-start min-w-0">
                  <p className="text-base font-black text-ui-text">{t(meta.label)}</p>
                  <p className="text-xs text-ui-subtle mt-0.5">{isAr ? c.descAr : c.descEn}</p>
                </div>
              </button>
            );
          })}
        </div>

        <button
          data-testid="pos-active-orders"
          onClick={onActiveOrders}
          className="mt-6 w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-ui-border text-sm font-bold text-ui-muted hover:bg-ui-page-alt transition-colors"
        >
          <ListOrdered className="w-4 h-4" />
          {t('openActiveOrders')}
        </button>
      </div>
    </div>
  );
}