import { useLanguage } from '@/context/LanguageContext';
import { ORDER_STAGE_STYLES, type OrderStage } from '../../utils/orderStage';

interface OrderStageBadgeProps {
  stage: OrderStage;
  className?: string;
}

export function OrderStageBadge({ stage, className = '' }: OrderStageBadgeProps) {
  const { t } = useLanguage();
  const st = ORDER_STAGE_STYLES[stage] || ORDER_STAGE_STYLES.open;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold ${st.badge} ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
      {t(st.label)}
    </span>
  );
}
