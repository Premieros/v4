import { createClient } from '@supabase/supabase-js';

export const SUPABASE_PROJECT_REF = 'cuitndfayupfysejlpda';
export const SUPABASE_PROJECT_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co`;
const DEFAULT_PUBLISHABLE_KEY = 'sb_publishable_Pg0CAIqHn43BxwaB2eSogg_foaC60qs';

const rawUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const rawKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

const normalizeUrl = (value: string) => value.replace(/\/+$/, '');

if (rawUrl && normalizeUrl(rawUrl) !== SUPABASE_PROJECT_URL) {
  throw new Error(
    `Database isolation violation: v4 is locked to Supabase project ${SUPABASE_PROJECT_REF}.`
  );
}

const supabaseUrl = SUPABASE_PROJECT_URL;
const supabaseAnonKey = rawKey || DEFAULT_PUBLISHABLE_KEY;

if (!supabaseAnonKey) {
  throw new Error('Supabase publishable key is missing. Please set VITE_SUPABASE_ANON_KEY.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
