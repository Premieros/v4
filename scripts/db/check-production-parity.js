#!/usr/bin/env node
// ============================================================================
// Production schema-parity gate.
//
// WHY: the deploy chain must never publish a frontend that is newer than the
// database it talks to. The published app calls RPC functions and reads tables
// over PostgREST; if any of those objects is missing from the PRODUCTION schema
// cache, the live page fails with PGRST202/PGRST205.
//
// Database isolation is mandatory: this gate refuses any Supabase HTTP endpoint
// other than the v4 project endpoint.
// ============================================================================

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertAllowedSupabaseUrl } from './project-isolation.js';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const ROOT = resolve(__dirname, '..', '..');

const RAW_SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!RAW_SUPABASE_URL || !ANON_KEY) {
  console.error('ERROR: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set (as in the build job).');
  process.exit(1);
}

let SUPABASE_URL;
try {
  SUPABASE_URL = assertAllowedSupabaseUrl(RAW_SUPABASE_URL, 'production parity Supabase URL');
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}

function loadContract() {
  const file = join(ROOT, 'supabase', 'api-contract.json');
  try {
    const c = JSON.parse(readFileSync(file, 'utf8'));
    const rpcs = new Map(c.rpcs.map(({ name, params }) => [name, params]));
    return { rpcs, tables: c.tables };
  } catch (err) {
    console.error(`ERROR: cannot read ${file} (${err.message}). Run \`node scripts/db/gen-contract.js\` first.`);
    process.exit(1);
  }
}

async function probeRpc(name, params, headers) {
  const body = Object.fromEntries(params.map((p) => [`p_${p}`, null]));
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 404) {
    const text = await res.text();
    if (text.includes('PGRST202')) return 'missing';
  }
  return 'present';
}

async function probeTable(name, headers) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${name}?select=id&limit=1`, {
    method: 'GET',
    headers,
  });
  if (res.status === 404) {
    const text = await res.text();
    if (text.includes('PGRST205')) return 'missing';
  }
  return 'present';
}

async function main() {
  const headers = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };

  const { rpcs, tables } = loadContract();

  console.log(`PRODUCTION PARITY CHECK  ${SUPABASE_URL}`);
  console.log(`RPC functions to verify : ${rpcs.size}`);
  console.log(`Tables to verify       : ${tables.length}`);
  console.log('');

  const missingRpc = [];
  const missingTables = [];

  for (const [name, params] of rpcs) {
    const status = await probeRpc(name, params, headers);
    if (status === 'missing') missingRpc.push(`${name}(${params.map((p) => `p_${p}`).join(', ')})`);
    process.stdout.write(`  ${status === 'present' ? 'ok ' : 'FAIL'} rpc ${name}\n`);
  }

  for (const name of tables) {
    const status = await probeTable(name, headers);
    if (status === 'missing') missingTables.push(name);
    process.stdout.write(`  ${status === 'present' ? 'ok ' : 'FAIL'} table ${name}\n`);
  }

  console.log('');
  if (missingRpc.length === 0 && missingTables.length === 0) {
    console.log('PARITY OK: every frontend RPC and table is present in the production schema cache.');
    process.exit(0);
  }

  console.error('PARITY FAILED: the frontend requires schema objects that are MISSING from production.');
  console.error('The database is behind the frontend. Do NOT publish. Apply the matching migrations first.');
  if (missingRpc.length) {
    console.error(`\nMissing RPC functions (${missingRpc.length}):`);
    missingRpc.forEach((f) => console.error(`  - ${f}`));
  }
  if (missingTables.length) {
    console.error(`\nMissing tables (${missingTables.length}):`);
    missingTables.forEach((t) => console.error(`  - ${t}`));
  }
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
