import { describe, it, expect, beforeEach } from 'vitest';
import { FeatureGateEngine } from '@/services/subscription/feature-gate.service';
import type { TenantSubscriptionDetails } from '@/services/subscription/subscription.types';

describe('FeatureGateEngine (PREMIER Subscription & Feature Gating)', () => {
  beforeEach(() => {
    FeatureGateEngine.setSuperAdmin(false);
    FeatureGateEngine.setTenantDetails(null, null);
  });

  it('1. Super Admin bypasses all subscription and feature gates', () => {
    FeatureGateEngine.setSuperAdmin(true);
    const access = FeatureGateEngine.getAccess('kds');
    expect(access.allowed).toBe(true);
    expect(access.reason).toBe('SUPER_ADMIN');
    expect(FeatureGateEngine.canAccess('accounting')).toBe(true);
  });

  it('2. Unknown or non-registered features are rejected with FEATURE_NOT_FOUND', () => {
    const access = FeatureGateEngine.getAccess('non_existent_crazy_feature');
    expect(access.allowed).toBe(false);
    expect(access.reason).toBe('FEATURE_NOT_FOUND');
  });

  it('3. Rejects access with NO_SUBSCRIPTION when no subscription is present', () => {
    FeatureGateEngine.setTenantDetails(null);
    const access = FeatureGateEngine.getAccess('kds');
    expect(access.allowed).toBe(false);
    expect(access.reason).toBe('NO_SUBSCRIPTION');
  });

  it('4. Rejects access with SUBSCRIPTION_EXPIRED when trial has ended', () => {
    const expiredTrialDetails: TenantSubscriptionDetails = {
      has_subscription: true,
      tenant_id: 'org-1',
      subscription: {
        id: 'sub-1',
        tenant_id: 'org-1',
        plan_id: 'plan-free',
        plan_price_id: null,
        status: 'trialing',
        started_at: new Date(Date.now() - 30 * 86400000).toISOString(),
        trial_started_at: new Date(Date.now() - 30 * 86400000).toISOString(),
        trial_ends_at: new Date(Date.now() - 10 * 86400000).toISOString(), // 10 days ago
        current_period_start: null,
        current_period_end: null,
        cancelled_at: null,
        suspended_at: null,
        auto_renew: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      features: [
        {
          key: 'pos',
          name: 'POS',
          description: null,
          category: 'core',
          enabled: true,
          limit_value: null,
          limit_type: 'boolean',
        },
      ],
    };

    FeatureGateEngine.setTenantDetails(expiredTrialDetails);
    const access = FeatureGateEngine.getAccess('pos');
    expect(access.allowed).toBe(false);
    expect(access.reason).toBe('SUBSCRIPTION_EXPIRED');
  });

  it('5. Rejects access with SUBSCRIPTION_SUSPENDED when subscription is suspended', () => {
    const suspendedDetails: TenantSubscriptionDetails = {
      has_subscription: true,
      tenant_id: 'org-1',
      subscription: {
        id: 'sub-1',
        tenant_id: 'org-1',
        plan_id: 'plan-starter',
        plan_price_id: null,
        status: 'suspended',
        started_at: new Date().toISOString(),
        trial_started_at: null,
        trial_ends_at: null,
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
        cancelled_at: null,
        suspended_at: new Date().toISOString(),
        auto_renew: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    };

    FeatureGateEngine.setTenantDetails(suspendedDetails);
    const access = FeatureGateEngine.getAccess('pos');
    expect(access.allowed).toBe(false);
    expect(access.reason).toBe('SUBSCRIPTION_SUSPENDED');
  });

  it('6. Correctly allows included features and rejects locked features in active plan', () => {
    const activeStarterDetails: TenantSubscriptionDetails = {
      has_subscription: true,
      tenant_id: 'org-1',
      subscription: {
        id: 'sub-1',
        tenant_id: 'org-1',
        plan_id: 'plan-starter',
        plan_price_id: null,
        status: 'active',
        started_at: new Date().toISOString(),
        trial_started_at: null,
        trial_ends_at: null,
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
        cancelled_at: null,
        suspended_at: null,
        auto_renew: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      features: [
        {
          key: 'pos',
          name: 'POS',
          description: null,
          category: 'core',
          enabled: true,
          limit_value: null,
          limit_type: 'boolean',
        },
        {
          key: 'kds',
          name: 'KDS',
          description: null,
          category: 'operations',
          enabled: false,
          limit_value: null,
          limit_type: 'boolean',
        },
      ],
    };

    FeatureGateEngine.setTenantDetails(activeStarterDetails);

    // POS is enabled in starter
    const posAccess = FeatureGateEngine.getAccess('pos');
    expect(posAccess.allowed).toBe(true);
    expect(posAccess.reason).toBe('PLAN_ENABLED');

    // KDS is disabled in starter
    const kdsAccess = FeatureGateEngine.getAccess('kds');
    expect(kdsAccess.allowed).toBe(false);
    expect(kdsAccess.reason).toBe('FEATURE_NOT_INCLUDED_IN_PLAN');
  });

  it('7. Branch Feature Overrides override the Plan status (both enable and disable)', () => {
    const activeDetails: TenantSubscriptionDetails = {
      has_subscription: true,
      tenant_id: 'org-1',
      subscription: {
        id: 'sub-1',
        tenant_id: 'org-1',
        plan_id: 'plan-starter',
        plan_price_id: null,
        status: 'active',
        started_at: new Date().toISOString(),
        trial_started_at: null,
        trial_ends_at: null,
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
        cancelled_at: null,
        suspended_at: null,
        auto_renew: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      features: [
        {
          key: 'pos',
          name: 'POS',
          description: null,
          category: 'core',
          enabled: true,
          limit_value: null,
          limit_type: 'boolean',
        },
        {
          key: 'kds',
          name: 'KDS',
          description: null,
          category: 'operations',
          enabled: false, // Plan says FALSE
          limit_value: null,
          limit_type: 'boolean',
        },
      ],
      branch_overrides: [
        {
          id: 'ov-1',
          tenant_id: 'org-1',
          branch_id: 'branch-alpha',
          feature_id: 'feat-kds',
          feature_key: 'kds',
          feature_name: 'KDS',
          enabled: true, // Special override: TRUE for branch-alpha
          limit_value: null,
          reason: 'VIP beta testing',
        },
        {
          id: 'ov-2',
          tenant_id: 'org-1',
          branch_id: 'branch-alpha',
          feature_id: 'feat-pos',
          feature_key: 'pos',
          feature_name: 'POS',
          enabled: false, // Override: Disable POS for branch-alpha
          limit_value: null,
          reason: 'Maintenance',
        },
      ],
    };

    FeatureGateEngine.setTenantDetails(activeDetails, 'branch-alpha');

    // 1. KDS was FALSE in plan, but TRUE in branch override -> ALLOWED
    const kdsAccess = FeatureGateEngine.getAccess('kds', 'branch-alpha');
    expect(kdsAccess.allowed).toBe(true);
    expect(kdsAccess.reason).toBe('BRANCH_OVERRIDE_ENABLED');

    // 2. POS was TRUE in plan, but FALSE in branch override -> DENIED
    const posAccess = FeatureGateEngine.getAccess('pos', 'branch-alpha');
    expect(posAccess.allowed).toBe(false);
    expect(posAccess.reason).toBe('BRANCH_OVERRIDE_DISABLED');

    // 3. Different branch (branch-beta) without overrides follows the Plan
    const betaKdsAccess = FeatureGateEngine.getAccess('kds', 'branch-beta');
    expect(betaKdsAccess.allowed).toBe(false);
    expect(betaKdsAccess.reason).toBe('FEATURE_NOT_INCLUDED_IN_PLAN');
  });

  it('8. Enforces usage limits for branches, users and warehouses', () => {
    const starterDetails: TenantSubscriptionDetails = {
      has_subscription: true,
      tenant_id: 'org-1',
      subscription: {
        id: 'sub-1',
        tenant_id: 'org-1',
        plan_id: 'plan-starter',
        plan_price_id: null,
        status: 'active',
        started_at: new Date().toISOString(),
        trial_started_at: null,
        trial_ends_at: null,
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
        cancelled_at: null,
        suspended_at: null,
        auto_renew: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      features: [
        {
          key: 'multi_branch',
          name: 'Multi-Branch',
          description: null,
          category: 'enterprise',
          enabled: true,
          limit_value: 2, // Limit = 2 branches
          limit_type: 'integer',
        },
        {
          key: 'employees',
          name: 'Staff',
          description: null,
          category: 'management',
          enabled: true,
          limit_value: 5, // Limit = 5 users
          limit_type: 'integer',
        },
      ],
    };

    FeatureGateEngine.setTenantDetails(starterDetails);

    // 1 branch created out of 2 -> allowed
    expect(FeatureGateEngine.checkUsageLimit('multi_branch', 1).allowed).toBe(true);

    // 2 branches created out of 2 -> limit reached
    expect(FeatureGateEngine.checkUsageLimit('multi_branch', 2).allowed).toBe(false);

    // 4 users out of 5 -> allowed
    expect(FeatureGateEngine.checkUsageLimit('employees', 4).allowed).toBe(true);

    // 5 users out of 5 -> limit reached
    expect(FeatureGateEngine.checkUsageLimit('employees', 5).allowed).toBe(false);
  });
});
