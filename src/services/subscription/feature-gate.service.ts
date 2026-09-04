import type {
  FeatureAccessResult,
  TenantSubscriptionDetails,
} from './subscription.types';
import { FEATURE_REGISTRY, REJECTION_MESSAGES } from './subscription.constants';

export class FeatureGateEngine {
  private static cachedDetails: TenantSubscriptionDetails | null = null;
  private static isSuperAdmin: boolean = false;
  private static currentBranchId: string | null = null;
  private static listeners: Array<() => void> = [];

  public static setSuperAdmin(val: boolean) {
    this.isSuperAdmin = val;
    this.notify();
  }

  public static setTenantDetails(details: TenantSubscriptionDetails | null, branchId?: string | null) {
    this.cachedDetails = details;
    if (branchId !== undefined) {
      this.currentBranchId = branchId;
    }
    this.notify();
  }

  public static subscribe(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private static notify() {
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch (err) {
        console.error('FeatureGate listener error:', err);
      }
    });
  }

  /**
   * Resolves feature access using the 7-tier hierarchy:
   * 1. Super Admin bypass (always allowed)
   * 2. Feature registry existence & global active check
   * 3. Tenant subscription existence & active status (trial/active vs expired/suspended)
   * 4. Branch-specific override check (if branchId provided or set)
   * 5. Plan-feature inclusion and limits check
   */
  public static getAccess(featureKey: string, branchId?: string | null): FeatureAccessResult {
    // 1. Super Admin
    if (this.isSuperAdmin) {
      return {
        allowed: true,
        reason: 'SUPER_ADMIN',
        source: 'system',
        limit_type: 'unlimited',
        message: REJECTION_MESSAGES.SUPER_ADMIN,
      };
    }

    const registryItem = FEATURE_REGISTRY[featureKey];
    if (!registryItem) {
      return {
        allowed: false,
        reason: 'FEATURE_NOT_FOUND',
        source: 'system',
        message: REJECTION_MESSAGES.FEATURE_NOT_FOUND,
      };
    }

    const details = this.cachedDetails;
    if (!details || !details.has_subscription || !details.subscription) {
      // If no subscription details loaded yet, allow system features if free trial/offline, or reject
      return {
        allowed: false,
        reason: 'NO_SUBSCRIPTION',
        source: 'subscription',
        message: REJECTION_MESSAGES.NO_SUBSCRIPTION,
      };
    }

    const sub = details.subscription;
    const now = new Date().getTime();

    // 2. Subscription Status Checks
    if (sub.status === 'suspended') {
      return {
        allowed: false,
        reason: 'SUBSCRIPTION_SUSPENDED',
        source: 'subscription',
        message: REJECTION_MESSAGES.SUBSCRIPTION_SUSPENDED,
      };
    }

    if (sub.status === 'cancelled') {
      return {
        allowed: false,
        reason: 'SUBSCRIPTION_CANCELLED',
        source: 'subscription',
        message: REJECTION_MESSAGES.SUBSCRIPTION_CANCELLED,
      };
    }

    if (sub.status === 'expired') {
      return {
        allowed: false,
        reason: 'SUBSCRIPTION_EXPIRED',
        source: 'subscription',
        message: REJECTION_MESSAGES.SUBSCRIPTION_EXPIRED,
      };
    }

    if (sub.status === 'trialing' && sub.trial_ends_at) {
      const trialEnd = new Date(sub.trial_ends_at).getTime();
      if (now > trialEnd) {
        return {
          allowed: false,
          reason: 'SUBSCRIPTION_EXPIRED',
          source: 'subscription',
          message: REJECTION_MESSAGES.SUBSCRIPTION_EXPIRED,
        };
      }
    }

    if (sub.status === 'active' && sub.current_period_end) {
      const activeEnd = new Date(sub.current_period_end).getTime();
      if (now > activeEnd) {
        return {
          allowed: false,
          reason: 'SUBSCRIPTION_EXPIRED',
          source: 'subscription',
          message: REJECTION_MESSAGES.SUBSCRIPTION_EXPIRED,
        };
      }
    }

    // 3. Branch Feature Override Check
    const targetBranch = branchId || this.currentBranchId;
    if (targetBranch && details.branch_overrides) {
      const override = details.branch_overrides.find(
        (o) => o.branch_id === targetBranch && o.feature_key === featureKey
      );
      if (override) {
        if (!override.enabled) {
          return {
            allowed: false,
            reason: 'BRANCH_OVERRIDE_DISABLED',
            source: 'branch_override',
            limit_value: override.limit_value,
            message: REJECTION_MESSAGES.BRANCH_OVERRIDE_DISABLED,
          };
        } else {
          return {
            allowed: true,
            reason: 'BRANCH_OVERRIDE_ENABLED',
            source: 'branch_override',
            limit_value: override.limit_value,
            message: REJECTION_MESSAGES.BRANCH_OVERRIDE_ENABLED,
          };
        }
      }
    }

    // 4. Plan Features check
    const planFeat = details.features?.find((f) => f.key === featureKey);
    if (!planFeat || !planFeat.enabled) {
      return {
        allowed: false,
        reason: 'FEATURE_NOT_INCLUDED_IN_PLAN',
        source: 'plan',
        message: REJECTION_MESSAGES.FEATURE_NOT_INCLUDED_IN_PLAN,
      };
    }

    return {
      allowed: true,
      reason: 'PLAN_ENABLED',
      source: 'plan',
      limit_value: planFeat.limit_value,
      limit_type: planFeat.limit_type,
      message: REJECTION_MESSAGES.PLAN_ENABLED,
    };
  }

  public static canAccess(featureKey: string, branchId?: string | null): boolean {
    return this.getAccess(featureKey, branchId).allowed;
  }

  public static getFeatureLimit(featureKey: string): number | null {
    if (this.isSuperAdmin) return -1;
    const access = this.getAccess(featureKey);
    if (!access.allowed) return 0;
    return access.limit_value ?? -1;
  }

  public static checkUsageLimit(
    limitKey: 'multi_branch' | 'employees' | 'warehouse_management',
    currentCount: number
  ): { allowed: boolean; maxAllowed: number; current: number } {
    if (this.isSuperAdmin) {
      return { allowed: true, maxAllowed: -1, current: currentCount };
    }

    const limit = this.getFeatureLimit(limitKey);
    if (limit === null || limit === -1) {
      return { allowed: true, maxAllowed: -1, current: currentCount };
    }

    return {
      allowed: currentCount < limit,
      maxAllowed: limit,
      current: currentCount,
    };
  }
}
