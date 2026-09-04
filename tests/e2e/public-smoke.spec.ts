import { expect, test, type Page } from '@playwright/test';

const SUPABASE_ORIGIN = process.env.VITE_SUPABASE_URL || 'https://cuitndfayupfysejlpda.supabase.co';

const protectedRoutes = [
  '/dashboard', '/pos', '/floor-plan', '/kitchen', '/tables', '/products', '/inventory',
  '/warehouses', '/raw-materials', '/recipes', '/production', '/transfers', '/inventory-ledger',
  '/branches', '/purchases', '/customers', '/suppliers', '/expenses', '/sales', '/shifts',
  '/reports', '/financial-reports', '/accounting', '/accounts', '/payments', '/journal',
  '/treasury', '/reconciliation', '/users', '/employees', '/audit-log', '/settings',
  '/settings/basic', '/system-health', '/subscription', '/subscriptions',
];

async function mockUnauthenticatedBackend(page: Page) {
  // Public smoke tests must never depend on the real Supabase project. The
  // authenticated POS/dashboard suites already provide their own backend mocks.
  // Keep this suite deterministic and focused on routing/login UI behavior.
  await page.route(`${SUPABASE_ORIGIN}/auth/v1/**`, async (route) => {
    const url = route.request().url();

    if (url.includes('/auth/v1/token')) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid login credentials' }),
      });
      return;
    }

    if (url.includes('/auth/v1/session')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ access_token: null, token_type: 'bearer', user: null }),
      });
      return;
    }

    if (url.includes('/auth/v1/user')) {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'No session' }) });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.route(`${SUPABASE_ORIGIN}/rest/v1/**`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route(`${SUPABASE_ORIGIN}/storage/v1/**`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

test.describe('public application smoke', () => {
  test.beforeEach(async ({ page }) => {
    await mockUnauthenticatedBackend(page);
  });

  test('login page renders without browser console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.goto('/#/login');
    await expect(page.getByRole('heading', { name: /مرحباً بك|Welcome back/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /English|العربية/i })).toBeVisible();
    await expect(page.locator('form button[type="submit"]')).toBeVisible();

    await page.getByRole('button', { name: /English|العربية/i }).click();
    await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible();
    await expect(page.locator('form button[type="submit"]')).toHaveText(/Sign in/i);

    expect(consoleErrors).toEqual([]);
  });

  test('login validation blocks invalid PIN without leaving login', async ({ page }) => {
    await page.goto('/#/login');
    await page.locator('#login-username').fill('smoke-test');
    await page.locator('#login-pin').fill('12');
    await page.locator('form button[type="submit"]').click();

    await expect(page).toHaveURL(/#\/login$/);
    await expect(page.getByText(/4|أربع|four/i).first()).toBeVisible();
    await expect(page.locator('form button[type="submit"]')).toBeEnabled();
  });

  for (const route of protectedRoutes) {
    test(`protected route ${route} redirects unauthenticated users to login`, async ({ page }) => {
      await page.goto(`/#${route}`);
      await expect(page).toHaveURL(/#\/login$/);
      await expect(page.getByRole('heading', { name: /مرحباً بك|Welcome back/i })).toBeVisible();
    });
  }
});
