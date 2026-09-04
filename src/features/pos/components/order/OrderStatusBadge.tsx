import { useLanguage } from '@/context/LanguageContext';
import { ORDER_STATE_STYLES, type PosOrderState } from '../../utils/orderState';

interface OrderStatusBadgeProps {
  state: PosOrderState;
  className?: string;
}

export function OrderStatusBadge({ state, className = '' }: OrderStatusBadgeProps) {
  const { t } = useLanguage();
  const st = ORDER_STATE_STYLES[state] || ORDER_STATE_STYLES.open;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold ${st.badge} ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
      {t(st.label)}
    </span>
  );
}

export function OrderStateDot({ state }: { state: PosOrderState }) {
  const st = ORDER_STATE_STYLES[state] || ORDER_STATE_STYLES.open;
  return <span className={`w-2 h-2 rounded-full inline-block ${st.dot}`} />;
}
