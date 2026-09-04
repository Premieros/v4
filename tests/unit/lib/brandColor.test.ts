import { describe, expect, it } from 'vitest';
import {
  brandFromSettingsValue,
  brandShades,
  getBrandHex,
  hexToHsl,
  surfaceShades,
} from '@/lib/brandColor';

describe('hexToHsl', () => {
  it('converts white to zero saturation and max lightness', () => {
    const { h, s, l } = hexToHsl('#ffffff');
    expect(s).toBe(0);
    expect(l).toBe(100);
    expect(h).toBeGreaterThanOrEqual(0);
  });

  it('converts a known color deterministically', () => {
    const { h } = hexToHsl('#ff0000');
    expect(h).toBe(0); // red
  });
});

describe('brandShades', () => {
  it('produces all 10 brand shades', () => {
    const shades = brandShades(222, 72);
    expect(Object.keys(shades)).toHaveLength(10);
    for (const k of Object.keys(shades)) {
      expect(shades[k]).toMatch(/^\d+ \d+ \d+$/);
    }
  });
});

describe('surfaceShades', () => {
  it('produces 11 surface shades', () => {
    const shades = surfaceShades(222, 50);
    expect(Object.keys(shades)).toHaveLength(11);
  });
});

describe('brandFromSettingsValue', () => {
  it('returns default for empty value', () => {
    expect(brandFromSettingsValue(null)).toEqual({ hue: 222, sat: 72 });
  });

  it('resolves preset keys', () => {
    expect(brandFromSettingsValue('gold').hue).toBe(46);
  });

  it('parses hex values and clamps saturation', () => {
    const v = brandFromSettingsValue('#ff0000');
    expect(v.sat).toBeGreaterThanOrEqual(55);
    expect(v.sat).toBeLessThanOrEqual(85);
  });

  it('falls back to default for garbage', () => {
    expect(brandFromSettingsValue('not-a-color')).toEqual({ hue: 222, sat: 72 });
  });
});

describe('getBrandHex', () => {
  it('returns a valid hex string', () => {
    const hex = getBrandHex(600);
    expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
