import { applyBrandColor, applySurfaceColor } from './brandColor';

export type UiThemeMode = 'light' | 'dark';

export interface UiThemePreset {
  key: string;
  ar: string;
  en: string;
  mode: UiThemeMode;
  brandHue: number;
  brandSat: number;
  surfaceHue: number;
  surfaceSat: number;
}

export const UI_THEME_STORAGE_KEY = 'pos_ui_theme';
export const DEFAULT_UI_THEME = 'premier-dark';

export const UI_THEMES: UiThemePreset[] = [
  { key: 'premier-dark', ar: 'بريمير داكنة', en: 'Premier Dark', mode: 'dark', brandHue: 222, brandSat: 72, surfaceHue: 222, surfaceSat: 50 },
  { key: 'premier-light', ar: 'بريمير فاتحة', en: 'Premier Light', mode: 'light', brandHue: 222, brandSat: 72, surfaceHue: 222, surfaceSat: 50 },
  { key: 'ocean', ar: 'المحيط', en: 'Ocean', mode: 'dark', brandHue: 205, brandSat: 85, surfaceHue: 210, surfaceSat: 55 },
  { key: 'midnight', ar: 'منتصف الليل', en: 'Midnight', mode: 'dark', brandHue: 198, brandSat: 85, surfaceHue: 205, surfaceSat: 60 },
  { key: 'emerald', ar: 'الزمرد', en: 'Emerald', mode: 'dark', brandHue: 160, brandSat: 72, surfaceHue: 165, surfaceSat: 55 },
  { key: 'royal-purple', ar: 'البنفسجي الملكي', en: 'Royal Purple', mode: 'dark', brandHue: 268, brandSat: 72, surfaceHue: 262, surfaceSat: 55 },
  { key: 'ruby', ar: 'الياقوتي', en: 'Ruby', mode: 'dark', brandHue: 345, brandSat: 75, surfaceHue: 335, surfaceSat: 55 },
  { key: 'sunset', ar: 'الغروب', en: 'Sunset', mode: 'dark', brandHue: 20, brandSat: 80, surfaceHue: 25, surfaceSat: 55 },
  { key: 'slate', ar: 'أردوازي', en: 'Slate', mode: 'dark', brandHue: 215, brandSat: 70, surfaceHue: 215, surfaceSat: 32 },
  { key: 'paper', ar: 'ورقي', en: 'Paper', mode: 'light', brandHue: 46, brandSat: 74, surfaceHue: 45, surfaceSat: 55 },
];

export function findUiTheme(key: string | null | undefined): UiThemePreset | undefined {
  if (!key) return undefined;
  return UI_THEMES.find((t) => t.key === key);
}

/** Apply a full UI theme preset to the DOM (mode class + brand + surface). */
export function applyUiThemePreset(p: UiThemePreset): void {
  document.documentElement.classList.toggle('dark', p.mode === 'dark');
  applyBrandColor(p.brandHue, p.brandSat);
  applySurfaceColor(p.surfaceHue, p.surfaceSat);
}
