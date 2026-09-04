import { describe, expect, it } from 'vitest';
import { APP_ROUTES } from '@/core/navigation/routes';
import { MENU_ITEMS } from '@/core/navigation/menu.config';

describe('navigation registry', () => {
  it('keeps every menu target inside the centralized route registry', () => {
    const routes = new Set(Object.values(APP_ROUTES));
    expect(MENU_ITEMS.every((item) => routes.has(item.route))).toBe(true);
  });

  it('does not define duplicate menu identities or routes', () => {
    expect(new Set(MENU_ITEMS.map((item) => item.id)).size).toBe(MENU_ITEMS.length);
    expect(new Set(MENU_ITEMS.map((item) => item.route)).size).toBe(MENU_ITEMS.length);
  });

  it('requires a permission or explicit public/super-admin policy for admin actions', () => {
    const adminItems = MENU_ITEMS.filter((item) => item.group === 'admin');
    expect(adminItems.every((item) => item.permission || item.superAdminOnly)).toBe(true);
  });
});
