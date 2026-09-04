import { SubscriptionService } from './subscription.service';
import { FeatureGateEngine } from './feature-gate.service';
import { FEATURE_REGISTRY, REJECTION_MESSAGES } from './subscription.constants';
import type {
  SubscriptionStatus,
  BillingCycle,
  LimitType,
  FeatureCategory,
  RejectionReason,
  SubscriptionEventType,
  Plan,
  PlanPrice,
  Feature,
  PlanFeatureWithDetails,
  Subscription,
  BranchFeatureOverride,
  SubscriptionEvent,
  FeatureAccessResult,
  TenantUsage,
  TenantSubscriptionDetails,
} from './subscription.types';

export {
  SubscriptionService,
  FeatureGateEngine,
  FEATURE_REGISTRY,
  REJECTION_MESSAGES,
  type SubscriptionStatus,
  type BillingCycle,
  type LimitType,
  type FeatureCategory,
  type RejectionReason,
  type SubscriptionEventType,
  type Plan,
  type PlanPrice,
  type Feature,
  type PlanFeatureWithDetails,
  type Subscription,
  type BranchFeatureOverride,
  type SubscriptionEvent,
  type FeatureAccessResult,
  type TenantUsage,
  type TenantSubscriptionDetails,
};

export const subscriptionService = {
  getTenantSubscriptionDetails: SubscriptionService.getTenantSubscriptionDetails,
  getPublicPlans: SubscriptionService.getPublicPlans,
  getAllFeatures: SubscriptionService.getAllFeatures,
  getTenantEvents: SubscriptionService.getTenantEvents,
  superAdminChangeSubscription: SubscriptionService.superAdminChangeSubscription,
  setBranchOverride: SubscriptionService.setBranchOverride,
  removeBranchOverride: SubscriptionService.removeBranchOverride,
  getAccess: FeatureGateEngine.getAccess.bind(FeatureGateEngine),
  setSuperAdmin: FeatureGateEngine.setSuperAdmin.bind(FeatureGateEngine),
  setTenantDetails: FeatureGateEngine.setTenantDetails.bind(FeatureGateEngine),
  subscribe: FeatureGateEngine.subscribe.bind(FeatureGateEngine),
};

export default subscriptionService;
