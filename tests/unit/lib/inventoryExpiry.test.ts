import { describe, expect, it } from 'vitest';
import { parseDateOnly, daysUntilExpiry, expiryStatus } from '@/lib/inventoryExpiry';

describe('inventoryExpiry', () => {
  describe('parseDateOnly', () => {
    it('parses a date-only string as local midnight', () => {
      const d = parseDateOnly('2026-08-01');
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(7);
      expect(d.getDate()).toBe(1);
      expect(d.getHours()).toBe(0);
    });

    it('handles full ISO timestamps', () => {
      const d = parseDateOnly('2026-08-01T10:30:00Z');
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(7);
      expect(d.getDate()).toBe(1);
    });

    it('returns an invalid date for garbage input', () => {
      expect(Number.isNaN(parseDateOnly('not-a-date').getTime())).toBe(true);
      expect(Number.isNaN(parseDateOnly('').getTime())).toBe(true);
    });
  });

  describe('daysUntilExpiry', () => {
    const today = new Date(2026, 7, 1);

    it('returns 0 when expiring today', () => {
      expect(daysUntilExpiry('2026-08-01', today)).toBe(0);
    });

    it('returns positive days for a future expiry', () => {
      expect(daysUntilExpiry('2026-08-02', today)).toBe(1);
      expect(daysUntilExpiry('2026-10-30', today)).toBe(90);
    });

    it('returns negative days for an expired batch', () => {
      expect(daysUntilExpiry('2026-07-31', today)).toBe(-1);
    });

    it('returns null for missing or invalid dates', () => {
      expect(daysUntilExpiry(null, today)).toBe(null);
      expect(daysUntilExpiry('garbage', today)).toBe(null);
      expect(daysUntilExpiry('', today)).toBe(null);
    });

    it('is timezone independent for date-only input', () => {
      expect(daysUntilExpiry('2026-08-02', new Date(2026, 7, 2, 0, 1))).toBe(0);
      expect(daysUntilExpiry('2026-08-02', new Date(2026, 7, 2, 23, 59))).toBe(0);
      expect(daysUntilExpiry('2026-08-02', new Date(2026, 7, 1, 23, 59))).toBe(1);
      expect(daysUntilExpiry('2026-08-02', new Date(2026, 7, 3, 0, 1))).toBe(-1);
    });
  });

  describe('expiryStatus', () => {
    it('flags expired and expiring within the horizon', () => {
      expect(expiryStatus(-1)).toEqual({ state: 'expired' });
      expect(expiryStatus(0)).toEqual({ state: 'expiring' });
      expect(expiryStatus(90)).toEqual({ state: 'expiring' });
      expect(expiryStatus(91)).toBe(null);
      expect(expiryStatus(null)).toBe(null);
    });

    it('respects a custom horizon', () => {
      expect(expiryStatus(60, 30)).toBe(null);
      expect(expiryStatus(30, 30)).toEqual({ state: 'expiring' });
    });
  });
});
