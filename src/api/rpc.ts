import { supabase } from '@/lib/supabase';
import type { ApiError, ApiResult } from './types';

export const rpc = async <R>(name: string, args: object): ApiResult<R> => {
  const res = await (supabase.rpc as unknown as (n: string, a: object) => Promise<{ data: unknown; error: ApiError | null }>)(name, args);
  return { data: (res.data as R | null) ?? null, error: res.error };
};
