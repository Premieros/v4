import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const EXPECTED_SUPABASE_PROJECT_REF = 'cuitndfayupfysejlpda';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function loadEnv(filePath: string): Record<string, string> {
  const env: Record<string, string> = {};
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return env;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) env[key] = value;
  }
  return env;
}

function assertAllowedDatabaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Database isolation violation: invalid integration database URL.');
  }

  const hostname = parsed.hostname.toLowerCase();
  const username = decodeURIComponent(parsed.username || '').toLowerCase();
  if (LOCAL_HOSTS.has(hostname)) return value;

  if (!hostname.includes(EXPECTED_SUPABASE_PROJECT_REF) && !username.includes(EXPECTED_SUPABASE_PROJECT_REF)) {
    throw new Error(
      `Database isolation violation: integration tests may only target project ${EXPECTED_SUPABASE_PROJECT_REF} or localhost.`
    );
  }
  return value;
}

export function getDbUrl(): string {
  const env = loadEnv(join(process.cwd(), '.env'));
  const value = (
    process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL ||
    env.SUPABASE_DB_URL || env.DATABASE_URL || env.POSTGRES_URL
  );
  return value ? assertAllowedDatabaseUrl(value) : value;
}

function buildSsl(connectionString: string): { rejectUnauthorized: boolean } | boolean {
  const sslMode = (connectionString.match(/sslmode=([^&\s]+)/) || [])[1];
  if (sslMode && sslMode !== 'disable') return { rejectUnauthorized: false };
  return false;
}

export function openDb(connectionString: string): pg.Client {
  return new pg.Client({ connectionString: assertAllowedDatabaseUrl(connectionString), ssl: buildSsl(connectionString) });
}
