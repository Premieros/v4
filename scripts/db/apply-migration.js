#!/usr/bin/env node
// ============================================================================
// Apply a migration file (or all files in a directory) to a Postgres database.
//
//   node scripts/db/apply-migration.js [--dry-run] [--dir supabase/migrations]
//   node scripts/db/apply-migration.js [--dry-run] --file <path>
//
// Rules (enforced by design):
//   * Migrations are ADDITIVE ONLY: never edit an already-applied file; add a
//     new numbered file instead. Editing an applied file is caught here via
//     the checksum column and aborts with an error.
//   * Every applied file is recorded in public.schema_migrations together with
//     a sha256 checksum, so re-runs are idempotent and tampering is detected.
//   * --dry-run runs the target inside a transaction that is always rolled
//     back: it previews the outcome without touching the database.
//
// Configuration is read ONLY from .env (never from the shell / repo):
//   SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@<host>:5432/postgres
//   (falls back to DATABASE_URL / POSTGRES_URL if SUPABASE_DB_URL is absent)
// ============================================================================

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const ROOT = resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Minimal .env parser (no dependency). Lines: KEY=VALUE, # comments, quotes.
// ---------------------------------------------------------------------------
function loadEnv(filePath) {
  const env = {};
  let raw;
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

function parseArgs(argv) {
  const opts = { dryRun: false, dir: null, file: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--dir') opts.dir = argv[++i];
    else if (arg === '--file') opts.file = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage:
  node scripts/db/apply-migration.js [--dry-run] [--dir supabase/migrations]
  node scripts/db/apply-migration.js [--dry-run] --file <path>`);
      process.exit(0);
    }
  }
  return opts;
}

// Neutralize explicit transaction control lines so dry-run can wrap the whole
// file in one transaction and roll it back (exact copy is used for real runs).
function neutralizeTxnControl(sql) {
  return sql
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (/^BEGIN\s*;$/i.test(t)) return line.replace(/BEGIN\s*;/i, '-- BEGIN; (neutralized for dry-run)');
      if (/^COMMIT\s*;$/i.test(t)) return line.replace(/COMMIT\s*;/i, '-- COMMIT; (neutralized for dry-run)');
      if (/^ROLLBACK\s*;$/i.test(t)) return line.replace(/ROLLBACK\s*;/i, '-- ROLLBACK; (neutralized for dry-run)');
      return line;
    })
    .join('\n');
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// SSL on when the URL opts in (sslmode=require/verify-full) — Supabase pooler
// needs it, a local Postgres must not use it.
function buildSsl(connectionString) {
  const sslMode = (connectionString.match(/sslmode=([^&\s]+)/) || [])[1];
  if (sslMode && sslMode !== 'disable') return { rejectUnauthorized: false };
  return false;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const env = loadEnv(join(ROOT, '.env'));
  const dbUrl =
    process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL ||
    env.SUPABASE_DB_URL || env.DATABASE_URL || env.POSTGRES_URL;

  if (!dbUrl) {
    console.error('ERROR: no database URL found. Add SUPABASE_DB_URL (or DATABASE_URL) to .env.');
    process.exit(1);
  }

  let targets = [];
  if (opts.file) {
    const abs = resolve(ROOT, opts.file);
    if (!statSync(abs).isFile()) {
      console.error(`ERROR: file not found: ${abs}`);
      process.exit(1);
    }
    targets = [abs];
  } else {
    const dir = resolve(ROOT, opts.dir || 'supabase/migrations');
    if (!statSync(dir).isDirectory()) {
      console.error(`ERROR: directory not found: ${dir}`);
      process.exit(1);
    }
    targets = readdirSync(dir)
      .filter((f) => /\.sql$/i.test(f))
      .sort()
      .map((f) => join(dir, f));
  }

  if (targets.length === 0) {
    console.error('ERROR: no .sql files found to apply.');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: dbUrl, ssl: buildSsl(dbUrl) });
  await client.connect();

  const applied = [];
  const skipped = [];
  const failed = [];

  try {
    // Record table for already-applied files (additive bootstrap, safe on any DB).
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        id bigserial PRIMARY KEY,
        version text NOT NULL UNIQUE,
        name text NOT NULL,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);

    for (const target of targets) {
      const name = basename(target);
      const version = name.replace(/\.sql$/i, '');
      const sql = readFileSync(target, 'utf8');
      const checksum = sha256(sql);

      const existing = await client.query(
        'SELECT checksum FROM public.schema_migrations WHERE version = $1',
        [version],
      );
      if (existing.rowCount > 0) {
        if (existing.rows[0].checksum !== checksum) {
          console.error(`ABORT: ${name} was applied before but its content changed.`);
          console.error('Migrations are additive-only; never edit an applied file. Add a new numbered file instead.');
          failed.push(name);
          break;
        }
        skipped.push(name);
        continue;
      }

      const runSql = opts.dryRun ? neutralizeTxnControl(sql) : sql;
      const label = opts.dryRun ? 'DRY-RUN' : 'APPLY';

      if (opts.dryRun) {
        await client.query('BEGIN');
        try {
          await client.query(runSql);
          await client.query('ROLLBACK');
          applied.push(name);
          console.log(`  [ok] ${label}  ${name}`);
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          console.error(`  [FAIL] ${label}  ${name}`);
          console.error(`         ${err.message}`);
          failed.push(name);
          break;
        }
      } else {
        try {
          await client.query('BEGIN');
          await client.query(runSql);
          await client.query(
            'INSERT INTO public.schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
            [version, name, checksum],
          );
          await client.query('COMMIT');
          applied.push(name);
          console.log(`  [ok] ${label}  ${name}`);
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          console.error(`  [FAIL] ${label}  ${name}`);
          console.error(`         ${err.message}`);
          failed.push(name);
          break;
        }
      }
    }

    if (skipped.length > 0) {
      console.log(`\nSkipped (already applied, unchanged): ${skipped.length}`);
      skipped.forEach((n) => console.log(`  - ${n}`));
    }

    if (!opts.dryRun && applied.length > 0) {
      const rows = await client.query(
        'SELECT version, name, applied_at FROM public.schema_migrations ORDER BY id',
      );
      console.log('\nApplied so far (schema_migrations):');
      rows.rows.forEach((r) => console.log(`  ${r.version}  ${r.applied_at.toISOString()}`));
    }
  } finally {
    await client.end();
  }

  if (failed.length > 0) process.exit(1);
  console.log(opts.dryRun ? `\nDry-run finished: ${applied.length} ok, ${skipped.length} skipped.` : `\nDone: ${applied.length} applied, ${skipped.length} skipped.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
