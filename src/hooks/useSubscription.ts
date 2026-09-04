import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  SubscriptionService,
  FeatureGateEngine,
  type TenantSubscriptionDetails,
  type SubscriptionStatus,
} from '../services/subscription';

export interface UseSubscriptionReturn {
  details: TenantSubscriptionDetails | null;
  subscription: TenantSubscriptionDetails['subscription'];
  plan: TenantSubscriptionDetails['plan'];
  status: SubscriptionStatus | 'none';
  isActive: boolean;
  isTrial: boolean;
  isExpired: boolean;
  isSuspended: boolean;
  trialDaysRemaining: number | null;
  periodDaysRemaining: number | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useSubscription(): UseSubscriptionReturn {
  const { user } = useAuth();
  const [details, setDetails] = useState<TenantSubscriptionDetails | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchSubscription = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      FeatureGateEngine.setSuperAdmin(user.role === 'super_admin');
      const data = await SubscriptionService.getTenantSubscriptionDetails();
      setDetails(data);
    } catch (err) {
      console.error('useSubscription error:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchSubscription();
  }, [fetchSubscription]);

  const sub = details?.subscription;
  const status: SubscriptionStatus | 'none' = sub?.status || 'none';

  let isExpired = false;
  const isTrial = status === 'trialing';
  const isSuspended = status === 'suspended';
  let trialDaysRemaining: number | null = null;
  let periodDaysRemaining: number | null = null;

  if (sub?.trial_ends_at) {
    const msRemaining = new Date(sub.trial_ends_at).getTime() - Date.now();
    trialDaysRemaining = Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));
    if (isTrial && msRemaining <= 0) {
      isExpired = true;
    }
  }

  if (sub?.current_period_end) {
    const msRemaining = new Date(sub.current_period_end).getTime() - Date.now();
    periodDaysRemaining = Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));
    if (status === 'active' && msRemaining <= 0) {
      isExpired = true;
    }
  }

  const isActive =
    user?.role === 'super_admin' ||
    ((status === 'active' || (status === 'trialing' && !isExpired)) && !isSuspended);

  return {
    details,
    subscription: sub,
    plan: details?.plan,
    status,
    isActive,
    isTrial,
    isExpired,
    isSuspended,
    trialDaysRemaining,
    periodDaysRemaining,
    loading,
    refresh: fetchSubscription,
  };
}
