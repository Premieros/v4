import { ArrowRight, Table2, Car, Bike, Zap } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import type { Customer, DiningTable, Order, OrderItem, OrderType } from '@/lib/types';
import type { OrderKitchenSend } from '../../types';
import { OrderTypePicker } from './OrderTypePicker';
import { TablePickerStep } from './TablePickerStep';
import { CarOrderStep } from './CarOrderStep';
import { DeliveryOrderStep } from './DeliveryOrderStep';

export type StartStep = 'type' | 'table' | 'car' | 'delivery';

export interface StartOrderOptions {
  orderType: OrderType;
  tableId?: string | null;
  guestCount?: number | null;
  customerId?: string;
  notes?: string;
}

interface OrderStartWizardProps {
  step: StartStep;
  tables: DiningTable[];
  ordersByTable: Record<string, Order[]>;
  itemsByOrder: Record<string, OrderItem[]>;
  kitchenSendsByOrder: Record<string, OrderKitchenSend[]>;
  customers: Customer[];
  preselectedTableId: string | null;
  currency: string;
  onStepChange: (step: StartStep) => void;
  onBack: () => void;
  onStart: (opts: StartOrderOptions) => void;
  onResume: (order: Order, pay?: boolean) => void;
  onActiveOrders: () => void;
}

const STEP_ICONS = { table: Table2, car: Car, bike: Bike, zap: Zap } as const;

export function OrderStartWizard({
  step, tables, ordersByTable, itemsByOrder, kitchenSendsByOrder, customers,
  preselectedTableId, currency, onStepChange, onBack, onStart, onResume, onActiveOrders,
}: OrderStartWizardProps) {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';

  const title =
    step === 'type' ? t('chooseOrderType')
    : step === 'table' ? t('dineIn')
    : step === 'car' ? t('carOrder')
    : t('delivery');

  const showBack = step !== 'type';
  const StepIcon = STEP_ICONS[step === 'table' ? 'table' : step === 'car' ? 'car' : step === 'delivery' ? 'bike' : 'zap'];

  return (
    <div className="fixed inset-0 top-16 z-40 bg-ui-surface flex flex-col animate-fade-in">
      <div className="flex items-center gap-3 px-4 sm:px-6 py-3 border-b border-ui-border flex-shrink-0">
        {showBack ? (
          <button
            onClick={onBack}
            className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-ui-page-alt text-ui-muted text-xs font-bold hover:bg-ui-page-alt transition-colors active:scale-95"
          >
            <ArrowRight className={`w-3.5 h-3.5 ${isAr ? '' : 'rotate-180'}`} />
            {isAr ? 'رجوع' : 'Back'}
          </button>
        ) : (
          <div className="w-20" />
        )}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-ui-primary-soft flex items-center justify-center">
            <StepIcon className="w-4.5 h-4.5 text-ui-accent" />
          </div>
          <h2 className="text-sm font-black text-ui-text truncate">{title}</h2>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-ui-subtle">
          <span className={`w-2 h-2 rounded-full ${step === 'type' ? 'bg-ui-accent' : 'bg-ui-border-strong'}`} />
          <span className={`w-2 h-2 rounded-full ${step !== 'type' ? 'bg-ui-accent' : 'bg-ui-border-strong'}`} />
        </div>
      </div>

      {step === 'type' && (
        <OrderTypePicker
          onSelect={(type) => {
            if (type === 'takeaway') onStart({ orderType: 'takeaway' });
            else onStepChange(type === 'dine_in' ? 'table' : type === 'drive_thru' ? 'car' : 'delivery');
          }}
          onActiveOrders={onActiveOrders}
        />
      )}
      {step === 'table' && (
        <TablePickerStep
          tables={tables}
          ordersByTable={ordersByTable}
          itemsByOrder={itemsByOrder}
          kitchenSendsByOrder={kitchenSendsByOrder}
          currency={currency}
          preselectedTableId={preselectedTableId}
          onStart={(table, guests) => onStart({ orderType: 'dine_in', tableId: table.id, guestCount: guests })}
          onResume={onResume}
          onPay={(o) => onResume(o, true)}
        />
      )}
      {step === 'car' && <CarOrderStep onStart={(o) => onStart({ ...o })} />}
      {step === 'delivery' && <DeliveryOrderStep customers={customers} onStart={(o) => onStart({ ...o })} />}
    </div>
  );
}
