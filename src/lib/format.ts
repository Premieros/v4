import type { Language } from './types';

export function formatCurrency(amount: number, currency = 'EGP', lang: Language = 'ar'): string {
  const value = Number(amount || 0).toFixed(2);
  const symbolMap: Record<string, { ar: string; en: string }> = {
    EGP: { ar: 'ج.م', en: 'EGP' },
    SAR: { ar: 'ر.س', en: 'SAR' },
    USD: { ar: 'د.أ', en: 'USD' },
    AED: { ar: 'د.إ', en: 'AED' },
  };
  const symbol = symbolMap[currency]?.[lang] || currency;
  return `${value} ${symbol}`;
}

export function formatNumber(value: number, decimals = 2): string {
  return Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

export function formatDate(date: string | Date, lang: Language = 'ar'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(date: string | Date, lang: Language = 'ar'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function generateInvoiceNumber(prefix = 'INV'): string {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `${prefix}-${y}${m}${d}-${rand}`;
}

export function generateBarcode(): string {
  return String(Math.floor(Math.random() * 9000000000000) + 1000000000000);
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
