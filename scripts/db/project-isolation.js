export const EXPECTED_SUPABASE_PROJECT_REF = 'cuitndfayupfysejlpda';
export const EXPECTED_SUPABASE_URL = `https://${EXPECTED_SUPABASE_PROJECT_REF}.supabase.co`;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function assertAllowedSupabaseUrl(value, label = 'Supabase URL') {
  if (!value) throw new Error(`${label} is missing.`);
  const normalized = String(value).trim().replace(/\/+$/, '');
  if (normalized !== EXPECTED_SUPABASE_URL) {
    throw new Error(
      `Database isolation violation: ${label} must target Supabase project ${EXPECTED_SUPABASE_PROJECT_REF}.`
    );
  }
  return normalized;
}

export function assertAllowedDatabaseUrl(value, { allowLocal = true, label = 'database URL' } = {}) {
  if (!value) throw new Error(`${label} is missing.`);

  let parsed;
  try {
    parsed = new URL(String(value).trim());
  } catch {
    throw new Error(`Database isolation violation: ${label} is not a valid connection URL.`);
  }

  const hostname = parsed.hostname.toLowerCase();
  const username = decodeURIComponent(parsed.username || '').toLowerCase();

  if (allowLocal && LOCAL_HOSTS.has(hostname)) return String(value).trim();

  const belongsToV4 =
    hostname.includes(EXPECTED_SUPABASE_PROJECT_REF) ||
    username.includes(EXPECTED_SUPABASE_PROJECT_REF);

  if (!belongsToV4) {
    throw new Error(
      `Database isolation violation: ${label} does not belong to Supabase project ${EXPECTED_SUPABASE_PROJECT_REF}.`
    );
  }

  return String(value).trim();
}
