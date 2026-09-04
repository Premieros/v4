#!/usr/bin/env node
// ============================================================================
// End-to-end regression test for the subscription feature (trial + plans).
//
// Exercises the exact RPC surface the frontend calls, against the configured
// database, and rolls everything back so the DB is left untouched:
//   register_branch (anon) -> branch/warehouse/settings/trial/owner created
//   subscription_status / subscription_expired during trial
//   process_sale gate returns SUBSCRIPTION_EXPIRED once the trial ends
//   activate_subscription (admin) clears the gate
//   super_admin is exempt from the gate
//
//   node scripts/db/e2e-subscriptions.mjs
//
// Requires SUPABASE_DB_URL (or DATABASE_URL / POSTGRES_URL) in .env.
// ============================================================================

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const ROOT = resolve(__dirname, '..', '..');

function loadEnv(filePath) {
  const env = {};
  let raw;
  try { raw = readFileSync(filePath, 'utf8'); } catch { return env; }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (key) env[key] = value;
  }
  return env;
}

function buildSsl(connectionString) {
  const sslMode = (connectionString.match(/sslmode=([^&\s]+)/) || [])[1];
  if (sslMode && sslMode !== 'disable') return { rejectUnauthorized: false };
  return false;
}

const env = loadEnv(join(ROOT, '.env'));
const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL || env.SUPABASE_DB_URL || env.DATABASE_URL || env.POSTGRES_URL;
if (!dbUrl) {
  console.error('ERROR: no database URL found. Add SUPABASE_DB_URL (or DATABASE_URL) to .env.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: dbUrl, ssl: buildSsl(dbUrl) });
const email = `e2e_${Date.now()}@test.local`;
let checks = 0;
let failed = 0;

function ok(name, cond, extra = '') {
  checks += 1;
  if (cond) {
    console.log(`  [ok]   ${name}`);
  } else {
    failed += 1;
    console.log(`  [FAIL] ${name}${extra ? `  (${extra})` : ''}`);
  }
}

async function run() {
  await client.connect();
  await client.query('BEGIN');
  await client.query('SET ROLE anon');

  // 1) Self-service registration (as the anon role — what /register calls)
  const reg = await client.query(
    'SELECT public.register_branch($1,$2,$3,$4,$5,$6,$7,$8) AS res',
    ['E2E Store', 'E2E Owner', email, 'secret123', 'E2E Store EN', '01000000000', 'Cairo', 'EGP'],
  );
  const res = reg.rows[0].res;
  console.log('\n1) register_branch (anon):', JSON.stringify(res));
  ok('register_branch succeeds', !!res && res.success === true);
  const bid = res?.branch_id;
  ok('returns branch_id', !!bid);
  ok('grants 14-day trial', res?.trial_days === 14, JSON.stringify(res));

  await client.query('SET ROLE postgres');

  const w = await client.query('SELECT id, branch_id FROM public.warehouses WHERE branch_id=$1', [bid]);
  ok('main warehouse created', w.rowCount === 1, JSON.stringify(w.rows[0]));

  const bs = await client.query('SELECT tax_rate, tax_enabled, currency, low_stock_threshold FROM public.branch_settings WHERE branch_id=$1', [bid]);
  ok('branch_settings copied from global', bs.rowCount === 1 && bs.rows[0]?.tax_enabled === true && bs.rows[0]?.currency === 'EGP', JSON.stringify(bs.rows[0]));

  const sub = await client.query('SELECT status, trial_starts_at, trial_ends_at FROM public.branch_subscriptions WHERE branch_id=$1', [bid]);
  const trialRow = sub.rows[0];
  ok('subscription is trial', trialRow?.status === 'trial', JSON.stringify(trialRow));
  const days = trialRow?.trial_ends_at ? Math.round((new Date(trialRow.trial_ends_at).getTime() - new Date(trialRow.trial_starts_at).getTime()) / 86400000) : null;
  ok('trial window is 14 days', days === 14, `days=${days}`);

  const u = await client.query("SELECT id, email, role, branch_id FROM public.users WHERE email=$1", [email]);
  ok('owner user created & branch-linked', u.rowCount === 1 && u.rows[0]?.role === 'owner' && u.rows[0]?.branch_id === bid, JSON.stringify(u.rows[0]));
  const au = await client.query('SELECT id, email_confirmed_at IS NOT NULL AS confirmed FROM auth.users WHERE email=$1', [email]);
  ok('auth user exists with confirmed email', au.rowCount === 1 && au.rows[0]?.confirmed === true, JSON.stringify(au.rows[0]));
  const ident = await client.query("SELECT provider, provider_id FROM auth.identities WHERE user_id=$1", [u.rows[0].id]);
  ok('email identity created', ident.rowCount === 1 && ident.rows[0]?.provider === 'email', JSON.stringify(ident.rows[0]));

  // 2) Status helpers during trial
  const st = await client.query('SELECT public.subscription_status($1) AS res', [bid]);
  ok('status reports trial', st.rows[0].res?.status === 'trial', JSON.stringify(st.rows[0].res));
  const ex = await client.query('SELECT public.subscription_expired($1) AS res', [bid]);
  ok('not expired during trial', ex.rows[0].res === false);

  // 3) Force-expire, then the sale gate must block a normal user
  await client.query("UPDATE public.branch_subscriptions SET trial_ends_at = now() - interval '1 day' WHERE branch_id=$1", [bid]);
  const ex2 = await client.query('SELECT public.subscription_expired($1) AS res', [bid]);
  ok('expired after trial ends', ex2.rows[0].res === true);
  const sale = await client.query(
    "SELECT public.process_sale('E2E-1', $1, NULL, NULL, NULL, 10, 0, 'percentage', 0, 0, 10, 10, 'cash', 'completed', '[{\"product_id\":\"00000000-0000-0000-0000-000000000000\",\"quantity\":1}]'::jsonb) AS res",
    [bid],
  );
  ok('sale blocked on expired subscription (SUBSCRIPTION_EXPIRED)', sale.rows[0].res?.error === 'SUBSCRIPTION_EXPIRED', JSON.stringify(sale.rows[0].res));

  // 4) Simulate an authenticated super_admin and activate a paid plan
  const adminId = '00000000-0000-0000-0000-0000000000ab';
  await client.query("SELECT set_config('app.register_branch','on',true)");
  await client.query(
    "INSERT INTO public.users (id, email, username, role, branch_id, is_active) VALUES ($1,'e2e-admin@test.local','e2e_admin','super_admin',$2,true)",
    [adminId, bid],
  );
  await client.query("SELECT set_config('app.register_branch','off',true)");
  await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [adminId]);
  await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: adminId, role: 'authenticated' })]);
  await client.query("SELECT set_config('role', 'authenticated', true)");

  const act = await client.query('SELECT public.activate_subscription($1, $2, $3, $4) AS res', [bid, 'standard', 'monthly', true]);
  ok('activate_subscription succeeds', act.rows[0].res?.success === true, JSON.stringify(act.rows[0].res));
  ok('price matches Standard monthly (599)', act.rows[0].res?.price_egp === 599, JSON.stringify(act.rows[0].res));

  const ex3 = await client.query('SELECT public.subscription_expired($1) AS res', [bid]);
  ok('not expired after activation', ex3.rows[0].res === false);
  const st2 = await client.query('SELECT public.subscription_status($1) AS res', [bid]);
  ok('status is active with plan', st2.rows[0].res?.status === 'active' && st2.rows[0].res?.plan_id === 'standard', JSON.stringify(st2.rows[0].res));
  ok('current period set', !!st2.rows[0].res?.current_period_ends_at);

  const sale2 = await client.query(
    "SELECT public.process_sale('E2E-2', $1, NULL, NULL, NULL, 10, 0, 'percentage', 0, 0, 10, 10, 'cash', 'completed', '[{\"product_id\":\"00000000-0000-0000-0000-000000000000\",\"quantity\":1}]'::jsonb) AS res",
    [bid],
  );
  ok('sale gate cleared after activation (falls through to PRODUCT_NOT_FOUND)', sale2.rows[0].res?.error === 'PRODUCT_NOT_FOUND', JSON.stringify(sale2.rows[0].res));

  // 5) super_admin is exempt from the gate even when cancelled/expired
  await client.query("UPDATE public.branch_subscriptions SET status='cancelled', current_period_ends_at=NULL WHERE branch_id=$1", [bid]);
  const sale3 = await client.query(
    "SELECT public.process_sale('E2E-3', $1, NULL, NULL, NULL, 10, 0, 'percentage', 0, 0, 10, 10, 'cash', 'completed', '[{\"product_id\":\"00000000-0000-0000-0000-000000000000\",\"quantity\":1}]'::jsonb) AS res",
    [bid],
  );
  ok('super_admin exempt from gate (PRODUCT_NOT_FOUND)', sale3.rows[0].res?.error === 'PRODUCT_NOT_FOUND', JSON.stringify(sale3.rows[0].res));

  await client.query('ROLLBACK');
  console.log('\nRolled back cleanly — database untouched.');
}

run()
  .then(async () => {
    await client.end();
    console.log(`\nResult: ${checks} checks, ${failed} failed.`);
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch(async (err) => {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    await client.end();
    console.error('ERROR:', err.message);
    process.exit(1);
  });
