import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { applyBrandColor, applyDefaultSurface, applySurfaceColor, brandFromSettingsValue } from '../lib/brandColor';
import { findUiTheme } from '../lib/themes';
import { useTheme } from './ThemeContext';
import { useLanguage } from './LanguageContext';
import { useAuth } from './AuthContext';
import type { Settings, BranchSettings } from '../lib/types';

export type EffectiveSettings = Settings;

export function mergeEffectiveSettings(global: Settings, branch?: BranchSettings | null): Settings {
  if (!branch) return global;
  return {
    ...global,
    currency: branch.currency ?? global.currency,
    tax_rate: branch.tax_rate ?? global.tax_rate,
    tax_enabled: branch.tax_enabled ?? global.tax_enabled,
    receipt_header: branch.receipt_header ?? global.receipt_header,
    receipt_footer: branch.receipt_footer ?? global.receipt_footer,
    logo_url: branch.logo_url ?? global.logo_url,
    low_stock_threshold: branch.low_stock_threshold ?? global.low_stock_threshold,
  };
}

interface SettingsContextValue {
  settings: Settings | null;
  loading: boolean;
  branchSettingsMap: Record<string, BranchSettings>;
  effectiveSettings: (branchId?: string | null) => Settings | null;
  refresh: () => Promise<void>;
  save: (patch: Partial<Settings>) => Promise<boolean>;
  saveBranchSettings: (branchId: string, patch: Partial<BranchSettings>) => Promise<boolean>;
}

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [branchSettingsMap, setBranchSettingsMap] = useState<Record<string, BranchSettings>>({});
  const [loading, setLoading] = useState(true);
  const { setTheme } = useTheme();
  const { setLang } = useLanguage();
  const { session } = useAuth();

  const sessionUserId = session?.user?.id ?? null;

  const refresh = useCallback(async () => {
    if (!sessionUserId) {
      setSettings(null);
      setBranchSettingsMap({});
      setLoading(false);
      return;
    }
    const [sRes, bRes] = await Promise.all([
      supabase.from('settings').select('*').maybeSingle(),
      supabase.from('branch_settings').select('*'),
    ]);
    const data = sRes.data as Settings | null;
    if (data) {
      setSettings(data);
      const uiPreset = findUiTheme(data.brand_color);
      if (uiPreset) {
        applyBrandColor(uiPreset.brandHue, uiPreset.brandSat);
        applySurfaceColor(uiPreset.surfaceHue, uiPreset.surfaceSat);
      } else {
        const brand = brandFromSettingsValue(data.brand_color);
        applyBrandColor(brand.hue, brand.sat);
        applyDefaultSurface();
      }
      if (data.theme) setTheme(data.theme as 'light' | 'dark');
      if (data.language) setLang(data.language as 'ar' | 'en');
    }
    const bMap: Record<string, BranchSettings> = {};
    for (const row of (bRes.data as BranchSettings[]) || []) bMap[row.branch_id] = row;
    setBranchSettingsMap(bMap);
    setLoading(false);
  }, [sessionUserId, setTheme, setLang]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const effectiveSettings = useCallback(
    (branchId?: string | null): Settings | null => {
      if (!settings) return null;
      if (!branchId) return settings;
      return mergeEffectiveSettings(settings, branchSettingsMap[branchId] || null);
    },
    [settings, branchSettingsMap]
  );

  const save = useCallback(async (patch: Partial<Settings>): Promise<boolean> => {
    if (!settings?.id) return false;
    const { error } = await supabase
      .from('settings')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', settings.id);
    if (error) return false;
    await refresh();
    return true;
  }, [settings, refresh]);

  const saveBranchSettings = useCallback(async (branchId: string, patch: Partial<BranchSettings>): Promise<boolean> => {
    const clean: Partial<BranchSettings> = { ...patch };
    (Object.keys(clean) as (keyof BranchSettings)[]).forEach((k) => {
      if (clean[k] === undefined) delete clean[k];
    });
    if (Object.keys(clean).length === 0) return true;
    const existing = branchSettingsMap[branchId];
    if (existing) {
      const { error } = await supabase
        .from('branch_settings')
        .update({ ...clean, updated_at: new Date().toISOString() })
        .eq('branch_id', branchId);
      if (error) return false;
    } else {
      const { error } = await supabase
        .from('branch_settings')
        .insert({ branch_id: branchId, ...clean });
      if (error) return false;
    }
    await refresh();
    return true;
  }, [branchSettingsMap, refresh]);

  return (
    <SettingsContext.Provider value={{ settings, loading, branchSettingsMap, effectiveSettings, refresh, save, saveBranchSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
