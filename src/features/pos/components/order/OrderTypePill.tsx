import { Table2, Car, Bike, Zap } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import type { OrderType } from '@/lib/types';
import { ORDER_TYPE_META } from '../../utils/orderLabels';

const ICONS = { table: Table2, car: Car, bike: Bike, zap: Zap } as const;

interface OrderTypePillProps {
  type: OrderType;
  className?: string;
}

export function OrderTypePill({ type, className = '' }: OrderTypePillProps) {
  const { t } = useLanguage();
  const meta = ORDER_TYPE_META[type];
  const Icon = ICONS[meta.icon];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-bold whitespace-nowrap ${meta.pill} ${className}`}>
      <Icon className="w-3 h-3" />
      {t(meta.label)}
    </span>
  );
}
