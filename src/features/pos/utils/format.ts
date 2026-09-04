import type { Branch, Language, OrderType, Settings } from '@/lib/types';
import type { TranslationKey } from '@/lib/i18n';
import { ORDER_TYPE_KEY } from './orderTypes';

export function displayName(lang: Language, name: string, nameEn: string | null): string {
  return lang === 'ar' ? name : (nameEn || name);
}

export function branchName(lang: Language, branch: Pick<Branch, 'name' | 'name_en'> | null | undefined): string {
  if (!branch) return '';
  return displayName(lang, branch.name, branch.name_en);
}

export function orderTypeLabel(t: (key: TranslationKey) => string, type: OrderType): string {
  return t(ORDER_TYPE_KEY[type]);
}

export function currencyOf(effSettings: Pick<Settings, 'currency'> | null): string {
  return effSettings?.currency || 'EGP';
}
