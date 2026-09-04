import { useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { isAdminRole } from '@/lib/permissions';

export interface PosPermissions {
  canViewPos: boolean;
  canCreateOrder: boolean;
  canEditOrder: boolean;
  canDeleteItem: boolean;
  canApplyDiscount: boolean;
  canDiscount: boolean;
  canChangePrice: boolean;
  canHoldOrder: boolean;
  canCancelOrder: boolean;
  canRefund: boolean;
  canCloseShift: boolean;
  canPrint: boolean;
  canChangeBranch: boolean;
}

export function usePosPermissions(): PosPermissions {
  const { user } = useAuth();
  const role = user?.role || 'cashier';
  const isAdmin = isAdminRole(role);

  return useMemo<PosPermissions>(() => {
    if (isAdmin) {
      return {
        canViewPos: true,
        canCreateOrder: true,
        canEditOrder: true,
        canDeleteItem: true,
        canApplyDiscount: true,
        canDiscount: true,
        canChangePrice: true,
        canHoldOrder: true,
        canCancelOrder: true,
        canRefund: true,
        canCloseShift: true,
        canPrint: true,
        canChangeBranch: true,
      };
    }

    const isCashier = role === 'cashier';
    const isManager = role === 'branch_manager';

    return {
      canViewPos: isCashier || isManager,
      canCreateOrder: isCashier || isManager,
      canEditOrder: isCashier || isManager,
      canDeleteItem: isCashier || isManager,
      canApplyDiscount: isCashier || isManager,
      canDiscount: isCashier || isManager,
      canChangePrice: isManager,
      canHoldOrder: isCashier || isManager,
      canCancelOrder: isCashier || isManager,
      canRefund: isManager,
      canCloseShift: isCashier || isManager,
      canPrint: true,
      canChangeBranch: isManager,
    };
  }, [isAdmin, role]);
}
