import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  FeatureGateEngine,
  type FeatureAccessResult,
} from '../services/subscription';

export interface UseFeatureAccessReturn extends FeatureAccessResult {
  loading: boolean;
}

export function useFeatureAccess(featureKey: string, branchId?: string | null): UseFeatureAccessReturn {
  const { user } = useAuth();
  const [access, setAccess] = useState<FeatureAccessResult>(() =>
    FeatureGateEngine.getAccess(featureKey, branchId || user?.branch_id)
  );

  useEffect(() => {
    // Re-evaluate on auth user change or engine notification
    FeatureGateEngine.setSuperAdmin(user?.role === 'super_admin');
    const update = () => {
      setAccess(FeatureGateEngine.getAccess(featureKey, branchId || user?.branch_id));
    };

    update();
    const unsubscribe = FeatureGateEngine.subscribe(update);
    return unsubscribe;
  }, [featureKey, branchId, user]);

  return {
    ...access,
    loading: false,
  };
}
