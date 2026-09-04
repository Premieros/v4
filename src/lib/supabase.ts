import { createClient } from '@supabase/supabase-js';

const OLD_HOSTS = ['azzdesuowpdcoflmyezn'];
const DEFAULT_SUPABASE_URL = 'https://cuitndfayupfysejlpda.supabase.co';
const DEFAULT_ANON_KEY = 'sb_publishable_Pg0CAIqHn43BxwaB2eSogg_foaC60qs';

const rawUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const rawKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

const isStaleUrl = Boolean(rawUrl && OLD_HOSTS.some(h => rawUrl.includes(h)));

const supabaseUrl = (!rawUrl || isStaleUrl) ? DEFAULT_SUPABASE_URL : rawUrl;
const supabaseAnonKey = (!rawKey || isStaleUrl) ? DEFAULT_ANON_KEY : rawKey;

if (!supabaseUrl) {
  throw new Error('Supabase URL is missing. Please set VITE_SUPABASE_URL.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey || 'placeholder-anon-key-for-build', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

