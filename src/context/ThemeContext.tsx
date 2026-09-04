import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Theme } from '../lib/types';
import { applySurfaceColor } from '../lib/brandColor';
import { DEFAULT_UI_THEME, findUiTheme, UI_THEME_STORAGE_KEY, applyUiThemePreset } from '../lib/themes';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  uiTheme: string;
  setUiTheme: (key: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem('pos_theme');
    return (saved as Theme) || 'light';
  });
  const [uiTheme, setUiThemeState] = useState<string>(() => {
    const saved = localStorage.getItem(UI_THEME_STORAGE_KEY);
    return saved && findUiTheme(saved) ? saved : DEFAULT_UI_THEME;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('pos_theme', theme);
  }, [theme]);

  // Restore the persisted surface tint on load. Accent + mode are driven by
  // DB settings through SettingsContext so this only touches surfaces.
  useEffect(() => {
    const p = findUiTheme(uiTheme);
    if (p) applySurfaceColor(p.surfaceHue, p.surfaceSat);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggleTheme = useCallback(() => setThemeState((prev) => (prev === 'light' ? 'dark' : 'light')), []);

  const setUiTheme = useCallback((key: string) => {
    const p = findUiTheme(key);
    if (!p) return;
    setUiThemeState(key);
    localStorage.setItem(UI_THEME_STORAGE_KEY, key);
    applyUiThemePreset(p);
    setThemeState(p.mode);
  }, []);

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme, uiTheme, setUiTheme }),
    [theme, setTheme, toggleTheme, uiTheme, setUiTheme]
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
