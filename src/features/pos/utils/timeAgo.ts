import type { TranslationKey } from '@/lib/i18n';

const MINUTE = 60_000;
const HOUR = 3_600_000;

// Returns a compact "2:41 PM" clock time (workspace order header).
export function formatClockTime(iso: string | null | undefined, lang: 'ar' | 'en'): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(lang === 'ar' ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit' });
}

export interface TimeAgoResult {
  key: TranslationKey;
  n?: number;
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): TimeAgoResult {
  if (!iso) return { key: 'now' };
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return { key: 'now' };
  const diff = Math.max(0, now - t);
  if (diff < MINUTE) return { key: 'secondsAgo' };
  const mins = Math.floor(diff / MINUTE);
  if (mins < 60) return { key: 'minutesAgo', n: mins };
  return { key: 'hoursAgo', n: Math.floor(diff / HOUR) };
}

// Long-form label for the kitchen drawer.
export function timeAgoLabel(res: TimeAgoResult): string {
  if (res.n == null) return '';
  if (res.key === 'minutesAgo') return `${res.n} `;
  if (res.key === 'hoursAgo') return `${res.n} `;
  return '';
}
