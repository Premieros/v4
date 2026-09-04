import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

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

export function getDbUrl(): string {
  const env = loadEnv(join(process.cwd(), '.env'));
  return (
    process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL ||
    env.SUPABASE_DB_URL || env.DATABASE_URL || env.POSTGRES_URL
  );
}

function buildSsl(connectionString: string): { rejectUnauthorized: boolean } | boolean {
  const sslMode = (connectionString.match(/sslmode=([^&\s]+)/) || [])[1];
  if (sslMode && sslMode !== 'disable') return { rejectUnauthorized: false };
  return false;
}

export function openDb(connectionString: string): pg.Client {
  return new pg.Client({ connectionString, ssl: buildSsl(connectionString) });
}
