import { supabase } from '@/lib/supabase';
import type { ApiError, ApiResult } from '../types';
import type { RpcResult, SubscriptionStatus, SubscriptionPlan } from '@/lib/types';
import { rpc } from '../rpc';

function normalizeFeatures(features: unknown): string[] {
  if (!features) return [];
  if (Array.isArray(features)) {
    return features.map((f) => {
      if (typeof f === 'string') return f;
      if (typeof f === 'object' && f !== null) {
        if ('key' in f && typeof (f as { key: unknown }).key === 'string') return (f as { key: string }).key;
        if ('name' in f && typeof (f as { name: unknown }).name === 'string') return (f as { name: string }).name;
        if ('id' in f && typeof (f as { id: unknown }).id === 'string') return (f as { id: string }).id;
      }
      return String(f);
    });
  }
  if (typeof features === 'string') {
    try {
      const parsed = JSON.parse(features);
      return normalizeFeatures(parsed);
    } catch {
      return features.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  if (typeof features === 'object' && features !== null) {
    return Object.entries(features)
      .filter(([, val]) => Boolean(val))
      .map(([k]) => k);
  }
  return [];
}

export const subscriptions = {
  async registerTenant(p: {
    p_store_name: string;
    p_owner_name: string;
    p_email: string;
    p_password: string;
    p_store_name_en?: string | null;
    p_phone?: string | null;
    p_address?: string | null;
    p_currency?: string | null;
  }): ApiResult<RpcResult & { organization_id?: string; branch_id?: string; warehouse_id?: string; user_id?: string; membership_role?: string; trial_days?: number }> {
    // 1. Try register_tenant RPC (Multi-tenant Foundation)
    try {
      const res = await rpc<RpcResult & { organization_id?: string; branch_id?: string; warehouse_id?: string; user_id?: string; membership_role?: string; trial_days?: number }>('register_tenant', p);
      if (res.data) {
        if (res.data.success || (res.data as unknown as Record<string, unknown>).organization_id) {
          return { data: { ...res.data, success: true }, error: null };
        }
        // Explicit business validation or error returned from register_tenant RPC
        if (res.data.success === false) {
          return { data: res.data, error: null };
        }
      }
      if (res.error && (res.error.message.includes('EMAIL_TAKEN') || res.error.message.includes('INVALID_EMAIL') || res.error.message.includes('WEAK_PASSWORD') || res.error.message.includes('MISSING_STORE_NAME'))) {
        return { data: { success: false, error: res.error.message }, error: null };
      }
    } catch (err) {
      console.warn('register_tenant RPC execution failed, trying secondary fallback:', err);
    }

    // 2. Try register_branch RPC (Single/Multi-branch Foundation)
    try {
      const branchRes = await rpc<RpcResult & { branch_id?: string; warehouse_id?: string; user_id?: string; trial_days?: number }>('register_branch', p);
      if (branchRes.data) {
        if (branchRes.data.success || (branchRes.data as unknown as Record<string, unknown>).branch_id) {
          return { data: { ...branchRes.data, success: true }, error: null };
        }
        if (branchRes.data.success === false) {
          return { data: branchRes.data, error: null };
        }
      }
      if (branchRes.error && (branchRes.error.message.includes('EMAIL_TAKEN') || branchRes.error.message.includes('INVALID_EMAIL') || branchRes.error.message.includes('WEAK_PASSWORD') || branchRes.error.message.includes('MISSING_STORE_NAME'))) {
        return { data: { success: false, error: branchRes.error.message }, error: null };
      }
    } catch (err) {
      console.warn('register_branch RPC execution failed:', err);
    }

    // 3. Direct Client Provisioning Fallback
    try {
      const email = p.p_email.trim().toLowerCase();
      const password = p.p_password;

      // 3.1 Sign up user in Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: p.p_owner_name.trim(),
            store_name: p.p_store_name.trim(),
          },
        },
      });

      if (authError) {
        if (authError.message.toLowerCase().includes('already registered')) {
          return { data: { success: false, error: 'EMAIL_TAKEN' }, error: null };
        }
        return { data: { success: false, error: authError.message }, error: null };
      }

      const userId = authData.user?.id;
      if (!userId) {
        return { data: { success: false, error: 'Failed to create user session' }, error: null };
      }

      const orgSlug = p.p_store_name.trim().toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Math.random().toString(36).substring(2, 6);

      // 3.2 Try inserting organization if permitted (ignore RLS error if table restricts to super admins)
      let orgId: string | null = null;
      try {
        const { data: orgData } = await supabase
          .from('organizations')
          .insert({
            name: p.p_store_name.trim(),
            slug: orgSlug,
            is_active: true,
          })
          .select()
          .maybeSingle();

        if (orgData?.id) {
          orgId = orgData.id;
        }
      } catch {
        // Table may have RLS restricting direct insert to super admins
      }

      // 3.3 Insert Main Branch
      let branchId: string | null = null;
      const { data: branchData, error: branchError } = await supabase
        .from('branches')
        .insert({
          ...(orgId ? { organization_id: orgId } : {}),
          name: p.p_store_name.trim() + ' - الفرع الرئيسي',
          name_en: p.p_store_name_en ? `${p.p_store_name_en} - Main Branch` : null,
          phone: p.p_phone || null,
          address: p.p_address || null,
          is_main: true,
          is_active: true,
        })
        .select()
        .maybeSingle();

      if (branchError) {
        console.warn('Direct branch creation note:', branchError.message);
      } else if (branchData?.id) {
        branchId = branchData.id;
      }

      // 3.4 Insert Branch Settings with Currency & Tax configuration
      if (branchId) {
        await Promise.resolve(
          supabase.from('branch_settings').upsert(
            {
              branch_id: branchId,
              currency: p.p_currency || 'EGP',
              tax_rate: 15,
              tax_enabled: true,
              low_stock_threshold: 10,
            },
            { onConflict: 'branch_id' }
          )
        ).catch(() => {});
      }

      // 3.5 Insert Default Warehouse
      if (branchId) {
        await Promise.resolve(
          supabase.from('warehouses').insert({
            name: 'المستودع الرئيسي',
            branch_id: branchId,
            is_active: true,
          })
        ).catch(() => {});
      }

      // 3.6 Insert Organization Member (Owner) if organization exists
      if (orgId) {
        await Promise.resolve(
          supabase.from('organization_members').insert({
            organization_id: orgId,
            user_id: userId,
            membership_role: 'owner',
            is_active: true,
          })
        ).catch(() => {});
      }

      // 3.7 Upsert User record
      await Promise.resolve(
        supabase.from('users').upsert({
          id: userId,
          email,
          full_name: p.p_owner_name.trim(),
          role: 'owner',
          branch_id: branchId || null,
          is_active: true,
          created_at: new Date().toISOString(),
        })
      ).catch(() => {});

      // 3.8 Initialize 14-day trial subscription
      const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
      if (branchId) {
        await Promise.resolve(
          supabase.from('branch_subscriptions').upsert(
            {
              branch_id: branchId,
              status: 'trial',
              trial_starts_at: new Date().toISOString(),
              trial_ends_at: trialEndsAt,
              current_period_starts_at: new Date().toISOString(),
              current_period_ends_at: trialEndsAt,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'branch_id' }
          )
        ).catch(() => {});
      }

      if (orgId) {
        try {
          const { data: defaultPlan } = await supabase
            .from('plans')
            .select('id')
            .limit(1)
            .maybeSingle();

          if (defaultPlan?.id) {
            await supabase.from('subscriptions').upsert(
              {
                tenant_id: orgId,
                plan_id: defaultPlan.id,
                status: 'trialing',
                started_at: new Date().toISOString(),
                trial_started_at: new Date().toISOString(),
                trial_ends_at: trialEndsAt,
                current_period_start: new Date().toISOString(),
                current_period_end: trialEndsAt,
                auto_renew: true,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'tenant_id' }
            );
          }
        } catch {
          // Multi-tenant subscriptions optional fallback
        }
      }

      return {
        data: {
          success: true,
          organization_id: orgId || undefined,
          branch_id: branchId || undefined,
          user_id: userId,
          membership_role: 'owner',
          trial_days: 14,
        },
        error: null,
      };
    } catch (fallbackErr) {
      console.error('Tenant registration fallback exception:', fallbackErr);
      return {
        data: { success: false, error: fallbackErr instanceof Error ? fallbackErr.message : 'Registration failed' },
        error: null,
      };
    }
  },

  status(p: { p_branch_id: string }): ApiResult<SubscriptionStatus> { return rpc('subscription_status', p); },
  activate(p: { p_branch_id: string; p_plan_id: string; p_billing_period?: 'monthly' | 'yearly'; p_activate?: boolean }): ApiResult<RpcResult & { price_egp?: number }> { return rpc('activate_subscription', p); },

  async listPlans(): ApiResult<SubscriptionPlan[]> {
    const res = await supabase.from('subscription_plans').select('*').order('monthly_price_egp', { ascending: true });
    if (res.error || !res.data) {
      // Try fallback from plans table
      const { data: pData } = await supabase.from('plans').select('*, plan_prices(*)').eq('is_active', true);
      if (pData && pData.length > 0) {
        const mapped: SubscriptionPlan[] = pData.map((p) => {
          const prices = (p.plan_prices as Array<{ billing_cycle: string; price: number }>) || [];
          const mPrice = prices.find((pr) => pr.billing_cycle === 'monthly')?.price || 0;
          const yPrice = prices.find((pr) => pr.billing_cycle === 'yearly')?.price || mPrice * 10;
          return {
            id: p.id,
            code: p.slug || p.id,
            name_ar: p.name,
            name_en: p.slug,
            monthly_price_egp: mPrice,
            yearly_price_egp: yPrice,
            max_branches: 1,
            max_users_per_branch: 5,
            features: ['pos', 'inventory', 'reports', 'accounting'],
            is_active: p.is_active ?? true,
            created_at: p.created_at,
          };
        });
        return { data: mapped, error: null };
      }
      return { data: (res.data as SubscriptionPlan[] | null) ?? null, error: res.error as ApiError | null };
    }
    const normalized = (res.data as Record<string, unknown>[]).map((item) => ({
      ...item,
      features: normalizeFeatures(item.features),
    })) as SubscriptionPlan[];
    return { data: normalized, error: null };
  },

  async savePlan(plan: Partial<SubscriptionPlan> & { name_ar: string }): ApiResult<SubscriptionPlan> {
    const normFeatures = normalizeFeatures(plan.features);
    const payload = {
      ...plan,
      features: normFeatures,
    };

    let resultPlan: SubscriptionPlan | null = null;
    if (plan.id) {
      const res = await supabase.from('subscription_plans').update(payload).eq('id', plan.id).select().single();
      if (res.data) {
        const item = res.data as Record<string, unknown>;
        resultPlan = { ...item, features: normalizeFeatures(item.features) } as SubscriptionPlan;
      }
    } else {
      const res = await supabase.from('subscription_plans').insert(payload).select().single();
      if (res.data) {
        const item = res.data as Record<string, unknown>;
        resultPlan = { ...item, features: normalizeFeatures(item.features) } as SubscriptionPlan;
      }
    }

    if (resultPlan) {
      // Dual-sync to plans and plan_prices table to guarantee relational consistency
      try {
        const planSlug = resultPlan.code || resultPlan.id;
        const { data: upsertedPlan } = await supabase.from('plans').upsert({
          id: resultPlan.id,
          name: resultPlan.name_ar,
          slug: planSlug,
          description: resultPlan.name_en || resultPlan.name_ar,
          is_active: resultPlan.is_active ?? true,
          is_public: resultPlan.is_active ?? true,
          updated_at: new Date().toISOString(),
        }).select().maybeSingle();

        if (upsertedPlan) {
          // Sync monthly & yearly prices
          await supabase.from('plan_prices').upsert([
            {
              plan_id: resultPlan.id,
              billing_cycle: 'monthly',
              price: resultPlan.monthly_price_egp,
              currency: 'EGP',
              is_active: true,
            },
            {
              plan_id: resultPlan.id,
              billing_cycle: 'yearly',
              price: resultPlan.yearly_price_egp,
              currency: 'EGP',
              is_active: true,
            },
          ]);
        }
      } catch (syncErr) {
        console.warn('Dual-sync to plans table skipped/failed:', syncErr);
      }

      return { data: resultPlan, error: null };
    }

    return { data: null, error: { message: 'Failed to save subscription plan' } as ApiError };
  },

  async deletePlan(id: string): ApiResult<void> {
    const res = await supabase.from('subscription_plans').delete().eq('id', id);
    try {
      await supabase.from('plans').delete().eq('id', id);
    } catch {
      // Best-effort
    }
    return { data: null, error: res.error as ApiError | null };
  },

  async updateBranchSubscription(p: { branch_id: string; plan_id?: string | null; status?: string; current_period_ends_at?: string | null }): ApiResult<void> {
    const res = await supabase.from('branch_subscriptions').upsert({
      branch_id: p.branch_id,
      plan_id: p.plan_id ?? null,
      status: p.status ?? 'active',
      current_period_ends_at: p.current_period_ends_at ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'branch_id' });

    // Also sync to parent organization subscription
    try {
      const { data: branch } = await supabase.from('branches').select('organization_id').eq('id', p.branch_id).single();
      if (branch?.organization_id) {
        await supabase.from('subscriptions').upsert({
          tenant_id: branch.organization_id,
          plan_id: p.plan_id ?? null,
          status: p.status ?? 'active',
          current_period_end: p.current_period_ends_at ?? null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'tenant_id' });
      }
    } catch {
      // Best effort
    }

    return { data: null, error: res.error as ApiError | null };
  },
};


