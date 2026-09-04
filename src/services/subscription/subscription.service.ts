import { supabase } from '../../lib/supabase';
import type {
  Plan,
  PlanPrice,
  Feature,
  Subscription,
  TenantSubscriptionDetails,
  SubscriptionEvent,
  BranchFeatureOverride,
} from './subscription.types';
import { FeatureGateEngine } from './feature-gate.service';

export class SubscriptionService {
  /**
   * Loads full tenant subscription details with plans, features, branch overrides, usage, and events.
   */
  public static async getTenantSubscriptionDetails(
    tenantId?: string
  ): Promise<TenantSubscriptionDetails> {
    try {
      const { data, error } = await supabase.rpc('get_tenant_subscription_details', {
        p_tenant_id: tenantId || null,
      });

      if (!error && data && !data.error) {
        FeatureGateEngine.setTenantDetails(data as TenantSubscriptionDetails);
        return data as TenantSubscriptionDetails;
      }
    } catch (rpcErr) {
      console.warn('get_tenant_subscription_details RPC failed, using fallback query:', rpcErr);
    }

    // Direct Table Queries Fallback
    try {
      // 1. Fetch current user's organization
      let orgId = tenantId;
      if (!orgId) {
        const { data: member } = await supabase
          .from('organization_members')
          .select('organization_id')
          .limit(1)
          .maybeSingle();
        orgId = member?.organization_id;
      }

      if (!orgId) {
        return { has_subscription: false };
      }

      // 2. Fetch subscription (check subscriptions table first, then branch_subscriptions)
      let sub: Subscription | null = null;
      const { data: subData } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('tenant_id', orgId)
        .maybeSingle();

      if (subData) {
        sub = subData as unknown as Subscription;
      }

      if (!sub) {
        // Check branch_subscriptions
        const { data: branchData } = await supabase
          .from('branches')
          .select('id')
          .eq('organization_id', orgId)
          .limit(1)
          .maybeSingle();

        if (branchData?.id) {
          const { data: branchSub } = await supabase
            .from('branch_subscriptions')
            .select('*')
            .eq('branch_id', branchData.id)
            .maybeSingle();

          if (branchSub) {
            sub = {
              id: branchSub.id || branchData.id,
              tenant_id: orgId,
              plan_id: branchSub.plan_id,
              plan_price_id: null,
              status: (branchSub.status as Subscription['status']) || 'active',
              started_at: branchSub.created_at || new Date().toISOString(),
              trial_started_at: branchSub.created_at || null,
              trial_ends_at: branchSub.status === 'trialing' ? branchSub.current_period_ends_at : null,
              current_period_start: branchSub.created_at || null,
              current_period_end: branchSub.current_period_ends_at,
              cancelled_at: null,
              suspended_at: null,
              auto_renew: true,
              created_at: branchSub.created_at || new Date().toISOString(),
              updated_at: branchSub.updated_at || new Date().toISOString(),
            };
          }
        }
      }

      if (!sub) {
        return { has_subscription: false, tenant_id: orgId };
      }

      // 3. Fetch plan from plans OR subscription_plans
      let plan: Plan | (Record<string, unknown> & { id: string; name: string; slug: string; description?: string | null; is_active: boolean; is_public: boolean; display_order?: number }) | null = null;
      if (sub.plan_id) {
        const { data: p1 } = await supabase
          .from('plans')
          .select('*')
          .eq('id', sub.plan_id)
          .maybeSingle();
        plan = p1;

        if (!plan) {
          const { data: p2 } = await supabase
            .from('subscription_plans')
            .select('*')
            .eq('id', sub.plan_id)
            .maybeSingle();
          if (p2) {
            plan = {
              id: p2.id,
              name: p2.name_ar || p2.name_en || 'الخطة المختارة',
              slug: p2.code || p2.id,
              description: p2.name_en || p2.name_ar,
              is_active: p2.is_active ?? true,
              is_public: p2.is_active ?? true,
              display_order: 1,
            };
          }
        }
      }

      // 4. Fetch price if set
      let price: PlanPrice | null = null;
      if (sub.plan_price_id) {
        const { data: p } = await supabase
          .from('plan_prices')
          .select('*')
          .eq('id', sub.plan_price_id)
          .maybeSingle();
        price = p;
      }

      // 5. Fetch features and plan features
      const { data: allFeatures } = await supabase
        .from('features')
        .select('*')
        .eq('is_active', true);
      const { data: planFeatures } = sub.plan_id
        ? await supabase.from('plan_features').select('*').eq('plan_id', sub.plan_id)
        : { data: [] };

      const featuresWithDetails = (allFeatures || []).map((f) => {
        const pf = planFeatures?.find((p) => p.feature_id === f.id);
        return {
          key: f.key,
          name: f.name,
          description: f.description,
          category: f.category,
          enabled: pf ? pf.enabled : true,
          limit_value: pf?.limit_value ?? null,
          limit_type: pf?.limit_type ?? 'boolean',
        };
      });

      // 6. Branch overrides
      const { data: overrides } = await supabase
        .from('branch_feature_overrides')
        .select('*, branches(name), features(key, name)')
        .eq('tenant_id', orgId);

      const formattedOverrides: BranchFeatureOverride[] = ((overrides || []) as Array<{
        id: string;
        tenant_id: string;
        branch_id: string;
        branches?: { name?: string };
        feature_id: string;
        features?: { key?: string; name?: string };
        enabled: boolean;
        limit_value?: number | null;
        reason?: string | null;
      }>).map((o) => ({
        id: o.id,
        tenant_id: o.tenant_id,
        branch_id: o.branch_id,
        branch_name: o.branches?.name,
        feature_id: o.feature_id,
        feature_key: o.features?.key || '',
        feature_name: o.features?.name || '',
        enabled: o.enabled,
        limit_value: o.limit_value ?? null,
        reason: o.reason ?? null,
      }));

      // 7. Counts
      const { count: branchCount } = await supabase
        .from('branches')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId);

      const { count: userCount } = await supabase
        .from('organization_members')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('is_active', true);

      const result: TenantSubscriptionDetails = {
        has_subscription: true,
        tenant_id: orgId,
        subscription: sub,
        plan: plan
          ? {
              id: plan.id,
              name: plan.name,
              slug: plan.slug,
              description: plan.description ?? null,
            }
          : undefined,
        price: price || undefined,
        features: featuresWithDetails,
        branch_overrides: formattedOverrides,
        usage: {
          branches_count: branchCount || 0,
          users_count: userCount || 0,
          warehouses_count: 0,
        },
      };

      FeatureGateEngine.setTenantDetails(result);
      return result;
    } catch (fallbackErr) {
      console.error('Subscription fallback failed:', fallbackErr);
      return { has_subscription: false };
    }
  }

  /**
   * Retrieves all active public plans with prices and plan features for selection & comparison.
   */
  public static async getPublicPlans(): Promise<Plan[]> {
    try {
      // 1. Query subscription_plans table (admin managed)
      const { data: subPlans } = await supabase
        .from('subscription_plans')
        .select('*')
        .eq('is_active', true)
        .order('monthly_price_egp', { ascending: true });

      // 2. Query plans table (relational model)
      const { data: plans } = await supabase
        .from('plans')
        .select('*, plan_prices(*)')
        .eq('is_active', true)
        .order('display_order', { ascending: true });

      // Fetch features for comparison
      const { data: features } = await supabase
        .from('features')
        .select('*')
        .eq('is_active', true);

      const { data: planFeatures } = await supabase
        .from('plan_features')
        .select('*');

      const allFeatures = features || [];

      // If subscription_plans has data, format each as a full Plan
      if (subPlans && subPlans.length > 0) {
        return subPlans.map((sp: Record<string, unknown>, idx: number) => {
          const rawFeats = sp.features;
          let activeFeatureKeys: string[] = [];
          if (Array.isArray(rawFeats)) {
            activeFeatureKeys = rawFeats.map((k) => String(k));
          } else if (typeof rawFeats === 'string') {
            try {
              activeFeatureKeys = JSON.parse(rawFeats);
            } catch {
              activeFeatureKeys = rawFeats.split(',').map((s) => s.trim());
            }
          }

          const mappedFeatures = allFeatures.map((f) => {
            const isEnabled = activeFeatureKeys.length > 0
              ? activeFeatureKeys.includes(f.key)
              : true;
            return {
              key: f.key,
              name: f.name,
              description: f.description,
              category: f.category,
              enabled: isEnabled,
              limit_value: null,
              limit_type: 'boolean' as const,
            };
          });

          const monthlyPrice = Number(sp.monthly_price_egp) || 0;
          const yearlyPrice = Number(sp.yearly_price_egp) || monthlyPrice * 10;

          const prices: PlanPrice[] = [
            {
              id: `${sp.id}_monthly`,
              plan_id: String(sp.id),
              billing_cycle: 'monthly',
              price: monthlyPrice,
              currency: 'EGP',
              trial_days: 14,
              is_active: true,
              created_at: String(sp.created_at || new Date().toISOString()),
            },
            {
              id: `${sp.id}_yearly`,
              plan_id: String(sp.id),
              billing_cycle: 'yearly',
              price: yearlyPrice,
              currency: 'EGP',
              trial_days: 14,
              is_active: true,
              created_at: String(sp.created_at || new Date().toISOString()),
            },
          ];

          return {
            id: String(sp.id),
            name: String(sp.name_ar || sp.name_en || 'باقة غير معنونة'),
            slug: String(sp.code || sp.id),
            description: sp.name_en ? String(sp.name_en) : null,
            is_active: Boolean(sp.is_active ?? true),
            is_public: true,
            display_order: idx + 1,
            created_at: String(sp.created_at || new Date().toISOString()),
            prices,
            features: mappedFeatures,
          };
        });
      }

      // Fallback: use plans table
      return (plans || []).map((rawPlan) => {
        const plan = rawPlan as Plan & { plan_prices?: PlanPrice[] };
        const pFeats = allFeatures.map((f) => {
          const pf = planFeatures?.find(
            (p) => p.plan_id === plan.id && p.feature_id === f.id
          );
          return {
            key: f.key,
            name: f.name,
            description: f.description,
            category: f.category,
            enabled: pf ? pf.enabled : false,
            limit_value: pf?.limit_value ?? null,
            limit_type: pf?.limit_type ?? 'boolean',
          };
        });

        return {
          id: plan.id,
          name: plan.name,
          slug: plan.slug,
          description: plan.description,
          is_active: plan.is_active,
          is_public: plan.is_public,
          display_order: plan.display_order,
          created_at: plan.created_at,
          prices: plan.plan_prices || plan.prices || [],
          features: pFeats,
        };
      }) as Plan[];
    } catch (err) {
      console.error('Failed to get public plans:', err);
      return [];
    }
  }

  /**
   * Retrieves full feature catalog (Super Admin / Management).
   */
  public static async getAllFeatures(): Promise<Feature[]> {
    const { data, error } = await supabase
      .from('features')
      .select('*')
      .order('category', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      console.error('Failed to fetch features:', error);
      return [];
    }
    return data || [];
  }

  /**
   * Retrieves subscription events log for a tenant.
   */
  public static async getTenantEvents(tenantId: string): Promise<SubscriptionEvent[]> {
    const { data, error } = await supabase
      .from('subscription_events')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Failed to fetch subscription events:', error);
      return [];
    }
    return data || [];
  }

  /**
   * Super Admin: Changes or sets a tenant subscription.
   */
  public static async superAdminChangeSubscription(payload: {
    tenantId: string;
    planId: string;
    status: string;
    currentPeriodEnd?: string;
    trialEndsAt?: string;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      const { data, error } = await supabase.rpc('super_admin_change_subscription', {
        p_tenant_id: payload.tenantId,
        p_plan_id: payload.planId,
        p_status: payload.status,
        p_current_period_end: payload.currentPeriodEnd || null,
        p_trial_ends_at: payload.trialEndsAt || null,
      });

      if (error) throw error;
      return data || { success: true };
    } catch {
      // Fallback direct update
      const { error: upsertErr } = await supabase.from('subscriptions').upsert(
        {
          tenant_id: payload.tenantId,
          plan_id: payload.planId,
          status: payload.status,
          current_period_end: payload.currentPeriodEnd,
          trial_ends_at: payload.trialEndsAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id' }
      );

      if (upsertErr) return { success: false, error: upsertErr.message };
      return { success: true };
    }
  }

  /**
   * Super Admin: Sets a branch feature override.
   */
  public static async setBranchOverride(payload: {
    tenantId: string;
    branchId: string;
    featureKey: string;
    enabled: boolean;
    limitValue?: number | null;
    reason?: string;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      const { data, error } = await supabase.rpc('super_admin_set_branch_override', {
        p_tenant_id: payload.tenantId,
        p_branch_id: payload.branchId,
        p_feature_key: payload.featureKey,
        p_enabled: payload.enabled,
        p_limit_value: payload.limitValue ?? null,
        p_reason: payload.reason || null,
      });

      if (error) throw error;
      return data || { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error: msg };
    }
  }

  /**
   * Super Admin: Removes a branch feature override.
   */
  public static async removeBranchOverride(
    branchId: string,
    featureKey: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { data, error } = await supabase.rpc('super_admin_remove_branch_override', {
        p_branch_id: branchId,
        p_feature_key: featureKey,
      });

      if (error) throw error;
      return data || { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error: msg };
    }
  }
}
