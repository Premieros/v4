import { useMemo } from 'react';
import { useCan } from '@/lib/permissions';
import { useUserBranches } from '@/hooks/useUserBranches';

export interface PosPermissions {
  canViewPos: boolean;
  canCreateOrder: boolean;
  canEditOrder: boolean;
  canDeleteItem: boolean;
  canApplyDiscount: boolean;
  canDiscount: boolean;
  canChangePrice: boolean;
  canHoldOrder: boolean;
  canSendKitchen: boolean;
  canCollectPayment: boolean;
  canCancelOrder: boolean;
  canRefund: boolean;
  canCloseShift: boolean;
  canPrint: boolean;
  canChangeBranch: boolean;
}

export function usePosPermissions(): PosPermissions {
  const can = useCan();
  const { canSwitch } = useUserBranches();

  return useMemo<PosPermissions>(() => ({
    canViewPos: can('pos.sell'),
    canCreateOrder: can('pos.order.create'),
    canEditOrder: can('pos.order.edit'),
    canDeleteItem: can('pos.order.edit'),
    canApplyDiscount: can('pos.discount'),
    canDiscount: can('pos.discount'),
    canChangePrice: can('pos.change_price'),
    canHoldOrder: can('pos.order.hold'),
    canSendKitchen: can('pos.order.send_kitchen'),
    canCollectPayment: can('pos.payment.collect'),
    canCancelOrder: can('pos.order.cancel'),
    canRefund: can('refunds.approve'),
    canCloseShift: can('shifts.close'),
    canPrint: can('sales.print'),
    canChangeBranch: canSwitch,
  }), [can, canSwitch]);
}
