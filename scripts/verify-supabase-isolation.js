import fs from 'node:fs';
import path from 'node:path';

const EXPECTED_PROJECT_REF = 'cuitndfayupfysejlpda';
const EXPECTED_URL = `https://${EXPECTED_PROJECT_REF}.supabase.co`;
const ROOT = process.cwd();
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'coverage', 'playwright-report']);
const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml',
  '.env', '.example', '.toml', '.sql', '.txt', '.html', '.css', '.scss', '.sh', '.ps1',
]);
const SUPABASE_URL_RE = /https:\/\/[a-z0-9-]+\.supabase\.co/gi;

const violations = [];

function shouldRead(filePath) {
  const base = path.basename(filePath);
  if (base.startsWith('.env')) return true;
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (!entry.isFile() || !shouldRead(fullPath)) continue;

    let text;
    try {
      text = fs.readFileSync(fullPath, 'utf8');
    } catch {
      continue;
    }

    const matches = text.match(SUPABASE_URL_RE) || [];
    for (const match of matches) {
      const normalized = match.replace(/\/+$/, '');
      if (normalized !== EXPECTED_URL) {
        violations.push(`${path.relative(ROOT, fullPath)}: ${match}`);
      }
    }
  }
}

walk(ROOT);

if (violations.length > 0) {
  console.error('Database isolation violation: foreign Supabase project URL detected in v4.');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(`Supabase isolation OK: ${EXPECTED_PROJECT_REF}`);
