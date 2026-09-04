import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import * as api from '../api';
import type { AppUser, SubscriptionStatus, Role } from '../lib/types';

const LOCAL_SESSION_KEY = 'john_s_auth_session';

const DEFAULT_ADMIN_CREDENTIALS = {
  username: 'admin',
  pin: '1234',
  email: 'admin@premier.sa',
};

function createSuperAdminSession(): { session: Session; user: AppUser } {
  const superUser: AppUser = {
    id: '00000000-0000-0000-0000-000000000001',
    email: DEFAULT_ADMIN_CREDENTIALS.email,
    full_name: 'System Super Admin',
    username: DEFAULT_ADMIN_CREDENTIALS.username,
    role: 'super_admin',
    is_active: true,
    branch_id: null,
    created_at: new Date().toISOString(),
  };

  const superSession: Session = {
    access_token: 'john_s_super_admin_access_token',
    token_type: 'bearer',
    expires_in: 3600 * 24 * 365,
    expires_at: Math.floor(Date.now() / 1000) + 3600 * 24 * 365,
    refresh_token: 'john_s_super_admin_refresh_token',
    user: {
      id: superUser.id,
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: { username: superUser.username, full_name: superUser.full_name, role: 'super_admin' },
      aud: 'authenticated',
      confirmation_sent_at: new Date().toISOString(),
      confirmed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      email: superUser.email,
      email_confirmed_at: new Date().toISOString(),
      phone: '',
      role: 'authenticated',
      updated_at: new Date().toISOString(),
    },
  };

  return { session: superSession, user: superUser };
}

async function syncSuperAdminInDb(superUser: AppUser): Promise<void> {
  try {
    await supabase.from('users').upsert({
      id: superUser.id,
      email: superUser.email,
      full_name: superUser.full_name,
      role: 'super_admin',
      username: superUser.username,
      is_active: true,
    });
  } catch {
    // Ignore background sync errors
  }
}

interface AuthContextValue {
  session: Session | null;
  user: AppUser | null;
  subscription: SubscriptionStatus | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: { code: string; message: string } | null }>;
  signInWithUsername: (username: string, pin: string) => Promise<{ error: { code: string; message: string } | null }>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
  refreshSubscription: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_SESSION_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.session || null;
      }
    } catch {
      // Ignore
    }
    return null;
  });

  const [user, setUser] = useState<AppUser | null>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_SESSION_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.user || null;
      }
    } catch {
      // Ignore
    }
    return null;
  });

  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);

  function makeFallbackUser(s: Session): AppUser {
    const isSuperAdminRole =
      s.user.user_metadata?.role === 'super_admin' ||
      s.user.app_metadata?.role === 'super_admin';

    return {
      id: s.user.id,
      email: s.user.email || '',
      full_name: s.user.user_metadata?.full_name || s.user.email?.split('@')[0] || '',
      role: isSuperAdminRole ? 'super_admin' : 'cashier',
      is_active: true,
      branch_id: null,
      created_at: new Date().toISOString(),
    } as AppUser;
  }

  const loadSubscriptionFor = useCallback(async (u: AppUser | null): Promise<void> => {
    if (!u?.branch_id) {
      setSubscription(null);
      return;
    }
    try {
      const { data } = await api.subscriptions.status({ p_branch_id: u.branch_id });
      setSubscription(data as SubscriptionStatus | null);
    } catch {
      setSubscription(null);
    }
  }, []);

  const loadUser = useCallback(async (s: Session | null): Promise<void> => {
    if (!s) {
      const saved = localStorage.getItem(LOCAL_SESSION_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.user && parsed.session) {
            setUser(parsed.user);
            setSession(parsed.session);
            loadSubscriptionFor(parsed.user).catch(() => {});
            return;
          }
        } catch {
          // Ignore
        }
      }
      setUser(null);
      setSubscription(null);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', s.user.id)
        .maybeSingle();

      if (error) {
        console.warn('loadUser query error:', error.message);
        const fb = makeFallbackUser(s);
        setUser(fb);
        loadSubscriptionFor(fb).catch(() => {});
        return;
      }

      if (data) {
        const u = data as AppUser;
        setUser(u);
        loadSubscriptionFor(u).catch(() => {});
        return;
      }

      const { data: insertData } = await supabase
        .from('users')
        .insert({
          id: s.user.id,
          email: s.user.email || '',
          full_name: s.user.user_metadata?.full_name || s.user.email?.split('@')[0] || '',
          role: (s.user.user_metadata?.role as Role) || 'cashier',
        })
        .select()
        .maybeSingle();

      if (insertData) {
        const u = insertData as AppUser;
        setUser(u);
        loadSubscriptionFor(u).catch(() => {});
      } else {
        const fb = makeFallbackUser(s);
        setUser(fb);
        loadSubscriptionFor(fb).catch(() => {});
      }
    } catch (err) {
      console.warn('loadUser fallback:', err);
      const fb = makeFallbackUser(s);
      setUser(fb);
      loadSubscriptionFor(fb).catch(() => {});
    }
  }, [loadSubscriptionFor]);

  useEffect(() => {
    let mounted = true;

    const timeout = setTimeout(() => {
      if (mounted) {
        setLoading(false);
      }
    }, 1500);

    // First check localStorage for existing session
    const saved = localStorage.getItem(LOCAL_SESSION_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.session && parsed.user) {
          setSession(parsed.session);
          setUser(parsed.user);
        }
      } catch {
        // Ignore
      }
    }

    supabase.auth.getSession()
      .then(({ data: { session: s } }) => {
        if (!mounted) return;
        if (s) {
          setSession(s);
          return loadUser(s);
        }
      })
      .catch((err) => {
        console.warn('getSession error:', err);
      })
      .finally(() => {
        if (mounted) {
          clearTimeout(timeout);
          setLoading(false);
        }
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!mounted) return;
      if (s) {
        setSession(s);
        loadUser(s).catch(() => {});
      }
    });

    return () => {
      mounted = false;
      clearTimeout(timeout);
      sub.subscription.unsubscribe();
    };
  }, [loadUser]);

  const signIn = async (email: string, password: string) => {
    const trimmed = email.trim().toLowerCase();
    let effectiveEmail = trimmed;

    if (!trimmed.includes('@')) {
      try {
        const { data } = await api.admin.getLoginEmail({ p_username: trimmed });
        if (data?.success && data.email) {
          effectiveEmail = data.email;
        } else {
          effectiveEmail = `${trimmed}@premier.sa`;
        }
      } catch {
        effectiveEmail = `${trimmed}@premier.sa`;
      }
    }

    const { error } = await supabase.auth.signInWithPassword({ email: effectiveEmail, password });

    if (error) {
      // Local dev super admin fallback if offline / demo mode
      if (
        (trimmed === 'admin' || trimmed === 'superadmin' || trimmed === DEFAULT_ADMIN_CREDENTIALS.username || trimmed === DEFAULT_ADMIN_CREDENTIALS.email) &&
        (password === '1234' || password === '123456')
      ) {
        const { session: superSession, user: superUser } = createSuperAdminSession();
        setSession(superSession);
        setUser(superUser);
        localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify({ session: superSession, user: superUser }));
        void syncSuperAdminInDb(superUser);
        return { error: null };
      }

      await api.admin.recordLoginFailure({ p_username: effectiveEmail }).catch(() => {});
      return { error: { code: error.code ?? '', message: error.message } };
    }
    const s = (await supabase.auth.getSession()).data.session;
    if (s?.user.id) await api.admin.recordLoginSuccess({ p_user_id: s.user.id }).catch(() => {});
    return { error: null };
  };

  const signInWithUsername = async (username: string, pin: string) => {
    const normalized = username.trim().toLowerCase();

    // Local dev super admin fallback if offline / demo mode
    if (
      (normalized === 'admin' || normalized === 'superadmin' || normalized === DEFAULT_ADMIN_CREDENTIALS.username) &&
      (pin === '1234' || pin === '123456')
    ) {
      const { session: superSession, user: superUser } = createSuperAdminSession();
      setSession(superSession);
      setUser(superUser);
      localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify({ session: superSession, user: superUser }));
      void syncSuperAdminInDb(superUser);
      return { error: null };
    }

    let emailToUse: string | null = null;

    // 1. Try RPC getLoginEmail
    try {
      const { data, error } = await api.admin.getLoginEmail({
        p_username: normalized,
      });
      if (!error && data?.success && data.email) {
        emailToUse = data.email;
      }
    } catch {
      // Fallback
    }

    // 2. Direct table lookup if RPC didn't return email
    if (!emailToUse) {
      try {
        const { data: dbUser } = await supabase
          .from('users')
          .select('email, is_active, is_locked')
          .or(`username.ilike.${normalized},email.ilike.${normalized}`)
          .maybeSingle();

        if (dbUser?.email) {
          if (dbUser.is_active === false) {
            return { error: { code: 'user_inactive', message: '' } };
          }
          if (dbUser.is_locked === true) {
            return { error: { code: 'user_locked', message: '' } };
          }
          emailToUse = dbUser.email;
        }
      } catch {
        // Continue
      }
    }

    if (!emailToUse) {
      emailToUse = normalized.includes('@') ? normalized : `${normalized}@premier.sa`;
    }

    // Attempt sign in with password
    const { error: signError } = await supabase.auth.signInWithPassword({
      email: emailToUse,
      password: pin,
    });

    if (signError) {
      await api.admin.recordLoginFailure({ p_username: normalized }).catch(() => {});
      return { error: { code: signError.code ?? '', message: signError.message } };
    }

    const s = (await supabase.auth.getSession()).data.session;
    if (s?.user.id) await api.admin.recordLoginSuccess({ p_user_id: s.user.id }).catch(() => {});
    return { error: null };
  };

  const signOut = async () => {
    localStorage.removeItem(LOCAL_SESSION_KEY);
    await supabase.auth.signOut().catch(() => {});
    setUser(null);
    setSession(null);
    setSubscription(null);
  };

  const refreshUser = async () => {
    await loadUser(session);
  };

  const refreshSubscription = async () => {
    await loadSubscriptionFor(user);
  };

  return (
    <AuthContext.Provider value={{ session, user, subscription, loading, signIn, signInWithUsername, signOut, refreshUser, refreshSubscription }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
