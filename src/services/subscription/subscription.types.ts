export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'suspended'
  | 'cancelled'
  | 'expired';

export type BillingCycle = 'monthly' | 'quarterly' | 'yearly' | 'custom';

export type LimitType = 'boolean' | 'integer' | 'decimal' | 'unlimited';

export type FeatureCategory =
  | 'core'
  | 'operations'
  | 'inventory'
  | 'trade'
  | 'finance'
  | 'analytics'
  | 'enterprise'
  | 'management';

export type RejectionReason =
  | 'NO_SUBSCRIPTION'
  | 'SUBSCRIPTION_EXPIRED'
  | 'SUBSCRIPTION_SUSPENDED'
  | 'SUBSCRIPTION_CANCELLED'
  | 'FEATURE_DISABLED_GLOBALLY'
  | 'FEATURE_NOT_INCLUDED_IN_PLAN'
  | 'BRANCH_OVERRIDE_DISABLED'
  | 'LIMIT_REACHED'
  | 'TENANT_SUSPENDED'
  | 'ACCOUNT_DISABLED'
  | 'FEATURE_NOT_FOUND'
  | 'SUPER_ADMIN'
  | 'PLAN_ENABLED'
  | 'BRANCH_OVERRIDE_ENABLED';

export type SubscriptionEventType =
  | 'created'
  | 'trial_started'
  | 'activated'
  | 'renewed'
  | 'upgraded'
  | 'downgraded'
  | 'suspended'
  | 'reactivated'
  | 'cancelled'
  | 'expired'
  | 'extended'
  | 'feature_enabled'
  | 'feature_disabled';

export interface Plan {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
  is_public: boolean;
  display_order: number;
  created_at: string;
  prices?: PlanPrice[];
  features?: PlanFeatureWithDetails[];
}

export interface PlanPrice {
  id: string;
  plan_id: string;
  billing_cycle: BillingCycle;
  price: number;
  currency: string;
  trial_days: number;
  is_active: boolean;
  created_at: string;
}

export interface Feature {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: FeatureCategory;
  is_active: boolean;
  is_system: boolean;
  created_at: string;
}

export interface PlanFeature {
  id: string;
  plan_id: string;
  feature_id: string;
  enabled: boolean;
  limit_value: number | null;
  limit_type: LimitType;
  created_at: string;
}

export interface PlanFeatureWithDetails {
  key: string;
  name: string;
  description: string | null;
  category: FeatureCategory;
  enabled: boolean;
  limit_value: number | null;
  limit_type: LimitType;
}

export interface Subscription {
  id: string;
  tenant_id: string;
  plan_id: string;
  plan_price_id: string | null;
  status: SubscriptionStatus;
  started_at: string;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancelled_at: string | null;
  suspended_at: string | null;
  auto_renew: boolean;
  created_at: string;
  updated_at: string;
}

export interface BranchFeatureOverride {
  id: string;
  tenant_id: string;
  branch_id: string;
  branch_name?: string;
  feature_id: string;
  feature_key: string;
  feature_name: string;
  enabled: boolean;
  limit_value: number | null;
  reason: string | null;
}

export interface SubscriptionEvent {
  id: string;
  tenant_id: string;
  subscription_id: string | null;
  event_type: SubscriptionEventType;
  old_status: string | null;
  new_status: string | null;
  old_plan_id: string | null;
  new_plan_id: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
}

export interface FeatureAccessResult {
  allowed: boolean;
  reason: RejectionReason | string;
  source?: 'system' | 'plan' | 'branch_override' | 'tenant' | 'subscription';
  limit_value?: number | null;
  limit_type?: LimitType;
  message?: {
    ar: string;
    en: string;
  };
}

export interface TenantUsage {
  branches_count: number;
  users_count: number;
  warehouses_count: number;
}

export interface TenantSubscriptionDetails {
  has_subscription: boolean;
  tenant_id?: string;
  subscription?: Subscription;
  plan?: Pick<Plan, 'id' | 'name' | 'slug' | 'description'>;
  price?: Pick<PlanPrice, 'id' | 'billing_cycle' | 'price' | 'currency'> | null;
  features?: PlanFeatureWithDetails[];
  branch_overrides?: BranchFeatureOverride[];
  usage?: TenantUsage;
  events?: SubscriptionEvent[];
}
