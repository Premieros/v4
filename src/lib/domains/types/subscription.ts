export type SubscriptionStatusValue =
  | 'none'
  | 'trial'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'cancelled'
  | 'expired';

export interface SubscriptionStatus {
  branch_id: string;
  status: SubscriptionStatusValue;
  plan_id: string | null;
  expired: boolean;
  trial_ends_at: string | null;
  current_period_ends_at: string | null;
  cancelled_at: string | null;
  plan_name_ar?: string;
  plan_name_en?: string;
  plan_code?: string;
}

export interface SubscriptionPlan {
  id: string;
  code?: string;
  name_ar: string;
  name_en: string;
  monthly_price_egp: number;
  yearly_price_egp: number;
  max_branches?: number;
  max_users_per_branch?: number;
  features: string[];
  is_active: boolean;
  created_at: string;
}
