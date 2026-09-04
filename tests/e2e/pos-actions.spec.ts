import { expect, test, type Page } from '@playwright/test';

const SUPABASE_ORIGIN = process.env.VITE_SUPABASE_URL || 'https://cuitndfayupfysejlpda.supabase.co';
const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const BRANCH_ID = '00000000-0000-0000-0000-000000000010';
const PRODUCT_ID = '00000000-0000-0000-0000-000000000020';
const WAREHOUSE_ID = '00000000-0000-0000-0000-000000000030';
const TABLE_ID = '00000000-0000-0000-0000-000000000040';

const fakeUser = { id: TEST_USER_ID, email: 'e2e@example.test', full_name: 'E2E Admin', role: 'super_admin', is_active: true, branch_id: BRANCH_ID, created_at: new Date().toISOString() };
const product = { id: PRODUCT_ID, branch_id: BRANCH_ID, name: 'E2E Burger', name_en: 'E2E Burger', sku: 'E2E-001', barcode: '628000000020', sale_price: 100, product_type: 'simple', category_id: null, is_active: true, low_stock_threshold: 5 };
const diningTable = { id: TABLE_ID, branch_id: BRANCH_ID, area_id: null, name: 'Table 1', capacity: 4, status: 'vacant', shape: 'square', layout: { x: 0, y: 0, w: 120, h: 120 }, is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };

let rpcCalls: string[] = [];
let rpcPayloads: Record<string, unknown[]> = {};

function base64Url(value: unknown) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
function makeSession() {
  const accessToken = [base64Url({ alg: 'none', typ: 'JWT' }), base64Url({ aud: 'authenticated', role: 'authenticated', sub: TEST_USER_ID, email: fakeUser.email, exp: Math.floor(Date.now() / 1000) + 3600 }), 'e2e-signature'].join('.');
  return { access_token: accessToken, refresh_token: 'e2e-refresh-token', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: TEST_USER_ID, aud: 'authenticated', role: 'authenticated', email: fakeUser.email, user_metadata: {}, app_metadata: {} } };
}

async function mockPosBackend(page: Page) {
  rpcCalls = [];
  rpcPayloads = {};
  const session = makeSession();
  await page.route(`${SUPABASE_ORIGIN}/auth/v1/**`, async (route) => {
    const url = route.request().url();
    if (url.includes('/auth/v1/user')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session.user) });
    if (url.includes('/auth/v1/token')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/**`, async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/users**`, async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([fakeUser]) }));
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/products**`, async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([product]) }));
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/customers**`, async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/categories**`, async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/branches**`, async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: BRANCH_ID, name: 'E2E Branch', name_en: 'E2E Branch', is_active: true }]) }));
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/settings**`, async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ currency: 'EGP', tax_enabled: false, tax_rate: 0 }) }));
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/warehouses**`, async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: WAREHOUSE_ID, branch_id: BRANCH_ID, is_active: true }]) }));
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/inventory**`, async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ product_id: PRODUCT_ID, quantity: 20 }]) }));
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/product_components**`, async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/dining_tables**`, async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([diningTable]) }));
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/orders**`, async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/order_items**`, async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/order_kitchen_sends**`, async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/kitchen_sends**`, async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/rpc/**`, async (r) => {
    const name = new URL(r.request().url()).pathname.split('/').pop() || '';
    rpcCalls.push(name);
    try { rpcPayloads[name] = [...(rpcPayloads[name] || []), JSON.parse(r.request().postData() || '{}')]; } catch { rpcPayloads[name] = [...(rpcPayloads[name] || []), {}]; }
    if (name === 'get_login_email') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, email: fakeUser.email }) });
    if (name === 'record_login_success' || name === 'record_login_failure') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    if (name === 'get_active_shift') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, open: false }) });
    if (name === 'next_document_number') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, number: 'E2E-INV-001' }) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, id: 'e2e-order-id', order_id: 'e2e-order-id', order_number: 'E2E-001', sale_id: 'e2e-sale-id', sent: [{ product_name: product.name, quantity: 1, unit_name: 'piece' }], items_sent_count: 1 }) });
  });
}

async function login(page: Page) {
  await page.goto('/#/login');
  await page.locator('#login-username').fill('e2e-admin');
  await page.locator('#login-pin').fill('1234');
  await page.locator('form').getByRole('button', { name: /دخول|تسجيل الدخول|Sign in/i }).click();
  await expect(page).toHaveURL(/#\/dashboard$/);
}

async function addProduct(page: Page) {
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('E2E Burger', { exact: true }).first()).toBeVisible({ timeout: 10000 });
  const addButton = page.getByRole('button', { name: /E2E Burger/i });
  await expect(addButton).toBeEnabled({ timeout: 10000 });
  await addButton.click({ timeout: 10000 });
  await expect(page.getByTestId(`pos-cart-qty-${PRODUCT_ID}`)).toHaveText('1', { timeout: 10000 });
}

test.describe('POS action-level', () => {
  test.beforeEach(async ({ page }) => {
    await mockPosBackend(page);
    await login(page);
    const posLink = page.getByRole('link', { name: /نقطة البيع|POS/i }).first();
    await expect(posLink).toBeVisible({ timeout: 10000 });
    await posLink.click();
    await expect(page).toHaveURL(/#\/pos$/);
    await page.getByTestId('pos-action-new-order').click();
    await expect(page.getByTestId('pos-order-type-picker')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('body')).not.toHaveText(/Error Loading Data|خطأ في تحميل البيانات/i);
  });

  test('starts quick pickup, adds product, changes quantity, and opens payment', async ({ page }) => {
    await page.getByTestId('pos-order-type-takeaway').click();
    await addProduct(page);
    await page.getByTestId(`pos-cart-qty-increase-${PRODUCT_ID}`).click();
    await expect(page.getByTestId(`pos-cart-qty-${PRODUCT_ID}`)).toHaveText('2');
    await page.getByTestId('pos-action-pay').click();
    await expect(page.getByTestId('pos-payment-confirm')).toBeVisible();
    await expect(page.getByTestId('pos-payment-method-cash')).toBeVisible();
  });

  test('dine-in opens floorplan, selects a table, sets guests, and starts the table order', async ({ page }) => {
    await page.getByTestId('pos-order-type-dine_in').click();
    await expect(page.getByTestId(`pos-table-${TABLE_ID}`)).toBeVisible({ timeout: 10000 });
    await page.getByTestId(`pos-table-${TABLE_ID}`).click();
    await page.getByTestId(`pos-table-${TABLE_ID}-guest-count`).fill('3');
    await page.getByTestId(`pos-table-${TABLE_ID}-start`).click();
    await expect(page.getByText('E2E Burger', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('pos-order-type-picker')).toBeHidden();
  });

  test('drive-thru captures plate and starts the order action', async ({ page }) => {
    await page.getByTestId('pos-order-type-drive_thru').click();
    await page.getByTestId('pos-drive-thru-plate').fill('ABC-1234');
    await page.getByTestId('pos-drive-thru-customer').fill('Drive Customer');
    await page.getByTestId('pos-drive-thru-people').fill('2');
    await page.getByTestId('pos-drive-thru-start').click();
    await expect(page.getByTestId('pos-order-type-picker')).toBeHidden();
    await expect(page.getByRole('button', { name: /E2E Burger/i })).toBeVisible({ timeout: 10000 });
  });

  test('delivery captures phone and address and starts the order action', async ({ page }) => {
    await page.getByTestId('pos-order-type-delivery').click();
    await page.getByTestId('pos-delivery-phone').fill('01000000000');
    await page.getByTestId('pos-delivery-address').fill('E2E Address');
    await page.getByTestId('pos-delivery-notes').fill('Leave at door');
    await page.getByTestId('pos-delivery-start').click();
    await expect(page.getByTestId('pos-order-type-picker')).toBeHidden();
    await expect(page.getByRole('button', { name: /E2E Burger/i })).toBeVisible({ timeout: 10000 });
  });

  test('discount action changes the order total', async ({ page }) => {
    await page.getByTestId('pos-order-type-takeaway').click();
    await addProduct(page);
    await expect(page.getByTestId('pos-total-value')).toContainText('100');
    await page.getByTestId('pos-action-discount').click();
    await expect(page.getByTestId('pos-discount-editor')).toBeVisible();
    await page.getByTestId('pos-discount-percent').click();
    await page.getByTestId('pos-discount-input').fill('10');
    await expect(page.getByTestId('pos-discount-value')).toContainText('10');
    await expect(page.getByTestId('pos-total-value')).toContainText('90');
  });

  test('hold action persists the order and changes it to held', async ({ page }) => {
    await page.getByTestId('pos-order-type-takeaway').click();
    await addProduct(page);
    await page.getByTestId('pos-action-hold').click();
    await expect(page.getByTestId('pos-action-hold')).toBeVisible();
    await expect.poll(() => rpcCalls.includes('create_order'), { timeout: 10000 }).toBe(true);
    await expect.poll(() => rpcCalls.includes('set_order_status'), { timeout: 10000 }).toBe(true);
    const statusPayload = (rpcPayloads.set_order_status?.[0] || {}) as { p_status?: string };
    expect(statusPayload.p_status).toBe('held');
  });

  test('send to kitchen sends the selected item and shows the kitchen confirmation', async ({ page }) => {
    await page.getByTestId('pos-order-type-takeaway').click();
    await addProduct(page);
    await page.getByTestId('pos-action-send-kitchen').click();
    await expect(page.getByText(/إرسال للمطبخ \(1\)|Sent to kitchen \(1\)/i)).toBeVisible({ timeout: 10000 });
    await expect(rpcCalls).toContain('create_order');
    await expect(page.getByTestId('pos-action-send-kitchen')).toBeVisible();
  });

  test('complete sale executes payment confirmation and process_sale', async ({ page }) => {
    await page.getByTestId('pos-order-type-takeaway').click();
    await addProduct(page);
    await page.getByTestId('pos-action-pay').click();
    await expect(page.getByTestId('pos-payment-method-cash')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('pos-payment-method-cash').click();
    await page.getByTestId('pos-payment-confirm').click();
    await expect.poll(() => rpcCalls.includes('process_sale'), { timeout: 10000 }).toBe(true);
    const payload = (rpcPayloads.process_sale?.[0] || {}) as { p_status?: string; p_payment_method?: string; p_order_type?: string };
    expect(payload.p_status).toBe('completed');
    expect(payload.p_payment_method).toBe('cash');
    expect(payload.p_order_type).toBe('takeaway');
  });

  test('order-type actions expose all supported flows and back navigation', async ({ page }) => {
    await expect(page.getByTestId('pos-order-type-dine_in')).toBeVisible();
    await expect(page.getByTestId('pos-order-type-drive_thru')).toBeVisible();
    await expect(page.getByTestId('pos-order-type-delivery')).toBeVisible();
    await expect(page.getByTestId('pos-order-type-takeaway')).toBeVisible();
    await page.getByTestId('pos-order-type-drive_thru').click();
    await expect(page.getByText(/أدخل رقم اللوحة لبدء الطلب|Enter the plate to start/i)).toBeVisible();
    await expect(page.getByTestId('pos-drive-thru-plate')).toBeVisible();
    await page.getByRole('button', { name: /رجوع|Back/i }).click();
    await expect(page.getByTestId('pos-order-type-picker')).toBeVisible();
  });
});