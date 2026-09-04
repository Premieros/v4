export interface BrandPreset {
  key: string;
  ar: string;
  en: string;
  hue: number;
  sat: number;
}

export const BRAND_PRESETS: BrandPreset[] = [
  { key: 'royal', ar: 'أزرق ملكي', en: 'Royal Blue', hue: 222, sat: 72 },
  { key: 'navy', ar: 'كحلي', en: 'Navy', hue: 222, sat: 66 },
  { key: 'gold', ar: 'ذهبي', en: 'Gold', hue: 46, sat: 74 },
  { key: 'green', ar: 'أخضر', en: 'Green', hue: 150, sat: 72 },
  { key: 'teal', ar: 'تركوازي', en: 'Teal', hue: 172, sat: 74 },
  { key: 'blue', ar: 'أزرق', en: 'Blue', hue: 218, sat: 70 },
  { key: 'indigo', ar: 'نيلي', en: 'Indigo', hue: 245, sat: 70 },
  { key: 'purple', ar: 'بنفسجي', en: 'Purple', hue: 272, sat: 70 },
  { key: 'rose', ar: 'وردي', en: 'Rose', hue: 350, sat: 74 },
  { key: 'orange', ar: 'برتقالي', en: 'Orange', hue: 24, sat: 76 },
  { key: 'red', ar: 'أحمر', en: 'Red', hue: 0, sat: 72 },
];

export const DEFAULT_BRAND = { hue: 222, sat: 72 };

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
const LADDER: Record<number, { l: number; s: number }> = {
  50: { l: 97, s: 70 },
  100: { l: 94, s: 72 },
  200: { l: 88, s: 76 },
  300: { l: 78, s: 76 },
  400: { l: 66, s: 76 },
  500: { l: 52, s: 74 },
  600: { l: 42, s: 72 },
  700: { l: 34, s: 70 },
  800: { l: 27, s: 68 },
  900: { l: 21, s: 66 },
};

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = ln - c / 2;
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function brandShades(hue: number, sat: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const shade of SHADES) {
    const { l, s } = LADDER[shade];
    const [r, g, b] = hslToRgb(hue, sat ?? s, l);
    out[`--brand-${shade}`] = `${r} ${g} ${b}`;
  }
  return out;
}

export function applyBrandColor(hue: number, sat: number): void {
  const shades = brandShades(hue, sat);
  const root = document.documentElement;
  for (const key of Object.keys(shades)) {
    root.style.setProperty(key, shades[key]);
  }
}

export function applyBrandHex(hex: string): void {
  const { h, s } = hexToHsl(hex);
  applyBrandColor(h, Math.min(85, Math.max(55, s)));
}

export const DEFAULT_SURFACE = { hue: 222, sat: 50 };

const SURFACE_SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
const SURFACE_LADDER: Record<number, { l: number; s: number }> = {
  50: { l: 96, s: 38 },
  100: { l: 90, s: 53 },
  200: { l: 82, s: 57 },
  300: { l: 70, s: 52 },
  400: { l: 56, s: 47 },
  500: { l: 45, s: 49 },
  600: { l: 37, s: 52 },
  700: { l: 30, s: 53 },
  800: { l: 22, s: 54 },
  900: { l: 11, s: 47 },
  950: { l: 5, s: 60 },
};

export function surfaceShades(hue: number, sat: number): Record<string, string> {
  const out: Record<string, string> = {};
  const factor = sat / DEFAULT_SURFACE.sat;
  for (const shade of SURFACE_SHADES) {
    const { l, s } = SURFACE_LADDER[shade];
    const ss = Math.min(75, Math.max(18, Math.round(s * factor)));
    const [r, g, b] = hslToRgb(hue, ss, l);
    out[`--navy-${shade}`] = `${r} ${g} ${b}`;
  }
  return out;
}

export function applySurfaceColor(hue: number, sat: number): void {
  const vars = surfaceShades(hue, sat);
  const root = document.documentElement;
  for (const key of Object.keys(vars)) {
    root.style.setProperty(key, vars[key]);
  }
}

export function applyDefaultSurface(): void {
  applySurfaceColor(DEFAULT_SURFACE.hue, DEFAULT_SURFACE.sat);
}

export interface BrandValue {
  hue: number;
  sat: number;
}

export function brandFromSettingsValue(value: string | null | undefined): BrandValue {
  if (!value) return DEFAULT_BRAND;
  const preset = BRAND_PRESETS.find((p) => p.key === value);
  if (preset) return { hue: preset.hue, sat: preset.sat };
  if (/^#([0-9a-fA-F]{6})$/.test(value)) {
    const { h, s } = hexToHsl(value);
    return { hue: h, sat: Math.min(85, Math.max(55, s)) };
  }
  return DEFAULT_BRAND;
}

const BRAND_SHADE_FALLBACK: Record<string, string> = {
  600: '5 150 105',
  500: '16 185 129',
};

function readBrandRgb(shade: number): string {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(`--brand-${shade}`)
    .trim();
  if (v) return v;
  return BRAND_SHADE_FALLBACK[String(shade)] || '5 150 105';
}

/** CSS color string for SVG / chart usage, e.g. "rgb(5 150 105)". */
export function getBrandColor(shade: number): string {
  return `rgb(${readBrandRgb(shade)})`;
}

/** Hex string for use inside generated/printed HTML, e.g. "#059669". */
export function getBrandHex(shade: number): string {
  const [r, g, b] = readBrandRgb(shade).split(/\s+/).map(Number);
  return '#' + [r, g, b].map((n) => Math.max(0, Math.min(255, n || 0)).toString(16).padStart(2, '0')).join('');
}
