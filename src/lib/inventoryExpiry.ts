export function parseDateOnly(value: string): Date {
  const parts = value.split('T')[0].split('-').map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some((p) => Number.isNaN(p))) return new Date(NaN);
  const [y, m, d] = parts;
  return new Date(y, m - 1, d);
}

export function daysUntilExpiry(expiry: string | null, today: Date = new Date()): number | null {
  if (!expiry) return null;
  const exp = parseDateOnly(expiry);
  if (Number.isNaN(exp.getTime())) return null;
  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((exp.getTime() - now.getTime()) / 86400000);
}

export function expiryStatus(days: number | null, horizonDays = 90): { state: 'expired' | 'expiring' } | null {
  if (days === null) return null;
  if (days < 0) return { state: 'expired' };
  if (days <= horizonDays) return { state: 'expiring' };
  return null;
}
